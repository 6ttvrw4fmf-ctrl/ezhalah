"""سنان العقارية — senanrealestate.sa. Rebuilt 2026-11-12 for the site's NEW static website.

WHAT CHANGED AT THE SOURCE (measured 2026-11-12). The old site was a Nuzul tenant (82 priced units behind
/api/public/v2/properties). It is gone: all 57 units we served answer 404 on BOTH their page
(www.senanrealestate.sa/properties/<id>) and their API record, and every old route 404s. The new site is a
static marketing site with NINE «مشاريع» (projects), each its own page /projects/<slug>.html carrying:
  · a schema.org property JSON-LD (@id «…#property»): @type Apartment / SingleFamilyResidence, name,
    description, address.addressLocality (city) + streetAddress (district), floorSize.value (م²),
    offers.availability (InStock / PreOrder), keywords («… عقار للبيع …»);
  · the visible «بيانات المشروع» box: المدينة · الحي · النوع · المساحة · الحالة (متاح / حجز مسبق / قريباً);
  · NO PRICE: «الأسعار والدفعات النهائية تُحدَّد مع مستشار المبيعات» on every page.
Measured: 6 «متاح» + InStock, 2 «حجز مسبق» + PreOrder, 1 «قريباً» + PreOrder.

THE GRAIN — OWNER 2026-11-12. The fleet's developer-site rule skips a project with no priced unit. For
Senan the owner decided otherwise, by name: the six «متاح» projects show (price «السعر عند الطلب»), the
pre-booking / coming-soon ones do not (off-plan stays out of search, the rakez rule), and the old units are
removed. So ONE PROJECT PAGE = ONE LISTING, only when BOTH the visible «الحالة» says «متاح» AND the JSON-LD
offer says InStock. The price is the source's own silence — AUTHORITATIVE_NULL with its sentence as
evidence, never a number.

Type: the visible «النوع» first (شقق → Apartment, فلل → Villa); the generic «وحدات سكنية» (غيم هاوس) takes the
page's own JSON-LD @type (Apartment). Purpose: Buy only when the page's own keywords say «للبيع».

Removal oracle (this host, measured 2026-11-12): an unknown project path → 404; a live project → 200 with
its #property JSON-LD naming its own url. A 200 for THIS page whose status is no longer «متاح»/InStock is
GONE (sold out or back to pre-booking); 404 is GONE; anything else is UNKNOWN. Canary-gated.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import negotiated_session  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.facts.one_reader import amenity_answers  # noqa: E402

BASE = "https://senanrealestate.sa"
SOURCE = "سنان العقارية"
PREFIX = "SNN-"
SLUG = "senan"
ORACLE = "senan.project_page.jsonld_url_available_instock"
LIVE_STATUS = "متاح"
LIVE_AVAILABILITY = "InStock"
GENERIC_TYPE = "وحدات سكنية"
NOT_FOUND_MARK = "This Page Does Not Exist"   # the host's own 404 page title (measured 2026-11-12)
TYPE_BY_LABEL = {"شقق": "Apartment", "شقة": "Apartment", "فلل": "Villa", "فيلا": "Villa"}
TYPE_BY_LD = {"Apartment": "Apartment", "SingleFamilyResidence": "Villa"}
GENERIC_PHOTO = "hero-poster.jpg"     # the site-wide hero image, not the project's own
_HREF = re.compile(r'href="(?:\.\./|/)?(projects/[a-z0-9-]+\.html)"')
_SPEC = re.compile(r"<div><span>([^<]+)</span><b>([^<]+)</b></div>")
_LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
_OG_IMAGE = re.compile(r'<meta property="og:image" content="([^"]+)"')
_PRICE_NOTE = re.compile(r'<div class="specnote">(.*?)</div>', re.S)
_FEATS = re.compile(r'<ul class="feats">(.*?)</ul>', re.S)
_AMENITY_COLUMNS = ("elevator", "parking", "kitchen", "maid_room", "driver_room")


def _text(fragment: Optional[str]) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def session() -> cc.Session:
    """The shared fleet path: a TLS profile this host actually answers, chosen by probing it once."""
    return negotiated_session(f"{BASE}/projects.html", headers={"Accept-Language": "ar,en;q=0.7"})


def project_hrefs(page: str) -> list[str]:
    """Every /projects/<slug>.html the page links to, in order, once each."""
    seen: list[str] = []
    for h in _HREF.findall(page or ""):
        if h not in seen:
            seen.append(h)
    return seen


def sitemap_projects(xml: str) -> set[str]:
    return set(re.findall(r"<loc>https://senanrealestate\.sa/(projects/[a-z0-9-]+\.html)</loc>", xml or ""))


def parse_project(page: str) -> Optional[dict[str, Any]]:
    """The page's own #property JSON-LD plus its «بيانات المشروع» box; None when the page carries no
    property JSON-LD (not a project page)."""
    prop = None
    for block in _LD.findall(page or ""):
        try:
            d = json.loads(block)
        except Exception:
            continue
        if isinstance(d, dict) and str(d.get("@id", "")).endswith("#property"):
            prop = d
            break
    if prop is None:
        return None
    main = (page or "").split("MORE PROJECTS")[0]   # the «مشروعات أخرى» cards below repeat other projects
    specs = {_text(k): _text(v) for k, v in _SPEC.findall(main)}
    og = _OG_IMAGE.search(page or "")
    note = _PRICE_NOTE.search(main)
    feats = _FEATS.search(main)
    features = [_text(li) for li in re.findall(r"<li>(.*?)</li>", feats.group(1), re.S)] if feats else []
    return {"ld": prop, "specs": specs, "og_image": og.group(1) if og else None,
            "price_note": _text(note.group(1)) if note else None, "features": [f for f in features if f]}


def map_listing(href: str, d: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE project page. row is None exactly when skip_reason is set."""
    ld, specs = d["ld"], d["specs"]
    slug = href.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    if not slug:
        return None, "residential", "no_id"
    status = specs.get("الحالة")
    offer = ld.get("offers") if isinstance(ld.get("offers"), dict) else {}
    availability = str(offer.get("availability") or "").rsplit("/", 1)[-1] or None
    if status != LIVE_STATUS or availability != LIVE_AVAILABILITY:
        return None, "residential", f"status_{status or 'blank'}_{availability or 'blank'}"
    if "للبيع" not in str(ld.get("keywords") or ""):
        return None, "residential", "purpose_unstated"
    label = specs.get("النوع")
    property_type = TYPE_BY_LABEL.get(label or "")
    if not property_type and label == GENERIC_TYPE:
        property_type = TYPE_BY_LD.get(str(ld.get("@type") or ""))
    if not property_type:
        return None, "residential", f"type_unmapped_{label or 'blank'}"
    category = normalize.category_for_type(property_type).lower()
    addr = ld.get("address") if isinstance(ld.get("address"), dict) else {}
    city_ar = specs.get("المدينة") or _text(addr.get("addressLocality")) or None
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = specs.get("الحي") or _text(addr.get("streetAddress")) or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None
    area = normalize.to_int_numeric((ld.get("floorSize") or {}).get("value")) or normalize.to_int(specs.get("المساحة"))
    description = _text(ld.get("description")) or None
    photo = d.get("og_image")
    photos = [photo] if photo and photo.startswith("http") and not photo.endswith(GENERIC_PHOTO) else None
    url = f"{BASE}/{href}"
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{slug}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "title": _text(ld.get("name")) or None,
        "description": description,
        # the ONE word reader over the page's own «مميزات المشروع» list and its description
        **amenity_answers("\n".join([*(d.get("features") or []), description or ""]), _AMENITY_COLUMNS),
        "property_type": property_type,
        "transaction_type": "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "photo_urls": photos,
        # The page states the price is set with a sales adviser — the source's own silence, never a number.
        "price_total": db.AUTHORITATIVE_NULL,
        "price_evidence": normalize.price_evidence(
            field="specnote", raw=d.get("price_note"), stored=None, kind="total", origin="html",
            authoritative_absent=True),
    }
    row["additional_info"] = {k: v for k, v in {
        "source_id": slug,
        "grain": "project",
        "type_ar": label,
        "status_ar": status,
        "availability": availability,
        "printed_price_note": d.get("price_note"),
        "features": d.get("features") or None,
        "advertiser_fal_licence": "1200017563",
    }.items() if v is not None}
    return row, category, ""


