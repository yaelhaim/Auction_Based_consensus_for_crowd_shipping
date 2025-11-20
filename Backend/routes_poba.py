# PoBA (Proof-of-Bid-Assignment) REST endpoints:
# - Pull open requests/offers from DB
# - Build a proposal (IDA*) with distance+price cost model
# - Submit proposal & finalize slot on a Substrate chain (with priority-aware retry)
# - Optionally apply proposal into DB assignments (auto after finalize or manual endpoint)
#
# Notes:
# * Includes a penalized "skip" so IDA* won’t stall on the first request.
# * submit_proposal/finalize_slot can now wait for FINALIZATION (not just inclusion) via POBA_WAIT_FINALIZATION=1.
# * Both chain calls retry with increasing tip to overcome "Priority is too low (1014)".

from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Tuple, Annotated, Iterable, Optional
from uuid import UUID
import os, logging, math
from datetime import timezone

from sqlalchemy.orm import Session
from sqlalchemy import text

from .Database.db import get_db
from .Database.db import SessionLocal  # for auto-apply inside finalize
from .models import Request, CourierOffer

from substrateinterface import SubstrateInterface, Keypair
try:
    from substrateinterface.exceptions import SubstrateRequestException
except Exception:
    class SubstrateRequestException(Exception):
        pass

from json.decoder import JSONDecodeError
import time

from .auction.ida_star_core import ida_star

router = APIRouter(prefix="/poba", tags=["poba"])
log = logging.getLogger("poba")


# ------------------------------ Chain helpers ------------------------------

def _ws_url() -> str:
    return os.getenv("SUBSTRATE_WS_URL", "ws://127.0.0.1:9944")

def _type_registry_preset() -> str:
    return os.getenv("SUBSTRATE_TYPE_REGISTRY_PRESET", "substrate-node-template")

def _pallet_name() -> str:
    # IMPORTANT: the module name as appears in construct_runtime! is "PoBA"
    return os.getenv("POBA_PALLET", "PoBA")

def _call_submit() -> str:
    return os.getenv("POBA_CALL_SUBMIT", "submit_proposal")

def _call_finalize() -> str:
    return os.getenv("POBA_CALL_FINALIZE", "finalize_slot")

def _param_matches() -> str:
    # Some chains use "matches", others "match_items" – make it configurable.
    return os.getenv("POBA_PARAM_MATCHES", "matches")

def _escrow_pallet_name() -> str:
    """
    Name of the escrow pallet as it appears in construct_runtime!.
    Default: 'Escrow'.
    """
    return os.getenv("ESCROW_PALLET", "Escrow")


def _escrow_call_create() -> str:
    """
    Name of the create-escrow extrinsic in the Escrow pallet.
    Default: 'create_escrow'.
    """
    return os.getenv("ESCROW_CALL_CREATE", "create_escrow")

def _wait_for_finalization() -> bool:
    return os.getenv("POBA_WAIT_FINALIZATION", "0").lower() in {"1", "true", "yes"}


def _finalization_timeout_sec() -> int:
    # kept only for debug visibility; not passed to substrate.submit_extrinsic
    return int(os.getenv("POBA_FINALIZATION_TIMEOUT_SEC", "60"))


# ------------------------------ Types & utils ------------------------------

Hex32 = Annotated[str, Field(min_length=32, max_length=32, pattern=r"^[0-9a-fA-F]{32}$")]

def uuid_to_16_hex(u: UUID) -> str:
    return u.hex

def _hex32_to_uuid(s: str) -> UUID:
    # 32-hex (no dashes) -> UUID
    return UUID(hex=s)

def hex16_to_u8_array_16(s: str) -> List[int]:
    try:
        b = bytes.fromhex(s)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_hex",
            "hint": "uuid_16 must be a 32-character hex string",
            "error": str(e),
        })
    if len(b) != 16:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_length",
            "hint": "uuid_16 must encode exactly 16 bytes",
            "got": len(b),
        })
    return list(b)

def get_substrate() -> SubstrateInterface:
    url = _ws_url()
    preset = _type_registry_preset()
    try:
        return SubstrateInterface(
            url=url,
            ss58_format=42,
            type_registry_preset=preset,
            auto_reconnect=True,
        )
    except Exception as e:
        log.exception("Failed to connect Substrate WS at %s: %s", url, e)
        raise HTTPException(status_code=502, detail={
            "code": "substrate_connect_failed",
            "ws_url": url,
            "preset": preset,
            "error": str(e),
            "hint": "Ensure node is running with WS on the given URL",
        })

def get_signer() -> Keypair:
    uri = os.getenv("SUBSTRATE_SIGNER_URI")
    mnemonic = os.getenv("SUBSTRATE_SIGNER_MNEMONIC")
    if uri:
        try:
            return Keypair.create_from_uri(uri)
        except Exception as e:
            raise HTTPException(status_code=400, detail={
                "code": "invalid_signer_uri",
                "error": str(e),
                "hint": "SUBSTRATE_SIGNER_URI is not a valid SURI (e.g. //Alice)",
            })
    if mnemonic:
        try:
            return Keypair.create_from_mnemonic(mnemonic)
        except Exception as e:
            raise HTTPException(status_code=400, detail={
                "code": "invalid_signer_mnemonic",
                "error": str(e),
                "hint": "Provide a valid 12/24-word mnemonic or use SUBSTRATE_SIGNER_URI",
            })
    raise HTTPException(status_code=400, detail={
        "code": "signer_not_set",
        "hint": "Define SUBSTRATE_SIGNER_URI (e.g. //Alice) or SUBSTRATE_SIGNER_MNEMONIC",
    })


