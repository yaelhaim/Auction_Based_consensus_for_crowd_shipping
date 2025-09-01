# poba_api_py/core/slot_planner.py
from typing import Tuple, List
import time

class SlotPlanner:
    """
    Aura slot planner: computes slot length, current slot, and finds the next slot
    in which a given authority (by SS58) is the author. Requires a live SubstrateInterface.
    """

    def __init__(self, substrate):
        self.substrate = substrate

    # ----- Time helpers -----
    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    # ----- Runtime constants -----
    def get_minimum_period_ms(self) -> int:
        # Timestamp::MinimumPeriod (ms)
        # In Substrate/Aura: slot_duration = 2 * MinimumPeriod
        self.substrate.init_runtime()
        _ = self.substrate.get_chain_head()
        const = self.substrate.get_constant("Timestamp", "MinimumPeriod")
        return int(const.value)

    def get_slot_duration_ms(self) -> int:
        return self.get_minimum_period_ms() * 2

    # ----- Slot calc -----
    def current_slot(self) -> int:
        sd = self.get_slot_duration_ms()
        return self._now_ms() // sd

    # ----- Aura authorities -----
    def authorities_ss58(self) -> List[str]:
        """
        Return current Aura authorities as SS58 addresses.
        We read from 'Aura' (pallet_aura) or via Session keys depending on runtime.
        """
        self.substrate.init_runtime()
        _ = self.substrate.get_chain_head()
        # Try pallet Aura: Authorities storage
        # Depending on your runtime, this might be 'Aura'::'Authorities' or session-based.
        try:
            result = self.substrate.query("Aura", "Authorities")
            # Authorities may be a list of Public keys -> convert to SS58
            return [acc.value if isinstance(acc.value, str) else acc.ss58_address for acc in result]
        except Exception:
            # Fallback: read session keys and map Aura key to account
            sess_validators = self.substrate.query("Session", "Validators")
            return [v.value if isinstance(v.value, str) else v.ss58_address for v in sess_validators]

    def _author_index_for_slot(self, slot: int, num_auth: int) -> int:
        # Classic Aura round-robin: author index = slot % N
        return slot % num_auth

    def _is_author_of_slot(self, ss58: str, slot: int) -> bool:
        auths = self.authorities_ss58()
        if not auths:
            return False
        idx = self._author_index_for_slot(slot, len(auths))
        # Normalize comparison
        try:
            return auths[idx] == ss58
        except IndexError:
            return False

    def next_matching_slot(self, winner_ss58: str, lookahead_slots: int) -> Tuple[int, int]:
        """
        Find the next Aura slot (within lookahead) in which 'winner_ss58' is the author.
        Return (slot_number, slot_start_ms).
        """
        sd = self.get_slot_duration_ms()
        cur = self.current_slot()
        for s in range(cur + 1, cur + 1 + lookahead_slots):
            if self._is_author_of_slot(winner_ss58, s):
                return s, s * sd
        raise RuntimeError("no matching slot within lookahead")
