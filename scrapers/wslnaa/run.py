"""منصة وصلنا العقارية — wslnaa.com. 59 listings, onboarding 2026-09-19.

SOURCE SHAPE (probed live before any code):
  · The site is a client-rendered app: the served HTML contains NO listing values at all. The body
    text has no price, and the JS bundle does not carry the catalogue either. Everything a scraper
    could read from the HTML is the og: meta pair — and og:description is TRUNCATED at ~155 chars,
    so across the 59 listings it yields a city on only 12, a price on 13 and bedrooms on 5.
    Parsing the meta would have shipped a platform that is ~80% empty and looked fine by row count.
  · The app fetches each listing from its own tRPC endpoint, which returns the WHOLE record:
        /api/trpc/properties.bySlug?batch=1&input={"0":{"json":{"slug":"<slug>"}}}
    giving title, description, type, mode, price, rentPeriod, priceSuffix, region, district,
    rooms, area, status, images and propertyCode. That is the source of truth this scraper uses;
    the sitemap supplies the slugs.
  · FIELDS WORTH NAMING:
      - `region` holds the CITY («الرياض»), not an administrative region.
      - `district` is already ARABIC («حي الملز») — no transliteration question on this source.
      - `rentPeriod` is stated («yearly»), so the period is never defaulted.
      - `area` is 0 when unknown; 0 m² is not an area and is stored as NULL.
      - `rooms` IS NOT BEDROOMS on a commercial listing. Measured: a shop with rooms=2 is titled
        «فتحتان تجاريتان متجاورتان» (two adjoining commercial units) and a building with rooms=24
        is «8 شقق وقبو» — 24 rooms across eight flats, not a 24-bedroom home. Writing that into
        bedrooms would put "24 غرف" on a building card and make it answer a bedroom filter. It is
        only read as bedrooms for a residential dwelling; otherwise it is kept in additional_info.
      - `status` must be «available»; anything else is not an offer we may publish.
      - `images` is a JSON-encoded STRING, not a list.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://wslnaa.com"
SOURCE = "Waslna"
PREFIX = "WSL"


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


_TYPE_EN_AR = {
    "apartment": "شقة", "villa": "فيلا", "duplex": "دوبلكس", "studio": "استوديو",
    "floor": "دور", "building": "عمارة", "office": "مكتب", "showroom": "معرض",
    "shop": "محل", "land": "أرض", "warehouse": "مستودع", "chalet": "شاليه",
    "rest_house": "استراحة", "resthouse": "استراحة", "room": "غرفة",
}


# Types whose «rooms» genuinely means bedrooms. Anything else keeps rooms out of that column.
_DWELLING_TYPES = {"apartment", "villa", "duplex", "studio", "floor", "chalet", "rest_house",
                   "resthouse", "room"}


def _int(v: Any) -> Optional[int]:
    if v is None:
        return None
    try:
        n = int(float(str(v).replace(",", "").strip()))
        return n if n > 0 else None      # area/price of 0 means "not stated", never zero
    except (TypeError, ValueError):
        return None


def map_listing(p: dict) -> tuple[Optional[dict], str, str]:
    if not p.get("active") or p.get("deletedAt"):
        return None, "residential", "inactive"
    if (p.get("status") or "").lower() != "available":
        return None, "residential", f"status_{p.get('status')}"

    type_ar = _TYPE_EN_AR.get((p.get("type") or "").strip().lower())
    if not type_ar:
        return None, "residential", "type_unmapped"
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    mode = (p.get("mode") or "").strip().lower()
    deal = "Rent" if mode == "rent" else ("Buy" if mode in ("sale", "buy", "sell") else None)
    if not deal:
        return None, category, "no_deal"

    # `region` is the CITY on this source, despite the field name.
    city_ar = (p.get("region") or "").strip() or None
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"

    district_raw = (p.get("district") or "").strip() or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    price = _int(p.get("price"))
    imgs: list[str] = []
    raw_imgs = p.get("images")
    if isinstance(raw_imgs, str):
        try:
            imgs = [u for u in json.loads(raw_imgs) if isinstance(u, str)]
        except (ValueError, TypeError):
            imgs = []
    elif isinstance(raw_imgs, list):
        imgs = [u for u in raw_imgs if isinstance(u, str)]
    if p.get("image") and p["image"] not in imgs:
        imgs.insert(0, p["image"])

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{p['id']}",
        "listing_url": f"{BASE}/properties/{p.get('slug')}",
        "source": SOURCE,
        "active": True,
        "title": (p.get("title") or "").strip() or None,
        "description": (p.get("description") or "").strip() or None,
        "property_type": property_type,
        "transaction_type": deal,
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _int(p.get("area")),
        "bedrooms": (_int(p.get("rooms"))
                     if (p.get("type") or "").strip().lower() in _DWELLING_TYPES else None),
        "photo_urls": imgs[:20] or None,
    }
    if deal == "Rent":
        # The source STATES the period; it is mapped, never derived from the number.
        rp = (p.get("rentPeriod") or "").strip().lower()
        if rp in ("yearly", "annual", "annually"):
            row["rent_period"] = "annual"
            row["price_annual"] = price
        elif rp == "monthly":
            row["rent_period"] = "monthly"
            row["price_annual"] = normalize.annualize_rent(price, "monthly")
        else:
            row["price_annual"] = price          # period unknown → never defaulted
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_en": p.get("type"), "property_code": p.get("propertyCode"),
        "price_suffix": p.get("priceSuffix"), "building_id": p.get("buildingId"),
        "map_url": p.get("mapUrl"), "slug": p.get("slug"),
        "source_rooms": p.get("rooms"),
    }.items() if v is not None}
    return row, category, ""


def fetch_slugs(s: cc.Session, limit: int = 0) -> list[str]:
    r = s.get(f"{BASE}/sitemap.xml", timeout=40)
    if r.status_code != 200:
        return []
    urls = sorted({u for u in re.findall(r"<loc>([^<]+)</loc>", r.text) if "/properties/" in u})
    slugs = [u.rstrip("/").rsplit("/", 1)[-1] for u in urls if u.rstrip("/").rsplit("/", 1)[-1]]
    slugs = [x for x in slugs if x != "properties"]
    return slugs[:limit] if limit else slugs


def fetch_one(s: cc.Session, slug: str) -> Optional[dict]:
    payload = json.dumps({"0": {"json": {"slug": slug}}}, ensure_ascii=False, separators=(",", ":"))
    r = s.get(f"{BASE}/api/trpc/properties.bySlug", params={"batch": 1, "input": payload}, timeout=40)
    if r.status_code != 200:
        return None
    try:
        return r.json()[0]["result"]["data"]["json"]
    except (ValueError, KeyError, IndexError, TypeError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("wslnaa")
    res: list[dict] = []
    com: list[dict] = []
    try:
        slugs = fetch_slugs(s, limit=args.limit)
        if not slugs:
            raise RuntimeError("sitemap returned no /properties/ slugs")
        print(f"{SOURCE}: {len(slugs)} listings discovered", flush=True)
        skipped: dict[str, int] = {}
        for sl in slugs:
            p = fetch_one(s, sl)
            if not p:
                skipped["api_miss"] = skipped.get("api_miss", 0) + 1
                continue
            row, cat, why = map_listing(p)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>10} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):7} d={str(r0['district_ar'])[:12]:12} "
                      f"a={str(r0['area_m2']):>5} bd={str(r0['bedrooms']):>3} "
                      f"pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        if res:
            db.upsert_wslnaa_residential_batch(res)
        if com:
            db.upsert_wslnaa_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="wslnaa_residential_listings", com_table="wslnaa_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(slugs), rows_upserted=len(res) + len(com),
                             check_tables=["wslnaa_residential_listings",
                                           "wslnaa_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
