# routes_rider.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Dict, Any
from .Database.db import get_db
from .auth_dep import get_current_user

router = APIRouter(prefix="/rider", tags=["rider"])

RIDER_TYPES: List[str] = ["ride"]  # הוסיפי כאן עוד ערכים אם יש, למשל "carpool"

def _status_bucket_to_sql_list(bucket: str) -> List[str]:
    bucket = (bucket or "").lower()
    if bucket == "open":
        return ["open"]
    if bucket == "active":
        # במודל שלך 'matched' + 'in_transit' נחשבים פעילים
        return ["matched", "in_transit"]
    if bucket == "completed" or bucket == "delivered":
        return ["completed"]
    raise HTTPException(status_code=400, detail="Invalid status bucket")

@router.get("/metrics")
def rider_metrics(
    db: Session = Depends(get_db),
    me: Dict[str, Any] = Depends(get_current_user),
):
    uid = me["id"]
    tph = ", ".join(f":t{i}" for i in range(len(RIDER_TYPES)))
    tparams = {f"t{i}": t for i, t in enumerate(RIDER_TYPES)}

    rows = db.execute(
        text(f"""
            SELECT status, COUNT(*) AS cnt
            FROM requests
            WHERE owner_user_id = :uid
              AND type IN ({tph})
            GROUP BY status
        """),
        {"uid": uid, **tparams},
    ).mappings().all()

    by = {r["status"]: int(r["cnt"]) for r in rows}
    open_count = by.get("open", 0)
    active_count = by.get("matched", 0) + by.get("in_transit", 0)
    completed_count = by.get("completed", 0)

    return {
      "open_count": open_count,
      "active_count": active_count,
      "completed_count": completed_count,
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

    sph = ", ".join(f":s{i}" for i in range(len(statuses)))
    tph = ", ".join(f":t{i}" for i in range(len(RIDER_TYPES)))
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
              AND type IN ({tph})
              AND status IN ({sph})
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    return [dict(r) for r in rows]
