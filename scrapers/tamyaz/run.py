"""تمايز العقارية — tamyaz-sa.com. 9 properties (Jeddah / Makkah), onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24). A Vite/React single page whose listings grid is backed
by its own JSON API, called exactly as the page does:
    GET https://www.tamyaz-sa.com/api/properties            → array of 9 objects (whole catalogue)
    GET https://www.tamyaz-sa.com/api/properties/<id>       → the object, or HTTP 404
                                                             {"message":"العقار غير موجود"}
  Keys: id (a slug: "prop-mu7drwdljc4k", "retail-shop" …), title{ar,en}, type{ar,en},
  filter, location{ar,en} («منطقة مكة المكرمة - جدة - حي الفلاح» = region - city - district),
  desc{ar,en}, amenities[{label{ar,en},count}], bedrooms, bathrooms, area, price, forSale,
  gallery[relative /uploads/…], lat, lng, featured, published, createdAt.

  THE DETAIL "PAGE" IS A HASH ROUTE. The app has no path router; `#property-<id>` mounts the
  property view (verified in a real browser: https://www.tamyaz-sa.com/#property-prop-mu7drwdljc4k
  renders «شقة روف للايجار حي الفلاح … 24,000ر.س / سنة»). listing_url is that hash URL.

  PRICE / PERIOD. `price` is a bare integer; the UI prints «{price} ر.س» and, for EVERY
  forSale:false row, appends its own CONSTANT perYear = «/ سنة» regardless of what that listing
  actually states — the API objects carry no period field whatsoever (checked all 9 keys) and no
  per-listing text ever varies. That is a UI-wide template, not any ONE listing's own words for
  THAT price, so the shared, audited normalize.rent_period_and_annual() still reads the listing's
  OWN title+desc first for a period token (a future listing that writes «شهرياً»/«سنوياً» in its
  own prose wins over the template, same as wadod). OWNER ATTESTATION 2026-09-24 (checked the live
  site, "those are yearly, they mention it"): when no per-listing text states a period, the site's
  own universal «/ سنة» template is a platform-level statement — the same class as azure's
  Paid-Annually-tab-only read and rightcompound's "not monthly" disclaimer — so a silent row now
  gets rent_period='annual' rather than staying NULL. (2026-09-24 earlier same-day review had first
  rejected this exact constant as too broad to trust per-listing; the owner's live confirmation is
  what changes the reading — the constant itself did not change.) Registered in
  ops_rent_period_single_value_ok + SINGLE_PERIOD_PLATFORMS. A sale stores price_total verbatim.

  TRAPS MEASURED ON THE 9:
    · 3 titles say «للاستثمار» (investment showrooms / buildings, forSale:false, 700k–3M) — an
      investment deal states neither sale nor lease → skipped, never parked as a rent.
    · `type.ar` CONTRADICTS the title on «عمارة للبيع جدة حي السلامة» (type «شقة», 900 m², 7M,
      0 bedrooms). Both are source; when the title's leading type word maps to a different canonical
      type than the structured field, the row is skipped as type_title_conflict rather than filed
      under either — raised as an open question.
    · `bedrooms`/`bathrooms` 0 = unset (the UI hides them at 0: `e.bedrooms>0&&`) → NULL.
    · `amenities[].count` is only meaningful for countable labels; the UI renders every label as a
      chip and the number only when count>0. So «مصعد» count 0 IS a shown elevator chip → True.
      «الغرف»/«حمام» mirror bedrooms/bathrooms; «القاعات» → halls; «رقم الطابق» → floor_number;
      «الواجهة: الغربية» → direction; «الفئة : عائلة» / «حالة البناء : جيد» / «الأمن» → additional_info.
    · `lat`/`lng` are PLACEHOLDERS (24.7136, 46.6753 = Riyadh, on Jeddah flats) → not stored.
    · gallery paths are relative → absolute on BASE, percent-encoded; one fetched: 200 image/jpeg.
    · The site publishes no ad-licence number, no property age, no street width.

  REMOVAL ORACLE (measured 2026-09-24): 3/3 fabricated ids (does-not-exist, modern-villa-x,
  prop-000000000000) → HTTP 404 JSON «العقار غير موجود»; the live id → 200 JSON with the same `id`.
  So: 404 + that message → gone; 200 + JSON whose id matches and published is not false → live;
  200 + published:false → gone (the UI never shows it); anything else → no opinion. Removal is
  additionally gated by an in-run positive control that fails CLOSED.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://www.tamyaz-sa.com"
SOURCE = "تمايز العقارية"
PREFIX = "TMZ"

# The site's exact type spellings. «عمارة سكنية» is not in the shared map.
_TYPE_OVERRIDES = {"شقة": "Apartment", "فيلا": "Villa", "عمارة سكنية": "Building", "عمارة": "Building",
                   "مكتب": "Office", "محل": "Shop"}
# Leading title words, used ONLY to detect a title that contradicts the structured type.
_TITLE_TYPE_WORDS = {"عمارة": "Building", "فيلا": "Villa", "شقة": "Apartment", "أرض": "Residential Land",
                     "ارض": "Residential Land", "محل": "Shop", "مكتب": "Office", "معرض": "Showroom",
                     "معارض": "Showroom", "دور": "Floor", "استراحة": "Rest House", "شاليه": "Chalet"}
_UI_PER_YEAR = "/ سنة"                   # the UI's perYear literal, printed beside every rent figure
_DWELLINGS = {"Apartment", "Villa", "Floor", "Chalet", "Rest House"}


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7", "Accept": "application/json"})
    return s


def _pos(v) -> Optional[int]:
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _amenities(items: list) -> tuple[dict[str, Any], list[str]]:
    """The amenities[] chips → real columns + the raw labels for the archive."""
    cols: dict[str, Any] = {}
    labels: list[str] = []
    for a in items or []:
        lab = str(((a or {}).get("label") or {}).get("ar") or "").strip()
        if not lab:
            continue
        cnt = normalize.to_int_numeric((a or {}).get("count"))
        labels.append(f"{lab}: {cnt}" if cnt else lab)
        if lab == "القاعات" and cnt:
            cols["halls"] = cnt
        elif lab == "رقم الطابق" and cnt:
            cols["floor_number"] = cnt
        elif lab.startswith("الواجهة"):
            d = normalize.one_direction(lab.split(":", 1)[-1].strip())
            if d:
                cols["direction"] = d
    return cols, labels


def map_listing(p: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    pid = str(p.get("id") or "").strip()
    if not pid:
        return None, "residential", "no_id"
    if p.get("published") is False:
        return None, "residential", "unpublished"
    title = str((p.get("title") or {}).get("ar") or "").strip() or None
    if "مزاد" in (title or ""):
        return None, "residential", "auction"
    if re.search(r"استثمار", title or ""):
        return None, "residential", "investment"
    type_ar = str((p.get("type") or {}).get("ar") or "").strip()
    property_type = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    first = (title or "").split()[0] if title else ""
    if first in _TITLE_TYPE_WORDS and _TITLE_TYPE_WORDS[first] != property_type:
        return None, "residential", "type_title_conflict"
    category = normalize.category_for_type(property_type).lower()

    loc = str((p.get("location") or {}).get("ar") or "")
    parts = [x.strip() for x in re.split(r"\s[-–]\s", loc) if x.strip()]
    region_ar = parts[0] if len(parts) >= 3 else None
    city_ar = parts[1] if len(parts) >= 3 else (parts[0] if parts else None)
    district_raw = parts[2] if len(parts) >= 3 else (parts[1] if len(parts) == 2 else None)
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, re.sub(r"^منطقة\s+", "", region_ar) if region_ar else None)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_ar = find_district_in_text(district_raw, city_id) or find_district_in_text(title, city_id)

    desc = redact_pii(str((p.get("desc") or {}).get("ar") or "").strip() or None)
    chip_cols, labels = _amenities(p.get("amenities") or [])
    amen_text = "، ".join(labels) + "\n" + (desc or "")
    photos = [BASE + quote(u, safe="/") for u in (p.get("gallery") or []) if isinstance(u, str) and u.startswith("/")] or None
    price = _pos(p.get("price"))
    for_sale = bool(p.get("forSale"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/#property-{pid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": desc,
        **normalize.amenities_from_text(amen_text),
        **chip_cols,
        "property_type": property_type,
        "transaction_type": "Buy" if for_sale else "Rent",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(p.get("area")),
        "bedrooms": _pos(p.get("bedrooms")) if property_type in _DWELLINGS else None,
        "bathrooms": _pos(p.get("bathrooms")) if property_type in _DWELLINGS else None,
        "license_number": None,                  # not published
        "photo_urls": photos,
    }
    if for_sale:
        row["price_total"] = price
    else:
        # RENT PERIOD: read the listing's OWN title+desc first — that always wins. When silent,
        # fall back to the site's own universal «/ سنة» template (owner attestation 2026-09-24,
        # verified live) rather than leaving the row unparked from rent search.
        period, row["price_annual"] = normalize.rent_period_and_annual(price, f"{title or ''} {desc or ''}")
        if period:
            row["rent_period"] = period
        elif row["price_annual"] is not None:
            row["rent_period"] = "annual"          # a daily/weekly rate stays unparked (price_annual None too)
    row["additional_info"] = {k: v for k, v in {
        "source_id": pid,
        "type_ar": type_ar,
        "region_ar": region_ar,
        "source_price_raw": p.get("price"),
        "price_unit_ui": None if for_sale else f"ر.س {_UI_PER_YEAR}",
        "amenity_labels": labels or None,
        "source_bedrooms": p.get("bedrooms"), "source_bathrooms": p.get("bathrooms"),
        "title_en": str((p.get("title") or {}).get("en") or "").strip() or None,
        "featured": p.get("featured") or None,
    }.items() if v is not None}
    return row, category, ""


def fetch_properties(s: cc.Session, limit: int = 0) -> list[dict]:
    r = s.get(f"{BASE}/api/properties", timeout=40)
    if r.status_code != 200:
        raise RuntimeError(f"/api/properties returned {r.status_code}")
    try:
        body = r.json()
    except ValueError as exc:
        raise RuntimeError(f"/api/properties is no longer JSON: {exc}") from exc
    if not isinstance(body, list) or not body:
        raise RuntimeError("/api/properties returned no property objects")
    items = [p for p in body if isinstance(p, dict)]
    return items[:limit] if limit else items


# ── LIVENESS (measured 2026-09-24; see docstring) ────────────────────────────────────────────────
def _make_signal(pid: str):
    def _signal(status, body, _moved):
        if status == 404 and "غير موجود" in body:
            return "gone"
        if status != 200:
            return None
        try:
            obj = json.loads(body)
        except ValueError:
            return None
        if not isinstance(obj, dict) or str(obj.get("id")) != pid:
            return None
        return "gone" if obj.get("published") is False else "live"
    return _signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):]
        if not pid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform="tamyaz", signal=_make_signal(pid), session=session,
                             url_for=lambda _ad: f"{BASE}/api/properties/{pid}",
                             canary=canary).verify_gone(ad_number)

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
    run_id = None if dry else db.begin_run("tamyaz")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        items = fetch_properties(s, limit=args.limit)
        print(f"{SOURCE}: {len(items)} properties from /api/properties", flush=True)
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
                print(f"   {r0['ad_number']:>24} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):6} d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>5} "
                      f"b={r0.get('bedrooms')} ba={r0.get('bathrooms')} pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} fl={r0.get('floor_number')} "
                      f"dir={r0.get('direction')} el={r0.get('elevator')} k={r0.get('kitchen')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_tamyaz_*_batch wrappers are added centrally later; same funnel.
        db._wasalt_batch("tamyaz_residential_listings", res)
        db._wasalt_batch("tamyaz_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="tamyaz_residential_listings", com_table="tamyaz_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all":          # /api/properties IS the whole catalogue (the UI reads the same list)
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("tamyaz_residential_listings", res), ("tamyaz_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items), rows_upserted=len(res) + len(com),
                            notes=f"pruned={pruned} {notes}"[:300],
                            check_tables=["tamyaz_residential_listings", "tamyaz_commercial_listings"])
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
