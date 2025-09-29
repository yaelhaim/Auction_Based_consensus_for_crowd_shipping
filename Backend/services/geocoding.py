# app/services/geocoding.py
from __future__ import annotations
from typing import Optional, Tuple
import os
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

USER_AGENT = os.getenv("GEOCODE_USER_AGENT", "bidrop-app/1.0 (contact@example.com)")
DEFAULT_COUNTRYCODES = os.getenv("GEOCODE_COUNTRYCODES", "il")
DEFAULT_LANGUAGE = os.getenv("GEOCODE_LANGUAGE", "he")

_geocoder = Nominatim(user_agent=USER_AGENT, timeout=10)
_geocode  = RateLimiter(_geocoder.geocode, min_delay_seconds=1.1)

def geocode_address(address: str,
                    countrycodes: Optional[str] = DEFAULT_COUNTRYCODES,
                    language: Optional[str] = DEFAULT_LANGUAGE) -> Optional[Tuple[float, float]]:
    if not address or not address.strip():
        return None
    try:
        loc = _geocode(query=address, language=language, country_codes=countrycodes, addressdetails=False)
        if not loc:
            return None
        return float(loc.latitude), float(loc.longitude)
    except Exception:
        return None
