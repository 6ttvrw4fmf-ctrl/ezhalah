"""Ryadah («ريادة العقارية», ryadah.com.sa) — Onboarding 2026-09-27 (batch 7).

A Khobar property-management / development company that also leases and sells.

SOURCE SHAPE (measured live 2026-09-27)
=======================================
WordPress + the RealHomes theme + Polylang (ar default, /en/ copy of every post):
  /wp-json/wp/v2/properties?per_page=100 → 72 posts = 36 Arabic + 36 English (`/en/` in `link`).
      Only the Arabic post is a listing (one per property, never both languages). The REST record
      carries `property_meta`: REAL_HOMES_property_price/_prefix/_postfix, _size/_size_postfix,
      _bedrooms, _bathrooms, _address, _location{latitude,longitude}, _images[{full_url}],
      _additional_details_list [[label, value]], «inspiry_نظرة_عامة_على_العقار:» (one-line overview),
      AND inspiry_property_owner_name/_contact/_address — PII, never read.
      The taxonomies (property-type / property-city / property-status) are NOT exposed over REST.
  detail page (the Arabic post's `link`):
      <p class="status">للإيجار|للبيع|تم البيع|قريبا</p>  <p class="price">عند الاتصال</p>
      <nav class="property-breadcrumbs">السعودية › المنطقة الشرقية › الخبر</nav> (property-city terms)
      <li class="rh_property__feature">…</li> (feature terms)
  /property/ archive → the «أنواع العقارات» widget lists every property-type term; each term's archive
      (/property-type/<term>/page/N/) lists its properties → the only way to read a post's types.
Measured: 29 للإيجار · 5 للبيع · 2 تم البيع · 1 قريبا (ARK); 2 are in Bahrain (المنامة).

EVERY POST IS A WHOLE BUILDING / COMPOUND offering its units («كمباوند سكون — 34 شقة», «برج السعدون —
65 وحدة 80–160 م²»), completed and leased or sold by Ryadah. Kept as ONE listing per post with its
single unit type. Consequences, never guessed around:
  * PRICE: every post shows «عند الاتصال» and an empty price meta → NULL (authoritative absence).
  * RENT PERIOD: no post states one. OWNER DECISION 2026-09-28: these leased buildings (malls, office
    towers, compounds) are shown as YEARLY rent with «price on request» — a period the post states still
    wins, and a published price ≤10,000 is monthly by the shared rule.
  * AREA: REAL_HOMES_property_size is the BUILDING's area (65,000 m² for سي فرونت; «5 طوابق» for
    بيوتات البندرية) and the unit sizes are ranges («من 75 إلى 120 م²») → area_m2 NULL, both texts kept.
  * TYPE: a post carries several terms. Categories (سكني/تجاري) and Ryadah's SERVICES (إدارة التسويق,
    إدارة الممتلكات والمرافق, التطوير العقاري) are not unit types. The unit-type terms must name exactly
    one canonical type; a tower offering «مكاتب + محل» is `type_multiple` (skipped, never picked),
    a post with only «سكني» is `type_unstated`, and a title that names a different type than the
    taxonomy («برج الدبل (معرض)» tagged مكاتب) is `type_title_conflict`.
  * OFF-PLAN: «برج ريما ١» says «بنظام البيع على الخارطة» in its own description → skipped.
  * PHOTOS: the gallery only. The featured image is NOT the listing's: «صفا بلازا» (no gallery) has
    «Al-Seef-Plaza-01.webp» — another building's photo — as its featured/og image.
  * CITY: the breadcrumb's property-city term (the site's structured city); district: a segment of
    the structured address, catalog-validated.
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, norm_district_tok, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://ryadah.com.sa"
API = BASE + "/wp-json/wp/v2/properties"
ARCHIVE = BASE + "/property/"
SOURCE = "ريادة العقارية"
PREFIX = "RYD"
SLUG = "ryadah"

_DEAL = {"للإيجار": "Rent", "للايجار": "Rent", "للبيع": "Buy"}
# the site's property-type terms that ARE a unit type → the Arabic word the shared map knows
_TYPE_WORD = {"شقة": "شقة", "شقة على الروف": "شقة", "فيلا": "فيلا", "دوبلكس": "دوبلكس", "قصر": "قصر",
              "محل": "محل", "مكاتب": "مكتب", "صالات العرض": "معرض"}
# terms that are a category or one of Ryadah's own SERVICES — never a unit type
_NOT_A_TYPE = {"سكني", "تجاري", "إدارة التسويق", "إدارة الممتلكات والمرافق", "التطوير العقاري"}
_OFF_PLAN = re.compile(r"على الخارطة|تحت الإنشاء|تحت الانشاء|قيد الإنشاء|قيد الانشاء")
_NO_PRICE = re.compile(r"عند الاتصال|عند الطلب|على السوم")
_META_KEPT = ("REAL_HOMES_property_id", "REAL_HOMES_property_price", "REAL_HOMES_property_price_prefix",
              "REAL_HOMES_property_price_postfix", "REAL_HOMES_property_size",
              "REAL_HOMES_property_size_postfix", "REAL_HOMES_property_bedrooms",
              "REAL_HOMES_property_bathrooms", "REAL_HOMES_property_address", "REAL_HOMES_property_location",
              "REAL_HOMES_additional_details_list", "inspiry_نظرة_عامة_على_العقار:")


def fetch(s: cc.Session, url: str) -> Any:
    """The response for 200/400/404 (a past-the-end page is an answer, not a failure); retries anything else."""
    for attempt in range(3):
        try:
            r = s.get(url, timeout=60)
            if r.status_code in (200, 400, 404):
                return r
            raise RuntimeError(f"HTTP {r.status_code} for {url}")
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)


def clean(fragment: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def walk_posts(s: cc.Session) -> tuple[list[dict], bool]:
    """Every Arabic property post, and whether the REST walk reached its end."""
    posts: list[dict] = []
    for page in range(1, 50):
        r = fetch(s, f"{API}?per_page=100&page={page}")
        if r.status_code != 200:
            return posts, r.status_code == 400 and page > 1        # 400 = past the last page
        got = r.json()
        posts += [p for p in got if "/en/" not in p.get("link", "")]
        if len(got) < 100:
            return posts, True
        time.sleep(0.3)
    return posts, False


def type_terms(s: cc.Session) -> dict[str, list[str]]:
    """{unquoted property url: [its property-type term names]} — the terms are not on REST or the page."""
    widget = re.search(r"Property_Types_Widget.*?</section>", fetch(s, ARCHIVE).text, re.S)
    if not widget:
        raise RuntimeError("the «أنواع العقارات» widget is gone — types cannot be read")
    out: dict[str, list[str]] = {}
    for url, name in dict.fromkeys(re.findall(r'<a href="([^"]+/property-type/[^"]+)">([^<]+)</a>', widget.group(0))):
        seen: list[str] = []
        for page in range(1, 60):
            r = fetch(s, url if page == 1 else f"{url.rstrip('/')}/page/{page}/")
            if r.status_code != 200:
                break
            new = [u for u in (urllib.parse.unquote(h) for h in
                               re.findall(r'rh_list_card__details">\s*<h3><a href="([^"]+)"', r.text)) if u not in seen]
            if not new:
                break
            seen += new
            time.sleep(0.2)
        for u in seen:
            out.setdefault(u, []).append(ihtml.unescape(name).strip())
    return out


def parse_page(page: str) -> dict[str, Any]:
    head = page[:page.find("rh_page__head -->")] if "rh_page__head -->" in page else page
    nav = re.search(r'<nav class="property-breadcrumbs">(.*?)</nav>', head, re.S)
    status = re.search(r'<p class="status">(.*?)</p>', head, re.S)
    price = re.search(r'<p class="price ?">(.*?)</p>', head, re.S)
    return {
        "status": clean(status.group(1)) if status else None,
        "price_text": clean(price.group(1)) if price else None,
        "crumbs": [clean(a) for a in re.findall(r'/property-city/[^"]*">(.*?)</a>', nav.group(1), re.S)] if nav else [],
        "features": [clean(f) for f in re.findall(r'<li class="rh_property__feature"[^>]*>.*?<a [^>]*>(.*?)</a>', page, re.S)],
    }


def district_from_address(address: str, city_ar: str, city_id: int, title: str) -> tuple[Optional[str], Optional[str]]:
    """(district_ar, raw) — the first address segment that IS, as a whole, a catalog district of THIS
    city. Street segments, the building's own name, numbers and plus-codes («85PV+G6V») are never
    tried, and a district merely CONTAINED in a segment is refused: «بحيرة الشبيلي» (a lake) is not
    the district البحيرة."""
    for seg in re.split(r"[،,\-–.]", address):
        seg = re.sub(r"^\s*(?:ح[يى]|منطقة)\s+", "", re.sub(r"\s+", " ", re.sub(r"\S*\d\S*", " ", seg))).strip()
        if not seg or seg == city_ar or (title and title in seg) or re.match(r"(?:ال)?(?:طريق|شارع)", seg):
            continue
        hit = find_district_in_text("حي " + seg, city_id)
        if hit and norm_district_tok(hit) == norm_district_tok(seg):
            return hit, seg
    return None, None


def map_property(post: dict, d: dict[str, Any], terms: list[str]) -> tuple[Optional[tuple[dict, str]], str]:
    status = d.get("status") or ""
    deal = _DEAL.get(status)
    if not deal:                                   # تم البيع / تم التأجير / قريبا — no offer
        return None, f"status_{status or 'none'}"
    crumbs = d.get("crumbs") or []
    if crumbs and crumbs[0] != "السعودية":
        return None, "outside_saudi"
    m = post.get("property_meta") or {}
    title = clean((post.get("title") or {}).get("rendered"))
    overview = clean(m.get("inspiry_نظرة_عامة_على_العقار:"))
    desc = clean((post.get("content") or {}).get("rendered"))
    details = {clean(k): clean(v) for k, v in (m.get("REAL_HOMES_additional_details_list") or []) if k}
    if _OFF_PLAN.search(" ".join([title, overview, desc, *details.values()])):
        return None, "off_plan"

    unit_terms = [t for t in terms if t not in _NOT_A_TYPE]
    unmapped = [t for t in unit_terms if not normalize.map_type_exact(_TYPE_WORD.get(t))]
    if unmapped:
        return None, f"type_unmapped_{unmapped[0]}"
    types = {normalize.map_type_exact(_TYPE_WORD[t]) for t in unit_terms}
    if not types:
        return None, "type_unstated"
    if len(types) > 1:
        return None, "type_multiple"
    ptype = types.pop()
    in_title = {x for w in re.findall(r"[؀-ۿ]+", title) if (x := normalize.map_type_exact(w))}
    if in_title and ptype not in in_title:
        return None, "type_title_conflict"
    category = normalize.category_for_type(ptype).lower()

    raw_price = str(m.get("REAL_HOMES_property_price") or "").strip()
    postfix = str(m.get("REAL_HOMES_property_price_postfix") or "")
    price_text = d.get("price_text")
    price = normalize.to_int(raw_price) if raw_price and not _NO_PRICE.search(price_text or "") else None
    per_m = bool(price) and bool(re.search(r"متر|م2|م²|sqm|m2|m²", postfix, re.I))
    row_price: dict[str, Any] = {"price_per_meter": price if per_m else None}
    if deal == "Buy":
        row_price["price_total"] = None if per_m else price
    elif not per_m:
        card = "monthly" if "شهر" in postfix else "annual"      # yearly unless stated (owner 2026-09-28)
        period, annual = normalize.rent_period_from_ad(price, f"{title} {overview} {desc}", card, title)
        # «عند الاتصال»: no price to judge by — the building is still a yearly lease offer (owner 2026-09-28)
        row_price["rent_period"], row_price["price_annual"] = period or (card if price is None else None), annual

    city_ar = crumbs[-1] if len(crumbs) >= 3 else None
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    address = clean(m.get("REAL_HOMES_property_address"))
    district_ar, district_raw = district_from_address(address, city_ar, city_id, title) if city_id else (None, None)
    photos = list(dict.fromkeys(i["full_url"] for i in m.get("REAL_HOMES_property_images") or [] if i.get("full_url")))
    loc = m.get("REAL_HOMES_property_location") or {}
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{post['id']}",
        "listing_url": post["link"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii("\n".join(x for x in (overview, desc) if x)[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": None,            # the size meta is the BUILDING's; unit sizes are ranges — see docstring
        "bedrooms": normalize.to_int_numeric(m.get("REAL_HOMES_property_bedrooms")),
        "bathrooms": normalize.to_int_numeric(m.get("REAL_HOMES_property_bathrooms")),
        "photo_urls": photos,
        **row_price,
        **normalize.amenities_from_text("\n".join(d.get("features") or [])),
    }
    stored = row.get("price_per_meter") or (row.get("price_total") if deal == "Buy" else row.get("price_annual"))
    row["price_evidence"] = normalize.price_evidence(
        field="property_meta.REAL_HOMES_property_price", raw=raw_price or None, stored=stored,
        kind="per_meter" if per_m else ("total" if deal == "Buy" else "annual"),
        unit="per_meter" if per_m else "total", origin="structured",
        authoritative_absent=price is None and bool(_NO_PRICE.search(price_text or "")))
    size = " ".join(str(m.get(k) or "") for k in ("REAL_HOMES_property_size", "REAL_HOMES_property_size_postfix")).strip()
    info = {
        "source_id": post["id"],
        "property_code": m.get("REAL_HOMES_property_id"),
        "price_text": price_text,
        "building_size_text": size,
        "units": details,
        "address": redact_pii(address),
        "type_terms": terms,
        "features": d.get("features"),
        "latitude": loc.get("latitude"),
        "longitude": loc.get("longitude"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    row["source_capture"] = strip_pii_fields({
        "schema": "ryadah.realhomes.v1", "status": status, "price_text": price_text, "crumbs": crumbs,
        "type_terms": terms, "meta": {k: m[k] for k in _META_KEPT if k in m}})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 2026-09-28: the WP REST list answered HTTP 403 to the runner's datacenter IP on the pinned
    # chrome profile (one run 200, the next 403). Probe 3 profiles DIRECT, then through the
    # residential proxy (`proxy: true` → WASALT_PROXY_URL), and keep the session that is served.
    s, tried = retry_smarter_session(f"{API}?per_page=1")
    print(f"{SOURCE}: probe {' '.join(tried)}", flush=True)
    posts, walked_all = walk_posts(s)
    terms = type_terms(s)
    print(f"{SOURCE}: {len(posts)} Arabic property post(s) (REST walk complete={walked_all}); "
          f"{len(terms)} carry a type term", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for post in posts:
            r = fetch(s, post["link"])
            if r.status_code != 200:
                unreadable += 1
                continue
            got, why = map_property(post, parse_page(r.text), terms.get(urllib.parse.unquote(post["link"]), []))
            time.sleep(0.3)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "title", "property_type", "transaction_type", "price_total", "price_annual",
                       "rent_period", "city_ar", "district_ar", "neighborhood")}, ensure_ascii=False)[:260])
            return 0

        db.upsert_ryadah_residential_batch(res)
        db.upsert_ryadah_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="ryadah_residential_listings", com_table="ryadah_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = walked_all and unreadable == 0 and len(posts) > 0
        for tbl, rr in (("ryadah_residential_listings", res), ("ryadah_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: REST walk complete={walked_all}, {unreadable} unreadable page(s)", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts), rows_upserted=len(res) + len(com),
                             check_tables=["ryadah_residential_listings", "ryadah_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(posts), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
