"""مار العقارية — mar-ksa.com. 20 offers, onboarding 2026-09-23 (batch 36).

SOURCE SHAPE (measured live 2026-09-23 before any code was written)
===================================================================
A server-rendered PHP site (Arabic at /ar/). Two navigable surfaces list offers, and they are NOT
the same set:
    /ar/property/showitems   «العروض» — 10 cards (873-877, 880-884), no pagination (?page=2,
                             /showitems/2 and ?limit=100 all answer the same 10; the page repeats
                             its 10 cards in five slider copies, so ids are de-duplicated). These
                             cards carry the ONLY structured location on the site: <small
                             class="locat">«جدة - الصفا»</small>, plus a date, rooms, area, price.
    /ar/                     the home slider — 20 cards: the same 10 plus 870-872, 845 and
                             283-289 (dated 2020-12 → 2022-02). Home cards carry only image, date
                             and title — no location.
Detail pages /ar/property/showitem/<id> exist for both sets and for older, UNLISTED ids too (500,
800, 878, 879 render full priced offers reachable only by URL). The enumeration is the UNION of the
two navigable surfaces (20), each confirmed by a direct fetch of its own detail page.

· TRANSPORT: bare curl gets a Mod_Security 406; curl_cffi's chrome fingerprint is served with no
  extra header at all (measured: no headers / Accept-Language only / Referer only → 200, 10 ids).
· THE DETAIL PAGE is the source of every fact: <title>«مار العقاريه - <project>», five spec cells
  in `.realestate-features` each labelled by its own icon file (beds.svg «N غرف كبيره», select.svg
  «N متر مربع», bathtub.svg «N حمامات», microwave.svg «N مطبخ», garage.svg «N موقف سيارات») and
  the price <h5>«720000 ريال», a prose block under «مميزات العقار», and swiper images under
  /upload/<hash>.jpg (one fetched → HTTP 200 image/jpeg, JFIF magic).
· A ZERO CELL IS UNFILLED, NOT ZERO: the unlisted 878 renders «0 حمامات 0 مطبخ 0 موقف سيارات» on a
  five-room flat. 0 → NULL for every cell; the 10 catalogue offers all publish ≥ 1.
· TYPE is the parenthesised token in the title: «( شقق )» ×6 → Apartment; «( ملاحق )» ×4 (and
  «- ملحق» on 283) is a roof annex the shared map does not key → SKIPPED type_unmapped (ask-first:
  Apartment or Floor is an owner decision, not a scraper's).
· DEAL is stated only in prose: «شقق للبيع بجده حي الصفاء», «ملاحق للبيع». «للبيع» → Buy,
  «للإيجار» → Rent, both or neither → skipped. All 20 measured «للبيع».
· CITY: the «العروض» card's locat gives «جدة - <district>» for 10; the home-only offers state the
  city in prose («بجده», «في حي الصواري») — «جده» places through to_catalog (18, 2). An offer that
  names no city is skipped city_unstated, never defaulted (283 «ملاحق للبيع. من المالك مباشره»
  would be, were its type mapped). district_ar = find_district_in_text over the locat district or
  the prose: measured 9/12 (الصفا, الروابي, الربوة, النسيم, ابحر الشمالية, المروة, الصوارى,
  التيسير match; «صاري», «اليسير» do not — the card keeps the site's text as neighborhood).
· PRICE = the detail <h5> exactly («720000 ريال» → 720000). The prose says «الاسعار تبدا من
  720الف» (a project's starting price) — noted as price_note "starting_price", never altered.
  The list card's price is NOT read (the card above 873 prints 874's 740000 — the price div
  precedes the next card's link).
· BEDROOMS = the beds.svg cell (the site's own bed icon), dwellings only. bathrooms = bathtub cell.
  kitchen / parking = True when their cells publish ≥ 1. halls from «صاله» in the prose.
· AMENITY PROSE TRAP: 884 writes «لاغرفة سائق» — «لا» glued to «غرفة» = NO driver room. The shared
  amenities_from_text sees only «غرفة سائق» and returned driver_room True (measured). The glued
  negator is rewritten to «لا يوجد غرفة» before the scan (a normalize.py gap this scraper may not
  edit — reported), so the clause reads False. «غرفه شغاله» / «غرفه سائق» / «مطبخ» / «موقف خاص»
  are named → True.
· NO ad licence, no age, no facade, no street width, no furnished/elevator is published anywhere
  on the 20 pages → those columns stay NULL (source-does-not-publish).
· PDPL: the company phone/e-mail sit in the page chrome, not in the prose block; the description
  still passes through redact_pii.

REMOVAL ORACLE (measured 2026-09-23)
  · 4/4 never-existing ids (0, 1, 2, 999999): HTTP 200 with <title>«مار العقاريه - الصفحة
    الرئيسية», blank spec cells and the logo as the only slide — the soft-404 shell         → GONE
  · 10/10 catalogue ids and 4/4 unlisted-but-kept ids (500, 800, 878, 879): a project title and
    populated cells                                                                        → LIVE
  Catalogue absence alone is therefore NOT death on this source; it only SELECTS candidates and
  every removal is confirmed by a direct re-read of the page, gated by an in-run positive control
  (a row this run mapped must still render as itself) that fails CLOSED.

WRITES go through db._wasalt_batch("marksa_{residential,commercial}_listings", …) — the public
upsert_marksa_* wrappers are added centrally later. REMOVALS through prune_unseen with the oracle
above, only after the complete, non-limited enumeration.
"""
from __future__ import annotations

