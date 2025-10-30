from __future__ import annotations

from typing import Optional, List, Literal, Any
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .Database.db import get_db
from Backend.auth_dep import get_current_user
from .services.geocoding import geocode_address

router = APIRouter(prefix="", tags=["offers"])

# ---------- Helpers ----------

def _get_user_id(user: Any) -> str:

    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if isinstance(user, dict):
        uid = user.get("id") or user.get("user_id")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid user payload (no id)")
        return str(uid)
    uid = getattr(user, "id", None)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user payload (no id)")
    return str(uid)

# ---------- Schemas ----------

class OfferCreate(BaseModel):
    from_address: str
    to_address: Optional[str] = None
    window_start: datetime
    window_end: datetime
    types: List[Literal["passenger", "package"]]
    min_price: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)
    notes: Optional[str] = None

class OfferRow(BaseModel):
    id: str
    driver_user_id: str
    from_address: str
    to_address: Optional[str] = None
    window_start: datetime
    window_end: datetime
    min_price: str
    types: List[str]
    notes: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

# ---------- POST /offers (create) ----------

@router.post("/offers", status_code=status.HTTP_201_CREATED)
async def create_offer(
    payload: OfferCreate,
    db: Session = Depends(get_db),
    user: Any = Depends(get_current_user),
):
    user_id = _get_user_id(user)

    # Validate window
    if payload.window_end <= payload.window_start:
        raise HTTPException(400, "window_end must be after window_start")

    # Server-side geocoding
    src = geocode_address(payload.from_address)
    if src is None:
        raise HTTPException(400, "Could not geocode from_address")
    from_lat, from_lon = src

    to_lat, to_lon = (None, None)
    if payload.to_address:
        dst = geocode_address(payload.to_address)
        if dst:
            to_lat, to_lon = dst

    params = {
        "driver_user_id": user_id,
        "from_address": payload.from_address,
        "from_lat": from_lat,
        "from_lon": from_lon,
        "to_address": payload.to_address,
        "to_lat": to_lat,
        "to_lon": to_lon,
        "window_start": payload.window_start,
        "window_end": payload.window_end,
        "min_price": str(payload.min_price),
        "types": payload.types,
        "notes": payload.notes,
        "status": "active",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }

    sql = text("""
        INSERT INTO courier_offers (
            driver_user_id,
            from_address, from_lat, from_lon,
            to_address,   to_lat,   to_lon,
            window_start, window_end,
            min_price, types, notes, status,
            created_at, updated_at
        ) VALUES (
            :driver_user_id,
            :from_address, :from_lat, :from_lon,
            :to_address,   :to_lat,   :to_lon,
            :window_start, :window_end,
            :min_price, :types, :notes, :status,
            :created_at, :updated_at
        )
        RETURNING id, status, created_at
    """)

    try:
        res = db.execute(sql, params)
        row = res.mappings().first()
        db.commit()
    except Exception as e:
        print("[/offers] insert error:", repr(e))
        raise HTTPException(status_code=400, detail=str(e))

    if not row:
        raise HTTPException(status_code=500, detail="Insert failed (no row)")

    return {"id": str(row["id"]), "status": row["status"], "created_at": row["created_at"]}

# ---------- GET /offers (list mine) ----------

@router.get("/offers", response_model=List[OfferRow])
async def list_my_offers(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: Any = Depends(get_current_user),
):
    """
    מחזיר את ההצעות של הנהג המחובר (לפי JWT).
    תואם לקריאה של האפליקציה: GET /offers?status=active&limit=...&offset=...
    """
    user_id = _get_user_id(user)

    base_sql = """
        SELECT
            id::text,
            driver_user_id::text,
            from_address, to_address,
            window_start, window_end,
            min_price::text,
            types,
            notes,
            status,
            created_at, updated_at
        FROM courier_offers
        WHERE driver_user_id = :uid
    """
    if status:
        base_sql += " AND status = :status"
    base_sql += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

    params = {"uid": user_id, "limit": limit, "offset": offset}
    if status:
        params["status"] = status

    res = db.execute(text(base_sql), params)
    rows = [dict(r._mapping) for r in res]
    return rows

