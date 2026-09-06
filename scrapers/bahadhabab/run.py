"""Bahadhabab scraper -- a Nuzul SaaS tenant (same platform as aldarim/abwbna).

Found 2026-09-06 as a fourth Nuzul SaaS tenant (aldarim, abwbna, and this pair, discovered
the same way -- 'nzl-backend.com' visible in the page HTML, giving the exact tenant subdomain
rather than guessing from the site's own domain, which failed for this pair on the first try
(bahadhabab-res.nzl-backend.com, not bahadhabab.nzl-backend.com). Same public JSON API, no
auth, byte-identical shape. 71 listings: 53 available, 17 rented, 1 sold -- availability_status
also carries 'rented' here (not just 'sold'/'reserved'), excluded by the same existing guard.

This file is a close clone of scrapers/aldarim/run.py -- see that file, and scrapers/abwbna/run.py,
for the full rationale behind every tri-state flag, the kitchen/age resolvers, and the photo
extraction. Only the endpoint, source name, and ad-number prefix differ.

CITY IS OWNER-CONFIRMED, NOT INFERRED. Unlike every other Nuzul tenant, this API publishes
`city: null` and `district: null` on every one of the 71 listings sampled 2026-09-06 -- no false
signal to misread (no default-pin coordinate the way danaalkhair had), just genuine silence.
Owner directive (2026-09-06): "this website is a brokerage in الباحة so put them all in that city
... whenever we get a new listing from them put it in that city." That is a business fact about
the advertiser, not an algorithmic guess from ambiguous data -- CITY is therefore hardcoded to
Al Baha for every row, unconditionally, and does NOT depend on anything in the payload.

DISTRICT IS DIFFERENT: it is read from the source's OWN TEXT where the source states it. The
`description_ar` free-text field carries a hand-typed «الحي: <name>» line on 12 of 71 sampled rows
(e.g. "الحي: النسيم - الحماد" / "المدينة: الباحه"), and the district value is extracted from
THAT — a literal source statement, not a guess. Where the line reads "<district> - الباحة" the
trailing city repeat is stripped (it is the SAME fact as the hardcoded city, not new district
information).

OWNER-FLAGGED 2026-09-06: «الحي:» is a SELL-listing habit — RENT listings almost never use it
(measured live: 41/42 rent rows on one page instead hand-type «الموقع: <text>», e.g. "الموقع: حي
بنى فروه خلف الخطوط السعودية"). Read the same way, in priority order: a labelled «الحي:» line,
then a labelled «الموقع:» line, then an inline parenthetical «(حي …)» mention anywhere in the
free text (e.g. "بقرية الجاديه ( حي الضباب )"). All three strip the same closed set of landmark
connectors ("خلف", "بجوار", "قرب", "مقابل", …) that locate the property RELATIVE to a place but
are never part of the place name — a value that is ENTIRELY a landmark clause (e.g. "مقابل
الأحوال المدنية") correctly collapses to no signal rather than storing the landmark as a district.
Rows with none of these three shapes have neighborhood stay NULL, never invented.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize
from scrapers.common.arabic_location import to_catalog

# PDPL: never store advertiser contact/identity. The rest of the API item is kept.
_PII = {"whatsapp_number", "rega_advertiser_number"}

API = "https://bahadhabab-res.nzl-backend.com/api/public/properties"
SITE = "https://www.bahadhabab-res.com/properties"
HEADERS = {"Accept": "application/json", "Origin": "https://www.bahadhabab-res.com",
           "Referer": "https://www.bahadhabab-res.com/"}
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))
PER_PAGE = 50

# Aldarim `type` (lowercased) → canonical taxonomy, and Aldarim city name_en → canonical label:
# both UNIFIED 2026-07-16 (fix/normalize-unification). The private TYPE_MAP/CITY_MAP that lived here
# moved VERBATIM into scrapers/common/normalize.py TYPE_MAP_EN / CITY_MAP_EN (zero key/value
# conflicts with Wasalt's vocabulary — Aldarim's keys are all-lowercase, Wasalt's are Title-Case),
# so shared fixes now propagate here. Lookups go through normalize.map_type_en()/map_city_en() —
# EXACT, case-sensitive, no substring pass — byte-identical for every previously-mapped input
# (golden proof: scrapers/common/tests/test_normalize_unification_golden.py). Aldarim currently
# needs NO per-platform overrides; if one ever appears, pass overrides= per the
# normalize.map_type_exact contract instead of forking a private map.
# A few types we treat as commercial-land when category is commercial (call-site rule, stays here).
_LAND_TYPES = {"land"}

# Owner-confirmed business fact (2026-09-06): this advertiser is a single-region brokerage in
# الباحة (Al Baha). The API publishes city:null on every row, so this does not override anything
# the source states — see the module docstring for why that is different from an inferred default.
OWNER_CITY_AR = "الباحة"

# «الحي: <name>» (or «حي: <name>», without the ال) as the advertiser hand-types it inside
# description_ar. Verified live 2026-09-06 on 12/71 rows, e.g. "الحي: النسيم - الحماد".
_DISTRICT_LABEL_RE = re.compile(r"(?:^|\n)\s*(?:ال)?حي\s*[:：]\s*([^\n]+)")
# A district line sometimes repeats the city as a trailing "- الباحة" (e.g. "العقيق - الباحة") —
# that is the SAME fact as OWNER_CITY_AR, not additional district information, so it is stripped.
_DISTRICT_CITY_SUFFIX_RE = re.compile(r"\s*[-–]\s*البا?ح[ةه]\s*$")

# RENT ads almost never use «الحي:» — owner-flagged 2026-09-06, measured live: of 71 sampled rows,
# 12 sell listings carry «الحي:» but RENT listings instead hand-type «الموقع: <text>» (41/42 rent
# rows on one page). Same free-text tier of confidence (the advertiser stating a real place), just
# a different label. Two shapes: «الموقع: حي <name> …» (the حي IS the district) and «الموقع:
# <village/quarter name> …» (the whole clause is the location) — both often trail landmark prose
# ("خلف …", "بجوار …") that is never part of the place name and must be cut, not guessed past.
_LOCATION_LABEL_RE = re.compile(r"(?:^|\n)\s*الموقع\s*[:：]\s*([^\n]+)")
# A «حي <name>» mention can also appear inline, in parentheses, anywhere in the free text (not on
# its own labelled line) — e.g. "بقرية الجاديه ( حي الضباب )" — same literal source statement.
_PAREN_DISTRICT_RE = re.compile(r"\(\s*(?:ال)?حي\s+([^()]+?)\s*\)")
# A small, closed set of landmark-connector words the advertiser uses to locate the property
# RELATIVE to a place, never part of the place name itself (e.g. "بنى فروه خلف الخطوط السعودية" —
# the district is "بنى فروه", "خلف الخطوط السعودية" is a landmark). Cut there, never past it — a
# value with NOTHING before the connector (e.g. "مقابل الأحوال المدنية") correctly collapses to "".
_LANDMARK_CUT_RE = re.compile(
    r"(?:^|\s+)(?:خلف|بالقرب من|قريب من|قرب|بجوار|مجاور|امام|أمام|مقابل)\b.*$")
# «الموقع:»/paren values sometimes restate the «حي» word itself (e.g. "حي الباهر - الباحة") — strip
# it so the stored name matches how every other platform's own district_ar is shaped (bare name,
# no «حي» prefix — see abwbna/alobid's own district_ar column).
_LEADING_HAY_RE = re.compile(r"^(?:ال)?حي\s+")


def _clean_location_value(raw: str) -> Optional[str]:
    v = _LANDMARK_CUT_RE.sub("", raw.strip()).strip()
    v = _DISTRICT_CITY_SUFFIX_RE.sub("", v).strip()
    v = _LEADING_HAY_RE.sub("", v).strip()
    return v or None


def _district_from_description(desc: Optional[str]) -> Optional[str]:
    """The source's own district-equivalent free text, or None — never invented when absent.

    Tries, in order: a labelled «الحي:» line, a labelled «الموقع:» line, then an inline
    parenthetical «(حي …)» mention — the first of these the source actually wrote wins."""
    if not desc:
        return None
    m = _DISTRICT_LABEL_RE.search(desc)
    if m:
        d = _clean_location_value(m.group(1))
        if d:
            return d
    m = _LOCATION_LABEL_RE.search(desc)
    if m:
        d = _clean_location_value(m.group(1))
        if d:
            return d
    m = _PAREN_DISTRICT_RE.search(desc)
    if m:
        d = _clean_location_value(m.group(1))
        if d:
            return d
    return None


def _city(v) -> Optional[str]:
    # Forward-fix (2026-07-10 location-data-quality audit): an honest None beats the literal "Other"
    # sentinel this used to fall back to when the source had no city name at all.
    # Unmapped raw name passes through unchanged (byte-identical to the old CITY_MAP.get(raw, raw)).
    raw = _name(v)
    if not raw:
        return None
    return normalize.map_city_en(raw) or raw

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update(HEADERS)
    return s


def fetch_page(s: cc.Session, page: int) -> tuple[list[dict], int]:
    """Return (listings, last_page) for one API page."""
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(f"{API}?page={page}&per_page={PER_PAGE}", timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        d = r.json()
        meta = d.get("meta") or {}
        return (d.get("data") or []), int(meta.get("last_page") or 1)
    return [], 1


def _name(v: Any) -> Optional[str]:
    """city/district come as {id,name_en,name_ar} (or sometimes a plain string)."""
    if isinstance(v, dict):
        return v.get("name_en") or v.get("name_ar")
    return v if isinstance(v, str) else None


# JSON-native numeric parse, unified 2026-07-16: the identical `_int` body that lived here (and in
# scrapers/mustqr/run.py) is now normalize.to_int_numeric — byte-for-byte the same semantics
# (None/""/0/"0" → None, int(float(v)) otherwise), so future numeric fixes land once, not thrice.
# normalize.to_int() would NOT be behaviour-identical on these API shapes (see its docstring).
_int = normalize.to_int_numeric


def _kitchen_state(is_installed: Any, kitchens: Any) -> Optional[bool]:
    """aldarim's kitchen signals → true / false / UNKNOWN, never a manufactured negative.

    `bool(is_kitchen_installed) or _int(kitchens) is not None` mapped BOTH "aldarim said 0" and
    "aldarim sent null" to False, so 12 listings aldarim published nothing about recorded a
    confident "this property has NO kitchen".

    WHY THE SAFETY BARRIER MISSED IT. detect_manufactured_negatives() flags a column that is false
    somewhere and true nowhere — "it can only ever say no, so it is not reading anything". `kitchen`
    has 14 real trues on aldarim, so it looked healthy while 12 of its values were fabricated. A
    column can be PARTLY manufactured and still pass that barrier, which is why this needs a
    flag-level test rather than another platform-wide count.

    Measured over the stored source_capture, which retains aldarim's full payload:
        is_kitchen_installed = 0, kitchens = 0     -> 112 res + 34 com   aldarim SAYS no kitchen
        is_kitchen_installed = 0, kitchens = 1..4  ->  14 res            counted kitchens
        is_kitchen_installed = null, kitchens null ->   7 res +  5 com   aldarim says nothing
        is_kitchen_installed = 1                   ->   0 rows anywhere

    The flag is never affirmative on this platform — the COUNT is the only positive signal aldarim
    publishes — but a published 0 is still a REAL negative and must be preserved. Retracting the
    column wholesale (the obvious reading of "false with no trues") would have destroyed 146 source
    values; only the 12 nulls were ours, retracted by migration 20260811095857.

    Order matters: a non-zero count proves a kitchen even when the flag reads 0 (the pre-existing
    widening, unchanged), then the flag decides, and only a null/blank flag yields honest unknown.
    """
    if _int(kitchens) is not None:          # a counted kitchen is proof, whatever the flag says
        return True
    if is_installed is None or is_installed == "":
        return None                          # aldarim said nothing — not a denial
    return str(is_installed).strip() not in ("0", "false", "False")


def _flag(v: Any) -> Optional[bool]:
    """Aldarim's 0/1 feature flags → true / false / UNKNOWN, never a manufactured negative.

    `bool(L.get(k))` maps BOTH "the API said 0" and "the API sent null" to False, so a listing
    aldarim said nothing about recorded a confident "this property does NOT have air conditioning".
    Same absence→False class as aqar `_flag` (PR#327) and the abeea/eastabha tri-state work (PR#449).

    Aldarim genuinely publishes the negative, so `false` here is a REAL value and must be kept:
    measured 2026-08-11 over the active inventory, `is_ac_installed` is "0" on 157 rows and null on
    only 12. That is exactly why this returns None instead of the whole column being retracted —
    123 residential + 34 commercial rows carry a source-published "no".
    """
    if v is None or v == "":
        return None
    if isinstance(v, str):
        return v.strip() not in ("0", "false", "False")
    return bool(v)


# Ageless types never carry a property_age even when the seller typed one (mizlaj PR#265 precedent).
AGELESS_TYPES = {"Residential Land", "Commercial Land", "Gas Station"}


def _age_from_year_built(v) -> Optional[int]:
    """aldarim's `year_built` → an exact age in years, or None.

    The API field is seller FREE-ENTRY that aldarim.sa renders as «العمر» (Age) — live-verified
    2026-07-30 (/en/properties/43143 shows «العمر:24 سنة» for year_built="24"). Shapes observed
    across every active row:
      * "0"            — the API's not-provided sentinel (133/167 rows; their live pages show no age
                         at all) → None. The old `if L.get("year_built")` guard let the truthy STRING
                         "0" through and fabricated property_age=0 («جديد») for all of them.
      * "2000".."2026" — a build year → age = scrape-year − year (a next-year build floors to 0:
                         new/under construction).
      * "1" / "24"     — an age typed directly (not a plausible year) → the shared bounds gate.
    Anything else (e.g. "500") is unknowable → None, never a guess."""
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    year_now = datetime.now(timezone.utc).year
    if 1900 <= n <= year_now + 2:
        return max(0, year_now - n)
    return normalize.parse_property_age(n)


def _photos(L: dict) -> list[str]:
    out: list[str] = []
    cov = L.get("cover_image_url")
    if isinstance(cov, str) and cov.startswith("http"):
        out.append(cov)
    for im in L.get("images") or []:
        u = im.get("url") if isinstance(im, dict) else im
        if isinstance(u, str) and u.startswith("http") and u not in out:
            out.append(u)
    return out[:30]


# additional_info: the rich Aldarim extras, as label/value rows (the card's "Additional Information"
# panel). NO rega_ad_number — user doesn't want it. Street widths + usage ARE wanted.
_EXTRA_FIELDS = [
    ("year_built", "Age"), ("facade", "Facade"),
    ("plan_number", "Plan number"), ("plot_number", "Land number"),
    ("number_of_floors", "Total Floors"), ("unit_floor_number", "Floor"),
    ("majlis_rooms", "Majlis"), ("living_rooms", "Living rooms"),
    ("maid_rooms", "Maid room"), ("driver_rooms", "Driver room"),
    ("parking_spots", "Parking spots"),
    ("street_width", "Street width"), ("street_width_east", "Street width (E)"),
    ("street_width_west", "Street width (W)"), ("street_width_north", "Street width (N)"),
    ("street_width_south", "Street width (S)"),
]


def _additional_info(L: dict) -> list[dict[str, Any]]:
    rows = []
    # Usage (Residential/Commercial) — shown on aldarim.sa, wanted on our card.
    usage = (L.get("category") or "").title()
    if usage:
        rows.append({"key": "usage", "label": "Property usage", "value": usage})
    for key, label in _EXTRA_FIELDS:
        v = L.get(key)
        if v not in (None, "", 0, "0", False):
            rows.append({"key": key, "label": label, "value": str(v)})
    if L.get("is_furnished") is not None:
        rows.append({"key": "is_furnished", "label": "Furniture",
                     "value": "Furnished" if L.get("is_furnished") else "Un-Furnished"})
    return rows


def map_listing(L: dict) -> tuple[Optional[dict], str]:
    """Return (row, category). category in {'residential','commercial'} decides the table."""
    pid = L.get("id")
    if not pid:
        return None, "residential"
    category = (L.get("category") or "residential").lower()
    is_rent = (L.get("purpose") or "").lower() in ("rent", "rental")
    t = (L.get("type") or "").lower()
    # Unmapped type → RAW preserved, title-cased (never a guessed default; Batch 2 type-truth
    # contract) — byte-identical to the old `TYPE_MAP.get(t, t.title() if t else None)`.
    property_type = normalize.map_type_en(t) or (t.title() if t else None)
    if t in _LAND_TYPES and category == "commercial":
        property_type = "Commercial Land"

    area = _int(L.get("area")) or _int(L.get("built_up_area"))
    # Rent fidelity (monthly-rent contract; 2026-07-16 unification follow-up): price_annual is truly
    # ANNUAL. The old `rent_price_annually or rent_price_monthly` fallback stored a raw MONTHLY
    # figure as annual — the exact BUG-2 class fixed fleet-wide 2026-07-13 (eaqartabuk/aqarcity/
    # mustqr/satel) that never propagated here. Annual wins when present; a monthly-only listing is
    # annualized ×12 via the shared helper and tagged rent_period='monthly' so the app's
    # round(price_annual/12) card shows the real monthly rent. PROSPECTIVE only — live-checked
    # 2026-07-16: both active Aldarim Rent rows priced via the annual path, so no stored value changes.
    rent_annual = _int(L.get("rent_price_annually"))
    rent_monthly = _int(L.get("rent_price_monthly")) if rent_annual is None else None
    if rent_monthly is not None:
        price_annual, rent_period = normalize.annualize_rent(rent_monthly, "monthly"), "monthly"
    elif rent_annual is not None:
        price_annual, rent_period = rent_annual, "annual"
    else:
        # No rent-price field published at all → the source states no period; UNKNOWN, never a
        # default (2026-08-11 audit: 3 field-less rows stored a manufactured سنوي with no price).
        price_annual, rent_period = None, None

    # CITY: owner-confirmed business fact, not derived from the payload at all — see the module
    # docstring. This API publishes city:null on every row; nothing here is being overruled.
    city_ar = OWNER_CITY_AR
    cid, rid = to_catalog(city_ar)
    district_ar = _district_from_description(L.get("description_ar"))
    row = {
        "ad_number": f"BHD{pid}",
        "listing_url": f"https://www.bahadhabab-res.com/properties/{pid}",
        "source": "Bahadhabab",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": _int(L.get("bedrooms")),
        "bathrooms": _int(L.get("bathrooms")),
        "halls": _int(L.get("living_rooms")),
        "reception_rooms_majlis": _int(L.get("majlis_rooms")),
        "price_total": _int(L.get("selling_price")) if not is_rent else None,
        "price_annual": price_annual if is_rent else None,
        "rent_period": rent_period if is_rent else None,
        "city": normalize.map_city(OWNER_CITY_AR),
        "neighborhood": district_ar,
        "title": L.get("name_en") or L.get("name_ar"),
        "photo_urls": _photos(L),
        "property_age": None if property_type in AGELESS_TYPES
                        else _age_from_year_built(L.get("year_built")),
        "rega_location_verified": bool(L.get("rega_ad_number")),
        "additional_info": _additional_info(L),
        # Feature-grid booleans the card renders with icons — mapped from Aldarim's flags/counts so the
        # card shows real features (Electricity/Water/Sewage/AC/parking…) instead of "No features".
        # Tri-state (2026-08-11): silence is NOT a denial. All four keys are 0/1 flags aldarim really
        # publishes, so a `false` here is source truth and is preserved; only a null/absent key now
        # stores NULL instead of a fabricated "no". `is_ac_installed` is the one that had actually
        # gone wrong in production — null on 12 active rows, every one of them stored as false.
        "electricity":      _flag(L.get("has_electricity")),
        "water_supply":     _flag(L.get("has_water")),
        "sanitation":       _flag(L.get("has_sewage")),
        "air_conditioner":  _flag(L.get("is_ac_installed")),
        # kitchen keeps its OWN resolver (PR#455): a non-zero `kitchens` COUNT proves a kitchen even
        # when the flag reads 0, which _flag alone cannot express.
        "kitchen":          _kitchen_state(L.get("is_kitchen_installed"), L.get("kitchens")),
        "parking":          (_int(L.get("parking_spots")) or 0) > 0,
        "elevator":         (_int(L.get("elevators")) or 0) > 0,
        "maid_room":        (_int(L.get("maid_rooms")) or 0) > 0,
        "driver_room":      (_int(L.get("driver_rooms")) or 0) > 0,
        "balcony_terrace":  (_int(L.get("balconies")) or 0) > 0,
        # (no detail_enriched — that's a Wasalt-only enrichment flag; Aldarim's API is already complete.)
        # ── Arabic-native (additive, shadow) + complete-source capture ──────────
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": cid,
        "region_id": rid,
        "source_capture": {k: v for k, v in L.items() if k not in _PII},
    }
    return row, category


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--pages", type=int, default=50)
    p.add_argument("--limit-test", type=int, default=0, help="If >0, only process this many pages and DON'T upsert (dry run preview).")
    args = p.parse_args()

    s = session()
    run_id = None if args.limit_test else db.begin_run("bahadhabab")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    _, last_page = fetch_page(s, 1)
    pages = min(args.pages, last_page)
    print(f"Bahadhabab: {last_page} pages total, scraping {pages} (per_page={PER_PAGE})")
    seen = 0
    try:
        for page in range(1, pages + 1):
            listings, _ = fetch_page(s, page)
            if not listings:
                break
            for L in listings:
                # SKIP sold/rented — Aldarim's API returns them, but they're not available to buy/rent.
                # (Found in recon: 74 of 231 were sold/rented. We only show what's actually on offer.)
                if (L.get("availability_status") or "").lower() not in ("available", "", None):
                    continue
                row, cat = map_listing(L)
                if not row or not row.get("property_type"):
                    continue
                (com_rows if cat == "commercial" else res_rows).append(row)
                seen += 1
            if args.limit_test and page >= args.limit_test:
                break
        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res_rows)} residential + {len(com_rows)} commercial")
            for r in (res_rows[:3]):
                print("  sample:", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "neighborhood", "area_m2", "price_total", "source")})
                print("    photo[0]:", (r["photo_urls"] or ["(none)"])[0][:90])
            return 0
        if res_rows:
            db.upsert_bahadhabab_residential_batch(res_rows)
        if com_rows:
            db.upsert_bahadhabab_commercial_batch(com_rows)
        # FULL-REFRESH liveness: we just fetched the COMPLETE available inventory, so any Aldarim
        # row NOT seen this run is gone (sold/rented/removed) → mark it inactive. This makes the daily
        # sync self-cleaning, so we never show a stale listing. (Replaces a separate liveness job.)
        pruned = 0
        if not args.pages or pages >= last_page:  # only prune on a FULL crawl, never a partial run
            seen_res = [r["ad_number"] for r in res_rows]
            seen_com = [r["ad_number"] for r in com_rows]
            for tbl, seen_ads in (("bahadhabab_residential_listings", seen_res), ("bahadhabab_commercial_listings", seen_com)):
                n = db.prune_unseen(tbl, set(seen_ads), source="Bahadhabab")
                if n < 0:
                    print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
                else:
                    pruned += n
        print(f"✓ Bahadhabab: {len(res_rows)} residential + {len(com_rows)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res_rows) + len(com_rows), notes=f"pruned={pruned}", check_tables=["bahadhabab_residential_listings", "bahadhabab_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