# ------------------------------ Schemas ------------------------------

class MarketRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    uuid_16: Hex32
    from_lat: int
    from_lon: int
    to_lat: int
    to_lon: int
    max_price_cents: int
    kind: int
    window_start: int
    window_end: int

class MarketOffer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    uuid_16: Hex32
    min_price_cents: int
    from_lat: int
    from_lon: int
    to_lat: int
    to_lon: int
    window_start: int
    window_end: int
    types_mask: int

class MatchItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    request_uuid: Hex32
    offer_uuid:   Hex32
    agreed_price_cents: int
    partial_score: int

class SubmitProposalBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slot: Annotated[int, Field(ge=0)]
    # If client does not send total_score, default to 0 (we do not fabricate any other value).
    total_score: int = 0
    matches: List[MatchItem]

class FinalizeBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slot: Annotated[int, Field(ge=0)]

class BuildBody(BaseModel):
    """
    Compute a proposal for a given (requests, offers) snapshot.
    Optional distance caps allow pre-filtering pairs (good for large markets).
    """
    model_config = ConfigDict(extra="ignore")
    slot: Annotated[int, Field(ge=0)]
    requests: List[MarketRequest]
    offers: List[MarketOffer]

    # Optional soft caps (km). If provided, pairs exceeding thresholds are discarded.
    max_start_km: Optional[float] = Field(default=None, ge=0)
    max_end_km: Optional[float] = Field(default=None, ge=0)
    max_total_km: Optional[float] = Field(default=None, ge=0)

class BuildResp(BaseModel):
    slot: int
    total_score: int
    matches: List[MatchItem]


# ------------------------------ DB-facing endpoints ------------------------------

@router.get("/requests-open", response_model=List[MarketRequest])
def requests_open(db: Session = Depends(get_db)) -> List[MarketRequest]:
    rows = (
        db.query(Request)
        .filter(Request.status == "open")
        .order_by(Request.created_at.asc())
        .limit(1000)
        .all()
    )
    out: List[MarketRequest] = []
    for r in rows:
        # timestamps → ms; if tz-naive in DB, treat as UTC
        ws = int(r.window_start.replace(tzinfo=r.window_start.tzinfo or timezone.utc).timestamp() * 1000) if getattr(r, "window_start", None) else 0
        we = int(r.window_end.replace(tzinfo=r.window_end.tzinfo or timezone.utc).timestamp() * 1000) if getattr(r, "window_end", None) else 0
        out.append(MarketRequest(
            uuid_16=uuid_to_16_hex(r.id),
            from_lat=int(r.from_lat or 0),
            from_lon=int(r.from_lon or 0),
            to_lat=int(r.to_lat or 0),
            to_lon=int(r.to_lon or 0),
            max_price_cents=int(round((r.max_price or 0) * 100)),
            kind=0 if r.type == "package" else 1,
            window_start=ws,
            window_end=we,
        ))
    return out

def _offers_active_impl(db: Session) -> List[MarketOffer]:
    rows = (
        db.query(CourierOffer)
        .filter(CourierOffer.status == "active")
        .order_by(CourierOffer.created_at.asc())
        .limit(1000)
        .all()
    )
    out: List[MarketOffer] = []
    for o in rows:
        out.append(MarketOffer(
            uuid_16=uuid_to_16_hex(o.id),
            min_price_cents=int(round((o.min_price or 0) * 100)),
            from_lat=int(o.from_lat or 0),
            from_lon=int(o.from_lon or 0),
            to_lat=int(o.to_lat or 0),
            to_lon=int(o.to_lon or 0),
            window_start=int(o.window_start.timestamp() * 1000) if o.window_start else 0,
            window_end=int(o.window_end.timestamp() * 1000) if o.window_end else 0,
            types_mask=1,
        ))
    return out

@router.get("/offers-active", response_model=List[MarketOffer])
def offers_active(db: Session = Depends(get_db)) -> List[MarketOffer]:
    return _offers_active_impl(db)

@router.get("/offers-open", response_model=List[MarketOffer])
def offers_open_compat(db: Session = Depends(get_db)) -> List[MarketOffer]:
    return _offers_active_impl(db)


# ------------------------------ Internal DB apply helper ------------------------------

