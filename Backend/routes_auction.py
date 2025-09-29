# app/auction/routes_auction.py
# Clearing via IDA* using courier_offers (supply). Sends push notifications on matches.

from __future__ import annotations
from fastapi import APIRouter, Depends
from typing import List, Dict, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import and_, text
from datetime import datetime, timezone

# get_db – תואם מבנה פרויקט שונה
try:
    from .Database.db import get_db
    from .models import Users, Requests, Assignments, CourierOffers
except Exception:
    from Backend.Database.db import get_db  # type: ignore
    from Backend.models import Users, Requests, Assignments, CourierOffers  # type: ignore

# IDA* clearing engine
try:
    from .auction.clearing_engine import Ask, DriverState, Point, Weights, solve_clearing_ida
except Exception:
    from app.auction.clearing_engine import Ask, DriverState, Point, Weights, solve_clearing_ida  # type: ignore

# Push service
try:
    from .services.push import send_expo_async, fire_and_forget
except Exception:
    from Backend.services.push import send_expo_async, fire_and_forget  # type: ignore

router = APIRouter(prefix="/auction", tags=["auction"])


def run_clearing_tick(
    db: Session,
    avg_kmh: float = 40.0,
    w_dist: float = 1.0,
    w_eta: float = 0.2,
    w_price: float = 1.0,
    w_rating_penalty: float = 0.3,
    mark_offer_assigned: bool = True,
):
    # 1) Load open requests with coordinates
    req_rows: List[Requests] = (
        db.query(Requests)
        .filter(
            and_(
                Requests.status == "open",
                Requests.from_lat.isnot(None),
                Requests.from_lon.isnot(None),
                Requests.to_lat.isnot(None),
                Requests.to_lon.isnot(None),
            )
        )
        .order_by(Requests.created_at.asc())
        .all()
    )
    if not req_rows:
        return {"cleared": False, "reason": "no open requests with coordinates"}

    # Map to Ask DTOs
    asks: List[Ask] = []
    for r in req_rows:
        asks.append(Ask(
            id=str(r.id),
            pickup=Point(float(r.from_lat), float(r.from_lon)),
            dropoff=Point(float(r.to_lat), float(r.to_lon)),
            size=float((r.passengers or 1)),
            max_price=float(r.max_price or 0),
            window_start=None if r.window_start is None else r.window_start.timestamp()/60.0,
            window_end=None if r.window_end is None else r.window_end.timestamp()/60.0,
        ))

    # 2) Load active courier offers
    offer_rows: List[CourierOffers] = (
        db.query(CourierOffers)
        .filter(CourierOffers.status == "active")
        .order_by(CourierOffers.created_at.asc())
        .all()
    )
    if not offer_rows:
        return {"cleared": False, "reason": "no active courier offers"}

    # 3) Load driver users for those offers
    driver_ids = sorted({o.driver_user_id for o in offer_rows})
    drivers_rows: List[Users] = (
        db.query(Users)
        .filter(and_(Users.id.in_(driver_ids), Users.role == "driver"))
        .all()
    )
    if not drivers_rows:
        return {"cleared": False, "reason": "no valid drivers for offers"}

    # Driver anchor: use first request pickup (אין לנו מיקום חי של נהגים)
    anchor_point = Point(float(req_rows[0].from_lat), float(req_rows[0].from_lon))

    # Build driver states (capacity=1 ל-MVP)
    drivers: List[DriverState] = []
    driver_index_by_id: Dict[str, int] = {}
    for j, u in enumerate(drivers_rows):
        drivers.append(DriverState(
            driver_id=str(u.id),
            pos=anchor_point,
            time_min=0.0,
            capacity_left=1.0,
            rating=float(u.rating or 0.0),
        ))
        driver_index_by_id[str(u.id)] = j

    # Group offers by driver
    offers_by_driver: Dict[str, List[CourierOffers]] = {}
    for off in offer_rows:
        offers_by_driver.setdefault(str(off.driver_user_id), []).append(off)

    def type_matches(req_type: str, offer_types: list[str]) -> bool:
        return (req_type in (offer_types or []))

    def windows_overlap(req_start, req_end, off_start, off_end) -> bool:
        if req_start is None or req_end is None:
            return True
        return (off_start <= req_end) and (off_end >= req_start)

    allowed_drivers_per_ask: List[List[int]] = [[] for _ in asks]
    price_per_pair: Dict[Tuple[int, int], float] = {}
    price_lb_per_ask: List[float] = [float("inf")] * len(asks)

    for req_idx, r in enumerate(req_rows):
        req_type = str(r.type)
        req_ws = asks[req_idx].window_start
        req_we = asks[req_idx].window_end

        for drv_user_id, drv_idx in driver_index_by_id.items():
            matching_prices: list[float] = []
            for off in offers_by_driver.get(drv_user_id, []):
                off_ws = off.window_start.timestamp()/60.0
                off_we = off.window_end.timestamp()/60.0

                if not type_matches(req_type, off.types):
                    continue
                if not windows_overlap(req_ws, req_we, off_ws, off_we):
                    continue
                if r.max_price is not None and off.min_price is not None:
                    if float(off.min_price) > float(r.max_price):
                        continue

                matching_prices.append(float(off.min_price))

            if matching_prices:
                best = min(matching_prices)
                allowed_drivers_per_ask[req_idx].append(drv_idx)
                price_per_pair[(req_idx, drv_idx)] = best
                if best < price_lb_per_ask[req_idx]:
                    price_lb_per_ask[req_idx] = best

    # prune asks with no candidates
    keep_mask = [len(allowed_drivers_per_ask[i]) > 0 for i in range(len(asks))]
    if not any(keep_mask):
        return {"cleared": False, "reason": "no feasible ask-offer pairs (type/time/budget filters)"}

    old_to_new = {}
    asks_pruned: List[Ask] = []
    allowed_pruned: List[List[int]] = []
    price_lb_pruned: List[float] = []
    for i, keep in enumerate(keep_mask):
        if keep:
            new_i = len(asks_pruned)
            old_to_new[i] = new_i
            asks_pruned.append(asks[i])
            allowed_pruned.append(allowed_drivers_per_ask[i])
            price_lb_pruned.append(price_lb_per_ask[i])

    price_per_pair_pruned: Dict[Tuple[int, int], float] = {}
    for (old_i, j), p in price_per_pair.items():
        if old_i in old_to_new:
            price_per_pair_pruned[(old_to_new[old_i], j)] = p

    weights = Weights(
        w_dist=w_dist,
        w_eta=w_eta,
        w_price=w_price,
        w_rating_penalty=w_rating_penalty,
    )

    plan, total_penalty, dbg = solve_clearing_ida(
        asks=asks_pruned,
        initial_drivers=drivers,
        avg_kmh=avg_kmh,
        weights=weights,
        rating_max=5.0,
        allowed_drivers_per_ask=allowed_pruned,
        bid_amounts=price_per_pair_pruned,     # כאן "bid" = offer.min_price
        price_lb_per_ask=price_lb_pruned,
    )
    if not plan:
        return {"cleared": False, "reason": "no optimal plan found", "debug": dbg}

    # Persist
    pruned_to_row = {new_i: req_rows[old_i] for old_i, new_i in old_to_new.items()}
    results = []
    for (new_i, drv_j) in plan:
        req_row = pruned_to_row[new_i]
        drv_user = drivers_rows[drv_j]

        db.add(Assignments(
            request_id=req_row.id,
            driver_user_id=drv_user.id,
            status="created",
            assigned_at=datetime.now(timezone.utc),
        ))

        req_row.status = "assigned"

        # Optionally mark cheapest matching offer as assigned
        if mark_offer_assigned:
            m_offers = [
                off for off in offers_by_driver[str(drv_user.id)]
                if str(req_row.type) in (off.types or [])
                and (req_row.window_start is None or req_row.window_end is None
                     or (off.window_start <= req_row.window_end and off.window_end >= req_row.window_start))
                and (req_row.max_price is None or off.min_price <= req_row.max_price)
            ]
            if m_offers:
                m_offers.sort(key=lambda o: float(o.min_price))
                m_offers[0].status = "assigned"

        results.append({
            "request_id": str(req_row.id),
            "driver_user_id": str(drv_user.id),
        })

    db.commit()

    # Push notifications (owner + driver of each match)
    for m in results:
        req_id = m["request_id"]; drv_id = m["driver_user_id"]
        owner_row = db.execute(
            text("SELECT owner_user_id FROM requests WHERE id = :rid"),
            {"rid": req_id}
        ).fetchone()
        owner_id = str(owner_row[0]) if owner_row else None

        rows = db.execute(
            text("SELECT id::text, expo_push_token FROM users WHERE id = ANY(:ids)"),
            {"ids": [owner_id, drv_id]}
        ).mappings().all()
        tokens = {r["id"]: r["expo_push_token"] for r in rows if r["expo_push_token"]}

        print("[AUCTION] tokens loaded:", tokens)

        if owner_id and owner_id in tokens:
            fire_and_forget(send_expo_async(
                tokens[owner_id],
                "נמצאה לך התאמה 🚗",
                "יש נהג שמתאים לבקשה שלך. פתחי את האפליקציה לאישור.",
                {"screen": "Assignment", "request_id": req_id},
                sound="default",
                channel_id="default",
            ))
        if drv_id in tokens:
            fire_and_forget(send_expo_async(
                tokens[drv_id],
                "התאמה חדשה עבורך ✅",
                "יש נסיעה שמתאימה להצעה שלך. פתח כדי לקבל/לדחות.",
                {"screen": "Assignment", "request_id": req_id, "driver_user_id": drv_id},
                sound="default",
                channel_id="default",
            ))

    return {
        "cleared": True,
        "matches": results,
        "objective": {"total_weighted_penalty": total_penalty},
        "debug": dbg,
    }

@router.post("/clear")
def clear_market_endpoint(
    avg_kmh: float = 40.0,
    w_dist: float = 1.0,
    w_eta: float = 0.2,
    w_price: float = 1.0,
    w_rating_penalty: float = 0.3,
    mark_offer_assigned: bool = True,
    db: Session = Depends(get_db),
):
    return run_clearing_tick(
        db=db,
        avg_kmh=avg_kmh,
        w_dist=w_dist,
        w_eta=w_eta,
        w_price=w_price,
        w_rating_penalty=w_rating_penalty,
        mark_offer_assigned=mark_offer_assigned,
    )