import argparse
import html as html_mod
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://mar-ksa.com"
SOURCE = "مار العقارية"
PREFIX = "MAR"
LIST_URL = f"{BASE}/ar/property/showitems"
HOME_URL = f"{BASE}/ar/"
ORACLE = "marksa.detail_page.showitem.project_title_and_cells"   # what mark_direct_alive certifies

_TYPE_OVERRIDES: dict[str, str] = {}
_DWELLINGS = {"Apartment", "Villa", "Floor"}
_SOFT_404_TITLE = "الصفحة الرئيسية"

_ID_RE = re.compile(r"/ar/property/showitem/(\d+)")
_H6_RE = re.compile(r"<h6>(.*?)</h6>", re.S)
_DATE_RE = re.compile(r'<div class="date">\s*<span>\s*([\d-]+)', re.S)
_LOCAT_RE = re.compile(r'class="locat">.*?alt="">\s*(.*?)\s*</small>', re.S)
_TITLE_RE = re.compile(r"<title>\s*مار العقاريه\s*-\s*(.*?)\s*</title>", re.S)
_CELL_RE = re.compile(
    r'<div class="items(?: price)?">\s*(?:<span class="icon">\s*<img src="[^"]*/([a-z]+)\.svg"[^>]*>\s*</span>)?'
    r'\s*<(p|h5)>\s*(.*?)\s*</\2>', re.S)
_DESC_RE = re.compile(r'<section class="features-details.*?<div class="items">\s*(.*?)\s*</div>', re.S)
_SLIDE_RE = re.compile(r'<div class="swiper-slide">\s*<img src="([^"]+)"', re.S)
_TYPE_TOKEN_RE = re.compile(r"\(\s*([^()]+?)\s*\)|-\s*(\S+)\s*$")
# When the title carries no «( … )» / «- …» token (286 «مشروع المروه جوار كبري مطار», 288 «ملاحق
# الصفا …»), the first type WORD in the title, then in the prose («شقق للبيع من المالك مباشره»).
_TYPE_WORD_RE = re.compile(r"(?<![\w])(شقق|شقة|شقه|ملاحق|ملحق|فيلا|فلل|دور|عمارة|ارض|أرض)(?![\w])")
# The site drops the ta-marbuta («بجده»); to_catalog accepts the alias, the canonical spelling is
# stored so city_ar matches the catalog's own name.
_CITY_CANON = {"جده": "جدة"}
_SALE_RE = re.compile(r"للبيع")
_RENT_RE = re.compile(r"للإيجار|للايجار|للأيجار|للاجار")
_CITY_RE = re.compile(r"(?<![\w])(?:ب|في\s+)?(جد[ةه])(?![\w])")
_HAY_RE = re.compile(r"حي\s+(\S+)")
_STARTING_RE = re.compile(r"تبد[اأ]ء?\s*من")
_CELL_COLS = {"beds": "rooms", "select": "area", "bathtub": "bathrooms", "microwave": "kitchen",
              "garage": "parking"}
