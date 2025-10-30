# app/routes_poba.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Iterable, Tuple
from uuid import UUID
import os
from sqlalchemy.orm import Session

# --- DB plumbing (adapt the imports to your project structure) ---
from .Database.db import get_db
from .models import Request, CourierOffer

# --- Substrate RPC client ---
from substrateinterface import SubstrateInterface, Keypair

# --- IDA* core (domain-agnostic implementation you shared) ---
from .auction.ida_star_core import ida_star

router = APIRouter(prefix="/poba", tags=["poba"])

# ------------------------------------------------------------------
# Schemas exchanged with the node worker and between backend↔frontend
# ------------------------------------------------------------------

class MarketRequest(BaseModel):
    uuid_16: bytes = Field(..., min_length=16, max_length=16)
    from_lat: int
    from_lon: int
    to_lat: int
    to_lon: int
    max_price_cents: int
    kind: int  # 0=package, 1=passenger

class MarketOffer(BaseModel):
    uuid_16: bytes = Field(..., min_length=16, max_length=16)
    min_price_cents: int
    from_lat: int
    from_lon: int
    to_lat: int
    to_lon: int
    window_start: int
    window_end: int
    types_mask: int  # bitmask (1=package, 2=passenger ...)

class MatchItem(BaseModel):
    request_uuid: bytes = Field(..., min_length=16, max_length=16)
    offer_uuid:   bytes = Field(..., min_length=16, max_length=16)
    agreed_price_cents: int
    partial_score: int

class SubmitProposalBody(BaseModel):
    slot: int
    total_score: int
    matches: List[MatchItem]

# ----------------
# Helper functions
# ----------------

def uuid_to_16(u: UUID) -> bytes:
    """Return the raw 16 bytes of a UUID (no dashes, fixed length 16)."""
    return u.bytes

def as_u8_array_16(b: bytes) -> List[int]:
    """
    Substrate SCALE expects fixed-size byte arrays as a sequence of u8.
    substrate-interface accepts Python lists of ints (0..255) for [u8; 16].
    """
    if not isinstance(b, (bytes, bytearray)) or len(b) != 16:
        raise ValueError("Expected 16-byte value")
    return list(b)

def get_substrate() -> SubstrateInterface:
    """
    Connect to your node. Configure via env var:
      SUBSTRATE_WS_URL=ws://127.0.0.1:9944
    """
    url = os.getenv("SUBSTRATE_WS_URL", "ws://127.0.0.1:9944")
    return SubstrateInterface(
        url=url,
        ss58_format=42,
        type_registry_preset="substrate-node-template",
    )

def get_signer() -> Keypair:
    """
    Key used by the backend to submit extrinsics (PoBA submit/finalize).
    Configure via env var:
      SUBSTRATE_SIGNER_MNEMONIC="..."
    """
    mnemonic = os.getenv("SUBSTRATE_SIGNER_MNEMONIC")
    if not mnemonic:
        raise RuntimeError("SUBSTRATE_SIGNER_MNEMONIC is not set")
    return Keypair.create_from_mnemonic(mnemonic)

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
            uuid_16=uuid_to_16(r.id),
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
            uuid_16=uuid_to_16(o.id),
            min_price_cents=int(round((o.min_price or 0) * 100)),
            from_lat=int(o.from_lat or 0),
            from_lon=int(o.from_lon or 0),
            to_lat=int(o.to_lat or 0),
            to_lon=int(o.to_lon or 0),
            window_start=int(o.window_start.timestamp() * 1000) if o.window_start else 0,
            window_end=int(o.window_end.timestamp() * 1000) if o.window_end else 0,
            types_mask=1,  # 1=package (extend as needed)
        ))
    return out

@router.get("/offers-active", response_model=List[MarketOffer])
def offers_active(db: Session = Depends(get_db)) -> List[MarketOffer]:
    """Primary endpoint: 'active' offers."""
    return _offers_active_impl(db)

@router.get("/offers-open", response_model=List[MarketOffer])
def offers_open_compat(db: Session = Depends(get_db)) -> List[MarketOffer]:
    """
    Backward-compat endpoint in case the node worker still calls /offers-open.
    Returns the same payload as /offers-active.
    """
    return _offers_active_impl(db)

# ----------------------------------------------------
# Submit proposal / Finalize slot (extrinsics via RPC)
# ----------------------------------------------------

@router.post("/submit-proposal")
def submit_proposal(body: SubmitProposalBody):
    """
    Submit the current best proposal to the PoBA pallet.
    IMPORTANT: The PoBA extrinsic signature (runtime) expects tuples
    ([u8;16], [u8;16], u32, i64) in a bounded vector named `matches_in`.
    """
    try:
        substrate = get_substrate()
        signer = get_signer()

        # Convert MatchItem → tuple: ([16], [16], u32, i64)
        match_tuples: List[List[int] | Tuple[List[int], List[int], int, int]] = []
        for m in body.matches:
            match_tuples.append([
                as_u8_array_16(m.request_uuid),
                as_u8_array_16(m.offer_uuid),
                int(m.agreed_price_cents),
                int(m.partial_score),
            ])

        call = substrate.compose_call(
            call_module="Poba",
            call_function="submit_proposal",
            call_params={
                "slot": body.slot,
                "total_score": body.total_score,
                "matches_in": match_tuples,  # ← must match the runtime call param name
            },
        )

        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer)
        receipt = substrate.submit_extrinsic(extrinsic, wait_for_inclusion=True)
        return {"ok": True, "hash": receipt.extrinsic_hash}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"submit_proposal failed: {e}")

