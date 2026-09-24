"""فكر الإعمار — fkralemar.com. A Site123 e-commerce store: each flat is a "product". Sale-only developer (Jeddah).

SOURCE SHAPE (measured live 2026-09-24, before any code):
  · CATALOGUE. /offers (the store front, 10 cards) links the two category pages under
    «الأحياء السكنية المتاحة» («حي الروضة» → /offers/apartments-for-sale-in-jeddah, 21 cards;
    «حي النعيم» → /offers/apartments-for-sale, 17 cards). Every card carries the product's stable
    id `data-unique-id="6a0e437bdb866"` (→ ad_number FKR6a0e437bdb866), its href, the ribbon
    «للبيع» or «مباع», the title («شقه 4 غرف ( 140م )») and the price. Union of the three pages =
    38 unique products (10 «للبيع», 28 «مباع»); every page states data-pagination-products-left="0" (nothing hidden behind
    a "load more"), which the run asserts — a page that says otherwise aborts the run.
    THE SITEMAP IS NOT THE CATALOGUE: sitemap.xml lists 47 /offers/ URLs = 2 categories + 45
    products; 7 products are in the sitemap but on NO catalogue page (Site123 "hidden" products —
    they answer 200 with a price, e.g. /offers/villa-for-sale). A user browsing the store never
    sees them and they carry no ribbon, so they are not enumerated.
  · SOLD lives ONLY on the card. A «مباع» product's own page is byte-identical in shape to a live
    one (JSON-LD availability InStock, «احجز الان» button, no ribbon — checked on 6874de87b6a99).
    So the card ribbon is the status, and the removal oracle consults this run's card map first.
  · PRODUCT PAGE. `<p class="description">` holds the facts as prose: «3 غرف + 2 دورات مياه + مطبخ
    + صاله / ( المساحة : 124م ) / خزانين علوي وسفلي + عداد مستقل + موقف خاص مظلل + اتحاد ملاك» and
    sometimes «الترخيص : 7100036456». JSON-LD Product.offers.price == the card price (cross-checked;
    a mismatch aborts that listing as price_conflict). Images: og:image + gallery
    https://files.cdn-files-a.com/uploads/7951564/800_<id>.png (fetched: 200, served as image/webp).
  · PRICE = SOURCE. «شقه 3 غرف ( 124م)» is priced 7000000 (a probable typo for 700000) — stored
    exactly as printed. No per-metre figure exists on any product (0/38).
  · TYPE from the card title's leading noun: «شقه …» / «شقه روف …» → Apartment (the source's own
    noun; «روف» qualifies it), «فيلا» → Villa. A title leading with a bare «روف» has no canonical
    type → type_unmapped.
  · CITY. The product page never names the city; the CATEGORY page's meta description does
    («… في حي الروضة جدة …», «… في حي النعيم جدة …»). Each card's category is known from the page
    it was read on; the city word is the one right after «حي <district>» in that description
    («جدة» → 18) — never a free scan of the marketing sentence. A product read only from /offers
    takes the category its breadcrumb names.
    district = find_district_in_text(category name, city_id) → «حي الروضة» / «حي النعيم».
  · PDPL: descriptions can carry «للتواصل : 05…» → redact_pii; no agent names seen.
  · REMOVAL ORACLE (measured 2026-09-24): an unknown /offers/<slug> answers a REAL HTTP 404 (title
    «404 - لم يتم العثور على الصفحة», 3/3 invented slugs); a live product answers 200 with
    `product-container … data-unique-id="<id>"` (3/3 controls). Signal: this run's card map says
    «مباع» → gone; 404 with that title → gone; 200 carrying the id → live; else no opinion.
    The probe's URL map is built from EVERY card of this run's catalogue (a prune candidate is never
    a mapped row); an id on no catalogue page stays unknown without a fetch.
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import city_ar_for, find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://www.fkralemar.com"
SOURCE = "فكر الإعمار"
PREFIX = "FKR"
RES_TABLE = "fkralemar_residential_listings"
COM_TABLE = "fkralemar_commercial_listings"
STORE = f"{BASE}/offers"
_PAUSE = 0.8

SOLD = "مباع"
NOT_FOUND_TITLE = "لم يتم العثور على الصفحة"
_LEAD_TYPE = {"شقه": "Apartment", "شقة": "Apartment", "فيلا": "Villa", "فله": "Villa", "عمارة": "Building",
              "عماره": "Building", "ارض": "Residential Land", "أرض": "Residential Land"}
# Anchored on the PRODUCT box class: the category tiles («e-c-box») carry a data-unique-id too.
CARD_RE = re.compile(
    r'e-commerce-product-box[^>]*data-unique-id="([0-9a-f]+)".*?href="(/offers/[^"]+)"'
    r'.*?product-ribbon-banner[^>]*>\s*([^<]*?)\s*<'
    r'.*?product-title"><a[^>]*>\s*([^<]*?)\s*<.*?data-type="price">([^<]*)<', re.S)
CATEGORY_RE = re.compile(r'class="e-c-box"[^>]*>.*?<a href="(/offers/[^"]+)" class="image-container[^"]*">'
                         r'.*?aria-label="([^"]+)"', re.S)
# «( المساحة : 124م )», «مساحة ٢٣١ م .» (no «ال», Arabic-Indic digits), or the title's «( 140م )».
AREA_RE = re.compile(r"(?:ال)?مساح[ةه]\s*:?\s*([\d٠-٩]+)\s*م|\(\s*([\d٠-٩]+)\s*م\s*\)")
ROOMS_RE = re.compile(r"([\d٠-٩]{1,2})\s*غرف")
BATHS_RE = re.compile(r"([\d٠-٩]{1,2})\s*دور(?:ة|ات)\s*ميا[هة]")


def session() -> cc.Session:
    # impersonate owns the User-Agent — never set one here.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def fetch(s: cc.Session, url: str) -> str:
    r = s.get(url, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"{url} → HTTP {r.status_code}")
    return r.text


def parse_cards(page_html: str) -> list[dict[str, str]]:
    """Every product card on a catalogue page. Refuses a page that hides cards behind pagination."""
    left = re.search(r'data-pagination-products-left="([^"]*)"', page_html)
    if left and left.group(1) not in ("", "0"):
        raise RuntimeError(f"catalogue page hides {left.group(1)} more products behind pagination")
    return [{"uid": uid, "href": ihtml.unescape(href), "ribbon": ribbon, "title": ihtml.unescape(title),
             "price_raw": price} for uid, href, ribbon, title, price in CARD_RE.findall(page_html)]


def parse_categories(store_html: str) -> list[tuple[str, str]]:
    """[(href, name)] from the store front's «الأحياء السكنية المتاحة» tiles."""
    return [(ihtml.unescape(href), ihtml.unescape(name).strip()) for href, name in CATEGORY_RE.findall(store_html)]