def _make_signal(url: str):
    """404 with the host's not-found page → gone; 200 with THIS page's #property JSON-LD → live while «متاح» + InStock, else gone;
    a 200 naming another url, or carrying no property JSON-LD, is no opinion."""
    def _signal(status, body, _moved):
        if status == 404:
            # the host's own measured not-found page; a bare or foreign 404 body is the law's call
            return "gone" if NOT_FOUND_MARK in (body or "") else None
        if status != 200:
            return None
        d = parse_project(body)
        if d is None or d["ld"].get("url") != url:
            return None
        offer = d["ld"].get("offers") if isinstance(d["ld"].get("offers"), dict) else {}
        availability = str(offer.get("availability") or "").rsplit("/", 1)[-1]
        return "live" if d["specs"].get("الحالة") == LIVE_STATUS and availability == LIVE_AVAILABILITY else "gone"
    return _signal


def _make_verify_gone(control_ad: Optional[str], url_by_ad: dict[str, str]):
    """`url_by_ad` holds THIS run's rows (the canary); an unseen row's URL is its own stored listing_url."""
    def probe(ad_number: str, canary=None):
        url = url_by_ad.get(ad_number) or _stored_url(ad_number)
        if not url:
            return "unknown", f"{ad_number!r}: no stored listing_url to probe"
        return LivenessProbe(platform=SLUG, signal=_make_signal(url), session=session,
                             url_for=lambda _ad: url, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control_ad:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control_ad)
        return verdict == "live", f"positive control {control_ad}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def _stored_url(ad_number: str) -> Optional[str]:
    from scrapers.common.http_liveness import stored_listing_url
    return stored_listing_url(("senan_residential_listings", "senan_commercial_listings"))(ad_number)


