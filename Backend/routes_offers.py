# Backend/routes_offers.py
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Any
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import text

from .Database.db import get_db
from Backend.auth_dep import get_current_user
from .services.geocoding import geocode_address

router = APIRouter(prefix="", tags=["offers"])

# ---------- Helpers ----------

def _get_user_id(user: Any) -> str:
    """
    get_current_user יכול להחזיר dict או מודל ORM.
    הפונקציה הזו מחלצת id בצורה בטוחה.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if isinstance(user, dict):
        uid = user.get("id") or user.get("user_id")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid user payload (no id)")
        return str(uid)
    # אובייקט עם מאפיין id
    uid = getattr(user, "id", None)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user payload (no id)")
    return str(uid)

# ---------- Schemas ----------

class OfferCreate(BaseModel):
    # שמים לב: לא מקבלים driver_user_id מהקליינט – נלקח מה-JWT
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
    db = Depends(get_db),
    user = Depends(get_current_user),
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
        "min_price": str(payload.min_price),  # NUMERIC כטקסט
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
        if hasattr(db, "execute"):
            result = db.execute(sql, params)
            row = result.mappings().first()
            if hasattr(db, "commit"):
                db.commit()
        else:
            res = await db.execute(sql, params)
            row = res.mappings().first()
            await db.commit()
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
    db = Depends(get_db),
    user = Depends(get_current_user),
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

    if hasattr(db, "execute"):
        res = db.execute(text(base_sql), params)
        rows = [dict(r._mapping) for r in res]  # to plain dicts
    else:
        res = await db.execute(text(base_sql), params)
        rows = [dict(r._mapping) for r in res]

    return rows
