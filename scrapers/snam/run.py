"""سنام العقارية — snam.sa. A Riyadh developer selling its own units. Onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24, before any code)
========================================================
· A Next.js site over a public JSON API. The catalogue is ONE call:
      GET /api/public/projects?page=1&limit=100   (Accept-Language: ar → Arabic names/types)
  → {"success":true,"data":{"data":[…29 projects…],"meta":{"total":29,"totalPages":1,…}}}. Each
  project nests its `properties[]` — the UNITS, each with its own id, status, priceSar, buildingArea,
  streetWidth, yearBuilt, propertyType{name}, unitNumber, name, description, features[] and
  attributeValues[]. Summed across the 29 projects: 72 units — available 51, reserved 11, sold 10.
  Project status (sold 13 / under_construction 8 / available 8) is informational; the units decide.
  A project with zero units (all 13 sold + 8 under-construction ones) has nothing to list.
· THE UNIT IS THE LISTING (the owner's compound rule): ad_number = SNM<project id>U<unit id>,
  because a unit is only reachable through its project's record. listing_url = /ar/properties/<id>,
  the site's own per-unit page. It is client-rendered (curl gets the app shell for ANY id, live or
  not), so it was verified in a real browser: /ar/properties/70 renders «فيلا 42 … 8_السطح … فيلا …
  متاح … SAR 1,390,000.00 … 169.00 m² … عرض الشارع 20.00 m … غرفة نوم 2.00 … موقف سيارة, مصعد».
· PRICE: `priceSar` "1390000.00" is the sale figure (this developer only sells; no rent field
  exists anywhere). "0.00" / null (7 units, all reserved/sold) = no published price. priceUsd is
  the site's own conversion and is ignored.
· CITY: `location.city` is null on 25 of 29 projects; `location.address` is a reverse-geocoded
  string — «النهضة, بلدية الروضة, محافظة الرياض, منطقة الرياض, 10011, السعودية» — whose city-level
  component is «الرياض» or «محافظة الرياض» (Riyadh city's own admin unit in that hierarchy). The
  city is read from those components ONLY through to_catalog — which itself retries «محافظة X» as
  the seat city X (arabic_location: "a governorate IS named after its seat city"); the bare name is
  tried first so the stored city_ar is «الرياض», never the governorate label. The components are
  walked from the COARSE end, the component the source itself labels `neighborhood` is never a
  candidate, no region hint is passed, and a candidate must sit in the region the address names —
  because a Riyadh DISTRICT name is often also a catalog CITY (real catalog 2026-09-24: «أم الحمام»
  → (134, المنطقة الشرقية); «ام سليم», «بنبان», «لبن», «هيت» … are region-1 cities; «النزهة»,
  «العليا», «الروضة» are cross-region twins that a region hint would upgrade into a city). Nothing
  is defaulted: 6 projects (15, 14, 11, 9, 8, 7 — 30 available units) publish only «<district>،
  منطقة الرياض، السعودية», a REGION and a district with no city component, and are skipped as
  city_not_in_catalog (reported upward). Two projects (23, 45) carry the English string «…, Ad
  Dirah, Riyadh, Riyadh governorate, …»; «Riyadh» → «الرياض» through a closed two-entry table.
  `location.neighborhood` («الربيع», «النرجس», «Ad Dirah») feeds find_district_in_text; an English
  one stays NULL.
· TYPES: propertyType.name is «فيلا » (44, trailing space), «مبنى» (18), «دور » (9), absent (1).
  «مبنى» → Building follows the fleet's own reading (alsidra, dealapp, sadin, souq24); the 18 units
  so labelled are floors of an «أدوار» project that the source itself calls مبنى. Absent → skip.
· ATTRIBUTES are named counts as "1.00" strings: غرفة نوم → bedrooms, دورة مياه → bathrooms,
  صالة → halls, مجلس → reception_rooms_majlis, جناح نوم رئيسي / غرفة نوم ماستر → master_bedrooms,
  and count_flag() turns مطبخ / غرفة خادمة / غرفة سائق / غرفة غسيل / شرفة / ترس into the amenity
  tri-state (a stated count > 0 → True, a stated 0 → False, silent → NULL). سطح / صالة طعام / ملحق /
  حوش have no column and are kept in additional_info.
· FEATURES are named: موقف سيارة → parking, مصعد → elevator, مؤثث → furnished, مدخل خاص →
  private_entrance, توفر ماء/كهرباء/صرف صحي → water_supply/electricity/sanitation. The table is
  EXACT-match and closed: «تأسيس مصعد» (15 units) is a PREPARED shaft, not a lift, and is not a key,
  so elevator stays NULL for it (amenities_from_text is not used here because that qualifier sits
  BEFORE the noun, outside its after-window). «حديقة» has no column.
· AGE: `yearBuilt` is a date ("2025-05-05"); its year goes through age_from_completion_year, so
  the age is recomputed on every run rather than stored once.
· PHOTOS: the project detail (`/api/public/projects/<id>`) carries `thumbnail` and `images`; the
  unit carries none, so every unit of a project shows the project's own images.
· PII: none in the payload (the marketer is `userId: 1`, an integer). Descriptions still go through
  pii.redact_pii.

REMOVAL ORACLE (measured 2026-09-24)
  `GET /api/public/projects/<id>`: 7 ids that are not projects (1, 2, 3, 4, 5, 99, 999) → HTTP 404
  {"success":false,"message":"تعذر العثور على المشروع المحدد…"} — 7/7; every one of the 29 listed
  projects → 200 with its record — 29/29. The unit's own fate is read from that record: absent from
  `properties[]`, or present with a status other than «available», → GONE; present and available →
  LIVE. The site's /ar/properties/<id> page is NOT an oracle: it answers 200 with the same app shell
  for id 1, 9999 and 70 alike.

WRITES go through db._wasalt_batch on the two snam tables (the public upsert_snam_*_batch
wrappers are added centrally later, with the tables).
"""
from __future__ import annotations

