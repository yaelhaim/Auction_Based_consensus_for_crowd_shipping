# routes_users.py
# FastAPI user routes for reading/updating the current user.
# Uses JWT (via auth_dep.get_current_user) to resolve the user by wallet_address.
# All comments are in English per your request.

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .Database.db import get_db
from .auth_dep import get_current_user  # extracts user (incl. wallet_address) from JWT

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/me")
def get_me(me = Depends(get_current_user)):
    """
    Return the current user as resolved from the JWT (via get_current_user).
    The returned dict mirrors columns in the 'users' table.
    """
    return me


@router.put("/me")
def update_me(
    payload: dict,
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    """
    Upsert profile fields for the current user, identified by wallet_address from the JWT.

    Expected payload (coming from your profile form):
      - first_name (optional -> saved)
      - last_name  (optional -> saved)
      - phone      (optional -> saved)
      - email      (optional -> saved, unique)
      - city       (optional -> saved)

    Notes:
      - We intentionally DO NOT accept 'rating' here; it will be managed by future flows (e.g., customers).
      - Email uniqueness is enforced at application level before UPDATE.
      - We only UPDATE columns that were provided (non-empty strings).
      - We also set 'first_login_completed = TRUE' when an update occurs.
      - 'updated_at' is set to NOW().
    """
    wallet_address = me["wallet_address"]

    # Sanitize/trim incoming fields
    first_name = (payload.get("first_name") or "").strip()
    last_name  = (payload.get("last_name") or "").strip()
    phone      = (payload.get("phone") or "").strip()
    email      = (payload.get("email") or "").strip()
    city       = (payload.get("city") or "").strip()

    # Validate email uniqueness (if provided)
    if email:
        exists = db.execute(
            text("""
                SELECT 1
                FROM users
                WHERE email = :email AND wallet_address <> :wa
                LIMIT 1
            """),
            {"email": email, "wa": wallet_address},
        ).first()
        if exists:
            raise HTTPException(status_code=409, detail="Email already in use")

    # Build dynamic UPDATE for provided fields only
    set_parts = []
    params = {"wa": wallet_address}

    if email:
        set_parts.append("email = :email")
        params["email"] = email
    if phone:
        set_parts.append("phone = :phone")
        params["phone"] = phone
    if city:
        set_parts.append("city = :city")
        params["city"] = city
    if first_name:
        set_parts.append("first_name = :first_name")
        params["first_name"] = first_name
    if last_name:
        set_parts.append("last_name = :last_name")
        params["last_name"] = last_name

    # If nothing to update, return current user as-is
    if not set_parts:
        return me

    # Always mark the profile as completed when something is updated
    set_parts.append("first_login_completed = TRUE")

    set_sql = ", ".join(set_parts + ["updated_at = NOW()"])

    # Try updating an existing row (identified by wallet_address)
    row = db.execute(
        text(f"""
            UPDATE users
            SET {set_sql}
            WHERE wallet_address = :wa
            RETURNING
                id,
                wallet_address,
                role,
                email,
                phone,
                city,
                first_name,
                last_name,
                rating,
                first_login_completed,
                created_at,
                updated_at
        """),
        params,
    ).mappings().first()

    if not row:
        # Safety fallback: create the user if it doesn't exist (should already exist from /auth/verify).
        row = db.execute(
            text("""
                INSERT INTO users (
                    id, wallet_address, role,
                    email, phone, city,
                    first_name, last_name,
                    rating,
                    first_login_completed, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), :wa, 'sender',
                    :email, :phone, :city,
                    :first_name, :last_name,
                    NULL,
                    TRUE, NOW(), NOW()
                )
                RETURNING
                    id,
                    wallet_address,
                    role,
                    email,
                    phone,
                    city,
                    first_name,
                    last_name,
                    rating,
                    first_login_completed,
                    created_at,
                    updated_at
            """),
            {
                "wa": wallet_address,
                "email": email or None,
                "phone": phone or None,
                "city": city or None,
                "first_name": first_name or None,
                "last_name": last_name or None,
            },
        ).mappings().first()

    db.commit()
    return dict(row)

@router.patch("/me/role")
def update_my_role(
    payload: dict,
    db: Session = Depends(get_db),
    me = Depends(get_current_user),
):
    """
    Update the 'role' of the current user.

    Expected payload:
      { "role": "sender" | "driver" | "admin" }

    Notes:
      - Mobile app will map UI roles:
          * 'courier'  -> 'driver'
          * 'sender'   -> 'sender'
          * 'rider'    -> 'sender'
    """
    wallet_address = me["wallet_address"]
    new_role = (payload.get("role") or "").strip()

    if new_role not in ("sender", "driver", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")

    row = db.execute(
        text(
            """
            UPDATE users
            SET role = :role, updated_at = NOW()
            WHERE wallet_address = :wa
            RETURNING
                id,
                wallet_address,
                role,
                email,
                phone,
                city,
                first_name,
                last_name,
                rating,
                first_login_completed,
                created_at,
                updated_at
            """
        ),
        {"role": new_role, "wa": wallet_address},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    db.commit()
    return dict(row)


# ---------------------------------------------------------------------
# Optional routes (keep only if you still need them)
# ---------------------------------------------------------------------

@router.post("")
def create_user(first_name: str, last_name: str, db: Session = Depends(get_db)):
    """
    Create a user with the given names and default role 'sender'.
    This does NOT rely on JWT and generally should be avoided for wallet-based flows.
    """
    q = text("""
        INSERT INTO users (id, wallet_address, role, first_name, last_name, created_at, updated_at)
        VALUES (gen_random_uuid(), '', 'sender', :first_name, :last_name, NOW(), NOW())
        RETURNING id, role, first_name, last_name, created_at
    """)
    row = db.execute(q, {"first_name": first_name, "last_name": last_name}).mappings().first()
    db.commit()
    return dict(row)


@router.get("")
def list_users(db: Session = Depends(get_db)):
    """
    List users ordered by created_at (desc).
    Intended for admin/debug views; do not expose in production without auth/limits.
    """
    q = text("""
        SELECT
            id,
            wallet_address,
            role,
            email,
            phone,
            city,
            first_name,
            last_name,
            rating,
            first_login_completed,
            created_at,
            updated_at
        FROM users
        ORDER BY created_at DESC
    """)
    return [dict(r) for r in db.execute(q).mappings().all()]

