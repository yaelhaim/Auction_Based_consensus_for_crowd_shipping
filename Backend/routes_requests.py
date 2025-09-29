# Backend/routes_requests.py
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Literal, Optional
from datetime import datetime
from decimal import Decimal

# db session
from .Database.db import get_db

# current user dep (כבר קיים אצלך)
from .auth_dep import get_current_user

# server-side geocoding
from .services.geocoding import geocode_address

router = APIRouter(prefix="", tags=["requests"])

# ---------- Pydantic v2 input model ----------
class RequestCreate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    type: Literal["package", "passenger"] = "package"
    from_address: str = Field(..., min_length=3, max_length=255)
    to_address: str = Field(..., min_length=3, max_length=255)
    window_start: datetime
    window_end: datetime

    notes: Optional[str] = None
    max_price: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)
    pickup_contact_name: Optional[str] = Field(None, max_length=100)
    pickup_contact_phone: Optional[str] = Field(None, max_length=32)

    # Optional client-provided coords; server will fill if missing
    from_lat: Optional[float] = None
    from_lon: Optional[float] = None
    to_lat: Optional[float] = None
    to_lon: Optional[float] = None
    passengers: Optional[int] = None

    @field_validator("window_end")
    @classmethod
    def _validate_window(cls, v, info):
        start = info.data.get("window_start")
        if start and v <= start:
            raise ValueError("window_end must be after window_start")
        return v

# ---------- Helper ----------
def _user_id(u) -> str:
    """Supports both dict and object user representations."""
    if hasattr(u, "id"):
        return getattr(u, "id")
    if isinstance(u, dict):
        return u.get("id") or u.get("user_id")
    return None

# ---------- Routes ----------
@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_request(
    payload: RequestCreate,
    db = Depends(get_db),
    current_user = Depends(get_current_user),
):
    uid = _user_id(current_user)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized (no user id)")

    # If coords missing -> geocode on server
    from_lat = payload.from_lat
    from_lon = payload.from_lon
    to_lat = payload.to_lat
    to_lon = payload.to_lon

    if from_lat is None or from_lon is None:
        src = geocode_address(payload.from_address)
        if src is None:
            raise HTTPException(400, detail="Could not geocode from_address")
        from_lat, from_lon = src

    if to_lat is None or to_lon is None:
        dst = geocode_address(payload.to_address)
        if dst is None:
            raise HTTPException(400, detail="Could not geocode to_address")
        to_lat, to_lon = dst

    params = {
        "owner_user_id": uid,
        "type": payload.type,
        "from_address": payload.from_address,
        "from_lat": from_lat,
        "from_lon": from_lon,
        "to_address": payload.to_address,
        "to_lat": to_lat,
        "to_lon": to_lon,
        "passengers": payload.passengers,
        "notes": payload.notes,
        "window_start": payload.window_start,
        "window_end": payload.window_end,
        "status": "open",
        "max_price": str(payload.max_price),  # psycopg-friendly
        "pickup_contact_name": payload.pickup_contact_name,
        "pickup_contact_phone": payload.pickup_contact_phone,
    }

    from sqlalchemy import text
    sql = text("""
        INSERT INTO requests (
            owner_user_id, type,
            from_address, from_lat, from_lon,
            to_address, to_lat, to_lon,
            passengers, notes,
            window_start, window_end, status,
            max_price, pickup_contact_name, pickup_contact_phone
        ) VALUES (
            :owner_user_id, :type,
            :from_address, :from_lat, :from_lon,
            :to_address, :to_lat, :to_lon,
            :passengers, :notes,
            :window_start, :window_end, :status,
            :max_price, :pickup_contact_name, :pickup_contact_phone
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
        print("[/requests] insert error:", repr(e))
        raise HTTPException(status_code=400, detail=str(e))

    if not row:
        raise HTTPException(status_code=500, detail="Insert failed (no row)")

    return {"id": str(row["id"]), "status": row["status"], "created_at": row["created_at"]}

@router.get("/healthz")
def healthz():
    return {"ok": True}
