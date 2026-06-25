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
_CID_AR: dict[int, str] = {}                             # catalog city_id → canonical city_ar


def _load() -> None:
    if _CITY:
        return
    c = db.sb()
    cat = c.table("loc_catalog_city").select("city_norm,city_id,region_id,city_ar").execute().data or []
    cid2reg = {r["city_id"]: r["region_id"] for r in cat}
    for r in cat:
        _CITY.setdefault(r["city_norm"], []).append((r["city_id"], r["region_id"]))
        _CID_AR[r["city_id"]] = r["city_ar"]
    for a in (c.table("loc_catalog_city_alias").select("alias_norm,city_id").execute().data or []):
        _CITY.setdefault(a["alias_norm"], []).append((a["city_id"], cid2reg.get(a["city_id"])))
    for r in (c.table("loc_catalog_region").select("region_id,region_ar").execute().data or []):
        _REGION_NORM[norm_ar(r.get("region_ar"))] = r["region_id"]


def city_ar_for(city_id: Optional[int]) -> Optional[str]:
    _load()
    return _CID_AR.get(city_id) if city_id is not None else None


# Tokens that are admin/street markers, never a city — skip them when scanning for a city in a slug.
_SLUG_STOP = {"شارع", "طريق", "حي", "امارة", "منطقه", "مدينه", "ممر", "مخطط", "حى", "ال"}


def resolve_slug(text: Optional[str], region_hint: Union[int, str, None] = None) -> dict:
    """DETERMINISTIC Arabic R/C/D parse from an Aqar-style slug/title, VALIDATED against the catalog
    (no loose substring matching). Priority within the parser:
      1. region from «منطقة X» (explicit) → region_id
      2. city = the catalog city (region-scoped) sitting right before «منطقة», else a region-scoped
         whole-token catalog match anywhere in the slug — matched as WHOLE catalog city names only
      3. district from «حي Y»
    Returns {city_ar, city_id, region_id, district_ar, confidence}. confidence='unresolved' when no
    catalog city validates — caller keeps it null rather than guessing.
    """
    _load()
    raw = (text or "").replace("-", " ")
    n = norm_ar(raw)
    if not n:
        return {"city_ar": None, "city_id": None, "region_id": None, "district_ar": None, "confidence": "unresolved"}

    # 1) region from «منطقة X» (2-word then 1-word), validated against the region catalog.
    region_id: Optional[int] = None
    mr = re.search(r"منطقه\s+([؀-ۿ]+(?:\s+[؀-ۿ]+)?)", n)
    if mr:
        cand = mr.group(1)
        for k in (cand, cand.split()[0]):
            rid = _REGION_NORM.get("منطقه " + k) or _REGION_NORM.get(k)
            if rid:
                region_id = rid
                break
    if region_id is None and region_hint is not None:
        region_id = _hint_to_id(region_hint)

    # 3) district from «حي Y» (keep the original spelling from raw, up to 3 words).
    district_ar = None
    md = re.search(r"\bحي\s+([؀-ۿ]+(?:\s+[؀-ۿ]+){0,2})", raw)
    if md:
        district_ar = "حي " + re.sub(r"\s+", " ", md.group(1)).strip()

    def _scan(tokens: list[str]) -> Optional[tuple[int, int]]:
        """Find a WHOLE-NAME catalog city in tokens, region-scoped to region_id when known. Picks the
        RIGHTMOST match (Aqar slugs put the city LAST — «‹street/district›-‹city›»; a district name
        that happens to also be a catalog city sits earlier, so leftmost-match mis-picks it). A
        same-name twin with no region scope is skipped (never guessed)."""
        hits: list[tuple[int, int, tuple[int, int]]] = []  # (end_index, size, (city_id, region_id))
        for size in (3, 2, 1):
            for i in range(len(tokens) - size + 1):
                key = " ".join(tokens[i:i + size])
                if key in _SLUG_STOP:
                    continue
                cands = _CITY.get(key)
                if not cands:
                    continue
                pick = None
                if region_id is not None:
                    for cid, rid in cands:
                        if rid == region_id:
                            pick = (cid, rid)
                            break
                elif len(cands) == 1 or len({r for _, r in cands}) == 1:
                    pick = cands[0]
                if pick:
                    hits.append((i + size, size, pick))
        if not hits:
            return None
        hits.sort(key=lambda h: (h[0], h[1]), reverse=True)  # rightmost end, then longest window
        return hits[0][2]

    # 2a) when region is known, the city is the token(s) right before «(امارة )?منطقة» — region-scoped.
    best: Optional[tuple[int, int]] = None
    if region_id is not None:
        mc = re.search(r"([؀-ۿ]+(?:\s+[؀-ۿ]+)?)\s+(?:امارة\s+)?منطقه", n)
        if mc:
            best = _scan(mc.group(1).split())
    # 2b) otherwise the rightmost whole-name catalog city in the slug (Aqar puts the city last).
    if not best:
        best = _scan(n.split())

    if not best:
        return {"city_ar": None, "city_id": None, "region_id": region_id, "district_ar": district_ar, "confidence": "unresolved"}
    cid, rid = best
    return {"city_ar": _CID_AR.get(cid), "city_id": cid, "region_id": rid or region_id,
            "district_ar": district_ar, "confidence": "slug"}


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
