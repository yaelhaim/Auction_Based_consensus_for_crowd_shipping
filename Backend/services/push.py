# Backend/services/push.py
from __future__ import annotations
import httpx
import asyncio
from typing import Optional, Dict, Any

EXPO_URL = "https://exp.host/--/api/v2/push/send"

async def send_expo_async(to: str, title: str, body: str,
                          data: Optional[Dict[str, Any]] = None,
                          sound: str = "default",
                          channel_id: str = "default") -> None:
    """
    שולח הודעה בודדת ל-Expo. מדפיס את תגובת ה-JSON כדי שנראה אם יש errors.
    """
    if not to:
        print("[PUSH] skip: empty token")
        return

    payload: Dict[str, Any] = {
        "to": to,
        "title": title,
        "body": body,
        "sound": sound,
        "channelId": channel_id,  # חשוב לאנדרואיד
        "data": data or {},
    }

    try:
        async with httpx.AsyncClient(timeout=12) as c:
            resp = await c.post(EXPO_URL, json=payload)
            txt = resp.text
            try:
                js = resp.json()
            except Exception:
                js = {"raw": txt}
            print(f"[PUSH] Expo resp {resp.status_code}: {js}")
    except Exception as e:
        print("[PUSH] http error:", repr(e))

def fire_and_forget(coro):
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        asyncio.run(coro)
