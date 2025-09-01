
"""
CBBA (Centralized) – Mixed Jobs (Parcels + Rides) WITH deadline handling
-----------------------------------------------------------------------
What's new in this version:
  1) Hard/soft deadline enforcement for both PARCEL and RIDE jobs.
     - HARD reject if ETA > latest_ts + HARD_LATE_GRACE_MIN minutes.
     - SOFT penalty proportional to (ETA - latest_ts) minutes if ETA > latest_ts.
  2) Real ETA computed using a provided `now_ts` (Unix seconds).
  3) Distance/time penalties on every candidate (discourages long detours/slow routes).

All comments are in English as requested.
"""

from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Callable, Literal
import time

JobType = Literal["parcel", "ride"]

# ------------------------------
# Data models
# ------------------------------

@dataclass
class Courier:
    id: int
    ss58: str
    # Capacities
    seat_capacity: int
    cargo_vol_cap: float
    cargo_wt_cap: float
    # Ride pricing
    base_fare: float
    ask_per_km: float
    # Kinematics / location
    speed_kmh: float = 30.0
    cur_lat: float = 0.0
    cur_lng: float = 0.0
    region: Optional[str] = None

@dataclass
class Job:
    id: int
    job_type: JobType  # "parcel" | "ride"
    bid_price: float
    pickup_lat: float
    pickup_lng: float
    drop_lat: float
    drop_lng: float
    # Parcel capacities
    cargo_vol: float = 0.0
    cargo_wt: float = 0.0
    # Ride capacities
    seats_required: int = 1
    # Time windows
    earliest_ts: Optional[int] = None   # not enforced in MVP, but can be used
    latest_ts: Optional[int] = None     # deadline for arrival (drop)

@dataclass
class ParcelAsk:
    courier_id: int
    job_id: int
    ask_price: float  # only for PARCEL jobs

# ------------------------------
# Penalty knobs (tune in production)
# ------------------------------

# Per-minute penalty for travel time (discourages very long trips)
ALPHA_TIME = 0.5

# Per-km penalty (discourages long distances)
BETA_DIST = 0.2

# Soft lateness penalty per minute beyond latest_ts
GAMMA_LATE = 2.0

# Hard reject if later than latest_ts + this grace (minutes)
HARD_LATE_GRACE_MIN = 30

# ------------------------------
# Helpers
# ------------------------------

def euclidean_km(ax: float, ay: float, bx: float, by: float) -> float:
    """Simple Euclidean distance; replace with Haversine for real lat/lng."""
    return ((ax - bx)**2 + (ay - by)**2) ** 0.5

def km_to_minutes(km: float, speed_kmh: float) -> float:
    speed = max(speed_kmh, 1e-6)
    return 60.0 * (km / speed)

def eta_from_now_minutes(now_ts: int, minutes: float) -> int:
    """Compute ETA timestamp (Unix seconds) from now + minutes."""
    return int(now_ts + minutes * 60.0)

def lateness_minutes(eta_drop_ts: Optional[int], latest_ts: Optional[int]) -> float:
    if eta_drop_ts is None or latest_ts is None:
        return 0.0
    delta_sec = eta_drop_ts - latest_ts
    return max(0.0, delta_sec / 60.0)

def is_hard_late(eta_drop_ts: Optional[int], latest_ts: Optional[int]) -> bool:
    if eta_drop_ts is None or latest_ts is None:
        return False
    return (eta_drop_ts - latest_ts) > (HARD_LATE_GRACE_MIN * 60.0)

# ------------------------------
# Utility functions (with deadlines)
# ------------------------------

def parcel_utility(now_ts: int, courier: Courier, job: Job, ask_price: float) -> float:
    """Utility for PARCEL:
       base = bid - ask
       route_km = pickup->drop
       travel_minutes = route_km / speed
       ETA = now + travel_minutes
       penalties = BETA_DIST*route_km + ALPHA_TIME*travel_minutes + GAMMA_LATE*max(0, ETA - latest_ts)
       HARD REJECT if ETA > latest_ts + grace
    """
    if job.bid_price < ask_price:
        return float("-inf")

    route_km = euclidean_km(job.pickup_lng, job.pickup_lat, job.drop_lng, job.drop_lat)
    travel_min = km_to_minutes(route_km, courier.speed_kmh)
    eta_drop = eta_from_now_minutes(now_ts, travel_min)

    # Hard reject if way too late
    if is_hard_late(eta_drop, job.latest_ts):
        return float("-inf")

    base = float(job.bid_price - ask_price)
    penalties = (BETA_DIST * route_km) + (ALPHA_TIME * travel_min)
    # Soft lateness penalty
    penalties += GAMMA_LATE * lateness_minutes(eta_drop, job.latest_ts)

    return base - penalties