def _apply_matches_to_db(matches: List[MatchItem], db: Session) -> dict:
    """
    Shared logic to materialize matches into DB:
    - Create assignments
    - Update requests.status='assigned'
    - Update courier_offers.status='assigned'
    - (Optionally) create on-chain escrow entries per assignment

    If ESCROW_ENABLE=1, the function will:
      - Connect once to the chain
      - For each created assignment, call Escrow::create_escrow
        with (request_uuid, offer_uuid, driver_wallet, payer_wallet, amount_cents).

    Escrow errors are logged but do NOT abort the DB operations.
    """
    if not matches:
        return {
            "ok": True,
            "created": 0,
            "updated_requests": 0,
            "updated_offers": 0,
            "escrows_created": 0,
        }

    # Escrow toggle via env flag.
    enable_escrow = os.getenv("ESCROW_ENABLE", "0").lower() in {"1", "true", "yes"}

    substrate = None
    signer = None
    escrows_created = 0

    if enable_escrow:
        try:
            substrate = get_substrate()
            signer = get_signer()
            log.info("Escrow integration enabled: pallet=%s call=%s",
                     _escrow_pallet_name(), _escrow_call_create())
        except HTTPException as e:
            # If we fail to init chain client, we just log and continue without escrow.
            log.warning("ESCROW_ENABLE=1 but failed to init chain client: %s", e.detail)
            enable_escrow = False
        except Exception as e:
            log.warning("ESCROW_ENABLE=1 but failed to init chain client (generic): %s", e)
            enable_escrow = False

    created = 0
    upd_r = 0
    upd_o = 0

    for m in matches:
        try:
            rq_uuid = _hex32_to_uuid(m.request_uuid)
            of_uuid = _hex32_to_uuid(m.offer_uuid)
        except Exception:
            # If UUID conversion fails, skip this match entirely.
            continue

        # ✅ fix: CAST(:param AS uuid) instead of :param::uuid
        sel = text("""
            SELECT
                r.id::text AS request_id,
                o.id::text AS offer_id,
                o.driver_user_id::text AS driver_user_id
            FROM requests r
            JOIN courier_offers o ON o.id = CAST(:offer_id AS uuid)
            WHERE r.id = CAST(:request_id AS uuid)
            LIMIT 1
        """)
        row = db.execute(
            sel,
            {"request_id": str(rq_uuid), "offer_id": str(of_uuid)},
        ).mappings().first()
        if not row:
            continue

        request_id = row["request_id"]
        offer_id = row["offer_id"]
        driver_user_id = row["driver_user_id"]

        # Skip if there is already an active assignment for this request.
        exists = db.execute(
            text("""
                SELECT 1 FROM assignments
                WHERE request_id = CAST(:rid AS uuid)
                  AND status IN ('created','picked_up','in_transit')
                LIMIT 1
            """),
            {"rid": request_id},
        ).first()
        if exists:
            continue

        # Insert new assignment row.
        ins = text("""
            INSERT INTO assignments
              (request_id, driver_user_id, offer_id, status, assigned_at)
            VALUES
              (CAST(:rid AS uuid), CAST(:duid AS uuid), CAST(:oid AS uuid), 'created', NOW())
            RETURNING id
        """)
        arow = db.execute(
            ins,
            {"rid": request_id, "duid": driver_user_id, "oid": offer_id},
        ).mappings().first()
        if arow:
            created += 1

        # Update request status -> 'assigned'.
        db.execute(
            text("UPDATE requests SET status='assigned', updated_at=NOW() WHERE id = CAST(:rid AS uuid)"),
            {"rid": request_id},
        )
        upd_r += 1

        # Update courier offer status -> 'assigned'.
        db.execute(
            text("UPDATE courier_offers SET status='assigned', updated_at=NOW() WHERE id = CAST(:oid AS uuid)"),
            {"oid": offer_id},
        )
        upd_o += 1

        # ---------------------- Escrow on-chain (optional) ----------------------
        if enable_escrow and substrate is not None and signer is not None:
            try:
                # Fetch driver + payer wallet addresses from DB.
                driver_row = db.execute(
                    text("SELECT wallet_address AS driver_wallet FROM users WHERE id = CAST(:duid AS uuid)"),
                    {"duid": driver_user_id},
                ).mappings().first()
                payer_row = db.execute(
                    text("""
                        SELECT u.wallet_address AS payer_wallet
                        FROM requests r
                        JOIN users u ON u.id = r.owner_user_id
                        WHERE r.id = CAST(:rid AS uuid)
                        LIMIT 1
                    """),
                    {"rid": request_id},
                ).mappings().first()

                if not driver_row or not payer_row:
                    log.warning(
                        "Escrow: missing driver or payer wallet for request_id=%s driver_user_id=%s",
                        request_id,
                        driver_user_id,
                    )
                else:
                    driver_wallet = driver_row["driver_wallet"]
                    payer_wallet = payer_row["payer_wallet"]
                    amount_cents = int(m.agreed_price_cents)

                    if not driver_wallet or not payer_wallet:
                        log.warning(
                            "Escrow: empty wallet address (driver=%s, payer=%s) for request_id=%s",
                            driver_wallet,
                            payer_wallet,
                            request_id,
                        )
                    elif amount_cents <= 0:
                        log.warning(
                            "Escrow: non-positive amount_cents=%s for request_id=%s (skipping create_escrow)",
                            amount_cents,
                            request_id,
                        )
                    else:
                        # request_uuid_hex16 / offer_uuid_hex16 = original hex32 strings from MatchItem
                        escrow_hash = create_escrow_on_chain(
                            substrate,
                            signer,
                            request_uuid_hex16=m.request_uuid,
                            offer_uuid_hex16=m.offer_uuid,
                            driver_wallet=driver_wallet,
                            payer_wallet=payer_wallet,
                            amount_cents=amount_cents,
                        )
                        escrows_created += 1
                        log.info(
                            "Escrow created on-chain: hash=%s request_uuid=%s offer_uuid=%s amount_cents=%s",
                            escrow_hash,
                            m.request_uuid,
                            m.offer_uuid,
                            amount_cents,
                        )
            except HTTPException as e:
                # Do not break DB flow; just log the issue.
                log.warning(
                    "create_escrow_on_chain failed for request_id=%s: %s",
                    request_id,
                    getattr(e, "detail", e),
                )
            except Exception as e:
                log.warning(
                    "create_escrow_on_chain raised exception for request_id=%s: %s",
                    request_id,
                    e,
                )

    # Single commit at the end for all assignments/updates.
    db.commit()

    return {
        "ok": True,
        "created": created,
        "updated_requests": upd_r,
        "updated_offers": upd_o,
        "escrows_created": escrows_created,
    }

# ------------------------------ Chain calls ------------------------------

