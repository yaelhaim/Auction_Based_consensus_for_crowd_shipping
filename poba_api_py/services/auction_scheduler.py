# poba_api_py/services/auction_scheduler.py
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import HTTPException
from substrateinterface import SubstrateInterface, Keypair

from ..core.slot_planner import SlotPlanner

# ----------------------------
# Config & env
# ----------------------------
# Prefer SUBSTRATE_WS, fallback to NODE_WS, else default localhost
SUB_WS = os.getenv("SUBSTRATE_WS") or os.getenv("NODE_WS") or "ws://127.0.0.1:9944"

# Optional config module (keep your constants if you have them)
try:
    from ..config import SS58_FORMAT, SERVICE_SEED, EPSILON_MS, LOOKAHEAD_SLOTS
except Exception:
    # Sensible defaults for dev/MVP
    SS58_FORMAT = 42
    SERVICE_SEED = "//Alice"
    EPSILON_MS = 250            # trigger a bit before slot start
    LOOKAHEAD_SLOTS = 120       # how far ahead to search for winner's slot

# ----------------------------
# DB hooks (replace with your DB)
# ----------------------------
def db_mark_auction_planned(auction_id: int, winner: str, target_slot: int, target_ms: int): ...
def db_mark_auction_closed(auction_id: int, block_hash: str = ""): ...
def db_log(msg: str): print(msg)

# ----------------------------
# Helpers
# ----------------------------
def _connect() -> SubstrateInterface:
    """
    Fresh connection per operation to avoid stale WS/BrokenPipe.
    """
    return SubstrateInterface(url=SUB_WS, auto_reconnect=True)

def _substrate_warmup(sub: SubstrateInterface) -> None:
    """
    Load metadata and ensure the WS is live.
    """
    sub.init_runtime()
    _ = sub.get_chain_head()

def _plan_slot(winner_ss58: str) -> Tuple[int, int]:
    """
    Return (target_slot, slot_start_ms) for the next Aura slot where winner_ss58 is the author.
    Retries once if WS breaks.
    """
    for attempt in (1, 2):
        try:
            sub = _connect()
            _substrate_warmup(sub)
            sp = SlotPlanner(sub)
            return sp.next_matching_slot(winner_ss58, LOOKAHEAD_SLOTS)
        except Exception as e:
            if attempt == 2:
                raise HTTPException(status_code=503, detail=f"slot planning failed: {e}")
            time.sleep(0.2)  # brief retry

# ----------------------------
# Scheduler (APScheduler)
# ----------------------------
scheduler = BackgroundScheduler(timezone=timezone.utc)

def start_scheduler():
    """
    Call this from FastAPI startup (you already do). Safe to call multiple times.
    """
    if not scheduler.running:
        scheduler.start()
        db_log("[Scheduler] started")

def schedule_auction_close(auction_id: int, winner_ss58: str) -> None:
    """
    1) Compute the next slot where winner is the Aura author
    2) Schedule a one-off job at (slot_start_ms - EPSILON_MS)
    """
    target_slot, slot_start_ms = _plan_slot(winner_ss58)

    fire_at_ms = max(slot_start_ms - int(EPSILON_MS), int(time.time() * 1000) + 100)
    run_dt = datetime.fromtimestamp(fire_at_ms / 1000.0, tz=timezone.utc)

    db_mark_auction_planned(auction_id, winner_ss58, target_slot, slot_start_ms)

    # id is unique per auction; replace_existing so repeated calls update the schedule
    scheduler.add_job(
        func=_close_auction_job,
        trigger="date",
        run_date=run_dt,
        args=[auction_id, winner_ss58, target_slot],
        id=f"close_auction_{auction_id}",
        replace_existing=True,
        misfire_grace_time=10,  # seconds tolerance if the process was paused
        coalesce=True,          # collapse multiple triggers if delayed
        max_instances=1,
    )

    db_log(f"[Scheduler] Auction {auction_id}: winner={winner_ss58} "
           f"target_slot={target_slot} run_at={run_dt.isoformat()}")

# ----------------------------
# Close job
# ----------------------------
def _close_auction_job(auction_id: int, winner_ss58: str, target_slot: int) -> None:
    """
    This runs right before the target slot begins (EPSILON_MS earlier).
    1) Mark closed in DB (source of truth for your app)
    2) Optionally reflect on-chain (compose & submit extrinsic)
    """
    db_log(f"[CloseJob] Closing auction {auction_id} for target_slot={target_slot}")

    # 1) Always update your DB first
    db_mark_auction_closed(auction_id)

    # 2) Optional: reflect on-chain (adjust module/function to your runtime)
    #    NOTE: Make sure 'call_module' and 'call_function' match your pallet!
    #          In your code I saw both 'PoBA::finalize_auction' and 'Poba::declare_winner'.
    #          Choose the correct one for your runtime.
    try:
        sub = _connect()
        _substrate_warmup(sub)

        kp = Keypair.create_from_uri(SERVICE_SEED, ss58_format=SS58_FORMAT)

        # >>> ADJUST THESE NAMES TO MATCH YOUR RUNTIME <<<
        call = sub.compose_call(
            call_module="Poba",              # or "PoBA" if that's your exact pallet name
            call_function="finalize_auction",
            call_params={"id": int(auction_id)},  # adjust params as defined in your pallet
        )

        xt = sub.create_signed_extrinsic(call=call, keypair=kp)
        receipt = sub.submit_extrinsic(xt, wait_for_inclusion=True)

        if not receipt.is_success:
            raise RuntimeError(f"extrinsic failed: {receipt.error_message}")

        db_log(f"[CloseJob] On-chain included in block {receipt.block_hash}")

    except Exception as e:
        # Do not crash the scheduler – just log. Your DB already marked closed.
        db_log(f"[CloseJob] On-chain finalize failed: {e!r}")
