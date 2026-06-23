"""1 October Real Estate (1october.com.sa / 1 أكتوبر العقارية) scraper — Saudi Jeddah brokerage.

Small boutique brokerage on the Nuzul SaaS platform (tenant 6269). Reachable DIRECT from any IP —
no proxy. Two data sources on every page, both server-rendered:
  • a clean JSON-LD ItemList on /properties (each item: name, type+deal in description, url, image,
    address {locality=district, region=city}, offers.price/priceCurrency) — the catalog enumerator.
  • the escaped RSC flight payload on each /properties/{id} detail page, carrying "area","bedrooms",
    "bathrooms" and the full JSON-LD image[] — the per-listing enrichment.

Realness-verified (2026-06): ~13 distinct, varied Jeddah listings, real REGA districts, real SAR
prices, created dates spread over months — not a seeded/prototype catalog.

  python -m scrapers.october.run --type all            # full crawl + prune
  python -m scrapers.october.run --type all --limit 8  # validation: first N, NO prune, print samples
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

from scrapers.common import db
from scrapers.common import normalize as N

BASE = "https://www.1october.com.sa"
SOURCE = "1 October"

# type token (from the index "<type> <deal>" description) → English canonical
TYPE_MAP = {
    "villa": "Villa", "tower_apartment": "Apartment", "building_apartment": "Apartment",
    "apartment": "Apartment", "duplex": "Duplex", "building": "Building", "floor": "Floor",
    "land": "Residential Land", "residential_land": "Residential Land",
    "commercial_land": "Commercial Land", "office": "Office", "shop": "Shop",
    "showroom": "Showroom", "warehouse": "Warehouse", "rest_house": "Rest House",
    "istraha": "Rest House", "farm": "Farm", "chalet": "Chalet", "station": "Other",
}

# PDPL: drop phones (incl. leetspeak o5o→050) and truncate at broker/contact markers.
_PHONE = re.compile(r"(?:\+?9665\d{7,}|\b0?5\d{8}\b|\b9[02]0\d{6,}\b|\b800\d{6,}\b|wa\.me/\S+)")
_OBF = re.compile(r"[oO0٠-٩]{8,}")
_CUT = re.compile(r"(للتواصل|للحجز|للاستفسار|اتصل|تواصل|واتساب|واتس|جوال|الجوال|للبيع والشراء عبر|المعلن|"
                  r"الوسيط|المسوق|اسم المعلن|رقم الاعلان|رقم الإعلان|hotline|whatsapp|call us)", re.I)


def _deobf(s: str) -> str:
    return _OBF.sub(lambda m: m.group(0).translate(str.maketrans("oO٠١٢٣٤٥٦٧٨٩",
                                                                 "00٠١٢٣٤٥٦٧٨٩".translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")))), s)


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _deobf(text)
    m = _CUT.search(t)
    if m:
        t = t[:m.start()]
    t = _PHONE.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip() or None


def _session() -> cc.Session:
    return cc.Session(impersonate="chrome124", timeout=30)


def _itemlist(html: str) -> list[dict]:
    """Pull the JSON-LD ItemList items off a /properties index page."""
    for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            j = json.loads(m)
        except Exception:
            continue
        if isinstance(j, dict) and j.get("itemListElement"):
            return [it.get("item") or {} for it in j["itemListElement"] if isinstance(it, dict)]
    return []


_AREA = re.compile(r'"area"\s*:\s*(\d+(?:\.\d+)?)')
_BEDS = re.compile(r'"bedrooms"\s*:\s*(\d+)')
_BATHS = re.compile(r'"bathrooms"\s*:\s*(\d+)')
_PRICE = re.compile(r'"price"\s*:\s*(\d{3,})')   # numeric only → skips the "price":"السعر" label


def _detail_specs(s: cc.Session, url: str, pid: str) -> dict:
    """Fetch a detail page; return {area_m2, bedrooms, bathrooms, price, photo_urls, description}.

    Specs live in the RSC flight payload where JSON quotes are backslash-escaped (\\"area\\":189),
    so un-escape before matching. The page also embeds a "similar properties" block, so anchor on the
    listing's own id ("id":<pid>) and read specs from that object's window — not the first global match.
    The JSON-LD block (photos/description) is NOT escaped — parse raw.
    """
    out: dict[str, Any] = {}
    try:
        r = s.get(url)
    except Exception:
        return out
    if r.status_code != 200:
        return out
    t = r.text

    # Primary: the clean (unescaped) JSON-LD RealEstate block — authoritative for this listing.
    for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', t, re.S):
        try:
            j = json.loads(m)
        except Exception:
            continue
        if isinstance(j, dict) and j.get("@type") == "RealEstate":
            img = j.get("image")
            if isinstance(img, list):
                out["photo_urls"] = [u for u in img if isinstance(u, str)]
            elif isinstance(img, str):
                out["photo_urls"] = [img]
            out["description"] = _redact(j.get("description"))
            rooms = N.to_int(j.get("numberOfRooms"))
            if rooms:
                out["bedrooms"] = rooms
            baths = N.to_int(j.get("numberOfBathroomsTotal"))
            if baths:
                out["bathrooms"] = baths
            fs = j.get("floorSize")
            if isinstance(fs, dict):
                v = N.to_int(fs.get("value"))
                if v:
                    out["area_m2"] = v
            offers = j.get("offers") or {}
            pv = N.to_int(offers.get("price"))
            if pv:
                out["price"] = pv
            break

    # Fallback: mine the escaped RSC object (anchored on this listing's id) for anything JSON-LD lacked.
    if "area_m2" not in out or "price" not in out:
        tu = t.replace('\\"', '"')
        anchor = re.search(r'"id"\s*:\s*' + re.escape(pid) + r'\b', tu)
        win = tu[max(0, anchor.start() - 1300): anchor.start() + 2600] if anchor else tu
        if "area_m2" not in out:
            a = _AREA.search(win)
            if a:
                out["area_m2"] = round(float(a.group(1)))
        if "price" not in out:
            p = _PRICE.search(win)
            if p:
                out["price"] = int(p.group(1))
    return out


def map_item(item: dict, s: cc.Session) -> Optional[tuple[dict, str]]:
    url = (item.get("url") or "").strip()
    m = re.search(r"/properties/(\d+)", url)
    if not m:
        return None
    pid = m.group(1)

    desc = (item.get("description") or "").strip()       # "<type_token> <deal_arabic>"
    name = (item.get("name") or "").strip()
    tok = desc.split(" ")[0].lower() if desc else ""
    property_type = TYPE_MAP.get(tok) or N.map_type(name) or N.map_type(desc) or "Other"

    blob = name + " " + desc
    if any(k in blob for k in ("للإيجار", "للايجار", "إيجار", "ايجار", "rent")):
        transaction_type = "Rent"
    else:
        transaction_type = "Buy"

    addr = item.get("address") or {}
    city = N.map_city(addr.get("addressRegion") or "")
    region = N.region_for_city(city)
    neighborhood = (addr.get("addressLocality") or "").strip() or None

    img = item.get("image")
    photos = [img] if isinstance(img, str) and img else ([u for u in img if isinstance(u, str)] if isinstance(img, list) else [])

    specs = _detail_specs(s, url, pid)

    offers = item.get("offers") or {}
    price = N.to_int(offers.get("price")) or specs.get("price")   # index has sale prices; rent prices come from detail
    if price is not None and price < 100:
        price = None
    if specs.get("photo_urls"):
        photos = specs["photo_urls"]

    category = N.category_for_type(property_type)
    beds = specs.get("bedrooms")
    baths = specs.get("bathrooms")
    if category == "commercial" or property_type in ("Residential Land", "Commercial Land", "Building"):
        beds = None
        baths = None

    row = {
        "ad_number": f"OCT{pid}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": city,
        "region": region,
        "neighborhood": neighborhood,
        "area_m2": specs.get("area_m2"),
        "bedrooms": beds,
        "bathrooms": baths,
        "price_total": price if transaction_type == "Buy" else None,
        "price_annual": price if transaction_type == "Rent" else None,
        "photo_urls": photos,
        "title": _redact(name),
        "description": specs.get("description"),
    }
    return row, category


def crawl(limit: int = 0) -> tuple[list[dict], list[dict], int]:
    s = _session()
    seen_ids: set[str] = set()
    res: list[dict] = []
    com: list[dict] = []
    n = 0
    for page in range(1, 8):  # tiny catalog; a handful of pages max
        try:
            r = s.get(f"{BASE}/properties?page={page}")
        except Exception:
            break
        if r.status_code != 200:
            break
        items = _itemlist(r.text)
        if not items:
            break
        new_this_page = 0
        for item in items:
            url = (item.get("url") or "")
            m = re.search(r"/properties/(\d+)", url)
            if not m or m.group(1) in seen_ids:
                continue
            seen_ids.add(m.group(1))
            new_this_page += 1
            mapped = map_item(item, s)
            if not mapped:
                continue
            row, cat = mapped
            (com if cat == "commercial" else res).append(row)
            n += 1
            time.sleep(0.2)
            if limit and n >= limit:
                return res, com, n
        if new_this_page == 0:
            break
    return res, com, n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    run_id = None if args.limit else db.begin_run("october")
    seen = 0
    try:
        res, com, seen = crawl(limit=args.limit)
        if args.type != "all":
            keep_com = args.type == "commercial"
            res, com = ([] if keep_com else res), (com if keep_com else [])

        if res:
            db.upsert_october_residential_batch(res)
        if com:
            db.upsert_october_commercial_batch(com)

        if args.limit:
            print(f"✓ 1 October VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual")})
                print("     title:", (r.get("title") or "")[:60])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74], f"({len(r['photo_urls'])} imgs)")
            return 0

        # Full run: prune unseen via the shared guarded helper (0-scrape/collapse → skip).
        pruned = 0
        for tbl, rows_seen in (("october_residential_listings", res),
                               ("october_commercial_listings", com)):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if nn < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += nn
        print(f"✓ 1 October: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com), notes=f"pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
