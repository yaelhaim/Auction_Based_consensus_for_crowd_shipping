# Backend/main.py
# FastAPI app with CORS, DB health endpoints, routers, and APScheduler via Lifespan.

from __future__ import annotations

import logging, sys, os
from logging.handlers import RotatingFileHandler
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

# DB deps
from .Database.db import get_db
try:
    from .Database.db import SessionLocal  # session factory for scheduler job
except Exception:  # pragma: no cover
    SessionLocal = None  # fallback

# Routers
from .routes_users import router as users_router
from .routes_auth import router as auth_router
from .routes_sender import router as sender_router
from .routes_rider import router as rider_router
from .routes_courier import router as courier_router
from .routes_requests import router as requests_router
from .routes_offers import router as offers_router
from .routes_devices import router as devices_router
from .routes_auction import router as auction_router
from .routes_assignments import router as assignments_router
from .routes_matching import router as matching_router
from .routes_poba import router as poba_router

from dotenv import load_dotenv
load_dotenv()

# Clearing tick (IDA*)
try:
    from .routes_auction import run_clearing_tick
except Exception:
    try:
        from app.auction.routes_auction import run_clearing_tick  # type: ignore
    except Exception:
        run_clearing_tick = None  # pragma: no cover

# APScheduler
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

# --------------------------- Logging setup ---------------------------
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

def _setup_logger(name: str, filename: str) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter('%(asctime)s %(levelname)s %(name)s %(message)s')
    # file (rotating)
    fh = RotatingFileHandler(os.path.join(LOG_DIR, filename), maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    # stdout (docker/k8s)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    # avoid duplicate handlers on reload
    if not logger.handlers:
        logger.addHandler(fh)
        logger.addHandler(sh)
    return logger

_setup_logger("clearing", "clearing.log")
_setup_logger("match", "matches.log")

logger = logging.getLogger("clearing")
scheduler = AsyncIOScheduler()

def _clearing_job():
    """Run one clearing tick in a short-lived DB session."""
    if run_clearing_tick is None or SessionLocal is None:
        logger.warning("Clearing job skipped (missing run_clearing_tick or SessionLocal)")
        return
    db = SessionLocal()
    try:
        res = run_clearing_tick(db=db)
        logger.info("Clearing tick result: %s", res)
    except Exception as e:  # pragma: no cover
        logger.exception("Clearing job failed: %s", e)
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- Startup ----
    try:
        scheduler.add_job(_clearing_job, IntervalTrigger(seconds=60))
        scheduler.start()
        logger.info("Scheduler started (IDA* every 60s)")
    except Exception as e:  # pragma: no cover
        logger.exception("Failed to start scheduler: %s", e)

    yield

    # ---- Shutdown ----
    try:
        if scheduler.running:
            scheduler.shutdown()
            logger.info("Scheduler stopped")
    except Exception as e:  # pragma: no cover
        logger.exception("Failed to stop scheduler: %s", e)

app = FastAPI(lifespan=lifespan)

# --------------------------- CORS ---------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # MVP: allow all; tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------- Health ---------------------------
@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/health/db")
def db_health(db: Session = Depends(get_db)):
    """Returns current DB time to verify connectivity."""
    row = db.execute(text("SELECT NOW() AS now")).mappings().first()
    return {"db_time": str(row["now"])}

@app.get("/debug/dbinfo")
def db_info(db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT current_database() as db, current_user as user, current_schema() as schema")
    ).mappings().first()
    return dict(row)

# --------------------------- Routers ---------------------------
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(sender_router)
app.include_router(rider_router)
app.include_router(courier_router)
app.include_router(requests_router)
app.include_router(offers_router)
app.include_router(devices_router)
app.include_router(auction_router)
app.include_router(assignments_router)
app.include_router(matching_router)
app.include_router(poba_router)