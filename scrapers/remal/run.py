"""رمال العقارية — remalre.com (WordPress, custom `estate` post type).

SOURCE SHAPE (probed live 2026-09-06, before a line of this was written):
  · /wp-json/wp/v2/estate returns the full set as JSON — 87 posts, X-WP-Total 87.
  · There are NO English duplicate posts (0 links under /en/), unlike amaall. Every post is one
    listing.
  · The post carries NO meta and NO taxonomy arrays. Everything structured lives in `class_list`:
    city-<slug>, property-type-<slug>, offer-type-<slug>, neighborhood-<id>, street-<id>.

IMAGES COME FROM ATTACHMENT PARENTAGE, NEVER THE PAGE. Measured: the detail page carries ~33 image
URLs, and TWO DIFFERENT listings share several of them (أرض-الحمراء-السيلاني…, تلال.png) because the
page renders a block of OTHER listings (`mh-estate-vertical`, each with its own city/neighborhood
attributes). Scraping the page would put a neighbour's photo on this card — the same
listing-fidelity breach alta's price nearly hit. /wp/v2/media?parent=<post id> cannot make that
mistake: an attachment has exactly one parent. Verified distinct per post (1, 1, 1, 2, 0).

PRICE IS ALMOST NEVER PUBLISHED IN THIS REST FIELD — but IS on the rendered page, unresolved.
Measured across all 87 posts: only 5 state a figure anywhere in title/content.rendered — yet the
live PAGE for one of those "priceless" posts (id 6593) shows «1,800,000 ريال» in plain text
(confirmed 2026-09-11). The price is real and published; it just is not in the REST `content` field
this scraper reads — WordPress is rendering it into the page template from somewhere REST does not
expose (no `property_meta`/custom-field object exists on this post type at all, unlike amaall).
Recovering it would mean fetching each listing's live page and extracting price from WITHIN the
single listing's own container — the same "عقارات ذات صلة" related-listings block that forced the
image fix onto attachment-parentage (see below) also puts 3-4 OTHER listings' prices on that same
page, so a page-scrape here needs identical care against grabbing a neighbour's price. Not built
yet — flagged for a deliberate follow-up, not attempted quickly. price_total stays NULL until then;
never inferred, never derived from area (PRICE = SOURCE).

AREA — widened 2026-09-11 after the SAME discovery (real area text was being written, missed only
by the regex). The source uses «المساحة/900م2» (slash, no space) and «مساحات 600م2» (plural) as
often as the plain «مساحة: N» form the original regex caught — measured: 29/87 → 52/87 posts now
yield a real area with no change to WHAT counts as a match, only broadened separator/plural
handling. featured_media is 0 on every post, so there is no price image either.

DISTRICT — class_list's `neighborhood-248` / `street-384` are raw term IDs, and this site exposes no
taxonomy REST endpoint that resolves them (only category/post_tag/nav_menu exist; confirmed live
2026-09-11) — the ids are kept in additional_info so a future run can resolve them if the endpoint
ever appears, but they are never the district's source today.

Corrected 2026-09-11 (owner-caught: several of these titles plainly state a real district, e.g.
"في الكعكية بمكة المكرمة", "بالرصيفة", "بالشوقية"). The title/content free text DOES state a real
district often enough to recognize safely — via find_district_in_text() (scrapers/common/
arabic_location.py), which accepts a candidate ONLY when it exact-matches this city's own curated
district catalog, so a subdivision-plan mention ("مخطط الربوة", "مخطط تلال مكة") or a housing-program
name ("الاسكان العام") is never mistaken for a district no matter how often it sits next to one.
Titles that name only a مخطط, or nothing recognizable at all, still leave neighborhood NULL — never
invented, exactly as the original design here intended; only the SOURCE of "recognized vs. not" text
changed, not the standing rule against guessing.
"""
from __future__ import annotations

import argparse
import hashlib
import html as ihtml
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://www.remalre.com"
REST = f"{BASE}/wp-json/wp/v2"
SOURCE = "Remal"
PREFIX = "RML"
LAST_FETCH_NOTE = ""

# class_list slugs → canonical type. Each is a plain plural (or, for `appartments`, the site's own
# consistent misspelling) of one singular the house map already knows, so there is exactly one
# canonical answer. EXACT ONLY — no fuzzy fallback: normalize.map_type() mis-files combined and
# unfamiliar Arabic/English category names (proven on alta, where "محلات ومعارض" fuzzed to
# "Residential Land"), and a wrong type is invisible in review.
TYPE_SLUG = {
    "lands": "Residential Land",   # the house map reads a bare أرض as Residential Land
    "villas": "Villa",
    "appartments": "Apartment",    # sic — the site's own spelling, used consistently
    "offices": "Office",
    "building": "Building",
    "farm": "Farm",
}

# city slug → the name the shared resolver understands. Only the two the site actually uses.
CITY_SLUG = {
    "makkah-moukarma": "مكة المكرمة",
    "jeddah": "جدة",
}

