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
import time
import html as ihtml
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402

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


def fetch_images(s: cc.Session, posts: list[dict]) -> dict[int, list[str]]:
    """{wp_post_id: [full-size image URL, ...]} in the SOURCE'S OWN GALLERY ORDER.

    Houzez stores the gallery as attachment IDs in `fave_property_images` (a comma-joined string
    or a list, depending on how WP serialised it), with the first entry also mirrored in
    `featured_media` / `_thumbnail_id`. Those IDs are resolved to URLs in BULK through
    /wp/v2/media?include=... — one request per 100 attachments instead of one per image.

    ORDER IS NOT COSMETIC AND THE ENDPOINT DOES NOT PRESERVE IT. Verified 2026-09-05: requesting
    include=18747,18739,18741 returns [18747, 18741, 18739]. The FIRST url in photo_urls is what a
    result card renders as its thumbnail, so the ids are re-sorted back into the source's order
    after the fetch. Taking the response order would silently show a bathroom where the site shows
    the facade.

    Failure is degradation, never invention: any id that does not resolve is dropped, and a listing
    whose gallery cannot be read keeps an EMPTY list rather than borrowing another listing's photo.
    """
    want: dict[int, list[int]] = {}
    for p in posts:
        pid = p.get("id")
        if not isinstance(pid, int):
            continue
        # NOT _meta1 HERE, AND THE DIFFERENCE IS THE WHOLE GALLERY. _meta1 unwraps a list to its
        # FIRST element, which is right for the single-value meta WP wraps in a 1-element list
        # (fave_property_size, fave_property_bedrooms…). fave_property_images is a genuine
        # MULTI-value meta: ['18741','18739','18747','18746','18743',…]. Passing it through _meta1
        # silently yielded one photo per listing instead of five — the card still looked fine,
        # which is exactly why it needed catching here rather than by eye. (2026-09-05)
        raw = (p.get("property_meta") or {}).get("fave_property_images")
        ids: list[int] = []
        if isinstance(raw, str):
            ids = [int(x) for x in re.findall(r"\d+", raw)]
        elif isinstance(raw, list):
            for x in raw:
                ids += [int(y) for y in re.findall(r"\d+", str(x))]
        # featured_media is the gallery's first image; keep it first even if the meta omits it.
        fm = p.get("featured_media")
        if isinstance(fm, int) and fm > 0 and fm not in ids:
            ids.insert(0, fm)
        if ids:
            # de-dupe while PRESERVING first-seen order
            want[pid] = list(dict.fromkeys(ids))

    all_ids = sorted({i for ids in want.values() for i in ids})
    # Keep the attachment's PARENT alongside its url. The gallery meta is just a list of integers —
    # if it ever references an attachment owned by another post (a theme bug, an editor mistake, a
    # cloned draft), resolving blindly would put ANOTHER property's photo on this card. alta guards
    # this by construction (it queries media?parent=); here the meta chooses the ids, so the parent
    # must be checked explicitly on the way back. Found by adversarial review of this recipe, not
    # by a failure — 62/62 attachments currently parent correctly, and this keeps it that way.
    media_by_id: dict[int, tuple[str, Any]] = {}
    for i in range(0, len(all_ids), 100):
        chunk = all_ids[i:i + 100]
        try:
            r = s.get(f"{REST}/media?include={','.join(map(str, chunk))}"
                      f"&per_page=100&_fields=id,post,source_url", timeout=40)
            if r.status_code != 200:
                continue
            for m in r.json():
                if isinstance(m, dict) and m.get("source_url"):
                    media_by_id[m["id"]] = (m["source_url"], m.get("post"))
        except Exception:
            continue                    # a lost chunk costs images, never a wrong image

    out: dict[int, list[str]] = {}
    for pid, ids in want.items():
        urls: list[str] = []
        for i in ids:
            got = media_by_id.get(i)
            if not got:
                continue
            url, parent = got
            # bind or drop: a missing/NULL parent is dropped too — never fall through to "probably fine"
            if parent == pid:
                urls.append(url)
        out[pid] = urls
    return out


