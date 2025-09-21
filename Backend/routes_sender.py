# routes_sender.py
# Sender dashboard API: metrics and request listing for the logged-in user.
# Relies on JWT auth (auth_dep.get_current_user) and your 'requests' table schema.

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Dict, Any
from .Database.db import get_db
from .auth_dep import get_current_user  # returns dict of current user (incl. id)

router = APIRouter(prefix="/sender", tags=["sender"])

# ---- CONFIG: which request.type values are considered "sender" requests ----
# Adjust if your schema uses different names (e.g. 'delivery', 'parcel' etc.)
SENDER_TYPES: List[str] = ["package"]

def _status_bucket_to_sql_list(bucket: str) -> List[str]:
    """
    Map UI buckets to underlying request.status values.
      - open      -> ['open']
      - active    -> ['assigned', 'in_transit']
      - delivered -> ['completed']
    """
    bucket = (bucket or "").lower()
    if bucket == "open":
        return ["open"]
    if bucket == "active":
        return ["assigned", "in_transit"]
    if bucket == "delivered":
        return ["completed"]
    raise HTTPException(status_code=400, detail="Invalid status bucket")


@router.get("/metrics")
def sender_metrics(
    db: Session = Depends(get_db),
    me: Dict[str, Any] = Depends(get_current_user),
):
    """
    Return counts for the sender's requests grouped into UI buckets.
    Only counts requests that belong to the SENDER_TYPES.
    """
    uid = me["id"]

    # Build placeholders for IN (...) on type
    type_placeholders = ", ".join(f":t{i}" for i in range(len(SENDER_TYPES)))
    type_params = {f"t{i}": t for i, t in enumerate(SENDER_TYPES)}

    rows = db.execute(
        text(f"""
            SELECT status, COUNT(*) AS cnt
            FROM requests
            WHERE owner_user_id = :uid
              AND type IN ({type_placeholders})
            GROUP BY status
        """),
        {"uid": uid, **type_params},
    ).mappings().all()

    by_status = {r["status"]: int(r["cnt"]) for r in rows}

    open_count = by_status.get("open", 0)
    active_count = by_status.get("assigned", 0) + by_status.get("in_transit", 0)
    delivered_count = by_status.get("completed", 0)
    cancelled_count = by_status.get("cancelled", 0)

    return {
        "open_count": open_count,
        "active_count": active_count,
        "delivered_count": delivered_count,
        "cancelled_count": cancelled_count,  # spare for future UI
    }


@router.get("/requests")
def list_requests(
    status: str = Query("open", description="open | active | delivered"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me: Dict[str, Any] = Depends(get_current_user),
):
    """
    List the current user's *sender* requests filtered by a UI bucket.
    Returns only rows with type in SENDER_TYPES.
    """
    uid = me["id"]
    statuses = _status_bucket_to_sql_list(status)

    # Build placeholders for IN (...) on status and type
    status_placeholders = ", ".join(f":s{i}" for i in range(len(statuses)))
    type_placeholders = ", ".join(f":t{i}" for i in range(len(SENDER_TYPES)))

    params = {
        "uid": uid,
        "limit": limit,
        "offset": offset,
        **{f"s{i}": s for i, s in enumerate(statuses)},
        **{f"t{i}": t for i, t in enumerate(SENDER_TYPES)},
    }

    rows = db.execute(
        text(f"""
            SELECT
                id,
                owner_user_id,
                type,
                from_address,
                from_lat,
                from_lon,
                to_address,
                to_lat,
                to_lon,
                passengers,
                notes,
                window_start,
                window_end,
                status,
                created_at,
                updated_at
            FROM requests
            WHERE owner_user_id = :uid
              AND type IN ({type_placeholders})
              AND status IN ({status_placeholders})
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    return [dict(r) for r in rows]