def category_city_text(cat_html: str) -> str:
    m = re.search(r'<meta name="description" content="([^"]*)"', cat_html)
    return ihtml.unescape(m.group(1)) if m else ""


def parse_product(page_html: str) -> dict[str, Any]:
    d = re.search(r'<p class="description">(.*?)</p>', page_html, re.S)
    ld_price = None
    for blob in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page_html, re.S):
        try:
            j = json.loads(blob)
        except ValueError:
            continue
        if isinstance(j, dict) and j.get("@type") == "Product":
            ld_price = (j.get("offers") or {}).get("price")
    imgs: list[str] = []
    for u in re.findall(r'(https://files\.cdn-files-a\.com/uploads/\d+/(?:800|normal)_[0-9a-f]+\.(?:png|jpe?g|webp))',
                        page_html):
        if u not in imgs:
            imgs.append(u)
    bc = re.search(r'<ol class="breadcrumb.*?</ol>', page_html, re.S)
    cat = re.findall(r'<a href="(/offers/[^"]+)">([^<]+)</a>', bc.group(0)) if bc else []
    uid = re.search(r'product-container[^>]*data-unique-id="([0-9a-f]+)"', page_html)
    return {"uid": uid.group(1) if uid else None,
            "description": ihtml.unescape(re.sub(r"<[^>]+>", "", d.group(1))).strip() if d else "",
            "ld_price": ld_price, "photos": imgs, "category": cat[0] if cat else None}


