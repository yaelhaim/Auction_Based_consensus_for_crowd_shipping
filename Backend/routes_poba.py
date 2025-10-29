# app/routes_poba.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List
from uuid import UUID
import os
from sqlalchemy.orm import Session

from .Database.db import get_db
from .models import Request, CourierOffer

from substrateinterface import SubstrateInterface, Keypair

# ← נוסיף יבוא ל-IDA*
from app.auction.ida_star_core import ida_star

router = APIRouter(prefix="/poba", tags=["poba"])

# ---------- Schemas ----------
class MarketRequest(BaseModel):
    uuid_16: bytes = Field(..., min_length=16, max_length=16)
    from_lat: int
    from_lon: int
    to_lat: int
    to_lon: int
    max_price_cents: int
    kind: int  # 0=package,1=passenger

class MarketOffer(BaseModel):
    uuid_16: bytes = Field(..., min_length=16, max_length=16)
    min_price_cents: int
    from_lat: int
    from_lon: int
    to_lat: int
    to_lon: int
    window_start: int
    window_end: int
    types_mask: int

class MatchItem(BaseModel):
    request_uuid: bytes = Field(..., min_length=16, max_length=16)
    offer_uuid: bytes = Field(..., min_length=16, max_length=16)
    agreed_price_cents: int
    partial_score: int

class SubmitProposalBody(BaseModel):
    slot: int
    total_score: int
    matches: List[MatchItem]

# ---------- Helpers ----------
def uuid_to_16(u: UUID) -> bytes:
    return u.bytes

def get_substrate() -> SubstrateInterface:
    url = os.getenv("SUBSTRATE_WS_URL", "ws://127.0.0.1:9944")
    return SubstrateInterface(url=url, ss58_format=42, type_registry_preset="substrate-node-template")

def get_signer() -> Keypair:
    mnemonic = os.getenv("SUBSTRATE_SIGNER_MNEMONIC")
    if not mnemonic:
        raise RuntimeError("SUBSTRATE_SIGNER_MNEMONIC is not set")
    return Keypair.create_from_mnemonic(mnemonic)

# ---------- Open market (as before) ----------
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

@router.get("/offers-open", response_model=List[MarketOffer])
def offers_open(db: Session = Depends(get_db)) -> List[MarketOffer]:
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
            types_mask=1,
        ))
    return out

# ---------- Submit / Finalize (as before) ----------
@router.post("/submit-proposal")
def submit_proposal(body: SubmitProposalBody):
    try:
        substrate = get_substrate()
        signer = get_signer()
        call = substrate.compose_call(
            call_module="Poba",
            call_function="submit_proposal",
            call_params={
                "slot": body.slot,
                "total_score": body.total_score,
                "matches": [
                    {
                        "request_uuid": m.request_uuid,
                        "offer_uuid": m.offer_uuid,
                        "agreed_price_cents": m.agreed_price_cents,
                        "partial_score": m.partial_score,
                    } for m in body.matches
                ],
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

# ---------- Build proposal (IDA*) ----------
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
    Compute best proposal with IDA*:
    We MAXIMIZE a score, so we MINIMIZE cost = -score.
    Constraint: offer.min_price_cents <= request.max_price_cents
    Each offer can be used at most once. We match up to min(|R|,|O|).
    """
    # --- utilities
    import math
    def haversine_km(lat1_e6, lon1_e6, lat2_e6, lon2_e6):
        to_rad = lambda x: (x / 1_000_000.0) * math.pi / 180.0
        lat1, lon1, lat2, lon2 = map(to_rad, [lat1_e6, lon1_e6, lat2_e6, lon2_e6])
        dlat, dlon = lat2 - lat1, lon2 - lon1
        a = (math.sin(dlat / 2) ** 2) + math.cos(lat1) * math.cos(lat2) * (math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(a**0.5, (1 - a)**0.5)
        return 6371.0 * c

    R = body.requests
    O = body.offers
    n = min(len(R), len(O))

    # Precompute partial scores (and costs) for all pairs
    # score_ij = -(distance_start + distance_end) - price/100
    # cost_ij  = -score_ij  (so smaller is better)
    INF = 10**9
    cost = [[INF]*len(O) for _ in range(len(R))]
    partial_score = [[0]*len(O) for _ in range(len(R))]
    price_agreed = [[0]*len(O) for _ in range(len(R))]

    for i, r in enumerate(R):
        for j, o in enumerate(O):
            # price constraint: offer must not exceed request's max price (if max=0 → treat as unlimited)
            if r.max_price_cents and o.min_price_cents > r.max_price_cents:
                continue
            d_start = haversine_km(r.from_lat, r.from_lon, o.from_lat, o.from_lon)
            d_end   = haversine_km(r.to_lat,   r.to_lon,   o.to_lat,   o.to_lon)
            p_cents = max(o.min_price_cents, 100)
            sc = -(d_start + d_end) - (p_cents / 100.0)
            partial_score[i][j] = int(math.floor(sc))
            price_agreed[i][j] = p_cents
            cost[i][j] = -partial_score[i][j]  # minimize cost

    # --- IDA* state model ---
    # state = (i, used_mask, acc_cost)
    # i: next request index to assign (0..n)
    # used_mask: bitmask of offers used
    # acc_cost: total accumulated cost so far
    from typing import Tuple, Iterable

    def is_goal(state) -> bool:
        i, used_mask, acc = state
        return i == n  # matched n pairs

    def h(state) -> float:
        # admissible heuristic: 0 (safe, but less pruning)
        # you can improve by summing best-possible next k costs, but 0 is fine for MVP sizes
        return 0.0

    def expand(state) -> Iterable[Tuple[Tuple[int,int,int], float]]:
        i, used_mask, acc = state
        if i >= n:
            return []
        succ = []
        # try match request i with any unused offer j
        for j in range(len(O)):
            if (used_mask >> j) & 1:
                continue
            c_ij = cost[i][j]
            if c_ij >= INF:
                continue  # infeasible
            next_state = (i+1, used_mask | (1<<j), acc + c_ij)
            step_cost = c_ij  # IDA* interprets this as added "g"
            succ.append((next_state, step_cost))
        # also allow skipping if fewer pairs than n (optional: disable if must assign exactly n)
        # (here נעדיף בדיוק n התאמות ולכן לא נוסיף מעבר "skip")
        return succ

    def key(state):
        # minimal key for pruning: (i, used_mask)
        return (state[0], state[1])

    # start state
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
        # no assignment found
        return BuildResp(slot=body.slot, total_score=0, matches=[])

    # reconstruct one optimal assignment by replaying greedy along expand order:
    # (since ida_star returns only the final state, we replay deterministically)
    i, used_mask, acc = 0, 0, 0
    while i < n:
        chosen = None
        # choose the successor that can still reach best_cost (consistent replay)
        for j in range(len(O)):
            if (used_mask >> j) & 1:
                continue
            c_ij = cost[i][j]
            if c_ij >= INF:
                continue
            # optimistic: assume h(next)=0; check if taking j can still hit best_cost
            if acc + c_ij <= best_cost:
                chosen = j
                break
        if chosen is None:
            break
        # append match
        matches.append(MatchItem(
            request_uuid=R[i].uuid_16,
            offer_uuid=O[chosen].uuid_16,
            agreed_price_cents=price_agreed[i][chosen],
            partial_score=partial_score[i][chosen],
        ))
        total_score += partial_score[i][chosen]
        used_mask |= (1 << chosen)
        acc += cost[i][chosen]
        i += 1

    return BuildResp(slot=body.slot, total_score=total_score, matches=matches)
