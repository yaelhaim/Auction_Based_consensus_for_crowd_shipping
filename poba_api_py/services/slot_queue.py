# poba_api_py/services/slot_queue.py
import os
import time
import threading
from queue import PriorityQueue, Empty
from dataclasses import dataclass, field
from typing import Tuple

from substrateinterface import SubstrateInterface

from ..core.slot_planner import SlotPlanner

SUB_WS = os.getenv("SUBSTRATE_WS") or os.getenv("NODE_WS") or "ws://127.0.0.1:9944"

def _connect() -> SubstrateInterface:
    # Fresh connection per operation
    return SubstrateInterface(url=SUB_WS, auto_reconnect=True)

@dataclass(order=True)
class SlotTask:
    # PriorityQueue uses the first tuple element for ordering -> target_slot
    target_slot: int
    slot_start_ms: int = field(compare=False)
    auction_id: int = field(compare=False)
    winner_ss58: str = field(compare=False)

class SlotTaskQueue:
    """
    In-memory queue for slot-aligned tasks.
    Worker thread checks the head of the queue and triggers finalize
    when current time >= slot_start_ms (with small lead time).
    """
    def __init__(self, lead_ms: int = 300, retry: int = 1, sleep_ms: int = 100):
        self.q = PriorityQueue()
        self.lead_ms = lead_ms
        self.retry = retry
        self.sleep_ms = sleep_ms
        self._stop = threading.Event()
        self._worker_thread = None

    def start(self):
        if self._worker_thread and self._worker_thread.is_alive():
            return
        self._stop.clear()
        self._worker_thread = threading.Thread(target=self._worker, daemon=True)
        self._worker_thread.start()

    def stop(self):
        self._stop.set()
        if self._worker_thread:
            self._worker_thread.join(timeout=2)

    def enqueue(self, task: SlotTask):
        self.q.put(task)

    def size(self) -> int:
        return self.q.qsize()

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _worker(self):
        while not self._stop.is_set():
            try:
                task: SlotTask = self.q.get(timeout=0.25)
            except Empty:
                time.sleep(self.sleep_ms / 1000.0)
                continue

            # Busy-wait (sleeping) until slot start - lead
            while not self._stop.is_set():
                now = self._now_ms()
                if now + self.lead_ms >= task.slot_start_ms:
                    break
                time.sleep(min(0.1, (task.slot_start_ms - now) / 2000.0))

            # Try to finalize the auction at this slot
            ok = self._finalize_with_retry(task)
            if not ok:
                # If failed even after retry, you may push back or log
                # For MVP we just log and drop
                print(f"[slot_queue] finalize failed for auction {task.auction_id} at slot {task.target_slot}")

            self.q.task_done()

    def _finalize_with_retry(self, task: SlotTask) -> bool:
        attempts = self.retry + 1
        for i in range(attempts):
            try:
                self._finalize(task)
                return True
            except Exception as e:
                print(f"[slot_queue] finalize attempt {i+1}/{attempts} failed: {e}")
                time.sleep(0.3)
        return False

    def _finalize(self, task: SlotTask):
        """
        Compose and submit the extrinsic to close/finalize the auction.
        Replace the call with your actual pallet & method.
        """
        sub = _connect()
        sub.init_runtime()
        _ = sub.get_chain_head()

        # TODO: Replace with your pallet/call and signing key
        # Example assumes dev account Alice; replace with server key management
        from substrateinterface import Keypair
        ALICE = Keypair.create_from_uri("//Alice")

        call = sub.compose_call(
            call_module="Poba",
            call_function="finalize_auction",
            call_params={"id": int(task.auction_id)},
        )
        xt = sub.create_signed_extrinsic(call=call, keypair=ALICE)
        receipt = sub.submit_extrinsic(xt, wait_for_inclusion=True)
        if not receipt.is_success:
            raise RuntimeError(f"extrinsic failed: {receipt.error_message}")