def resolve_city(text: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """The city is the word right after «حي <district>» in the category's own text («… في حي الروضة
    جدة …»). A free word scan would relocate every product on any stray town-like word before it."""
    # ponytail: one-word districts only (both live categories); a two-word district fails CLOSED.
    m = re.search(r"حي\s+\S+\s+([\u0621-\u064a\u0671-\u06d3]{3,})", text or "")
    if not m:
        return None, None, None
    w = m.group(1)
    w = w[1:] if w[0] in "بل" and len(w) > 3 else w
    cid, rid = to_catalog(w)
    return (cid, rid, city_ar_for(cid) or w) if cid else (None, None, None)


def map_listing(card: dict[str, str], product: dict[str, Any], category_name: Optional[str],
                city_text: str) -> tuple[Optional[dict], str, str]:
    """One catalogue card + its product page → (row, category, skip_reason)."""
    if not card.get("uid"):
        return None, "residential", "no_id"
    if card.get("ribbon") == SOLD:
        return None, "residential", "sold"
    title = card["title"]
    lead = title.split()[0] if title.split() else ""
    ptype = _LEAD_TYPE.get(lead)
    if not ptype:
        return None, "residential", f"type_unmapped[{lead or 'none'}]"
    category = normalize.category_for_type(ptype).lower()
    price = normalize.to_int(card.get("price_raw"))
    if product.get("ld_price") is not None and normalize.to_int(product["ld_price"]) != price:
        return None, category, "price_conflict"
    city_id, region_id, city_ar = resolve_city(city_text)
    if not city_id:
        return None, category, "city_not_in_catalog"
    desc = redact_pii(product.get("description") or "") or None
    text = f"{title}\n{desc or ''}"
    am = AREA_RE.search(text)
    rm, bm = ROOMS_RE.search(title) or ROOMS_RE.search(desc or ""), BATHS_RE.search(desc or "")
    # Rule 6: bedrooms/bathrooms are one DWELLING's room count. Building/Residential Land carry an
    # aggregate ("عمارة 8 غرف") that is not one unit's — same gate as shatri/alqasem in this batch.
    dwelling = ptype in ("Apartment", "Villa", "Duplex", "Floor", "Studio")
    beds = normalize.to_int(rm.group(1)) if rm else None
    baths = normalize.to_int(bm.group(1)) if bm else None
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{card['uid']}",
        "listing_url": BASE + card["href"], "source": SOURCE, "active": True,
        "title": title, "description": desc,
        # «( تأسيس مصعد )» puts the prepared-word BEFORE the token; the shared helper only checks
        # the words after it, so the clause is cut here (elevator stays NULL — a shaft is not a lift).
        **normalize.amenities_from_text(re.sub(r"ت[أا]سيس\s+\S+", " ", desc or "")),
        "property_type": ptype, "transaction_type": "Buy",
        "city": normalize.map_city(city_ar), "city_ar": city_ar, "city_id": city_id, "region_id": region_id,
        "district_ar": find_district_in_text(category_name, city_id) if category_name else None,
        "neighborhood": category_name,
        "area_m2": normalize.to_int(am.group(1) or am.group(2)) if am else None,
        "bedrooms": beds if dwelling else None,
        "bathrooms": baths if dwelling else None,
        "license_number": normalize.ad_licence_from_prose(desc),
        "price_total": price,
        "photo_urls": product.get("photos")[:20] or None,
    }
    d = desc or ""
    if re.search(r"صالتين|صالتان", d):
        row["halls"] = 2
    elif (hm := re.search(r"([\d٠-٩]{1,2})\s*صالات", d)):
        row["halls"] = normalize.to_int(hm.group(1))
    elif re.search(r"\bصال[ةه]\b|\+\s*صال", d):
        row["halls"] = 1
    row["additional_info"] = {k: v for k, v in {
        "site123_uid": card["uid"], "ribbon": card.get("ribbon"), "price_raw": card.get("price_raw"),
        "ld_price": product.get("ld_price"), "category_href": (product.get("category") or [None])[0],
        "bedrooms_raw": beds if not dwelling else None, "bathrooms_raw": baths if not dwelling else None,
    }.items() if v is not None}
    return row, category, ""


# ── LIVENESS (see the docstring's measured oracle) ───────────────────────────────────────────────
def _signal_for(uid: str, ribbon_by_uid: dict[str, str]):
    def _signal(status, body, _moved):
        if ribbon_by_uid.get(uid) == SOLD:
            return "gone"                                  # this run's own complete catalogue read
        if status == 404 and NOT_FOUND_TITLE in (body or ""):
            return "gone"
        if status == 200 and re.search(rf'product-container[^>]*data-unique-id="{uid}"', body or ""):
            return "live"
        return None
    return _signal


