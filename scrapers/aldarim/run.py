"""Aldarim scraper — clean public JSON API, no auth, no browser.

Discovered via Playwright network-intercept: aldarim.sa (a Nuzul SaaS tenant) serves its listings
from a PUBLIC paginated API at aldarim.nzl-backend.com/api/public/properties. ~231 listings total,
very rich per-listing data. So the scraper is just: paginate the API → map → upsert. (The Aqar way.)

Field map (Aldarim API → our schema):
  category   residential|commercial   → which table
  purpose    sell|rent                → transaction_type Buy|Rent
  type       land|villa|apartment|...  → property_type (TYPE_MAP)
  city/district  {name_en}            → city / neighborhood
  selling_price / rent_price_annually  → price_total / price_annual
  area (or built_up_area)             → area_m2 ; bedrooms/bathrooms direct
  cover_image_url + images[]          → photo_urls (full S3 URLs, verified to load)
  plan_number/plot_number/rega/majlis → additional_info (the rich extras panel)

Usage:  python -m scrapers.aldarim.run --pages 50 [--limit-test 1]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
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

API = "https://aldarim.nzl-backend.com/api/public/properties"
SITE = "https://www.aldarim.sa/en/properties"
HEADERS = {"Accept": "application/json", "Origin": "https://www.aldarim.sa",
           "Referer": "https://www.aldarim.sa/"}
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
    else:
        price_annual, rent_period = rent_annual, "annual"  # annual figure, or no rent price at all

    # Native Arabic R/C/D (ADDITIVE — live city/neighborhood above untouched). The API already carries
    # city.name_ar / district.name_ar; we just stopped discarding them. No region signal from Aldarim,
    # so same-name twins (rare here — mostly Riyadh) stay region_id-null rather than guessing.
    cityd = L.get("city") if isinstance(L.get("city"), dict) else {}
    distd = L.get("district") if isinstance(L.get("district"), dict) else {}
    city_ar = (cityd.get("name_ar") or "").strip() or None
    district_ar = (distd.get("name_ar") or "").strip() or None
    cid, rid = to_catalog(city_ar)
    row = {
        "ad_number": f"ALD{pid}",
        "listing_url": f"https://www.aldarim.sa/en/properties/{pid}",
        "source": "Aldarim",
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
        "city": _city(L.get("city")),
        "neighborhood": (_name(L.get("district")) or "").replace(" Dist.", "").strip() or None,
        "title": L.get("name_en") or L.get("name_ar"),
        "photo_urls": _photos(L),
        "property_age": str(L.get("year_built")) if L.get("year_built") else None,
        "rega_location_verified": bool(L.get("rega_ad_number")),
        "additional_info": _additional_info(L),
        # Feature-grid booleans the card renders with icons — mapped from Aldarim's flags/counts so the
        # card shows real features (Electricity/Water/Sewage/AC/parking…) instead of "No features".
        "electricity":      bool(L.get("has_electricity")),
        "water_supply":     bool(L.get("has_water")),
        "sanitation":       bool(L.get("has_sewage")),
        "air_conditioner":  bool(L.get("is_ac_installed")),
        "kitchen":          bool(L.get("is_kitchen_installed")) or _int(L.get("kitchens")) is not None,
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
    run_id = None if args.limit_test else db.begin_run("aldarim")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    _, last_page = fetch_page(s, 1)
    pages = min(args.pages, last_page)
    print(f"Aldarim: {last_page} pages total, scraping {pages} (per_page={PER_PAGE})")
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
            db.upsert_aldarim_residential_batch(res_rows)
        if com_rows:
            db.upsert_aldarim_commercial_batch(com_rows)
        # FULL-REFRESH liveness: we just fetched the COMPLETE available inventory, so any Aldarim
        # row NOT seen this run is gone (sold/rented/removed) → mark it inactive. This makes the daily
        # sync self-cleaning, so we never show a stale listing. (Replaces a separate liveness job.)
        pruned = 0
        if not args.pages or pages >= last_page:  # only prune on a FULL crawl, never a partial run
            seen_res = [r["ad_number"] for r in res_rows]
            seen_com = [r["ad_number"] for r in com_rows]
            for tbl, seen_ads in (("aldarim_residential_listings", seen_res), ("aldarim_commercial_listings", seen_com)):
                n = db.prune_unseen(tbl, set(seen_ads), source="Aldarim")
                if n < 0:
                    print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
                else:
                    pruned += n
        print(f"✓ Aldarim: {len(res_rows)} residential + {len(com_rows)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res_rows) + len(com_rows), notes=f"pruned={pruned}", check_tables=["aldarim_residential_listings", "aldarim_commercial_listings"])
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
