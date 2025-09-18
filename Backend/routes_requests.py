# Backend/routes_requests.py
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Literal, Optional
from datetime import datetime
from decimal import Decimal

# נסה לייבא את get_db מאיפה שקיים אצלך (יש פרויקט עם שתי מיקומים אפשריים)
try:
    from .Database.db import get_db
except Exception:
    from .Database.db import get_db  # fallback אם יש db.py בשורש Backend

# ה־dependency שמחזיר את המשתמש הנוכחי
from .auth_dep import get_current_user  # השאר כפי שקיים אצלך

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
    max_price: Decimal = Field(..., gt=0)  # תואם DB NUMERIC(10,2)
    pickup_contact_name: Optional[str] = Field(None, max_length=100)
    pickup_contact_phone: Optional[str] = Field(None, max_length=32)

    # אופציונלי – קואורדינטות/נוסעים
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
    """תומך גם במילון וגם באובייקט."""
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

    # בניית הפרמטרים לשאילתא
    params = {
        "owner_user_id": uid,
        "type": payload.type,
        "from_address": payload.from_address,
        "from_lat": payload.from_lat,
        "from_lon": payload.from_lon,
        "to_address": payload.to_address,
        "to_lat": payload.to_lat,
        "to_lon": payload.to_lon,
        "passengers": payload.passengers,
        "notes": payload.notes,
        "window_start": payload.window_start,
        "window_end": payload.window_end,
        "status": "open",
        "max_price": str(payload.max_price),  # ל-psycopg נוח כטקסט
        "pickup_contact_name": payload.pickup_contact_name,
        "pickup_contact_phone": payload.pickup_contact_phone,
    }

    # SQLAlchemy Core – text(). אם יש לך helper אחר, אפשר להתאים.
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

    # תמיכה גם ב-async וגם ב-sync session לפי מה שיש אצלך ב-get_db
    try:
        if hasattr(db, "execute"):  # sync/engine.connect()
            result = db.execute(sql, params)
            row = result.mappings().first()
            if hasattr(db, "commit"):
                db.commit()
        else:
            # הנחה: get_db מחזיר AsyncSession
            res = await db.execute(sql, params)
            row = res.mappings().first()
            await db.commit()
    except Exception as e:
        # לוג נוח לבדיקה
        print("[/requests] insert error:", repr(e))
        raise HTTPException(status_code=400, detail=str(e))

    if not row:
        raise HTTPException(status_code=500, detail="Insert failed (no row)")

    return {"id": str(row["id"]), "status": row["status"], "created_at": row["created_at"]}

# בריאות שרת (נוח לבדיקה מהלקוח)
@router.get("/healthz")
def healthz():
    return {"ok": True}
