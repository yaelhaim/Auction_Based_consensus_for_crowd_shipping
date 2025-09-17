# FastAPI app with CORS and DB health endpoint

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from .Database.db import get_db   # updated import
from .routes_users import router as users_router
from .routes_auth import router as auth_router
from .routes_sender import router as sender_router
from .routes_rider import router as rider_router       
from .routes_courier import router as courier_router
from .routes_requests import router as requests_router


app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For MVP allow all; in prod restrict origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health/db")
def db_health(db: Session = Depends(get_db)):
    """Returns current DB time to verify connectivity."""
    row = db.execute(text("SELECT NOW() AS now")).mappings().first()
    return {"db_time": str(row["now"])}


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(sender_router)
app.include_router(rider_router) 
app.include_router(courier_router) 
app.include_router(requests_router)


@app.get("/debug/dbinfo")
def db_info(db: Session = Depends(get_db)):
    row = db.execute(text("SELECT current_database() as db, current_user as user, current_schema() as schema")).mappings().first()
    return dict(row)