# ---------- POST /offers/{offer_id}/defer_push ----------

@router.post("/offers/{offer_id}/defer_push")
async def defer_push_for_offer(
    offer_id: str,
    seconds: int = Query(60, ge=0, le=600),
    db: Session = Depends(get_db),
    user: Any = Depends(get_current_user),
):
    """
    שומר עיכוב פוש עבור ההצעה הזו: courier_offers.push_defer_until = now + seconds.
    נשתמש בזה כדי *לא* לשלוח פוש לנהג בזמן שהוא על מסך ההמתנה.
    """
    uid = _get_user_id(user)

    # ודא שההצעה שייכת לנהג המחובר
    sel = text("SELECT driver_user_id FROM courier_offers WHERE id = :oid")
    try:
        row = db.execute(sel, {"oid": offer_id}).mappings().first()
    except Exception as e:
        print("[/offers/defer_push] select error:", repr(e))
        raise HTTPException(400, "failed to load offer")

    if not row:
        raise HTTPException(404, "offer not found")
    if str(row["driver_user_id"]) != uid:
        raise HTTPException(403, "not your offer")

    defer_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    upd = text("UPDATE courier_offers SET push_defer_until = :ts WHERE id = :oid")

    try:
        db.execute(upd, {"ts": defer_until, "oid": offer_id})
        db.commit()
    except Exception as e:
        print("[/offers/defer_push] update error:", repr(e))
        raise HTTPException(
            500,
            "DB missing column courier_offers.push_defer_until. Add it and retry."
        )

    return {"ok": True, "push_defer_until": defer_until.isoformat()}

# ---------- GET /offers/{offer_id}/match_status ----------

@router.get("/offers/{offer_id}/match_status")
async def offer_match_status(
    offer_id: str,
    db: Session = Depends(get_db),
    user: Any = Depends(get_current_user),
):
    """
    Returns a status for THIS offer only.
    Priority:
      1) assignment with assignments.offer_id = :offer_id AND active status
      2) (fallback) driver's latest active assignment where assigned_at >= offer.created_at
         (to avoid returning stale matches from days ago)
      3) pending
    """
    # 0) auth
    uid = None
    if isinstance(user, dict):
        uid = user.get("id") or user.get("user_id")
    else:
        uid = getattr(user, "id", None)
    if not uid:
        return {"status": "none"}
    uid = str(uid)

    # 1) load offer (ownership + created_at + status)
    off = db.execute(
        text("""
            SELECT driver_user_id::text AS driver_user_id,
                   created_at,
                   status
            FROM courier_offers
            WHERE id = :oid
        """),
        {"oid": offer_id},
    ).mappings().first()

    if not off or off["driver_user_id"] != uid:
        return {"status": "none"}

    # 2) exact-by-offer first
    active_statuses_sql = "('created','picked_up','in_transit')"
    exact = db.execute(
        text(f"""
            SELECT id AS assignment_id, request_id
            FROM assignments
            WHERE offer_id = :oid
              AND status IN {active_statuses_sql}
            ORDER BY assigned_at DESC
            LIMIT 1
        """),
        {"oid": offer_id},
    ).mappings().first()

    if exact:
        return {
            "status": "matched",
            "assignment_id": str(exact["assignment_id"]),
            "request_id": str(exact["request_id"]),
        }

    # 3) fallback: latest active for this driver, but only AFTER the offer was created
    created_at = off["created_at"]
    recent = db.execute(
        text(f"""
            SELECT id AS assignment_id, request_id
            FROM assignments
            WHERE driver_user_id = :uid
              AND status IN {active_statuses_sql}
              AND assigned_at >= :created_at
            ORDER BY assigned_at DESC
            LIMIT 1
        """),
        {"uid": uid, "created_at": created_at},
    ).mappings().first()

    if recent:
        return {
            "status": "matched",
            "assignment_id": str(recent["assignment_id"]),
            "request_id": str(recent["request_id"]),
        }

    return {"status": "pending"}