def ride_utility(now_ts: int, courier: Courier, job: Job) -> float:
    """Utility for RIDE:
       detour_km = curr->pickup + pickup->drop
       price = base_fare + ask_per_km * detour_km
       detour_min = detour_km / speed
       ETA = now + detour_min
       base = bid - price
       penalties = BETA_DIST*detour_km + ALPHA_TIME*detour_min + GAMMA_LATE*max(0, ETA - latest_ts)
       HARD REJECT if ETA > latest_ts + grace
    """
    detour_km = (
        euclidean_km(courier.cur_lng, courier.cur_lat, job.pickup_lng, job.pickup_lat)
        + euclidean_km(job.pickup_lng, job.pickup_lat, job.drop_lng, job.drop_lng)
    )
    price = courier.base_fare + courier.ask_per_km * detour_km
    if job.bid_price < price:
        return float("-inf")

    detour_min = km_to_minutes(detour_km, courier.speed_kmh)
    eta_drop = eta_from_now_minutes(now_ts, detour_min)

    if is_hard_late(eta_drop, job.latest_ts):
        return float("-inf")

    base = float(job.bid_price - price)
    penalties = (BETA_DIST * detour_km) + (ALPHA_TIME * detour_min)
    penalties += GAMMA_LATE * lateness_minutes(eta_drop, job.latest_ts)

    return base - penalties

def utility(
    now_ts: int,
    courier: Courier,
    job: Job,
    parcel_ask_index: Dict[Tuple[int, int], float],
) -> float:
    if job.job_type == "parcel":
        ask = parcel_ask_index.get((courier.id, job.id), None)
        if ask is None:
            return float("-inf")
        return parcel_utility(now_ts, courier, job, ask)
    elif job.job_type == "ride":
        return ride_utility(now_ts, courier, job)
    return float("-inf")

# ------------------------------
# Capacity checks
# ------------------------------

def can_add_job_to_bundle(
    courier: Courier,
    job: Job,
    seats_left: int,
    vol_left: float,
    wt_left: float,
) -> bool:
    if job.job_type == "ride":
        return job.seats_required > 0 and seats_left >= job.seats_required
    # parcel
    if job.cargo_vol > vol_left or job.cargo_wt > wt_left:
        return False
    return True

def update_capacity_after_add(
    job: Job,
    seats_left: int,
    vol_left: float,
    wt_left: float,
) -> Tuple[int, float, float]:
    if job.job_type == "ride":
        return seats_left - job.seats_required, vol_left, wt_left
    return seats_left, vol_left - job.cargo_vol, wt_left - job.cargo_wt

# ------------------------------
# Core CBBA-like (centralized)
# ------------------------------

def build_bundle_for_courier(
    now_ts: int,
    courier: Courier,
    jobs: List[Job],
    parcel_ask_index: Dict[Tuple[int, int], float],
    used_jobs: set,
    capacity_override: Optional[Tuple[int, float, float]],  # (seats, vol, wt)
    utility_fn: Callable[[int, Courier, Job, Dict[Tuple[int,int], float]], float],
) -> List[Tuple[int, float]]:
    seats_left = capacity_override[0] if capacity_override else courier.seat_capacity
    vol_left   = capacity_override[1] if capacity_override else courier.cargo_vol_cap
    wt_left    = capacity_override[2] if capacity_override else courier.cargo_wt_cap

    chosen: List[Tuple[int, float]] = []
    chosen_set = set()

    while True:
        best_job: Optional[Job] = None
        best_score: float = float("-inf")

        for j in jobs:
            if j.id in chosen_set or j.id in used_jobs:
                continue
            if not can_add_job_to_bundle(courier, j, seats_left, vol_left, wt_left):
                continue
            score = utility_fn(now_ts, courier, j, parcel_ask_index)
            if score > best_score:
                best_score = score
                best_job = j

        if best_job is None or best_score == float("-inf"):
            break

        chosen.append((best_job.id, best_score))
        chosen_set.add(best_job.id)
        seats_left, vol_left, wt_left = update_capacity_after_add(best_job, seats_left, vol_left, wt_left)

        if seats_left <= 0 and vol_left <= 0 and wt_left <= 0:
            break

    chosen.sort(key=lambda x: -x[1])
    return chosen

def tie_break(
    challenger: Tuple[int, float],
    incumbent: Tuple[int, float],
) -> Tuple[int, float]:
    c_id, c_score = challenger
    i_id, i_score = incumbent
    if c_score > i_score:
        return challenger
    if c_score < i_score:
        return incumbent
    return challenger if c_id < i_id else incumbent