import argparse
import datetime as dt
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

BASE = "https://snam.sa"
SOURCE = "سنام العقارية"
PREFIX = "SNM"
API = f"{BASE}/api/public/projects"
PAUSE = 0.4

_TYPE_OVERRIDES = {"مبنى": "Building"}
_CITY_EN_AR = {"riyadh": "الرياض", "ar riyadh": "الرياض"}
_AVAILABLE = "available"
_NOT_FOUND = "تعذر العثور على المشروع"

# attributeValues[].attributeName (stripped) → the column that holds the COUNT
_COUNT_COLS = {"غرفة نوم": "bedrooms", "دورة مياه": "bathrooms", "صالة": "halls",
               "مجلس": "reception_rooms_majlis", "جناح نوم رئيسي": "master_bedrooms",
               "غرفة نوم ماستر": "master_bedrooms"}
# attributeName → the amenity column its count answers (tri-state via count_flag)
_FLAG_COLS = {"مطبخ": "kitchen", "غرفة خادمة": "maid_room", "غرفة سائق": "driver_room",
              "غرفة غسيل": "laundry_room", "شرفة": "balcony_terrace", "ترس": "balcony_terrace"}
# features[].name → column (a NAMED feature is a source-stated True)
_FEATURE_COLS = {"موقف سيارة": "parking", "مصعد": "elevator", "مؤثث": "furnished",
                 "مدخل خاص": "private_entrance", "توفر ماء": "water_supply",
                 "توفر كهرباء": "electricity", "توفر صرف صحي": "sanitation"}


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent — never set one here
    # Arabic FIRST: the API localizes names and types by Accept-Language.
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def _pos(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def city_from_location(loc: dict) -> Optional[str]:
    """The Arabic city name the catalog accepts, read only from what the source wrote: `city` first,
    then the address components from the COARSE end («السعودية» → «منطقة الرياض» → «محافظة الرياض»
    → …), so the city-level component is met before any district. Three guards, each measured
    against the real catalog: the component the source itself labels `neighborhood` is never a
    candidate; a candidate must sit in the region the address names («منطقة الرياض» → 1); and
    to_catalog gets NO region hint (a hint upgrades a twin-named district into a city). Returns None
    when nothing the source wrote places as a city; never a default.
    ponytail: a region-only address whose finest component is a region-1 city name spelled unlike
    `neighborhood` («لبن، منطقة الرياض» with neighborhood «حي لبن») would still resolve to that city;
    no live address has that shape — add a «no city-level component → skip» rule if one appears."""
    loc = loc or {}
    parts = [p.strip() for p in re.split(r"[,،]", str(loc.get("address") or "")) if p.strip()]
    # The region the address itself names: a component the catalog knows as a region and not a city.
    region = next((rid for p in parts for cid, rid in (to_catalog(p),) if rid and not cid), None)
    nb = (loc.get("neighborhood") or "").strip()
    cands = ([str(loc["city"]).strip()] if loc.get("city") else []) + [p for p in reversed(parts) if p != nb]
    for c in cands:
        # The bare name first, so an accepted «محافظة الرياض» is stored as the city «الرياض».
        for name in (re.sub(r"^(?:محافظة|مدينة)\s+", "", c), c, _CITY_EN_AR.get(c.lower(), "")):
            if not name:
                continue
            cid, rid = to_catalog(name)
            if cid and (region is None or rid == region):
                return name
    return None


def fetch_projects(s: cc.Session) -> tuple[list[dict], int]:
    out: list[dict] = []
    total = 0
    page = 1
    while True:
        r = s.get(API, params={"page": page, "limit": 100}, timeout=40)
        if r.status_code != 200:
            raise RuntimeError(f"projects page {page} → HTTP {r.status_code}")
        j = r.json()
        data = (j.get("data") or {})
        items = data.get("data") or []
        meta = data.get("meta") or {}
        total = int(meta.get("total") or total or 0)
        out.extend(items)
        if page >= int(meta.get("totalPages") or 1) or not items:
            return out, total
        page += 1


def fetch_project(s: cc.Session, project_id: int) -> Optional[dict]:
    r = s.get(f"{API}/{project_id}", timeout=40)
    if r.status_code != 200:
        return None
    try:
        return (r.json() or {}).get("data") or None
    except ValueError:
        return None


def project_photos(detail: Optional[dict]) -> list[str]:
    out: list[str] = []
    d = detail or {}
    for item in ([d.get("thumbnail")] + list(d.get("images") or [])):
        u = item.get("url") if isinstance(item, dict) else item
        if isinstance(u, str) and u.startswith("http") and u not in out:
            out.append(u)
    return out


def map_listing(project: dict, unit: dict, photos: list[str],
                today: Optional[dt.date] = None) -> tuple[Optional[dict], str, str]:
    pid, uid = project.get("id"), unit.get("id")
    if not pid or not uid:
        return None, "residential", "no_id"
    if unit.get("isArchived") or project.get("isArchived"):
        return None, "residential", "archived"
    status = (unit.get("status") or "").strip().lower()
    if status != _AVAILABLE:
        return None, "residential", f"status_{status or 'blank'}"
    type_ar = ((unit.get("propertyType") or {}).get("name") or "").strip()
    property_type = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    loc = project.get("location") or {}
    city_ar = city_from_location(loc)
    if not city_ar:
        return None, category, "city_not_in_catalog"
    city_id, region_id = to_catalog(city_ar)
    district_raw = (loc.get("neighborhood") or "").strip() or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    price_raw = unit.get("priceSar")
    price = _pos(price_raw)
    description = redact_pii((unit.get("description") or "").strip()) or None
    year = str(unit.get("yearBuilt") or "")[:4]
    today = today or dt.date.today()

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}U{uid}",
        "listing_url": f"{BASE}/ar/properties/{uid}",
        "source": SOURCE,
        "active": True,
        "title": " – ".join(x for x in ((unit.get("name") or "").strip(),
                                        (project.get("name") or "").strip()) if x) or None,
        "description": description,
        "property_type": property_type,
        "transaction_type": "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(unit.get("buildingArea")),
        "street_width_m": normalize.one_street_width(unit.get("streetWidth")),
        "property_age": normalize.age_from_completion_year(year, this_year=today.year) if year else None,
        "price_total": price,
        "photo_urls": photos[:20] or None,
        "price_evidence": normalize.price_evidence(
            field="properties[].priceSar", raw=price_raw, stored=price, kind="total", origin="api"),
    }
    extra: dict[str, Any] = {}
    for a in unit.get("attributeValues") or []:
        name = (a.get("attributeName") or "").strip()
        val = a.get("value")
        if name in _COUNT_COLS:
            row[_COUNT_COLS[name]] = _pos(val)
        elif name in _FLAG_COLS:
            flag = normalize.count_flag(val)
            if flag is not None:
                row[_FLAG_COLS[name]] = flag
        else:
            extra[name] = val
    features: list[str] = []
    for f in unit.get("features") or []:
        name = (f.get("name") or "").strip()
        if not name:
            continue
        features.append(name)
        # Exact match against the closed table: «تأسيس مصعد» (a prepared shaft) is not a key, so it
        # can never become elevator=True; it stays in additional_info.features only.
        col = _FEATURE_COLS.get(name)
        if col:
            row[col] = True
    row["additional_info"] = {k: v for k, v in {
        "project_id": pid, "project_name": (project.get("name") or "").strip(),
        "project_status": project.get("status"), "unit_id": uid,
        "unit_number": unit.get("unitNumber"), "type_ar": type_ar,
        "condition": unit.get("condition"), "year_built": unit.get("yearBuilt"),
        "street_width_raw": unit.get("streetWidth"), "building_area_raw": unit.get("buildingArea"),
        "features": features, "other_attributes": extra,
        "address": loc.get("address"), "lat": loc.get("latitude"), "lng": loc.get("longitude"),
        "updated_at": unit.get("updatedAt"),
    }.items() if v not in (None, "", {}, [])}
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
_AD_NUMBER = re.compile(rf"^{PREFIX}(\d+)U(\d+)$")