# «لاغرفة سائق» — a negator glued to its noun. Rewritten to the shared parser's own vocabulary
# (a normalize.py gap this scraper may not edit; see docstring).
_GLUED_NEGATOR = (("لاغرفة", "لا يوجد غرفة"), ("لاغرفه", "لا يوجد غرفة"))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent — never set one
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def parse_cards(page_html: str) -> dict[str, dict]:
    """Every offer card on a list/home page → {id: {title, date, locat}} (de-duplicated: the
    «العروض» page repeats its cards in five slider copies). A card's price is NOT read — the
    price div sits before the NEXT card's link in the markup."""
    out: dict[str, dict] = {}
    for chunk in page_html.split('<div class="items">')[1:]:
        m = _ID_RE.search(chunk)
        if not m:
            continue
        ad_id = m.group(1)
        h6, date, locat = _H6_RE.search(chunk), _DATE_RE.search(chunk), _LOCAT_RE.search(chunk)
        card = out.setdefault(ad_id, {"id": ad_id})
        if h6 and not card.get("title"):
            card["title"] = html_mod.unescape(re.sub(r"\s+", " ", h6.group(1))).strip()
        if date and not card.get("date"):
            card["date"] = date.group(1)
        if locat and not card.get("locat"):
            card["locat"] = html_mod.unescape(re.sub(r"\s+", " ", locat.group(1))).strip()
    return out


def fetch_cards(s: cc.Session) -> dict[str, dict]:
    """The union of both navigable surfaces; the «العروض» card (with locat) wins on overlap."""
    cards: dict[str, dict] = {}
    for url in (HOME_URL, LIST_URL):
        r = s.get(url, timeout=40)
        if r.status_code != 200:
            raise RuntimeError(f"{url} answered HTTP {r.status_code} — blocked, not empty")
        for ad_id, card in parse_cards(r.text).items():
            merged = cards.setdefault(ad_id, {"id": ad_id})
            merged.update({k: v for k, v in card.items() if v})
        time.sleep(1.0)
    return cards


def fetch_detail(s: cc.Session, ad_id: str) -> Optional[str]:
    r = s.get(f"{BASE}/ar/property/showitem/{ad_id}", timeout=40)
    return r.text if r.status_code == 200 and r.text else None


def _text(fragment: str) -> str:
    t = re.sub(r"<br\s*/?>|</p>|</div>", "\n", fragment)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html_mod.unescape(t).replace("\xa0", " ")
    return "\n".join(line.strip() for line in re.sub(r"[ \t]+", " ", t).splitlines() if line.strip())


def parse_detail(page_html: str) -> dict[str, Any]:
    """The detail page's own facts. `soft_404` is True for the site's «الصفحة الرئيسية» shell."""
    title = _TITLE_RE.search(page_html)
    title_s = html_mod.unescape(re.sub(r"\s+", " ", title.group(1))).strip() if title else ""
    cells: dict[str, str] = {}
    for icon, tag, body in _CELL_RE.findall(page_html):
        key = "price" if tag == "h5" else _CELL_COLS.get(icon)
        if key:
            cells[key] = re.sub(r"\s+", " ", html_mod.unescape(body)).strip()
    desc = _DESC_RE.search(page_html)
    slides = [u for u in dict.fromkeys(_SLIDE_RE.findall(page_html)) if not u.endswith("/logo.png")]
    populated = any(re.search(r"\d", v or "") for k, v in cells.items() if k != "price")
    return {
        "title": title_s,
        "cells": cells,
        "description": _text(desc.group(1)) if desc else "",
        "photos": [u if u.startswith("http") else f"{BASE}/{u.lstrip('/')}" for u in slides],
        "soft_404": (not title_s) or title_s == _SOFT_404_TITLE or not populated,
    }


