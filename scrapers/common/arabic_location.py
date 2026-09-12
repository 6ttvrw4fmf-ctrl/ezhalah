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
_DISTRICT_AR_BY_NORM: dict[str, str] = {}                # district_norm → canonical district_ar (catalog spelling)


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
                for r in (c.table("loc_catalog_district").select("city_id,district_norm,district_ar").execute().data or []):
                    _DISTRICT_BY_CITY.setdefault(r["city_id"], set()).add(r["district_norm"])
                    _DISTRICT_AR_BY_NORM.setdefault(r["district_norm"], r["district_ar"])
                return
            except Exception as e:  # transient network/DB hiccup → clear partials, back off, retry
                last = e
                _CITY.clear()
                _REGION_NORM.clear()
                _REGION_AR_FOR.clear()
                _CID_AR.clear()
                _DISTRICT_BY_CITY.clear()
                _DISTRICT_AR_BY_NORM.clear()
                time.sleep(1.5 * (attempt + 1))
        if last is not None:
            raise last


def city_ar_for(city_id: Optional[int]) -> Optional[str]:
    _load()
    return _CID_AR.get(city_id) if city_id is not None else None


# Tokens that are admin/street markers, never a city — skip them when scanning for a city in a slug.
_SLUG_STOP = {"شارع", "طريق", "حي", "امارة", "منطقه", "مدينه", "ممر", "مخطط", "حى", "ال"}


# Trailing admin markers, in NORMALISED form (norm_ar folds ة→ه, so «منطقة»→«منطقه»).
_ADMIN_SUFFIX_TOKENS = ("اماره", "منطقه")


def strip_city_suffix(district_ar: Optional[str], city_ar: Optional[str]) -> Optional[str]:
    """Strip a TRAILING run of city/admin tokens that a delimiter-less source slug glued onto the
    district — e.g. «...حي-المهدية-الرياض-...» captured as district «حي المهدية الرياض».

    Bug found live 2026-07-21; the SQL backfill (20260721104637) cleaned the history, but this guard
    shipped WITHOUT two of that migration's rules and so kept re-introducing the corruption on every
    re-scrape (38 rows dirty again by 2026-08-22, 0 of them catchable here). The two missing rules,
    now restored so code and backfill are the same algorithm:

      1. Compare NORMALISED tokens (norm_ar: أإآٱ→ا, ة→ه, ى→ي, tatweel/bidi stripped). Raw comparison
         missed «حي المروج ابها» against city «أبها» — same word, different alef — and «أبهــــا».
      2. Also strip the city's FIRST token alone, for sources that abbreviate an official two-word
         city: «حي أم الجود مكة» in «مكة المكرمة», «حي بني حارثة المدينة» in «المدينة المنورة».

    Deliberately conservative, and never a source of invented precision:
      * Only a TRAILING run is removed, so a district whose own name contains the city name keeps it
        («حي أبها الجديدة ابها» → «حي أبها الجديدة», not «الجديدة»).
      * At least two tokens always survive, so «حي أحد» in «احد رفيده» is untouched.
      * Only THIS row's resolved city is stripped. A foreign city token is left exactly as published
        («حي المطار ابها خميس» in «خميس مشيط» → «حي المطار ابها»).
      * It only ever REMOVES tokens the source glued on. It never renames a district, never upgrades
        a region label into a city, and never fills a blank — an unresolved location stays unresolved
        (see to_catalog, which must keep refusing «منطقة X» → city X; audit 2026-08-10).
    """
    if not district_ar or not city_ar:
        return district_ar
    dist_tokens = district_ar.split()
    dist_norm = [norm_ar(t) for t in dist_tokens]
    city_norm = norm_ar(city_ar).split()
    if not city_norm:
        return district_ar
    while len(dist_tokens) > 2:
        cn = len(city_norm)
        if len(dist_tokens) > cn and dist_norm[-cn:] == city_norm:   # full city name
            dist_tokens, dist_norm = dist_tokens[:-cn], dist_norm[:-cn]
            continue
        if dist_norm[-1] == city_norm[0]:                            # official name abbreviated
            dist_tokens, dist_norm = dist_tokens[:-1], dist_norm[:-1]
            continue
        if dist_norm[-1] in _ADMIN_SUFFIX_TOKENS:                    # امارة / منطقة marker
            dist_tokens, dist_norm = dist_tokens[:-1], dist_norm[:-1]
            continue
        break
    return " ".join(dist_tokens)


