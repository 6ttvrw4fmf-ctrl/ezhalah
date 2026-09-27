"""Flow — flow.life. A global co-living brand; ONLY its Riyadh region is taken. RENT only. Onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24, every number below from a real fetch):
  · ENUMERATION: /sitemap.xml (178 <loc>) names 4 Riyadh properties at
    /en/properties/riyadh-{granada,narjis,olaya,science-park}/available-homes plus one
    /available-homes/<unit slug>/fid/<fid> entry per home type (19 of them). Miami / Fort Lauderdale
    properties sit in the same sitemap and are never fetched: only riyadh-* slugs are enumerated
    AND the JSON's own property.region must read "Riyadh".
  · THE LIST PAGE IS NEXT.JS SSR: the raw HTML carries <script id="__NEXT_DATA__"> whose
    props.pageProps.floorplans is the catalogue — one entry per HOME TYPE, which is the owner's
    listing grain for compound sites (each home type = one listing). Measured: granada 6, narjis 7,
    olaya 2 = 15 floorplans, all status "available". riyadh-science-park is in the sitemap but its
    page is the site's own 404 shell («Oops! Looks like you are a little lost», HTTP 200,
    floorplans null) — the sitemap is not the catalogue; the page is.
  · PRICE: the page prints «Unfurnished starting at SAR 152,000 / year» and «Furnished starting at
    SAR 176,000 / year». The JSON states the same: startingAtPrice=152000,
    startingAtPriceInterval="year", startingAtCurrency="SAR", startingAtFurnishedPrice=176000,
    minPrice.pricePeriod="P12M". price_annual = startingAtPrice exactly; rent_period = "annual"
    ONLY when the interval word is "year" (a "month" interval would be monthly ×12 via
    annualize_rent; anything else → NULL, figure archived unconverted). The furnished figure and
    floorplan.maxPrice (the top of the range) are archived in additional_info, never blended.
    Individual UNITS under floorplan.unitTypes[].units[].prices carry 1–12-month lease ladders
    (P1M 14,000 … P12M 152,000) — those are per-unit lease terms, not the home-type price, and are
    not stored.
  · FURNISHED is tri-state and this source offers BOTH: the same home type is priced unfurnished
    AND furnished, and homeAmenities says «Furnished Units Available». amenities_from_text would
    read that as furnished=True, so the furnished tokens are stripped before the call and the
    column stays NULL; the two prices carry the fact.
  · FIELDS: bedrooms int, bathrooms may be 2.5 (stored NULL + bathrooms_exact — half a bathroom is
    not a bathroom count), area 89.84 sqm (int + area_exact). Type: the property's own description
    says «offers luxury 2- to 3-bedroom apartments» → شقة; a «Studio» title → استوديو.
  · LOCATION: property.region = "Riyadh" → الرياض. The district is the property slug's own suffix
    (granada / narjis / olaya), which the landing page states in words («in the An Narjis
    neighborhood of Riyadh»), attested by find_district_in_text against Riyadh's catalog.
    pageProps.location is a Phoenix, AZ default and is never read.
  · LISTING URL: the per-home-type page /en/properties/<prop>/available-homes/<slug>/fid/<fid> —
    the sitemap's own URL for that fid; the site keys it on the fid (any unit slug serves the
    same page), so a fid absent from the sitemap gets the slugified title.
  · PII: property.phoneNumber / countryCode are never read; descriptions pass through redact_pii.
  · PHOTOS: floorplan poster https://flowhouse.imgix.net/cms/….png (fetched one: 200, image/avif
    by content negotiation, 358 KB).
  · REMOVAL ORACLE (measured 3 gone vs 3 live): a live fid's detail page answers 200 on its own
    URL with pageProps.externalRefId == fid and floorplans == [that one]. An unknown fid (2 probed)
    or a fid under the wrong property (1 probed) answers 200 but REDIRECTS to the property's
    available-homes list with externalRefId null; an unknown property lands on /missing. So:
    externalRefId == fid → live; a readable page without it → gone; a page without __NEXT_DATA__
    → no verdict. Prune runs only after a complete enumeration, through LivenessProbe with an
    in-run positive control (this run's first row must probe live), so a blocked transport fails
    CLOSED.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://flow.life"
SOURCE = "Flow"
PREFIX = "FLW"
PAUSE = 0.8

_CITY_EN_AR = {"riyadh": "الرياض"}
_DISTRICT_EN_AR = {"granada": "حي غرناطة", "narjis": "حي النرجس", "olaya": "حي العليا"}
_INTERVAL_PERIOD = {"year": "annual", "month": "monthly"}


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.8"})
    return s


def page_props(page_html: str) -> Optional[dict]:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page_html or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1)).get("props", {}).get("pageProps")
    except (ValueError, AttributeError):
        return None


def _num(v: Any) -> tuple[Optional[int], Optional[str]]:
    """(whole number, exact-if-fractional). 2.5 → (None, '2.5') for a count; the caller decides."""
    if v is None or v == "":
        return None, None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None, None
    return (int(f), None) if f == int(f) else (None, str(v))


def price_from_floorplan(fp: dict) -> tuple[Optional[int], Optional[str], dict[str, Any]]:
    """(price_annual, rent_period, extra) exactly as the source states it."""
    price = normalize.to_int(fp.get("startingAtPrice"))
    interval = str(fp.get("startingAtPriceInterval") or "").lower()
    cur = fp.get("startingAtCurrency")
    if price is None:
        return None, None, {}
    if cur != "SAR" or interval not in _INTERVAL_PERIOD:
        return None, None, {"starting_price_raw": {"price": price, "interval": interval or None,
                                                   "currency": cur}}
    period = _INTERVAL_PERIOD[interval]
    extra: dict[str, Any] = {}
    furnished = normalize.to_int(fp.get("startingAtFurnishedPrice"))
    if furnished is not None:
        extra["furnished_starting_price"] = furnished
        extra["price_interval"] = interval
    top = normalize.to_int(((fp.get("floorplan") or {}).get("maxPrice") or {}).get("basePrice"))
    if top is not None and top != price:
        extra["price_high"] = top
    return (price if period == "annual" else normalize.annualize_rent(price, period)), period, extra


def _slugify(title: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", title.lower())).strip("-")


def map_listing(fp: dict, prop_slug: str, url_by_fid: dict[str, str]) -> tuple[Optional[dict], Optional[str], Optional[str]]:
    """(row, category, skip_reason) for ONE home type (floorplan) of one property."""
    fid = fp.get("externalRefId") or (fp.get("floorplan") or {}).get("fid")
    if not fid:
        return None, None, "floorplan_without_fid"
    pattrs = ((fp.get("property") or {}).get("data") or {}).get("attributes") or {}
    city_ar = _CITY_EN_AR.get(str(pattrs.get("region") or "").strip().lower())
    if not city_ar:
        return None, None, "city_not_mapped"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, None, "city_not_in_catalog"
    if (fp.get("status") or "").lower() != "available":
        return None, None, "not_available"
    title = fp.get("title") or ""
    if re.search(r"\bstudio\b", title, re.I):
        type_ar = "استوديو"
    elif re.search(r"\bapartments?\b", pattrs.get("description") or "", re.I):
        type_ar = "شقة"
    else:
        type_ar = None
    property_type = normalize.map_type_exact(type_ar) if type_ar else None
    if not property_type:
        return None, None, "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    price, period, extra = price_from_floorplan(fp)
    dist_key = prop_slug.split("-", 1)[1] if "-" in prop_slug else ""
    cand = _DISTRICT_EN_AR.get(dist_key)
    district_ar = find_district_in_text(cand, city_id) if cand else None
    bathrooms, bath_exact = _num(fp.get("bathrooms"))
    area_whole, area_exact = _num(fp.get("area")) if fp.get("areaUnit") in (None, "sqm") else (None, None)
    if area_exact:
        area_whole = int(float(area_exact))
    home = fp.get("homeAmenities") or ""
    poster = (((fp.get("poster") or {}).get("data") or {}).get("attributes") or {}).get("url")
    plan = fp.get("floorplan") or {}
    lease = ((plan.get("minPrice") or {}).get("leaseDuration"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}-{prop_slug}-fid-{fid}",
        "listing_url": url_by_fid.get(fid) or
                       f"{BASE}/en/properties/{prop_slug}/available-homes/{_slugify(title) or 'home'}/fid/{fid}",
        "source": SOURCE,
        "active": True,
        "title": " – ".join(x for x in (pattrs.get("name"), title) if x) or None,
        "description": redact_pii(fp.get("description") or pattrs.get("description")),
        "property_type": property_type,
        "transaction_type": "Rent",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": dist_key.title() if district_ar else None,
        "bedrooms": normalize.to_int(fp.get("bedrooms")),
        "bathrooms": bathrooms,
        "area_m2": area_whole,
        "price_annual": price,
        "rent_period": period,
        "photo_urls": [poster] if poster and poster.startswith("https://") else None,
        "additional_info": {k: v for k, v in {
            "property": pattrs.get("name"), "property_slug": prop_slug, "fid": fid,
            "unit_count": plan.get("unitCount"), "lease_duration": lease,
            "bathrooms_exact": bath_exact, "area_exact": area_exact, "area_unit": fp.get("areaUnit"),
            "min_floor_area": (plan.get("minFloorArea") or {}).get("value"),
            "max_floor_area": (plan.get("maxFloorArea") or {}).get("value"),
            "home_amenities_en": home or None,
            "property_amenities_en": fp.get("propertyAmenities") or None,
            "new_construction": fp.get("newConstruction"), **extra,
        }.items() if v is not None},
    }
    # The home type is offered furnished AND unfurnished (two printed prices), so «Furnished Units
    # Available» is not a furnished=True statement: strip it, let the rest speak, furnished stays NULL.
    row.update(normalize.amenities_from_text(re.sub(r"(?i)\bfurnished[^,]*", "", home)))
    return row, category, None


# ── enumeration + oracle ─────────────────────────────────────────────────────────────────────────
def fetch_sitemap(s: cc.Session) -> tuple[list[str], dict[str, str]]:
    """(riyadh property slugs, fid → the sitemap's own per-home-type URL)."""
    r = s.get(f"{BASE}/sitemap.xml", timeout=40)
    if r.status_code != 200:
        return [], {}
    locs = re.findall(r"<loc>([^<]+)</loc>", r.text)
    slugs = sorted({m.group(1) for u in locs
                    for m in [re.search(r"/en/properties/(riyadh-[a-z0-9-]+)/available-homes(?:/|$)", u)] if m})
    by_fid = {}
    for u in locs:
        m = re.search(r"/en/properties/riyadh-[a-z0-9-]+/available-homes/[^/]+/fid/([^/\s*]+)$", u)
        if m:
            by_fid[m.group(1)] = u
    return slugs, by_fid


def list_url(prop_slug: str) -> str:
    return f"{BASE}/en/properties/{prop_slug}/available-homes"


def _signal_for(fid: str):
    def _signal(status, body, _moved):
        if status != 200:
            return None
        pp = page_props(body)
        if pp is None:
            return None            # no page JSON at all: unreadable, never a death
        return "live" if pp.get("externalRefId") == fid else "gone"
    return _signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None) -> tuple[str, str]:
        head, sep, fid = (ad_number or "").rpartition("-fid-")
        if not sep or not head.startswith(f"{PREFIX}-riyadh-") or not fid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}-<property slug>-fid-<fid> ad number"
        prop_slug = head[len(PREFIX) + 1:]
        return LivenessProbe(platform="flow", signal=_signal_for(fid), session=session,
                             url_for=lambda _ad: f"{list_url(prop_slug)}/home/fid/{fid}",
                             canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("flow")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        slugs, url_by_fid = fetch_sitemap(s)
        if not slugs:
            raise RuntimeError("sitemap named no riyadh-* property")
        print(f"{SOURCE}: {len(slugs)} Riyadh properties discovered", flush=True)
        complete = True
        seen_floorplans = 0
        for prop_slug in slugs:
            if args.limit and seen_floorplans >= args.limit:
                complete = False
                break
            try:
                r = s.get(list_url(prop_slug), timeout=45)
            except Exception:
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                complete = False
                continue
            time.sleep(PAUSE)
            pp = page_props(r.text) if r.status_code == 200 else None
            if pp is None:
                skipped[f"http_{r.status_code}_unreadable"] = skipped.get(f"http_{r.status_code}_unreadable", 0) + 1
                complete = False
                continue
            floorplans = pp.get("floorplans")
            if not floorplans:
                # The site's own 404 shell (riyadh-science-park) or a property with nothing to let.
                skipped["property_not_live"] = skipped.get("property_not_live", 0) + 1
                continue
            for fp in floorplans:
                seen_floorplans += 1
                row, cat, why = map_listing(fp, prop_slug, url_by_fid)
                if not row:
                    skipped[why] = skipped.get(why, 0) + 1
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written; complete={complete})")
            for r0 in (res + com)[:30]:
                print(f"   {r0['ad_number']:44} {str(r0['property_type']):10} d={str(r0['district_ar'])[:12]:12} "
                      f"bd={str(r0['bedrooms']):>2} ba={str(r0['bathrooms']):>4} a={str(r0['area_m2']):>4} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])} "
                      f"{r0['listing_url'][-50:]}")
            return 0
        # Public upsert_flow_*_batch wrappers are added centrally later; the shared batch writer is
        # the same function they will call.
        db._wasalt_batch("flow_residential_listings", res)
        db._wasalt_batch("flow_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="flow_residential_listings", com_table="flow_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("flow_residential_listings", res), ("flow_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen_floorplans,
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["flow_residential_listings", "flow_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