def consensus_resolve(
    bundles: Dict[int, List[Tuple[int, float]]]
) -> Dict[int, List[Tuple[int, float]]]:
    claims: Dict[int, List[Tuple[int, float]]] = {}
    for courier_id, items in bundles.items():
        for job_id, score in items:
            claims.setdefault(job_id, []).append((courier_id, score))

    winners: Dict[int, Tuple[int, float]] = {}
    for job_id, cand_list in claims.items():
        winner = cand_list[0]
        for cand in cand_list[1:]:
            winner = tie_break(cand, winner)
        winners[job_id] = winner

    clean: Dict[int, List[Tuple[int, float]]] = {cid: [] for cid in bundles.keys()}
    for job_id, (c_id, score) in winners.items():
        clean[c_id].append((job_id, score))

    for cid in clean:
        clean[cid].sort(key=lambda x: -x[1])
    return clean

def run_cbba_round(
    couriers: List[Courier],
    jobs: List[Job],
    parcel_asks: List[ParcelAsk],
    now_ts: Optional[int] = None,
    max_rounds: int = 5,
    capacity_override: Optional[Tuple[int, float, float]] = None,
    utility_fn: Callable[[int, Courier, Job, Dict[Tuple[int,int], float]], float] = utility,
) -> Dict[int, List[int]]:
    """Run several CBBA build->resolve rounds with deadline-aware utility.
    Returns {courier_id: [job_ids...]}
    """
    now_ts = int(time.time()) if now_ts is None else int(now_ts)

    parcel_ask_index: Dict[Tuple[int, int], float] = {
        (a.courier_id, a.job_id): float(a.ask_price) for a in parcel_asks
    }

    bundles: Dict[int, List[Tuple[int, float]]] = {c.id: [] for c in couriers}
    prev_snapshot: Optional[Dict[int, List[int]]] = None

    for _ in range(max_rounds):
        used_jobs = set()
        tentative: Dict[int, List[Tuple[int, float]]] = {}
        for c in couriers:
            b = build_bundle_for_courier(
                now_ts=now_ts,
                courier=c,
                jobs=jobs,
                parcel_ask_index=parcel_ask_index,
                used_jobs=used_jobs,
                capacity_override=capacity_override,
                utility_fn=utility_fn,
            )
            tentative[c.id] = b
            for j_id, _ in b:
                used_jobs.add(j_id)

        clean = consensus_resolve(tentative)

        snapshot = {cid: sorted([j for j, _ in items]) for cid, items in clean.items()}
        if snapshot == prev_snapshot:
            bundles = clean
            break
        bundles = clean
        prev_snapshot = snapshot

    return {cid: [j for j, _ in items] for cid, items in bundles.items()}

# ------------------------------
# Example (can be removed in production)
# ------------------------------
if __name__ == "__main__":
    couriers = [
        Courier(id=1, ss58="5Alice...", seat_capacity=1, cargo_vol_cap=50.0, cargo_wt_cap=30.0, base_fare=10.0, ask_per_km=2.0, speed_kmh=40.0, cur_lat=0.0, cur_lng=0.0),
        Courier(id=2, ss58="5Bob.....", seat_capacity=2, cargo_vol_cap=20.0, cargo_wt_cap=15.0, base_fare=8.0, ask_per_km=2.5, speed_kmh=35.0, cur_lat=1.0, cur_lng=1.0),
    ]

    jobs = [
        Job(id=101, job_type="parcel", bid_price=120, pickup_lat=0.0, pickup_lng=0.0, drop_lat=2.0, drop_lng=2.0, cargo_vol=10.0, cargo_wt=5.0, latest_ts=int(time.time()) + 3600),
        Job(id=102, job_type="parcel", bid_price=70,  pickup_lat=1.0, pickup_lng=0.0, drop_lat=1.0, drop_lng=2.0, cargo_vol=12.0, cargo_wt=7.0, latest_ts=int(time.time()) + 900),
        Job(id=201, job_type="ride",   bid_price=50,  pickup_lat=0.5, pickup_lng=0.5, drop_lat=2.5, drop_lng=2.0, seats_required=1, latest_ts=int(time.time()) + 1800),
    ]

    parcel_asks = [
        ParcelAsk(courier_id=1, job_id=101, ask_price=60),
        ParcelAsk(courier_id=1, job_id=102, ask_price=50),
        ParcelAsk(courier_id=2, job_id=101, ask_price=80),
        ParcelAsk(courier_id=2, job_id=102, ask_price=40),
    ]

    assignment = run_cbba_round(couriers, jobs, parcel_asks, now_ts=int(time.time()), max_rounds=5)
    print("Assignment:", assignment)
