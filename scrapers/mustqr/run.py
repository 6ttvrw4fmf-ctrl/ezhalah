"""Mustqr (mustqr.sa) scraper — مكتب مستقر للعقارات.

Hail-region brokerage running a Vite SPA on top of a public Supabase PostgREST. The site embeds
the project's `anon` JWT directly in its JS bundle (role=anon, exp 2036) so the same key the
browser uses is what we authenticate with. No proxy needed, no Cloudflare in front of the API.

Data model:
  GET https://jzhotxuqwkpykavxpgeu.supabase.co/rest/v1/properties?select=*&order=id.asc
       paginated via Range header (Supabase caps each response at 1000 rows → ~2 pages today,
       headroom for ~5).
  GET /rest/v1/neighborhoods?select=*  — 145 rows mapping id/name/region (north|south|east|west).
       Mustqr stores `properties.neighborhood` as a NAME (Arabic), not an FK, so the join is just
       lookup-by-name for the region hint.

Images: each row carries `images[]=[{url, path, width, height}]`. `url` is the public CDN
(`https://img.mustqr.sa/<uuid>.webp`), no signing, no resizing tokens to strip.

Videos: `videos[]=[{uid, ready, duration}]` is Cloudflare Stream. We store the first ready video
as `https://iframe.videodelivery.net/<uid>` (the public embed URL Cloudflare Stream serves to
unauth'd visitors).

⛔ PDPL: rows include `owner_phone`, `broker`, and a `raw_text` field full of phones / wa.me /
brokerage names. We DROP `owner_phone`/`broker` outright and REDACT `description` / `title`
before storing. `raw_text` is never stored.

Usage:
  python -m scrapers.mustqr.run --type all --limit 20
  python -m scrapers.mustqr.run                  # full run, with unseen-prune
"""
from __future__ import annotations

import argparse
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

from scrapers.common import db

SITE = "https://mustqr.sa"
PROJECT = "https://jzhotxuqwkpykavxpgeu.supabase.co"
PAGE_SIZE = 1000  # Supabase PostgREST hard cap
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# Mustqr property type (Arabic) → canonical English taxonomy.
TYPE_MAP = {
    "فيلا": "Villa",
    "شقة": "Apartment",
    "دور": "Floor",
    "دوبلكس": "Villa",
    "بيت": "House",
    "حوش": "House",
    "عمارة": "Building",
    "استراحة": "Rest House",
    "شاليه": "Chalet",
    "أرض": "Residential Land",
    "ارض زراعية": "Farm",
    "صالة": "Showroom",          # event/showroom hall → commercial
    "فندق": "Hotel",
    "مكتب": "Office",
    "محطة": "Gas Station",
}
COMMERCIAL_TYPES = {"Showroom", "Hotel", "Office", "Gas Station", "Warehouse", "Shop", "Building"}

# Mustqr stores neighborhood.region as a compass bucket relative to Hail city, not a KSA region.
# The whole brokerage is Hail-based, so every row maps to city=Hail, region=Hail.
DEFAULT_CITY = "Hail"
DEFAULT_REGION = "Hail"

# Phone / contact patterns — same coverage as the other PDPL-aware scrapers.
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"            # +9665XXXXXXXX
    r"|00966\d{9}"                # 00966XXXXXXXXX
    r"|0?5\d{8}"                  # 05XXXXXXXX / 5XXXXXXXX
    r"|9200\d{4,6}"               # 9200xxxx unified service
    r"|wa\.me/\S+"                # wa.me links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json"})
    return s