def _submit_with_wait(substrate, extrinsic, *, label: str):
    """
    Helper to submit extrinsic and wait according to env flags.
    Waits for finalization if POBA_WAIT_FINALIZATION=1, otherwise for inclusion.
    Does NOT use unsupported 'timeout' argument (compatible with older substrate-interface).
    Falls back gracefully from finalization→inclusion and retries JSONDecodeError once.
    """
    wait_final = _wait_for_finalization()

    if wait_final:
        try:
            return substrate.submit_extrinsic(
                extrinsic,
                wait_for_finalization=True
            )
        except (JSONDecodeError, SubstrateRequestException) as e:
            log.warning("%s: finalization wait failed (%s), falling back to inclusion", label, e)

    # Fallback: inclusion (default behavior)
    try:
        return substrate.submit_extrinsic(
            extrinsic,
            wait_for_inclusion=True
        )
    except JSONDecodeError as e:
        # Known hiccup: retry once; if fails again, send without wait
        log.warning("%s inclusion wait JSONDecodeError: %s; retrying once", label, e)
        time.sleep(0.2)
        try:
            return substrate.submit_extrinsic(extrinsic, wait_for_inclusion=True)
        except JSONDecodeError as e2:
            log.warning("%s: second inclusion wait failed (%s); sending without wait", label, e2)
            return substrate.submit_extrinsic(extrinsic, wait_for_inclusion=False)
        
def create_escrow_on_chain(
    substrate: SubstrateInterface,
    signer: Keypair,
    *,
    request_uuid_hex16: str,
    offer_uuid_hex16: str,
    driver_wallet: str,
    payer_wallet: str,
    amount_cents: int,
) -> str:
    """
    Create an escrow on-chain for a single (request, offer) assignment.

    Parameters:
      - request_uuid_hex16: 32-hex (UUID without dashes)
      - offer_uuid_hex16:   32-hex (UUID without dashes)
      - driver_wallet:      SS58 address of the driver (users.wallet_address)
      - payer_wallet:       SS58 address of the payer (request.owner_user_id → users.wallet_address)
      - amount_cents:       logical amount for escrow (in cents). On-chain Balance is used as cents.

    Returns:
      - extrinsic hash (str) if successful
    """
    matches_param_name = _param_matches()  # not really needed here, but kept for symmetry/logging
    pallet = _escrow_pallet_name()
    call_fn = _escrow_call_create()

    # Convert UUID hex → [u8; 16]
    rq_u8 = hex16_to_u8_array_16(request_uuid_hex16)
    of_u8 = hex16_to_u8_array_16(offer_uuid_hex16)

    # We treat "amount" on-chain as CENTS, not chain UNITs.
    amt = int(amount_cents)
    if amt <= 0:
        raise HTTPException(status_code=400, detail={
            "code": "escrow_zero_amount",
            "hint": "Amount for escrow must be > 0 cents",
        })

    try:
        call = substrate.compose_call(
            call_module=pallet,
            call_function=call_fn,
            call_params={
                "request_uuid": rq_u8,
                "offer_uuid":   of_u8,
                # substrate-interface will encode these as AccountId (SS58 strings).
                "driver":       driver_wallet,
                "payer":        payer_wallet,
                "amount":       amt,
            },
        )
        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer)
        receipt = _submit_with_wait(substrate, extrinsic, label="create_escrow")
        ok = getattr(receipt, "is_success", None)
        log.info(
            "create_escrow included/finalized: ok=%s hash=%s request=%s offer=%s amount_cents=%s",
            ok,
            getattr(receipt, "extrinsic_hash", None),
            request_uuid_hex16,
            offer_uuid_hex16,
            amt,
        )
        if ok is False:
            raise HTTPException(status_code=502, detail={
                "code": "escrow_dispatch_failed",
                "receipt": str(getattr(receipt, "error_message", "")),
                "hint": "Check Escrow pallet error/event data",
            })
        return str(receipt.extrinsic_hash)
    except HTTPException:
        raise
    except SubstrateRequestException as e:
        log.exception("create_escrow RPC failed: %s", e)
        raise HTTPException(status_code=502, detail={
            "code": "escrow_rpc_failed",
            "error": str(e),
        })
    except Exception as e:
        log.exception("create_escrow failed: %s", e)
        raise HTTPException(status_code=500, detail={
            "code": "create_escrow_failed",
            "error": str(e),
        })


