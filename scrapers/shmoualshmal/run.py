"""شموع الشمال العقارية — shmoua-alshmal.com (Houzez WordPress theme).

SOURCE SHAPE (probed live 2026-09-05, before a line of this was written):
  · /wp-json/wp/v2/properties returns the full listing set as JSON. 6 listings at audit time.
  · Every fact this scraper stores comes from that payload or from a taxonomy the SAME site
    publishes — nothing is derived from a sibling field, a coordinate, or the company's address.

THE PRICE IS NOT PUBLISHED, AND THAT IS A SOURCE FACT — NOT A PARSE GAP.
  Checked three independent ways on 2026-09-05: the REST meta carries 42 keys and the only
  price-shaped one is `fave_show_price_placeholder` (a display toggle, not a price); the detail
  page's JSON-LD is a `Place` with no offer; and the rendered HTML shows «اتصل» (call) where a
  figure would go. Houzez stores prices in `fave_property_price`, which this site does not expose.
  So price_total / price_annual / price_per_meter are ALL left NULL. They are never inferred,
  estimated, or back-computed from area (PRICE = SOURCE). 7,534 rows already live in the index are
  priceless for exactly this reason, so this is the established honest shape, not a new exception.

RENT PERIOD is likewise never defaulted. With no price and no period token the source states no
period, so rent_period stays NULL (normalize.rent_period_and_annual's "no token" branch) rather
than manufacturing 'annual' — the 2026-08-11 audit defect that put سنوي on 187 rows.

TAXONOMIES ARE FETCHED, NOT HARDCODED. property_type / property_status / property_city /
property_area / property_feature all resolve over REST on this host, so the ID→name maps are built
per run. A hardcoded map would silently rot the first time they add a city.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import html as ihtml
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://shmoua-alshmal.com"
REST = f"{BASE}/wp-json/wp/v2"
SOURCE = "Shmou Al Shmal"
LAST_FETCH_NOTE = ""
PREFIX = "SHM"

# The taxonomies this theme uses. Fetched per run; see the module docstring.
TAXONOMIES = ("property_type", "property_status", "property_city", "property_area",
              "property_feature", "property_label")

# Houzez feature tag → the canonical boolean column that means the SAME thing. A tag with no exact
# column is NOT forced into an approximate one — it is preserved verbatim in additional_info.
# «مجلس» deliberately maps to nothing: reception_rooms_majlis is a COUNT, and a presence tag does
# not state a count. Writing 1 would be inventing a number the source never published.
FEATURE_COLUMN = {
    "غرفة خادمة": "maid_room",
    "غرفة سائق": "driver_room",
    "غرفة غسيل": "laundry_room",
    "مدخل سيارة": "car_entrance",
}

# One vetted addition to the house taxonomy: «محل تجاري» is «محل» (Shop) with the redundant
# adjective "commercial". Exact-only mapping otherwise — the fuzzy matcher mis-files combined
# Arabic category names (proven on alta, where "محلات ومعارض" fuzzed to "Residential Land").
TYPE_OVERRIDES = {"محل تجاري": "Shop"}

# No canonical type exists for these and neither is a plural of one that does: «محطة» alone is
# not necessarily «محطة بنزين» (Gas Station), and «منتجع» (resort) sits between Rest House and
# Chalet. Skipped and counted rather than guessed.
TYPE_UNMAPPABLE = ("محطة", "منتجع")

_PHONE_RE = re.compile(r"(?:\+?966|00966|0)?5\d{8}\b")
_PHONE_LOOSE = re.compile(r"(?:[\d٠-٩][\s\-]?){9,}")


def session() -> cc.Session:
    """Impersonating session, routed through the Saudi residential proxy when one is configured.

    WHY THE PROXY MATTERS HERE (measured 2026-09-05): from a laptop every endpoint answers in
    well under a second, but the first CI run made SIX taxonomy requests and burned 3m40s before
    reporting "no listings" — every request from the GitHub runner's datacenter IP timed out.
    The source was never down; the caller was unreachable. Same class of block the wasalt path
    documents. PROXY_URL holds only the env NAME — the value lives in the secret, never here.
    """
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json,text/html;q=0.9",
                      "Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    if purl:
        s.proxies = {"http": purl, "https": purl}
    return s


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    """Strip contact numbers before storage (PDPL) — same treatment every scraper applies."""
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", _PHONE_RE.sub(" ", text))
    t = re.sub(r"_?للتواصل[^_\n]*", " ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip() or None


def _meta1(meta: dict, key: str) -> Any:
    """WP serialises single-value meta as a 1-element list; unwrap it without assuming either shape."""
    v = meta.get(key)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def fetch_taxonomies(s: cc.Session) -> dict[str, dict[int, str]]:
    """{taxonomy: {term_id: term_name}} straight from the site. Never a hardcoded table."""
    out: dict[str, dict[int, str]] = {}
    for tax in TAXONOMIES:
        try:
            r = s.get(f"{REST}/{tax}?per_page=100", timeout=30)
            if r.status_code != 200:
                continue
            terms = r.json()
        except Exception:
            continue
        if not isinstance(terms, list):
            continue
        out[tax] = {t["id"]: t.get("name") for t in terms
                    if isinstance(t, dict) and isinstance(t.get("id"), int)}
    return out


def fetch_listings(s: cc.Session) -> list[dict]:
    """Every property post. An unparseable body ends enumeration rather than raising — the guard
    awal's 2026-07-27 parking incident put in every WP scraper."""
    out: list[dict] = []
    # Records WHY enumeration stopped. A timeout, a 403 and a genuinely empty source are three
    # different incidents; collapsing them into "no listings" sent the first CI run chasing a
    # dead source that was actually fine (2026-09-05).
    global LAST_FETCH_NOTE
    LAST_FETCH_NOTE = "no pages attempted"
    for page in range(1, 30):
        try:
            r = s.get(f"{REST}/properties?per_page=100&page={page}", timeout=40)
        except Exception as e:
            LAST_FETCH_NOTE = f"page {page} raised {type(e).__name__}: {str(e)[:120]}"
            break
        if r.status_code != 200:
            LAST_FETCH_NOTE = f"page {page} returned HTTP {r.status_code}"
            break
        try:
            batch = r.json()
        except Exception:
            LAST_FETCH_NOTE = f"page {page} body was not JSON (parked/blocked/truncated)"
            break                       # HTML/parked/truncated body — stop, do not loop
        if not isinstance(batch, list) or not batch:
            LAST_FETCH_NOTE = f"page {page} returned an empty list (end of source)"
            break
        out.extend(x for x in batch if isinstance(x, dict))
        if len(batch) < 100:
            break
    return out


