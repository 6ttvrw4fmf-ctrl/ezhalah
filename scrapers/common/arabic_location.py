"""Shared Arabic-location resolution for the Arabic-native capture upgrades.

Normalizes a source Arabic city/region string and resolves it to a STABLE Saudi catalog
(city_id, region_id) WITHOUT going through the English pivot. Used by per-platform scraper
upgrades so every platform resolves the same way the Filter/Agent will at cutover.

TWIN-SAFE: ~300 catalog city names are ambiguous across regions (e.g. «بيش» exists in both Asir
and Jazan). For those, this NEVER guesses — it resolves only when a region hint disambiguates,
otherwise leaves region_id null (honest, never wrong). Callers pass `region_hint` = whatever region
signal they already have (English name, Arabic label, or a region_id int).

`norm_ar` MUST match the SQL `normalize_ar()` that built loc_catalog_city.city_norm.
"""
from __future__ import annotations

import re
from typing import Optional, Union

from scrapers.common import db

_BIDI = "‎‏‌‍"


def norm_ar(s: Optional[str]) -> str:
    """Mirror SQL normalize_ar(): lowercase, fold أإآٱ→ا / ة→ه / ى→ي, strip tatweel + bidi marks,
    collapse whitespace."""
    s = (s or "").strip().lower()
    for a in "أإآٱ":
        s = s.replace(a, "ا")
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    for z in _BIDI:
        s = s.replace(z, "")
    return re.sub(r"\s+", " ", s)


# English region label → catalog region_id. Scrapers compute English regions today; this lets them
# pass that as a twin-disambiguation hint without re-deriving. (Curated, 13 stable catalog regions.)
REGION_EN_TO_ID: dict[str, int] = {
    "Riyadh": 1, "Makkah": 2, "Mecca": 2, "Madinah": 3, "Medina": 3, "Qassim": 4,
    "Eastern Province": 5, "Eastern": 5, "Asir": 6, "Tabuk": 7, "Hail": 8,
    "Northern Borders": 9, "Jazan": 10, "Najran": 11, "Al Bahah": 12, "Al Baha": 12, "Al Jawf": 13,
}

_CITY: dict[str, list[tuple[int, Optional[int]]]] = {}   # city_norm → [(city_id, region_id), …]
_REGION_NORM: dict[str, int] = {}                        # norm(region_ar) → region_id


def _load() -> None:
    if _CITY:
        return
    c = db.sb()
    cat = c.table("loc_catalog_city").select("city_norm,city_id,region_id").execute().data or []
    cid2reg = {r["city_id"]: r["region_id"] for r in cat}
    for r in cat:
        _CITY.setdefault(r["city_norm"], []).append((r["city_id"], r["region_id"]))
    for a in (c.table("loc_catalog_city_alias").select("alias_norm,city_id").execute().data or []):
        _CITY.setdefault(a["alias_norm"], []).append((a["city_id"], cid2reg.get(a["city_id"])))
    for r in (c.table("loc_catalog_region").select("region_id,region_ar").execute().data or []):
        _REGION_NORM[norm_ar(r.get("region_ar"))] = r["region_id"]


def _hint_to_id(region_hint: Union[int, str, None]) -> Optional[int]:
    if region_hint is None:
        return None
    if isinstance(region_hint, int):
        return region_hint
    s = str(region_hint).strip()
    if s in REGION_EN_TO_ID:
        return REGION_EN_TO_ID[s]
    n = norm_ar(s)
    stripped = n[len("منطقه "):] if n.startswith("منطقه ") else n
    return _REGION_NORM.get(n) or _REGION_NORM.get(stripped)


def to_catalog(city_ar: Optional[str], region_hint: Union[int, str, None] = None) -> tuple[Optional[int], Optional[int]]:
    """Resolve a source Arabic city/region label → (city_id, region_id).
    Real city → (city_id, region_id); region label → (None, region_id); unresolved/ambiguous → (None, None).
    `region_hint` (region_id, English name, or Arabic label) disambiguates same-name twins."""
    _load()
    n = norm_ar(city_ar)
    if not n:
        return None, None
    hint = _hint_to_id(region_hint)

    def pick(key: str) -> Optional[tuple[int, Optional[int]]]:
        cands = _CITY.get(key)
        if not cands:
            return None
        if len(cands) == 1:
            return cands[0]
        regions = {rid for _, rid in cands}
        if hint is not None:
            for cid, rid in cands:
                if rid == hint:
                    return (cid, rid)
        if len(regions) == 1:
            return cands[0]              # several ids but one region → region is unambiguous
        return None                       # twin across regions, no/!matching hint → don't guess

    hit = pick(n)
    if hit:
        return hit
    # Strip a leading admin prefix («محافظة X» governorate / «منطقة X» region) and retry as a city.
    stripped = n
    for pre in ("محافظه ", "منطقه "):
        if n.startswith(pre):
            stripped = n[len(pre):]
            break
    if stripped != n:
        hit = pick(stripped)
        if hit:
            return hit
    # Otherwise treat it as a region label → region_id only.
    rid = _REGION_NORM.get(n) or _REGION_NORM.get(stripped) or _REGION_NORM.get("منطقه " + n)
    return None, rid


def region_id_for(city_ar: Optional[str], region_hint: Union[int, str, None] = None) -> Optional[int]:
    return to_catalog(city_ar, region_hint)[1]
