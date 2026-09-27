"""العجلان للتسويق العقاري — alajlan-re.com. Onboarded 2026-09-25.

SOURCE SHAPE (probed live before any code — every number below is measured, not estimated):
  A single static homepage with NO server-rendered listing markup at all. Every listing lives in
  one public, unauthenticated JSON file, fetched client-side by the page's own js/projects.js:

      GET https://alajlan-re.com/data/projects.json
          → [ {name, isActive, description: [ …items… ]},   # one object per category
              … ]

  Three categories exist today, matched BY NAME (never by array position, so a reordering on the
  source's side can't silently swap Buy for Rent): «تأجير» (rent, 13 items today), «استثمار»
  (investment, 1 item), «بيع» (buy, 0 items today — checked anyway; see below). Every category's
  `description` array is walked the same way so a category that gains entries later is never
  silently skipped just because it happened to be empty on 2026-09-25.

  Each item: id, license_num (REGA AD licence, digits, verified real), title, information
  ("حي X - المدينة" — district then city), typeAr/typeEn, location (bare city name, matches
  information's city half), images[] (relative paths, the REAL gallery — the sibling singular
  `image` field is a static per-category placeholder, "images/land/1.webp" on EVERY item sampled,
  never the listing's own photo, so it is not read), status (bool), detailInfo1..4 (rooms /
  bathrooms / area+"متر" / price, each a spec-table cell, never prose), summary (long free text).

  ID COLLISION ACROSS CATEGORIES (measured, not assumed): `id` restarts at 1 in EVERY category —
  rent's id=1 and investment's id=1 are two unrelated listings. ad_number therefore encodes the
  category (R/I/B) ahead of the id (ALJR1 vs ALJI1), or two different listings would upsert onto
  the same row.

  PRICE = SOURCE: detailInfo4 is the figure plus an inline currency-icon <img> tag ("92,000
  <img …>"), sometimes with a trailing bare word: measured «سنوي» (annual) on 1 of 10 active rent
  rows (id 10, "100,000 <img …> سنوي") — everything else states no period, so rent_period stays
  NULL and the figure is stored as-is (owner rule: unstated period is never defaulted to annual).
  One EXCLUDED row (status:false id 13) instead pairs detailInfo4 "…دفعة" with detailInfo4_2
  "…دفعتين" — a ONE-payment vs TWO-payment figure for the same deal, not a period, not a second
  price (fleet precedent: reinvest/wadod/muhaysini). No ACTIVE row does this today, but map_listing
  still refuses to guess which figure is "the" price if one ever does (price_payment_split skip) —
  PRICE = SOURCE means never picking a number when the source names two.

  TYPES: typeAr «شقة»/«شقق»→Apartment, «فيلا»→Villa, «دور»→Floor all resolve through the shared
  map. «منتجع» (the lone investment row, a resort) is NOT in the shared TYPE_MAP_AR; the app's own
  taxonomy (src/data/propertyTypes.ts / taxonomy.source.json) already carries "Resort" as a
  distinct Commercial clean type ("Service Facilities" group), so the per-platform override below
  maps it there rather than folding it into the shared map's unrelated 'resort'→'Hotel' (that entry
  keys off the EN vocabulary a different platform shape uses, not this one).

  CATEGORY → transaction_type: «تأجير»→Rent, «بيع»→Buy. «استثمار» (investment) states neither rent
  nor sale on its own, but its one live row prices like a sale (a plain figure, no period word) —
  fleet precedent (mustqr, alkhaas, eaqartabuk) reads a bare «استثمار» the same way: Buy.

  LOCATION: `information` ("حي النرجس - الرياض") splits cleanly on " - " into district / city on
  every item sampled (14/14); `location` restates the same city and is used as the primary city
  string. district_ar is the CATALOG-canonicalized form (find_district_in_text); the raw "حي X" is
  kept verbatim in `neighborhood`.

  PDPL: scanned all 14 items (title/information/summary/location) for Saudi mobile numbers — none
  found. No name/phone field exists on the item shape itself. redact_pii() still runs on the free
  text `summary` defensively, same as every other scraper, in case a future entry adds one.

  NO AUCTIONS, NO OFF-PLAN: scanned all 14 items' title+summary for «مزاد» and for
  «على الخارطة»/«قريباً»-style under-construction language — zero matches. These are furnished,
  ready rental/resale units, not a brochure of units still being built.

REMOVAL ORACLE — the unusual half of this platform (owner-approved, documented so nobody "fixes"
it later): there is NO per-listing URL on this site at all. Every "view details" control on the
page is a same-page accordion over data already in projects.json — checked exhaustively for query
params, hash routes, and separate detail pages; none exist. So `listing_url` is the SAME bare
homepage ("https://alajlan-re.com/") on EVERY row, deliberately, not a bug. A per-row #fragment or
?id= the site doesn't actually read would look like a real deep link and silently fail — worse than
an honest shared URL — so none is constructed.  Client-side click-through wiring for this shared-URL
case is a later, separate, cross-platform pass — not this file's job.

Because there is no separate detail endpoint, there is also no separate liveness probe: the ENTIRE
catalogue is the one JSON array fetched above, so this run's own `seen` set already IS the complete
oracle for "is it still there" — a unit's record either keeps status:true, or flips to status:false,
or drops out of the array; any of the three means gone. db.prune_unseen's own 3-strike/coverage/
collapse guards are the only additional protection needed (same shape ~40 other single-fetch
platforms in this fleet use, no verify_gone re-probe — there is nothing further to re-probe against).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://alajlan-re.com"
DATA_URL = f"{BASE}/data/projects.json"
# The documented exception (see docstring): every row shares this exact bare homepage — there is
# no per-listing URL anywhere on the site. Never build a #fragment/?id= variant of this.
HOMEPAGE_URL = f"{BASE}/"
SOURCE = "العجلان للتسويق العقاري"
PREFIX = "ALJ"
PAUSE = 0.5

# category name (as published) → ad_number letter (id collides across categories; see docstring).
# Any OTHER category name is unmapped — its rows are skipped and counted, never guessed onto a
# code. transaction_type itself is NOT looked up from this dict: the fleet's null-deal AST lint
# (test_deal_mapping_total.py) requires transaction_type to be a provably-total literal/ternary, so
# it is a plain "Rent" if/else "Buy" ternary below instead of a third value riding in this table.
CATEGORY_CODE = {"تأجير": "R", "استثمار": "I", "بيع": "B"}

# Per-platform exact-match escape hatch (see normalize.map_type_exact contract): «منتجع» is not in
# the shared TYPE_MAP_AR, and the app's own clean-type taxonomy already has a distinct "Resort".
TYPE_OVERRIDES = {"منتجع": "Resort"}

_TAG_RE = re.compile(r"<[^>]+>")
_PAYMENT_SPLIT_RE = re.compile(r"دفع")  # دفعة / دفعتين / دفعات — a payment-count, never a period


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json, text/plain, */*", "Referer": f"{BASE}/"})
    return s


def fetch_categories(s: cc.Session) -> list[dict]:
    """The whole catalogue in one call. Raises on anything that isn't the expected shape — a
    challenge page, an HTML error body, or a reshaped API must fail the run, never read as empty."""
    r = s.get(DATA_URL, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"projects.json: HTTP {r.status_code}")
    try:
        j = r.json()
    except ValueError:
        raise RuntimeError("projects.json: not JSON") from None
    if not isinstance(j, list):
        raise RuntimeError("projects.json: not a list")
    return j


def _clean_price_text(raw: Optional[str]) -> str:
    """Strip the inline currency-icon <img> (and any other markup), keep the trailing period word
    if the source stated one (e.g. "92,000 <img …>" → "92,000 ", "…<img …> سنوي" → "… سنوي")."""
    return re.sub(r"\s+", " ", _TAG_RE.sub(" ", raw or "")).strip()


def map_listing(category_name: str, it: dict) -> tuple[Optional[dict], str, str]:
    if it.get("status") is not True:
        return None, "residential", "inactive"

    code = CATEGORY_CODE.get(category_name)
    if not code:
        return None, "residential", "category_unmapped"
    # «تأجير»→Rent, everything else this dict admits («استثمار»/«بيع»)→Buy — see CATEGORY_CODE's
    # comment for why this is a ternary and not a third dict value.
    transaction_type = "Rent" if category_name == "تأجير" else "Buy"

    iid = it.get("id")
    if iid in (None, ""):
        return None, "residential", "no_id"

    type_ar = (it.get("typeAr") or "").strip()
    property_type = normalize.map_type_exact(type_ar, overrides=TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", "type_unmapped"
    bucket = normalize.category_for_type(property_type).lower()

    info_raw = (it.get("information") or "").strip()
    district_raw, _, city_part = info_raw.rpartition(" - ")
    district_raw = district_raw.strip() or None
    city_ar = (it.get("location") or city_part or "").strip()
    if not city_ar:
        return None, bucket, "city_not_stated"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, bucket, "city_not_in_catalog"
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    price_text = _clean_price_text(it.get("detailInfo4"))
    if _PAYMENT_SPLIT_RE.search(price_text):
        return None, bucket, "price_payment_split"
    price = normalize.to_int(price_text)

    licence = str(it.get("license_num") or "").strip()
    summary = redact_pii((it.get("summary") or "").strip() or None)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{code}{int(iid)}",
        "listing_url": HOMEPAGE_URL,
        "source": SOURCE,
        "active": True,
        "title": (it.get("title") or "").strip() or None,
        "description": summary,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": normalize.to_int(it.get("detailInfo3")),
        "bedrooms": normalize.to_int(it.get("detailInfo1")),
        "bathrooms": normalize.to_int(it.get("detailInfo2")),
        "license_number": licence if re.fullmatch(r"\d{6,}", licence) else None,
        "photo_urls": [f"{BASE}/{p.strip()}" for p in (it.get("images") or []) if p.strip()][:20] or None,
    }

    if transaction_type == "Rent":
        row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(price, price_text)
        ev_kind = row["rent_period"] or "total"
    else:
        row["price_total"] = price
        ev_kind = "total"
    row["price_evidence"] = normalize.price_evidence(
        field="detailInfo4", raw=it.get("detailInfo4"), stored=price, kind=ev_kind, unit="total",
        origin="structured")

    row["additional_info"] = {k: v for k, v in {
        "category_ar": category_name,
        "type_ar": type_ar,
        "source_id": iid,
        # Present on the one excluded row observed so far (see docstring); kept if a future active
        # row ever carries it, never read as the price.
        "price_alt_raw": (it.get("detailInfo4_2") or "").strip() or None,
    }.items() if v is not None}

    return row, bucket, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("alajlan")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen_total = 0
    try:
        categories = fetch_categories(session())
        if not categories:
            raise RuntimeError("projects.json answered 0 categories — treated as blocked, not empty")
        for cat in categories:
            items = cat.get("description")
            if not isinstance(items, list):
                continue
            name = cat.get("name")
            if args.limit:
                items = items[:max(0, args.limit - seen_total)]
            seen_total += len(items)
            for it in items:
                row, bucket, why = map_listing(name, it)
                if not row:
                    skipped[why] = skipped.get(why, 0) + 1
                    continue
                if args.type != "all" and bucket != args.type:
                    continue
                (com if bucket == "commercial" else res).append(row)
            if args.limit and seen_total >= args.limit:
                break

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        print(f"{SOURCE}: {seen_total} records examined across {len(categories)} categories"
              + (f" — skipped: {notes}" if skipped else ""), flush=True)

        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {str(r0['property_type']):8} "
                      f"{str(r0['city_ar']):8} d={str(r0['district_ar'])[:12]:12} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"url={r0['listing_url']}")
            return 0

        db.upsert_alajlan_residential_batch(res)
        db.upsert_alajlan_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="alajlan_residential_listings", com_table="alajlan_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")

        # PRUNE — every run reads the WHOLE catalogue (see docstring's removal-oracle note: one
        # JSON fetch is either complete or the run never gets here), so prune_unseen's own 3-strike
        # / coverage / collapse guards are the only breaker needed; no verify_gone re-probe exists
        # to add (there is no second endpoint to re-check against).
        pruned = 0
        if args.type == "all" and not args.limit:
            for tbl, rows in (("alajlan_residential_listings", res), ("alajlan_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n

        healthy = db.end_run(run_id, ok=True, rows_seen=seen_total, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; {notes}"[:300],
                             check_tables=["alajlan_residential_listings", "alajlan_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            tally = ";".join(f"{k}={v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=seen_total, rows_upserted=0,
                       notes=f"{e}"[:200] + (f" | skips: {tally}" if tally else ""))
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