# Why a REST walk may not be the whole catalogue. Non-empty → no prune this run.
INCOMPLETE: list[str] = []

# ── REMOVAL (measured 2026-10-02). Until then this crawler had NO removal step at all: a post the
# office deleted or unpublished stayed active here for good.
#
# No ad has left this site since onboarding (6 active rows = today's 6 posts, none inactive), so
# there is no removed cohort to measure. What the site does answer: a slug that never existed is a
# hard 404 (body class «error404»), under /property/ and at the root, and so is a wrong post id;
# 6 of 6 live ads answer 200 on their own path with
# `<body class="… single-property postid-<their own id>">`. So only a 404/410 on the ad's OWN url
# is a removal, only that body class is life, and a redirect, a block or any other 200 is UNKNOWN.
# (The site's status terms today are «للبيع» x6 and «للإيجار» x0, its labels «متاحة» x6 and «تجاري»
# x0: it publishes no sold/rented value, so there is nothing of that kind to filter on. Any other
# value is counted every run — see MEASURED_TERMS.)
_OWN_PAGE = re.compile(r"<body[^>]*\bsingle-property postid-\d+")
RES_TABLE, COM_TABLE = "shmoualshmal_residential_listings", "shmoualshmal_commercial_listings"


def _signal(status, body, moved) -> Optional[str]:
    """'live' | 'gone' | None — only what this ad's own URL affirmatively answers."""
    if moved:
        return None
    if status in (404, 410):
        return "gone"
    return "live" if status == 200 and _OWN_PAGE.search(body) else None


def _make_verify_gone(control: Optional[dict]):
    """The removal oracle for db.prune_unseen. A 404 is believed only while a known-live ad from
    this run (`control`) still reads live through the same session."""
    url_for = stored_listing_url((RES_TABLE, COM_TABLE))
    s = session()

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform="shmoualshmal", signal=_signal, session=lambda: s,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def fetch_listings(s: cc.Session) -> list[dict]:
    """Every property post. An unparseable body ends enumeration rather than raising — the guard
    awal's 2026-07-27 parking incident put in every WP scraper."""
    out: list[dict] = []
    # Records WHY enumeration stopped. A timeout, a 403 and a genuinely empty source are three
    # different incidents; collapsing them into "no listings" sent the first CI run chasing a
    # dead source that was actually fine (2026-09-05).
    global LAST_FETCH_NOTE
    LAST_FETCH_NOTE = "no pages attempted"
    INCOMPLETE.clear()
    for page in range(1, 30):
        # RETRY, because a single attempt made this source a coin flip (measured 2026-09-14):
        # ok on 09-11, failed 09-10/12/13/14, every failure a 40s curl(28) timeout through the
        # residential proxy — while the exact same URL answers in under a second from a normal
        # connection and souq24 goes through that same proxy fine on those days. The source was
        # never down; one flaky hop killed the whole run because nothing tried twice. Every
        # sibling scraper already retries (sadin 4x, amlakalahsa 3x); this one uniquely did not.
        r = None
        last_exc = None
        for attempt in range(3):
            try:
                r = s.get(f"{REST}/properties?per_page=100&page={page}", timeout=40)
                break
            except Exception as e:
                last_exc = e
                if attempt < 2:
                    time.sleep(3 * (attempt + 1))
        if r is None:
            LAST_FETCH_NOTE = (f"page {page} raised {type(last_exc).__name__} on all 3 attempts: "
                               f"{str(last_exc)[:110]}")
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
            return out                  # a short page is the walk's only clean end
    # ponytail: a catalogue of exactly 100/200 posts also lands here (page N+1 answers HTTP 400) and
    # skips that run's prune; compare X-WP-Total instead if the site ever grows to that.
    INCOMPLETE.append(LAST_FETCH_NOTE)
    return out