# offer-type slug → transaction. `for-investment` is read as a SALE, matching the precedent alta
# already set for «استثمار» in its action taxonomy — an investment offer is an offer to buy the
# asset. `commercial` is NOT a transaction (it is a category the site mis-filed here) and is
# refused rather than guessed at.
OFFER_BUY = ("for-sell", "for-investment")
OFFER_RENT = ("for-rent",)

# A handful of posts carry a raw term ID where a slug belongs (property-type-357, city-364,
# city-348) — the site's own broken rows. They are skipped and COUNTED, never guessed at.
_NUMERIC_SLUG = re.compile(r"^\d+$")

PRICE_RE = re.compile(r"(?:السعر|بسعر|المطلوب)\s*[:：]?\s*([\d][\d,\.]{2,})")
PRICE_LOOSE = re.compile(r"([\d][\d,\.]{5,})\s*(?:ريال|ر\.س)")
# AREA — widened 2026-09-11 (confirmed live against real posts, id 6593/6544/6532): the source
# writes «المساحة/900م2» (slash, no space), «مساحات 600م2» (PLURAL, no separator at all) and
# «مساحة/ 888م2» just as often as the plain «مساحة: N» the old pattern only caught — all three real
# posts had a genuine area sitting in content.rendered that this regex simply never matched.
# (?:ة|ه|ات) covers مساحة/مساحه/مساحات; [:：/]* between label and number covers colon, slash, or
# nothing at all; ONLY the number is captured, so the area value itself is unaffected.
AREA_RE = re.compile(r"(?:ال)?مساح(?:ة|ه|ات)\s*[:：/]*\s*([\d][\d,\.]*)")
BEDS_RE = re.compile(r"([\d]{1,2})\s*غرف?\s*(?:نوم)?")

_PHONE_RE = re.compile(r"(?:\+?966|00966|0)?5\d{8}\b")
_PHONE_LOOSE = re.compile(r"(?:[\d٠-٩][\s\-]?){9,}")


