"""ألتا للخدمات العقارية — alta.com.sa (WordPress, WPResidence-style estate_property post type).

SOURCE SHAPE (probed live 2026-09-05, before a line of this was written):
  · /wp-json/wp/v2/estate_property returns the full set as JSON. 17 posts at audit time.
  · Taxonomies (property_category, property_action_category, property_city, property_area,
    property_status, property_features) all resolve over REST on this host, so the ID→name maps
    are FETCHED per run, never hardcoded — a frozen map rots the first time they add a city.

MOST OF THIS SITE IS ALREADY SOLD, AND WE SAY SO.
  property_status carries تم البيع (sold), تم التأجير (rented) and غير متاح (unavailable) alongside
  متاح (available). 10 of the 17 posts audited on 2026-09-05 were in one of the first three. They
  are still ingested — with active=false — because deleting them would lose the fact that the
  source published them; hiding them from search is what `active` is for. A post with NO status
  term is treated as active: the source states no unavailability, and UNKNOWN MUST NOT HARDEN INTO
  a claim it is gone (the same tri-state law the rest of the pipeline obeys).

PRICE IS PUBLISHED FOR ALMOST NOTHING, AND THAT IS A SOURCE FACT.
  Exactly 1 of 17 posts states a figure, in its own body text («السعر: 600,000 ريال»). The other 16
  state none, so their price columns stay NULL — never inferred, never carried over from a sibling,
  never back-computed from area (PRICE = SOURCE).

  THE TRAP THIS FILE EXISTS TO AVOID: the rendered detail page has FIVE elements with a `price`
  class, because it also renders a "related properties" block. Reading the page's first
  `listing_price` would bind ANOTHER listing's figure to this one — a listing-fidelity breach that
  looks perfectly plausible in the data. So the price is read ONLY from this post's own
  `content.rendered`, where the binding is unambiguous, and never from the shared page chrome.

«طلب جاد» IS NOT INVENTORY. It appears as both a category (274) and an action (275) and means a
  WANTED ad — someone looking to buy. Ingesting it would advertise a request as a property.
  Excluded outright.
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

BASE = "https://alta.com.sa"
REST = f"{BASE}/wp-json/wp/v2"
SOURCE = "Alta"
LAST_FETCH_NOTE = ""
PREFIX = "ALT"

TAXONOMIES = ("property_category", "property_action_category", "property_city",
              "property_area", "property_status", "property_features")

# Statuses that mean "no longer on the market". Everything else (including no status at all) is
# active — absence of a sold marker is not evidence of a sale.
GONE_STATUSES = ("تم البيع", "تم التأجير", "غير متاح")
# A wanted-ad, not inventory. Matched on the term NAME so a renumbered term still gets caught.
WANTED_AD = "طلب جاد"

# alta names its categories in the PLURAL, which the house taxonomy (singular) does not carry.
# Only unambiguous plurals of a term the house map already knows are listed here — each is the
# plain plural of one singular with exactly one canonical type:
#   أراضي→أرض, احواش→حوش, فلل→فيلا, فنادق→فندق, مزارع→مزرعة, عمائر/أبراج→عمارة.
#
# FUZZY MATCHING IS DELIBERATELY NOT USED ON THIS SOURCE. normalize.map_type("محلات ومعارض")
# returns "Residential Land" — a shops-and-showrooms bucket silently filed as land. Verified
# 2026-09-05. An exact map plus a hard skip is the only safe treatment.
TYPE_OVERRIDES = {
    "أراضي": "Residential Land",
    "احواش": "Villa",              # the house map already reads حوش as Villa
    "فلل": "Villa",
    "فنادق": "Hotel",
    "مزارع": "Farm",
    "عمائر وأبراج": "Building",
}

# Categories we refuse to map rather than guess at. Two of them are COMBINED buckets covering two
# different canonical types (محل→Shop vs معرض→Showroom; شاليه→Chalet vs استراحة→Rest House), so
# either choice would be a coin flip stored as fact. The other two have no canonical type at all.
# Listings in these categories are skipped and counted, and the count is printed every run so the
# gap stays visible instead of silently shrinking the platform.
TYPE_UNMAPPABLE = ("محلات ومعارض", "شاليهات واستراحات", "مخططات", "مستشفى")

# Price/area/bedrooms as this site writes them, read ONLY from the post's own body.
PRICE_RE = re.compile(r"السعر\s*[:：]?\s*([\d][\d,\.]{2,})")
AREA_RE = re.compile(r"المساح[ةه]\s*[:：]?\s*([\d][\d,\.]*)")
BEDS_RE = re.compile(r"([\d]{1,2})\s*غرف?\s*نوم")
BATHS_RE = re.compile(r"([\d]{1,2})\s*دورات?\s*(?:مياه|مياة)")

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
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", _PHONE_RE.sub(" ", text))
    t = re.sub(r"_?للتواصل[^_\n]*", " ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip() or None


def fetch_taxonomies(s: cc.Session) -> dict[str, dict[int, str]]:
    out: dict[str, dict[int, str]] = {}
    for tax in TAXONOMIES:
        try:
            r = s.get(f"{REST}/{tax}?per_page=100", timeout=30)
            if r.status_code != 200:
                continue
            terms = r.json()
        except Exception:
            continue
        if isinstance(terms, list):
            out[tax] = {t["id"]: t.get("name") for t in terms
                        if isinstance(t, dict) and isinstance(t.get("id"), int)}
    return out


def fetch_images(s: cc.Session, posts: list[dict]) -> dict[int, list[str]]:
    """{wp_post_id: [full-size image URL, ...]}, featured image FIRST.

    alta exposes no property_meta over REST, so the gallery is read the way WordPress itself models
    attachment ownership: /wp/v2/media?parent=<post_id>. That binding is the whole point — the
    attachment's OWN parent field, not proximity on a rendered page.

    THIS IS THE TRAP THIS FUNCTION EXISTS TO AVOID, and it is the same one that nearly bound the
    wrong PRICE on this source. alta's detail page renders a "related properties" block, so the
    page's image gallery contains OTHER listings' photos. Scraping images off the HTML would put a
    neighbouring property's facade on this card — a listing-fidelity breach that looks perfectly
    plausible in the data. `parent=` cannot make that mistake: an attachment has exactly one parent.
    Verified 2026-09-05: post 25759 -> 23 attachments, 24870 -> 27, 24864 -> 1. Distinct sets.

    featured_media names the image the site itself leads with, so it is hoisted to the front; the
    rest follow in the order WordPress returns them. The first url is the card thumbnail.

    Failure degrades to fewer images, never to a wrong one: a listing whose attachments cannot be
    read keeps an EMPTY list rather than inheriting anything.
    """
    out: dict[int, list[str]] = {}
    for p in posts:
        pid = p.get("id")
        if not isinstance(pid, int):
            continue
        try:
            r = s.get(f"{REST}/media?parent={pid}&per_page=100", timeout=40)
            if r.status_code != 200:
                continue
            media = r.json()
        except Exception:
            continue                    # a lost gallery costs images, never a wrong image
        if not isinstance(media, list):
            continue
        urls: list[str] = []
        featured = p.get("featured_media")
        for m in media:
            if isinstance(m, dict) and m.get("source_url"):
                if isinstance(featured, int) and m.get("id") == featured:
                    urls.insert(0, m["source_url"])     # the image the SITE leads with
                else:
                    urls.append(m["source_url"])
        if urls:
            out[pid] = list(dict.fromkeys(urls))        # de-dupe, preserve order
    return out


def fetch_listings(s: cc.Session) -> list[dict]:
    out: list[dict] = []
    # Records WHY enumeration stopped. A timeout, a 403 and a genuinely empty source are three
    # different incidents; collapsing them into "no listings" sent the first CI run chasing a
    # dead source that was actually fine (2026-09-05).
    global LAST_FETCH_NOTE
    LAST_FETCH_NOTE = "no pages attempted"
    for page in range(1, 30):
        try:
            r = s.get(f"{REST}/estate_property?per_page=100&page={page}", timeout=40)
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
            break                       # unparseable body ends enumeration, never loops
        if not isinstance(batch, list) or not batch:
            LAST_FETCH_NOTE = f"page {page} returned an empty list (end of source)"
            break
        out.extend(x for x in batch if isinstance(x, dict))
        if len(batch) < 100:
            break
    return out


def map_listing(p: dict, tax: dict[str, dict[int, str]],
                images: Optional[dict[int, list[str]]] = None) -> tuple[Optional[dict], str]:
    link = p.get("link")
    if not link:
        return None, "residential"

    def terms(key: str) -> list[str]:
        names = tax.get(key) or {}
        return [n for n in (names.get(i) for i in (p.get(key) or [])) if n]

    cats = terms("property_category")
    actions = terms("property_action_category")
    if any(WANTED_AD in x for x in cats + actions):
        return None, "residential"      # a request to buy, not a property on offer

    # ── transaction from the site's OWN action taxonomy ──
    is_rent = any("إيجار" in a or "ايجار" in a for a in actions)
    is_buy = any("بيع" in a or "استثمار" in a for a in actions)
    if not (is_rent or is_buy):
        return None, "residential"

    # EXACT ONLY (+ the vetted plural overrides). No fuzzy fallback — see TYPE_OVERRIDES.
    raw_type = next((c for c in cats
                     if WANTED_AD not in c and c not in TYPE_UNMAPPABLE
                     and (c in TYPE_OVERRIDES or normalize.map_type_exact(c))), None)
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

    statuses = terms("property_status")
    gone = any(g in st for st in statuses for g in GONE_STATUSES)

    # ── facts from THIS post's own body only — never the shared page chrome (see docstring) ──
    body = _clean((p.get("content") or {}).get("rendered", ""))
    m = PRICE_RE.search(body)
    price = normalize.to_int(m.group(1)) if m else None
    m = AREA_RE.search(body)
    area = normalize.to_int_numeric(m.group(1)) if m else None
    m = BEDS_RE.search(body)
    beds = normalize.to_int(m.group(1)) if m else None
    m = BATHS_RE.search(body)
    baths = normalize.to_int(m.group(1)) if m else None

    # PERIOD = SOURCE: only the source's own token may set it. No token → NULL, never 'annual'.
    rent_period, price_annual = (None, None)
    if is_rent:
        rent_period, price_annual = normalize.rent_period_and_annual(price, body)

    title = _clean((p.get("title") or {}).get("rendered", ""))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{int(hashlib.md5((p.get('slug') or str(p.get('id'))).encode()).hexdigest()[:12], 16)}",
        "listing_url": link,
        "source": SOURCE,
        "active": not gone,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": beds,
        "bathrooms": baths,
        "price_total": None if is_rent else price,
        "price_annual": price_annual,
        "price_per_meter": None,        # never derived from price/area — that is a calculation
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district,
        "rega_location_verified": False,
        "title": title,
        "description": _redact(body),
        "photo_urls": (images or {}).get(p.get("id"), []),
        "additional_info": {},
    }

    info = {
        "city_ar": raw_city,
        "district_ar": district,
        "type_ar": raw_type,
        "categories_ar": cats or None,
        "actions_ar": actions or None,
        "status_ar": statuses or None,
        "features_ar": terms("property_features") or None,
        "wp_id": p.get("id"),
        "slug": p.get("slug") or None,
        "price_published": bool(price),
    }
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    return row, category


def _pin_sold_inactive(table: str, ad_numbers: list[str]) -> None:
    """Make source-confirmed sold/rented rows survive the nightly auto_recover_false_inactive().

    OBSERVED HERE, NOT THEORISED (2026-09-05): the first successful run landed at 05:20 UTC —
    the exact minute that pg_cron job fires — and all 9 rows whose own status_ar said تم البيع /
    غير متاح came back active=true, missing_count=0. The job re-activates any active=false row
    with coalesce(missing_count,0)=0 and a fresh last_seen_at, and the shared batch upsert
    (db._wasalt_batch) unconditionally writes missing_count=0 for every row it touches. So the
    honest active=false this scraper computes is erased moments after it is written.

    Same remedy awal uses: AFTER the batch upsert, pin sold rows to missing_count=3 (the prune
    3-strike threshold) + active=false. prune_unseen() never undoes this — it only selects
    active=true rows. When a listing is genuinely relisted, its next upsert carries active=true
    and the upsert's own missing_count=0 reset applies, so the pin only ever describes rows the
    source calls sold on THIS crawl.
    """
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
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    run_id = None if args.limit else db.begin_run("alta")
    res: list[dict] = []
    com: list[dict] = []
    sold_res: list[str] = []
    sold_com: list[str] = []
    gone_ct = 0
    try:
        tax = fetch_taxonomies(s)
        posts = fetch_listings(s)
        images = fetch_images(s, posts) if posts else {}
        if not posts:
            raise RuntimeError(f"REST returned no listings — {LAST_FETCH_NOTE}")
        if args.limit:
            posts = posts[: args.limit]
        print(f"{SOURCE}: {len(posts)} posts from WP REST"
              f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

        unmapped: dict[str, int] = {}
        for p in posts:
            row, cat = map_listing(p, tax, images)
            if not row:
                names = tax.get('property_category') or {}
                for tid in (p.get('property_category') or []):
                    n = names.get(tid)
                    if n:
                        unmapped[n] = unmapped.get(n, 0) + 1
                continue
            if not row["active"]:
                gone_ct += 1
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if not row["active"]:
                (sold_com if cat == "commercial" else sold_res).append(row["ad_number"])

        if res:
            db.upsert_alta_residential_batch(res)
        if com:
            db.upsert_alta_commercial_batch(com)
        # Immediately after the upsert (which reset missing_count to 0) — see _pin_sold_inactive.
        if sold_res:
            _pin_sold_inactive("alta_residential_listings", sold_res)
        if sold_com:
            _pin_sold_inactive("alta_commercial_listings", sold_com)

        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"({gone_ct} sold/rented → active=false) (no prune)")
            for r in (res + com)[:10]:
                print(f"   {r['ad_number']} act={str(r['active']):5s} {r['transaction_type']:5s} "
                      f"{str(r['property_type']):10s} {str(r['city']):14s} "
                      f"{str(r['area_m2']):>7}m² price={r['price_total']}")
        else:
            n = len(res) + len(com)
            # end_run returns the EFFECTIVE ok it actually wrote: its RC-B guard can demote a run
            # that looks successful but wrote nothing real. Fail CI on a demotion rather than
            # reporting a silent success (the same check awal makes).
            healthy = db.end_run(run_id, ok=True, rows_seen=n, rows_upserted=n,
                                 check_tables=["alta_residential_listings",
                                               "alta_commercial_listings"])
            if not healthy:
                print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI "
                      "instead of reporting a silent success.", flush=True)
                return 1
            print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted "
                  f"({gone_ct} sold/rented)")
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
