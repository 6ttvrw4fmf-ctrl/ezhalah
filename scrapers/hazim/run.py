"""حازم — hazim.sa. 6 properties (Khobar / Dammam), onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24). A Base44 low-code SPA; the listings page calls the app's
own public entity endpoint without any auth, and so does this scraper:
    GET https://hazim.sa/api/apps/6a0b08a09681ebc6062f547e/entities/Property
        ?sort=-created_date&limit=100&skip=N        → JSON array (paged by skip; 6 rows total)
    GET …/entities/Property/<id>                    → the object, or HTTP 404
        {"message":"Entity Property with ID <id> not found"}
  The detail page is the path route /properties/<id> (verified in a real browser: it renders
  ref 1123 «فيلا زاوية - حي الجسر … 165000 ر.س»). `id` is the 24-hex Base44 entity id; `ref` is
  the office's own number (1122–1127). ad_number = HZM + id (the id is what the URL is built from).

  FIELDS: title, type (مكتب/عمارة/فيلا), category (سكني/تجاري/صناعي — the SITE's bucket, archived;
  ours comes from the canonical type), tag (للبيع/للإيجار), status (متاح/مؤجر/مباع/محجوز — the
  admin form's closed list), price (a STRING: "165000", "0", "اتصل للاستفسار"), priceUnit («ر.س»
  or «ر.س / سنوياً»), area (float, 349.5), rooms, bathrooms, floors, floor, furnished (مفروش /
  غير مفروش), parking, year (2023.0), city, district, location, description, features[], nearby[],
  image, images[], brochure_url, map_url, plus agent_name / agent_phone / agent_avatar /
  assigned_agent_id / created_by_id (PII → never read).

  TRAPS MEASURED ON THE 6:
    · ref 1122 has status «مباع» → skipped (sold). Only «متاح» maps; مؤجر/محجوز are skipped by name.
    · PRICE: 3 rows print «اتصل للاستفسار» (price on request) → NULL, archived; ref 1127 (office
      complex for rent) has price "0", which the UI renders literally as «0 ر.س» because the string
      "0" is truthy. Zero is the fleet's unset sentinel (to_int_numeric), not a rent, so it is stored
      as NULL with the raw "0" archived and raised as an open question — never as a 0-riyal rent.
    · PERIOD: `priceUnit` «ر.س / سنوياً» states annual (2 rows, both priced on request → rent_period
      annual, price_annual NULL); bare «ر.س» on a rent states nothing → NULL period.
    · `parking` is true on 6/6 rows and the detail page renders it as the literal «مواقف true» —
      a form default, so it is not read; parking comes only from the features prose («كراج سيارة»).
    · `floor` -1.0 on the office complex = unset sentinel → floor_number NULL (raw archived).
    · `rooms`/`bathrooms` 0 = unset → NULL; read for dwellings only (a building's 0 is not a count).
    · `year` 2023.0 → property_age via age_from_completion_year (whole years).
    · district is null on 2 rows → find_district_in_text over `location`; neighborhood keeps the
      source's district or location text.
    · «الميناء» (Dammam) and «حي العزيزية» (Khobar) are not catalog districts → district_ar NULL.
    · Photos are absolute media.base44.com URLs; one fetched: 200 image/jpeg.

  REMOVAL ORACLE (measured 2026-09-24): 4/4 fabricated ids (000…0, fff…f, …7788 = live id + 1,
  and a random 24-hex) → HTTP 404 JSON «… not found»; the live id → 200 JSON with the same id and
  status «متاح». So: 404 + "not found" → gone; 200 + JSON id match + status «متاح» → live; 200 +
  status مباع/مؤجر/محجوز → gone (the crawl skips those on sight); anything else → no opinion.
  Removal is additionally gated by an in-run positive control that fails CLOSED.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://hazim.sa"
SOURCE = "حازم"
PREFIX = "HZM"
APP_ID = "6a0b08a09681ebc6062f547e"
API = f"{BASE}/api/apps/{APP_ID}/entities/Property"

_TYPE_OVERRIDES = {"مكتب": "Office", "عمارة": "Building", "فيلا": "Villa", "شقة": "Apartment",
                   "أرض": "Residential Land", "مستودع": "Warehouse", "محل": "Shop"}
_CLOSED_STATUS = {"مباع": "sold", "مؤجر": "rented", "محجوز": "reserved"}
_DWELLINGS = {"Apartment", "Villa", "Floor", "Chalet", "Rest House"}
_PAGE = 100


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7", "Accept": "application/json"})
    return s


def _pos(v) -> Optional[int]:
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def parse_price(raw) -> Optional[int]:
    """The `price` STRING → integer riyals, or None for «اتصل للاستفسار» / "0" / blank (see docstring)."""
    if raw is None or isinstance(raw, bool):
        return None
    s = str(raw).strip()
    if not re.fullmatch(r"[\d٠-٩,.\s]+", s):
        return None
    n = normalize.to_int(s)
    return n if n else None


def map_listing(p: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    pid = str(p.get("id") or "").strip()
    if not pid:
        return None, "residential", "no_id"
    if p.get("is_sample"):
        return None, "residential", "sample_row"
    title = re.sub(r"\s+", " ", str(p.get("title") or "")).strip() or None
    if "مزاد" in (title or ""):
        return None, "residential", "auction"
    status = str(p.get("status") or "").strip()
    if status in _CLOSED_STATUS:
        return None, "residential", _CLOSED_STATUS[status]
    if status != "متاح":
        return None, "residential", f"status_unmapped_{status or 'blank'}"
    type_ar = str(p.get("type") or "").strip()
    property_type = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()
    tag = str(p.get("tag") or "").strip()
    if tag == "للبيع":
        tx = "Buy"
    elif tag in ("للإيجار", "للايجار"):
        tx = "Rent"
    else:
        return None, category, f"tag_unmapped_{tag or 'blank'}"
    city_ar = str(p.get("city") or "").strip() or None
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = str(p.get("district") or "").strip() or None
    location = re.sub(r"\s+", " ", str(p.get("location") or "")).strip() or None
    district_ar = (find_district_in_text(district_raw, city_id) or find_district_in_text(location, city_id)
                   or find_district_in_text(title, city_id))

    description = redact_pii(str(p.get("description") or "").strip() or None)
    features = [redact_pii(str(f)) for f in (p.get("features") or []) if str(f).strip()]
    amen_text = "\n".join(features) + "\n" + (description or "")
    furnished_raw = str(p.get("furnished") or "").strip()
    furnished = True if furnished_raw == "مفروش" else False if furnished_raw.startswith("غير") else None
    area_num = p.get("area")
    area = _pos(area_num)
    floor_raw = p.get("floor")
    floor_num = normalize.to_int_numeric(floor_raw) if isinstance(floor_raw, (int, float)) and floor_raw >= 0 else None
    year = normalize.to_int_numeric(p.get("year"))
    photos: list[str] = []
    for u in [p.get("image")] + list(p.get("images") or []):
        if isinstance(u, str) and u.startswith("http") and u not in photos:
            photos.append(u)
    price = parse_price(p.get("price"))
    unit = str(p.get("priceUnit") or "").strip()

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/properties/{pid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": description,
        **normalize.amenities_from_text(amen_text),
        "property_type": property_type,
        "transaction_type": tx,
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw or location,
        "area_m2": area,
        "bedrooms": _pos(p.get("rooms")) if property_type in _DWELLINGS else None,
        "bathrooms": _pos(p.get("bathrooms")) if property_type in _DWELLINGS else None,
        "floor_number": floor_num,
        "property_age": normalize.age_from_completion_year(year, this_year=datetime.now(timezone.utc).year) if year else None,
        "license_number": None,                  # not published
        "photo_urls": photos or None,
    }
    if furnished is not None:
        row["furnished"] = furnished
    price_note = None
    if tx == "Rent":
        period, row["price_annual"] = normalize.rent_period_and_annual(price, unit)
        if period:
            row["rent_period"] = period
        elif price is not None and row["price_annual"] is None:
            price_note = "period_not_annualizable"
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "source_id": pid,
        "ref": p.get("ref"),
        "type_ar": type_ar,
        "site_category": p.get("category"),
        "source_status": status,
        "source_price_raw": p.get("price"),
        "source_price_unit": unit or None,
        "price_on_request": True if (p.get("price") and price is None and not re.fullmatch(r"[\d\s,.]+", str(p.get("price")))) else None,
        "price_note": price_note,
        "area_raw": area_num if isinstance(area_num, float) and area_num != int(area_num) else None,
        "floors": p.get("floors"),
        "floor_raw": floor_raw if floor_num is None and floor_raw is not None else None,
        "furnished_raw": furnished_raw or None,
        "completion_year": year,
        "features": features or None,
        "nearby": [str(x) for x in (p.get("nearby") or [])] or None,
        "location_text": location,
        "brochure_url": p.get("brochure_url"),
        "map_url": p.get("map_url"),
        "created_date": p.get("created_date"), "updated_date": p.get("updated_date"),
    }.items() if v is not None}
    return row, category, ""


def fetch_properties(s: cc.Session, limit: int = 0) -> list[dict]:
    items: list[dict] = []
    skip = 0
    while True:
        r = s.get(API, params={"sort": "-created_date", "limit": _PAGE, "skip": skip}, timeout=40)
        if r.status_code != 200:
            raise RuntimeError(f"entities/Property returned {r.status_code} at skip={skip}")
        try:
            page = r.json()
        except ValueError as exc:
            raise RuntimeError(f"entities/Property is no longer JSON: {exc}") from exc
        if not isinstance(page, list):
            raise RuntimeError("entities/Property did not return a list")
        items.extend(p for p in page if isinstance(p, dict))
        if len(page) < _PAGE or (limit and len(items) >= limit):
            break
        skip += _PAGE
    if not items:
        raise RuntimeError("entities/Property returned no property objects")
    return items[:limit] if limit else items


# ── LIVENESS (measured 2026-09-24; see docstring) ────────────────────────────────────────────────
def _make_signal(pid: str):
    def _signal(status, body, _moved):
        if status == 404 and "not found" in body:
            return "gone"
        if status != 200:
            return None
        try:
            obj = json.loads(body)
        except ValueError:
            return None
        if not isinstance(obj, dict) or str(obj.get("id")) != pid:
            return None
        st = str(obj.get("status") or "").strip()
        if st == "متاح":
            return "live"
        return "gone" if st in _CLOSED_STATUS else None
    return _signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):]
        if not re.fullmatch(r"[0-9a-f]{24}", pid):
            return "unknown", f"{ad_number!r} is not a {PREFIX}<entity id> ad number"
        return LivenessProbe(platform="hazim", signal=_make_signal(pid), session=session,
                             url_for=lambda _ad: f"{API}/{pid}", canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("hazim")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        items = fetch_properties(s, limit=args.limit)
        print(f"{SOURCE}: {len(items)} properties from entities/Property", flush=True)
        for p in items:
            row, cat, why = map_listing(p)
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
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>27} {r0['transaction_type']:4} {str(r0['property_type']):8} "
                      f"{str(r0['city_ar']):6} d={str(r0['district_ar'])[:10]:10} a={str(r0['area_m2']):>6} "
                      f"b={r0.get('bedrooms')} ba={r0.get('bathrooms')} pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} fu={r0.get('furnished')} "
                      f"age={r0.get('property_age')} el={r0.get('elevator')} pk={r0.get('parking')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_hazim_*_batch wrappers are added centrally later; same funnel.
        db._wasalt_batch("hazim_residential_listings", res)
        db._wasalt_batch("hazim_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="hazim_residential_listings", com_table="hazim_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all":          # fetch_properties pages to the end, so the enumeration is complete
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("hazim_residential_listings", res), ("hazim_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items), rows_upserted=len(res) + len(com),
                            notes=f"pruned={pruned} {notes}"[:300],
                            check_tables=["hazim_residential_listings", "hazim_commercial_listings"])
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
