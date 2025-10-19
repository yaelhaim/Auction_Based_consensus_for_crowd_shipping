# Backend/routes_requests.py
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Literal, Optional
from datetime import datetime, timedelta, timezone
from decimal import Decimal

# db session
from .Database.db import get_db

# current user dep (כבר קיים אצלך)
from .auth_dep import get_current_user

# server-side geocoding
from .services.geocoding import geocode_address

from sqlalchemy import text

router = APIRouter(prefix="", tags=["requests"])


# ---------- Pydantic v2 input model ----------
class RequestCreate(BaseModel):
  model_config = ConfigDict(from_attributes=True)

  # כולל 'ride' כדי שה-frontend יוכל לשלוח ride ישירות
  type: Literal["package", "passenger", "ride"] = "package"
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

  # --- Normalize type: 'ride' → treat as 'passenger' for matching logic (DB יכול לשמור ride/ passenger, לבחירתך) ---
  raw_type = str(payload.type)
  norm_type = "passenger" if raw_type.strip().lower() == "ride" else raw_type

  params = {
    "owner_user_id": uid,
    "type": norm_type,  # normalized for downstream logic
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

  sql = text(
    """
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
    """
  )

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

  return {
    "id": str(row["id"]),
    "status": row["status"],
    "created_at": row["created_at"],
  }


# ---------- Defer push for this request ----------
@router.post("/requests/{request_id}/defer_push")
async def defer_push_for_request(
  request_id: str,
  seconds: int = Query(60, ge=0, le=600),
  db = Depends(get_db),
  current_user = Depends(get_current_user),
):
  """
  Stores requests.push_defer_until = now + seconds (default 60).
  Push notifications for this request should be sent ONLY if now >= push_defer_until.
  """
  uid = _user_id(current_user)
  if not uid:
    raise HTTPException(status_code=401, detail="Unauthorized")

  # verify ownership
  sel = text("SELECT owner_user_id FROM requests WHERE id = :rid")
  try:
    if hasattr(db, "execute"):
      owner_row = db.execute(sel, {"rid": request_id}).mappings().first()
    else:
      res = await db.execute(sel, {"rid": request_id})
      owner_row = res.mappings().first()
  except Exception as e:
    print("[/requests/defer_push] select error:", repr(e))
    raise HTTPException(400, detail="failed to load request")

  if not owner_row:
    raise HTTPException(404, detail="request not found")
  if str(owner_row["owner_user_id"]) != str(uid):
    raise HTTPException(403, detail="not your request")

  defer_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
  upd = text("UPDATE requests SET push_defer_until = :ts WHERE id = :rid")

  try:
    if hasattr(db, "execute"):
      db.execute(upd, {"ts": defer_until, "rid": request_id})
      if hasattr(db, "commit"):
        db.commit()
    else:
      await db.execute(upd, {"ts": defer_until, "rid": request_id})
      await db.commit()
  except Exception as e:
    print("[/requests/defer_push] update error:", repr(e))
    raise HTTPException(
      500,
      detail="DB missing column requests.push_defer_until. Add it and retry.",
    )

  return {"ok": True, "push_defer_until": defer_until.isoformat()}


# ---------- Match status for waiting screen ----------
@router.get("/requests/{request_id}/match_status")
async def get_match_status(
  request_id: str,
  db = Depends(get_db),
  current_user = Depends(get_current_user),
):
  """
  Returns a simple status for a request (only to the owner):
  - {"status": "matched", "assignment_id": "...", "driver_user_id": "..."}
  - {"status": "pending"}   (request exists, no assignment yet)
  - {"status": "none"}      (no access / not found)
  """
  uid = _user_id(current_user)
  if not uid:
    return {"status": "none"}

  # verify ownership
  sel = text("SELECT owner_user_id::text, status FROM requests WHERE id = :rid")
  try:
    if hasattr(db, "execute"):
      req = db.execute(sel, {"rid": request_id}).mappings().first()
    else:
      res = await db.execute(sel, {"rid": request_id})
      req = res.mappings().first()
  except Exception as e:
    print("[/requests/match_status] select error:", repr(e))
    return {"status": "none"}

  if not req:
    return {"status": "none"}
  if str(req["owner_user_id"]) != str(uid):
    return {"status": "none"}

  # if already assigned → return latest assignment info
  if str(req["status"]) == "assigned":
    q_asg = text(
      """
      SELECT id AS assignment_id, driver_user_id::text
      FROM assignments
      WHERE request_id = :rid
      ORDER BY assigned_at DESC
      LIMIT 1
      """
    )
    try:
      if hasattr(db, "execute"):
        asg = db.execute(q_asg, {"rid": request_id}).mappings().first()
      else:
        res = await db.execute(q_asg, {"rid": request_id})
        asg = res.mappings().first()
    except Exception as e:
      print("[/requests/match_status] asg select error:", repr(e))
      return {"status": "pending"}

    payload = {"status": "matched"}
    if asg:
      payload["assignment_id"] = str(asg["assignment_id"])
      payload["driver_user_id"] = str(asg["driver_user_id"])
    return payload

  return {"status": "pending"}


@router.get("/healthz")
def healthz():
  return {"ok": True}
