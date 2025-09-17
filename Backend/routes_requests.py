# Backend/routes_requests.py
# Create Request (Sender) endpoint using SQLAlchemy Core (no ORM).
# Pydantic v2 compatible.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from typing import Optional, Literal
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timezone
import uuid

from .Database.db import get_db
from .auth_dep import get_current_user  # make sure this exists in your project

router = APIRouter(tags=["requests"])

# ---------- Schemas (Pydantic v2) ----------

class RequestCreate(BaseModel):
    # Use Literal instead of regex, works great with OpenAPI too
    type: Literal["package", "passenger"]

    from_address: str
    to_address: str
    window_start: datetime
    window_end: datetime
    notes: Optional[str] = None

    # New DB fields you added
    max_price: float = Field(..., gt=0)
    pickup_contact_name: Optional[str] = None
    pickup_contact_phone: Optional[str] = None

    # Optional geo
    from_lat: Optional[float] = None
    from_lon: Optional[float] = None
    to_lat: Optional[float] = None
    to_lon: Optional[float] = None

    # For ride requests (column already exists)
    passengers: Optional[int] = Field(default=None, ge=1, le=8)

    # Model-level validation (after all fields parsed)
    @model_validator(mode="after")
    def validate_request(self):
        # window_end after window_start
        if self.window_start and self.window_end and self.window_end <= self.window_start:
            raise ValueError("window_end must be after window_start")

        # If either pickup contact field provided — require both
        if (self.pickup_contact_name and not self.pickup_contact_phone) or (
            self.pickup_contact_phone and not self.pickup_contact_name
        ):
            raise ValueError("If pickup contact is provided, both name and phone are required")

        return self


class RequestOut(BaseModel):
    id: uuid.UUID
    status: str
    created_at: datetime


# ---------- Routes ----------

@router.post("/requests", response_model=RequestOut)
def create_request(
    payload: RequestCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),  # user must expose .id, .first_name, .phone (optional)
):
    now = datetime.now(timezone.utc)
    req_id = uuid.uuid4()

    # Default pickup contact to owner if none provided
    pickup_name = payload.pickup_contact_name or getattr(user, "first_name", None)
    pickup_phone = payload.pickup_contact_phone or getattr(user, "phone", None)

    try:
        q = text(
            """
            INSERT INTO requests (
              id, owner_user_id, type,
              from_address, from_lat, from_lon,
              to_address, to_lat, to_lon,
              passengers, notes,
              window_start, window_end,
              status, created_at, updated_at,
              max_price, pickup_contact_name, pickup_contact_phone
            ) VALUES (
              :id, :owner_user_id, :type,
              :from_address, :from_lat, :from_lon,
              :to_address, :to_lat, :to_lon,
              :passengers, :notes,
              :window_start, :window_end,
              'open', :created_at, :updated_at,
              :max_price, :pickup_contact_name, :pickup_contact_phone
            )
            RETURNING id, status, created_at
            """
        )
        row = db.execute(
            q,
            {
                "id": str(req_id),
                "owner_user_id": str(user.id),
                "type": payload.type,
                "from_address": payload.from_address,
                "from_lat": payload.from_lat,
                "from_lon": payload.from_lon,
                "to_address": payload.to_address,
                "to_lat": payload.to_lat,
                "to_lon": payload.to_lon,
                "passengers": payload.passengers if payload.type == "passenger" else None,
                "notes": payload.notes,
                "window_start": payload.window_start,
                "window_end": payload.window_end,
                "created_at": now,
                "updated_at": now,
                "max_price": payload.max_price,
                "pickup_contact_name": pickup_name,
                "pickup_contact_phone": pickup_phone,
            },
        ).mappings().first()
        db.commit()
        return RequestOut(**row)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create request: {e}")