def _count(v: Optional[str]) -> Optional[int]:
    """A spec cell's leading number; 0 is unfilled on this source (878 measured) → None."""
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def _type_token(title: str, prose: str = "") -> Optional[str]:
    """The site's own type word: the title's «( شقق )» / «- ملحق» token, else the first type word
    in the title, else in the prose. None when the source names no type."""
    m = _TYPE_TOKEN_RE.search(title or "")
    if m:
        return (m.group(1) or m.group(2)).strip()
    for text in (title or "", prose or ""):
        w = _TYPE_WORD_RE.search(text)
        if w:
            return w.group(1)
    return None


def _vocab(text: str) -> str:
    for glued, spaced in _GLUED_NEGATOR:
        text = text.replace(glued, spaced)
    return text


def map_listing(card: dict, detail: dict) -> tuple[Optional[dict], str, str]:
    """One card + its parsed detail page → (row|None, category, skip_reason)."""
    ad_id = str(card.get("id") or "").strip()
    if not ad_id.isdigit():
        return None, "residential", "no_id"
    if detail.get("soft_404"):
        return None, "residential", "soft_404"
    title = detail.get("title") or card.get("title") or ""
    prose = f"{title}\n{detail.get('description') or ''}"
    type_ar = _type_token(title, detail.get("description") or "")
    property_type = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES) if type_ar else None
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    sale, rent = bool(_SALE_RE.search(prose)), bool(_RENT_RE.search(prose))
    if sale == rent:
        return None, category, "deal_ambiguous" if sale else "deal_unstated"
    deal = "Buy" if sale else "Rent"

    # The «العروض» card's own field first («جدة - الصفا»); a home-only offer states its city in the
    # prose («بجده») or not at all — never defaulted. The meta-keywords «… للبيع جده» is the
    # site's template (present on the soft-404 shell too) and is deliberately not read.
    locat = card.get("locat") or ""
    loc_parts = [p.strip() for p in locat.split(" - ") if p.strip()]
    hay = _HAY_RE.search(detail.get("description") or "")
    if loc_parts:
        city_ar, district_raw = loc_parts[0], (loc_parts[1] if len(loc_parts) > 1 else None)
    else:
        m = _CITY_RE.search(prose)
        if not m:
            return None, category, "city_unstated"
        city_ar, district_raw = m.group(1), (hay.group(1) if hay else None)
    city_ar = _CITY_CANON.get(city_ar, city_ar)
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    # The site's own district text is what the card shows; the canonical match comes from that
    # text, or — only when it matches nothing (881's locat «صاري» is a street) — from the prose's
    # explicit «حي X» phrase, never from a landmark mentioned anywhere in the body.
    district_ar = (find_district_in_text(district_raw, city_id) if district_raw else None) \
        or (find_district_in_text(hay.group(1), city_id) if hay else None)

    cells = detail.get("cells") or {}
    price_raw = cells.get("price")
    price = normalize.to_int(price_raw)
    description = redact_pii(detail.get("description") or "") or None
    scan = _vocab(description or "")

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ad_id}",
        "listing_url": f"{BASE}/ar/property/showitem/{ad_id}",
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": description,
        **normalize.amenities_from_text(scan),
        **{k: v for k, v in normalize.rooms_from_phrase(scan).items() if k == "halls"},
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _count(cells.get("area")),
        "bedrooms": _count(cells.get("rooms")) if property_type in _DWELLINGS else None,
        "bathrooms": _count(cells.get("bathrooms")) if property_type in _DWELLINGS else None,
        "photo_urls": (detail.get("photos") or [])[:20] or None,
    }
    if _count(cells.get("kitchen")):
        row["kitchen"] = True
    if _count(cells.get("parking")):
        row["parking"] = True
    if deal == "Rent":
        period, annual = normalize.rent_period_and_annual(price, price_raw or "")
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price

    row["additional_info"] = {k: v for k, v in {
        "ad_id": ad_id,
        "type_ar": type_ar,
        "card_date": card.get("date"),
        "locat_raw": locat or None,
        "cells_raw": cells or None,
        "price_evidence": normalize.price_evidence(
            field="detail .realestate-features h5", raw=price_raw, stored=price,
            kind="annual" if deal == "Rent" else "total", unit="total", origin="spec_table"),
        "price_note": "starting_price" if _STARTING_RE.search(prose) else None,
        "source_rooms": cells.get("rooms"),
    }.items() if v is not None and v != ""}
    # A direct read of THIS page (fetched by its own id, project title + populated cells).
    db.mark_direct_alive(row, oracle=ORACLE)
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
def _signal(status, body, _moved):
    if status != 200 or not body:
        return None
    parsed = parse_detail(body)
    if not parsed["title"]:
        return None                      # not this site's page at all — no opinion
    return "gone" if parsed["soft_404"] else "live"


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None) -> tuple[str, str]:
        digits = ad_number[len(PREFIX):]
        if not ad_number.startswith(PREFIX) or not digits.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform="marksa", signal=_signal, session=session,
                             url_for=lambda _ad: f"{BASE}/ar/property/showitem/{digits}",
                             canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("marksa")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    notes = ""
    try:
        cards = fetch_cards(s)
        if not cards:
            raise RuntimeError("no /ar/property/showitem/<id> cards on the home or «العروض» page")
        ids = sorted(cards, key=int, reverse=True)
        if args.limit:
            ids = ids[:args.limit]
        print(f"{SOURCE}: {len(ids)} offers across the home slider + «العروض»", flush=True)
        for ad_id in ids:
            seen += 1
            time.sleep(1.0)                                   # polite: one page at a time
            page = fetch_detail(s, ad_id)
            if not page:
                skipped["detail_unreadable"] = skipped.get("detail_unreadable", 0) + 1
                continue
            row, cat, why = map_listing(cards[ad_id], parse_detail(page))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}", flush=True)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):5} d={str(r0['district_ar'])[:14]:14} nb={str(r0['neighborhood'])[:12]:12} "
                      f"a={str(r0['area_m2']):>4} bd={r0['bedrooms']} ba={r0['bathrooms']} "
                      f"p={str(r0.get('price_total') or r0.get('price_annual')):>8} k={r0.get('kitchen')} "
                      f"pk={r0.get('parking')} dr={r0.get('driver_room')} md={r0.get('maid_room')} "
                      f"h={r0.get('halls')} ph={len(r0.get('photo_urls') or [])} | {r0['title'][:28]}")
            return 0

        # The public upsert_marksa_* wrappers are added centrally later; the shared batch writer is
        # the same path they will delegate to.
        db._wasalt_batch("marksa_residential_listings", res)
        db._wasalt_batch("marksa_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="marksa_residential_listings", com_table="marksa_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after the complete enumeration of both surfaces (--limit never reaches here;
        # a --type run holds the other table's seen-set empty by construction), confirmed per row by
        # the page re-read and gated by the in-run positive control. prune_unseen's breakers on top.
        pruned = 0
        if args.type == "all":
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("marksa_residential_listings", res),
                              ("marksa_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["marksa_residential_listings",
                                           "marksa_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0,
                       notes=(f"{e} | skips: {notes}" if notes else str(e))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