def session() -> cc.Session:
    """Impersonating session, routed through the Saudi residential proxy when configured — the
    GitHub runner's datacenter IP is blocked by several of these hosts (measured on alta, where
    six taxonomy requests burned 3m40s before reporting a source that was never down)."""
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
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", _PHONE_RE.sub(" ", text))
    t = re.sub(r"_?للتواصل[^_\n]*", " ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip() or None


def _classes(p: dict, prefix: str) -> list[str]:
    return [c[len(prefix):] for c in (p.get("class_list") or []) if c.startswith(prefix)]


def fetch_listings(s: cc.Session) -> list[dict]:
    """Every estate post. An unparseable body ends enumeration and records WHY — a timeout, a 403
    and a genuinely empty source are three different incidents and must not read alike."""
    global LAST_FETCH_NOTE
    LAST_FETCH_NOTE = "no pages attempted"
    out: list[dict] = []
    for page in range(1, 30):
        try:
            r = s.get(f"{REST}/estate?per_page=100&page={page}", timeout=40)
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
            break
        if not isinstance(batch, list) or not batch:
            LAST_FETCH_NOTE = f"page {page} returned an empty list (end of source)"
            break
        out.extend(x for x in batch if isinstance(x, dict))
        if len(batch) < 100:
            break
    return out


def fetch_images(s: Optional[cc.Session], posts: list[dict]) -> dict[int, list[str]]:
    """{wp_post_id: [full-size image url, ...]} bound by ATTACHMENT PARENT — see the module
    docstring for why the rendered page must not be used. media_type is filtered to images so a
    video attachment can never be stored as a photo (the defect sadin shipped)."""
    out: dict[int, list[str]] = {}
    if s is None:
        return out
    for p in posts:
        pid = p.get("id")
        if not isinstance(pid, int):
            continue
        try:
            r = s.get(f"{REST}/media?parent={pid}&per_page=100"
                      "&orderby=date&order=asc&_fields=id,source_url,media_type", timeout=40)
            if r.status_code != 200:
                continue
            media = r.json()
        except Exception:
            continue                    # a lost gallery costs images, never a wrong image
        if not isinstance(media, list):
            continue
        urls = [m["source_url"] for m in media
                if isinstance(m, dict) and m.get("media_type") == "image" and m.get("source_url")]
        if urls:
            out[pid] = list(dict.fromkeys(urls))   # de-dupe, preserve the source's order
    return out


def map_listing(p: dict, images: Optional[dict[int, list[str]]] = None) -> tuple[Optional[dict], str]:
    link = p.get("link")
    if not link:
        return None, "residential"

    offers = _classes(p, "offer-type-")
    is_rent = any(o in OFFER_RENT for o in offers)
    is_buy = any(o in OFFER_BUY for o in offers)
    if not (is_rent or is_buy):
        return None, "residential"      # no stated transaction (or the mis-filed `commercial`)

    raw_type = next((t for t in _classes(p, "property-type-")
                     if not _NUMERIC_SLUG.match(t) and t in TYPE_SLUG), None)
    if raw_type is None:
        return None, "residential"
    property_type = TYPE_SLUG[raw_type]
    category = normalize.category_for_type(property_type).lower()

    raw_city = next((c for c in _classes(p, "city-")
                     if not _NUMERIC_SLUG.match(c) and c in CITY_SLUG), None)
    city_ar = CITY_SLUG.get(raw_city) if raw_city else None
    city = normalize.map_city(city_ar) if city_ar else None
    region = normalize.region_for_city(city)
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)

    title = _clean((p.get("title") or {}).get("rendered", ""))
    body = _clean((p.get("content") or {}).get("rendered", ""))
    text = f"{title} {body}"

    # DISTRICT (2026-09-11) — class_list's `neighborhood-<id>` is still unresolvable (no taxonomy
    # endpoint, see the module docstring), but the title/content free text plainly states a real
    # district often enough to be worth recognizing SAFELY: find_district_in_text() accepts a
    # candidate ONLY when it exact-matches this city's own curated loc_catalog_district entry,
    # never a subdivision-plan name ("مخطط الربوة") or a housing-program name ("الاسكان العام") that
    # merely sits next to a real place in the same sentence. Confirmed live 2026-09-11 against
    # Mecca's catalog: "الرصيفة"/"الخالدية"/"الشوقية"/"العوالي"/"الكعكية" are real districts and
    # match; "الربوة"/"تلال مكة"/"الصفوة"/"الزايدي" are plan names only and correctly do not.
    district_ar = find_district_in_text(text, city_id)

    m = PRICE_RE.search(text) or PRICE_LOOSE.search(text)
    price = normalize.to_int(m.group(1)) if m else None
    m = AREA_RE.search(text)
    area = normalize.to_int_numeric(m.group(1)) if m else None
    m = BEDS_RE.search(text)
    beds = normalize.to_int(m.group(1)) if m else None

    # PERIOD = SOURCE: only the source's own token may set it; no token → NULL, never 'annual'.
    rent_period, price_annual = (None, None)
    if is_rent:
        rent_period, price_annual = normalize.rent_period_and_annual(price, text)

    info = {
        "city_slug": raw_city,
        "type_slug": raw_type,
        "offer_slugs": offers or None,
        # class_list's own ids are still kept raw for audit — this site exposes no endpoint that
        # resolves THEM specifically. The listing's district (when recognized) comes instead from
        # find_district_in_text() above, catalog-verified, never from these numeric ids.
        "neighborhood_ids": _classes(p, "neighborhood-") or None,
        "street_ids": _classes(p, "street-") or None,
        "wp_id": p.get("id"),
        "slug": p.get("slug") or None,
        "price_published": bool(price),
    }

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{int(hashlib.md5((p.get('slug') or str(p.get('id'))).encode()).hexdigest()[:12], 16)}",
        "listing_url": link,
        "source": SOURCE,
        "active": True,                 # this source publishes no sold/rented marker
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": beds,
        "bathrooms": None,
        "price_total": None if is_rent else price,
        "price_annual": price_annual,
        "price_per_meter": None,        # never derived — that is a calculation
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district_ar,
        # Arabic-native shadow (same pattern amaall/azdad/abwbna/alobid/bahadhabab carry) — lets
        # listing_native_location_v1 (the resolver every exact-district search actually reads) see
        # this listing's city+district natively, instead of falling through to a broad-city-only path.
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "rega_location_verified": False,
        "title": title,
        "description": _redact(body),
        "photo_urls": (images or {}).get(p.get("id"), []),
        "additional_info": {k: v for k, v in info.items() if v not in (None, "", [], {})},
    }
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    run_id = None if args.limit else db.begin_run("remal")
    res: list[dict] = []
    com: list[dict] = []
    try:
        posts = fetch_listings(s)
        if not posts:
            raise RuntimeError(f"REST returned no listings — {LAST_FETCH_NOTE}")
        if args.limit:
            posts = posts[: args.limit]
        images = fetch_images(s, posts)
        print(f"{SOURCE}: {len(posts)} posts from WP REST"
              f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

        skipped: dict[str, int] = {}
        for p in posts:
            row, cat = map_listing(p, images)
            if not row:
                for t in _classes(p, "property-type-"):
                    skipped[t] = skipped.get(t, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        if res:
            db.upsert_remal_residential_batch(res)
        if com:
            db.upsert_remal_commercial_batch(com)

        if skipped:
            # Printed EVERY run: a slug we refuse to guess at must stay visible, or the platform
            # quietly shrinks and nobody knows why.
            print("  skipped (unmapped/broken type slug, not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))

        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (no prune)")
            for r in (res + com)[:8]:
                print(f"   {r['ad_number']} {r['transaction_type']:5s} {str(r['property_type']):17s} "
                      f"{str(r['city']):10s} {str(r['area_m2']):>7} px={r['price_total']} "
                      f"imgs={len(r['photo_urls'])}")
        else:
            n = len(res) + len(com)
            healthy = db.end_run(run_id, ok=True, rows_seen=n, rows_upserted=n,
                                 check_tables=["remal_residential_listings",
                                               "remal_commercial_listings"])
            if not healthy:
                print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI "
                      "instead of reporting a silent success.", flush=True)
                return 1
            print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
