# Backend/routes_assignments.py
from __future__ import annotations
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .Database.db import get_db
from .models import Assignment, User, Request  # includes Request for owner info

# Optional live locations:
try:
    from .models import CourierLocation
    HAS_LOCATIONS = True
except Exception:
    HAS_LOCATIONS = False
    CourierLocation = None  # type: ignore

# ---------- Schemas ----------

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

class AssignmentDetailOut(BaseModel):
    assignment_id: str
    request_id: str
    status: str
    assigned_at: datetime
    picked_up_at: Optional[datetime] = None
    in_transit_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    onchain_tx_hash: Optional[str] = None

    driver: DriverBrief
    requester: Optional[RequesterBrief] = None  # request owner (sender/rider)
    last_location: Optional[LastLocation] = None
    request: RequestBrief  # request fields (from/to/type)

router = APIRouter(prefix="/assignments", tags=["assignments"])

@router.get("/by-request/{request_id}", response_model=AssignmentDetailOut)
def get_assignment_by_request(request_id: str, db: Session = Depends(get_db)):
    assignment = (
        db.query(Assignment)
        .filter(Assignment.request_id == request_id)
        .order_by(Assignment.assigned_at.desc())
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No assignment found for this request")

    driver = db.query(User).filter(User.id == assignment.driver_user_id).first()
    if not driver:
        raise HTTPException(status_code=500, detail="Driver user missing")

    first_name = getattr(driver, "first_name", "") or ""
    last_name = getattr(driver, "last_name", "") or ""
    full_name = (first_name + " " + last_name).strip() or None
    vehicle_type = getattr(driver, "vehicle_type", None)
    avatar_url = getattr(driver, "avatar_url", None)
    try:
        rating_val = float(driver.rating) if driver.rating is not None else None
    except Exception:
        rating_val = None

    driver_out = DriverBrief(
        id=str(driver.id),
        full_name=full_name,
        phone=getattr(driver, "phone", None),
        rating=rating_val,
        vehicle_type=vehicle_type,
        avatar_url=avatar_url,
    )

    req = db.query(Request).filter(Request.id == assignment.request_id).first()
    if not req:
        raise HTTPException(status_code=500, detail="Request row missing")

    request_out = RequestBrief(
        id=str(req.id),
        type=str(getattr(req, "type", "package")),
        from_address=getattr(req, "from_address", None),
        to_address=getattr(req, "to_address", None),
        passengers=getattr(req, "passengers", None),
        pickup_contact_name=getattr(req, "pickup_contact_name", None),
        pickup_contact_phone=getattr(req, "pickup_contact_phone", None),
    )

    requester_out: Optional[RequesterBrief] = None
    owner_id = getattr(req, "owner_user_id", None)
    if owner_id:
        requester = db.query(User).filter(User.id == owner_id).first()
        if requester:
            r_first = getattr(requester, "first_name", "") or ""
            r_last = getattr(requester, "last_name", "") or ""
            try:
                r_rating = float(requester.rating) if requester.rating is not None else None
            except Exception:
                r_rating = None
            requester_out = RequesterBrief(
                id=str(requester.id),
                full_name=(r_first + " " + r_last).strip() or None,
                phone=getattr(requester, "phone", None),
                rating=r_rating,
                avatar_url=getattr(requester, "avatar_url", None),
            )

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
                    updated_at=loc.updated_at,
                )
            except Exception:
                last_loc = None

    return AssignmentDetailOut(
        assignment_id=str(assignment.id),
        request_id=str(assignment.request_id),
        status=str(assignment.status),
        assigned_at=assignment.assigned_at,
        picked_up_at=assignment.picked_up_at,
        in_transit_at=assignment.in_transit_at,
        completed_at=assignment.completed_at,
        failed_at=assignment.failed_at,
        cancelled_at=assignment.cancelled_at,
        onchain_tx_hash=assignment.onchain_tx_hash,
        driver=driver_out,
        requester=requester_out,
        last_location=last_loc,
        request=request_out,
    )

# -------- NEW: Recent matches endpoint (admin/debug) --------
class RecentMatchItem(BaseModel):
    assignment_id: str
    request_id: str
    driver_user_id: str
    assigned_at: datetime
    status: str
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
                requester_name = f"{getattr(rq, 'first_name', '')} {getattr(rq, 'last_name', '')}".strip() or None
        driver_name = f"{getattr(driver, 'first_name', '')} {getattr(driver, 'last_name', '')}".strip() or None
        out.append(
            RecentMatchItem(
                assignment_id=str(a.id),
                request_id=str(a.request_id),
                driver_user_id=str(a.driver_user_id),
                assigned_at=a.assigned_at,
                status=str(a.status),
                request_type=str(getattr(req, "type", None) or None),
                from_address=getattr(req, "from_address", None),
                to_address=getattr(req, "to_address", None),
                requester_name=requester_name,
                driver_name=driver_name,
            )
        )
    return out
