"""Ramz Al-Qassim (ramzalqasim.com / رمز القصيم العقاري) scraper.

A small Qassim-region brokerage (single broker, ~180 listings, mostly Unaizah + nearby towns).
Built on Laravel Livewire — there's no public REST or sitemap, but every page render emits a
`updateMapMarkers` JS call whose `params` is a JSON array of every listing on that page (50/page).
That payload carries the full record — id, type, status (sell/rent/investment), area, price, city,
district, lat/lng, REGA license_number, real_estate_age, content flags, full media list — so we
don't need to hit `/x/{id}` at all (saves N requests on a small site).

Pagination: `/maps?page=N` for N in 1..(empty). Pages 5+ return zero markers → stop.

Field map (marker JSON → our schema):
  id                          → ad_number (RQ{id})
  type  land|villa|appartment|… → property_type (TYPE_MAP_EN)
  status  sell|rent|investment → transaction_type Buy|Rent (investment treated as Buy)
  area / bedrooms / bathroom   → area_m2 / bedrooms / bathrooms
  master_room                  → master_bedrooms
  price                        → price_total | price_annual (rent assumed annual; SAR)
  city (Arabic) / district     → city / neighborhood
  latitude / longitude         → additional_info.lat / .lng
  license_number               → additional_info.rega_ad_license_number (when present)
  real_estate_age              → property_age (numeric years; "جديد" = new → 0)
  width_street / interface     → street_width_m / direction
  media[].original_url         → photo_urls (full-size PNG/JPG; thumbs ignored)
  description (HTML)           → description (tags stripped, phones redacted)

PDPL: owner_name + owner_phone live in the marker JSON. We NEVER store them.
The description sometimes embeds 05x/+9665 numbers — those are redacted before storing.

Usage:  python -m scrapers.ramzalqasim.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
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

BASE = "https://ramzalqasim.com"
MAPS = f"{BASE}/maps"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.5"))  # gentle — single-broker site

# Ramzalqasim `type` enum → canonical English property_type.
# Discovered values: land, villa, appartment, role (= دور / floor), breather (= استراحة),
# duplex, building, farm, chalet. Spellings preserved as-shipped by the site.
TYPE_MAP_EN: dict[str, str] = {
    "land": "Residential Land",
    "villa": "Villa",
    "appartment": "Apartment",
    "apartment": "Apartment",
    "duplex": "Duplex",
    "role": "Floor",          # دور
    "building": "Building",
    "breather": "Rest House",  # استراحة
    "rest_house": "Rest House",
    "farm": "Farm",
    "chalet": "Chalet",
    "house": "House",
    "office": "Office",
    "shop": "Shop",
    "warehouse": "Warehouse",
    "showroom": "Showroom",
}
COMMERCIAL_TYPES = {"Office", "Shop", "Warehouse", "Showroom", "Commercial Land", "Commercial Building"}

# Qassim cities (Arabic in markers → canonical English).
CITY_MAP_AR: dict[str, str] = {
    "عنيزة": "Unaizah", "عنيزه": "Unaizah", "عنبزة": "Unaizah",  # typos in source
    "بريدة": "Buraidah",
    "الرس": "Ar Rass",
    "البدائع": "Al Badaie",
    "البطين": "Al Bateen",
    "الدليمية": "Al Dulaimiyah",
    "البصر": "Al Basr",
    "رياض الخبراء": "Riyadh Al Khabra",
    "المذنب": "Al Mithnab",
    "البكيرية": "Al Bukayriyah",
}
# Everything from this site is Qassim region.
REGION_EN = "Qassim"
REGION_AR = "القصيم"

# Cardinal direction in Arabic JSON (English keywords).
DIRECTION_EN = {
    "north": "Northern", "south": "Southern", "east": "Eastern", "west": "Western",
    "northeast": "North Eastern", "northwest": "North Western",
    "southeast": "South Eastern", "southwest": "South Western",
}

# Content flag letters → human label (best-effort; the site stores e.g. ["A","C","D","M","K","L"]).
# We store the raw flags so the meaning survives a re-key on Ramzalqasim's side.

# Phone / contact patterns to REDACT from description+title before storing (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"             # +9665XXXXXXXX
    r"|00966\d{9}"                 # 00966XXXXXXXXX
    r"|0?5\d{8}"                   # 05XXXXXXXX
    r"|9200\d{4,8}"                # 9200xxxx Saudi business lines
    r"|wa\.me/\S+"                  # wa.me links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

# Listing "gone" markers — sold/under_construction we mark inactive.
GONE_AVAL = {"sold"}

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
    })
    return s


def _strip_tags(s: Optional[str]) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    out = _PHONE_LOOSE.sub("", text)
    out = _PHONE_RE.sub("", out)
    return re.sub(r"\s+", " ", out).strip() or None


def _num(s: Any) -> Optional[float]:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    txt = str(s).replace("٬", ",").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    m = re.search(r"-?\d[\d,]*\.?\d*", txt)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _int(s: Any) -> Optional[int]:
    v = _num(s)
    return int(v) if v is not None else None


def fetch_markers(s: cc.Session, max_pages: int = 12) -> list[dict]:
    """Walk /maps?page=1..N, decode each page's updateMapMarkers JSON. Stop at first empty page."""
    out: list[dict] = []
    seen: set[int] = set()
    for page in range(1, max_pages + 1):
        _throttle()
        try:
            r = s.get(f"{MAPS}?page={page}", timeout=30)
        except Exception as e:
            print(f"  page {page} fetch error: {e}")
            break
        if r.status_code != 200:
            print(f"  page {page} HTTP {r.status_code}")
            break
        decoded = ihtml.unescape(r.text)
        m = re.search(r'updateMapMarkers","params":\[\[(.*?)\]\]', decoded, re.S)
        if not m:
            print(f"  page {page}: no markers payload → stop")
            break
        try:
            arr = json.loads("[" + m.group(1) + "]")
        except Exception as e:
            print(f"  page {page}: parse err {e}")
            break
        if not arr:
            print(f"  page {page}: empty → stop")
            break
        new = [a for a in arr if a.get("id") not in seen]
        for a in new:
            seen.add(a["id"])
        print(f"  page {page}: +{len(new)} (total {len(seen)})")
        out += new
        if len(arr) < 30:  # last page (smaller than full)
            break
    return out


