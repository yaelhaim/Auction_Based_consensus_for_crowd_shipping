# Minimal users routes using raw SQL for clarity

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from Database.db import get_db   # import from the database folder

router = APIRouter(prefix="/users", tags=["users"])

@router.post("")
def create_user(display_name: str, db: Session = Depends(get_db)):
    """
    Create a user with display_name (role defaults to 'sender').
    """
    q = text("""
        INSERT INTO users (display_name, role)
        VALUES (:display_name, 'sender')
        RETURNING id, display_name, role, created_at
    """)
    row = db.execute(q, {"display_name": display_name}).mappings().first()
    db.commit()
    return dict(row)

@router.get("")
def list_users(db: Session = Depends(get_db)):
    """
    Return recent users with basic fields.
    """
    q = text("SELECT id, display_name, role, created_at FROM users ORDER BY created_at DESC")
    return [dict(r) for r in db.execute(q).mappings().all()]