def map_listing(p: dict, tax: dict[str, dict[int, str]]) -> tuple[Optional[dict], str]:
    link = p.get("link")
    if not link:
        return None, "residential"
    meta = p.get("property_meta") or {}

    def terms(key: str) -> list[str]:
        names = tax.get(key) or {}
        return [n for n in (names.get(i) for i in (p.get(key) or [])) if n]

    # ── transaction: the site's OWN status taxonomy, never the title ──
    status = terms("property_status")
    is_rent = any("إيجار" in s or "ايجار" in s for s in status)
    is_buy = any("بيع" in s for s in status)
    if not (is_rent or is_buy):
        return None, "residential"      # no stated transaction → not a listing we can tell the truth about

    # EXACT ONLY (+ the one vetted override). No fuzzy fallback — see TYPE_OVERRIDES.
    raw_type = next((t for t in terms("property_type")
                     if t not in TYPE_UNMAPPABLE
                     and (t in TYPE_OVERRIDES or normalize.map_type_exact(t))), None)
    if raw_type is None:
        return None, "residential"
    property_type = TYPE_OVERRIDES.get(raw_type) or normalize.map_type_exact(raw_type)
    if not property_type:
        return None, "residential"
    category = normalize.category_for_type(property_type).lower()

    raw_city = (terms("property_city") or [None])[0]
    city = normalize.map_city(raw_city) if raw_city else None
    region = normalize.region_for_city(city)
    district = (terms("property_area") or [None])[0]

    area = normalize.to_int_numeric(_meta1(meta, "fave_property_size"))
    beds = normalize.to_int(_meta1(meta, "fave_property_bedrooms"))
    baths = normalize.to_int(_meta1(meta, "fave_property_bathrooms"))

    title = _clean((p.get("title") or {}).get("rendered", ""))
    description = _redact(_clean((p.get("content") or {}).get("rendered", "")))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{int(hashlib.md5((p.get('slug') or str(p.get('id'))).encode()).hexdigest()[:12], 16)}",
        "listing_url": link,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": beds,
        "bathrooms": baths,
        # THE SOURCE PUBLISHES NO PRICE AND NO PERIOD — see the module docstring. Never inferred.
        "price_total": None,
        "price_annual": None,
        "price_per_meter": None,
        "rent_period": None,
        "city": city,
        "region": region,
        "neighborhood": district,
        "rega_location_verified": False,
        "title": title,
        "description": description,
        "photo_urls": [],
        "additional_info": {},
    }

    features = terms("property_feature")
    for f in features:
        col = FEATURE_COLUMN.get(f)
        if col:
            row[col] = True             # stated present. Absence stays NULL — never set False.

    info = {
        "city_ar": raw_city,
        "district_ar": district,
        "type_ar": raw_type,
        "status_ar": status or None,
        "features_ar": features or None,
        "map_address": _meta1(meta, "fave_property_map_address"),
        "size_prefix": _meta1(meta, "fave_property_size_prefix"),
        "wp_id": p.get("id"),
        "slug": p.get("slug") or None,
        "price_published": False,       # explicit: the SOURCE omits it, we did not fail to read it
    }
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    # begin_run BEFORE the fetch, so a dead/blocked source lands as a FAILED run instead of a
    # silent exit with zero scrape_runs rows (the awal 2026-07-28 defect).
    run_id = None if args.limit else db.begin_run("shmoualshmal")
    res: list[dict] = []
    com: list[dict] = []
    try:
        tax = fetch_taxonomies(s)
        posts = fetch_listings(s)
        if not posts:
            raise RuntimeError(f"REST returned no listings — {LAST_FETCH_NOTE}")
        if args.limit:
            posts = posts[: args.limit]
        print(f"{SOURCE}: {len(posts)} listings from WP REST"
              f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

        unmapped: dict[str, int] = {}
        for p in posts:
            row, cat = map_listing(p, tax)
            if not row:
                names = tax.get('property_type') or {}
                for tid in (p.get('property_type') or []):
                    n = names.get(tid)
                    if n:
                        unmapped[n] = unmapped.get(n, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        if res:
            db.upsert_shmoualshmal_residential_batch(res)
        if com:
            db.upsert_shmoualshmal_commercial_batch(com)

        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (no prune)")
            for r in (res + com)[:8]:
                print(f"   {r['ad_number']} {r['transaction_type']:5s} {str(r['property_type']):10s} "
                      f"{str(r['city']):12s} {str(r['neighborhood']):14s} "
                      f"{str(r['area_m2']):>6}m² bd={r['bedrooms']} price={r['price_total']}")
        else:
            n = len(res) + len(com)
            # end_run returns the EFFECTIVE ok it actually wrote: its RC-B guard can demote a run
            # that looks successful but wrote nothing real. Fail CI on a demotion rather than
            # reporting a silent success (the same check awal makes).
            healthy = db.end_run(run_id, ok=True, rows_seen=n, rows_upserted=n,
                                 check_tables=["shmoualshmal_residential_listings",
                                               "shmoualshmal_commercial_listings"])
            if not healthy:
                print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI "
                      "instead of reporting a silent success.", flush=True)
                return 1
            print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        if unmapped:
            # Printed EVERY run: a category we refuse to guess at must stay visible, or the
            # platform quietly shrinks and nobody knows why.
            print(f"  skipped (no canonical type, not guessed): "
                  + ", ".join(f"{k}×{v}" for k, v in sorted(unmapped.items(), key=lambda x: -x[1])))
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
