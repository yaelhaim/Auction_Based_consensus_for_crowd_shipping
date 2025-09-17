# FastAPI routes for "Courier" (driver) dashboard using SQL text().
# Endpoints:
#   GET  /courier/metrics
#   GET  /courier/jobs?status=available|active|delivered&limit=50&offset=0
#   POST /courier/jobs/{job_id}/accept
#   POST /courier/jobs/{job_id}/start
#   POST /courier/jobs/{job_id}/delivered
#
# Business rules:
# - available: requests.status='open' AND no assignment exists AND request not owned by me
# - active:    my assignments with status IN ('created','picked_up','in_transit')
# - delivered: my assignments with status='completed'

from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Literal
from sqlalchemy.orm import Session
from sqlalchemy import text

from .Database.db import get_db
from .auth_dep import get_current_user

router = APIRouter(prefix="/courier", tags=["courier"])

def _iso(dt):
    return dt.isoformat() if dt else None

# ------------------------------ Metrics -------------------------------------

@router.get("/metrics")
def courier_metrics(
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    # available
    q_available = text("""
        SELECT COUNT(*) AS c
        FROM requests r
        WHERE r.status = 'open'
          AND r.owner_user_id <> :uid
          AND NOT EXISTS (
            SELECT 1 FROM assignments a
            WHERE a.request_id = r.id
          )
    """)
    available = db.execute(q_available, {"uid": me["id"]}).scalar() or 0

    # active (explicit IN, no ANY)
    q_active = text("""
        SELECT COUNT(*) AS c
        FROM assignments a
        JOIN requests r ON r.id = a.request_id
        WHERE a.driver_user_id = :uid
          AND a.status IN ('created','picked_up','in_transit')
    """)
    active = db.execute(q_active, {"uid": me["id"]}).scalar() or 0

    # delivered
    q_delivered = text("""
        SELECT COUNT(*) AS c
        FROM assignments a
        JOIN requests r ON r.id = a.request_id
        WHERE a.driver_user_id = :uid
          AND a.status = 'completed'
    """)
    delivered = db.execute(q_delivered, {"uid": me["id"]}).scalar() or 0

    return {
        "available_count": int(available),
        "active_count": int(active),
        "delivered_count": int(delivered),
    }

# ------------------------------- List ---------------------------------------

@router.get("/jobs")
def courier_jobs(
    status: Literal["available","active","delivered"] = Query("available"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    if status == "available":
        q = text("""
            SELECT
              r.id::text AS id,
              r.type::text AS type,
              r.status::text AS status,
              r.from_address,
              r.to_address,
              r.window_start,
              r.window_end,
              r.notes,
              r.created_at
            FROM requests r
            WHERE r.status = 'open'
              AND r.owner_user_id <> :uid
              AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.request_id = r.id)
            ORDER BY r.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        params = {"uid": me["id"], "limit": limit, "offset": offset}

    elif status == "active":
        q = text("""
            SELECT
              r.id::text AS id,
              r.type::text AS type,
              r.status::text AS status,
              r.from_address,
              r.to_address,
              r.window_start,
              r.window_end,
              r.notes,
              r.created_at
            FROM assignments a
            JOIN requests r ON r.id = a.request_id
            WHERE a.driver_user_id = :uid
              AND a.status IN ('created','picked_up','in_transit')
            ORDER BY a.assigned_at DESC NULLS LAST, r.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        params = {"uid": me["id"], "limit": limit, "offset": offset}

    else:  # delivered
        q = text("""
            SELECT
              r.id::text AS id,
              r.type::text AS type,
              r.status::text AS status,
              r.from_address,
              r.to_address,
              r.window_start,
              r.window_end,
              r.notes,
              r.created_at
            FROM assignments a
            JOIN requests r ON r.id = a.request_id
            WHERE a.driver_user_id = :uid
              AND a.status = 'completed'
            ORDER BY a.completed_at DESC NULLS LAST, r.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        params = {"uid": me["id"], "limit": limit, "offset": offset}

    rows = db.execute(q, params).mappings().all()

    # distance_km / suggested_pay not in your schema yet -> return None
    return [
        {
            "id": r["id"],
            "type": r["type"],
            "status": r["status"],
            "from_address": r["from_address"],
            "to_address": r["to_address"],
            "window_start": _iso(r["window_start"]),
            "window_end": _iso(r["window_end"]),
            "distance_km": None,
            "suggested_pay": None,
            "notes": r["notes"],
            "created_at": _iso(r["created_at"]),
        }
        for r in rows
    ]

# ------------------------------ Actions -------------------------------------

@router.post("/jobs/{job_id}/accept")
def courier_accept_job(
    job_id: str,
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    # Ensure the request exists, open, not mine, no assignment yet
    chk = text("""
        SELECT r.id
        FROM requests r
        WHERE r.id = :rid
          AND r.status = 'open'
          AND r.owner_user_id <> :uid
          AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.request_id = r.id)
        LIMIT 1
    """)
    ok = db.execute(chk, {"rid": job_id, "uid": me["id"]}).first()
    if not ok:
        raise HTTPException(status_code=409, detail="Request not available")

    # Create assignment
    ins = text("""
        INSERT INTO assignments (
          id, request_id, driver_user_id, assigned_at, status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), :rid, :uid, NOW(), 'created', NOW(), NOW()
        )
        RETURNING id
    """)
    arow = db.execute(ins, {"rid": job_id, "uid": me["id"]}).mappings().first()

    # Move request to 'assigned'
    upd = text("""
        UPDATE requests
        SET status = 'assigned', updated_at = NOW()
        WHERE id = :rid
    """)
    db.execute(upd, {"rid": job_id})

    db.commit()
    return {"ok": True, "job_id": job_id, "assignment_id": arow["id"]}

@router.post("/jobs/{job_id}/start")
def courier_start_job(
    job_id: str,
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    sel = text("""
        SELECT a.id
        FROM assignments a
        WHERE a.request_id = :rid AND a.driver_user_id = :uid
          AND a.status IN ('created','picked_up','in_transit')
        LIMIT 1
    """)
    a = db.execute(sel, {"rid": job_id, "uid": me["id"]}).first()
    if not a:
        raise HTTPException(status_code=404, detail="Job not found or not yours")

    upd_a = text("""
        UPDATE assignments
        SET status = 'in_transit',
            in_transit_at = COALESCE(in_transit_at, NOW()),
            updated_at = NOW()
        WHERE request_id = :rid AND driver_user_id = :uid
    """)
    db.execute(upd_a, {"rid": job_id, "uid": me["id"]})

    upd_r = text("""
        UPDATE requests
        SET status = 'in_transit', updated_at = NOW()
        WHERE id = :rid
    """)
    db.execute(upd_r, {"rid": job_id})

    db.commit()
    return {"ok": True, "job_id": job_id}

@router.post("/jobs/{job_id}/delivered")
def courier_delivered_job(
    job_id: str,
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    sel = text("""
        SELECT a.id
        FROM assignments a
        WHERE a.request_id = :rid AND a.driver_user_id = :uid
          AND a.status IN ('created','picked_up','in_transit')
        LIMIT 1
    """)
    a = db.execute(sel, {"rid": job_id, "uid": me["id"]}).first()
    if not a:
        raise HTTPException(status_code=404, detail="Job not found or not yours")

    upd_a = text("""
        UPDATE assignments
        SET status = 'completed',
            completed_at = NOW(),
            updated_at = NOW()
        WHERE request_id = :rid AND driver_user_id = :uid
    """)
    db.execute(upd_a, {"rid": job_id, "uid": me["id"]})

    upd_r = text("""
        UPDATE requests
        SET status = 'completed', updated_at = NOW()
        WHERE id = :rid
    """)
    db.execute(upd_r, {"rid": job_id})

    db.commit()
    return {"ok": True, "job_id": job_id}
