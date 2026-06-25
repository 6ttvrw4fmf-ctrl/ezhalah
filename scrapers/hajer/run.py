"""Hajer Houses (hajerhouses.com / بيوت هجر) scraper — Saudi WordPress + REM plugin site.

بيوت هجر is a Saudi real-estate brokerage office (Al Ahsa / Eastern Province). Saudi-owned →
passes the Saudi-only rule. ~126 listings. No auth, no proxy, cloud-friendly (LiteSpeed WP).

Data path: REM's own REST API (/wp-json/rem/*) is auth-gated (401), and the default WP REST exposes
no property meta. BUT each property's detail page renders a clean REM spec table
(`<strong class="rem-single-field-title">LABEL</strong> … <span class="rem-single-field-value">VAL</span>`).
So: list via the public WP REST (/wp/v2/properties — id, link, featured image), then parse each
detail page's REM fields.

Field map (REM single-field label → our schema):
  رقم الإعلان              → ad_number (HJ{n})
  نوع العقار               → property_type (TYPE_MAP_AR)
  غرض العقار  بيع|إيجار     → transaction_type Buy|Rent
  التصنيف   سكني|تجاري      → residential|commercial routing
  المدينة (الأحساء)         → city (normalize.map_city → Hofuf …)
  أسم الحي                 → neighborhood
  المساحة / غرف النوم / دورات المياه → area_m2 / bedrooms / bathrooms
  السعر                    → price_total | price_annual
  الحالة  مباع|مؤجر         → SKIP (sold/rented — only list available)
  واجهة / عمر / عرض الشارع / خدمات الحي → additional_info

Usage:  python -m scrapers.hajer.run [--limit-test] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import html as ihtml
import os
import re
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

BASE = "https://hajerhouses.com"
LIST_API = f"{BASE}/wp-json/wp/v2/properties"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.4"))

TYPE_MAP_AR = {
    "شقة": "Apartment", "شقة دبلكسية": "Apartment", "شقه دبلكسية": "Apartment", "استوديو": "Apartment",
    "دبلكس": "Villa", "فيلا": "Villa", "قصر": "Villa", "بيت": "House", "دور": "Floor",
    "عمارة": "Building", "روف": "Floor", "أرض": "Residential Land", "ارض": "Residential Land",
    "أرض سكنية": "Residential Land", "مزرعة": "Farm", "استراحة": "Rest House", "إستراحة": "Rest House",
    "شاليه": "Chalet", "غرفة": "Room",
    # commercial
    "محل": "Shop", "معرض": "Showroom", "مكتب": "Office", "مستودع": "Warehouse",
    "أرض تجارية": "Commercial Land", "ارض تجارية": "Commercial Land", "عمارة تجارية": "Commercial Building",
}
COMMERCIAL_TYPES = {"Shop", "Showroom", "Office", "Warehouse", "Commercial Land", "Commercial Building"}
# الحالة values that mean the listing is no longer available.
GONE_STATUS = ("مباع", "مؤجر", "تم البيع", "تم التأجير", "محجوز", "sold", "rented")

CITY_TO_REGION = {  # this office is Al Ahsa-centric, but keep the full map for safety
    "Hofuf": "Eastern Province", "Al Ahsa": "Eastern Province", "Dammam": "Eastern Province",
    "Khobar": "Eastern Province", "Mubarraz": "Eastern Province", "Jubail": "Eastern Province",
    "Qatif": "Eastern Province", "Riyadh": "Riyadh", "Jeddah": "Makkah", "Mecca": "Makkah",
    "Medina": "Madinah", "Buraidah": "Qassim", "Abha": "Asir", "Jazan": "Jazan", "Hail": "Hail",
    "Tabuk": "Tabuk", "Najran": "Najran", "Al Baha": "Al Bahah",
}
CITY_MAP_AR = {
    "الأحساء": "Hofuf", "الاحساء": "Hofuf", "الهفوف": "Hofuf", "المبرز": "Hofuf",
    "الدمام": "Dammam", "الخبر": "Khobar", "القطيف": "Qatif", "الجبيل": "Jubail",
    "الرياض": "Riyadh", "جدة": "Jeddah", "مكة": "Mecca", "المدينة": "Medina",
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
    return s


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _num(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    m = re.search(r"[\d,]+", s.replace("٬", ",").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")))
    if not m:
        return None
    try:
        return int(m.group(0).replace(",", ""))
    except ValueError:
        return None


def rem_fields(html_text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in re.finditer(
        r'rem-single-field-title">([^<]+)</strong>(.*?)(?=rem-single-field-title"|</(?:section|article)|$)',
        html_text, re.S,
    ):
        label = _clean(m.group(1))
        vals = re.findall(r'rem-single-field-value[^>]*>(.*?)</span>', m.group(2), re.S)
        out[label] = _clean(vals[-1]) if vals else ""
    return out


def fetch_list(s: cc.Session) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        _throttle()
        r = s.get(f"{LIST_API}?per_page=100&page={page}&_embed=wp:featuredmedia",
                  timeout=30, headers={"Accept": "application/json"})
        if r.status_code != 200:
            break
        arr = r.json() or []
        out += arr
        if len(arr) < 100:
            break
        page += 1
    return out


def _image(p: dict, html_text: str) -> list[str]:
    # Only the featured image is a real property photo. Most listings have none (the brokerage
    # falls back to a "Screen-Shot…" placeholder logo) — skip that rather than show a fake photo.
    emb = (((p.get("_embedded") or {}).get("wp:featuredmedia") or [{}])[0]).get("source_url")
    if isinstance(emb, str) and emb.startswith("http") and "Screen-Shot" not in emb:
        return [emb]
    return []


def map_listing(p: dict, html_text: str) -> tuple[Optional[dict], str, bool]:
    """Return (row, category, gone). gone=True → sold/rented, mark inactive."""
    f = rem_fields(html_text)
    status = f.get("الحالة", "")
    gone = any(g in status for g in GONE_STATUS)

    ad = _num(f.get("رقم الإعلان")) or p.get("id")
    type_ar = f.get("نوع العقار", "").strip()
    property_type = TYPE_MAP_AR.get(type_ar) or TYPE_MAP_AR.get(type_ar.replace("ة", "ه"))
    classif = f.get("التصنيف", "")
    is_rent = "إيجار" in f.get("غرض العقار", "") or "ايجار" in f.get("غرض العقار", "")
    if not property_type:
        property_type = "Commercial Land" if "تجار" in classif else "Residential Land"
    category = "commercial" if (property_type in COMMERCIAL_TYPES or "تجار" in classif) else "residential"

    raw_city = f.get("المدينة", "").strip()
    city = CITY_MAP_AR.get(raw_city) or normalize.map_city(raw_city) or "Hofuf"
    region = CITY_TO_REGION.get(city)

    # Native Arabic R/C/D (ADDITIVE — live city/region/neighborhood above untouched). hajer's REM table
    # carries Arabic المدينة + أسم الحي. Per the standing rule المبرز/الأحساء/الهفوف stay catalog-SEPARATE
    # (resolved as-published, not folded); this Al-Ahsa-only brokerage defaults a missing city to «الأحساء».
    # region hint = the scraper's region (twin disambiguation). source_capture = the full REM field table +
    # WP basics (the source spec table carries NO broker PII). Numbers unchanged.
    city_ar = raw_city or "الأحساء"
    district_ar = (f.get("أسم الحي") or "").strip() or None
    cid, rid = to_catalog(city_ar, region_hint=region)
    cap = {"rem_fields": f, "wp_id": p.get("id"), "link": p.get("link"),
           "title": _clean((p.get("title") or {}).get("rendered", ""))}

    price = _num(f.get("السعر"))

    extra = []
    for label, key in (("واجهة العقار", "Facade"), ("عمر العقار", "Age"),
                       ("عرض الشارع", "Street width"), ("خدمات الحي", "Property services")):
        v = f.get(label)
        if v:
            extra.append({"key": label, "label": key, "value": v})

    row = {
        "ad_number": f"HJ{ad}",
        "listing_url": p.get("link"),
        "source": "Hajer",
        "active": not gone,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _num(f.get("المساحة")),
        "bedrooms": _num(f.get("عدد غرف النوم")),
        "bathrooms": _num(f.get("عدد دورات المياه")),
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": f.get("أسم الحي") or None,
        "title": _clean((p.get("title") or {}).get("rendered", "")),
        "photo_urls": _image(p, html_text),
        "rega_location_verified": False,
        "additional_info": extra,
        # ── Arabic-native (additive, shadow) + complete-source capture ──────────
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": cid,
        "region_id": rid,
        "source_capture": cap,
    }
    return row, category, gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit-test", action="store_true")
    args = ap.parse_args()

    s = session()
    listings = fetch_list(s)
    print(f"Hajer Houses: {len(listings)} listings from REST")
    run_id = None if args.limit_test else db.begin_run("hajer")
    res: list[dict] = []
    com: list[dict] = []
    gone_ct = 0
    seen = 0
    try:
        for p in listings:
            link = p.get("link")
            if not link:
                continue
            _throttle()
            try:
                ht = s.get(link, timeout=30).text
            except Exception:
                continue
            row, cat, gone = map_listing(p, ht)
            if not row:
                continue
            if gone:
                gone_ct += 1
                continue  # don't list sold/rented
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1
            if args.limit_test and seen >= 6:
                break

        if args.limit_test:
            print(f"DRY RUN — {len(res)} residential + {len(com)} commercial (skipped {gone_ct} sold/rented)")
            for r in (res + com)[:6]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "region", "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:70])
            return 0

        if res:
            db.upsert_hajer_residential_batch(res)
        if com:
            db.upsert_hajer_commercial_batch(com)
        pruned = 0
        for tbl, rows_seen in (("hajer_residential_listings", res), ("hajer_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Hajer")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Hajer: {len(res)} residential + {len(com)} commercial upserted, {gone_ct} sold/rented skipped, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"gone={gone_ct} pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