def _signal_for(unit_id: int):
    def _signal(status, body, _moved):
        if status == 404 and _NOT_FOUND in body:
            return "gone"                                  # the whole project is gone
        if status != 200:
            return None
        try:
            data = (json.loads(body) or {}).get("data") or {}
        except (ValueError, TypeError, AttributeError):
            return None
        if not isinstance(data, dict) or not data.get("id"):
            return None
        mine = [u for u in (data.get("properties") or []) if (u or {}).get("id") == unit_id]
        if not mine:
            return "gone"
        return "live" if (mine[0].get("status") or "").lower() == _AVAILABLE and not mine[0].get("isArchived") else "gone"
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    m = _AD_NUMBER.match(ad_number)
    if not m:
        return "unknown", f"{ad_number!r} is not a {PREFIX}<project>U<unit> ad number"
    pid, uid = int(m.group(1)), int(m.group(2))
    return LivenessProbe(platform="snam", signal=_signal_for(uid), session=session,
                         url_for=lambda _ad: f"{API}/{pid}").verify_gone(ad_number)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("snam")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    try:
        projects, total = fetch_projects(s)
        print(f"{SOURCE}: {len(projects)} projects fetched (site says total={total})", flush=True)
        if not projects:
            raise RuntimeError("the projects endpoint returned no projects")
        if args.limit:
            projects = projects[:args.limit]
        for p in projects:
            units = p.get("properties") or []
            if not units:
                skipped["project_no_units"] = skipped.get("project_no_units", 0) + 1
                continue
            photos: list[str] = []
            if any((u.get("status") or "").lower() == _AVAILABLE for u in units):
                photos = project_photos(fetch_project(s, int(p["id"])))
                time.sleep(PAUSE)
            for u in units:
                seen += 1
                row, cat, why = map_listing(p, u, photos)
                if not row:
                    skipped[why] = skipped.get(why, 0) + 1
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}", flush=True)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>10} {r0['property_type']:9} {r0['city_ar']:7} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>4} "
                      f"bd={str(r0.get('bedrooms')):>2} ba={str(r0.get('bathrooms')):>2} "
                      f"p={r0.get('price_total')} age={r0.get('property_age')} sw={r0.get('street_width_m')} "
                      f"el={r0.get('elevator')} pk={r0.get('parking')} ph={len(r0.get('photo_urls') or [])}")
            return 0

        # The public upsert_snam_*_batch wrappers are added centrally with the tables.
        db._wasalt_batch("snam_residential_listings", res)
        db._wasalt_batch("snam_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="snam_residential_listings", com_table="snam_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        # Only after a COMPLETE enumeration (the API's own total agrees), never --type/--limit.
        if args.type == "all" and len(projects) >= total:
            for tbl, rows in (("snam_residential_listings", res),
                              ("snam_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["snam_residential_listings",
                                           "snam_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
