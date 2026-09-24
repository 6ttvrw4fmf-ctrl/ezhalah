"""الإيضاح — eydah.com. 2 offers (Riyadh, sale only), onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24; fully static HTML, no JS, no pagination).

  ENUMERATION. /offers/ is the catalogue: every offer is `<a class="card" href="/offers/<ID>.html">`
  and the page prints its own total «2 عرض مرخّص». sitemap.xml lists the same two pages
  (/offers/EY-1002.html, /offers/Ey-1001.html) beside the static legal pages; it is cross-checked
  but is NOT the enumeration (absence from a sitemap is never death). A run is COMPLETE when the
  index count equals the printed total.

  IDS are the page stems, and the site is INCONSISTENT about case («EY-1002» vs «Ey-1001»). URLs
  are case-sensitive: /offers/EY-1001.html and /offers/ey-1002.html both serve the HOMEPAGE, so
  listing_url keeps the exact href the index printed, while ad_number = EYD + stem.upper() so a
  later re-casing of the file does not spawn a second row.

  DETAIL PAGE (2/2): a JSON-LD `RealEstateListing` carries name, description, url, datePosted,
  image[], identifier{name:«رقم ترخيص الإعلان», value} (the AD licence → license_number),
  offers.price (SAR, integer), address.addressLocality (city) / addressRegion (the DISTRICT,
  mislabelled) and floorSize.value (m²). The HTML `<div class="spec"><span>K</span><b>V</b>` grid
  adds نوع العقار (مزرعة / فيلا), الغرض (بيع), المدينة, الحي, رقم المخطط, المساحة, عمر العقار
  («12 سنوات») and السعر («5,500,000 ريال»). Price is read from JSON-LD offers.price (structured),
  and the printed «السعر» is archived beside it. The broker block (name + telephone) and the
  wa.me / mailto CTAs are PII → never stored; the company name is fine. «رخصة فال للمعلن»
  (1200019127) is the broker's FAL licence → additional_info only.
  EY-1002 «مزرعة/أرض» prints district «العمارية», which the catalog knows as a CITY (834) and not as
  a Riyadh district → district_ar NULL, neighborhood keeps «العمارية», city stays the source's الرياض.

  REMOVAL ORACLE (measured 2026-09-24). A missing offer does NOT 404: /offers/EY-9999.html,
  /offers/EY-1003.html and the wrong-case /offers/EY-1001.html all answered HTTP 200 with the
  HOMEPAGE (89,891 B; JSON-LD @graph of a RealEstateAgent with "@id":"https://eydah.com/#org", no
  RealEstateListing). Both live pages answer 200 with a RealEstateListing whose "url" is their own.
  So: 200 + RealEstateListing naming THIS url → live; 200 + the home graph (or any 200 without a
  RealEstateListing) → gone; 404 → gone; anything else → no opinion. Removal is additionally gated
  by an in-run positive control that fails CLOSED.
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
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://eydah.com"
SOURCE = "الإيضاح"
PREFIX = "EYD"
_TYPE_OVERRIDES: dict[str, str] = {}      # the site's spellings (مزرعة, فيلا) are the shared map's
_DWELLINGS = {"Apartment", "Villa", "Floor", "Chalet", "Rest House"}


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def _text(fragment: Optional[str]) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def index_hrefs(page: str) -> list[str]:
    out: list[str] = []
    for h in re.findall(r'href="(/offers/[^"/]+\.html)"', page):
        if h not in out:
            out.append(h)
    return out


def site_total(page: str) -> Optional[int]:
    m = re.search(r"(\d[\d,]*)\s*عرض", _text(page))
    return normalize.to_int(m.group(1)) if m else None


def parse_detail(page: str) -> Optional[dict[str, Any]]:
    """The offer page → {ld, specs, printed_price}. None when the body is not a listing page."""
    ld = None
    for blob in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        try:
            obj = json.loads(blob)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("@type") == "RealEstateListing":
            ld = obj
            break
    if not ld:
        return None
    specs = {_text(k): _text(v) for k, v in re.findall(r'<div class="spec"><span>(.*?)</span><b>(.*?)</b>', page, re.S)}
    fal = re.search(r"رخصة فال للمعلن\s*</span>\s*<b>([^<]+)</b>", page)
    return {"ld": ld, "specs": specs, "advertiser_fal_licence": _text(fal.group(1)) if fal else None}


def map_listing(href: str, d: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    ld, specs = d["ld"], d["specs"]
    stem = href.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    if not stem:
        return None, "residential", "no_id"
    title = _text(ld.get("name")) or None
    if "مزاد" in (title or "") or "مزاد" in specs.get("الغرض", ""):
        return None, "residential", "auction"
    type_ar = specs.get("نوع العقار")
    property_type = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()
    purpose = specs.get("الغرض", "")
    if purpose == "بيع":
        tx = "Buy"
    elif purpose in ("إيجار", "ايجار"):
        tx = "Rent"
    else:
        return None, category, f"purpose_unmapped_{purpose or 'blank'}"
    addr = ld.get("address") or {}
    city_ar = specs.get("المدينة") or _text(addr.get("addressLocality")) or None
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = specs.get("الحي") or _text(addr.get("addressRegion")) or None
    district_ar = find_district_in_text(district_raw, city_id) or find_district_in_text(title, city_id)
    description = redact_pii(_text(ld.get("description")) or None)
    offer = ld.get("offers") or {}
    price = normalize.to_int_numeric(offer.get("price")) if isinstance(offer.get("price"), (int, float)) \
        else normalize.to_int(offer.get("price"))
    area = normalize.to_int_numeric((ld.get("floorSize") or {}).get("value")) or normalize.to_int(specs.get("المساحة"))
    ident = ld.get("identifier") or {}
    licence = str(ident.get("value")).strip() if ident.get("name") == "رقم ترخيص الإعلان" and ident.get("value") else None
    photos = [u for u in (ld.get("image") or []) if isinstance(u, str) and u.startswith("http")] or None
    rooms = normalize.rooms_from_phrase(description) if property_type in _DWELLINGS else {}
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{stem.upper()}",
        "listing_url": f"{BASE}{href}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": description,
        **normalize.amenities_from_text(description),
        **{k: v for k, v in rooms.items() if k in ("bedrooms", "halls")},
        "property_type": property_type,
        "transaction_type": tx,
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "property_age": normalize.parse_property_age(specs.get("عمر العقار")),
        "license_number": licence,
        "photo_urls": photos,
    }
    price_note = None
    if tx == "Rent":
        period, row["price_annual"] = normalize.rent_period_and_annual(price, specs.get("السعر"))
        if period:
            row["rent_period"] = period
        elif price is not None and row["price_annual"] is None:
            price_note = "period_not_annualizable"
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "source_id": stem,
        "type_ar": type_ar,
        "source_purpose": purpose or None,
        "printed_price": specs.get("السعر"),
        "price_note": price_note,
        "plot_no": specs.get("رقم المخطط"),
        "property_age_raw": specs.get("عمر العقار"),
        "date_posted": ld.get("datePosted"),
        "advertiser_fal_licence": d.get("advertiser_fal_licence"),
    }.items() if v is not None}
    return row, category, ""


def fetch_index(s: cc.Session) -> tuple[list[str], Optional[int]]:
    r = s.get(f"{BASE}/offers/", timeout=40)
    if r.status_code != 200:
        raise RuntimeError(f"/offers/ returned {r.status_code}")
    hrefs = index_hrefs(r.text)
    if not hrefs:
        raise RuntimeError("/offers/ lists no offer cards")
    return hrefs, site_total(r.text)


def fetch_detail(s: cc.Session, href: str) -> Optional[dict]:
    r = s.get(f"{BASE}{href}", timeout=40)
    if r.status_code != 200:
        return None
    return parse_detail(r.text)


# ── LIVENESS (measured 2026-09-24; see docstring) ────────────────────────────────────────────────
def _make_signal(url: str):
    """200 + a RealEstateListing JSON-LD naming THIS url → live; 200 without one (the homepage soft-404,
    whose prose also contains the word RealEstateListing, hence the parse and not a substring) → gone."""
    def _signal(status, body, _moved):
        if status == 404:
            return "gone"
        if status != 200:
            return None
        d = parse_detail(body)
        if d is None:
            return "gone"
        return "live" if d["ld"].get("url") == url else None
    return _signal


def _make_verify_gone(control_ad: Optional[str], url_by_ad: dict[str, str]):
    """`url_by_ad` holds THIS run's rows (the canary); an unseen row's URL comes from its own stored
    listing_url, never rebuilt from the ad_number (the host is case-sensitive)."""
    def probe(ad_number: str, canary=None):
        url = url_by_ad.get(ad_number) or db_listing_url(ad_number)
        if not url:
            return "unknown", f"{ad_number!r}: no stored listing_url to probe"
        return LivenessProbe(platform="eydah", signal=_make_signal(url), session=session,
                             url_for=lambda _ad: url, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control_ad:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control_ad)
        return verdict == "live", f"positive control {control_ad}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def db_listing_url(ad_number: str) -> Optional[str]:
    """The row's OWN stored URL (case-sensitive on this host — never rebuilt from the ad_number)."""
    from scrapers.common.http_liveness import stored_listing_url
    return stored_listing_url(("eydah_residential_listings", "eydah_commercial_listings"))(ad_number)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("eydah")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        hrefs, total = fetch_index(s)
        complete = total is not None and total == len(hrefs)
        print(f"{SOURCE}: {len(hrefs)} offers on /offers/, site says {total}, complete={complete}", flush=True)
        if args.limit:
            hrefs = hrefs[:args.limit]
        for href in hrefs:
            d = fetch_detail(s, href)
            if d is None:
                complete = False
                skipped["detail_unreachable_or_not_a_listing"] = skipped.get("detail_unreachable_or_not_a_listing", 0) + 1
                continue
            row, cat, why = map_listing(href, d)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = f"complete={complete} " + _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + _tally(skipped))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>11} {r0['transaction_type']:4} {str(r0['property_type']):8} "
                      f"{str(r0['city_ar']):7} d={str(r0['district_ar'])[:12]:12} n={str(r0['neighborhood'])[:12]:12} "
                      f"a={str(r0['area_m2']):>6} pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} lic={r0.get('license_number')} age={r0.get('property_age')} "
                      f"ph={len(r0.get('photo_urls') or [])} url={r0['listing_url']}")
            return 0
        # The public upsert_eydah_*_batch wrappers are added centrally later; same funnel.
        db._wasalt_batch("eydah_residential_listings", res)
        db._wasalt_batch("eydah_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="eydah_residential_listings", com_table="eydah_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0]["ad_number"] if (res or com) else None,
                                            {r["ad_number"]: r["listing_url"] for r in res + com})
            for tbl, rows in (("eydah_residential_listings", res), ("eydah_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(hrefs), rows_upserted=len(res) + len(com),
                            notes=f"pruned={pruned} {notes}"[:300],
                            check_tables=["eydah_residential_listings", "eydah_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
