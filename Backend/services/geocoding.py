# app/services/geocoding.py
from __future__ import annotations
from typing import Optional, Tuple
import os
import logging

from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter
from geopy.exc import GeocoderInsufficientPrivileges, GeocoderServiceError

log = logging.getLogger("geocoding")

# --------------------------- Config ---------------------------


USER_AGENT = os.getenv(
    "GEOCODE_USER_AGENT")

DEFAULT_COUNTRYCODES = os.getenv("GEOCODE_COUNTRYCODES", "il")
DEFAULT_LANGUAGE = os.getenv("GEOCODE_LANGUAGE", "he")

log.info("Nominatim USER_AGENT=%s", USER_AGENT)

_geocoder = Nominatim(user_agent=USER_AGENT, timeout=5)
_geocode = RateLimiter(
    _geocoder.geocode,
    min_delay_seconds=1.1,
    max_retries=1,
    swallow_exceptions=False 
)

# --------------------------- Public API ---------------------------

def geocode_address(
    address: str,
    countrycodes: Optional[str] = DEFAULT_COUNTRYCODES,
    language: Optional[str] = DEFAULT_LANGUAGE,
) -> Optional[Tuple[float, float]]:
    """
    Try to geocode an address.
    Returns (lat, lon) on success, or None on failure.
    NEVER זורקת חריגה – כל החריגות מטופלות כאן.
    """
    if not address or not address.strip():
        return None

    try:
        loc = _geocode(
            query=address,
            language=language,
            country_codes=countrycodes,
            addressdetails=False,
        )
        if not loc:
            log.warning("geocode_address: no result for %r", address)
            return None

        return float(loc.latitude), float(loc.longitude)

    except GeocoderInsufficientPrivileges as e:

        log.error("geocode_address: InsufficientPrivileges (403) for %r: %s", address, e)
        return None
    except GeocoderServiceError as e:
        log.warning("geocode_address: service error for %r: %s", address, e)
        return None
    except Exception as e:
        log.warning("geocode_address: unexpected error for %r: %s", address, e)
        return None