class FinalizeBody(BaseModel):
    slot: int

@router.post("/finalize-slot")
def finalize_slot(body: FinalizeBody):
    """Ask the PoBA pallet to finalize the given slot (MVP: emits event)."""
    try:
        substrate = get_substrate()
        signer = get_signer()
        call = substrate.compose_call(
            call_module="Poba",
            call_function="finalize_slot",
            call_params={"slot": body.slot},
        )
        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer)
        receipt = substrate.submit_extrinsic(extrinsic, wait_for_inclusion=True)
        return {"ok": True, "hash": receipt.extrinsic_hash}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"finalize_slot failed: {e}")

# -------------------------------------------
# Build proposal (IDA*) – computed in backend
# -------------------------------------------

class BuildBody(BaseModel):
    slot: int
    requests: List[MarketRequest]
    offers: List[MarketOffer]

class BuildResp(BaseModel):
    slot: int
    total_score: int
    matches: List[MatchItem]

@router.post("/build-proposal", response_model=BuildResp)
def build_proposal(body: BuildBody) -> BuildResp:
    """
    Compute an assignment with IDA*.
    We MAXIMIZE total_score, hence we MINIMIZE cost = -score.
    Constraints:
      - Offer min_price <= Request max_price (when request has a max)
      - Each offer is used at most once
      - We match up to n = min(|R|, |O|)
    Score model (can be tuned later):
      score_ij = -(dist_start + dist_end) - (price_cents / 100)
    """
    import math

    def haversine_km(lat1_e6: int, lon1_e6: int, lat2_e6: int, lon2_e6: int) -> float:
        to_rad = lambda x: (x / 1_000_000.0) * math.pi / 180.0
        lat1, lon1, lat2, lon2 = map(to_rad, [lat1_e6, lon1_e6, lat2_e6, lon2_e6])
        dlat, dlon = lat2 - lat1, lon2 - lon1
        a = (math.sin(dlat / 2) ** 2) + math.cos(lat1) * math.cos(lat2) * (math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(a**0.5, (1 - a)**0.5)
        return 6371.0 * c

    R = body.requests
    O = body.offers
    n = min(len(R), len(O))

    # Precompute pair cost/score
    INF = 10**9
    cost = [[INF] * len(O) for _ in range(len(R))]
    partial_score = [[0] * len(O) for _ in range(len(R))]
    price_agreed = [[0] * len(O) for _ in range(len(R))]

    for i, r in enumerate(R):
        for j, o in enumerate(O):
            # price feasibility check (0 means "no max" → allow)
            if r.max_price_cents and o.min_price_cents > r.max_price_cents:
                continue
            d_start = haversine_km(r.from_lat, r.from_lon, o.from_lat, o.from_lon)
            d_end   = haversine_km(r.to_lat,   r.to_lon,   o.to_lat,   o.to_lon)
            p_cents = max(int(o.min_price_cents), 100)
            sc = -(d_start + d_end) - (p_cents / 100.0)
            partial_score[i][j] = int(math.floor(sc))
            price_agreed[i][j] = p_cents
            cost[i][j] = -partial_score[i][j]  # minimize cost

    # --- IDA* state space: (i, used_mask, g) ---
    from typing import Iterable, Tuple as Tup

    def is_goal(state: Tup[int, int, int]) -> bool:
        i, used_mask, g = state
        return i == n

    def h(state: Tup[int, int, int]) -> float:
        # Admissible but simple: 0. You can improve later by summing k best
        # remaining pair lower-bounds for pruning.
        return 0.0

    def expand(state: Tup[int, int, int]) -> Iterable[Tup[Tup[int, int, int], float]]:
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
        # For duplicate pruning: position + offer mask is enough
        return (state[0], state[1])

    start = (0, 0, 0)
    goal, best_cost = ida_star(
        start=start,
        h=h,
        expand=expand,
        is_goal=is_goal,
        key=key,
    )

    matches: List[MatchItem] = []
    total_score = 0
    if goal is None:
        return BuildResp(slot=body.slot, total_score=0, matches=[])

    # Reconstruct one optimal assignment by replaying a consistent path.
    i, used_mask, acc = 0, 0, 0
    while i < n:
        chosen = None
        for j in range(len(O)):
            if (used_mask >> j) & 1:
                continue
            c_ij = cost[i][j]
            if c_ij >= INF:
                continue
            # Greedy-consistent replay (admissible h=0 → feasible)
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
        total_score += int(partial_score[i][chosen])
        used_mask |= (1 << chosen)
        acc += int(cost[i][chosen])
        i += 1

    return BuildResp(slot=body.slot, total_score=total_score, matches=matches)
