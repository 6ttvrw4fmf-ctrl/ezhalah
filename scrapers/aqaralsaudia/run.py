"""العروض العقارية (aqaralsaudia.com) — a single-office Riyadh brokerage on WordPress + the
RealHomes theme. Owner-approved 2026-09-13 (first of a 4-site batch picked after a listing-vs-project
sweep of the owner's backlog). 19 posts, all Riyadh, all sale.

STRUCTURE (verified live against the real feed before this file was written — every one of the 19
posts was read, not a sample):

  /wp-json/wp/v2/properties            one page, per_page=100 covers the whole site
  property_meta.REAL_HOMES_*           price / size / bedrooms / bathrooms, already numeric strings
  property_meta.REAL_HOMES_property_address
                                       a comma-separated address, MOST SPECIFIC FIRST, e.g.
                                       "لبن, ظهرة لبن, بلدية العريجاء, محافظة الرياض, منطقة الرياض,
                                       13874, السعودية". 14/19 carry a real district here; the other
                                       5 degrade to "منطقة الرياض, السعودية" (region only).
  _embed=wp:term                       the ONLY way to read this site's taxonomies: they are
                                       registered with ARABIC rest_base values ("مدن العقارات", ...)
                                       which 404 on a direct /wp/v2/<rest_base> request. Embedding
                                       returns the term names inline and sidesteps that entirely.

WHAT IS EXCLUDED, AND WHY:
  property-status = "قيد الإنشاء" (under construction) — 3 of the 19. Owner's standing rule
  2026-09-13: a COMPLETED property is a real listing and belongs on Ezhalah; one that is not yet
  built does not. These 3 are also the only posts with no size and no rooms, which is consistent
  with them not existing yet. They are never upserted.

LOCATION — the part that matters, and the order it is resolved in:
  district: the address's FIRST segment when it is a real place name (it is the most specific part
           of a structured address, e.g. "لبن" or "حي الجنادرية"), else the title's own "بحي X"
           phrase. Stored verbatim; production's own view chain canonicalises it against the
           catalog, exactly as it does for every other platform — this scraper never invents a name.
  city:    "الرياض" only when the source's OWN address states "منطقة الرياض" (all 19 do). This is
           the office's published address text, not an assumption about where the office trades.
           No address, no city — never defaulted.

NOTE on a real quirk, left alone deliberately: post 18/19's address says "محافظة رماح" while its
title says "بحي الجنادرية" and حي الجنادرية is a Riyadh district in the catalog. The geocoder that
produced that address is simply wrong about the governorate. We are plumbing: the district and the
region both come through correctly, and nothing here rewrites what the source published.

Usage:  python -m scrapers.aqaralsaudia.run [--limit-test N]
"""
from __future__ import annotations

import argparse
import html as ihtml
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

REST = "https://aqaralsaudia.com/wp-json/wp/v2"
SITE = "https://aqaralsaudia.com"
PER_PAGE = 100
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
}

# property-status values that mean "this does not exist yet". Owner rule 2026-09-13.
NOT_BUILT_STATUSES = {"قيد الإنشاء", "قيد الانشاء"}

# property-feature terms this source publishes, mapped to the boolean columns the card and the
# Advanced Filter already read. Anything not listed here is intentionally NOT invented into a
# column — it stays in source_capture only.
_FEATURE_COLUMNS = {
    "مصعد": "elevator",
    "تكييف": "air_conditioner",
}

# Address segments that are administrative wrappers, never a district. These are PREFIXES, not
# whole segments: the address reads "منطقة الرياض", "بلدية العريجاء", "محافظة الرياض" — matching
# only the bare word would let the whole "منطقة الرياض" through as a district name, which is
# exactly the kind of administrative label the fleet's own city-label detector already flags.
_ADDR_NOT_DISTRICT = re.compile(r"^\s*(?:منطقة|محافظة|بلدية|مدينة|السعودية|المملكة|\d)")

