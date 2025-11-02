# app/routes_poba.py
# Stable PoBA API for node-worker & app.
# - All 16-byte IDs are 32-char hex strings (no raw bytes in JSON).
# - Robust signer config (SURI or mnemonic).
# - Flexible runtime call names via ENV.
# - Structured errors with clear hints for the app.

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Tuple, Annotated, Iterable
from uuid import UUID
import os, logging, math

from sqlalchemy.orm import Session

# --- DB plumbing ---
from .Database.db import get_db
from .models import Request, CourierOffer

# --- Substrate RPC client ---
from substrateinterface import SubstrateInterface, Keypair
try:
    from substrateinterface.exceptions import SubstrateRequestException
except Exception:
    class SubstrateRequestException(Exception):
        pass

import json
from json.decoder import JSONDecodeError
import time

# --- IDA* core ---
from .auction.ida_star_core import ida_star

router = APIRouter(prefix="/poba", tags=["poba"])
log = logging.getLogger("poba")

# -----------------------
# Environment & Defaults
# -----------------------

def _ws_url() -> str:
    return os.getenv("SUBSTRATE_WS_URL", "ws://127.0.0.1:9944")

def _type_registry_preset() -> str:
    return os.getenv("SUBSTRATE_TYPE_REGISTRY_PRESET", "substrate-node-template")

def _pallet_name() -> str:
    return os.getenv("POBA_PALLET", "Poba")

def _call_submit() -> str:
    return os.getenv("POBA_CALL_SUBMIT", "submit_proposal")

def _call_finalize() -> str:
    return os.getenv("POBA_CALL_FINALIZE", "finalize_slot")

def _param_matches() -> str:
    # Runtime param name for the matches vector
    # (your runtime currently uses "matches"; older drafts used "matches_in")
    return os.getenv("POBA_PARAM_MATCHES", "matches")

# ---------------------------------------------------------
# Helpers: 16-byte UUIDs as hex strings (32 hex characters)
# ---------------------------------------------------------

Hex32 = Annotated[str, Field(min_length=32, max_length=32, pattern=r"^[0-9a-fA-F]{32}$")]

def uuid_to_16_hex(u: UUID) -> str:
    """Return 16-byte UUID as 32-char lowercase hex."""
    return u.hex

def hex16_to_u8_array_16(s: str) -> List[int]:
    """Convert 32-hex string to [u8;16] for SCALE."""
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
    """Connect to WS with sane defaults and clear errors."""
    url = _ws_url()
    preset = _type_registry_preset()
    try:
        # auto_reconnect=True מייצב לך את החיבור
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
    """
    Prefer SURI (SUBSTRATE_SIGNER_URI, e.g. //Alice), fallback to mnemonic (SUBSTRATE_SIGNER_MNEMONIC).
    """
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

# ---------------------------------------------------------
# Schemas: JSON-safe fields (no bytes)
# ---------------------------------------------------------

class MarketRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    uuid_16: Hex32
    from_lat: int
    from_lon: int
    to_lat: int
    to_lon: int
    max_price_cents: int
    kind: int  # 0=package, 1=passenger

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
    types_mask: int  # bitmask (1=package, 2=passenger ...)

class MatchItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    request_uuid: Hex32
    offer_uuid:   Hex32
    agreed_price_cents: int
    partial_score: int

class SubmitProposalBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slot: Annotated[int, Field(ge=0)]
    total_score: int
    matches: List[MatchItem]

class FinalizeBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slot: Annotated[int, Field(ge=0)]

class BuildBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slot: Annotated[int, Field(ge=0)]
    requests: List[MarketRequest]
    offers: List[MarketOffer]

class BuildResp(BaseModel):
    slot: int
    total_score: int
    matches: List[MatchItem]

# ---------------------------------------
# Open market endpoints (node worker pulls)
# ---------------------------------------

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
        out.append(MarketRequest(
            uuid_16=uuid_to_16_hex(r.id),
            from_lat=int(r.from_lat or 0),
            from_lon=int(r.from_lon or 0),
            to_lat=int(r.to_lat or 0),
            to_lon=int(r.to_lon or 0),
            max_price_cents=int(round((r.max_price or 0) * 100)),
            kind=0 if r.type == "package" else 1,
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
            types_mask=1,  # 1=package; extend later
        ))
    return out

