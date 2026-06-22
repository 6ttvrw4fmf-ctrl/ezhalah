"""Eaqar Tabuk (eaqartabuk.com / عقار تبوك — "Candles") scraper — WordPress + custom REST API.

عقار تبوك is a Tabuk-only Saudi brokerage running on WordPress (RealHomes theme) with TWO custom
public REST namespaces:

  • public/v1   — the listing list + per-property record (RealHomes meta).
  • candles-map — the map plugin's per-property record (the RICH one: usage, operation, district,
                  lat/lng, features, parcel/plan numbers).

Saudi-owned + Tabuk-local → passes the Saudi-only rule. No auth, no proxy, cloud-friendly (public
API on the same domain). ~511 listings.

APIs:
  GET /wp-json/public/v1/properties?per_page=50&page=K
        → {page, per_page, total, total_pages, items:[…]}
     item: id, title, slug, link, date, featured_image, excerpt, meta{price,bedrooms,bathrooms,
           area,address}.  ⛔ ALSO returns agent_name/agent_phone/owner_name/owner_phone/whatsapp
           — these are DROPPED (PDPL); never stored.
  GET /wp-json/candles-map/v1/property/{id}    (ENRICH — the authoritative record)
        → id, type(AR), status(AR بيع/إيجار/استثمار), usage(residential|commercial), operation
          (sale|rent|investment), location, city, district, lat, lng, area, bedrooms, bathrooms,
          features[], parcel_number, plan_id, plan_title.
  GET /wp-json/public/v1/property/{id}         (description HTML — content field)

Field map (Eaqar Tabuk → our schema):
  id                                  → ad_number (ET{id})
  link                                → listing_url
  candles-map.type (AR free-text)     → property_type (TYPE_MAP, substring) ; default by usage
  candles-map.usage                   → residential|commercial routing (default residential)
  candles-map.operation/status        → transaction_type Buy|Rent (rent/إيجار → Rent, else Buy)
  meta.price                          → price_total | price_annual  (see PRICE heuristic below)
  meta.area / bedrooms / bathrooms    → area_m2 / bedrooms / bathrooms
  candles-map.district / city         → neighborhood ; city is ALWAYS Tabuk (the `city` field
                                        often actually holds a district like "حي الورود")
  featured_image (strip -WxH)         → photo_urls (gallery is thin — usually 1)
  candles-map.{lat,lng,features,parcel_number,plan_id}, status_ar, operation_ar → additional_info

PRICE (verified against samples): meta.price is INCONSISTENT —
  • Buy: most are full SAR (e.g. 550000, 1350000) but some are in THOUSANDS (580 = 580,000).
    Heuristic: a positive value < 10,000 is thousands → ×1000; >= 10,000 is already full SAR.
  • Rent: small values (1400–3000) are true MONTHLY rent in full SAR → price_annual + rent_period
    'monthly' shown at the per-month figure (monthly-rent memo); large values are annual.
  • 0 / blank price → null (no fabricated price).

PDPL (ABSOLUTE): the list API returns agent/owner NAMEs + PHONEs + whatsapp. NONE are stored — not
in any column, not in additional_info, not in description. Phone/wa.me/9200 patterns are REDACTED
from title + description.

Usage:  python -m scrapers.eaqartabuk.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://eaqartabuk.com"
LIST = f"{BASE}/wp-json/public/v1/properties"
MAP = f"{BASE}/wp-json/candles-map/v1/property"
DETAIL = f"{BASE}/wp-json/public/v1/property"
PAGE_SIZE = 50
WORKERS = int(os.environ.get("EAQARTABUK_WORKERS", "5"))

# candles-map.type is free-text Arabic — clean singular types AND plural/category labels
# ("اراضي للبيع", "عماير للبيع", "عقارات سكنية"). Substring-matched in priority order so a more
# specific word wins over a generic one.
TYPE_PATTERNS: list[tuple[str, str]] = [
    ("فيلا", "Villa"), ("فلة", "Villa"), ("دوبلكس", "Villa"), ("قصر", "Villa"),
    ("استوديو", "Studio"),
    ("شقة", "Apartment"), ("شقه", "Apartment"), ("شقق", "Apartment"),
    ("ملحق", "Floor"), ("دور", "Floor"), ("روف", "Floor"),
    ("استراحة", "Rest House"), ("استراحه", "Rest House"),
    ("شاليه", "Chalet"),
    ("مزرعة", "Farm"), ("مزرعه", "Farm"), ("مزارع", "Farm"),
    ("عماير", "Building"), ("عمارة", "Building"), ("عماره", "Building"),
    ("مباني", "Building"), ("مبنى", "Building"), ("بناية", "Building"),
    ("بيت", "House"), ("منزل", "House"),
    # commercial
    ("معارض", "Showroom"), ("معرض", "Showroom"),
    ("محلات", "Shop"), ("محل", "Shop"),
    ("مكتب", "Office"),
    ("مستودع", "Warehouse"),
    ("ورشة", "Workshop"), ("ورشه", "Workshop"),
    ("مصنع", "Factory"),
    ("فندق", "Hotel"),
    ("محطة", "Gas Station"),
    ("برج", "Commercial Building"), ("مجمع", "Commercial Building"),
    # land last — "أرض"/"اراضي" is a common generic; specific buildings above win.
    ("اراضي", "Residential Land"), ("أرض", "Residential Land"), ("ارض", "Residential Land"),
    ("مشروع", "Residential Land"),
]
COMMERCIAL_TYPES = {
    "Showroom", "Shop", "Office", "Warehouse", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land",
}

# Phone / contact patterns to REDACT from title + description (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"             # +9665XXXXXXXX
    r"|00966\d{9}"                 # 00966XXXXXXXXX
    r"|0?5\d{8}"                   # 05XXXXXXXX / 5XXXXXXXX
    r"|9200\d{5,6}"               # 9200xxxxx unified numbers
    r"|wa\.me/\S+"                 # wa.me links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"  # "واتساب 05..."
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# featured_image size suffix, e.g. "-1024x717.jpg" / "-461x1024.jpeg" → full-res by stripping it.
_SIZE_RE = re.compile(r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)", re.I)
_BAD_IMG = ("placeholder", "no-image", "no_image", "noimage", "logo", "default-")

_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
        _local.s = s
    return s


def session() -> cc.Session:
    return cc.Session(impersonate="chrome124")


def _int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _float(v: Any) -> Optional[float]:
    if v in (None, "", "—", "0"):
        return None
    try:
        s = re.sub(r"[^\d.]", "", str(v).translate(normalize._TRANS))
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def _area_from_text(html: Optional[str]) -> Optional[float]:
    """Recover the area (m²) from the listing's free-text body. eaqartabuk leaves the structured
    meta.area / candles-map.area empty on ~86% of listings, but the description carries it as
    'مساحة 796' / 'المساحة 215 م' / 'مسطح ...'. Pull the first plausible figure (50–10,000,000 m²)."""
    if not html:
        return None
    txt = re.sub(r"<[^>]+>", " ", str(html)).translate(normalize._TRANS)
    for pat in (r"(?:المساحة|مساحة|مسطح)\s*(?:الأرض|الارض|البناء|الكلية)?\s*[:\-]?\s*([\d][\d.,]*)",
                r"([\d][\d.,]*)\s*(?:م2|م²|متر\s*مربع|متر)"):
        for m in re.finditer(pat, txt):
            try:
                val = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            if 50 <= val <= 10_000_000:
                return val
    return None


def _strip_tags(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    t = re.sub(r"</p>", " ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"&nbsp;|&#160;", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _full_img(u: Optional[str]) -> Optional[str]:
    if not isinstance(u, str) or not u.startswith("http"):
        return None
    if any(b in u.lower() for b in _BAD_IMG):
        return None
    return _SIZE_RE.sub("", u)


def _map_type(raw: str, usage: str) -> str:
    raw = (raw or "").strip()
    for word, eng in TYPE_PATTERNS:
        if word in raw:
            return eng
    # No type word matched — fall back by usage so it still shelves correctly.
    return "Commercial Land" if usage == "commercial" else "Residential Land"


def fetch_page(s: cc.Session, page: int) -> tuple[list[dict], dict]:
    for attempt in range(3):
        try:
            r = s.get(LIST, params={"per_page": PAGE_SIZE, "page": page}, timeout=40)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        j = r.json()
        return (j.get("items") or []), j
    return [], {}


def _enrich(pid: int) -> tuple[dict, Optional[str]]:
    """Return (candles-map record, description HTML). Both best-effort."""
    s = _session()
    mp: dict = {}
    desc: Optional[str] = None
    for attempt in range(3):
        try:
            r = s.get(f"{MAP}/{pid}", timeout=40)
            if r.status_code == 200:
                mp = r.json() or {}
                break
        except Exception:
            pass
        time.sleep(1.2 * (attempt + 1))
    try:
        r2 = s.get(f"{DETAIL}/{pid}", timeout=40)
        if r2.status_code == 200:
            j2 = r2.json() or {}
            desc = j2.get("content") or j2.get("description")
    except Exception:
        pass
    return mp, desc


def _price(raw: Any, is_rent: bool) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """→ (price_total, price_annual, rent_period). Applies the magnitude heuristic."""
    v = _int(raw)
    if not v or v <= 0:
        return None, None, None
    if not is_rent:
        # Buy: values < 10,000 are quoted in thousands (580 = 580,000); else already full SAR.
        total = v * 1000 if v < 10000 else v
        if total < 1000:
            return None, None, None
        return total, None, None
    # Rent: small values are MONTHLY rent in full SAR; large are annual.
    if v < 10000:
        return None, v, "monthly"
    return None, v, "annual"


def map_listing(item: dict, mp: dict, desc_html: Optional[str]) -> tuple[Optional[dict], str]:
    pid = item.get("id")
    if not pid:
        return None, "residential"
    meta = item.get("meta") or {}

    usage = (mp.get("usage") or "").strip().lower()
    category = "commercial" if usage == "commercial" else "residential"

    property_type = _map_type(mp.get("type") or item.get("title") or "", usage)
    # Trust the type's own category if the usage field was blank/ambiguous.
    if usage not in ("residential", "commercial"):
        category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    elif usage == "residential" and property_type in COMMERCIAL_TYPES:
        # usage says residential but type word is commercial → route by type (commercial).
        category = "commercial"

    op = (mp.get("operation") or "").strip().lower()
    status_ar = (mp.get("status") or "").strip()
    is_rent = op == "rent" or "إيجار" in status_ar or "ايجار" in status_ar

    price_total, price_annual, rent_period = _price(meta.get("price"), is_rent)

    # Area fallback chain: structured meta.area → candles-map area → parse the description text
    # (where most eaqartabuk listings actually put it, e.g. "مساحة 796").
    area = _float(meta.get("area")) or _float(mp.get("area")) \
        or _area_from_text(desc_html) or _area_from_text(item.get("excerpt"))
    beds = _int(meta.get("bedrooms"))
    # bedrooms make no sense for land/commercial, and guard absurd values.
    is_land = property_type in ("Residential Land", "Commercial Land")
    if category == "commercial" or is_land or (beds and beds > 20):
        beds = None
    price_per_meter = (round(price_total / area)
                       if (price_total and area and area > 0) else None)

    # City is ALWAYS Tabuk for this source (the API `city` field frequently holds a district).
    raw_city = (mp.get("city") or "").strip()
    district = (mp.get("district") or "").strip() or None
    if not district and raw_city and raw_city not in ("تبوك", "Tabuk"):
        # `city` actually carried a district name (e.g. "حي الورود").
        district = raw_city

    title = _redact(_strip_tags(item.get("title")))
    description = _redact(_strip_tags(desc_html) or _strip_tags(item.get("excerpt")))

    photo = _full_img(item.get("featured_image"))
    photos = [photo] if photo else []

    features = mp.get("features") if isinstance(mp.get("features"), list) else []
    info: dict[str, Any] = {
        "city_ar": "تبوك",
        "region_ar": "منطقة تبوك",
        "district_ar": district,
        "type_ar": mp.get("type") or None,
        "status_ar": status_ar or None,
        "operation": op or None,
        "usage": usage or None,
        "latitude": mp.get("lat"),
        "longitude": mp.get("lng"),
        "features": features or None,
        "parcel_number": mp.get("parcel_number") or None,
        "plan_id": mp.get("plan_id") or None,
        "plan_title": mp.get("plan_title") or None,
        "address": _redact(meta.get("address") or mp.get("location")),
        "date_published": item.get("date"),
        "is_investment": True if op == "investment" or "استثمار" in status_ar else None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], "0")}

    row: dict[str, Any] = {
        "ad_number": f"ET{pid}",
        "listing_url": item.get("link") or f"{BASE}/?p={pid}",
        "source": "Eaqartabuk",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        "bedrooms": beds,
        "bathrooms": _int(meta.get("bathrooms")),
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "city": "Tabuk",
        "region": "Tabuk",
        "neighborhood": district,
        "title": title,
        "description": description,
        "photo_urls": photos,
        "date_added": item.get("date") or None,
        "additional_info": info,
    }
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="small validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    first_items, meta0 = fetch_page(s, 1)
    total = meta0.get("total")
    pages = meta0.get("total_pages") or 1
    print(f"Eaqar Tabuk: {total} listings across {pages} pages ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    # Gather the list items (paginate). For the small run we only need the first page.
    items: list[dict] = list(first_items)
    if not args.limit:
        page = 2
        while page <= pages:
            more, _ = fetch_page(s, page)
            if not more:
                break
            items.extend(more)
            page += 1
    print(f"  collected {len(items)} list items")

    run_id = None if args.limit else db.begin_run("eaqartabuk")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_eaqartabuk_residential_batch(res_buf); res_buf = []
            if com_buf:
                db.upsert_eaqartabuk_commercial_batch(com_buf); com_buf = []

        def process(item: dict) -> Optional[tuple[dict, str]]:
            pid = item.get("id")
            if not pid:
                return None
            mp, desc = _enrich(int(pid))
            return map_listing(item, mp, desc)

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(process, items):
                if not result:
                    continue
                row, cat = result
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if len(res_buf) + len(com_buf) >= 50:
                    flush()
                    print(f"  …{seen} upserted", flush=True)
                if args.limit and seen >= args.limit:
                    break
        flush()

        if args.limit:
            print(f"✓ Eaqar Tabuk VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:78])
            return 0

        # Full run: prune listings that were active before but weren't seen this crawl.
        pruned = 0
        for tbl, rows_seen in (("eaqartabuk_residential_listings", res),
                               ("eaqartabuk_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Eaqartabuk")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Eaqar Tabuk: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}")
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