def fetch_jwt(s: cc.Session) -> str:
    """Pull the public anon JWT Mustqr embeds in its SPA bundle. Cached in-process so a full run
    only does the discovery once."""
    global _JWT
    if "_JWT" in globals() and _JWT:
        return _JWT
    # 1) Read landing page, find the index-*.js bundle.
    r = s.get(SITE, timeout=30)
    r.raise_for_status()
    bundles = re.findall(r"/assets/index-[A-Za-z0-9_\-]+\.js", r.text)
    if not bundles:
        raise RuntimeError("Mustqr: could not locate SPA bundle in landing page")
    # 2) Fetch the first index bundle and grep for a JWT.
    r = s.get(SITE + bundles[0], timeout=30)
    r.raise_for_status()
    jwts = re.findall(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", r.text)
    if not jwts:
        raise RuntimeError(f"Mustqr: no JWT found in {bundles[0]}")
    _JWT = jwts[0]
    return _JWT


def _headers(jwt: str, *, range_hdr: Optional[str] = None, count: bool = False) -> dict[str, str]:
    h: dict[str, str] = {
        "apikey": jwt,
        "Authorization": f"Bearer {jwt}",
        "Accept": "application/json",
    }
    if range_hdr is not None:
        h["Range-Unit"] = "items"
        h["Range"] = range_hdr
    if count:
        h["Prefer"] = "count=exact"
    return h


def fetch_neighborhoods(s: cc.Session, jwt: str) -> dict[str, str]:
    """name → region (north|south|east|west). Used for an additional_info hint only."""
    _throttle()
    r = s.get(PROJECT + "/rest/v1/neighborhoods?select=id,name,region", headers=_headers(jwt), timeout=30)
    if r.status_code != 200:
        return {}
    return {row["name"]: row.get("region") for row in r.json() if row.get("name")}


def fetch_page(s: cc.Session, jwt: str, offset: int) -> tuple[list[dict], Optional[int]]:
    """Range-paginated GET of /rest/v1/properties. Returns (rows, total_count_or_None)."""
    _throttle()
    rng = f"{offset}-{offset + PAGE_SIZE - 1}"
    url = f"{PROJECT}/rest/v1/properties?select=*&status=eq.%D9%85%D8%AA%D8%A7%D8%AD&order=id.asc"
    for attempt in range(3):
        try:
            r = s.get(url, headers=_headers(jwt, range_hdr=rng, count=(offset == 0)), timeout=45)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code in (200, 206):
            total: Optional[int] = None
            cr = r.headers.get("content-range", "")
            if "/" in cr:
                tail = cr.split("/")[-1]
                if tail.isdigit():
                    total = int(tail)
            return r.json(), total
        if r.status_code in (429, 502, 503, 504):
            time.sleep(3 * (attempt + 1)); continue
        return [], None
    return [], None


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _photos(images: Any) -> list[str]:
    if not isinstance(images, list):
        return []
    out: list[str] = []
    for im in images:
        if not isinstance(im, dict):
            continue
        url = im.get("url")
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        if any(skip in url.lower() for skip in ("logo", "placeholder", "no-image", "default-")):
            continue
        out.append(url)
    return out


def _video_url(videos: Any) -> Optional[str]:
    if not isinstance(videos, list):
        return None
    for v in videos:
        if isinstance(v, dict) and v.get("ready") and v.get("uid"):
            # Cloudflare Stream public embed URL — works without an account-scoped customer code.
            return f"https://iframe.videodelivery.net/{v['uid']}"
    return None


def _price_fields(p: dict, is_rent: bool, is_monthly: bool) -> dict[str, Any]:
    """price > price_som > price_had. Reject < 1000."""
    raw = p.get("price") or p.get("price_som") or p.get("price_had")
    n = _int(raw)
    if not n or n < 1000:
        return {}
    if is_rent:
        # Monthly rentals must store the ANNUALIZED figure (monthly×12); the app displays
        # round(price_annual/12), so storing the raw monthly showed 1/12 of the real rent.
        # (price-fidelity fix 2026-07-13)
        return {"price_annual": n * 12 if is_monthly else n,
                "rent_period": "monthly" if is_monthly else "annual"}
    return {"price_total": n}


def map_listing(p: dict, n_to_region: dict[str, str]) -> tuple[Optional[dict], str]:
    pid = p.get("id")
    if not pid:
        return None, "residential"

    ar_type = (p.get("type") or "").strip()
    property_type = TYPE_MAP.get(ar_type)
    if not property_type:
        return None, "residential"

    # Category: بيع/إيجار/استثمار → Buy or Rent (استثمار = investment, treat as Buy).
    category = (p.get("category") or "").strip()
    is_rent = category == "إيجار"
    is_monthly = (p.get("price_type") == "شهري")
    usage = (p.get("usage_type") or "").strip()

    # Commercial routing: explicit commercial usage_type OR commercial-only property type.
    is_commercial = (usage == "تجاري") or (property_type in COMMERCIAL_TYPES)
    bucket = "commercial" if is_commercial else "residential"

    bedrooms = _int(p.get("rooms"))
    # Sanity: commercial / land never has bedrooms; cap absurd counts.
    if is_commercial or property_type in {"Residential Land", "Farm"}:
        bedrooms = None
    elif bedrooms and bedrooms > 20:
        bedrooms = None

    area = _int(p.get("area_sqm"))

    raw_neigh = (p.get("neighborhood") or "").strip() or None
    region_hint = n_to_region.get(raw_neigh) if raw_neigh else None

    title = _redact(p.get("title"))
    description = _redact(p.get("description"))

    photo_urls = _photos(p.get("images"))
    video_url = _video_url(p.get("videos"))

    # additional_info: rich data NOT redactable + safe metadata. Skip every PII-bearing field.
    extras: dict[str, Any] = {
        "city_ar": "حائل",
        "region_ar": "منطقة حائل",
        "district_ar": raw_neigh,
    }
    if region_hint:
        extras["mustqr_compass_region"] = region_hint  # north|south|east|west of Hail city
    if p.get("offer_number"):
        extras["offer_number"] = str(p["offer_number"])
    if p.get("direction"):
        extras["direction"] = str(p["direction"])
    if p.get("features"):
        extras["features"] = str(p["features"])
    if p.get("floor") not in (None, "", 0, "0"):
        extras["floor"] = str(p["floor"])
    if p.get("price_type"):
        extras["price_type_ar"] = p["price_type"]
    if p.get("price_som"):
        extras["price_som"] = _int(p["price_som"])
    if p.get("price_had"):
        extras["price_had"] = _int(p["price_had"])
    if p.get("usage_type"):
        extras["usage_type_ar"] = p["usage_type"]
    if p.get("category"):
        extras["category_ar"] = p["category"]
    if p.get("type"):
        extras["type_ar"] = p["type"]
    if p.get("have_a_planner_number") and p.get("planner_number"):
        extras["planner_number"] = str(p["planner_number"])
    if isinstance(p.get("categories"), list):
        extras["categories_ar"] = [c for c in p["categories"] if isinstance(c, str)]
    if isinstance(p.get("types"), list):
        extras["types_ar"] = [t for t in p["types"] if isinstance(t, str)]
    if p.get("view_count") is not None:
        extras["view_count"] = _int(p["view_count"])
    if p.get("is_featured"):
        extras["is_featured"] = True
    if p.get("show_location") and (p.get("lat") and p.get("lng")):
        try:
            extras["lat"] = float(p["lat"]); extras["lng"] = float(p["lng"])
        except (TypeError, ValueError):
            pass
    if p.get("created_at"):
        extras["mustqr_created_at"] = p["created_at"]
    if p.get("updated_at"):
        extras["mustqr_updated_at"] = p["updated_at"]
    extras["direction_ar"] = p.get("direction") if p.get("direction") else None

    row: dict[str, Any] = {
        "ad_number": f"MQ{pid}",
        "listing_url": f"{SITE}/property/{pid}",
        "source": "Mustqr",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": _int(p.get("bathrooms")),
        "city": DEFAULT_CITY,
        "region": DEFAULT_REGION,
        "neighborhood": raw_neigh,
        "title": title,
        "description": description,
        "photo_urls": photo_urls,
        "video_url": video_url,
        "additional_info": extras,
    }
    row.update(_price_fields(p, is_rent, is_monthly))
    if row.get("area_m2") and row.get("price_total"):
        try:
            row["price_per_meter"] = round(row["price_total"] / row["area_m2"])
        except ZeroDivisionError:
            pass

    return row, bucket


def fetch_all(s: cc.Session, jwt: str, limit: Optional[int] = None) -> list[dict]:
    out: list[dict] = []
    offset = 0
    total: Optional[int] = None
    while True:
        rows, t = fetch_page(s, jwt, offset)
        if t is not None and total is None:
            total = t
        if not rows:
            break
        out.extend(rows)
        if limit and len(out) >= limit:
            return out[:limit]
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    if total is not None:
        print(f"  fetched {len(out)} / {total} active properties")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=None, help="cap to first N rows (validation runs)")
    args = ap.parse_args()

    s = session()
    print("Mustqr: fetching anon JWT from SPA bundle…")
    jwt = fetch_jwt(s)
    print(f"  jwt ok ({jwt[:18]}…)")

    n_to_region = fetch_neighborhoods(s, jwt)
    print(f"  neighborhoods: {len(n_to_region)} mapped")

    raw = fetch_all(s, jwt, limit=args.limit)
    print(f"Mustqr: {len(raw)} active rows pulled")

    res: list[dict] = []
    com: list[dict] = []
    for p in raw:
        row, cat = map_listing(p, n_to_region)
        if not row:
            continue
        if args.type != "all" and cat != args.type:
            continue
        (com if cat == "commercial" else res).append(row)

    full_run = args.limit is None  # only prune on full runs
    run_id = db.begin_run("mustqr")
    try:
        if res:
            db.upsert_mustqr_residential_batch(res)
        if com:
            db.upsert_mustqr_commercial_batch(com)
        pruned = 0
        if full_run:
            for tbl, rows_seen in (
                ("mustqr_residential_listings", res),
                ("mustqr_commercial_listings", com),
            ):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Mustqr")
                if n < 0:
                    print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
                else:
                    pruned += n
        print(
            f"✓ Mustqr: {len(res)} residential + {len(com)} commercial upserted"
            + (f", {pruned} stale pruned" if full_run else " (validation: no prune)")
        )
        db.end_run(
            run_id,
            ok=True,
            rows_seen=len(raw),
            rows_upserted=len(res) + len(com),
            notes=f"pruned={pruned}" if full_run else "validation",
            check_tables=["mustqr_residential_listings", "mustqr_commercial_listings"],
        )
        return 0
    except Exception as e:
        db.end_run(run_id, ok=False, rows_seen=len(raw), rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
