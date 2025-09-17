# FastAPI routes for "Rider" (ride seeker) dashboard using SQL text().
# Endpoints:
#   GET /rider/metrics
#   GET /rider/requests?status=open|active|completed&limit=50&offset=0

from fastapi import APIRouter, Depends, Query
from typing import Literal
from sqlalchemy.orm import Session
from sqlalchemy import text

from .Database.db import get_db
from .auth_dep import get_current_user  # same dep as in routes_users.py

router = APIRouter(prefix="/rider", tags=["rider"])

def _iso(dt):
    return dt.isoformat() if dt else None

# ------------------------------ Metrics -------------------------------------

@router.get("/metrics")
def rider_metrics(
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    """
    Counts for the rider's own 'passenger' requests.
    open_count     -> status='open'
    active_count   -> status IN ('assigned','in_transit')
    completed_count-> status='completed'
    """
    q = text("""
        SELECT
          SUM( CASE WHEN status = 'open' THEN 1 ELSE 0 END ) AS open_count,
          SUM( CASE WHEN status IN ('assigned','in_transit') THEN 1 ELSE 0 END ) AS active_count,
          SUM( CASE WHEN status = 'completed' THEN 1 ELSE 0 END ) AS completed_count
        FROM requests
        WHERE owner_user_id = :uid
          AND type = 'passenger'
    """)
    row = db.execute(q, {"uid": me["id"]}).mappings().first()
    return {
        "open_count": int(row["open_count"] or 0),
        "active_count": int(row["active_count"] or 0),
        "completed_count": int(row["completed_count"] or 0),
    }

# ------------------------------- List ---------------------------------------

@router.get("/requests")
def rider_requests(
    status: Literal["open","active","completed"] = Query("open"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    """
    List rider's 'passenger' requests by bucket using explicit IN, no ANY().
    """
    if status == "open":
        status_sql = "status = 'open'"
    elif status == "active":
        status_sql = "status IN ('assigned','in_transit')"
    else:  # "completed"
        status_sql = "status = 'completed'"

    q = text(f"""
        SELECT
          id::text AS id,
          status::text AS status,
          from_address,
          to_address,
          window_start,
          window_end,
          COALESCE(passengers, 1) AS seats,
          notes,
          created_at
        FROM requests
        WHERE owner_user_id = :uid
          AND type = 'passenger'
          AND {status_sql}
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
    """)
    rows = db.execute(q, {"uid": me["id"], "limit": limit, "offset": offset}).mappings().all()

    out = []
    for r in rows:
        # UI prefers "matched" instead of DB 'assigned'
        ui_status = "matched" if r["status"] == "assigned" else r["status"]
        out.append({
            "id": r["id"],
            "status": ui_status,
            "from_address": r["from_address"],
            "to_address": r["to_address"],
            "window_start": _iso(r["window_start"]),
            "window_end": _iso(r["window_end"]),
            "seats": int(r["seats"] or 1),
            "notes": r["notes"],
            "created_at": _iso(r["created_at"]),
        })
    return out
