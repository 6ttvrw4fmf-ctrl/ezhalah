"""SQCC («مجموعة صالح القرشي العقارية», sqcc.sa) — Onboarding 2026-09-27 (batch 7).

A Dammam brokerage: villas, buildings, farms, land, shops — mostly Dammam / Qatif / Khobar, two in Jeddah.

SOURCE SHAPE (measured live 2026-09-27)
=======================================
A hand-built WordPress theme («kirshy5», qTranslate — `?lang=en` is the SAME post in English):
  /wp-sitemap-posts-realestate-1.xml          33 posts of the custom type «realestate» (no REST route)
  /wp-sitemap-taxonomies-realestate_cats-1.xml 6 terms: وحدات للبيع (22) · وحدات للأيجار (11) — the
      site's own sale/rent menu, the DEAL — · الدمام (19) · جدة (2) — cities — · العقارات المتاحة ·
      مجموعتنا المميزة (display groups, not a status: 4 live posts are outside «المتاحة»).
  category archive card: <h3>المنطقة : حى طيبة (الدمام)</h3> — the listing's own LOCATION field,
      printed only on the card, never on the detail page.
  detail page: <link rel='shortlink' href='?p=53'> (the stable id) · <h2> title · price
      «250,000 / 270,000 ريال» · serv_info icons139 = bedrooms, icons140 = bathrooms (glyph fonts, read
      against the ads' own text: «2 | 2» ↔ «غرفتين نوم … 2 دورات مياة»), icons141 = area text · a spec
      list («العمر : 19 سنة», «الدخل …») · post thumbnail + lightview gallery.
Auctions («المزادات») are a SEPARATE post type («mazadat») with their own sitemap — never walked here;
a realestate post that mentions مزاد is skipped anyway.

PRICE (owner rule: price = source):
  * one number → stored as published; «ريال للمتر» → price_per_meter (price_total NULL).
  * two prices («250,000 / 270,000»), a «تبدأ من» range, «مساحات …» (several unit sizes) or a spec list
    quoting two rents («الفتحة الكبيرة … 100,000 / الصغيرة … 75,000») = several units in one ad →
    price NULL and area NULL, raw text in additional_info["price_text"] / ["area_text"].
  * rent period: the site prints none → rent_period_from_ad(…, card_period=None).
AREA: «المساحة 400م» → 400. «م2/م٢» is a unit, never a digit. «مليونان م» (words) → NULL, raw kept.
READY ONLY: «مؤجرة» on a SALE («شقق استثمارية مؤجرة», «العمارة مؤجرة ودخلها …») is the income of a
tenanted investment still for sale — only a RENT listing that says مؤجر/تم التأجير is off the market.
TYPE: the title's own type word («فلة دوبلكس» → Duplex, «عمارة تجارية» → Commercial Building, «ارض … تجارية»
→ Commercial Land, plurals محلات/مكاتب/اراضي زراعية); «سويتات» has no taxonomy type → skipped.
LOCATION: the card's «المنطقة»: «X (CITY)», «حي X CITY», «حي X بالCITY», «CITY», «CITY طريق …». A city
category that contradicts the card («حي ابن خلدون (القطيف)» filed under الدمام) → location NULL.
PHOTOS: og:image and «og.jpg» are the SQC LOGO; «2022-09-18.jpg» is a stock photo of Ithra, not the land.
PDPL: the footer's phone/e-mail are outside the listing block and never read; all text is redacted.
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
from scrapers.common.arabic_location import (  # noqa: E402
    find_district_in_text, is_ambiguous_standalone_word, norm_district_tok, to_catalog)
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://sqcc.sa"
SITEMAP = BASE + "/wp-sitemap-posts-realestate-1.xml"
CATS = BASE + "/wp-sitemap-taxonomies-realestate_cats-1.xml"
SOURCE = "مجموعة صالح القرشي العقارية"
PREFIX = "SQC"
SLUG = "sqcc"
IMPERSONATE = "chrome"

_DEAL_CAT = {"وحدات للبيع": "Buy", "وحدات للأيجار": "Rent"}
_DEAL_WORD = ((re.compile(r"للبيع|تمليك"), "Buy"), (re.compile(r"لل[اإأ]يجار|للتأجير|للتاجير"), "Rent"))
# the site's own title vocabulary the shared map lacks (precedent: alkhaas/alnokhba «عمارة تجارية»,
# eilmalriyada «فيلا دوبلكس»); exact-match only
_TYPE_OVERRIDES = {"فلة دوبلكس": "Duplex", "فيلا دوبلكس": "Duplex", "عمارة تجارية": "Commercial Building",
                   "عماره تجارية": "Commercial Building", "ارض تجارية": "Commercial Land",
                   "اراضي زراعية": "Farm", "محلات": "Shop", "مكاتب": "Office"}
_GONE = re.compile(r"تم البيع|مباع|محجوز|مزاد")
_LEASED = re.compile(r"تم (?:ال)?تأجير|تم التاجير|مؤجر")          # a RENT listing only — see docstring
_OFF_PLAN = re.compile(r"على الخارطة|تحت الإنشاء|تحت الانشاء|قيد الإنشاء|قيد الانشاء")
_FROM = re.compile(r"تب[دت][اأ]ء?\s*من")
_NUM = re.compile(r"[\d٠-٩][\d٠-٩,٬.]*")
_NOT_A_PHOTO = re.compile(r"/(?:og|logo)[^/]*\.\w+$|/2022-09-18\.jpg$", re.I)


def fetch(s: cc.Session, url: str) -> Any:
    """The response for 200/404 (a past-the-end page is an answer, not a failure); retries anything else."""
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            if r.status_code in (200, 404):
                return r
            raise RuntimeError(f"HTTP {r.status_code} for {url}")
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)


def clean(fragment: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def walk_categories(s: cc.Session) -> tuple[dict[str, set[str]], dict[str, str]]:
    """({category: {unquoted post url}}, {unquoted post url: the card's «المنطقة» text})."""
    members: dict[str, set[str]] = {}
    where: dict[str, str] = {}
    for url in re.findall(r"<loc>([^<]+)</loc>", fetch(s, CATS).text):
        name = urllib.parse.unquote(url).rstrip("/").rsplit("/", 1)[-1].replace("-", " ")
        seen: set[str] = set()
        for page in range(1, 60):
            r = fetch(s, url if page == 1 else f"{url.rstrip('/')}/page/{page}/")
            if r.status_code != 200:
                break
            new = 0
            for card in re.findall(r'<li class="filter[^"]*">(.*?)</li><!--End Loop-->', r.text, re.S):
                href = re.search(r'href="([^"]+/realestate/[^"]+)"', card)
                if not href:
                    continue
                u = urllib.parse.unquote(href.group(1))
                h3 = re.search(r"<h3>\s*المنطقة\s*:?\s*(.*?)</h3>", card, re.S)
                if h3 and clean(h3.group(1)):
                    where[u] = clean(h3.group(1))
                new += u not in seen
                seen.add(u)
            if not new:
                break
            time.sleep(0.2)
        members[name] = seen
    return members, where


def parse_page(page: str) -> dict[str, Any]:
    box = page[page.find('id="postin"'):page.find('<div id="data">')]   # the listing block only
    pid = re.search(r"\?p=(\d+)['\"]", page)
    head = re.search(r'<div class="precemp">\s*<h2>(.*?)</h2>', page, re.S)
    price = re.search(r'<div class="news_shape_txt_all">\s*<p>(.*?)</p>', box, re.S)
    serv = box[box.find("serv_info"):box.find("postin_txt")]
    geo = re.search(r"maps\.google\.com/\?q=(-?[\d.]+),(-?[\d.]+)", box)
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', page)
    thumb = re.findall(r'class="postin_img[^"]*">\s*<img[^>]*?src="([^"]+)"', box)
    gallery = re.findall(r'class="shape_gallerys_all">\s*<a href="([^"]+)"', box)
    return {
        "id": pid.group(1) if pid else None,
        "canonical": canon.group(1) if canon else None,
        "title": clean(head.group(1)) if head else "",
        "price_text": clean(price.group(1)) if price else "",
        "serv": {k: clean(v) for k, v in re.findall(r'<span class="(icons\d+)">(.*?)</span>', serv, re.S) if clean(v)},
        "specs": [clean(p) for p in re.findall(r'<span class="icons\d+"></span>\s*<p>(.*?)</p>', box, re.S) if clean(p)],
        "lat": geo.group(1) if geo else None,
        "lng": geo.group(2) if geo else None,
        "photos": [u for u in dict.fromkeys(thumb + gallery) if not _NOT_A_PHOTO.search(u)],
    }


def title_type(title: str) -> Optional[str]:
    """The title's own type word: a «X تجارية» phrase, then a two-word phrase, then the word — first hit wins."""
    words = re.findall(r"[؀-ۿ]+", title)
    commercial = any(w.startswith("تجاري") for w in words)
    for i, w in enumerate(words):
        cands = ([f"{w} تجارية"] if commercial else []) + ([f"{w} {words[i + 1]}"] if i + 1 < len(words) else []) + [w]
        for c in cands:
            t = normalize.map_type_exact(c, _TYPE_OVERRIDES)
            if t:
                return t
    return None


def place(where: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(city_ar, district text) from the card's «المنطقة». Only an explicit city slot counts — the
    bracket, the LAST word («… بالخبر») or the whole field — never a word inside the district: «ضاحية»
    and «بدر» are catalog towns elsewhere, «حى بدر» is a Dammam district."""
    w = re.split(r"\s+(?:طريق|شارع)\s", (where or "").strip())[0].strip()
    if not w:
        return None, None
    m = re.fullmatch(r"(.*?)\s*\(([^()]+)\)", w)
    if m:
        return (m.group(2).strip(), m.group(1).strip() or None) if to_catalog(m.group(2).strip())[0] else (None, w)
    words = w.split()
    body = words[1:] if words[0] in ("حي", "حى") else words
    last = body[-1][1:] if body and body[-1].startswith("بال") else (body[-1] if body else "")
    if len(body) > 1 and not is_ambiguous_standalone_word(last) and to_catalog(last)[0]:
        return last, " ".join(words[:-1])
    if body is words and to_catalog(w)[0]:
        return w, None
    return None, w


def map_listing(url: str, d: dict[str, Any], cats: dict[str, set[str]],
                where: Optional[str]) -> tuple[Optional[tuple[dict, str]], str]:
    if not d.get("id"):
        return None, "no_stable_id"
    title, specs, pt = d["title"], d["specs"], d["price_text"]
    own = " ".join([title, pt, *specs])
    in_cats = sorted(c for c, urls in cats.items() if url in urls)
    deals = {_DEAL_CAT[c] for c in in_cats if c in _DEAL_CAT}
    if len(deals) != 1:
        return None, "deal_ambiguous" if deals else "deal_unstated"
    deal = deals.pop()
    said = {v for r, v in _DEAL_WORD if r.search(title)}
    if said and said != {deal}:
        return None, "deal_title_conflict"
    if _GONE.search(own):
        return None, "sold_reserved_or_auction"
    if deal == "Rent" and _LEASED.search(own):
        return None, "already_rented"
    if _OFF_PLAN.search(own):
        return None, "off_plan"
    ptype = title_type(title)
    if not ptype:
        return None, f"type_unmapped_{(re.findall(r'[؀-ۿ]+', title) or ['none'])[0]}"
    category = normalize.category_for_type(ptype).lower()

    area_txt = d["serv"].get("icons141", "")
    nums = _NUM.findall(pt)
    several = (len(nums) > 1 or bool(_FROM.search(pt)) or bool(re.search(r"مساحات|\s(?:الى|إلى)\s", area_txt))
               or bool(_FROM.search(area_txt))
               or len(re.findall(r"[\d٠-٩][\d٠-٩,٬.]*\s*(?:ألف|الف)?\s*ريال", " ".join(specs))) > 1)
    price = normalize.to_int(nums[0]) if len(nums) == 1 and not several else None
    per_m = bool(re.search(r"للمتر|للم\b|/\s*م(?:2|٢|²)?\s*$", pt))
    row_price: dict[str, Any] = {"price_per_meter": price if per_m else None}
    if deal == "Buy":
        row_price["price_total"] = None if per_m else price
    elif not per_m:
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(price, own, None, title)
    an = _NUM.findall(re.sub(r"م\s*[2٢²]", "م", area_txt))
    area = normalize.to_int(an[0]) if len(an) == 1 and not several else None

    city_ar, district_txt = place(where)
    cat_cities = {c for c in in_cats if c not in _DEAL_CAT and to_catalog(c)[0]}
    conflict = bool(city_ar and cat_cities and city_ar not in cat_cities)
    if conflict:
        city_ar = district_txt = None
    elif not city_ar and len(cat_cities) == 1:
        city_ar = next(iter(cat_cities))
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    raw = re.sub(r"^(?:ح[يى]|منطقة)\s+", "", district_txt or "").strip() or None
    hit = find_district_in_text("حي " + raw, city_id) if (raw and city_id) else None
    district_ar = hit if hit and norm_district_tok(hit) == norm_district_tok(raw) else None

    rooms = {k: int(v.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")))
             for k, v in d["serv"].items() if k in ("icons139", "icons140") and re.fullmatch(r"[\d٠-٩]{1,2}", v)}
    ages = {x for sp in specs if (x := normalize.age_from_labelled_prose(sp)) is not None}
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d['id']}",
        "listing_url": d.get("canonical") or urllib.parse.quote(url, safe=":/"),
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii("\n".join(specs)[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": raw,
        "area_m2": float(area) if area else None,
        "bedrooms": rooms.get("icons139"),
        "bathrooms": rooms.get("icons140"),
        "property_age": ages.pop() if len(ages) == 1 else None,
        "photo_urls": list(d["photos"]),
        **row_price,
        **normalize.amenities_from_text("\n".join(specs)),
    }
    stored = row.get("price_per_meter") or (row.get("price_total") if deal == "Buy" else row.get("price_annual"))
    row["price_evidence"] = normalize.price_evidence(
        field="news_shape_txt_all price line", raw=pt or None, stored=stored,
        kind="per_meter" if per_m else ("total" if deal == "Buy" else "annual"),
        unit="per_meter" if per_m else "total", origin="structured", authoritative_absent=not pt)
    info = {
        "source_id": d["id"],
        "price_text": pt,
        "area_text": area_txt,
        "several_units": several or None,
        "location_text": where,
        "location_conflict": sorted(cat_cities) if conflict else None,
        "categories": in_cats,
        "latitude": d.get("lat"),
        "longitude": d.get("lng"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    row["source_capture"] = strip_pii_fields({
        "schema": "sqcc.realestate.v1", "title": title, "price_text": pt, "serv": d["serv"],
        "specs": [redact_pii(x) for x in specs], "location_text": where, "categories": in_cats})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    urls = [urllib.parse.unquote(u) for u in re.findall(r"<loc>([^<]+)</loc>", fetch(s, SITEMAP).text)]
    cats, where = walk_categories(s)
    print(f"{SOURCE}: {len(urls)} realestate post(s) in the sitemap; categories "
          + ", ".join(f"{k}={len(v)}" for k, v in cats.items()), flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for url in urls:
            r = fetch(s, urllib.parse.quote(url, safe=":/"))
            if r.status_code != 200:
                unreadable += 1
                continue
            got, why = map_listing(url, parse_page(r.text), cats, where.get(url))
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
                      ("ad_number", "title", "property_type", "transaction_type", "price_total", "price_per_meter",
                       "price_annual", "rent_period", "area_m2", "city_ar", "district_ar", "neighborhood")},
                      ensure_ascii=False)[:300])
            return 0

        db.upsert_sqcc_residential_batch(res)
        db.upsert_sqcc_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="sqcc_residential_listings", com_table="sqcc_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(urls) > 0
        for tbl, rr in (("sqcc_residential_listings", res), ("sqcc_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} of {len(urls)} page(s) unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=len(res) + len(com),
                             check_tables=["sqcc_residential_listings", "sqcc_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(urls), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