@router.post("/submit-proposal")
def submit_proposal(body: SubmitProposalBody):
    """
    Submit (or improve) the best proposal for a slot to the PoBA pallet.
    Now includes retry with increasing `tip` to overcome 1014 "Priority is too low".
    Also supports waiting for FINALIZATION via POBA_WAIT_FINALIZATION=1.

    API semantics:
      - Domain "no matches" is NOT treated as an HTTP error:
        we return ok=false, submitted=false, reason="no_matches" with HTTP 200.
      - Network / RPC / dispatch problems ARE errors (4xx/5xx).
    """
    # Soft guard: no matches means "nothing to submit", not an error.
    if not body.matches:
        total_score = int(body.total_score or 0)
        return {
            "ok": False,
            "submitted": False,
            "reason": "no_matches",
            "slot": body.slot,
            "total_score": total_score,
            "matches": [],
        }

    substrate = get_substrate()
    signer = get_signer()

    # Quick health probe (helps with nicer error if WS is down)
    try:
        health = substrate.rpc_request("system_health", [])
        log.info("system_health: %s", health)
    except SubstrateRequestException as e:
        log.exception("RPC system_health failed: %s", e)
        raise HTTPException(status_code=502, detail={
            "code": "rpc_system_health_failed",
            "error": str(e),
            "hint": "Check WS URL and node availability",
        })

    matches_param_name = _param_matches()
    # If client didn't send a score, fall back to 0 (do not fabricate any other value).
    total_score = int(body.total_score or 0)

    try:
        # Convert match items → SCALE tuple-vec
        match_tuples: List[List[int] | Tuple[List[int], List[int], int, int]] = []
        for m in body.matches:
            match_tuples.append([
                hex16_to_u8_array_16(m.request_uuid),
                hex16_to_u8_array_16(m.offer_uuid),
                int(m.agreed_price_cents),
                int(m.partial_score),
            ])

        call = substrate.compose_call(
            call_module=_pallet_name(),
            call_function=_call_submit(),
            call_params={
                "slot": int(body.slot),
                "total_score": total_score,
                matches_param_name: match_tuples,
            },
        )

        # ---- priority-aware retry with increasing tip ----
        MAX_ATTEMPTS = int(os.getenv("POBA_TX_MAX_ATTEMPTS", "3"))
        BASE_TIP     = int(os.getenv("POBA_TX_TIP_BASE", "0"))
        TIP_STEP     = int(os.getenv("POBA_TX_TIP_STEP", "1000"))
        BACKOFF_MS   = int(os.getenv("POBA_TX_BACKOFF_MS", "150"))

        last_err: Optional[Exception] = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            tip = BASE_TIP + (attempt - 1) * TIP_STEP
            extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer, tip=tip)

            try:
                receipt = _submit_with_wait(substrate, extrinsic, label="submit_proposal")
                ok = getattr(receipt, "is_success", None)
                log.info("submit_proposal included/finalized: ok=%s hash=%s tip=%s", ok, receipt.extrinsic_hash, tip)
                for ev in getattr(receipt, "triggered_events", []) or []:
                    try:
                        mod = ev.value["event"]["module"]; name = ev.value["event"]["event"]
                        log.info("submit_proposal event: %s::%s", mod, name)
                    except Exception:
                        pass

                if ok is False:
                    raise HTTPException(status_code=502, detail={
                        "code": "dispatch_failed",
                        "hint": "Check pallet event / error data; ensure types and param names match runtime",
                        "receipt": str(getattr(receipt, "error_message", "")),
                    })

                return {"ok": True, "submitted": True, "hash": receipt.extrinsic_hash}

            except SubstrateRequestException as e:
                # Handle 1014 "Priority is too low"
                msg = str(getattr(e, "args", [""])[0]) or str(e)
                is_priority_low = ("Priority is too low" in msg) or ("'code': 1014" in msg) or ('"code": 1014' in msg)
                if is_priority_low and attempt < MAX_ATTEMPTS:
                    log.warning("submit_proposal retry due to low priority (attempt %s/%s, tip=%s): %s",
                                attempt, MAX_ATTEMPTS, tip, msg)
                    time.sleep((BACKOFF_MS * attempt) / 1000.0)
                    last_err = e
                    continue
                log.exception("submit_proposal RPC failed: %s", e)
                raise HTTPException(status_code=502, detail={
                    "code": "rpc_submit_failed",
                    "error": str(e),
                    "hint": "Verify pallet/call/param names and signer funds",
                })

        raise HTTPException(status_code=502, detail={
            "code": "tx_priority_retries_exhausted",
            "error": str(last_err) if last_err else "unknown",
        })

    except HTTPException:
        raise
    except Exception as e:
        log.exception("submit_proposal failed: %s", e)
        raise HTTPException(status_code=500, detail={
            "code": "submit_proposal_failed",
            "error": str(e),
        })

