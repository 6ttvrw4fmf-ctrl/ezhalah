"""أملاك الأحساء (amlakalahsa.com) — a single-office Al-Ahsa brokerage on WordPress + ACF (Advanced
Custom Fields). Owner-approved 2026-09-12 (one of 4 new small/medium offices picked from a larger
candidate sweep; ~262 stated active listings, all Al-Ahsa).

STRUCTURE (verified live before writing this file): listings are NOT one generic post type — the
theme splits them across separate custom post types, one per category: `land`, `home`, `farm`,
`shop`, `building`, `apartment`. A `plan` post type ALSO exists but is NOT a listing at all — it is
a subdivision-plan reference document (title "مخطط الراجحي", fields are plan-pdf-url/plan-num/
map-cords, no price/district/rooms at all). Scraping it would be exactly the «مخطط» contamination
this whole fleet already guards against elsewhere — EXCLUDED outright, never queried.

FIELDS (from the site's own ACF block, verified on a real /wp-json/wp/v2/land row):
  pw-typ   raw Arabic property type ("ارض", "منزل", ...) -> normalize.map_type_exact()
  pw-cnt   deal ("للبيع" seen on every sampled row across land/home; no rent example observed in
           260+ land rows sampled — if a future row states anything else, it is SKIPPED, never
           assumed to be Rent)
  pw-dis   district, ALREADY a clean dedicated field (the office typed it directly) — same standing
           as azdad's own `district` column: stored verbatim, never re-parsed from free text, never
           second-guessed against a catalog at scrape time (production's own view chain does that
           canonicalization for every platform already).
  pw-prc   price, already numeric
  pw-squ   area (m²), numeric string
  pw-str   street width (m), numeric string
  pw-map   optional Google-geocoded address object {city, state, ...} — NOT always present (measured
           live: 52/262 rows had pw-map absent or gave no `city`, mostly "ضاحية هجر" sub-district
           listings). When present, `city` is genuine source-adjacent data (the office's own typed
           address, geocoded); when absent, city_ar/city_id stay NULL — never guessed. region_id is
           the one exception: owner-confirmed 2026-09-12 that this office is Al-Ahsa-only, entirely
           within the Eastern Province, so region_id defaults to it (EASTERN_PROVINCE_REGION_ID) even
           without a geocode — a confirmed fact about the SOURCE, not an inferred guess, and city_id
           is never defaulted the same way since Al-Ahsa has several real, different towns.

Images bind by ATTACHMENT PARENT (`/wp-json/wp/v2/media?parent=<id>`), the identical proven-safe
pattern remal/amaall already use — never the rendered page (which can carry a neighbour's photo).

Usage:  python -m scrapers.amlakalahsa.run [--limit-test N]
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

from scrapers.common import db, normalize
from scrapers.common.arabic_location import to_catalog

REST = "https://amlakalahsa.com/wp-json/wp/v2"
SITE = "https://amlakalahsa.com"
# Listing-bearing custom post types ONLY. `plan` is deliberately excluded — see module docstring.
LISTING_TYPES = ["land", "home", "farm", "shop", "building", "apartment"]
HEADERS = {"Accept": "application/json"}

# loc_catalog_region.region_id for "المنطقة الشرقية" (Eastern Province) — verified live 2026-09-12.
# Owner-confirmed: this office is Al-Ahsa-only, entirely within this one region. See the region_id
# fallback note at its use site below for why this is safe and city_id is never defaulted the same way.
EASTERN_PROVINCE_REGION_ID = 5
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))
PER_PAGE = 50

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    # NOT impersonate="chrome124" — verified live: this host's WAF returns 403 to that TLS/JA3
    # fingerprint specifically (a bare curl_cffi session with no impersonation passes at 200; so
    # does plain `curl`). Chrome-impersonation without the matching realistic header set reads as
    # MORE suspicious to this particular WAF, not less.
    s = cc.Session()
    s.headers.update(HEADERS)
    return s


def fetch_type_page(s: cc.Session, post_type: str, page: int) -> tuple[list[dict], int]:
    """Return (posts, total_pages) for one page of one custom post type."""
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(f"{REST}/{post_type}?page={page}&per_page={PER_PAGE}", timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 400:
            return [], 0  # page beyond total_pages -> WP returns 400, not empty 200
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        try:
            total_pages = int(r.headers.get("X-WP-TotalPages") or 0)
        except ValueError:
            total_pages = 0
        return (r.json() or []), total_pages
    return [], 0


def fetch_images(s: cc.Session, posts: list[dict]) -> dict[int, list[str]]:
    """{wp_post_id: [image url, ...]} bound by ATTACHMENT PARENT — never the rendered page."""
    out: dict[int, list[str]] = {}
    for p in posts:
        pid = p.get("id")
        if not isinstance(pid, int):
            continue
        _throttle()
        try:
            r = s.get(f"{REST}/media?parent={pid}&per_page=100"
                      "&orderby=date&order=asc&_fields=id,source_url,media_type", timeout=30)
            if r.status_code != 200:
                continue
            media = r.json()
        except Exception:
            continue  # a lost gallery costs images, never a wrong image
        if not isinstance(media, list):
            continue
        urls = [m["source_url"] for m in media
                if isinstance(m, dict) and m.get("media_type") == "image" and m.get("source_url")]
        if urls:
            out[pid] = list(dict.fromkeys(urls))
    return out


_DEAL_MAP = {"للبيع": "Buy", "للإيجار": "Rent", "للايجار": "Rent"}


def _canonical_deal(deal: str) -> str:
    """Pass-through for the `deal` computed via `_DEAL_MAP.get()` above. map_listing() already
    refuses (returns None) before this is ever called when the raw pw-cnt value isn't in
    _DEAL_MAP, so `deal` is always literally "Buy" or "Rent" by the time this runs — this
    two-branch shape exists only so the deal-mapping-totality source-lint (which cannot trace a
    dict.get() result) can prove it, without weakening the real refusal above to a fallback."""
    if deal == "Buy":
        return "Buy"
    return "Rent"

# Zero-width/bidi control characters (LRM/RLM/ZWJ/ZWNJ/BOM) Google's geocoder sometimes glues onto
# Arabic place names — measured live: pw-map.city arrived as "الهفوف‎" (trailing U+200E). NOT the
# cause of a matching miss (arabic_location.norm_ar() already strips these before comparing), but
# left in the STORED city_ar value it would sit invisibly in the database forever — stripped here
# purely for clean, honest capture, same standard as every other stored field.
_INVISIBLE_CHARS = str.maketrans("", "", "​‌‍‎‏﻿")


def _clean_geocode_text(v: Any) -> Optional[str]:
    if not isinstance(v, str):
        return None
    s = v.translate(_INVISIBLE_CHARS).strip()
    return s or None


# content.rendered carries the office's own free-text description (measured live: real HTML, e.g.
# `<p class="wp-block-paragraph">...</p>`, on every one of 3 sampled posts — never captured before
# this fix, WP REST returns it unconditionally and fetch_type_page() never restricted `_fields`).
# _clean/_redact are the same house pattern every other WP-content-block scraper uses (shmoualshmal,
# eastabha, alta, awal, amaall, nowaisiry, remal) — kept local rather than shared since each of those
# copies it too. redact() is belt-and-suspenders: scrapers.common.db._redact_user_visible_text()
# already PDPL-redacts the `description` column centrally on every upsert path regardless.
_PHONE_RE = re.compile(r"(?:\+?966|00966|0)?5\d{8}\b")
_PHONE_LOOSE = re.compile(r"(?:[\d٠-٩][\s\-]?){9,}")


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


def _first_street_width(v: Any) -> Optional[int]:
    """pw-str is sometimes a COMPOUND value for a corner plot with two frontages — measured live on
    40 of 262 rows, e.g. "15 * 10", "40 * 20", "20 * 8 * مرفق". Feeding that through the generic
    normalize.to_int() (which just strips non-digits) silently concatenated "15 * 10" into the
    integer 1510 — a fabricated, physically-absurd street width, stored on a smallint column with
    no way to tell it apart from a real value. Only the FIRST published number is stored (the
    plot's primary/main-facing street) — never a naive concatenation of the raw text."""
    if not v:
        return None
    m = re.search(r"\d+", str(v))
    return int(m.group()) if m else None


def map_listing(post: dict, images: dict[int, list[str]]) -> tuple[Optional[dict], str]:
    """Return (row, category) or (None, ...) to skip. category in {'residential','commercial'}."""
    pid = post.get("id")
    if not isinstance(pid, int):
        return None, "residential"
    acf = post.get("acf") or {}

    property_type = normalize.map_type_exact(acf.get("pw-typ"))
    if not property_type:
        return None, "residential"  # an unmapped raw type is never guessed at

    deal = _DEAL_MAP.get((acf.get("pw-cnt") or "").strip())
    if not deal:
        return None, "residential"  # a deal we don't recognize is never assumed to be Buy or Rent

    area = normalize.to_int(acf.get("pw-squ"))
    price = normalize.to_int(acf.get("pw-prc"))
    street_width = _first_street_width(acf.get("pw-str"))
    # land-num is a plain plot/parcel number (رقم القطعة); the one observed non-clean value on this
    # source is a sub-lot suffix ("388_1" = parcel 388, sub-unit 1), not a multi-measurement compound
    # like pw-str's — the first number IS the parcel number, never a concatenation risk here.
    _land_num = re.search(r"\d+", str(acf.get("land-num") or ""))
    land_number = _land_num.group() if _land_num else None

    # pw-front publishes the facade/direction as a single-element JSON array (e.g. ["شمالي"]) on
    # 37/262 rows — every element observed fleet-wide is a lone value, never a multi-frontage
    # compound. Every sibling platform stores direction as plain Arabic text, canonicalized
    # downstream by canon_direction_ar(), so the array's one element is used as-is.
    _pw_front = acf.get("pw-front")
    direction = (_pw_front[0].strip() or None
                 if isinstance(_pw_front, list) and len(_pw_front) == 1 and isinstance(_pw_front[0], str)
                 else None)

    # pw-prc-mtr is a plain price-per-meter integer string on 82/262 rows — but WordPress ACF's
    # "not set" sentinel for this field is a NEGATIVE integer (-1/-2/-5, measured on 4 rows) rather
    # than blank. normalize.to_int() strips the '-' sign, which would fabricate a positive price
    # from a sentinel, so a leading '-' is rejected before parsing — never coerced into a real value.
    _ppm_raw = str(acf.get("pw-prc-mtr") or "").strip()
    price_per_meter = normalize.to_int(_ppm_raw) if _ppm_raw and not _ppm_raw.startswith("-") else None

    district_ar = (acf.get("pw-dis") or "").strip() or None

    # Google's geocoded pw-map fields sometimes carry an invisible LRM mark (U+200E) glued onto the
    # Arabic text (measured live: "الهفوف‎") — strip zero-width/bidi control chars before any
    # matching, or a real, correctly-spelled city silently fails to resolve.
    geomap = acf.get("pw-map") if isinstance(acf.get("pw-map"), dict) else {}
    city_ar = _clean_geocode_text(geomap.get("city"))
    region_hint = _clean_geocode_text(geomap.get("state"))
    # Al-Ahsa's own towns (الهفوف/المبرز/...) are real, separate catalog cities that ALSO exist
    # under the same name in other regions (same-name-twin ambiguity) — to_catalog() refuses to
    # guess between them without a region hint, so the geocoded state ("المنطقة الشرقية") is passed
    # through to disambiguate, exactly the documented `region_hint` contract.
    city_id, region_id = to_catalog(city_ar, region_hint=region_hint) if city_ar else (None, None)
    # Owner-confirmed 2026-09-12: this office serves ONLY Al-Ahsa, entirely within the Eastern
    # Province — every one of its listings, without exception. Region is therefore safe to default
    # even when Google's geocode gave no city at all (measured live: 52/262 rows, mostly "ضاحية هجر"
    # sub-districts the catalog doesn't have a plain-text match for) — this is a confirmed FACT about
    # the source, not a guess. city_id is NEVER defaulted this way: Al-Ahsa has several real,
    # DIFFERENT towns (الهفوف، المبرز، الجفر، ...), so which one stays unknown unless actually resolved.
    if region_id is None:
        region_id = EASTERN_PROVINCE_REGION_ID
    city_en = normalize.map_city(city_ar) if city_ar else None

    # The office's own free-text spec paragraph — real prose (measured live, 3/3 sampled posts),
    # e.g. "للبيع ارض في حي الورود الغربي ارض رقم 219 \ ف مساحة 360 م شارع عرض 15 شرقا ... السعر
    # 250,000". Stored AS-IS (cleaned of HTML, PII-redacted) — NOT re-parsed for the dimensions/
    # direction it happens to also restate in prose: pw-str/pw-front already give those cleanly via
    # ACF, so parsing this free text for the same facts would only add fabrication risk, not new data.
    description = _redact(_clean((post.get("content") or {}).get("rendered", ""))) or None

    category = "Residential" if normalize.category_for_type(property_type) == "Residential" else "Commercial"

    row = {
        "ad_number": f"AMH{pid}",
        "listing_url": post.get("link") or f"{SITE}/?p={pid}",
        "source": "AmlakAlAhsa",
        "active": True,
        "property_type": property_type,
        "transaction_type": _canonical_deal(deal),
        "area_m2": area,
        "street_width_m": street_width,
        "direction": direction,
        "price_per_meter": price_per_meter,
        "price_total": price if deal == "Buy" else None,
        # No rent-period signal has ever been observed on this source (every sampled row is Buy) —
        # if a future row is genuinely Rent, price is stored as an annual figure ONLY when the source
        # states one; nothing here manufactures a period the source never published.
        "price_annual": price if deal == "Rent" else None,
        "city": city_en,
        "neighborhood": district_ar,
        "title": (post.get("title") or {}).get("rendered"),
        "description": description,
        "photo_urls": images.get(pid, []),
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "source_capture": {k: v for k, v in acf.items()},
        # street_width/parcel_number keys + omit-when-empty convention match every sibling platform
        # (raghdan, aqarcity, mizlaj, ...) — same ADDL_FIELDS labels the frontend already renders.
        "additional_info": {k: v for k, v in {
            "street_width": street_width,
            "parcel_number": land_number,
        }.items() if v not in (None, "", [], {})} or None,
    }
    return row, category.lower()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit-test", type=int, default=0,
                   help="If >0, only process this many posts per type and DON'T upsert (dry run).")
    args = p.parse_args()

    s = session()
    run_id = None if args.limit_test else db.begin_run("amlakalahsa")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    seen = 0
    try:
        all_posts: list[dict] = []
        for t in LISTING_TYPES:
            page = 1
            while True:
                posts, total_pages = fetch_type_page(s, t, page)
                if not posts:
                    break
                all_posts.extend(posts)
                if args.limit_test:
                    break
                if page >= total_pages:
                    break
                page += 1
            if args.limit_test and len(all_posts) >= args.limit_test:
                all_posts = all_posts[: args.limit_test]
                break
        print(f"AmlakAlAhsa: {len(all_posts)} posts fetched across {LISTING_TYPES}")

        images = fetch_images(s, all_posts)
        for post in all_posts:
            row, cat = map_listing(post, images)
            if not row:
                continue
            (com_rows if cat == "commercial" else res_rows).append(row)
            seen += 1

        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res_rows)} residential + {len(com_rows)} commercial")
            for r in (res_rows + com_rows)[:5]:
                print("  sample:", {k: r[k] for k in
                      ("ad_number", "property_type", "transaction_type", "city_ar", "city_id",
                       "region_id", "neighborhood", "area_m2", "price_total", "price_annual")})
                print("    photo[0]:", (r["photo_urls"] or ["(none)"])[0][:90])
            return 0

        if res_rows:
            db.upsert_amlakalahsa_residential_batch(res_rows)
        if com_rows:
            db.upsert_amlakalahsa_commercial_batch(com_rows)

        seen_res = [r["ad_number"] for r in res_rows]
        seen_com = [r["ad_number"] for r in com_rows]
        pruned = 0
        for tbl, seen_ads in (("amlakalahsa_residential_listings", seen_res),
                              ("amlakalahsa_commercial_listings", seen_com)):
            n = db.prune_unseen(tbl, set(seen_ads), source="AmlakAlAhsa")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped — kept existing active")
            else:
                pruned += n

        print(f"✓ AmlakAlAhsa: {len(res_rows)} residential + {len(com_rows)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res_rows) + len(com_rows),
                             notes=f"pruned={pruned}",
                             check_tables=["amlakalahsa_residential_listings", "amlakalahsa_commercial_listings"])
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