# The only status / label values a post carried when this was measured (2026-10-02): status «للبيع»
# on 6 of 6 posts («للإيجار» is the site's one other term, on 0), label «متاحة» on 6 of 6. The site
# has no sold/rented term yet, so there is nothing to filter on — but map_listing reads the status by
# SUBSTRING, so a future «تم البيع» / «تم الإيجار» post would still be written as an active Buy / Rent
# listing. What is written is NOT changed here (an unmeasured value is not guessed at); every value
# outside this list is COUNTED on every run, in the log and in the run's notes, so it cannot arrive
# silently.
MEASURED_TERMS = {"property_status": ("للبيع", "للإيجار"), "property_label": ("متاحة",)}


def unmeasured_terms(p: dict, tax: dict[str, dict[int, str]]) -> list[str]:
    """This post's own status / label values that were never measured on this site."""
    out: list[str] = []
    for key, known in MEASURED_TERMS.items():
        word = key.removeprefix("property_")
        ids = p.get(key) or []
        if not ids:
            out.append(f"{word} missing")
        for i in ids:
            name = (tax.get(key) or {}).get(i)
            if name not in known:
                out.append(f"{word} «{name}»" if name else f"{word} id {i} (name not read)")
    return out


def map_listing(p: dict, tax: dict[str, dict[int, str]],
                images: Optional[dict[int, list[str]]] = None) -> tuple[Optional[dict], str]:
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
        "photo_urls": (images or {}).get(p.get("id"), []),
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
        images = fetch_images(s, posts) if posts else {}
        if not posts:
            raise RuntimeError(f"REST returned no listings — {LAST_FETCH_NOTE}")
        if args.limit:
            posts = posts[: args.limit]
        print(f"{SOURCE}: {len(posts)} listings from WP REST"
              f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

        unmapped: dict[str, int] = {}
        unmeasured: dict[str, int] = {}
        for p in posts:
            for k in unmeasured_terms(p, tax):
                unmeasured[k] = unmeasured.get(k, 0) + 1
            row, cat = map_listing(p, tax, images)
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
        tally = ", ".join(f"{k}×{v}" for k, v in sorted(unmeasured.items(), key=lambda x: -x[1]))

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
            # An ad whose category flipped this run is superseded in the table it left; prune
            # cannot clean that up (its own page is still live). See db.retire_superseded_siblings.
            superseded = db.retire_superseded_siblings(
                res_table=RES_TABLE, com_table=COM_TABLE,
                res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
                source=SOURCE)
            if superseded:
                print(f"  retired {superseded} superseded sibling row(s) after a category flip")
            # REMOVAL. A post missing from this run's list is only a CANDIDATE: at three misses its
            # own page is re-read, and it is hidden only on a 404 (_signal). A page that still
            # renders heals the row. No prune on a partial walk or a single-vertical run.
            pruned = 0
            if INCOMPLETE:
                print(f"  ⚠ REST walk incomplete — no prune: {'; '.join(INCOMPLETE)}")
            elif args.type == "all":
                verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
                for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                    k = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                        verify_gone=verify_gone)
                    if k < 0:
                        print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                    else:
                        pruned += k
            n = len(res) + len(com)
            # end_run returns the EFFECTIVE ok it actually wrote: its RC-B guard can demote a run
            # that looks successful but wrote nothing real. Fail CI on a demotion rather than
            # reporting a silent success (the same check awal makes).
            healthy = db.end_run(run_id, ok=True, rows_seen=n, rows_upserted=n,
                                 notes=f"pruned={pruned} unmeasured_status_or_label=[{tally}]"[:300],
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
        # Printed EVERY run, empty or not: see MEASURED_TERMS.
        print(f"  status/label values never measured (counted, written as before): {tally or 'none'}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
