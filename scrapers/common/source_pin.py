"""The ONE gate every crawler uses for a source's own map pin (owner rule 2026-10-09, backlog 312).

A pin comes only from the source: never geocode an address or a district into an «exact» pin.
A pin outside Saudi Arabia, at 0,0, or not a number is rejected (both halves None), never stored.
"""
from __future__ import annotations

from typing import Any, Optional

SA_LAT = (16.0, 32.5)
SA_LNG = (34.0, 56.0)


def sa_pin(lat: Any, lng: Any) -> tuple[Optional[float], Optional[float]]:
    try:
        la, lo = float(str(lat).strip()), float(str(lng).strip())
    except (TypeError, ValueError):
        return None, None
    if SA_LAT[0] <= la <= SA_LAT[1] and SA_LNG[0] <= lo <= SA_LNG[1]:
        return la, lo
    return None, None


def pin_dict(lat: Any, lng: Any) -> dict:
    """{"latitude", "longitude"} for additional_info (the index's generic branch reads those two
    keys), or {} when the source gives no usable pin."""
    la, lo = sa_pin(lat, lng)
    return {"latitude": la, "longitude": lo} if la is not None else {}