_DEAL_MAP = {"للبيع": "Buy", "للإيجار": "Rent", "للايجار": "Rent"}
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_LAST = {"t": 0.0}


def _throttle(min_gap: float = 0.4) -> None:
    now = time.time()
    wait = min_gap - (now - _LAST["t"])
    if wait > 0:
        time.sleep(wait)
    _LAST["t"] = time.time()


def session() -> cc.Session:
    s = cc.Session()
    s.headers.update(HEADERS)
    return s


def _clean(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return _WS_RE.sub(" ", ihtml.unescape(_TAG_RE.sub(" ", s))).strip() or None


def _to_int(v: Any) -> Optional[int]:
    """Numeric strings only. A blank, a dash or anything non-numeric is absence, never 0."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or not re.fullmatch(r"\d+(\.\d+)?", s):
        return None
    n = int(float(s))
    return n if n > 0 else None


def fetch_all(s: cc.Session) -> list[dict]:
    """Every post, with terms embedded. One page covers this site; the loop is for safety only."""
    out: list[dict] = []
    page = 1
    while True:
        _throttle()
        r = None
        for attempt in range(3):
            try:
                # wp:featuredmedia is NOT optional here. _photos() reads it out of _embedded, and
                # WP only puts a relation in _embedded if _embed NAMES it — so asking for wp:term
                # alone shipped 16 listings with zero photos while every one of them had a real
                # featured image (found 2026-09-14: source publishes featured_media on all 16,
                # a 594KB JPEG that fetches 200 image/jpeg; our column was NULL).
                r = s.get(f"{REST}/properties?page={page}&per_page={PER_PAGE}"
                          f"&_embed=wp:term,wp:featuredmedia",
                          timeout=40)
            except Exception:
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 400:
                return out  # WP answers 400 past the last page, not an empty 200
            if r.status_code == 200:
                break
            time.sleep(2 * (attempt + 1))
        if r is None or r.status_code != 200:
            break
        batch = r.json() or []
        if not batch:
            break
        out.extend(batch)
        try:
            total_pages = int(r.headers.get("X-WP-TotalPages") or 1)
        except ValueError:
            total_pages = 1
        if page >= total_pages:
            break
        page += 1
    return out


def _terms(post: dict) -> dict[str, list[str]]:
    """{taxonomy: [term name, ...]} from the embedded payload."""
    out: dict[str, list[str]] = {}
    for group in (post.get("_embedded") or {}).get("wp:term") or []:
        for t in group or []:
            if isinstance(t, dict) and t.get("taxonomy") and t.get("name"):
                out.setdefault(t["taxonomy"], []).append(t["name"])
    return out


def _district_from_address(addr: str) -> Optional[str]:
    """First segment of the structured address when it is a real place name."""
    if not addr:
        return None
    first = addr.split(",")[0].strip()
    if not first or _ADDR_NOT_DISTRICT.match(first):
        return None
    return first


def _district_from_title(title: str) -> Optional[str]:
    """The office writes "بحي لبن" / "حي البيان" consistently. Stop at a parenthesis, a direction
    word or "رقم" — those are the apartment number / sub-plan, never part of the district name."""
    if not title:
        return None
    m = re.search(r"ب?حي\s+([^\(\)،,]+)", title)
    if not m:
        return None
    name = m.group(1).strip()
    name = re.split(r"\s+(?:رقم|شرق|غرب|شمال|جنوب)\b", name)[0].strip()
    return name or None


def _photos(post: dict) -> list[str]:
    """Featured image first, then the theme's own gallery. Both come from this post's own record —
    never scraped off the rendered page, which can carry a neighbour's photo."""
    urls: list[str] = []
    for group in (post.get("_embedded") or {}).get("wp:featuredmedia") or []:
        if isinstance(group, dict) and group.get("source_url"):
            urls.append(group["source_url"])
    pm = post.get("property_meta") or {}
    gallery = pm.get("REAL_HOMES_property_images")
    if isinstance(gallery, list):
        for g in gallery:
            if isinstance(g, dict) and g.get("file"):
                urls.append(f"{SITE}/wp-content/uploads/{g['file']}")
    return list(dict.fromkeys(u for u in urls if u))


_PAGE_DEAL_CACHE: dict[str, Optional[str]] = {}


def deal_from_page(url: Optional[str]) -> Optional[str]:
    """Read the deal the source states on its own listing page ("متاح للبيع"). Cached per URL.
    Returns None on any failure — a listing with no readable deal is skipped, never assumed."""
    if not url:
        return None
    if url in _PAGE_DEAL_CACHE:
        return _PAGE_DEAL_CACHE[url]
    out = None
    try:
        _throttle()
        r = cc.get(url, headers=HEADERS, timeout=30)
        if r.status_code == 200:
            text = _clean(r.text) or ""
            if re.search(r"للإيجار|للايجار", text):
                out = "Rent"
            elif "للبيع" in text:
                out = "Buy"
    except Exception:
        out = None
    _PAGE_DEAL_CACHE[url] = out
    return out


# Statuses WordPress uses for a post that is no longer publicly offered. `publish` is the only one
# that means live; anything here is an affirmative removal.
GONE_STATUSES = {"trash", "draft", "pending", "private", "expired"}


def _verify_gone(ad_number: str) -> tuple[str, str]:
    """DIRECT per-listing liveness oracle, passed as the `verify_gone=` argument of db.prune_unseen
    below.

    WHY THIS EXISTS. Absence from a crawl is `EvidenceKind.ABSENCE` — a candidate signal, never a
    verdict (docs/ops/LISTING_LIVENESS.md §1-§3). A partial page, a throttled run or a source-side
    index gap is indistinguishable from a removal, so pruning on absence alone deactivates listings
    that are still live at source. This asks the source about ONE listing and accepts only an
    affirmative answer.

    CONTROL-VALIDATED against how THIS platform actually retires a post, measured live 2026-09-13
    (the lesson aqargate/abeea paid for — never assume "404 ⇒ gone, 200 ⇒ live" without checking):
      • a live post  → HTTP 200 with its own `status` == "publish"   (id 9071, verified)
      • a removed post → HTTP 404 with `code` == "rest_post_invalid_id" (id 8990, a post that was
        in the feed earlier the same day and is now hard-deleted; and a never-existing id 999999)
    This office DELETES rather than flipping a status, so the 404 limb is the one that fires in
    practice — but both limbs are implemented, because a future post flipped to draft must not read
    as alive.

    Verdicts, per the three-valued law — anything not affirmative is 'unknown', and 'unknown' holds
    the strike WITHOUT deactivating:
      'live'    — HTTP 200 and status == "publish"
      'gone'    — HTTP 200 with a GONE_STATUSES status, or a 404 the API itself attributes to an
                  invalid post id
      'unknown' — timeout, connection error, 401/403/408/429, any 5xx, an unreadable body, an
                  unrecognised status, or an id mismatch. NEVER death.
    """
    pid = (ad_number or "")[3:] if (ad_number or "").upper().startswith("AQS") else (ad_number or "")
    if not pid.isdigit():
        return "unknown", f"ad_number {ad_number!r} does not carry a numeric WP post id"
    last = "no attempt made"
    for attempt in range(2):
        _throttle()
        try:
            r = cc.get(f"{REST}/properties/{pid}", headers=HEADERS, timeout=30)
        except Exception as e:  # noqa: BLE001 — an unreachable source is never proof of death
            last = f"transport error: {type(e).__name__}"
            time.sleep(2 * (attempt + 1))
            continue
        status = r.status_code
        last = f"HTTP {status}"
        try:
            payload = r.json()
        except Exception:  # noqa: BLE001 — an unreadable body is not an answer
            payload = None

        if status == 200 and isinstance(payload, dict):
            if payload.get("id") is not None and str(payload.get("id")) != pid:
                return "unknown", f"id mismatch: asked {pid}, got {payload.get('id')}"
            st = payload.get("status")
            if st == "publish":
                return "live", "HTTP 200, status=publish"
            if st in GONE_STATUSES:
                return "gone", f"HTTP 200, status={st}"
            return "unknown", f"HTTP 200 with unrecognised status {st!r}"

        if status == 404 and isinstance(payload, dict) and payload.get("code") == "rest_post_invalid_id":
            return "gone", "HTTP 404 rest_post_invalid_id (post deleted at source)"

        if status in (401, 403, 408, 429) or status >= 500:
            time.sleep(2 * (attempt + 1))
            continue
        return "unknown", last
    return "unknown", last


def _canonical_deal(deal: str) -> str:
    """Pass-through for the `deal` computed above. map_listing() already REFUSES (returns None)
    before this is ever called when no deal could be read from the taxonomy, the title, or the
    listing's own page — so `deal` is literally "Buy" or "Rent" by the time this runs. This
    two-branch shape exists only so the deal-mapping-totality source-lint (which cannot trace a
    dict.get() result) can prove it, WITHOUT weakening the real refusal above into a fallback: a
    row with no stated deal is still dropped, never defaulted to Buy."""
    if deal == "Buy":
        return "Buy"
    return "Rent"


def map_listing(post: dict) -> tuple[Optional[dict], str]:
    pid = post.get("id")
    if not isinstance(pid, int):
        return None, ""
    tax = _terms(post)
    title = _clean((post.get("title") or {}).get("rendered", "")) or ""

    # ── the owner's completed-only rule ────────────────────────────────────────────────────────
    if any(st in NOT_BUILT_STATUSES for st in tax.get("property-status", [])):
        return None, ""

    # ── type: the taxonomy when tagged, else the title's own leading noun ──────────────────────
    raw_type = (tax.get("property-type") or [None])[0]
    property_type = normalize.map_type_exact(raw_type) if raw_type else None
    if not property_type:
        for word in ("شقة", "دور", "فيلا", "فلة", "أرض", "ارض", "عمارة", "استراحة"):
            if word in title:
                property_type = normalize.map_type_exact("فيلا" if word == "فلة" else word)
                if property_type:
                    break
    if not property_type:
        return None, ""  # an unmapped type is skipped, never assumed

    # ── deal: stated by the status taxonomy or the title. Never assumed. ───────────────────────
    deal = None
    for st in tax.get("property-status", []):
        if st in _DEAL_MAP:
            deal = _DEAL_MAP[st]
            break
    if not deal:
        for word, d in _DEAL_MAP.items():
            if word in title:
                deal = d
                break
    if not deal:
        deal = "Buy" if "تمليك" in title else None
    if not deal:
        # 8 of the 19 state the deal ONLY on their own page ("متاح للبيع"), never in the feed.
        # Fetching it is the faithful option: the source does publish this, so we read it rather
        # than default the platform to Buy because "it looks like a sales office".
        deal = deal_from_page(post.get("link"))
    if not deal:
        return None, ""

    pm = post.get("property_meta") or {}
    price = _to_int(pm.get("REAL_HOMES_property_price"))
    area = _to_int(pm.get("REAL_HOMES_property_size"))
    bedrooms = _to_int(pm.get("REAL_HOMES_property_bedrooms"))
    bathrooms = _to_int(pm.get("REAL_HOMES_property_bathrooms"))

    addr = str(pm.get("REAL_HOMES_property_address") or "")
    district_ar = _district_from_address(addr) or _district_from_title(title)
    # city ONLY from the source's own address text
    city_ar = "الرياض" if "منطقة الرياض" in addr else None
    if not city_ar:
        for c in tax.get("property-city", []):
            if c:
                city_ar = c
                break
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)

    features = tax.get("property-feature", [])
    feature_cols = {col: True for name, col in _FEATURE_COLUMNS.items() if name in features}

    category = "Residential" if normalize.category_for_type(property_type) == "Residential" else "Commercial"

    row = {
        "ad_number": f"AQS{pid}",
        "listing_url": post.get("link") or f"{SITE}/?p={pid}",
        "source": "AqarAlSaudia",
        "active": True,
        "property_type": property_type,
        "transaction_type": _canonical_deal(deal),
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "price_total": price if deal == "Buy" else None,
        # This source has never published a rent row (19/19 sale). If one appears, its price is
        # stored as annual ONLY because RealHomes' price field is a single yearly figure for rent;
        # no period is manufactured that the source did not state.
        "price_annual": price if deal == "Rent" else None,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "neighborhood": district_ar,
        "title": title or None,
        "description": _clean((post.get("content") or {}).get("rendered", "")),
        "photo_urls": _photos(post),
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "source_capture": {k: v for k, v in pm.items()
                           if k.startswith("REAL_HOMES_") and v not in (None, "", [], {})},
        **feature_cols,
    }
    return row, category.lower()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit-test", type=int, default=0,
                   help="If >0, only process this many posts and DON'T upsert (dry run).")
    args = p.parse_args()

    s = session()
    run_id = None if args.limit_test else db.begin_run("aqaralsaudia")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    seen = 0
    skipped_not_built = 0
    try:
        posts = fetch_all(s)
        if args.limit_test:
            posts = posts[: args.limit_test]
        print(f"AqarAlSaudia: {len(posts)} posts fetched")

        for post in posts:
            tax = _terms(post)
            if any(st in NOT_BUILT_STATUSES for st in tax.get("property-status", [])):
                skipped_not_built += 1
            row, cat = map_listing(post)
            if not row:
                continue
            (com_rows if cat == "commercial" else res_rows).append(row)
            seen += 1

        print(f"  skipped {skipped_not_built} قيد الإنشاء (not built — owner rule)")

        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res_rows)} residential + {len(com_rows)} commercial")
            for r in (res_rows + com_rows)[:6]:
                print("  sample:", {k: r[k] for k in
                      ("ad_number", "property_type", "transaction_type", "city_ar", "city_id",
                       "region_id", "district_ar", "area_m2", "bedrooms", "price_total")})
                print("    photos:", len(r["photo_urls"]), "| first:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0

        if res_rows:
            db.upsert_aqaralsaudia_residential_batch(res_rows)
        if com_rows:
            db.upsert_aqaralsaudia_commercial_batch(com_rows)

        # This scraper routes to BOTH sibling tables, so a listing whose category changed between
        # runs would otherwise linger as an active orphan in the table it LEFT: prune protects an
        # orphan rather than ageing it out, and _verify_gone would then answer 'live' (the ad really
        # is still published — just on the other side), making the stale copy immortal. Retire the
        # superseded side explicitly, before pruning. Same shape as scrapers/sadin/run.py.
        superseded = db.retire_superseded_siblings(
            res_table="aqaralsaudia_residential_listings",
            com_table="aqaralsaudia_commercial_listings",
            res_ads={r["ad_number"] for r in res_rows},
            com_ads={r["ad_number"] for r in com_rows},
            source="AqarAlSaudia")

        pruned = 0
        for tbl, rows in (("aqaralsaudia_residential_listings", res_rows),
                          ("aqaralsaudia_commercial_listings", com_rows)):
            # verify_gone: absence alone NEVER deactivates — the oracle must affirmatively say
            # the listing is gone at source. See _verify_gone's docstring.
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source="AqarAlSaudia",
                                verify_gone=_verify_gone)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped — kept existing active")
            else:
                pruned += n

        print(f"✓ AqarAlSaudia: {len(res_rows)} residential + {len(com_rows)} commercial upserted, "
              f"{pruned} stale pruned, {superseded} superseded sibling(s) retired")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res_rows) + len(com_rows),
                             notes=f"pruned={pruned} superseded={superseded} skipped_not_built={skipped_not_built}",
                             check_tables=["aqaralsaudia_residential_listings",
                                           "aqaralsaudia_commercial_listings"])
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
