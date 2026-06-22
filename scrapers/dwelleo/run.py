"""Dwelleo (dwelleo.sa / دويلو) scraper — Saudi Next.js marketplace, clean public JSON API.

دويلو is a Saudi property marketplace (Riyadh HQ, Al Olaya) — a mix of off-plan/developer units and
resale/individual listings. Saudi-owned, REGA ad-license per listing (ad_license_number), .sa domain,
Arabic-first → passes the Saudi-only rule. No auth, no proxy, cloud-friendly.

Data path: the Next.js App Router site (no __NEXT_DATA__) is backed by a clean public REST API on the
sibling host `api.dwelleo.sa`. We DON'T parse the SSR RSC flight payload — the API is far cleaner:

  GET https://api.dwelleo.sa/api/v1/properties?page=N   (Accept: application/json, Accept-Language: ar)
      → {message, data:{properties:[…full records…], pagination:{total,total_pages,current_page,…}}}
  (the list record IS the full listing — every field we need is present; no per-detail fetch needed.)

Field map (Dwelleo record → our schema):
  id                                   → ad_number (DW{id}) ; slug → listing_url /ar/properties/{slug}
  listing_type.key  for-sale|re-sale|for-rent → transaction_type Buy|Rent
  price                                → price_total (Buy) | price_annual (Rent, figures are annual)
  property_type.translations.en.name + .ar.name + land_type → property_type (TYPE_MAP) + res/com routing
  region.translations.en.name / city.title (AR) → region (normalized) + city (map_city); region
                                         derived from city when the API omits it.
  area.title (AR district)             → neighborhood
  area_sqm / bedrooms / bathrooms      → area_m2 / bedrooms / bathrooms
  images[].path                        → photo_urls (S3 CDN)
  ad_license_number                    → rega_location_verified + additional_info
  building_year / direction / floor_number / furnishing / driver_room / maid_room / amenities + tags
                                       → typed columns + additional_info
  status publish + availability        → active (skip sold/rented/unavailable)
  NEVER store owner.{name,phone,email} (PDPL — personal data) — and REDACT phones/contact CTAs from
  the free-text title/description (some advertisers paste جوال / واتساب / 05x into the body).

Usage:  python -m scrapers.dwelleo.run [--type residential|commercial|all] [--limit N]
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

from scrapers.common import db, normalize as N

BASE = "https://www.dwelleo.sa"
API = "https://api.dwelleo.sa/api/v1/properties"
PAGE_SIZE = 20  # server default; pagination.total_pages drives the loop
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.25"))

# Dwelleo property_type English label (translations.en.name) → our canonical taxonomy.
# (The API's en label is mixed-case/loose: "land","shop","office","building","Roof",…)
TYPE_MAP_EN = {
    "apartment": "Apartment", "villa": "Villa", "floor": "Floor", "roof": "Floor",
    "townhouse": "Villa", "penthouse": "Apartment", "studio": "Apartment", "duplex": "Villa",
    "building": "Building", "farm": "Farm", "land": "Residential Land", "other": "Residential Land",
    # commercial
    "office": "Office", "shop": "Shop", "showroom": "Showroom", "warehouse": "Warehouse",
    "workshop": "Workshop", "factory": "Factory", "hotel": "Hotel",
}
# Arabic fallback (property_type.translations.ar.name) when the en label is missing/unknown.
TYPE_MAP_AR = {
    "شقة": "Apartment", "فيلا": "Villa", "دور": "Floor", "سطح": "Floor", "روف": "Floor",
    "تاون هاوس": "Villa", "بنتهاوس": "Apartment", "استوديو": "Apartment", "دوبلكس": "Villa",
    "مبني": "Building", "عمارة": "Building", "مزرعة": "Farm", "ارض": "Residential Land",
    "أرض": "Residential Land", "غير محدد": "Residential Land",
    "محل": "Shop", "مكتب": "Office", "معرض": "Showroom", "مستودع": "Warehouse", "ورشة": "Workshop",
}
COMMERCIAL_TYPES = {"Office", "Shop", "Showroom", "Warehouse", "Commercial Land",
                    "Commercial Building", "Workshop", "Factory", "Hotel", "Gas Station"}

# Dwelleo's region.translations.en.name labels → DB-canonical region strings (must match the
# region values the rest of the catalog uses). When the API omits the region we derive it from city.
REGION_EN = {
    "Riyadh": "Riyadh", "Makkah": "Makkah", "Madinah Al Munawwarah": "Madinah",
    "Eastern Province (Ash Sharqyah)": "Eastern Province", "Asir": "Asir", "Jazan": "Jazan",
    "Al Jawf": "Al Jawf", "Najran": "Najran", "Al Bahah": "Al Bahah", "Qassim": "Qassim",
    "Tabuk": "Tabuk", "Hail": "Hail", "Northern Borders": "Northern Borders",
}

# ── PDPL redaction (ported from scrapers/semsar/run.py) — title/description only; owner.* never read.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"          # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966[\-\s]?\d{8,9}\b"      # 966-551303641 / 966 5xxxxxxxx (Dwelleo owner.phone form)
    r"|0?5\d(?:[\s\.\-]?\d){7}"     # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"             # 9200xxxx short-codes
    r"|\b920\d{6}\b"             # 920xxxxxx unified
    r"|\b800\d{7}\b"             # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
_CONTACT_KW = re.compile(
    r"(?:للتواصل|للاستفسار|للحجز|للاتصال)?\s*"
    r"(?:واتس\s*اب|واتساب|الواتس|whats\s*app|whatsapp|تواصل\s*معنا)\s*[:：]?\s*\d*",
    re.I,
)
# letter-for-digit obfuscation (o5o… = 050…) so the phone patterns below catch it.
_OBFUSC_RUN_RE = re.compile(r"[oO0-9٠-٩][oO0-9٠-٩\s.\-]{6,}[oO0-9٠-٩]")
# a contact call-to-action + the ~40 chars after it (phone, WhatsApp, or a seller ALIAS like "ام صقر").
_CONTACT_LINE_RE = re.compile(
    r"(?:للتواصل|للحجز|للاستفسار|للاتصال|اتصل(?:\s*(?:بنا|على))?|"
    r"رقم\s*(?:الجوال|الجوّال|التواصل|الهاتف|الواتس)|جوال|موبايل|"
    r"واتس\S*|whats\s*app|whatsapp)[^\n]{0,40}", re.I)
_TAGS_RE = re.compile(r"<[^>]+>")


def _deobfuscate(t: str) -> str:
    def fix(m: "re.Match[str]") -> str:
        d = m.group(0).replace("o", "0").replace("O", "0")
        return d if len(re.sub(r"\D", "", d)) >= 8 else m.group(0)
    return _OBFUSC_RUN_RE.sub(fix, t)


def _clean_html(t: str) -> str:
    """Descriptions arrive as HTML (<p>/<strong>/<ul>…) — flatten to text, keep paragraph breaks."""
    t = ihtml.unescape(t or "")
    t = re.sub(r"</p>|<br\s*/?>|</li>", "\n", t, flags=re.I)
    t = _TAGS_RE.sub(" ", t)
    return re.sub(r"[ \t]{2,}", " ", t).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = _clean_html(text)
    t = _deobfuscate(t)              # o5o… → 050… so the phone patterns below catch it
    t = _CONTACT_LINE_RE.sub(" ", t)  # drops the CTA + phone/whatsapp/seller-alias that follows
    t = _PHONE_LOOSE.sub(" ", t)
    t = _PHONE_RE.sub(" ", t)
    t = _CONTACT_KW.sub(" ", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t or None


_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar"})
    return s


def _int(v: Any) -> Optional[int]:
    n = N.to_int(v)
    return n if n else None


def fetch_page(s: cc.Session, page: int) -> tuple[list[dict], dict]:
    _throttle()
    for attempt in range(4):
        try:
            r = s.get(API, params={"page": page}, timeout=40)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        try:
            d = (r.json() or {}).get("data") or {}
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        return (d.get("properties") or []), (d.get("pagination") or {})
    return [], {}


def _en(obj: Any) -> Optional[str]:
    """English `translations.en.name` from a Dwelleo lookup object, else its raw name/title."""
    if not isinstance(obj, dict):
        return None
    en = (((obj.get("translations") or {}).get("en") or {}).get("name"))
    return (en or obj.get("name") or obj.get("title") or None)


def _ar(obj: Any) -> Optional[str]:
    if not isinstance(obj, dict):
        return None
    ar = (((obj.get("translations") or {}).get("ar") or {}).get("name"))
    return (ar or obj.get("title") or obj.get("name") or None)


def _map_type(p: dict) -> str:
    pt = p.get("property_type") or {}
    en = (_en(pt) or "").strip().lower()
    t = TYPE_MAP_EN.get(en)
    if not t:
        t = TYPE_MAP_AR.get((_ar(pt) or "").strip())
    if not t:
        t = N.map_type((_ar(pt) or "").strip()) or "Residential Land"
    # Land → split residential / commercial via land_type so commercial land is shelved right.
    if t == "Residential Land":
        lt = (p.get("land_type") or "")
        if isinstance(lt, str) and lt.lower() in ("commercial", "industrial"):
            t = "Commercial Land"
    return t


# Amenity/tag boolean-ish columns we can map straight to typed listing columns.
AMENITY_COL = {
    "مصعد": "elevator", "elevator": "elevator",
    "مسبح": "swimming_pool", "swimming pool": "swimming_pool", "pool": "swimming_pool",
    "حديقة": "garden", "garden": "garden",
    "شرفة": "balcony_terrace", "balcony": "balcony_terrace",
}


def _additional_info(p: dict) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    lic = p.get("ad_license_number")
    if lic and not str(lic).startswith("•"):
        rows.append({"key": "adlic", "label": "Ad license number", "value": str(lic)})
    if p.get("furnishing_status") and p["furnishing_status"] not in ("unfurnished", "none"):
        rows.append({"key": "furnishing", "label": "Furnishing", "value": str(p["furnishing_status"])})
    if p.get("land_type"):
        rows.append({"key": "land_type", "label": "Land type", "value": str(p["land_type"])})
    # tags (Balcony / Elevator / …) — store the Arabic labels, de-duped.
    tag_labels = []
    for t in (p.get("tags") or []):
        lbl = _ar(t)
        if lbl and lbl not in tag_labels:
            tag_labels.append(lbl)
    for a in (p.get("amenities") or []):
        lbl = _ar(a) or a.get("title") if isinstance(a, dict) else None
        if lbl and lbl not in tag_labels:
            tag_labels.append(lbl)
    if tag_labels:
        rows.append({"key": "features", "label": "Features", "value": "، ".join(tag_labels)})
    return rows


def _photos(p: dict) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    imgs = p.get("images") or []
    if not imgs and isinstance(p.get("image"), dict):
        imgs = [p["image"]]
    for im in imgs:
        if not isinstance(im, dict):
            continue
        u = im.get("path") or im.get("path_thumbnail")
        if isinstance(u, str) and u.startswith("http") and u not in seen:
            seen.add(u)
            out.append(u)
        if len(out) >= 12:
            break
    return out


# availability values that mean the unit is no longer on the market.
_DEAD_AVAIL = {"sold", "rented", "unavailable", "reserved", "off_market"}


def map_listing(p: dict) -> tuple[Optional[dict], str]:
    pid = p.get("id")
    slug = p.get("slug")
    if not pid or not slug:
        return None, "residential"

    # Skip sold/rented/unpublished — only live, published listings.
    status = (p.get("status") or "").lower()
    avail = (p.get("availability") or p.get("availability_status") or "").lower()
    if status and status not in ("publish", "published", "active"):
        return None, "residential"
    if avail in _DEAD_AVAIL:
        return None, "residential"

    property_type = _map_type(p)
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    lk = ((p.get("listing_type") or {}).get("key") or "").lower()
    is_rent = "rent" in lk  # for-rent → Rent ; for-sale / re-sale → Buy
    price = _int(p.get("price"))

    raw_city = (p.get("city") or {}).get("title") or _ar(p.get("city"))
    city = N.map_city(raw_city) or "Other"
    region = REGION_EN.get(_en(p.get("region")) or "")
    if region is None:
        region = N.region_for_city(city)

    title = _redact((p.get("translations") or {}).get("ar", {}).get("title") or p.get("title"))
    desc = _redact((p.get("translations") or {}).get("ar", {}).get("description") or p.get("description"))

    row = {
        "ad_number": f"DW{pid}",
        "listing_url": f"{BASE}/ar/properties/{slug}",
        "source": "Dwelleo",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(p.get("area_sqm")) or _int(p.get("area") if not isinstance(p.get("area"), dict) else None),
        "bedrooms": _int(p.get("bedrooms")),
        "bathrooms": _int(p.get("bathrooms")),
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": (p.get("area") or {}).get("title") if isinstance(p.get("area"), dict) else None,
        "title": title,
        "description": desc,
        "photo_urls": _photos(p),
        "direction": (p.get("direction") or None),
        "driver_room": bool(p.get("driver_room")) or None,
        "maid_room": bool(p.get("maid_room")) or None,
        "rega_location_verified": bool(p.get("ad_license_number")),
        "additional_info": _additional_info(p),
    }
    # Building age (years) from build year, like the alhoshan template.
    yb = _int(p.get("building_year"))
    if yb and yb > 1900:
        from datetime import datetime
        row["property_age"] = max(0, datetime.now().year - yb)
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="VALIDATION run: upsert only the first N parsed listings, no prune")
    args = ap.parse_args()

    s = session()
    first, pg = fetch_page(s, 1)
    total = pg.get("total")
    pages = pg.get("total_pages") or 1
    print(f"Dwelleo: {total} listings across {pages} pages (API)")

    run_id = None if args.limit else db.begin_run("dwelleo")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        page = 1
        items, meta = first, pg
        while True:
            for p in items:
                row, cat = map_listing(p)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if args.limit and seen >= args.limit:
                    break
            if args.limit and seen >= args.limit:
                break
            page += 1
            if page > pages:
                break
            items, meta = fetch_page(s, page)
            if not items:
                break
            if page % 10 == 0:
                print(f"  …page {page}/{pages}  ({seen} parsed)", flush=True)

        if args.limit:
            if res:
                db.upsert_dwelleo_residential_batch(res)
            if com:
                db.upsert_dwelleo_commercial_batch(com)
            print(f"VALIDATION — upserted {len(res)} residential + {len(com)} commercial (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type",
                                               "city", "region", "neighborhood", "area_m2",
                                               "bedrooms", "price_total", "price_annual")})
                print("     url  :", r["listing_url"])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:72])
            return 0  # no scrape_runs row / no prune for a --limit validation run

        if res:
            db.upsert_dwelleo_residential_batch(res)
        if com:
            db.upsert_dwelleo_commercial_batch(com)
        # FULL-REFRESH prune: we paged the COMPLETE catalog → anything active not seen is gone.
        pruned = 0
        for tbl, rows_seen in (("dwelleo_residential_listings", res),
                               ("dwelleo_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Dwelleo")
            if n < 0:
                print(f"prune guard tripped for {tbl} — kept active")
            else:
                pruned += n
        print(f"✓ Dwelleo: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
