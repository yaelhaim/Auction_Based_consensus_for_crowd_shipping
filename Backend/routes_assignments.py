# Backend/routes_assignments.py
# Read-only endpoints for assignment details. Always return tz-aware datetimes.

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .Database.db import get_db
from .models import Assignment, User, Request

# Optional live locations model
try:
    from .models import CourierLocation
    HAS_LOCATIONS = True
except Exception:
    HAS_LOCATIONS = False
    CourierLocation = None  # type: ignore

# -------------------------- Schemas --------------------------

class DriverBrief(BaseModel):
    id: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    vehicle_type: Optional[str] = None
    avatar_url: Optional[str] = None

class RequesterBrief(BaseModel):
    id: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    avatar_url: Optional[str] = None

class LastLocation(BaseModel):
    lat: float
    lng: float
    updated_at: datetime

class RequestBrief(BaseModel):
    id: str
    type: str  # "package" | "ride" | "passenger"
    from_address: Optional[str] = None
    to_address: Optional[str] = None
    passengers: Optional[int] = None
    pickup_contact_name: Optional[str] = None
    pickup_contact_phone: Optional[str] = None
    window_start: Optional[datetime] = None
    window_end: Optional[datetime] = None
    notes: Optional[str] = None

class AssignmentDetailOut(BaseModel):
    assignment_id: str
    request_id: str
    status: str
    # New: payment status + agreed price
    payment_status: Optional[str] = None
    agreed_price_cents: Optional[int] = None

    assigned_at: datetime
    picked_up_at: Optional[datetime] = None
    in_transit_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    onchain_tx_hash: Optional[str] = None

    driver: DriverBrief
    requester: Optional[RequesterBrief] = None
    last_location: Optional[LastLocation] = None
    request: RequestBrief

# ------------------------------ Router ------------------------------

router = APIRouter(prefix="/assignments", tags=["assignments"])
ACTIVE_ASSIGNMENT_STATUSES = {"created", "picked_up", "in_transit"}


def _normalize_request_type(v: Optional[str]) -> str:
    s = (v or "").strip().lower()
    if s in {"package", "ride", "passenger"}:
        return s
    if s == "rider":
        return "ride"
    return "package"


