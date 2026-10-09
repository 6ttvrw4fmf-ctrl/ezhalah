"""شركة المربعات العقارية (Squares) — squares.com.sa. WordPress, onboarding 2026-09-26.

SOURCE SHAPE (measured live 2026-09-26 over all 18 posts before any code was written)
======================================================================================
Plain WordPress with a `property` custom post type exposed on the public REST API:

    GET /wp-json/wp/v2/property?per_page=100&_embed=1   → the WHOLE catalogue in one page

`X-WP-Total: 18` is the source's own declared count and it matched the 18 rows returned, so one
GET is a complete enumeration and prune_unseen may run after it (the same self-declaring
completeness contract qmra uses).

*** THE PRICE, AREA AND ADDRESS LIVE ON THE DETAIL PAGE, NOT IN THE REST PAYLOAD. *** The first
version of this scraper read only the REST API, found no price there, and concluded «this source
publishes no price» — WRONG, and caught in the real-user pass: the listing page for post 19678
prints «ريال840,000», «المساحة 350 م2», «سنة البناء 2009» and the address line «بريدة, القصيم,
السعودية». Measured over all 18 pages (2026-09-26): 10 print a price, 18 an area, 18 a structured
address. Each page is therefore fetched once and read from its OWN blocks only — the first
`.title-area .address`, the single `.property-description .price-area`, the single `.main-features`
and the `.property-features` list — never from the «عقارات ذات صلة» (related) cards further down,
which carry other listings' prices. A page that does not print a price keeps price NULL.

LOCATION comes from that address line («district, city, [zip,] country» or «city, region, …»),
read right-to-left: the rightmost part that is a catalog CITY is the city, and the district is
resolved against that city's catalog only. This replaced prose parsing, which filed 9 of 16
listings in towns that were merely words in the text (see arabic_location.stated_city).

TYPE COMES FROM THE POST'S OWN TERM ID, NOT FROM DOCUMENT ORDER. The REST payload carries
`class_list` with the authoritative per-post `property_type-<id>`, but the taxonomy REST routes are
closed (`rest_no_route`) so the id cannot be resolved to a name through the API. The detail page
DOES render the term as a link, but it renders sidebar/related links too — 34 type links across 18
pages — so scraping "the type on the page" would sometimes take a neighbour's. Measured, the FIRST
`property_type` link on a page is always the post's own (141→محل, 174→مول, 138→عمارة, 177→مزرعة,
136→فيلا on four separate posts), so this scraper builds an id→name map from those first links and
then resolves every post through its OWN class_list id. Document order is used to LEARN the map,
never to decide an individual listing.

LOCATION IS PROSE-DERIVED, and the source does state it: every title names a district
(«محلات تجارية بحي النسيم للبيع», «فيلا بحي الخليج للبيع», «مزرعة في حي هيث للبيع»). The
`property_city` term ids exist in class_list (114 ×14, 144 ×2, 154 ×1) but their names are NOT
resolvable — the taxonomy routes are closed and `?taxonomy=…&term_id=…` serves the homepage — so
the city is read from the text, and ONLY where the text names it («مدينة X», arabic_location.
stated_city), never from an unresolvable id and never from a street or district name that happens
to match a town. A listing whose city is not stated keeps city_id/region_id NULL and is simply not
production_ready, which is the honest outcome.

*** DEAL IS READ FROM THE LISTING'S OWN TITLE, NOT FROM THE STATUS LINK. *** Learning the status
term the same first-link way produced a WRONG MAP: it put term 89 and term 90 both on «للبيع»,
because on the single rent post a sidebar sale link came first. That would have published this
source's one rental as a sale — a deal error, the worst kind. Every title states the deal in the
source's own words (measured 17 «للبيع» / 1 «للإيجار», 18 of 18), and that reading agrees exactly
with the authoritative per-post class_list term (90 on all 17 Buy, 89 on the 1 Rent). So the title
decides, the term id is kept as an independent cross-check, and a post whose two signals DISAGREE
is skipped and counted rather than guessed.
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, stated_city, to_catalog  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://squares.com.sa"
LIST = f"{BASE}/wp-json/wp/v2/property"
SOURCE = "شركة المربعات العقارية"
PREFIX = "SQR"
SLUG = "squares"
TIMEOUT = 40

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
# The authoritative per-post status terms, measured 2026-09-26 against every title (18/18 agree):
# 90 appears on all 17 «للبيع» posts, 89 on the single «للإيجار» post.
_STATUS_DEAL = {"90": "Buy", "89": "Rent"}
# Re-measured 2026-10-02: still 90 ×17 / 89 ×1, the site's own search form offers exactly those two
# («للبيع», «للإيجار»), and every page prints its post's status ONCE, in this span (18 of 18 agree with
# the term). No third term exists, so nobody knows what one would mean: a post carrying one is KEPT
# and COUNTED with the word its own page prints — never guessed to be sold.
_OWN_STATUS = re.compile(r'<span class="status[^"]*"[^>]*>(.*?)</span>', re.S)

_TYPE_LINK = re.compile(r'href="[^"]*/property_type/[^/"]+/?"[^>]*>([^<]{1,40})<')
_STATUS_LINK = re.compile(r'href="[^"]*/property_status/[^/"]+/?"[^>]*>([^<]{1,40})<')


def _clean(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return _WS.sub(" ", _TAG.sub(" ", ihtml.unescape(s))).strip() or None


def _term_id(rec: dict, tax: str) -> Optional[str]:
    """The post's OWN term id for `tax`, from class_list — the authoritative per-post value."""
    for c in rec.get("class_list") or []:
        if c.startswith(f"{tax}-"):
            return c.split("-", 1)[1]
    return None