def trailing_catalog_city_norm(district_ar: Optional[str]) -> Optional[str]:
    """The catalog `city_norm` that the district's TRAILING 1-3 tokens spell (longest window wins),
    else None.

    Deliberately ID-FREE: it answers "is this a city name", never "which city is this", so it stays
    right about a same-name twin that `_pick_candidate()` must refuse to resolve. That distinction is
    the whole point — the cohort that produced the glued districts in the first place is exactly the
    one where the city is an unresolvable twin, so a rule that needs a city_id can never clean it.

    Python mirror of SQL `public.district_trailing_catalog_city_norm()`; the two are ONE algorithm and
    their parity is pinned by scripts/verify-aqarmonthly-district-suffix-guard.ts. It never invents
    precision: it only ever reports a name the catalog already carries, and the caller still hands the
    result to strip_city_suffix(), which keeps the trailing-only and two-token-floor invariants.
    """
    _load()
    toks = (district_ar or "").split()
    for size in (3, 2, 1):  # longest window wins, mirroring the SQL's `order by w.sz desc`
        if len(toks) >= size:
            key = " ".join(norm_ar(t) for t in toks[-size:])
            if key in _CITY:
                return key
    return None


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
        # The city is unresolvable (no catalog hit, or a same-name twin _pick_candidate() refuses to
        # guess) — but the source still GLUED it onto the district, so the district is still dirty.
        # Strip it by NAME without ever claiming which city it is: exactly what the canonical SQL
        # does (`strip_district_city_suffix(d, district_trailing_catalog_city_norm(d))`), and what
        # mon_detect_aqarmonthly_district_city_suffix()'s two city-NULL limbs assert of stored rows.
        # Leaving it unstripped here is what put «حي المجد القرى القري» in the served index and kept
        # that P2 re-raising: the parser and the detector were reading two different rules.
        # strip_city_suffix() still returns the district untouched when this yields None.
        return {"city_ar": None, "city_id": None, "region_id": region_id,
                "district_ar": strip_city_suffix(district_ar, trailing_catalog_city_norm(district_ar)),
                "confidence": "unresolved"}
    cid, rid = best
    city_ar_val = _CID_AR.get(cid)
    district_ar = strip_city_suffix(district_ar, city_ar_val)
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
    # Strip a leading «محافظة X» (governorate) and retry as a city: a governorate is named after its
    # seat city, so «محافظة الخرج» → الخرج is a real city resolution.
    #
    # «منطقة X» is NOT stripped and retried (audit 2026-08-10). One of the 13 regions is an
    # administrative area, never a city, even though 'منطقة الرياض' and the city 'الرياض' share a
    # name. Retrying it as a city silently upgraded a region-level source value into a specific city:
    # alhoshan/584386 published city 'منطقة الرياض' and we resolved city_id=3 (الرياض city) — but the
    # listing's own title says حي الرمال… and alhoshan/584369 published 'منطقة القصيم' for a listing
    # whose title says البدائع, a different city entirely. That fabricates precision the source never
    # gave, against the exact-location-only rule (honest unknown, never invent). A region label must
    # fall through to the region-only branch below: (None, region_id).
    stripped = n
    if n.startswith("محافظه "):
        stripped = n[len("محافظه "):]
    if stripped != n:
        hit = _pick_candidate(stripped, hint)
        if hit:
            return hit
    # A «منطقة X» label still needs its region resolved from the bare name below.
    if n.startswith("منطقه "):
        stripped = n[len("منطقه "):]
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
    # «محافظة X» (governorate) IS named after its seat city, so retrying it as a city is a real
    # resolution. «منطقة X» is NOT — audit 2026-08-10: one of the 13 regions is an administrative
    # area that merely shares a city's name, so retrying it as a city silently upgrades a
    # region-level source value into a specific city and fabricates precision the source never gave
    # (exact-location-only: honest unknown, never invent). to_catalog() was fixed then; resolve()
    # kept the hole and still returned city_id=3/confidence="city" for «منطقة الرياض» until
    # 2026-08-23 — and resolve() is the path this module tells new scrapers to use, and the one
    # scrapers/gathern/run.py already calls. Two strings for two different jobs: only the
    # governorate form may retry as a CITY; the region form is stripped solely to look up a REGION.
    city_stripped = n[len("محافظه "):] if n.startswith("محافظه ") else n
    region_stripped = n[len("منطقه "):] if n.startswith("منطقه ") else city_stripped
    if not hit and city_stripped != n:
        hit = _pick_candidate(city_stripped, hint)
    if hit:
        return _finish(hit[0], hit[1], "city")

    # Region hint didn't narrow it — try district-based disambiguation before giving up.
    if d_norm:
        hit = _pick_candidate(n, hint, district_norm=d_norm) or (
            _pick_candidate(city_stripped, hint, district_norm=d_norm) if city_stripped != n else None)
        if hit:
            return _finish(hit[0], hit[1], "city+district")

    # Unresolved as a city — same region-label fallback to_catalog() uses.
    rid = _REGION_NORM.get(n) or _REGION_NORM.get(region_stripped) or _REGION_NORM.get("منطقه " + n) or hint
    if rid:
        return {"city_ar": None, "city_id": None, "region_id": rid, "region_ar": _REGION_AR_FOR.get(rid),
                "district_ar": d_ar, "district_id": None, "confidence": "region_only"}
    return dict(empty) | {"district_ar": d_ar}


