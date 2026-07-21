"""THE single shared Arabic-location resolver for every scraper (2026-07-10 architecture redesign —
see docs/LOCATION_RESOLUTION.md). Normalizes a source Arabic city/region/district string and
resolves it to a STABLE Saudi catalog id WITHOUT going through the English pivot.

RULE (owner, 2026-07-10, permanent): no scraper may implement its own placeholder/fallback logic
for a location field ("Other", "Unknown", a hardcoded default, or any invented value). Every
scraper's location resolution MUST route through this module's `resolve()` (new work) or the
pre-existing `to_catalog()`/`resolve_slug()` (unchanged, still supported for the 6 platforms
already calling them directly). An unresolved location is ALWAYS represented as `None` fields —
never a sentinel string. `scrapers/common/db.py`'s shared upsert path additionally enforces this
as a backstop (`_reject_placeholder_location`) so a scraper bug can never write a placeholder to
the database even if it forgets to call this module.

TWIN-SAFE: ~300 catalog city names are ambiguous across regions (e.g. «بيش» exists in both Asir
and Jazan). For those, this NEVER guesses — it resolves only when a region hint disambiguates, or
(new) when a matching district uniquely narrows the candidate set, otherwise leaves it null
(honest, never wrong). Callers pass `region_hint` = whatever region signal they already have
(English name, Arabic label, or a region_id int).

`norm_ar` MUST match the SQL `normalize_ar()` that built loc_catalog_city.city_norm.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Optional, Union

from scrapers.common import db
from scrapers.common.placeholder_tokens import PLACEHOLDER_TOKENS, is_placeholder  # noqa: F401 (re-exported)

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
_REGION_AR_FOR: dict[int, str] = {}                      # region_id → canonical region_ar
_CID_AR: dict[int, str] = {}                             # catalog city_id → canonical city_ar
_DISTRICT_BY_CITY: dict[int, set[str]] = {}              # city_id → {district_norm, …} (disambiguation only)


_LOAD_LOCK = threading.Lock()


def _load() -> None:
    if _CITY:
        return
    # The catalog fetch is often the FIRST network call inside many parallel worker threads (16-shard
    # boots), and a single transient httpx ReadError here used to kill a whole shard (aqarmonthly CI
    # 2026-07-01). Serialize the load (one thread fetches, the rest reuse) and RETRY transient
    # failures with backoff; only raise once the retries are exhausted. Partial state is cleared on
    # failure so a half-built map never serves lookups.
    with _LOAD_LOCK:
        if _CITY:
            return
        last: Exception | None = None
        for attempt in range(4):
            try:
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
                    _REGION_AR_FOR[r["region_id"]] = r["region_ar"]
                for r in (c.table("loc_catalog_district").select("city_id,district_norm").execute().data or []):
                    _DISTRICT_BY_CITY.setdefault(r["city_id"], set()).add(r["district_norm"])
                return
            except Exception as e:  # transient network/DB hiccup → clear partials, back off, retry
                last = e
                _CITY.clear()
                _REGION_NORM.clear()
                _REGION_AR_FOR.clear()
                _CID_AR.clear()
                _DISTRICT_BY_CITY.clear()
                time.sleep(1.5 * (attempt + 1))
        if last is not None:
            raise last


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
    city_ar_val = _CID_AR.get(cid)
    if district_ar and city_ar_val:
        # Bug found live 2026-07-21: Aqar's own slug embeds district+city(+امارة/منطقة marker)
        # back-to-back with no delimiter (e.g. «...حي-المهدية-الرياض-...»), so the up-to-3-token
        # capture above can swallow the city name and/or an admin marker as trailing "district"
        # tokens — e.g. district_ar came out "حي المهدية الرياض" instead of "حي المهدية". Strip a
        # TRAILING run of tokens that are either the just-resolved city name or a known admin marker
        # (never a LEADING token, so a district whose own name happens to equal the city name, e.g.
        # "حي المحالة" in المحالة city, is preserved — just de-duplicated to one occurrence instead
        # of erased). Keeps at minimum "حي" + one content word.
        dist_tokens = district_ar.split()
        city_tokens = city_ar_val.split()
        while len(dist_tokens) > 2:
            if len(dist_tokens) > len(city_tokens) and dist_tokens[-len(city_tokens):] == city_tokens:
                dist_tokens = dist_tokens[:-len(city_tokens)]
                continue
            if dist_tokens[-1] in ("امارة", "منطقة", "منطقه"):
                dist_tokens = dist_tokens[:-1]
                continue
            break
        district_ar = " ".join(dist_tokens)
    return {"city_ar": city_ar_val, "city_id": cid, "region_id": rid or region_id,
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


def _pick_candidate(
    key: str, hint: Optional[int], district_norm: Optional[str] = None,
) -> Optional[tuple[int, Optional[int]]]:
    """Shared candidate-narrowing logic used by BOTH `to_catalog()` and `resolve()` — one codepath,
    two call sites. Never guesses: a twin across regions only resolves via `hint` or (new)
    `district_norm`, and ONLY when that signal narrows the candidate set to EXACTLY one city.
    """
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
    if district_norm:
        # District-based disambiguation (new, 2026-07-10): a district name is an INDEPENDENT signal
        # from the source, not a guess — only narrows when it matches districts of EXACTLY ONE of
        # the ambiguous candidates. If two+ candidates share a district by the same name (or none
        # do), this yields nothing and the caller stays unresolved, same as today.
        matches = [(cid, rid) for cid, rid in cands if district_norm in _DISTRICT_BY_CITY.get(cid, ())]
        if len(matches) == 1:
            return matches[0]
    return None                       # twin across regions, no/non-unique hint → don't guess


def to_catalog(city_ar: Optional[str], region_hint: Union[int, str, None] = None) -> tuple[Optional[int], Optional[int]]:
    """Resolve a source Arabic city/region label → (city_id, region_id).
    Real city → (city_id, region_id); region label → (None, region_id); unresolved/ambiguous → (None, None).
    `region_hint` (region_id, English name, or Arabic label) disambiguates same-name twins.
    UNCHANGED behavior (existing callers: aqargate/aqarmonthly/aldarim/alhoshan/hajer/sanadak) — no
    district disambiguation here; use `resolve()` for that."""
    _load()
    n = norm_ar(city_ar)
    if not n:
        return None, None
    hint = _hint_to_id(region_hint)

    hit = _pick_candidate(n, hint)
    if hit:
        return hit
    # Strip a leading admin prefix («محافظة X» governorate / «منطقة X» region) and retry as a city.
    stripped = n
    for pre in ("محافظه ", "منطقه "):
        if n.startswith(pre):
            stripped = n[len(pre):]
            break
    if stripped != n:
        hit = _pick_candidate(stripped, hint)
        if hit:
            return hit
    # Otherwise treat it as a region label → region_id only; failing that, fall back to an explicit
    # region hint (e.g. a structured «منطقة …» field) so an unknown city still keeps its real region.
    rid = _REGION_NORM.get(n) or _REGION_NORM.get(stripped) or _REGION_NORM.get("منطقه " + n)
    return None, (rid or hint)


def region_id_for(city_ar: Optional[str], region_hint: Union[int, str, None] = None) -> Optional[int]:
    return to_catalog(city_ar, region_hint)[1]


def resolve(
    city_ar: Optional[str],
    district_ar: Optional[str] = None,
    region_hint: Union[int, str, None] = None,
) -> dict:
    """THE recommended entry point for NEW/migrated scrapers (2026-07-10 architecture redesign).
    Resolves city + region + (when possible) district in one call, using the SAME never-guess
    candidate logic as `to_catalog()` (via `_pick_candidate`), PLUS district-based disambiguation
    for twin city names when a region_hint alone doesn't narrow it.

    A scraper's OWN placeholder/fallback logic (e.g. `city = X or "Other"`) must NOT exist anywhere
    downstream of this call — if this returns city_id=None, the caller writes None, never a sentinel.
    `is_placeholder()` guards against a raw value that's already junk (e.g. an upstream API field
    that itself contains the literal word "Other") — such input is treated as absent, never resolved.

    Returns {city_ar, city_id, region_id, region_ar, district_ar, district_id, confidence} where
    confidence is one of: 'city' (region-unambiguous or region-hint-confirmed), 'city+district'
    (only resolved via district disambiguation), 'region_only', 'unresolved'.
    """
    _load()
    empty = {"city_ar": None, "city_id": None, "region_id": None, "region_ar": None,
             "district_ar": None, "district_id": None, "confidence": "unresolved"}
    if is_placeholder(city_ar):
        return dict(empty)
    n = norm_ar(city_ar)
    if not n:
        return dict(empty)
    hint = _hint_to_id(region_hint)
    d_ar = None if is_placeholder(district_ar) else (district_ar or None)
    d_norm = norm_ar(d_ar) if d_ar else None

    def _finish(cid: int, rid: Optional[int], confidence: str) -> dict:
        return {
            "city_ar": _CID_AR.get(cid), "city_id": cid, "region_id": rid,
            "region_ar": _REGION_AR_FOR.get(rid) if rid is not None else None,
            "district_ar": d_ar, "district_id": None, "confidence": confidence,
        }

    # Try the plain hint-based resolution first (region-unambiguous, or region_hint confirms it).
    hit = _pick_candidate(n, hint)
    stripped = n
    for pre in ("محافظه ", "منطقه "):
        if n.startswith(pre):
            stripped = n[len(pre):]
            break
    if not hit and stripped != n:
        hit = _pick_candidate(stripped, hint)
    if hit:
        return _finish(hit[0], hit[1], "city")

    # Region hint didn't narrow it — try district-based disambiguation before giving up.
    if d_norm:
        hit = _pick_candidate(n, hint, district_norm=d_norm) or (
            _pick_candidate(stripped, hint, district_norm=d_norm) if stripped != n else None)
        if hit:
            return _finish(hit[0], hit[1], "city+district")

    # Unresolved as a city — same region-label fallback to_catalog() uses.
    rid = _REGION_NORM.get(n) or _REGION_NORM.get(stripped) or _REGION_NORM.get("منطقه " + n) or hint
    if rid:
        return {"city_ar": None, "city_id": None, "region_id": rid, "region_ar": _REGION_AR_FOR.get(rid),
                "district_ar": d_ar, "district_id": None, "confidence": "region_only"}
    return dict(empty) | {"district_ar": d_ar}