@router.get("/offers-active", response_model=List[MarketOffer])
def offers_active(db: Session = Depends(get_db)) -> List[MarketOffer]:
    return _offers_active_impl(db)

@router.get("/offers-open", response_model=List[MarketOffer])
def offers_open_compat(db: Session = Depends(get_db)) -> List[MarketOffer]:
    return _offers_active_impl(db)

# ----------------------------------------------------
# Submit proposal / Finalize slot (extrinsics via RPC)
# ----------------------------------------------------

@router.post("/submit-proposal")
def submit_proposal(body: SubmitProposalBody):
    """
    Submit the best proposal to the PoBA pallet.
    Runtime expects a bounded vector of: ([u8;16], [u8;16], u32, i64)
    Param name for matches is configurable via POBA_PARAM_MATCHES (default: matches).
    """
    substrate = get_substrate()
    signer = get_signer()

    # Fail-fast: WS health
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
    try:
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
                "total_score": int(body.total_score),
                matches_param_name: match_tuples,
            },
        )

        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer)
        receipt = substrate.submit_extrinsic(extrinsic, wait_for_inclusion=True)

        try:
            if hasattr(receipt, "is_success") and not receipt.is_success:
                raise HTTPException(status_code=502, detail={
                    "code": "dispatch_failed",
                    "hint": "Check pallet event / error data; ensure types and param names match runtime",
                    "receipt": str(getattr(receipt, "error_message", "")),
                })
        except Exception:
            pass

        log.info("submit_proposal included: hash=%s", receipt.extrinsic_hash)
        return {"ok": True, "hash": receipt.extrinsic_hash}
    except SubstrateRequestException as e:
        log.exception("submit_proposal RPC failed: %s", e)
        raise HTTPException(status_code=502, detail={
            "code": "rpc_submit_failed",
            "error": str(e),
            "hint": "Verify pallet/call/param names and signer funds",
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
    """Ask the PoBA pallet to finalize the given slot."""
    substrate = get_substrate()
    signer = get_signer()

    try:
        call = substrate.compose_call(
            call_module=_pallet_name(),
            call_function=_call_finalize(),
            call_params={"slot": int(body.slot)},
        )
        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer)

        # נסיון ראשון: להמתין להכללה
        try:
            receipt = substrate.submit_extrinsic(
                extrinsic,
                wait_for_inclusion=True,
            )
        except JSONDecodeError as e:
            # טיפוסית נובע ממסגרת WS לא-JSON; ננסה שוב קצר
            log.warning("finalize_slot inclusion wait failed with JSONDecodeError: %s; retrying once", e)
            time.sleep(0.2)
            try:
                receipt = substrate.submit_extrinsic(
                    extrinsic,
                    wait_for_inclusion=True,
                )
            except JSONDecodeError as e2:
                # fallback: בלי המתנה להכללה - מחזירים hash (האקסטרינזיק נשלח)
                log.warning("finalize_slot: second inclusion wait failed (%s); sending without wait", e2)
                receipt = substrate.submit_extrinsic(
                    extrinsic,
                    wait_for_inclusion=False,
                )

        # בדיקת סטטוס אם יש
        try:
            if hasattr(receipt, "is_success") and not receipt.is_success:
                raise HTTPException(status_code=502, detail={
                    "code": "dispatch_failed",
                    "hint": "Check pallet finalize error",
                    "receipt": str(getattr(receipt, "error_message", "")),
                })
        except Exception:
            pass

        log.info("finalize_slot included/sent: hash=%s", receipt.extrinsic_hash)
        return {"ok": True, "hash": receipt.extrinsic_hash}
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

# -------------------------------------------
# Build proposal (IDA*) – computed in backend
# -------------------------------------------

@router.post("/build-proposal", response_model=BuildResp)
def build_proposal(body: BuildBody) -> BuildResp:
    """
    Compute an assignment with IDA*.
    We MAXIMIZE total_score and therefore keep scores POSITIVE (bigger = better).
    Constraints:
      - Offer min_price <= Request max_price (when request has a max)
      - Each offer is used at most once
      - We match up to n = min(|R|, |O|)
    Score model (tunable):
      penalty = ALPHA * (dist_km_start + dist_km_end) + BETA * (price_cents)
      score   = max(0, BASE - penalty)     # POSITIVE
      cost    = BASE - score  (for IDA*; or simply = penalty)
    """

    R = body.requests
    O = body.offers
    n = min(len(R), len(O))

    # Precompute pair cost/score
    INF = 10**9
    cost = [[INF] * len(O) for _ in range(len(R))]
    partial_score = [[0] * len(O) for _ in range(len(R))]
    price_agreed = [[0] * len(O) for _ in range(len(R))]

    # --- scoring params (you can tune them later) ---
    BASE  = 1_000_000       # large base to keep scores positive
    ALPHA = 1_000           # penalty per km (1 km = 1000 points)
    BETA  = 1               # penalty per cent (1 cent = 1 point)

    def haversine_km(lat1_e6: int, lon1_e6: int, lat2_e6: int, lon2_e6: int) -> float:
        to_rad = lambda x: (x / 1_000_000.0) * math.pi / 180.0
        lat1, lon1, lat2, lon2 = map(to_rad, [lat1_e6, lon1_e6, lat2_e6, lon2_e6])
        dlat, dlon = lat2 - lat1, lon2 - lon1
        a = (math.sin(dlat / 2) ** 2) + math.cos(lat1) * math.cos(lat2) * (math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(a**0.5, (1 - a)**0.5)
        return 6371.0 * c

    for i, r in enumerate(R):
        for j, o in enumerate(O):
            # price feasibility check (0 means "no max")
            if r.max_price_cents and o.min_price_cents > r.max_price_cents:
                continue
            d_start = haversine_km(r.from_lat, r.from_lon, o.from_lat, o.from_lon)
            d_end   = haversine_km(r.to_lat,   r.to_lon,   o.to_lat,   o.to_lon)
            p_cents = max(int(o.min_price_cents), 100)

            penalty = int(ALPHA * (d_start + d_end) + BETA * p_cents)
            sc = max(0, BASE - penalty)  # POSITIVE score (bigger = better)

            partial_score[i][j] = int(sc)
            price_agreed[i][j]  = p_cents
            cost[i][j]          = BASE - sc  # equivalent to 'penalty'

    # --- IDA* state space: (i, used_mask, g) ---
    from typing import Tuple as Tup, Iterable as _Iterable

    def is_goal(state: Tup[int, int, int]) -> bool:
        i, used_mask, g = state
        return i == n

    def h(state: Tup[int, int, int]) -> float:
        return 0.0  # admissible lower bound; can be improved

    def expand(state: Tup[int, int, int]) -> _Iterable[Tup[Tup[int, int, int], float]]:
        i, used_mask, g = state
        if i >= n:
            return []
        succ = []
        for j in range(len(O)):
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

    # Greedy-consistent replay (with h=0 admissible)
    i, used_mask, acc = 0, 0, 0
    while i < n:
        chosen = None
        for j in range(len(O)):
            if (used_mask >> j) & 1:
                continue
            c_ij = cost[i][j]
            if c_ij >= INF:
                continue
            if acc + c_ij <= best_cost:
                chosen = j
                break
        if chosen is None:
            break
        matches.append(MatchItem(
            request_uuid=R[i].uuid_16,
            offer_uuid=O[chosen].uuid_16,
            agreed_price_cents=int(price_agreed[i][chosen]),
            partial_score=int(partial_score[i][chosen]),
        ))
        total_score += int(partial_score[i][chosen])  # POSITIVE sum
        used_mask |= (1 << chosen)
        acc += int(cost[i][chosen])
        i += 1

    log.info("build_proposal: slot=%s total_score=%s matches=%s",
             body.slot, total_score, len(matches))
    return BuildResp(slot=body.slot, total_score=total_score, matches=matches)

# ---------------------------
# Debug / Diagnostics helpers
# ---------------------------

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