_PLAN_WORD = "مخطط"  # a subdivision-PLAN reference ("مخطط الربوة", "مخطط تلال مكة") is never a district,
# even when the plan's own name matches a real district elsewhere — see district_ar_looks_bogus()
# (20260911201847) for the same rule enforced DB-side on already-stored text.


def find_district_in_text(text: Optional[str], city_id: Optional[int]) -> Optional[str]:
    """Recognizes a REAL district of `city_id` mentioned in free text (a title, a description) — for
    sources that publish no separate district field/taxonomy at all (remal: class_list gives only an
    unresolvable numeric term id; azdad: the district field is sometimes blank but the source's own
    free-text `location` line still names the place). This NEVER invents: a candidate is accepted
    ONLY when it is an EXACT match (city-scoped) against loc_catalog_district — the same curated
    table `resolve()`'s district-disambiguation already trusts, and the same "100%-certain,
    catalog-attested" bar this repo's EN→AR district mapping standard requires. A phrase that merely
    LOOKS like a place name (a landmark, a plan/scheme name, a housing-program name) and isn't in the
    catalog is silently rejected, never guessed at — see the module docstring's exact-location-only
    rule. Returns the catalog's OWN canonical spelling (never the source's raw substring), so a
    matched district always renders and searches identically to every other listing for that place.

    Tries 3-, then 2-, then 1-word windows (longer / more specific first) over every run of Arabic
    letters in `text`, skipping any window containing `مخطط` — a subdivision-plan reference is a
    plan, never a district, no matter what its own name happens to be (measured live on remal,
    2026-09-11: "مخطط الربوة" / "مخطط تلال مكة" / "مخطط الصفوة" are NOT in loc_catalog_district for
    Mecca at all, while "الرصيفة" / "الخالدية" / "الشوقية" / "العوالي" / "الكعكية" — each stated
    plainly in a title with no مخطط anywhere near it — are real, catalog-confirmed Mecca districts).
    """
    _load()
    if not text or not city_id:
        return None
    known = _DISTRICT_BY_CITY.get(city_id)
    if not known:
        return None
    words = re.findall(r"[؀-ۿ]+", text)
    # A leading ب/ل (bi-/li-) ATTACHES directly to the following word with no space ("بالشوقية" is
    # one token, ب + الشوقية) — try the word as-scraped AND with that one leading letter stripped, so
    # "بالشوقية"/"للرصيفة" still isolate the noun ("الشوقية"/"الرصيفة") a window can match. Only the
    # word's OWN two forms are tried; a multi-word window uses its first word's own list here too.
    def _forms(word: str) -> list[str]:
        if len(word) > 2 and word[0] in "بل":
            return [word, word[1:]]
        return [word]

    for size in (3, 2, 1):
        for i in range(len(words) - size + 1):
            window = words[i:i + size]
            if _PLAN_WORD in window:
                continue
            for first in _forms(window[0]):
                candidate = " ".join([first, *window[1:]])
                for form in (candidate, f"حي {candidate}"):
                    n = norm_ar(form)
                    if n in known:
                        ar = _DISTRICT_AR_BY_NORM.get(n)
                        if ar:
                            return ar
    return None