@router.post("/finalize-slot")
def finalize_slot(body: FinalizeBody):
    """
    Finalize a slot only if BestProposal[slot] exists and has matches>0.
    Includes priority-aware retry with tip, and can wait for FINALIZATION (POBA_WAIT_FINALIZATION=1).
    Optionally applies the finalized matches into DB automatically when BID_AUTO_APPLY=1.
    """
    substrate = get_substrate()
    signer = get_signer()

    # Guard: don't finalize a slot if there is no BestProposal with matches>0
    try:
        bp = substrate.query(_pallet_name(), "BestProposal", [int(body.slot)]).value
    except Exception as e:
        log.warning("finalize_slot: failed to query BestProposal for slot %s: %s", body.slot, e)
        bp = None

    if not bp or not (bp.get("matches") or []):
        return {"ok": False, "skipped": True, "reason": "no_best_proposal_for_slot", "slot": body.slot}

    try:
        call = substrate.compose_call(
            call_module=_pallet_name(),
            call_function=_call_finalize(),
            call_params={"slot": int(body.slot)},
        )

        # ---- priority-aware retry with increasing tip ----
        MAX_ATTEMPTS = int(os.getenv("POBA_TX_MAX_ATTEMPTS", "3"))
        BASE_TIP     = int(os.getenv("POBA_TX_TIP_BASE", "0"))
        TIP_STEP     = int(os.getenv("POBA_TX_TIP_STEP", "1000"))
        BACKOFF_MS   = int(os.getenv("POBA_TX_BACKOFF_MS", "150"))

        receipt = None
        last_err: Optional[Exception] = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            tip = BASE_TIP + (attempt - 1) * TIP_STEP
            extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer, tip=tip)
            try:
                receipt = _submit_with_wait(substrate, extrinsic, label="finalize_slot")
                break
            except SubstrateRequestException as e:
                msg = str(getattr(e, "args", [""])[0]) or str(e)
                is_priority_low = ("Priority is too low" in msg) or ("'code': 1014" in msg) or ('"code": 1014' in msg)
                if is_priority_low and attempt < MAX_ATTEMPTS:
                    log.warning("finalize_slot retry due to low priority (attempt %s/%s, tip=%s): %s",
                                attempt, MAX_ATTEMPTS, tip, msg)
                    time.sleep((BACKOFF_MS * attempt) / 1000.0)
                    last_err = e
                    continue
                raise

        if receipt is None:
            raise HTTPException(status_code=502, detail={
                "code": "rpc_finalize_failed",
                "error": str(last_err) if last_err else "unknown",
            })

        ok = getattr(receipt, "is_success", None)
        log.info("finalize_slot included/finalized: ok=%s hash=%s", ok, receipt.extrinsic_hash)
        for ev in getattr(receipt, "triggered_events", []) or []:
            try:
                mod = ev.value["event"]["module"]; name = ev.value["event"]["event"]
                log.info("finalize_slot event: %s::%s", mod, name)
            except Exception:
                pass

        if ok is False:
            raise HTTPException(status_code=502, detail={
                "code": "dispatch_failed",
                "hint": "Check pallet finalize error",
                "receipt": str(getattr(receipt, "error_message", "")),
            })

        # ---- Auto-apply matches into DB after finalize (optional) ----
        auto_apply = os.getenv("BID_AUTO_APPLY", "0").lower() in {"1", "true", "yes"}
        applied = None
        if auto_apply:
            try:
                # Query BestProposal right after finalize
                bp2 = substrate.query(_pallet_name(), "BestProposal", [int(body.slot)]).value
                items = (bp2 or {}).get("matches") or []
                matches: List[MatchItem] = []
                for it in items:
                    # it = (req_u8[16], off_u8[16], price_cents, partial_score)
                    try:
                        rq_hex = bytes(it[0]).hex()
                    except Exception:
                        rq_hex = "".join(f"{b:02x}" for b in it[0])
                    try:
                        of_hex = bytes(it[1]).hex()
                    except Exception:
                        of_hex = "".join(f"{b:02x}" for b in it[1])
                    matches.append(MatchItem(
                        request_uuid=rq_hex,
                        offer_uuid=of_hex,
                        agreed_price_cents=int(it[2]),
                        partial_score=int(it[3]),
                    ))
                if matches:
                    db = SessionLocal()
                    try:
                        applied = _apply_matches_to_db(matches, db)
                    finally:
                        db.close()
            except Exception as e:
                log.warning("auto-apply after finalize failed: %s", e)

        return {"ok": True, "hash": receipt.extrinsic_hash, "auto_applied": applied}
    except SubstrateRequestException as e:
        log.exception("finalize_slot RPC failed: %s", e)
        raise HTTPException(status_code=502, detail={
            "code": "rpc_finalize_failed",
            "error": str(e),
        })
    except HTTPException:
        raise
    except Exception as e:
        log.exception("finalize_slot failed: %s", e)
        raise HTTPException(status_code=500, detail={
            "code": "finalize_slot_failed",
            "error": str(e),
        })


# ------------------------------ Proposal builder (IDA*) ------------------------------

