"""Azdad Al Aqariah (ازداد العقارية) scraper -- a small, live Abha brokerage on its own
Next.js + Supabase stack (NOT a Nuzul/Wasalt-family clone -- different stack, different shape).

Found 2026-09-06 as a corrected link for the original 40-candidate audit's "أزداد العقارية"
entry (azdadalaqaria.com, not the dead azdad.com.sa the original list carried). The public site
is a Next.js app whose client bundle embeds a Supabase anon key + project ref
(evtfmgakvnlnmtcffasw.supabase.co) -- the SAME public, unauthenticated, RLS-gated pattern every
other REST-API platform this fleet scrapes already uses (aldarim's Nuzul API, wasalt, etc.), just
a different backend vendor. `properties` is the one table; PostgREST `select=*` returns every
column with no auth needed.

VERIFIED LIVE (25/25 rows sampled 2026-09-06): dates span 2025-09-03 -> 2026-09-05 (a real, still-
updated year of inventory, not a one-day placeholder batch -- the aqarnajran red flag this session
learned to check for). Real photo galleries (20/25 rows carry `images`, bound directly to THIS
row's own array -- never a folder listing that could leak a neighbour's photos). One row already
carries a genuine `مباع` (sold) status, proving the status field is a real signal, not decoration.

CITY: this site has no dedicated city column -- only a free-text `location` field and a separate,
already-clean `district` field. The site's OWN title ("شقق للبيع وللايجار في أبها" -- apartments
for sale/rent IN ABHA) plus every one of 25 sampled rows' `location` text independently naming
Abha or a recognised Abha-area district is the SOURCE stating its city, not a guess -- extracted by
matching the free text against those exact names, never defaulted. A row whose location matched
NONE of them would correctly resolve to no city, not silently become Abha (see `_city_from_location`
and its own test row for the negative case).

DISTRICT is read from the already-clean `district` column when the source published one (9/25
sampled) -- never invented from the free-text `location` field the way bahadhabab's had to be,
because this source structures it separately.

PRICE = SOURCE, verbatim, including the one implausible-looking outlier measured live: ad
AD202510020003 carries `price: 1` for a land listing whose own description reads "السوم وصل ٥٢٠
والبيع قريب" (roughly: "the offer reached 520(k) and the sale is near") -- the REAL asking price
lives only in that free prose, but the structured field the advertiser filled in is literally 1.
Per the standing PRICE = SOURCE rule (never calculated, never plausibility-gated), this is stored
exactly as published, not corrected, not hidden, not guessed from the prose.

TYPE: `category` is a small, closed Arabic vocabulary (5 real values sampled). Deliberately a
private exact-match dict here, NOT normalize.map_type()'s fuzzy substring pass -- remal's own
run.py already flagged that pass as unsafe for a small, closed vocabulary like this one. The one
genuinely ambiguous value, bare "أرض" (Land, no سكني/تجاري qualifier), is resolved from the
listing's own description text when it states one, and refused (skipped) when it doesn't --
verified live: of 2 sampled "أرض" rows, one's description says "ارض سكنية" (resolved), the other
says nothing either way (refused, never guessed).
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

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import to_catalog  # noqa: E402

# PDPL: never store advertiser contact/identity. The rest of the row is kept.
_PII = {"owner_phone", "owner_name", "advertiser_id"}

SUPABASE_URL = "https://evtfmgakvnlnmtcffasw.supabase.co"
# Public anon key, embedded in the site's own client JS bundle (same tier of "public" as every
# other platform's unauthenticated JSON API this fleet reads) -- RLS-gated, read-only in practice.
ANON_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2dGZtZ"
            "2Frdm5sbm10Y2ZmYXN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ1NDk4NjksImV4cCI6MjA3MDEyN"
            "Tg2OX0.18k2XRYTwvJFqHgQ84kpvVI67wveQ2lbgtcuxDeJP8w")
API = f"{SUPABASE_URL}/rest/v1/properties"
SITE = "https://www.azdadalaqaria.com"
HEADERS = {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}", "Accept": "application/json"}
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))
PAGE_SIZE = 200  # the whole catalogue was 25 rows on 2026-09-06; generous headroom, one request.

# «category» -- exact match only. Verified live 2026-09-06 (5 distinct real values, 25 rows).
TYPE_MAP = {
    "شقة": "Apartment",
    "عمائر سكنية": "Building",
    "أراضي سكنية": "Residential Land",
    "أراضي تجارية": "Commercial Land",
}
CATEGORY_FOR_TYPE = {
    "Apartment": "residential",
    "Building": "residential",
    "Residential Land": "residential",
    "Commercial Land": "commercial",
}
# «أرض» alone (bare "Land") never appears in TYPE_MAP -- resolved from the row's own description
# when it states سكني/تجاري, refused (None) when it states neither. See module docstring.
_DESC_RESIDENTIAL_RE = re.compile("سكني")
_DESC_COMMERCIAL_RE = re.compile("تجاري")

# «type» -- exact match only (2 real values sampled).
DEAL_MAP = {"للإيجار": "Rent", "للبيع": "Buy"}

# «status» -- allowlist, not a denylist: only a row explicitly published as متاح (available) is
# active. Anything else (مباع/sold, or a future status this fleet hasn't seen yet) is inactive by
# default -- never show a listing whose status we don't recognise as available.
ACTIVE_STATUSES = {"متاح"}

# City: this site has no dedicated column, only free text -- see module docstring for why matching
# against this exact, source-confirmed name list is extraction, not a guess.
_ABHA_MARKERS = ("ابها", "أبها", "المحالة", "المحاله", "الغدير", "الصحافة", "الوصايف", "المشارف",
                 "البديع", "الموظفين", "المعالي", "الهيام", "المنسك", "مدينة سلطان")
CITY_AR = "أبها"

# «extras» -- a list of features the advertiser opted to publish, never a full checklist. A token's
# ABSENCE from the list is UNKNOWN, never a manufactured "no" (same tri-state principle as every
# other platform's flag columns in this fleet). Only mapped to a REAL column that already exists on
# aqar_residential_listings -- an extra with no matching column (e.g. "قريبة من المدارس", "إنترنت")
# is kept in additional_info instead of forcing it onto an unrelated flag.
EXTRAS_MAP = {
    "مصعد راكب": "elevator",
    "كهرباء مستقل": "electricity",
    "كهرباء": "electricity",
    "صرف صحي": "sanitation",
    "ماء مستقل": "water_supply",
    "مياه": "water_supply",
    "تحلية واصله": "water_supply",
    "مدخل سيارة": "car_entrance",
    "مدخل مستقل": "private_entrance",
    "غرفة سائق": "driver_room",
    "مطبخ راكب": "kitchen",
    "مطبخ مجهز": "kitchen",
    "ألياف بصرية": "optical_fibers",
}
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


def fetch_all(s: cc.Session) -> list[dict]:
    """One page covers the whole catalogue today (25 rows); PAGE_SIZE has headroom to grow."""
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(f"{API}?select=*&limit={PAGE_SIZE}", timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        data = r.json()
        return data if isinstance(data, list) else []
    return []


_int = normalize.to_int_numeric


def _city_from_location(location: Optional[str]) -> Optional[str]:
    """The source's own free text stating Abha or a recognised Abha-area district — see module
    docstring. None when the text matches none of them, never defaulted."""
    if not location:
        return None
    return CITY_AR if any(m in location for m in _ABHA_MARKERS) else None


def _resolve_type(category_ar: Optional[str], description: Optional[str]) -> Optional[str]:
    t = TYPE_MAP.get(category_ar or "")
    if t:
        return t
    if category_ar == "أرض":
        d = description or ""
        if _DESC_RESIDENTIAL_RE.search(d):
            return "Residential Land"
        if _DESC_COMMERCIAL_RE.search(d):
            return "Commercial Land"
    return None  # unmapped or genuinely ambiguous — refused, never guessed


def _extras_flags(extras: Optional[list]) -> dict[str, Optional[bool]]:
    present = set(extras) if extras else set()
    out: dict[str, Optional[bool]] = {}
    for token, col in EXTRAS_MAP.items():
        if token in present:
            out[col] = True
    return out


def _extra_info_rows(extras: Optional[list]) -> list[dict[str, Any]]:
    """Extras with no matching boolean column — kept as display rows, not forced onto a flag."""
    if not extras:
        return []
    unmapped = [e for e in extras if e not in EXTRAS_MAP]
    return [{"key": f"extra_{i}", "label": "Feature", "value": e} for i, e in enumerate(unmapped)]


def map_listing(L: dict) -> tuple[Optional[dict], str]:
    """Return (row, category). category in {'residential','commercial'} decides the table."""
    pid = L.get("id")
    ad_number = L.get("ad_number")
    if not pid or not ad_number:
        return None, "residential"

    property_type = _resolve_type(L.get("category"), L.get("description"))
    if not property_type:
        return None, "residential"
    category = CATEGORY_FOR_TYPE[property_type]

    deal = DEAL_MAP.get(L.get("type") or "")
    if not deal:
        return None, category
    is_rent = deal == "Rent"

    rent_annual = _int(L.get("yearly_rent"))
    rent_monthly = _int(L.get("monthly_rent")) if rent_annual is None else None
    if rent_annual is not None:
        price_annual, rent_period = rent_annual, "annual"
    elif rent_monthly is not None:
        price_annual, rent_period = normalize.annualize_rent(rent_monthly, "monthly"), "monthly"
    else:
        price_annual, rent_period = None, None

    location = L.get("location")
    city_ar = _city_from_location(location)
    cid, rid = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = (L.get("district") or "").strip() or None

    row: dict[str, Any] = {
        "ad_number": ad_number,  # already a real, globally-unique source ID — used verbatim
        "listing_url": f"{SITE}/property/{pid}",
        "source": "Azdad",
        "active": (L.get("status") or "") in ACTIVE_STATUSES,
        "property_type": property_type,
        "transaction_type": deal,
        "area_m2": _int(L.get("area")),
        "bedrooms": _int(L.get("rooms")),
        "bathrooms": _int(L.get("bathrooms")),
        "floor_number": _int(L.get("floor")) if str(L.get("floor") or "").strip().isdigit() else None,
        "price_total": _int(L.get("price")) if not is_rent else None,
        "price_annual": price_annual if is_rent else None,
        "rent_period": rent_period if is_rent else None,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "neighborhood": district_ar,
        "street_name": location,  # the free-text address line, kept verbatim — never the district
        "title": L.get("title"),
        "description": L.get("description"),
        "photo_urls": (L.get("images") or [])[:30],
        "video_url": L.get("video_url"),
        "license_number": L.get("ad_license"),
        "rega_location_verified": bool(L.get("ad_license")),
        "additional_info": _extra_info_rows(L.get("extras")),
        "source_capture": {k: v for k, v in L.items() if k not in _PII},
        # ── Arabic-native (additive, shadow) — same shape as the Nuzul-tenant platforms ─────
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": cid,
        "region_id": rid,
    }
    row.update(_extras_flags(L.get("extras")))
    return row, category


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit-test", type=int, default=0,
                    help="If >0, only print this many sample rows and DON'T upsert (dry run).")
    args = p.parse_args()

    s = session()
    run_id = None if args.limit_test else db.begin_run("azdad")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    listings = fetch_all(s)
    print(f"Azdad: {len(listings)} rows fetched")
    seen = 0
    try:
        for L in listings:
            row, cat = map_listing(L)
            if not row:
                continue
            (com_rows if cat == "commercial" else res_rows).append(row)
            seen += 1
        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res_rows)} residential + {len(com_rows)} commercial")
            for r in (res_rows + com_rows)[: args.limit_test]:
                print("  sample:", {k: r[k] for k in
                      ("ad_number", "property_type", "transaction_type", "city", "neighborhood",
                       "area_m2", "price_total", "price_annual", "active")})
                print("    photo[0]:", (r["photo_urls"] or ["(none)"])[0][:90])
            return 0
        if res_rows:
            db.upsert_azdad_residential_batch(res_rows)
        if com_rows:
            db.upsert_azdad_commercial_batch(com_rows)
        # FULL-REFRESH liveness: the whole public catalogue is re-read every run (it's 25 rows), so
        # anything not seen this run is gone. Same self-cleaning shape as every other small platform.
        pruned = 0
        seen_res = [r["ad_number"] for r in res_rows]
        seen_com = [r["ad_number"] for r in com_rows]
        for tbl, seen_ads in (("azdad_residential_listings", seen_res), ("azdad_commercial_listings", seen_com)):
            n = db.prune_unseen(tbl, set(seen_ads), source="Azdad")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Azdad: {len(res_rows)} residential + {len(com_rows)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res_rows) + len(com_rows),
                              notes=f"pruned={pruned}",
                              check_tables=["azdad_residential_listings", "azdad_commercial_listings"])
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