def walk_session() -> cc.Session:
    """3 browser profiles DIRECT, then the residential proxy (when the job has it), each a fresh
    session; the first that the catalogue answers is used for the whole walk. 2026-10-07: one
    connect timeout on the single chrome session failed the night (job 112629728613)."""
    s, tried = retry_smarter_session(f"{LIST}?per_page=1", timeout=TIMEOUT)
    print(f"  route: {' · '.join(tried)}", flush=True)
    return s


def fetch_catalogue(s: cc.Session) -> tuple[list[dict], Optional[int]]:
    r = s.get(f"{LIST}?per_page=100&_embed=1", timeout=TIMEOUT)   # the session owns the profile
    r.raise_for_status()
    declared = r.headers.get("X-WP-Total") or r.headers.get("x-wp-total")
    return r.json(), (int(declared) if declared and declared.isdigit() else None)


def deal_from_title(title: str) -> Optional[str]:
    """Buy/Rent from the source's own title wording, or None if it states neither."""
    t = title or ""
    if "للإيجار" in t or "للايجار" in t:
        return "Rent"
    if "للبيع" in t:
        return "Buy"
    return None


def learn_type_map(pages: dict[str, str], rows: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    """(type_id→name, status_id→name) learned from each post's FIRST taxonomy link.

    See the module docstring: the first link is measurably the post's own. Learning a map and then
    resolving each post by its own class_list id means a page whose sidebar happens to come first
    can only corrupt the LEARNED NAME for that one id — which the caller can see — rather than
    silently mislabel that one listing.
    """
    tmap: dict[str, str] = {}
    smap: dict[str, str] = {}
    for rec in rows:
        tid, sid = _term_id(rec, "property_type"), _term_id(rec, "property_status")
        if (tid and tid in tmap) and (sid and sid in smap):
            continue
        page = pages.get(str(rec.get("id")))
        if not page:
            continue
        if tid and tid not in tmap:
            m = _TYPE_LINK.search(page)
            if m:
                tmap[tid] = _clean(m.group(1)) or ""
        if sid and sid not in smap:
            m = _STATUS_LINK.search(page)
            if m:
                # the rendered anchor sometimes carries a stray leading letter; keep the suffix
                v = _clean(m.group(1)) or ""
                smap[sid] = "للإيجار" if "إيجار" in v or "ايجار" in v else ("للبيع" if "بيع" in v else v)
    return tmap, smap


def fetch_pages(s: cc.Session, rows: list[dict]) -> dict[str, str]:
    """Every post's own listing page, once. A page that fails is simply absent from the map."""
    pages: dict[str, str] = {}
    for rec in rows:
        link = rec.get("link")
        if not link:
            continue
        try:
            r = s.get(link, timeout=TIMEOUT)
            if r.status_code == 200:
                pages[str(rec.get("id"))] = r.text
        except Exception:  # noqa: BLE001
            continue
    return pages


_ADDRESS = re.compile(r'class="title-area".*?<p class="address">(.*?)</p>', re.S)
_PRICE = re.compile(r'<div class="price-area">.*?<span class="price[^"]*">(.*?)</span>', re.S)
_FACTS = re.compile(r'<div class="main-features">(.*?)</ul>', re.S)
_FACT = re.compile(r'<p>(.*?)</p>\s*<span>(.*?)</span>', re.S)
_FEATURES = re.compile(r'<div class="sl-box property-features">.*?<ul>(.*?)</ul>', re.S)
_FEATURE = re.compile(r'<span>(.*?)</span>', re.S)
# «مميزات العقار» items that name a column. Named → True; an item the list does not name stays
# NULL (unknown) — a list that omits «مصعد» does not say there is no lift.
_FEATURE_COLS = {"غرفة سائق": "driver_room", "غرفة خادمة": "maid_room", "غرفة عاملة": "maid_room",
                 "مصعد": "elevator", "كراج سيارة": "parking", "موقف سيارة": "parking",
                 "مواقف": "parking", "مطبخ": "kitchen"}


def parse_detail(page: str) -> dict[str, Any]:
    """The listing's OWN blocks only (see the docstring): address, printed price, fact pairs, features."""
    a, p, f, fl = _ADDRESS.search(page), _PRICE.search(page), _FACTS.search(page), _FEATURES.search(page)
    return {
        "address": _clean(a.group(1)) if a else None,
        "price_text": _clean(p.group(1)) if p else None,
        "facts": {_clean(k) or "": _clean(v) or "" for k, v in _FACT.findall(f.group(1))} if f else {},
        "features": [x for x in (_clean(s) for s in _FEATURE.findall(fl.group(1))) if x] if fl else [],
    }


def place(address: Optional[str]) -> tuple[Optional[str], Optional[int], Optional[int], Optional[str], Optional[str]]:
    """(city_ar, city_id, region_id, district_ar, district_raw) from the page's address line.
    Parts are read right-to-left: «بريدة, القصيم, 52583, السعودية» → بريدة (القصيم is a region);
    «اشبيلية, الرياض, السعودية» → الرياض + حي اشبيلية. Country and postcodes are ignored."""
    parts = [x.strip() for x in (address or "").split(",") if x.strip()]
    parts = [x for x in parts if x != "السعودية" and not re.fullmatch(r"\d{4,6}", x)]
    for i in range(len(parts) - 1, -1, -1):
        cid, rid = to_catalog(parts[i])
        if cid:
            raw = " ".join(parts[:i]) or None
            return parts[i], cid, rid, (find_district_in_text(raw, cid) if raw else None), raw
    return None, None, None, None, None


def _area(v: Optional[str]) -> Optional[float]:
    m = re.search(r"[\d.,]+", v or "")
    try:
        f = float(m.group(0).replace(",", "")) if m else None
    except ValueError:
        return None
    return f if f and f > 0 else None


def map_listing(rec: dict, ptype_ar: str, deal: str, detail: dict[str, Any]) -> tuple[dict[str, Any], str]:
    pid = str(rec.get("id"))
    ptype = normalize.map_type_exact(ptype_ar)
    category = normalize.category_for_type(ptype).lower() if ptype else "residential"
    title = redact_pii(_clean((rec.get("title") or {}).get("rendered")) or "")
    body = _clean((rec.get("content") or {}).get("rendered")) or ""

    # LOCATION from the page's own address line; stated_city() («مدينة X» in the prose) only if the
    # page printed none. Never resolve_slug on prose — see the module docstring.
    text = f"{title} {body}"
    city_ar, city_id, region_id, district_ar, district_raw = place(detail.get("address"))
    if not city_id:
        city_ar, city_id, region_id = stated_city(text)
    if city_id and not district_ar:
        # «بريدة, القصيم, السعودية» names no district; the prose may («فلل البساتين في مدينة بريدة»).
        # Read against THAT city's catalog only, and kept only if the catalog name appears in the
        # text AS WRITTEN: «درة العروس» (a resort) must not become Jeddah's «حي الدرة».
        hit = find_district_in_text(text, city_id)
        bare = (hit or "").removeprefix("حي ").strip()
        district_ar = hit if bare and re.search(rf"(?<![\u0621-\u064a]){re.escape(bare)}(?![\u0621-\u064a])",
                                                  text.replace("\u0640", "")) else None

    facts = detail.get("facts") or {}
    price_text = detail.get("price_text")
    price = normalize.to_int(re.sub(r"[^\d.,]", "", price_text or "")) if price_text else None
    price = price if price and price > 0 else None

    photos = []
    for m in ((rec.get("_embedded") or {}).get("wp:featuredmedia") or []):
        u = m.get("source_url")
        if u:
            photos.append(u)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": rec.get("link"),
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": redact_pii(body) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw if city_id and detail.get("address") else None,
        "area_m2": _area(facts.get("المساحة")),
        "property_age": normalize.age_from_completion_year(
            facts.get("سنة البناء"), this_year=datetime.now(timezone.utc).year),
        "date_added": _clean(rec.get("date")),
        "photo_urls": photos or None,
    }
    features = detail.get("features") or []
    for word, col in _FEATURE_COLS.items():
        if word in features:
            row[col] = True
    if deal == "Buy":
        row["price_total"] = price
    else:
        row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(price, price_text)
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    # The page's own price-area. A page that prints none leaves price NULL: never stated, not zero.
    row["price_evidence"] = normalize.price_evidence(
        field="price-area" if price_text else None, raw=price_text, stored=stored,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="structured",
        authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": bool(rec.get("featured_media")),
                              "key_present": bool(photos), "count": len(photos)}
    info = {
        "source_id": pid,
        "type_ar": ptype_ar,
        "type_term_id": _term_id(rec, "property_type"),
        "status_term_id": _term_id(rec, "property_status"),
        "city_term_id": _term_id(rec, "property_city"),   # kept raw: its NAME is not resolvable
        "modified": _clean(rec.get("modified")),
        "address_ar": detail.get("address"),
        "price_printed": price_text,
        "total_area_m2": _area(facts.get("المساحة الكلية")),
        "build_year": facts.get("سنة البناء") if (facts.get("سنة البناء") or "").isdigit() else None,
        "features_ar": features or None,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    row["source_capture"] = strip_pii_fields({"schema": "squares.wp-v2-property.v1",
                                              "id": rec.get("id"), "slug": rec.get("slug"),
                                              "class_list": rec.get("class_list")})
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # The run is registered BEFORE the first request: a fetch that dies (DNS, connect timeout) is a
    # failed run on record, never a night with no row (2026-10-07: squares and nafithh vanished
    # from scrape_runs that way and the early-warning robot could not see them).
    run_id = None if dry else db.begin_run(SLUG)
    rows: list[dict] = []
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    kept: dict[str, int] = {}
    try:
        s = walk_session()
        rows, declared = fetch_catalogue(s)
        if a.limit:
            rows = rows[: a.limit]
        print(f"{SOURCE}: {len(rows)} posts (X-WP-Total={declared})", flush=True)
        pages = fetch_pages(s, rows)
        tmap, smap = learn_type_map(pages, rows)
        print(f"  learned {len(tmap)} type term(s), {len(smap)} status term(s)", flush=True)
        for rec in rows:
            tid = _term_id(rec, "property_type")
            ptype_ar = tmap.get(tid or "")
            if not ptype_ar:
                skipped[f"type_unresolved_{tid}"] = skipped.get(f"type_unresolved_{tid}", 0) + 1
                continue
            if not normalize.map_type_exact(ptype_ar):
                skipped[f"type_unmapped_{ptype_ar}"] = skipped.get(f"type_unmapped_{ptype_ar}", 0) + 1
                continue
            title = _clean((rec.get("title") or {}).get("rendered")) or ""
            deal = deal_from_title(title)
            if deal is None:
                skipped["deal_unstated_in_title"] = skipped.get("deal_unstated_in_title", 0) + 1
                continue
            # Independent cross-check against the post's own status term. They agreed 18/18 when
            # measured; a disagreement means one of the two readings is wrong and neither may be
            # trusted, so the listing is skipped rather than published under a guessed deal.
            sid = _term_id(rec, "property_status")
            by_term = _STATUS_DEAL.get(sid or "")
            if by_term and by_term != deal:
                k = f"deal_conflict_title_{deal}_vs_term_{by_term}"
                skipped[k] = skipped.get(k, 0) + 1
                continue
            page = pages.get(str(rec.get("id")))
            if not page:
                skipped["detail_page_unreadable"] = skipped.get("detail_page_unreadable", 0) + 1
                continue
            row, cat = map_listing(rec, ptype_ar, deal, parse_detail(page))
            (com if cat == "commercial" else res).append(row)
            if not by_term:
                db.mark_presence_unproven(row)      # a status term nobody measured: no stamp
                m = _OWN_STATUS.search(page)
                k = f"status_term_{sid}_{_clean(m.group(1)) if m else None}"
                kept[k] = kept.get(k, 0) + 1

        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if kept:
            print("  kept, status value never measured (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(kept.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            for row in (res[:3] + com[:2]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "area_m2",
                       "city_ar", "district_ar", "listing_url")}, ensure_ascii=False)[:190])
            return 0

        db.upsert_squares_residential_batch(res)
        db.upsert_squares_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="squares_residential_listings", com_table="squares_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        for tbl, rr in (("squares_residential_listings", res),
                        ("squares_commercial_listings", com)):
            if rr and len(pages) == len(rows):      # a sweep with an unreadable page is incomplete
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(rows), rows_upserted=len(res) + len(com),
                             check_tables=["squares_residential_listings", "squares_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(rows), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