def map_marker(rec: dict) -> tuple[Optional[dict], str, bool]:
    """Return (row, category, gone). Skips records lacking a workable price/type."""
    rid = rec.get("id")
    if not isinstance(rid, int):
        return None, "residential", False

    type_raw = (rec.get("type") or "").strip().lower()
    property_type = TYPE_MAP_EN.get(type_raw) or "Residential Land"  # default to land for unknown
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    status_raw = (rec.get("status") or "").lower()
    is_rent = status_raw == "rent"
    transaction_type = "Rent" if is_rent else "Buy"

    aval = (rec.get("avalible") or "").lower()
    gone = aval in GONE_AVAL  # mark inactive but still record

    area_f = _num(rec.get("area"))
    if area_f is not None and area_f < 1:
        area_f = None
    area = int(round(area_f)) if area_f is not None else None

    bedrooms = _int(rec.get("bedrooms"))
    if category == "commercial" or property_type in ("Residential Land",):
        bedrooms = None
    if bedrooms is not None and bedrooms > 20:
        bedrooms = None

    bathrooms = _int(rec.get("bathroom"))
    if bathrooms is not None and bathrooms > 20:
        bathrooms = None

    master = _int(rec.get("master_room"))
    if master is not None and master > 20:
        master = None

    price_f = _num(rec.get("price"))
    if price_f is not None and price_f < 1000:
        price_f = None
    price = int(round(price_f)) if price_f is not None else None

    age_raw = (rec.get("real_estate_age") or "").strip()
    if age_raw == "جديد":
        property_age = 0
    else:
        property_age = _int(age_raw)
        if property_age is not None and (property_age < 0 or property_age > 200):
            property_age = None

    direction_raw = (rec.get("interface") or "").strip().lower()
    direction = DIRECTION_EN.get(direction_raw)

    street_width_f = _num(rec.get("width_street"))
    street_width = int(round(street_width_f)) if street_width_f is not None else None

    raw_city = (rec.get("city") or "").strip()
    # Normalize trailing-space variants
    raw_city_key = raw_city.strip()
    city = CITY_MAP_AR.get(raw_city_key)
    if not city:
        city = normalize.map_city(raw_city_key) if raw_city_key else None
    # Forward-fix (2026-07-10 location-data-quality audit, item-7 follow-up): removed the
    # `DEFAULT_CITY = "Unaizah"` fallback — it silently invented a specific city both when the
    # source had NO city at all (68/184 rows, 37%, confirmed live) AND when the source gave a real
    # city name this file's own maps simply didn't recognize, discarding that raw signal at the
    # `city` column even though it's separately preserved in additional_info.city_ar below. An
    # honest None is correct in both cases.

    district = (rec.get("district") or "").strip() or None

    # photo_urls — prefer original_url (full-size). Filter logos / placeholders.
    photos: list[str] = []
    seen_urls: set[str] = set()
    for med in (rec.get("media") or []):
        url = med.get("original_url") or ""
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        if "no-image" in url.lower() or "placeholder" in url.lower() or "logo" in url.lower():
            continue
        if url in seen_urls:
            continue
        seen_urls.add(url)
        photos.append(url)

    # description — strip HTML, redact phones.
    description = _redact(_strip_tags(rec.get("description")))

    # Title: site doesn't expose one; synthesize a neutral Arabic title.
    title_bits = []
    type_ar_map = {
        "Residential Land": "أرض",
        "Villa": "فيلا",
        "Apartment": "شقة",
        "Duplex": "دبلكس",
        "Floor": "دور",
        "Building": "عمارة",
        "Rest House": "استراحة",
        "Farm": "مزرعة",
        "Chalet": "شاليه",
        "House": "بيت",
    }
    title_bits.append(type_ar_map.get(property_type, "عقار"))
    title_bits.append("للإيجار" if is_rent else "للبيع")
    if district:
        title_bits.append(f"- {district}")
    if raw_city_key:
        title_bits.append(f", {raw_city_key}")
    title = " ".join(title_bits)

    # additional_info — every remaining useful field.
    ai: dict[str, Any] = {
        "region_ar": REGION_AR,
        "city_ar": raw_city_key or None,
        "district_ar": district,
        "property_type_raw": type_raw,
        "status_raw": status_raw,
        "availability_raw": aval or None,
        "content_flags": rec.get("content"),
    }
    lat = _num(rec.get("latitude"))
    lng = _num(rec.get("longitude"))
    if lat is not None and lng is not None:
        ai["lat"] = lat
        ai["lng"] = lng
    license_num = rec.get("license_number")
    if isinstance(license_num, str) and license_num.strip():
        ai["rega_ad_license_number"] = license_num.strip()
    if rec.get("youtube"):
        ai["youtube_url"] = rec.get("youtube")
    if rec.get("created_at"):
        ai["created_at"] = rec.get("created_at")
    if rec.get("updated_at"):
        ai["updated_at"] = rec.get("updated_at")
    ai = {k: v for k, v in ai.items() if v not in (None, "", [])}

    # price_per_meter for buys with area+total.
    price_total = price if not is_rent else None
    price_annual = price if is_rent else None
    price_per_meter = None
    if price_total and area_f and area_f > 0:
        price_per_meter = int(round(price_f / area_f))

    row: dict[str, Any] = {
        "ad_number": f"RQ{rid}",
        "listing_url": f"{BASE}/x/{rid}",
        "source": "Ramzalqasim",
        "active": not gone,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "master_bedrooms": master,
        "property_age": property_age,
        "direction": direction,
        "street_width_m": street_width,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": REGION_EN,
        "neighborhood": district,
        "rega_location_verified": False,
        "photo_urls": photos or None,
        "title": title,
        "description": description,
        "additional_info": ai,
    }
    return row, category, gone