def _ensure_tz(dt: Optional[datetime]) -> Optional[datetime]:
    """Return tz-aware datetime (UTC) or None."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _pack_assignment_detail(db: Session, assignment: Assignment) -> AssignmentDetailOut:
    # ---- Driver
    driver = db.query(User).filter(User.id == assignment.driver_user_id).first()
    if not driver:
        raise HTTPException(status_code=500, detail="Driver user missing")
    full_name = f"{getattr(driver,'first_name','') or ''} {getattr(driver,'last_name','') or ''}".strip() or None
    try:
        rating_val = float(driver.rating) if driver.rating is not None else None
    except Exception:
        rating_val = None
    driver_out = DriverBrief(
        id=str(driver.id),
        full_name=full_name,
        phone=getattr(driver, "phone", None),
        rating=rating_val,
        vehicle_type=getattr(driver, "vehicle_type", None),
        avatar_url=getattr(driver, "avatar_url", None),
    )

    # ---- Request
    req = db.query(Request).filter(Request.id == assignment.request_id).first()
    if not req:
        raise HTTPException(status_code=500, detail="Request row missing")

    request_out = RequestBrief(
        id=str(req.id),
        type=_normalize_request_type(getattr(req, "type", None)),
        from_address=getattr(req, "from_address", None),
        to_address=getattr(req, "to_address", None),
        passengers=getattr(req, "passengers", None),
        pickup_contact_name=getattr(req, "pickup_contact_name", None),
        pickup_contact_phone=getattr(req, "pickup_contact_phone", None),
        window_start=_ensure_tz(getattr(req, "window_start", None)),
        window_end=_ensure_tz(getattr(req, "window_end", None)),
        notes=getattr(req, "notes", None),
    )

    # ---- Request owner
    requester_out: Optional[RequesterBrief] = None
    owner_id = getattr(req, "owner_user_id", None)
    if owner_id:
        requester = db.query(User).filter(User.id == owner_id).first()
        if requester:
            rn = f"{getattr(requester,'first_name','') or ''} {getattr(requester,'last_name','') or ''}".strip() or None
            try:
                r_rating = float(requester.rating) if requester.rating is not None else None
            except Exception:
                r_rating = None
            requester_out = RequesterBrief(
                id=str(requester.id),
                full_name=rn,
                phone=getattr(requester, "phone", None),
                rating=r_rating,
                avatar_url=getattr(requester, "avatar_url", None),
            )

    # ---- Last known location (optional)
    last_loc = None
    if HAS_LOCATIONS:
        loc = (
            db.query(CourierLocation)
            .filter(CourierLocation.user_id == driver.id)
            .order_by(CourierLocation.updated_at.desc())
            .first()
        )
        if loc:
            try:
                last_loc = LastLocation(
                    lat=float(loc.lat),
                    lng=float(loc.lng),
                    updated_at=_ensure_tz(loc.updated_at) or datetime.now(timezone.utc),
                )
            except Exception:
                last_loc = None

    # ---- Assigned time with tz fallback (heals old naive rows)
    assigned_at = assignment.assigned_at or getattr(assignment, "created_at", None) or getattr(assignment, "updated_at", None)
    if not assigned_at:
        assigned_at = datetime.now(timezone.utc)
    if assigned_at.tzinfo is None:
        assigned_at = assigned_at.replace(tzinfo=timezone.utc)

    # Normalize payment status
    ps = getattr(assignment, "payment_status", None)
    ps_str = str(ps) if ps is not None else None

    # Normalize price cents
    price_cents: Optional[int]
    try:
        price_cents = int(getattr(assignment, "agreed_price_cents", 0)) if assignment.agreed_price_cents is not None else None
    except Exception:
        price_cents = None

    return AssignmentDetailOut(
        assignment_id=str(assignment.id),
        request_id=str(assignment.request_id),
        status=str(assignment.status),
        payment_status=ps_str,
        agreed_price_cents=price_cents,
        assigned_at=assigned_at,
        picked_up_at=_ensure_tz(getattr(assignment, "picked_up_at", None)),
        in_transit_at=_ensure_tz(getattr(assignment, "in_transit_at", None)),
        completed_at=_ensure_tz(getattr(assignment, "completed_at", None)),
        failed_at=_ensure_tz(getattr(assignment, "failed_at", None)),
        cancelled_at=_ensure_tz(getattr(assignment, "cancelled_at", None)),
        onchain_tx_hash=getattr(assignment, "onchain_tx_hash", None),
        driver=driver_out,
        requester=requester_out,
        last_location=last_loc,
        request=request_out,
    )

# ----------------------------- Endpoints -----------------------------

@router.get("/by-request/{request_id}", response_model=AssignmentDetailOut)
def get_assignment_by_request(
    request_id: str,
    db: Session = Depends(get_db),
    only_active: bool = Query(True, description="Return only active assignments"),
):
    q = db.query(Assignment).filter(Assignment.request_id == request_id)
    if only_active:
        q = q.filter(Assignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES))
    assignment = q.order_by(Assignment.assigned_at.desc()).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="No active assignment found for this request")
    return _pack_assignment_detail(db, assignment)


@router.get("/{assignment_id}", response_model=AssignmentDetailOut)
def get_assignment_by_id(assignment_id: str, db: Session = Depends(get_db)):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return _pack_assignment_detail(db, assignment)

# -------- Debug: recent --------

class RecentMatchItem(BaseModel):
    assignment_id: str
    request_id: str
    driver_user_id: str
    assigned_at: datetime
    status: str
    # New (optional) for debugging:
    payment_status: Optional[str] = None
    agreed_price_cents: Optional[int] = None

    request_type: Optional[str] = None
    from_address: Optional[str] = None
    to_address: Optional[str] = None
    requester_name: Optional[str] = None
    driver_name: Optional[str] = None

@router.get("/recent", response_model=List[RecentMatchItem])
def list_recent_matches(limit: int = 50, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    rows = (
        db.query(Assignment, Request, User)
        .join(Request, Request.id == Assignment.request_id)
        .join(User, User.id == Assignment.driver_user_id)
        .order_by(Assignment.assigned_at.desc())
        .limit(limit)
        .all()
    )
    out: list[RecentMatchItem] = []
    for a, req, driver in rows:
        requester_name = None
        if getattr(req, "owner_user_id", None):
            rq = db.query(User).filter(User.id == req.owner_user_id).first()
            if rq:
                requester_name = f"{getattr(rq,'first_name','') or ''} {getattr(rq,'last_name','') or ''}".strip() or None
        driver_name = f"{getattr(driver,'first_name','') or ''} {getattr(driver,'last_name','') or ''}".strip() or None

        ps = getattr(a, "payment_status", None)
        ps_str = str(ps) if ps is not None else None
        try:
            price_cents = int(getattr(a, "agreed_price_cents", 0)) if a.agreed_price_cents is not None else None
        except Exception:
            price_cents = None

        out.append(
            RecentMatchItem(
                assignment_id=str(a.id),
                request_id=str(a.request_id),
                driver_user_id=str(a.driver_user_id),
                assigned_at=_ensure_tz(a.assigned_at) or datetime.now(timezone.utc),
                status=str(a.status),
                payment_status=ps_str,
                agreed_price_cents=price_cents,
                request_type=_normalize_request_type(getattr(req, "type", None)),
                from_address=getattr(req, "from_address", None),
                to_address=getattr(req, "to_address", None),
                requester_name=requester_name,
                driver_name=driver_name,
            )
        )
    return out