def _make_verify_gone(url_by_ad: dict[str, str], ribbon_by_uid: dict[str, str]):
    def verify_gone(ad_number: str) -> tuple[str, str]:
        uid = ad_number[len(PREFIX):]
        if not re.fullmatch(r"[0-9a-f]{8,}", uid):
            return "unknown", f"{ad_number!r} is not a {PREFIX}<site123 id> ad number"
        return LivenessProbe(platform="fkralemar", signal=_signal_for(uid, ribbon_by_uid), session=session,
                             url_for=lambda ad: url_by_ad.get(ad)).verify_gone(ad_number)
    return verify_gone


def enumerate_catalogue(s: cc.Session) -> tuple[dict[str, dict[str, str]], dict[str, str], dict[str, str]]:
    """(cards by uid, category name by uid, category city-text by category name). Store front + every
    category page; a card seen on several pages keeps the first ribbon (identical on all — measured)."""
    store = fetch(s, STORE)
    cards: dict[str, dict[str, str]] = {}
    cat_of: dict[str, str] = {}
    city_text: dict[str, str] = {}
    cats = parse_categories(store)
    for href, name in cats:
        time.sleep(_PAUSE)
        page = fetch(s, BASE + href)
        city_text[name] = category_city_text(page)
        for c in parse_cards(page):
            cards.setdefault(c["uid"], c)
            cat_of.setdefault(c["uid"], name)
    for c in parse_cards(store):
        cards.setdefault(c["uid"], c)
    return cards, cat_of, city_text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("fkralemar")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        cards, cat_of, city_text = enumerate_catalogue(s)
        if not cards:
            raise RuntimeError("no product cards on the store front or its category pages")
        print(f"{SOURCE}: {len(cards)} products on the catalogue pages "
              f"({sum(c['ribbon'] == SOLD for c in cards.values())} marked {SOLD})", flush=True)
        # EVERY card resolves to its page — a prune candidate is never a row mapped this run, and 28 of
        # 38 products are «مباع» cards whose only status is the ribbon; a map of mapped rows only would
        # answer "unknown" for all of them and no sold product could ever be retired.
        url_by_ad = {f"{PREFIX}{u}": BASE + c["href"] for u, c in cards.items()}
        ribbon_by_uid = {u: c["ribbon"] for u, c in cards.items()}
        todo = list(cards.values())[:args.limit] if args.limit else list(cards.values())
        for card in todo:
            if card["ribbon"] == SOLD:
                skipped["sold"] = skipped.get("sold", 0) + 1
                continue
            time.sleep(_PAUSE)
            product = parse_product(fetch(s, BASE + card["href"]))
            cat_name = cat_of.get(card["uid"]) or ((product.get("category") or [None, None])[1])
            row, cat, why = map_listing(card, product, cat_name, city_text.get(cat_name or "", ""))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>16} {r0['property_type']:10} {r0['city_ar']:6} d={str(r0['district_ar']):10} "
                      f"a={str(r0['area_m2']):>4} p={str(r0['price_total']):>8} b={r0['bedrooms']}/{r0['bathrooms']} "
                      f"lic={r0['license_number']} park={r0.get('parking')} ph={len(r0['photo_urls'] or [])} {r0['title']}")
            return 0
        # public upsert_fkralemar_*_batch wrappers are added centrally later; the shared batch writer is used directly.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE,
                                                   res_ads={r["ad_number"] for r in res},
                                                   com_ads={r["ad_number"] for r in com}, source=SOURCE)
        pruned = 0
        # Prune only after the COMPLETE catalogue (all category pages, pagination asserted empty) and
        # with a positive control: this run mapped at least one live product.
        if args.type == "all" and (res or com):
            verify_gone = _make_verify_gone(url_by_ad, ribbon_by_uid)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(cards), rows_upserted=len(res) + len(com),
                             check_tables=["fkralemar_residential_listings", "fkralemar_commercial_listings"],
                             notes=f"pruned={pruned} superseded={superseded} {notes}"[:300])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e} | skips: " + ", ".join(f"{k}x{v}" for k, v in skipped.items()))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
