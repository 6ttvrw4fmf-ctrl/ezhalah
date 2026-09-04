"""THE RC — «الخيار الصحيح للخدمات العقارية» (therc.aqar.digital) scraper.

A single Riyadh brokerage office (tenant 950) on the shared `aqar.digital` Laravel SaaS. Everything
is server-rendered Tailwind + Alpine — no JS execution, no API, no auth, no cookie gate.

EXTRACTION MECHANISM (two steps, one request per listing):
  1. ENUMERATE from https://therc.aqar.digital/sitemap.xml — 397 unique `/properties/{slug}` locs
     with `<lastmod>`. One request for the whole catalog. The `?page=N` index is deliberately NOT
     used: every card is emitted TWICE per page (Alpine grid + list wrappers), and its type badge is
     a coarse 4-value category that labels «دور» as «فيلا» and «استوديو» as «شقة». The sitemap has
     neither trap and the detail page is required anyway (see below).
  2. PARSE each detail page:
       • JSON-LD `RealEstateListing` — name, offers.price/priceCurrency, address.addressLocality
         (city) / addressRegion (which is really the DISTRICT — schema.org misuse by the platform),
         floorSize.value + unitCode "MTK", numberOfRooms, datePosted, main image.
       • DOM, because JSON-LD carries NO deal, NO property type, NO bathrooms and NO rent period:
         - «رقم المرجع: AQ######» → the source's own stable listing id (our ad_number).
         - the primary price block → the literal period token («/ yearly») the site publishes.
         - the «المواصفات» spec grid → المساحة / غرف / حمام. A label whose value is absent has its
           WHOLE block omitted, so absence is a genuine source omission → NULL, never 0.
         - the «الوصف» block → the full Arabic description (JSON-LD truncates it at ~300 chars).
         - the Alpine `images: [...]` array → the full gallery (2-12 photos).
       • type + deal come from the title («<type> للبيع|للإيجار في …»), identical to JSON-LD `name`
         and reliable on 100% of sampled listings.
     The page is cut at «عقارات مشابهة» before any DOM regex: that similar-properties strip injects
     OTHER listings' prices, images and «/ yearly» tokens and would poison a naive parse.

REALNESS EVIDENCE (live audit + re-verified here, 2026-09-02): 397 sitemap URLs, `lastmod` showing
212 listings touched in 2026-09 and 185 in 2026-08 (a maintained catalog, not a dump); 83 distinct
titles in 85 sampled listings; 33 real Riyadh/Jeddah districts (ظهرة لبن، طويق، الملقا، الرمال…);
prices spanning 2,000 → 16,976,400 SAR; agent-written Arabic descriptions with per-room dimensions
and Google Maps links. robots.txt allows /properties (only /login /dashboard /office/ /admin/ are
disallowed); no CAPTCHA, no rate limit, no bot wall — nothing was bypassed.

NOT PUBLISHED BY THIS SOURCE, therefore always NULL here: property age, coordinates (the site's own
map says «لا توجد عقارات بإحداثيات لعرضها على الخريطة»), REGA/FAL ad licence as a structured field,
furnished flag, amenities, floor number. Rent period exists ONLY as the literal token in the price
block — it is never inferred from price, type or platform.

  python -m scrapers.therc.run --type all --limit 15 --dry-run   # validate: prints rows, NO writes
  python -m scrapers.therc.run --type all --limit 15             # upsert first 15, NO prune
  python -m scrapers.therc.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import os
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

from scrapers.common import db
from scrapers.common import normalize as N

BASE = "https://therc.aqar.digital"
SITEMAP = f"{BASE}/sitemap.xml"
SOURCE = "THE RC"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "1.2"))

# PDPL: drop phones (incl. o5o leetspeak) and truncate at broker/contact markers. Same shape as
# scrapers/october/run.py — descriptions here end in «📌 للتواصل …» with the agent's mobile.
_PHONE = re.compile(r"(?:\+?9665\d{7,}|\b0?5\d{8}\b|\b9[02]0\d{6,}\b|\b800\d{6,}\b|wa\.me/\S+)")
_OBF = re.compile(r"[oO0٠-٩]{8,}")
_AR2EN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_CUT = re.compile(r"(للتواصل|للحجز|للاستفسار|اتصل|تواصل|واتساب|واتس|جوال|الجوال|المعلن|"
                  r"الوسيط|المسوق|اسم المعلن|رقم الاعلان|رقم الإعلان|hotline|whatsapp|call us)", re.I)


def _deobf(s: str) -> str:
    """Normalize obfuscated digit runs ("o5o-xxx", "٠٥٠…") so _PHONE can see them."""
    return _OBF.sub(lambda m: m.group(0).translate(_AR2EN).replace("o", "0").replace("O", "0"), s)


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = _deobf(text)
    m = _CUT.search(t)
    if m:
        t = t[:m.start()]
    t = _PHONE.sub(" ", t)
    t = re.sub(r"[ \t]+", " ", t).strip()
    # Some ads OPEN with «📞 للتواصل …», so the cut leaves a lone emoji or a two-letter stub. That is
    # not a description — return NULL rather than store punctuation as the ad's text.
    return t if len(re.sub(r"\W+", "", t)) >= 8 else None


def _session() -> cc.Session:
    return cc.Session(impersonate="chrome124", timeout=30)


_last_hit = 0.0


def _get(s: cc.Session, url: str, tries: int = 3) -> Optional[str]:
    """Throttled GET with bounded retries. Returns None on a permanent miss or exhausted retries."""
    global _last_hit
    for attempt in range(tries):
        wait = MIN_INTERVAL - (time.time() - _last_hit)
        if wait > 0:
            time.sleep(wait)
        _last_hit = time.time()
        try:
            r = s.get(url)
        except Exception:
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code == 200:
            return r.text
        if r.status_code in (404, 410):
            return None          # gone for good — do not retry
        time.sleep(1.5 * (attempt + 1))
    return None


# ── page-level extractors ─────────────────────────────────────────────────────────────────────────
_SIMILAR = "عقارات مشابهة"      # everything below this heading belongs to OTHER listings
_REF = re.compile(r"رقم المرجع:\s*([A-Z0-9]+)")
# The listing's own price. Unique on the page (verified): the similar-properties strip uses a
# different class, and it is cut off before this runs anyway.
_PRICE_BLOCK = re.compile(
    r'<div class="text-3xl font-bold" style="color: var\(--color-primary\);">(.*?)</div>', re.S)
_SPEC = re.compile(r'text-sm text-gray-500">([^<]+)</div>\s*<div class="font-bold text-gray-900">([^<]+)</div>')
_DESC = re.compile(r'>الوصف</h2>\s*<div class="prose[^"]*">(.*?)</div>', re.S)
_IMAGES = re.compile(r"images\s*:\s*(\[[^\]]*\])")
_INTERNAL_ID = re.compile(r"/properties/950/(\d+)/")
# «<type> للبيع|للإيجار في …» — identical to JSON-LD `name`; the ONLY reliable type source here.
_TITLE_TYPE = re.compile(r"^(?P<type>.+?)\s+(?P<deal>للبيع|للإيجار)\s+في\b")
# The site prints the rent period as an English literal inside Arabic markup.
_PERIOD_TOKEN = re.compile(r"/\s*(yearly|monthly|weekly|daily)\b", re.I)
# PERIOD = SOURCE: the source's own literal token → the canonical Arabic token the shared
# rent_period_and_annual() decides on. This is a TRANSLATION of a published token, never an
# inference — no token in the price block means no period, full stop.
_PERIOD_AR = {"yearly": "سنوي", "monthly": "شهري", "weekly": "أسبوعي", "daily": "يومي"}
# A price the source states PER SQUARE METRE is never a total (PRICE = SOURCE). Not observed on this
# platform, but the check is one line and the failure it prevents is a 250x wrong price.
_PER_METER = re.compile(r"للمتر|/\s*م²|ريال\s*/\s*م")


def _text(fragment: str) -> str:
    t = re.sub(r"<br\s*/?>", "\n", fragment)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"[ \t]+", " ", html_mod.unescape(t)).strip()


def _jsonld_listing(page: str) -> dict:
    """The per-listing RealEstateListing block. The page also carries a site-level RealEstateAgent
    block (office name/phone) and a BreadcrumbList — both deliberately ignored."""
    for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        try:
            j = json.loads(m)
        except Exception:
            continue
        if isinstance(j, dict) and j.get("@type") == "RealEstateListing":
            return j
    return {}


def _gallery(page: str) -> list[str]:
    m = _IMAGES.search(page)
    if not m:
        return []
    try:
        arr = json.loads(html_mod.unescape(m.group(1)))
    except Exception:
        return []
    return [u for u in arr if isinstance(u, str) and u.startswith("http")]


def sitemap_urls(s: cc.Session) -> list[tuple[str, Optional[str]]]:
    """[(detail_url, lastmod)] for every /properties/ loc. One request for the whole catalog."""
    xml = _get(s, SITEMAP)
    if not xml:
        return []
    out: list[tuple[str, Optional[str]]] = []
    seen: set[str] = set()
    for block in re.findall(r"<url>(.*?)</url>", xml, re.S):
        loc = re.search(r"<loc>([^<]+)</loc>", block)
        if not loc or "/properties/" not in loc.group(1):
            continue
        url = html_mod.unescape(loc.group(1).strip())
        if url in seen:
            continue
        seen.add(url)
        lm = re.search(r"<lastmod>([^<]+)</lastmod>", block)
        out.append((url, lm.group(1).strip() if lm else None))
    return out


def map_listing(url: str, page: str, lastmod: Optional[str]) -> Optional[tuple[dict, str]]:
    """(row, category) from one detail page, or None if it carries no usable listing."""
    body = page.split(_SIMILAR)[0]          # never read another listing's price/images/period

    ld = _jsonld_listing(body)
    title = (ld.get("name") or "").strip()
    if not title:
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
        title = _text(h1.group(1)) if h1 else ""

    ref = _REF.search(body)
    if not ref or not title:
        return None
    ad_number = ref.group(1)                # the source's own stable id, verbatim (e.g. AQ488961)

    # ── type + deal: from the title's own «<type> للبيع|للإيجار في …» slot ONLY. The card/detail
    # BADGE is a coarse 4-value category that mislabels دور as فيلا and استوديو as شقة, so it is
    # never read. No published type+deal ⇒ no row: defaulting the deal to «للبيع» would file a rent
    # price into price_total, and scanning the whole title for a type word reads the STREET/DISTRICT
    # tail («شارع المعرض» → Showroom, «حي المزرعة» → Farm) as if the source had published it.
    tm = _TITLE_TYPE.match(title)
    if not tm:
        return None
    type_ar = tm.group("type").strip()
    deal_ar = tm.group("deal")
    transaction_type = "Rent" if deal_ar == "للإيجار" else "Buy"
    # Unmapped type ⇒ drop, never a made-up label: "Other" is not in the app taxonomy AND
    # category_for_type("Other") is "Commercial", so it would silently file the row in the wrong
    # table. All 10 type words this source publishes map through the shared vocabulary.
    property_type = N.map_type(type_ar)
    if not property_type:
        return None
    category = "commercial" if N.category_for_type(property_type) == "Commercial" else "residential"

    # ── location. JSON-LD misuses the schema: addressLocality is the CITY, addressRegion is the
    # DISTRICT. The real region is derived from the canonical city (region_for_city), never scraped.
    addr = ld.get("address") or {}
    city_ar = (addr.get("addressLocality") or "").strip()
    district_ar = (addr.get("addressRegion") or "").strip() or None
    city = N.map_city(city_ar)
    region = N.region_for_city(city)

    # ── specs. A missing label means the source omitted the whole block → NULL, never 0.
    specs = {k.strip(): v.strip() for k, v in _SPEC.findall(body)}
    fs = ld.get("floorSize") or {}
    area = N.to_int(fs.get("value")) if fs.get("unitCode") in (None, "MTK") else None
    if area is None:
        area = N.to_int(specs.get("المساحة"))
    bedrooms = N.to_int_numeric(ld.get("numberOfRooms")) or N.to_int(specs.get("غرف"))
    bathrooms = N.to_int(specs.get("حمام"))

    # ── price. PRICE = SOURCE: read offers.price verbatim; never compute, round or convert.
    pb = _PRICE_BLOCK.search(body)
    price_text = _text(pb.group(1)) if pb else ""
    offers = ld.get("offers") or {}
    raw_price = offers.get("price")
    price = N.to_int(raw_price)
    if price is not None and price <= 0:
        price = None

    per_meter = bool(_PER_METER.search(price_text))
    price_total = price_annual = price_per_meter = None
    rent_period = None
    if per_meter:
        # The source published a RATE, not a total. Storing it as a total (or multiplying by the
        # area to manufacture one) is the exact confusion the price-fidelity rule forbids.
        price_per_meter = price
    elif transaction_type == "Rent":
        tok = _PERIOD_TOKEN.search(price_text)
        rent_period, price_annual = N.rent_period_and_annual(
            price, _PERIOD_AR.get(tok.group(1).lower(), "") if tok else "")
    else:
        price_total = price

    description = _redact(_text(_DESC.search(body).group(1))) if _DESC.search(body) else None
    photos = _gallery(body)
    if not photos and isinstance(ld.get("image"), str):
        photos = [ld["image"]]
    # The tenant's internal property id — only recoverable from a GALLERY image path
    # (/properties/950/{propertyId}/…); the main image sits under /properties/950/main/.
    internal = _INTERNAL_ID.search(" ".join(photos))

    # Rule 7 — capture the complete source payload once, raw values preserved, so a field we don't
    # model today never needs a re-scrape. (db.redact_capture() scrubs free-text PII from this.)
    capture = {
        "schema": "therc.detail.v1",
        "json_ld": ld,
        "reference_code": ad_number,
        "internal_property_id": internal.group(1) if internal else None,
        "slug": url.rsplit("/", 1)[-1],
        "title_raw": title,
        "type_ar": type_ar or None,
        "deal_ar": deal_ar,
        "city_ar": city_ar or None,
        "district_ar": district_ar,
        "price_block_text": price_text or None,
        "price_currency": offers.get("priceCurrency"),
        "spec_block": specs,
        "date_posted": ld.get("datePosted"),
        "sitemap_lastmod": lastmod,
        "gallery": photos,
        "image_count": len(photos),
        "url_path": url,
        # Fields this source does not publish anywhere. Recorded so a later "why is age NULL?" is
        # answerable from the row alone, without re-fetching.
        "not_published": ["property_age", "latitude", "longitude", "ad_license_number",
                          "furnished", "amenities", "floor_number"],
    }

    extra = [{"key": "رقم المرجع", "label": "Reference", "value": ad_number}]
    if ld.get("datePosted"):
        extra.append({"key": "تاريخ النشر", "label": "Date posted", "value": ld["datePosted"]})
    if district_ar:
        extra.append({"key": "الحي", "label": "District", "value": district_ar})
    if price_text:
        extra.append({"key": "السعر كما نشر", "label": "Price as published", "value": price_text})

    row = {
        "ad_number": ad_number,
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": city,
        "region": region,
        "neighborhood": district_ar,
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "photo_urls": photos,
        "title": _redact(title),
        "description": description,
        "additional_info": extra,
        "source_capture": capture,
        "price_evidence": N.price_evidence(
            field="offers.price",
            raw=raw_price,
            stored=price_per_meter if per_meter else (price_annual if transaction_type == "Rent" else price_total),
            kind="per_meter" if per_meter else ("annual" if transaction_type == "Rent" else "total"),
            unit="per_meter" if per_meter else "total",
            origin="structured",
        ),
    }
    return row, category


def crawl(limit: int = 0) -> tuple[list[dict], list[dict], int]:
    s = _session()
    urls = sitemap_urls(s)
    print(f"THE RC: {len(urls)} listing URLs from sitemap.xml", flush=True)
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    for url, lastmod in urls:
        page = _get(s, url)
        if not page:
            continue
        mapped = map_listing(url, page, lastmod)
        if not mapped:
            continue
        row, cat = mapped
        (com if cat == "commercial" else res).append(row)
        seen += 1
        if limit and seen >= limit:
            break
    return res, com, seen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after N parsed listings; upserts them but NEVER prunes")
    ap.add_argument("--dry-run", action="store_true",
                    help="print normalized rows as JSON and write NOTHING to the database")
    args = ap.parse_args()

    if args.dry_run:
        res, com, seen = crawl(limit=args.limit)
        if args.type != "all":
            keep_com = args.type == "commercial"
            res, com = ([] if keep_com else res), (com if keep_com else [])
        print(json.dumps(res + com, ensure_ascii=False, indent=1, default=str))
        print(f"DRY RUN — {len(res)} residential + {len(com)} commercial parsed from {seen} listings; "
              f"0 database writes", flush=True)
        return 0

    run_id = None if args.limit else db.begin_run("therc")
    seen = 0
    try:
        res, com, seen = crawl(limit=args.limit)
        if args.type != "all":
            keep_com = args.type == "commercial"
            res, com = ([] if keep_com else res), (com if keep_com else [])

        if res:
            db.upsert_therc_residential_batch(res)
        if com:
            db.upsert_therc_commercial_batch(com)

        if args.limit:
            print(f"✓ THE RC VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            return 0

        pruned = 0
        for tbl, rows_seen in (("therc_residential_listings", res),
                               ("therc_commercial_listings", com)):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if nn < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += nn
        print(f"✓ THE RC: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}",
                             check_tables=["therc_residential_listings", "therc_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