@router.post("/build-proposal", response_model=BuildResp)
def build_proposal(body: BuildBody) -> BuildResp:
    """
    Compute an assignment with IDA*.
    We MINIMIZE "cost" (penalty) and derive POSITIVE "score" for the on-chain total_score.

    Constraints (per-pair feasibility):
      - Price: offer.min_price_cents <= request.max_price_cents (0 means "no max")
      - Time:   request window must overlap offer window (configurable, see env below)
      - Distance caps (optional): max_start_km / max_end_km / max_total_km
      - Each offer is used at most once
      - We iterate requests in given order and may SKIP a request with a heavy penalty (to avoid dead-ends)

    Cost model:
      penalty = ALPHA * (d_start + d_end) + BETA * price_cents
      (lower is better)
    Score model (for chain, positive and additive):
      score = max(0, BASE - penalty)

    IMPORTANT: We add a heavy SKIP cost so the search prefers real matches when they exist.
    """
    R = body.requests
    O = body.offers
    n = len(R)  # consider all requests; skipping is allowed with penalty
    m = len(O)

    # ---------------- Scoring parameters (tunable) ----------------
    BASE  = int(os.getenv("POBA_BASE_SCORE", "1000000"))   # keep scores positive
    ALPHA = float(os.getenv("POBA_ALPHA_PER_KM", "1000"))  # penalty per km
    BETA  = float(os.getenv("POBA_BETA_PER_CENT", "1"))    # penalty per cent

    # Heavy penalty for skipping a request (so we prefer matching when possible)
    SKIP_COST = int(os.getenv("POBA_SKIP_COST", "100000000"))  # default 1e8

    # Optional pairwise distance caps (via request, or ENV fallback)
    max_start_km = body.max_start_km if body.max_start_km is not None else (float(os.getenv("POBA_MAX_START_KM", "0")) or None)
    max_end_km   = body.max_end_km   if body.max_end_km   is not None else (float(os.getenv("POBA_MAX_END_KM", "0")) or None)
    max_total_km = body.max_total_km if body.max_total_km is not None else (float(os.getenv("POBA_MAX_TOTAL_KM", "0")) or None)

    # ---------------- Time-overlap requirements ----------------
    # All values are interpreted in milliseconds (ms) since epoch (UTC)
    REQUIRE_TIME_OVERLAP = os.getenv("POBA_REQUIRE_TIME_OVERLAP", "1").lower() not in {"0", "false", "no", ""}
    MIN_OVERLAP_MS = int(float(os.getenv("POBA_MIN_OVERLAP_SEC", "0")) * 1000)
    # Optional slack: allow an offer to start a bit earlier / end a bit later
    EARLY_SLACK_MS = int(float(os.getenv("POBA_EARLY_SLACK_SEC", "0")) * 1000)
    LATE_SLACK_MS  = int(float(os.getenv("POBA_LATE_SLACK_SEC", "0")) * 1000)

    def intervals_overlap_ms(a_start: int, a_end: int, b_start: int, b_end: int,
                             min_olap: int = 0, early_slack: int = 0, late_slack: int = 0) -> bool:
        """
        Check if [a_start, a_end] and [b_start, b_end] overlap at least `min_olap` ms,
        allowing slack on the 'b' interval: b_start -= early_slack, b_end += late_slack.
        All times are ms since epoch (UTC).
        If any bound is missing/zero and overlap is required → return False.
        """
        if not (a_start and a_end and b_start and b_end):
            return not REQUIRE_TIME_OVERLAP
        b_s = b_start - early_slack
        b_e = b_end + late_slack
        overlap = min(a_end, b_e) - max(a_start, b_s)
        return overlap >= max(0, min_olap)

    # ---------------- Precompute pair cost/score ----------------
    INF = 10**12  # sufficiently large
    cost = [[INF] * m for _ in range(n)]
    partial_score = [[0] * m for _ in range(n)]
    price_agreed = [[0] * m for _ in range(n)]

    def haversine_km(lat1_e6: int, lon1_e6: int, lat2_e6: int, lon2_e6: int) -> float:
        to_rad = lambda x: (x / 1_000_000.0) * math.pi / 180.0
        lat1, lon1, lat2, lon2 = map(to_rad, [lat1_e6, lon1_e6, lat2_e6, lon2_e6])
        dlat, dlon = lat2 - lat1, lon2 - lon1
        a = (math.sin(dlat / 2) ** 2) + math.cos(lat1) * math.cos(lat2) * (math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(a**0.5, (1 - a)**0.5)
        return 6371.0 * c

    for i, r in enumerate(R):
        for j, o in enumerate(O):
            # 1) Price feasibility (0 means "no max" on the request)
            if r.max_price_cents and o.min_price_cents > r.max_price_cents:
                continue

            # 2) Time-window feasibility
            if REQUIRE_TIME_OVERLAP:
                if not intervals_overlap_ms(
                    r.window_start, r.window_end,
                    o.window_start, o.window_end,
                    min_olap=MIN_OVERLAP_MS,
                    early_slack=EARLY_SLACK_MS,
                    late_slack=LATE_SLACK_MS,
                ):
                    continue

            # 3) Distance feasibility
            d_start = haversine_km(r.from_lat, r.from_lon, o.from_lat, o.from_lon)
            d_end   = haversine_km(r.to_lat, r.to_lon, o.to_lat, o.to_lon)
            d_total = d_start + d_end

            if max_start_km is not None and d_start > max_start_km:
                continue
            if max_end_km is not None and d_end > max_end_km:
                continue
            if max_total_km is not None and d_total > max_total_km:
                continue

            # 4) Scoring
            # Agreed price policy: use offer's min price (could be replaced with negotiation policy)
            p_cents = max(int(o.min_price_cents), 100)
            penalty = int(ALPHA * d_total + BETA * p_cents)  # minimize penalty
            sc = max(0, BASE - penalty)                      # positive score (maximize on-chain)

            partial_score[i][j] = int(sc)
            price_agreed[i][j]  = p_cents
            cost[i][j]          = penalty

    # ---------------- IDA* state space ----------------
    # State = (i, used_mask, g_cost)
    # i: index of current request (0..n)
    # used_mask: bitmask over offers (size m)
    # g_cost: accumulated cost up to this state

    from typing import Tuple as Tup, Iterable as _Iterable, Optional as _Optional

    def is_goal(state: Tup[int, int, int]) -> bool:
        i, used_mask, g = state
        # We allow reaching i == n after matching OR penalized skipping
        return i == n

    def h(state: Tup[int, int, int]) -> float:
        # Admissible lower bound: 0 (safe).
        return 0.0

    def expand(state: Tup[int, int, int]) -> _Iterable[Tup[Tup[int, int, int], float]]:
        i, used_mask, g = state
        if i >= n:
            return []
        succ = []

        # Penalized "skip request i" (prevents getting stuck if early requests are impossible)
        succ.append(((i + 1, used_mask, g + SKIP_COST), SKIP_COST))

        # Try to match request i with any unused feasible offer j
        for j in range(m):
            if (used_mask >> j) & 1:
                continue
            c_ij = cost[i][j]
            if c_ij >= INF:
                continue
            next_state = (i + 1, used_mask | (1 << j), g + c_ij)
            succ.append((next_state, c_ij))
        return succ

    def key(state: Tup[int, int, int]):
        return (state[0], state[1])

    start = (0, 0, 0)
    goal, best_cost = ida_star(start=start, h=h, expand=expand, is_goal=is_goal, key=key)

    matches: List[MatchItem] = []
    total_score = 0

    if goal is None:
        log.info("build_proposal: no feasible assignment (slot=%s)", body.slot)
        return BuildResp(slot=body.slot, total_score=0, matches=[])

    # ---------------- Reconstruct one optimal plan ----------------
    # With h=0, we can replay greedily: for each i, prefer any successor that keeps us within best_cost.
    i, used_mask, acc = 0, 0, 0
    while i < n:
        chosen_j: _Optional[int] = None

        # Prefer a real match if possible (and still optimal)
        for j in range(m):
            if (used_mask >> j) & 1:
                continue
            c_ij = cost[i][j]
            if c_ij >= INF:
                continue
            if acc + c_ij <= best_cost:
                chosen_j = j
                break

        if chosen_j is not None:
            matches.append(MatchItem(
                request_uuid=R[i].uuid_16,
                offer_uuid=O[chosen_j].uuid_16,
                agreed_price_cents=int(price_agreed[i][chosen_j]),
                partial_score=int(partial_score[i][chosen_j]),
            ))
            total_score += int(partial_score[i][chosen_j])
            used_mask |= (1 << chosen_j)
            acc += int(cost[i][chosen_j])
            i += 1
            continue

        # Otherwise we must have skipped this request in the optimal path
        if acc + SKIP_COST <= best_cost:
            acc += SKIP_COST
            i += 1
            continue

        # Should not happen if best_cost is consistent; break to avoid infinite loop.
        break

    log.info(
        "build_proposal: slot=%s total_score=%s matches=%s (skip_cost=%s, time_required=%s, min_overlap_ms=%s, early_slack_ms=%s, late_slack_ms=%s)",
        body.slot, total_score, len(matches), SKIP_COST,
        REQUIRE_TIME_OVERLAP, MIN_OVERLAP_MS, EARLY_SLACK_MS, LATE_SLACK_MS
    )
    return BuildResp(slot=body.slot, total_score=total_score, matches=matches)


# ------------------------------ Diagnostics ------------------------------

@router.get("/chain-health")
def chain_health():
    """Quick RPC checks: chain name, health, runtime version, best header."""
    sub = get_substrate()
    try:
        chain = sub.rpc_request("system_chain", [])
        health = sub.rpc_request("system_health", [])
        rt = sub.rpc_request("state_getRuntimeVersion", [])
        head = sub.rpc_request("chain_getHeader", [])
        return {
            "ws_url": _ws_url(),
            "chain": chain,
            "health": health,
            "runtime": rt,
            "best_header": head,
        }
    except SubstrateRequestException as e:
        raise HTTPException(status_code=502, detail={
            "code": "rpc_failed",
            "error": str(e),
        })

@router.get("/debug-config")
def debug_config():
    return {
        "ws_url": _ws_url(),
        "type_registry_preset": _type_registry_preset(),
        "pallet": _pallet_name(),
        "call_submit": _call_submit(),
        "call_finalize": _call_finalize(),
        "param_matches": _param_matches(),
        "signer_uri_present": bool(os.getenv("SUBSTRATE_SIGNER_URI")),
        "signer_mnemonic_present": bool(os.getenv("SUBSTRATE_SIGNER_MNEMONIC")),
        "signer_source": "URI" if os.getenv("SUBSTRATE_SIGNER_URI") else ("MNEMONIC" if os.getenv("SUBSTRATE_SIGNER_MNEMONIC") else "NONE"),
        "wait_for_finalization": _wait_for_finalization(),
        "finalization_timeout_sec": _finalization_timeout_sec(),
        "auto_apply": os.getenv("BID_AUTO_APPLY", "0"),
    }

@router.get("/whoami")
def whoami():
    """
    Return the signer source and, if valid, the SS58 address and free balance.
    Helps diagnose invalid mnemonic/SURI and insufficient funds.
    """
    src = "URI" if os.getenv("SUBSTRATE_SIGNER_URI") else ("MNEMONIC" if os.getenv("SUBSTRATE_SIGNER_MNEMONIC") else "NONE")
    out = {"signer_source": src}
    try:
        kp = get_signer()  # will raise 400 if invalid/absent
    except HTTPException as e:
        out["error"] = e.detail
        return out

    out["ss58_address"] = kp.ss58_address
    try:
        sub = get_substrate()
        # System.Account → data.free
        acc = sub.query("System", "Account", [kp.ss58_address])
        free = int(acc.value["data"]["free"])
        out["free"] = free
        out["free_units_hint"] = "value is in the chain's base units"
    except Exception as e:
        out["balance_error"] = str(e)
    return out


# ------------------------------ Apply endpoints ------------------------------

@router.post("/apply-proposal")
def apply_proposal(
    payload: SubmitProposalBody = Body(...),
    db: Session = Depends(get_db),
):
    """
    Materialize a (built or finalized) proposal into the DB:
    - Create assignments(request_id, driver_user_id, offer_id, status, assigned_at)
    - Update requests.status='assigned'
    - Update courier_offers.status='assigned'
    This endpoint trusts the payload you pass (typically from /poba/build-proposal).
    In production you may want to fetch the finalized proposal from chain instead.
    """
    return _apply_matches_to_db(payload.matches or [], db)

@router.post("/finalize-and-apply")
def finalize_and_apply(
    payload: SubmitProposalBody = Body(...),
):
    """
    Convenience endpoint:
    1) finalize-slot on chain (waits for finalization if POBA_WAIT_FINALIZATION=1)
    2) apply the same matches to DB immediately
    """
    # 1) finalize on chain
    fin = finalize_slot(FinalizeBody(slot=payload.slot))
    if not fin or not fin.get("ok"):
        return {"ok": False, "where": "finalize", "resp": fin}

    # 2) apply into DB
    db = SessionLocal()
    try:
        applied = _apply_matches_to_db(payload.matches or [], db)
    finally:
        db.close()

    return {"ok": True, "finalize": fin, "apply": applied}
