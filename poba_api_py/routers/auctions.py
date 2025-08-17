import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services.auction_scheduler import schedule_auction_close


# Import CBBA logic & dataclasses
from ..services.auction_logic_CBBA_deadlines import (
    run_cbba_round,
    Courier as CbbaCourier,
    Job as CbbaJob,
    ParcelAsk,
)

router = APIRouter(prefix="/auctions", tags=["auctions"])


class ScheduleRequest(BaseModel):
    auction_id: int
    winner_ss58: str

@router.post("/schedule-close")
def api_schedule_close(req: ScheduleRequest):
    schedule_auction_close(req.auction_id, req.winner_ss58)
    return {"ok": True}



class ClearRequest(BaseModel):
    # Optional: allow client to pass current server time (Unix seconds)
    now_ts: int | None = None
    # Optionally filter which jobs to clear (IDs); leave empty for "all open"
    job_ids: list[int] | None = None
    dry_run: bool = False

@router.post("/clear", tags=["auctions"])
@router.post("/clear", tags=["auctions"])
def clear_round(req: ClearRequest):
    """
    Run a clearing round:
      1) Load couriers, jobs (parcels + rides), and parcel asks from DB.
      2) Run CBBA with deadlines to get assignment.
      3) For PARCEL jobs: schedule a close aligned to Aura for the winning courier (unless dry_run).
      4) For RIDE jobs: (TODO) persist the assignment in DB.
    """
    try:
        # ---------- TODO: replace these loaders with your real DB fetchers ----------
        couriers: list[CbbaCourier] = _load_couriers_from_db()
        jobs: list[CbbaJob] = _load_open_jobs_from_db(req.job_ids)
        parcel_asks: list[ParcelAsk] = _load_parcel_asks_for_jobs(jobs, couriers)
        # ---------------------------------------------------------------------------

        if not couriers or not jobs:
            raise HTTPException(400, "No couriers or jobs to clear")

        now_ts = req.now_ts or int(time.time())

        # Run CBBA assignment (mixed parcels + rides, with deadlines)
        assignment = run_cbba_round(
            couriers=couriers,
            jobs=jobs,
            parcel_asks=parcel_asks,
            now_ts=now_ts,
            max_rounds=5,
        )

        # Indexes to help post-process the assignment
        ss58_by_cid = {c.id: c.ss58 for c in couriers}
        job_by_id = {j.id: j for j in jobs}

        scheduled_parcels = []
        assigned_rides = []

        for courier_id, job_ids in assignment.items():
            for j_id in job_ids:
                job = job_by_id.get(j_id)
                if job is None:
                    continue

                winner_ss58 = ss58_by_cid[courier_id]

                if job.job_type == "parcel":
                    if not req.dry_run:
                        # Might raise if WS/node not available -> caught by outer try/except
                        schedule_auction_close(job.id, winner_ss58)
                    scheduled_parcels.append({
                        "job_id": job.id,
                        "courier_id": courier_id,
                        "winner_ss58": winner_ss58,
                        "scheduled": not req.dry_run,
                    })
                else:
                    # TODO: save to DB in your system
                    _persist_ride_assignment(job.id, courier_id, winner_ss58)
                    assigned_rides.append({
                        "job_id": job.id,
                        "courier_id": courier_id,
                        "winner_ss58": winner_ss58,
                    })

        return {
            "ok": True,
            "assigned": assignment,              # {courier_id: [job_id, ...]}
            "scheduled_parcels": scheduled_parcels,
            "assigned_rides": assigned_rides,
            "count_parcels": len(scheduled_parcels),
            "count_rides": len(assigned_rides),
            "dry_run": req.dry_run,
        }

    except HTTPException:
        # Bubble up FastAPI-friendly errors
        raise
    except Exception as e:
        # Return a clear error instead of generic 500
        raise HTTPException(status_code=500, detail=f"/auctions/clear failed: {type(e).__name__}: {e}")


# ----------------- STUB LOADERS (replace with real DB queries) -----------------
def _load_couriers_from_db() -> list[CbbaCourier]:
    """
    TODO: Replace with SELECT from your 'couriers' table.
    Must populate seat/cargo capacities and pricing for rides.
    """
    return [
        CbbaCourier(
            id=1, ss58="5Alice...", seat_capacity=2,
            cargo_vol_cap=60.0, cargo_wt_cap=40.0,
            base_fare=10.0, ask_per_km=2.0,
            speed_kmh=40.0, cur_lat=0.0, cur_lng=0.0
        ),
        CbbaCourier(
            id=2, ss58="5Bob.....", seat_capacity=1,
            cargo_vol_cap=30.0, cargo_wt_cap=20.0,
            base_fare=8.0, ask_per_km=2.5,
            speed_kmh=35.0, cur_lat=1.0, cur_lng=1.0
        ),
    ]

def _load_open_jobs_from_db(filter_ids: list[int] | None) -> list[CbbaJob]:
    """
    TODO: Replace with SELECT from 'jobs' where status='open' (and id in filter if provided).
    Include both parcels and rides, with latest_ts if you want deadline enforcement.
    """
    import time as _t
    sample = [
        CbbaJob(id=101, job_type="parcel", bid_price=120,
                pickup_lat=0.0, pickup_lng=0.0, drop_lat=2.0, drop_lng=2.0,
                cargo_vol=10.0, cargo_wt=5.0, latest_ts=int(_t.time()) + 3600),
        CbbaJob(id=102, job_type="parcel", bid_price=70,
                pickup_lat=1.0, pickup_lng=0.0, drop_lat=1.0, drop_lng=2.0,
                cargo_vol=12.0, cargo_wt=7.0, latest_ts=int(_t.time()) + 900),
        CbbaJob(id=201, job_type="ride", bid_price=55,
                pickup_lat=0.5, pickup_lng=0.5, drop_lat=2.5, drop_lng=2.0,
                seats_required=1, latest_ts=int(_t.time()) + 1800),
    ]
    if filter_ids:
        return [j for j in sample if j.id in filter_ids]
    return sample

def _load_parcel_asks_for_jobs(jobs: list[CbbaJob], couriers: list[CbbaCourier]) -> list[ParcelAsk]:
    """
    TODO: Replace with SELECT from 'parcel_asks' where job_id in (...) and courier_id in (...).
    Only for job_type == 'parcel'. Rides use courier.base_fare + ask_per_km internally.
    """
    job_ids = {j.id for j in jobs if j.job_type == "parcel"}
    asks: list[ParcelAsk] = []
    for c in couriers:
        for j_id in job_ids:
            # Example: naive ask = 50 + 2 * courier_id (replace with your logic/DB)
            asks.append(ParcelAsk(courier_id=c.id, job_id=j_id, ask_price=50 + 2 * c.id))
    return asks

def _persist_ride_assignment(job_id: int, courier_id: int, ss58: str) -> None:
    """
    TODO: UPDATE jobs SET assigned_to=courier_id, state='assigned' WHERE id=job_id
    Optionally store ss58 and a timestamp. For MVP, just a no-op.
    """
    return
