"""Abeea (abeea.com.sa / شركة أبعاد العقارية — "Abeea Real Estate") scraper — Saudi WordPress
+ Houzez theme, static-HTML detail-page parse.

Abeea Real Estate is a Saudi-registered brokerage company operating in the Eastern Province
(Al Khobar / Dammam / Dhahran / Al Jubail / Al Hofuf). Saudi-owned → passes the Saudi-only rule.
~200 property posts (a mix of available + sold/rented; we list only the available ones). No auth,
no proxy, cloud-friendly (WordPress/Houzez).

Data path (auth-free, all static HTML):
  (1) Enumerate every /en/property/<slug>/ URL from the Houzez property sitemaps
        (property-sitemap1.xml + property-sitemap2.xml). Skip the archive root /en/property/.
  (2) Fetch each detail page. Two complementary, reliable blocks live in the HTML:
        • a schema.org JSON-LD blob (@type LandParcel|Apartment|House|RealEstateListing) →
            name, description, address{locality,region,postalCode}, geo{lat,lng}, image[]
            (full-size gallery URLs), offers (price validity, seller=company name).
        • the Houzez "detail-wrap" label/value list →
            Property ID (→ ad_number), Price (+ /Yearly|/Monthly rent period),
            Land Area | Property Size (→ area_m2), Bedrooms, Living Room (→ halls),
            Bathrooms, Property Type ("Apartment, Residential" / "Land, Commercial" …),
            Property Status ("For Sale" / "For Rent, Rented" / "… Sold" …).

TYPE: the Houzez "Property Type" text ("Apartment, Residential", "Villa, Residential",
  "Land, Commercial", "Land, Residential", "Land, Villa", "Residential", …) → canonical English.
  The commercial/residential split is driven by the "Commercial" token (→ Commercial Land) and the
  type word; everything else routes residential.
DEAL: Property Status "For Rent" → Rent, "For Sale" → Buy. Status carrying "Sold"/"Rented" means
  the listing is no longer available → SKIPPED (marked inactive on the full run's prune).

LOCATION: JSON-LD address.addressLocality (English city) → normalize.map_city; region is then
  DERIVED from the city via normalize.region_for_city (NOT scraped) — the JSON-LD addressRegion is
  kept only in additional_info. District comes from the slug/title ("… <district> district …").

PHOTOS: prefer JSON-LD image[] (already full-size webp gallery URLs); fall back to the page's
  /wp-content/uploads/ gallery with WordPress -WxH size suffixes stripped to full-size. Logos /
  icons / placeholders excluded.

⛔⛔ PDPL ABSOLUTE — we NEVER store an advertiser/agent/owner PERSON name or ANY phone number.
  The Houzez page embeds an agent contact card + a tel:/wa.me click-to-call widget; we ignore it
  entirely and parse ONLY the property blocks above. The JSON-LD seller is the COMPANY ("Abeea
  Real Estate") — a registered company name is allowed — and we don't even persist it. We also
  REDACT any 05x / +9665 / 9200 / 920 / 800 / wa.me / واتساب phone shape from title + description
  before storing. National ID / deed-owner identity is never present and never stored.

Usage:  python -m scrapers.abeea.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import hashlib
import html as ihtml
import json
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

BASE = "https://abeea.com.sa"
SITEMAPS = [f"{BASE}/property-sitemap1.xml", f"{BASE}/property-sitemap2.xml"]
WORKERS = int(os.environ.get("ABEEA_WORKERS", "6"))

# Houzez "Property Type" cell text → canonical English. The cell is a comma-joined list of the
# Houzez property_type terms, e.g. "Apartment, Residential" / "Land, Commercial" / "Land, Villa".
# We scan in priority order and take the first hit; the "Commercial" token flips Land → commercial.
TYPE_RULES = [
    ("apartment", "Apartment"),
    ("studio", "Apartment"),
    ("villa", "Villa"),
    ("duplex", "Villa"),
    ("palace", "Villa"),
    ("townhouse", "Villa"),
    ("floor", "Floor"),
    ("roof", "Floor"),
    ("house", "House"),
    ("building", "Building"),
    ("rest house", "Rest House"),
    ("resthouse", "Rest House"),
    ("chalet", "Chalet"),
    ("farm", "Farm"),
    ("office", "Office"),
    ("shop", "Shop"),
    ("showroom", "Showroom"),
    ("warehouse", "Warehouse"),
    ("land", "Residential Land"),  # may flip to Commercial Land via the "commercial" token
]
COMMERCIAL_TYPES = {
    "Shop", "Office", "Showroom", "Warehouse", "Commercial Land", "Commercial Building",
}

# English city label (JSON-LD addressLocality) → canonical English city. The Houzez data writes
# "Al Khobar" / "Al Dammam" / "AL Jubail" / "Al Hofuf" variants; normalize.map_city only knows the
# Arabic forms, so we resolve the common English spellings here first.
CITY_EN = {
    "al khobar": "Khobar", "khobar": "Khobar", "alkhobar": "Khobar", "al-khobar": "Khobar",
    "al dammam": "Dammam", "dammam": "Dammam", "ad dammam": "Dammam",
    "dhahran": "Dhahran", "al dhahran": "Dhahran",
    "al jubail": "Jubail", "jubail": "Jubail",
    "al hofuf": "Hofuf", "hofuf": "Hofuf", "al hasa": "Hofuf", "al ahsa": "Hofuf", "hofof": "Hofuf",
    "al qatif": "Qatif", "qatif": "Qatif", "saihat": "Sayhat", "sayhat": "Sayhat",
    "al mubarraz": "Hofuf", "ras tanura": "Ras Tanura", "abqaiq": "Abqaiq",
}
# Arabic city words (appear in the AR title variant) as a secondary fallback.
CITY_AR = {
    "الخبر": "Khobar", "الدمام": "Dammam", "الظهران": "Dhahran", "الجبيل": "Jubail",
    "الهفوف": "Hofuf", "الأحساء": "Hofuf", "الاحساء": "Hofuf", "القطيف": "Qatif",
}

# Statuses that mean the listing is no longer available.
GONE_STATUS = ("sold", "rented", "off market", "off-market", "مباع", "مؤجر", "محجوز")

# Phone / contact patterns to REDACT from title + description (PDPL). Defense-in-depth — covers
# every shape a future template change could inline into the free text.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"                 # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"                     # bare 966xxxxxxxx(x)
    r"|0?5\d(?:[\s\.\-]?\d){7}"            # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"                      # 9200xxxx short-codes
    r"|\b920\d{6}\b"                       # 920xxxxxx unified numbers
    r"|\b800\d{7}\b"                       # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|whatsapp\S*\s*\d[\d\s\-]{6,}"
    r"|واتس\S*\s*\d[\d\s\-]{6,})",
    re.I,
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
DETAIL_WRAP_RE = re.compile(r'class="detail-wrap"(.*?)</ul>', re.S)
ITEM_RE = re.compile(r"<strong>([^<]+)</strong>\s*<span>(.*?)</span>", re.S)
# district from the slug/title — capture the whole multi-word district name between the deal
# phrase ("for-sale"/"for-rent[-in]" or a bare "-in-") and the "-district" marker, e.g.
# "…-for-rent-in-al-hizam-al-thahabi-district-…" → "al hizam al thahabi".
DISTRICT_SLUG_RE = re.compile(r"(?:for[- ](?:sale|rent)(?:[- ]in)?|[- ]in)[- ](.+?)[- ]district", re.I)

_BAD_IMG = ("logo", "icon", "placeholder", "no-image", "no_image", "spinner", "avatar",
            "favicon", "/svg/", "loader", "blank.")

_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        })
        _local.s = s
    return s


def session() -> cc.Session:
    return cc.Session(impersonate="chrome124")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _to_int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"(?:call|تواصل|للتواصل|للاتصال|اتصل)\s*[:：]?\s*$", " ", t, flags=re.I)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip() or None


# ── Sitemap enumeration ───────────────────────────────────────────────────────
def sitemap_urls(s: cc.Session) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for sm in SITEMAPS:
        try:
            body = s.get(sm, timeout=30).text
        except Exception:
            continue
        for u in re.findall(r"<loc>([^<]+)</loc>", body):
            u = u.strip()
            if "/property/" not in u:
                continue
            # skip the archive root (…/property/ with no slug)
            if u.rstrip("/").rsplit("/", 1)[-1] == "property":
                continue
            if u not in seen:
                seen.add(u)
                out.append(u)
    return out


def fetch_one(url: str) -> Optional[tuple[str, str]]:
    """Fetch a detail page. Returns (body, url) or None."""
    s = _session()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and len(r.text) > 2000:
            return r.text, url
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _json_ld(body: str) -> dict:
    """Return the property JSON-LD object (LandParcel/Apartment/House/RealEstateListing)."""
    for m in LD_RE.finditer(body):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if isinstance(d, list):
            d = next((x for x in d if isinstance(x, dict)), {})
        if isinstance(d, dict) and d.get("address"):
            return d
    return {}


def _detail_items(body: str) -> dict[str, str]:
    """The Houzez label/value list (Property ID, Price, area, Bedrooms, …)."""
    m = DETAIL_WRAP_RE.search(body)
    if not m:
        return {}
    out: dict[str, str] = {}
    for it in ITEM_RE.finditer(m.group(1)):
        out[_clean(it.group(1))] = _clean(it.group(2))
    return out


def _map_type(type_text: str) -> tuple[str, bool]:
    """('Apartment, Residential' | 'Land, Commercial' | …) → (canonical type, is_commercial)."""
    low = (type_text or "").lower()
    is_commercial = "commercial" in low
    canon = None
    for word, eng in TYPE_RULES:
        if word in low:
            canon = eng
            break
    if canon is None:
        canon = "Residential Land"  # safe default
    if canon == "Residential Land" and is_commercial:
        canon = "Commercial Land"
    return canon, (canon in COMMERCIAL_TYPES)


def _district_from(slug: str, title: str) -> Optional[str]:
    for src in (title, slug.replace("-", " ")):
        m = DISTRICT_SLUG_RE.search(src)
        if m:
            d = m.group(1).replace("-", " ").strip()
            # drop a leading deal/type word that the regex sometimes grabs ("rent in al saif")
            d = re.sub(r"^(?:rent|sale|the|a)\s+", "", d, flags=re.I).strip()
            if d and len(d) > 2 and not d.isdigit():
                return d.title()
    return None


def _images(body: str, ld: dict) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()

    def add(u: Optional[str]) -> None:
        if not isinstance(u, str) or not u.startswith("http"):
            return
        low = u.lower()
        if any(b in low for b in _BAD_IMG):
            return
        full = re.sub(r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)", "", u, flags=re.I)
        if full not in seen:
            seen.add(full)
            out.append(full)

    imgs = ld.get("image")
    if isinstance(imgs, str):
        add(imgs)
    elif isinstance(imgs, list):
        for u in imgs:
            add(u if isinstance(u, str) else (u.get("url") if isinstance(u, dict) else None))
    # fall back to / supplement with the page gallery (full-size after stripping size suffixes)
    for u in re.findall(
        r"https://abeea\.com\.sa/wp-content/uploads/[^\s\"'\\)<>]+?\.(?:jpe?g|png|webp)", body, re.I
    ):
        add(u)
    return out[:25]


def map_listing(body: str, url: str) -> tuple[Optional[dict], str, bool]:
    """Return (row, category, gone). gone=True → sold/rented (skip / mark inactive)."""
    ld = _json_ld(body)
    items = _detail_items(body)
    if not items and not ld:
        return None, "residential", False

    name = _clean(ld.get("name") or "")
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    # ── status / deal type ──
    status = (items.get("Property Status") or "").lower()
    gone = any(g in status for g in GONE_STATUS)
    price_text = items.get("Price") or ""
    is_rent = ("for rent" in status) or ("/yearly" in price_text.lower()) \
        or ("/monthly" in price_text.lower()) or bool(re.search(r"for[- ]rent", slug, re.I)) \
        or ("للإيجار" in name or "للايجار" in name)
    if "for sale" in status and "for rent" not in status:
        is_rent = False

    # ── type + category ──
    property_type, is_commercial = _map_type(items.get("Property Type") or "")
    category = "commercial" if is_commercial else "residential"
    is_land = property_type in ("Residential Land", "Commercial Land")

    # ── price + rent period ──
    price = _to_int(re.split(r"/", price_text)[0]) if price_text else None
    rent_period = None
    if is_rent:
        low = price_text.lower()
        if "monthly" in low:
            rent_period = "monthly"
        else:
            rent_period = "annual"  # site shows yearly rents
    # sanity: drop absurd/zero prices
    if price is not None and price < 100:
        price = None

    # ── area ──
    area = _to_int(items.get("Land Area") or items.get("Property Size") or items.get("Size"))
    # JSON-LD description sometimes carries a more precise "Area: 214.44m2"
    if not area:
        dm = re.search(r"Area\s*:\s*([\d,.]+)\s*m", ld.get("description") or "", re.I)
        if dm:
            area = _to_int(dm.group(1))

    # ── bedrooms / bathrooms / halls (units only) ──
    bedrooms = baths = halls = None
    if not is_land and category == "residential":
        bedrooms = _to_int(items.get("Bedrooms"))
        if bedrooms and not (0 < bedrooms <= 30):
            bedrooms = None
    baths = _to_int(items.get("Bathrooms"))
    halls = _to_int(items.get("Living Room") or items.get("Living Rooms"))

    # ── price per meter ──
    ppm = None
    if not is_rent and price and area:
        ppm = round(price / area)
    pm = re.search(r"[Pp]rice per meter\s*:\s*([\d,]+)", ld.get("description") or "")
    if pm:
        cand = _to_int(pm.group(1))
        if cand and cand >= 50:
            ppm = cand

    # ── location (city from JSON-LD addressLocality → canonical; region DERIVED from city) ──
    addr = ld.get("address") if isinstance(ld.get("address"), dict) else {}
    locality = (addr.get("addressLocality") or "").strip()
    region_en_raw = (addr.get("addressRegion") or "").strip()
    postal = (addr.get("postalCode") or "").strip() or None

    city = CITY_EN.get(locality.lower()) or normalize.map_city(locality)
    if not city:
        for ar, en in CITY_AR.items():
            if ar in name:
                city = en
                break
    if not city:
        # last resort: scan slug for an English city token
        for key, en in CITY_EN.items():
            if key.replace(" ", "-") in slug.lower():
                city = en
                break
    region = normalize.region_for_city(city)

    district = _district_from(slug, name)

    # ── geo ──
    geo = ld.get("geo") if isinstance(ld.get("geo"), dict) else {}
    lat = geo.get("latitude")
    lng = geo.get("longitude")

    # ── PDPL-safe text ──
    title = _redact(name) or name or None
    description = _redact(ld.get("description"))

    # deterministic ad number from the Houzez Property ID, else the slug (md5, not salted hash())
    pid = (items.get("Property ID") or "").strip()
    if pid:
        clean_pid = re.sub(r"[^A-Za-z0-9]", "", pid)
        # Abeea's own Property IDs already start with "ABRE…"/"AB…"; don't double-prefix.
        ad_number = clean_pid if clean_pid.upper().startswith("AB") else f"AB{clean_pid}"
    else:
        ad_number = "AB" + hashlib.md5(slug.encode("utf-8")).hexdigest()[:12]

    info: dict[str, Any] = {
        "property_id": pid or None,
        "slug": slug,
        "address_region_en": region_en_raw or None,
        "street_address": addr.get("streetAddress") or None,
        "latitude": lat,
        "longitude": lng,
        "house_type_raw": items.get("Property Type") or None,
        "status_raw": items.get("Property Status") or None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], "—")}

    row: dict[str, Any] = {
        "ad_number": ad_number,
        "listing_url": url,
        "source": "Abeea",
        "active": not gone,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": baths,
        "halls": halls,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district,
        "zip_code": postal,
        "rega_location_verified": False,
        "title": title,
        "description": description,
        "photo_urls": _images(body, ld),
        "additional_info": info,
    }
    return row, category, gone


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    urls = sitemap_urls(s)
    if args.limit:
        urls = urls[: max(args.limit * 3, 30)]
    print(f"Abeea: {len(urls)} candidate listings ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("abeea")
    res: list[dict] = []
    com: list[dict] = []
    gone_ct = 0
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_abeea_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_abeea_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, urls):
                if not result:
                    continue
                body, u = result
                row, cat, gone = map_listing(body, u)
                if not row:
                    continue
                if gone:
                    gone_ct += 1
                    continue  # don't list sold/rented
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
            print(f"✓ Abeea VALIDATION: {len(res)} residential + {len(com)} commercial upserted "
                  f"({gone_ct} sold/rented skipped, no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual",
                    "price_per_meter")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            return 0

        # Full run: prune listings active before but not seen this crawl (full catalog fetched).
        pruned = 0
        for tbl, rows_seen in (("abeea_residential_listings", res),
                               ("abeea_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Abeea")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Abeea: {len(res)} residential + {len(com)} commercial upserted, "
              f"{gone_ct} sold/rented skipped, {pruned} stale pruned")
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