def _pin_sold_inactive(table: str, ad_numbers: list[str]) -> None:
    """Make source-confirmed SOLD rows survive the nightly auto_recover_false_inactive() sweep.

    That pg_cron job (05:20 UTC) re-activates any active=false row with
    coalesce(missing_count, 0) = 0 and a fresh last_seen_at — and the shared batch upsert
    (db._wasalt_batch) unconditionally writes missing_count=0 for every row it touches, which is
    exactly what let sold listings resurrect every morning. So AFTER the batch upsert we pin the
    sold rows to missing_count=3 (the existing prune 3-strike threshold) + active=false.
    prune_unseen() never undoes this: it only selects active=true rows and only updates ids NOT
    in its seen set. When a sold listing is later relisted, its next upsert carries active=true
    and the upsert's own missing_count=0 reset applies — the pin is only written for ids that are
    sold THIS crawl."""
    for i in range(0, len(ad_numbers), 200):
        db._execute(
            db.sb().table(table).update({"active": False, "missing_count": 3})
            .in_("ad_number", ad_numbers[i:i + 200]),
            what=table + ".sold_pin",
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation-only: cap rows scraped + upserted, skip stale-prune")
    args = ap.parse_args()

    s = session()
    print(f"Ramz Al-Qassim: walking /maps pagination …")
    markers = fetch_markers(s)
    print(f"  collected {len(markers)} unique markers")
    if not markers:
        print("✗ no markers — site may have changed")
        return 1

    is_validation = args.limit and args.limit > 0
    run_id = None if is_validation else db.begin_run("ramzalqasim")
    res: list[dict] = []
    com: list[dict] = []
    sold_res: list[str] = []
    sold_com: list[str] = []
    gone_ct = 0
    seen = 0

    try:
        for rec in markers:
            row, cat, gone = map_marker(rec)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1
            if gone:
                gone_ct += 1
                (sold_com if cat == "commercial" else sold_res).append(row["ad_number"])
            if is_validation and seen >= args.limit:
                break

        print(f"  mapped: {len(res)} residential + {len(com)} commercial ({gone_ct} sold/inactive)")

        if res:
            db.upsert_ramzalqasim_residential_batch(res)
            print(f"  ✓ upserted {len(res)} residential rows")
        if com:
            db.upsert_ramzalqasim_commercial_batch(com)
            print(f"  ✓ upserted {len(com)} commercial rows")
        # Pin sold rows immediately after the upsert (which reset their missing_count to 0), so
        # the 05:20 auto-recover job can never flip them back to active. See _pin_sold_inactive.
        if sold_res:
            _pin_sold_inactive("ramzalqasim_residential_listings", sold_res)
        if sold_com:
            _pin_sold_inactive("ramzalqasim_commercial_listings", sold_com)

        pruned = 0
        if not is_validation:
            # Sold rows are active=false + missing_count=3 by now; prune_unseen never touches
            # them (it only reads active=true rows and only updates ids missing from the seen
            # set), so passing their ad_numbers in the seen set is harmless.
            for tbl, rows_seen in (("ramzalqasim_residential_listings", res),
                                    ("ramzalqasim_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Ramzalqasim")
                if n < 0:
                    print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
                else:
                    pruned += n
            print(f"  pruned {pruned} stale")

        print(f"✓ Ramzalqasim: {len(res)} residential + {len(com)} commercial upserted, "
              f"{gone_ct} marked inactive, {pruned} stale pruned")
        if run_id:
            db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen,
                        notes=f"gone={gone_ct} pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