def _get(s: cc.Session, url: str) -> tuple[Optional[int], str]:
    try:
        r = s.get(url, timeout=30)
        return r.status_code, r.text
    except Exception:
        return None, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        st, page = _get(s, f"{BASE}/projects.html")
        if st != 200:
            raise RuntimeError(f"{BASE}/projects.html answered {st}")
        hrefs = project_hrefs(page)
        if not hrefs:
            raise RuntimeError(f"{BASE}/projects.html links no project pages")
        sst, xml = _get(s, f"{BASE}/sitemap.xml")
        listed = sitemap_projects(xml) if sst == 200 else set()
        complete = bool(listed) and listed == set(hrefs)
        print(f"{SOURCE}: {len(hrefs)} project pages, sitemap lists {len(listed)}, complete={complete}", flush=True)
        if args.limit:
            hrefs = hrefs[:args.limit]
        for href in hrefs:
            st, body = _get(s, f"{BASE}/{href}")
            d = parse_project(body) if st == 200 else None
            if d is None:
                complete = False
                skipped[f"page_{st}"] = skipped.get(f"page_{st}", 0) + 1
                continue
            row, cat, why = map_listing(href, d)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            if d["ld"].get("url") == row["listing_url"]:
                db.mark_direct_alive(row, oracle=ORACLE)
            (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>24} {r0['transaction_type']:4} {str(r0['property_type']):9} "
                      f"{str(r0['city_ar']):10} d={str(r0['district_ar'])[:14]:14} n={str(r0['neighborhood'])[:14]:14} "
                      f"a={str(r0['area_m2']):>5} ph={len(r0.get('photo_urls') or [])} {r0['title']}")
            return 0
        db._wasalt_batch("senan_residential_listings", res)
        db._wasalt_batch("senan_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="senan_residential_listings", com_table="senan_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0]["ad_number"] if (res or com) else None,
                                            {r["ad_number"]: r["listing_url"] for r in res + com})
            for tbl, rows in (("senan_residential_listings", res), ("senan_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(hrefs), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["senan_residential_listings", "senan_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            tally = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"{e} | skips: {tally}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
