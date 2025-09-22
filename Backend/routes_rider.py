# routes_rider.py
# Rider dashboard API + create: requests of type 'ride' for the logged-in user.
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

from .Database.db import get_db
from .auth_dep import get_current_user  # returns dict with 'id'

router = APIRouter(prefix="/rider", tags=["rider"])

RIDER_TYPES: List[str] = ["ride"]  # add more if needed

def _status_bucket_to_sql_list(bucket: str) -> List[str]:
    b = (bucket or "").lower()
    if b == "open":
        return ["open"]
    if b == "active":
        return ["assigned", "in_transit"]  # not 'matched'
    if b in ("completed", "delivered"):
        return ["completed"]
    raise HTTPException(status_code=400, detail="Invalid status bucket")

@router.get("/metrics")
def rider_metrics(
    db: Session = Depends(get_db),
    me: Dict[str, Any] = Depends(get_current_user),
):
    uid = me["id"]
    type_cast_list = ", ".join([f"CAST(:t{i} AS request_type)" for i in range(len(RIDER_TYPES))])
    type_params = {f"t{i}": t for i, t in enumerate(RIDER_TYPES)}

    rows = db.execute(
        text(f"""
            SELECT status, COUNT(*) AS cnt
            FROM requests
            WHERE owner_user_id = :uid
              AND type IN ({type_cast_list})
            GROUP BY status
        """),
        {"uid": uid, **type_params},
    ).mappings().all()

    by = {r["status"]: int(r["cnt"]) for r in rows}
    return {
        "open_count": by.get("open", 0),
        "active_count": by.get("assigned", 0) + by.get("in_transit", 0),
        "completed_count": by.get("completed", 0),
        "cancelled_count": by.get("cancelled", 0),
    }

@router.get("/requests")
def list_rider_requests(
    status: str = Query("open", description="open | active | completed"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me: Dict[str, Any] = Depends(get_current_user),
):
    uid = me["id"]
    statuses = _status_bucket_to_sql_list(status)

    status_cast_list = ", ".join([f"CAST(:s{i} AS request_status)" for i in range(len(statuses))])
    type_cast_list = ", ".join([f"CAST(:t{i} AS request_type)" for i in range(len(RIDER_TYPES))])

    params = {
        "uid": uid,
        "limit": limit,
        "offset": offset,
        **{f"s{i}": s for i, s in enumerate(statuses)},
        **{f"t{i}": t for i, t in enumerate(RIDER_TYPES)},
    }

    rows = db.execute(
        text(f"""
            SELECT
              id,
              owner_user_id,
              type,
              from_address, from_lat, from_lon,
              to_address,   to_lat,   to_lon,
              passengers,
              notes,
              window_start,
              window_end,
              status,
              created_at,
              updated_at
            FROM requests
            WHERE owner_user_id = :uid
              AND type IN ({type_cast_list})
              AND status IN ({status_cast_list})
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    return [dict(r) for r in rows]

# ---------- CREATE RIDE REQUEST ----------

class RiderRequestCreate(BaseModel):
    from_address: str
    to_address: str
    window_start: datetime
    window_end: datetime
    passengers: int = Field(ge=1)
    notes: str | None = None
    max_price: float | None = None  # אם אין עמודה—אפשר להסיר

@router.post("/requests")
def create_rider_request(
    payload: RiderRequestCreate,
    db: Session = Depends(get_db),
    me: Dict[str, Any] = Depends(get_current_user),
):
    uid = me["id"]

    row = db.execute(
        text("""
            INSERT INTO requests (
              owner_user_id,
              type,
              status,
              from_address, to_address,
              window_start, window_end,
              passengers,
              notes,
              max_price,
              created_at, updated_at
            ) VALUES (
              :uid,
              CAST(:type AS request_type),
              CAST(:status AS request_status),
              :from_address, :to_address,
              :window_start, :window_end,
              :passengers,
              :notes,
              :max_price,
              NOW(), NOW()
            )
            RETURNING
              id, owner_user_id, type, status,
              from_address, to_address,
              window_start, window_end,
              passengers, notes, max_price,
              created_at, updated_at
        """),
        {
          "uid": uid,
          "type": "ride",
          "status": "open",
          "from_address": payload.from_address,
          "to_address": payload.to_address,
          "window_start": payload.window_start,
          "window_end": payload.window_end,
          "passengers": payload.passengers,
          "notes": payload.notes,
          "max_price": payload.max_price,
        },
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=500, detail="failed_to_create_ride_request")

    db.commit()
    return dict(row)
