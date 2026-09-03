"""أركان العقار (arkaanalaqar.com) scraper — single-office Saudi brokerage in الأحساء (Al-Ahsa).

WHAT THE SITE IS. One licensed brokerage office (مكتب أركان العقار) publishing its own inventory on a
server-rendered ASP.NET/IIS site. 100% of the catalogue is الأحساء (Hofuf/Mubarraz/villages) — the
JSON-LD `addressLocality` is the constant "الأحساء" on every listing. No API (robots.txt disallows
/api/), no JS needed, no CAPTCHA, no login. robots.txt is `Allow: /` with the listing paths
(/, /rentals, /lands, /property/N) explicitly permitted and the sitemap advertised.

EXTRACTION MECHANISM (two layers, both server-rendered):
  1. INDEX — GET / then follow `<link rel="next">` until it is absent. 20 listings/page, 54 pages.
     Each listing appears twice per page (a card and a table row); we key both on `data-adid`.
     The card carries stable data-* attributes (adid / landno / neighborhood / ptype / contract /
     status); the table row carries the price, the label→value spec pairs (المساحة، الشارع، الدور،
     غرف النوم، المجلس، عدد الشقق، الحالة، النشاط …) and the title that distinguishes أرض تجارية
     from أرض. TERMINATION IS `rel=next`, NEVER an empty page: /?page=55 silently RE-SERVES page 54,
     so an "empty page" terminator loops forever.
  2. DETAIL — GET /property/{id} for the authoritative price (schema.org RealEstateListing JSON-LD),
     the full gallery, datePosted, the GPS pair, the clean «نوع العقار» line, and the free-text ad
     body (the ONLY place this source ever states a rental period).

ENCODING TRAP: Arabic is served as numeric HTML entities (&#x627;…). Every response is
html.unescape()d BEFORE any Arabic regex, or every Arabic pattern silently matches nothing.

REALNESS EVIDENCE (verified live 2026-09-02 by walking all 54 index pages):
  • 1,072 distinct ids — exactly the count in sitemap.xml, reconciled two independent ways.
  • 154 distinct real Al-Ahsa districts; prices 1,200 → 5,000,000 SAR; per-listing GPS coordinates
    that vary and land inside Al-Ahsa's bounding box (25.30–25.47N, 49.56–49.90E).
  • Distinct photos per listing (no shared stock imagery); freshness stamps from «قبل ساعتين» to
    «قبل 14 يوم»; a CLOSED 12-value property-type vocabulary and a 25-value title vocabulary.
  Not a demo/seeded catalogue.

WHAT THIS SOURCE DOES NOT PUBLISH (→ stored as NULL, never as a default):
  • bathrooms — no structured field anywhere; appears only as prose («دورتين مياه»).
  • rent period — no structured field. It surfaces only inside the listing's own ad body
    («السعر 30 ألف ريال سنوياً»), so rent_period is read from THAT text and from nothing else.
  • property age — «جاهز»/«مجددة» are condition words, not an age.
  • per-listing REGA/FAL ad licence — the «رقم فال 1200009258» on every detail page is the OFFICE's
    brokerage licence, byte-identical across listings. Storing it per listing would fabricate a
    licence, so it is NOT stored and rega_location_verified is left unset (NULL, not False).

PRICE = SOURCE. The price CARD on the detail page is the authority (a labelled DOM element, not
prose). It publishes the total under «السعر» (firm) or «السوم» (a standing bid) and, separately, the
per-square-metre rate under «سعر المتر»/«سوم المتر» — each stored in its OWN column, never folded
into the other and never multiplied out. «السعر على السوم» (no figure at all) is the source stating
there is no price and maps to an AUTHORITATIVE NULL — never 0, never inferred. Reconciled across 92
live listings: card total, JSON-LD offers.price and the index price cell agreed 92/92, and the card
additionally covered the 11 listings where JSON-LD emits `offers: null`.

LIVENESS ORACLE (not wired here, noted for the integration step): a removed listing returns HTTP
410 Gone at its own /property/{id} URL, a never-existing id returns 404, a live one returns 200 —
an explicit three-way answer, which is unusually good for lifecycle handling.

  python -m scrapers.arkaan.run --type all --limit 15 --dry-run   # validate, ZERO db writes
  python -m scrapers.arkaan.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

from scrapers.common import db
from scrapers.common import normalize as N
from scrapers.common.arabic_location import to_catalog

BASE = "https://arkaanalaqar.com"
SOURCE = "Arkaan"
THROTTLE = 0.7          # seconds between requests — one small office's origin, be gentle
TIMEOUT = 30
RETRIES = 3

# ── PDPL redaction (same shape as scrapers/october/run.py) ────────────────────────────────────────
_PHONE = re.compile(r"(?:\+?9665\d{7,}|\b0?5\d{8}\b|\b9[02]0\d{6,}\b|\b800\d{6,}\b|wa\.me/\S+)")
_CUT = re.compile(r"(للتواصل|للحجز|للاستفسار|اتصل|تواصل|واتساب|واتس|جوال|الجوال|المعلن|الوسيط|"
                  r"المسوق|اسم المعلن|رقم الاعلان|رقم الإعلان|hotline|whatsapp|call us)", re.I)


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    m = _CUT.search(text)
    if m:
        text = text[:m.start()]
    text = _PHONE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip() or None


# ── parsing ───────────────────────────────────────────────────────────────────────────────────────
_CARD = re.compile(
    r'data-adid="(?P<id>\d+)"\s+data-landno="(?P<landno>[^"]*)"\s+'
    r'data-neighborhood="(?P<hood>[^"]*)"\s+data-ptype="(?P<ptype>[^"]*)"\s+'
    r'data-contract="(?P<deal>[^"]*)"\s+data-status="(?P<status>[^"]*)"')
_ROW = re.compile(r'<tr[^>]*data-adid="(\d+)"[^>]*>(.*?)</tr>', re.S)
_PAIR = re.compile(r'<span class="lc-label[^"]*">(.*?)</span>\s*'
                   r'<span[^>]*aqar-table-main-value[^>]*>(.*?)</span>', re.S)
_PRICE_CELL = re.compile(r'aqar-table-price-value"[^>]*>(.*?)</span>', re.S)
_TITLE = re.compile(r'lc-title[^>]*>(.*?)</span>', re.S)
_FRESH = re.compile(r'last-updated"[^>]*data-id="\d+"[^>]*>(.*?)</span>', re.S)
_NEXT = re.compile(r'<link rel="next" href="([^"]+)"')
_LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
_STYLE = re.compile(r"<(style|script)\b.*?</\1>", re.S | re.I)
_TYPE_TEXT = re.compile(r'نوع العقار:\s*</span>\s*<span[^>]*>(.*?)</span>', re.S)
# ONLY the map box's own node — some pages carry a second maps?q= pair on an unrelated action button.
_COORDS = re.compile(r'id="box-map"[^>]*data-map-url="[^"]*maps\?q=(-?[\d.]+),(-?[\d.]+)')
_ADTEXT = re.compile(r'detail-order-adtext[^>]*>(.*?)</div>', re.S)
# The price CARD — a dedicated labelled DOM element, not prose. It is strictly richer than the
# JSON-LD: reconciled over 92 live listings (2026-09-02), `offers.price` was null on 11 of them
# while the card published a total on 7 (labelled «السوم» — a standing bid — instead of «السعر»),
# and the per-square-metre rate appears ONLY here, on 69 of 92. Where all three sources exist
# (card / JSON-LD / index price cell) they agreed on 92 of 92 — zero disagreements.
_PRICE_CARD = re.compile(r'detail-order-price[^>]*>(.*?)(?=<!--)', re.S)
_CARD_TOTAL = re.compile(r'(السعر|السوم)\s*([\d,٬]+)\s*ريال')
_CARD_PPM = re.compile(r'(?:سعر|سوم)\s*المتر\s*([\d,٬]+)\s*ريال')

# The ONE Arabic label this source uses that the shared canonical map does not carry. «دبلكس» is a
# spelling variant of «دوبلكس» (already in TYPE_MAP_AR → "Duplex"); this maps to that SAME existing
# canonical type — no new Arabic label, no new English type. Passed as normalize's documented
# per-platform `overrides` (EXACT-match only, never substring-expanded), so it cannot leak into any
# other input. 63 of the 1,072 live listings depend on it.
TYPE_OVERRIDES = {"دبلكس": "Duplex"}


def _text(s: str) -> str:
    """Tag-strip + whitespace-collapse one already-unescaped HTML fragment."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def _session() -> cc.Session:
    return cc.Session(impersonate="chrome124", timeout=TIMEOUT)


def _get(s: cc.Session, url: str) -> tuple[int, str]:
    """(status, html.unescape()d body). Bounded retries on transport/5xx, polite fixed throttle."""
    last = 0
    for attempt in range(RETRIES):
        try:
            r = s.get(url)
        except Exception:
            time.sleep(THROTTLE * (attempt + 2))
            continue
        last = r.status_code
        if r.status_code == 200:
            time.sleep(THROTTLE)
            return 200, html.unescape(r.text)
        if r.status_code in (404, 410):          # a verdict, not a failure — do not retry
            return r.status_code, ""
        time.sleep(THROTTLE * (attempt + 2))
    return last, ""


def _index_page(body: str) -> list[dict[str, Any]]:
    """One index page → one dict per listing, merging the card attributes with its table row."""
    rows = {aid: rb for aid, rb in _ROW.findall(body)}
    out: list[dict[str, Any]] = []
    for m in _CARD.finditer(body):
        card = m.groupdict()
        rb = rows.get(card["id"], "")
        # The value span sometimes swallows trailing markup ("500 م²</span> بعد الإضافة 750 م²"),
        # which drags the NEXT label into the captured key — keep only the text after the last '>'.
        specs: dict[str, str] = {}
        for k, v in _PAIR.findall(rb):
            key = _text(k.split(">")[-1])
            if key and key not in specs:
                specs[key] = _text(v)
        price_cells = [_text(p) for p in _PRICE_CELL.findall(rb)]
        titles = [_text(t) for t in _TITLE.findall(rb)]
        out.append({
            **card,
            "specs": specs,
            "price_text": price_cells[0] if price_cells else None,
            "title_text": titles[0] if titles else None,
            "last_updated": (_text(_FRESH.findall(rb)[0]) if _FRESH.findall(rb) else None),
            "index_image": (re.findall(r'src="(/uploads/[^"]+)"', rb) or [None])[0],
        })
    return out


def crawl_index(s: cc.Session, limit: int = 0) -> list[dict[str, Any]]:
    """Walk the index following rel=next. TERMINATES ON MISSING rel=next — past-the-end pages
    re-serve the last page's rows, so an emptiness test would never terminate."""
    url, seen, out = f"{BASE}/", set(), []
    while url:
        status, body = _get(s, url)
        if status != 200:
            print(f"⚠ index {url} → HTTP {status}; stopping enumeration here", flush=True)
            break
        page = _index_page(body)
        for item in page:
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            out.append(item)
        if limit and len(out) >= limit:
            return out[:limit]
        m = _NEXT.search(body)
        url = m.group(1) if m else None
    return out


def _listing_node(body: str) -> Optional[dict]:
    """The RealEstateListing node out of the detail page's single JSON-LD @graph."""
    for block in _LD.findall(body):
        try:
            j = json.loads(block)
        except Exception:
            continue
        for node in (j.get("@graph") or [j]) if isinstance(j, dict) else []:
            if isinstance(node, dict) and node.get("@type") == "RealEstateListing":
                return node
    return None


def fetch_detail(s: cc.Session, pid: str) -> dict[str, Any]:
    """One detail page → {ld, type_text, lat, lng, ad_text}. Empty dict if it did not answer 200."""
    status, body = _get(s, f"{BASE}/property/{pid}")
    if status != 200:
        return {"http_status": status}
    clean = _STYLE.sub(" ", body)          # or the CSS block naming .detail-order-adtext matches first
    tt = _TYPE_TEXT.findall(clean)
    co = _COORDS.findall(clean)
    ad = [_text(b) for b in _ADTEXT.findall(clean)]
    ad = [a for a in ad if a]
    pc = _PRICE_CARD.search(clean)
    return {
        "http_status": 200,
        "ld": _listing_node(body),          # NOT `clean` — _STYLE strips the JSON-LD <script> too
        "type_text": _text(tt[0]) if tt else None,
        "lat": float(co[0][0]) if co else None,
        "lng": float(co[0][1]) if co else None,
        "ad_text": ad[0] if ad else None,
        "price_card": _text(pc.group(1)) if pc else None,
    }


def _price_card(text: Optional[str]) -> dict[str, Any]:
    """Read the price card's OWN labelled figures. Label, amount and currency must be adjacent, so
    «السعر قابل للتفاوض» (no amount) and «سعر المتر 600 ريال» (a different label) can never be
    mistaken for the total. Nothing here is calculated: the site publishes the total AND the rate
    side by side, and each is stored in its own column exactly as published.

    Three shapes exist, all closed-vocabulary:
      «السعر N ريال»            → a firm total
      «السوم N ريال»            → a standing bid, still a published figure for this listing
      «السعر على السوم»         → NO figure at all: the source states there is no price (on request)
    """
    out: dict[str, Any] = {"raw": text, "total": None, "label": None, "per_meter": None,
                           "on_request": False}
    if not text:
        return out
    m = _CARD_TOTAL.search(text)
    if m:
        out["label"], out["total"] = m.group(1), N.to_int(m.group(2))
    p = _CARD_PPM.search(text)
    if p:
        out["per_meter"] = N.to_int(p.group(1))
    # «على السوم» with no adjacent amount anywhere in the card = the source's own "no price".
    out["on_request"] = out["total"] is None and out["per_meter"] is None and "على السوم" in text
    # Tri-state commercial facts the card publishes explicitly. Silent → key absent → NULL, never
    # a default. Negations are tested FIRST so «غير شامل» can't read as «شامل».
    for key, no, yes in (("bank_purchase_accepted", "لا يقبل الشراء بواسطة البنك",
                          "يقبل الشراء بواسطة البنك"),
                         ("price_negotiable", "السعر غير قابل للتفاوض", "السعر قابل للتفاوض"),
                         ("price_includes_tax_and_commission", "السعر غير شامل الضريبة والسعي",
                          "السعر شامل الضريبة والسعي")):
        if no in text:
            out[key] = False
        elif yes in text:
            out[key] = True
    return out


def _street_width(raw: Optional[str]) -> Optional[int]:
    """«20 م» → 20. «60 × 20 م» is TWO frontages, not a width — the numeric column stays NULL and
    the raw string is preserved verbatim in additional_info."""
    if not raw:
        return None
    m = re.fullmatch(r"(\d{1,4})\s*م", raw.strip())
    return int(m.group(1)) if m else None


def _leading_int(raw: Optional[str]) -> Optional[int]:
    """First number of a spec value («500 م²» → 500, «1,000 م²» → 1000). No number → None."""
    if not raw:
        return None
    m = re.match(r"\s*([\d,٬]+)", raw)
    return N.to_int(m.group(1)) if m else None


def map_listing(item: dict[str, Any], detail: dict[str, Any]) -> Optional[tuple[dict, str]]:
    pid = item["id"]
    ld = detail.get("ld") or {}
    specs = item["specs"]
    url = f"{BASE}/property/{pid}"

    # ── type ── the full phrase first («أرض تجارية للبيع» → Commercial Land, «أرض سكنية للبيع» →
    # Residential Land — the residential/commercial land split lives ONLY in that rendered text),
    # then the exact data-ptype token as the fallback. Both go through the shared canonical map.
    type_text = detail.get("type_text") or item.get("title_text") or ""
    property_type = (N.map_type(type_text, TYPE_OVERRIDES)
                     or N.map_type_exact(item["ptype"], TYPE_OVERRIDES)
                     or N.map_type(item["ptype"], TYPE_OVERRIDES))
    if not property_type:
        # QUARANTINE, never invent a label (same rule as therc/rawasidark/aouj). Writing the
        # source's Arabic phrase — or the string "unknown" — into the canonical ENGLISH
        # property_type column invents a type this taxonomy does not have, and it files the row
        # wrong on top of that: category_for_type() answers "Commercial" for anything outside its
        # residential set, so an unmapped residential type would silently land in the commercial
        # table. There is no DB-side novel-type detector to catch it either (checked: no
        # mon_detect_* keyed on property_type exists). The live vocabulary is closed — 12
        # data-ptype values and 25 title phrases over all 1,072 listings, all of them mapped — so
        # this is a copy-change tripwire, not an expected path.
        print(f"⚠ arkaan {pid}: unmapped type {(type_text or item['ptype'])!r} — quarantined, "
              f"no canonical label invented", flush=True)
        return None
    category = N.category_for_type(property_type)

    # ── deal ── an explicit source token, never inferred.
    deal = item["deal"].strip()
    if deal == "للإيجار":
        transaction_type = "Rent"
    elif deal == "للبيع":
        transaction_type = "Buy"
    else:
        return None                                  # unknown contract word → skip, never assume

    # ── price ── PRICE = SOURCE. Nothing here is computed, converted or rounded.
    #   total     ← the price card's «السعر»/«السوم» figure (JSON-LD offers.price agrees on every
    #               listing that has one, and the card additionally covers the 8% where JSON-LD
    #               emits `offers: null` but a السوم figure IS published).
    #   per_meter ← the card's «سعر المتر»/«سوم المتر». Its own column, NEVER folded into a total.
    #   on request → AUTHORITATIVE NULL: the source itself says there is no price, so the NULL is
    #               written even over a previously known value instead of leaving a withdrawn price.
    card = _price_card(detail.get("price_card"))
    offers = ld.get("offers")
    raw_ld_price = offers.get("price") if isinstance(offers, dict) else None
    ld_price = N.to_int(raw_ld_price)
    price = card["total"]
    if price is None and card["per_meter"] is None:
        # JSON-LD is the fallback ONLY when the card published NO figure at all. If the card
        # published a per-square-metre RATE and no total, offers.price is not provably a total on
        # such a page, and a rate written into price_total is the exact bug PRICE = SOURCE forbids
        # (the wasalt/aqar ppm-as-total class). No total then — the rate still lands, alone, in
        # price_per_meter.
        price = ld_price
    on_request = card["on_request"] or (price is None and item.get("price_text") == "على السوم")
    evidence = N.price_evidence(
        field=f"price card «{card['label']}»" if card["label"] else "price card",
        # raw=None when the card showed no figure, so price_evidence records found=False — "the
        # source showed nothing" is the fact to preserve. The card's words are kept alongside.
        raw=None if on_request else card["raw"], stored=price,
        kind="total" if transaction_type == "Buy" else "annual",
        unit="total", origin="spec_table", authoritative_absent=on_request)
    evidence["price_card_text"] = card["raw"]
    evidence["json_ld_offers_price"] = raw_ld_price
    evidence["index_price_text"] = item.get("price_text")

    # ── rent period ── PERIOD = SOURCE. The ONLY text scanned is the listing's OWN ad body; the
    # source has no structured period field, and scanning the whole page would match periods
    # belonging to other listings' markup. No token in that body ⇒ rent_period stays NULL and the
    # published amount is stored as-is (never annualised on an assumption).
    rent_period = price_annual = None
    if transaction_type == "Rent":
        rent_period, price_annual = N.rent_period_and_annual(price, detail.get("ad_text"))

    # ── location ── city is the constant الأحساء (single-city source); district is per-listing.
    addr = (ld.get("contentLocation") or {}).get("address") or {}
    city_ar = (addr.get("addressLocality") or "").strip() or None
    district_ar = (item["hood"] or "").strip() or None
    city = N.map_city(city_ar) if city_ar else None
    region = N.region_for_city(city)
    city_id, region_id = to_catalog(city_ar, region_hint=region)

    photos = [u for u in (ld.get("image") or []) if isinstance(u, str)]
    if not photos and item.get("index_image"):
        photos = [BASE + item["index_image"]]

    # ── everything else the source printed, kept verbatim ──
    info = {
        "property_id": pid,
        "plot_number": (specs.get("رقم") or item["landno"] or None),
        "street_width_raw": specs.get("الشارع"),
        "floor_raw": specs.get("الدور"),
        "apartments_count_raw": specs.get("عدد الشقق"),
        "activity_raw": specs.get("النشاط"),
        "condition_raw": specs.get("الحالة"),
        "building_type_raw": specs.get("نوع العمارة"),
        "classification_raw": specs.get("التصنيف"),
        "kind_raw": specs.get("النوع"),
        "note_raw": specs.get("الوصف"),
        "type_text": type_text or None,
        "date_posted": ld.get("datePosted"),
        "last_updated_text": item.get("last_updated"),
        "status_raw": item.get("status"),
        "latitude": detail.get("lat"),
        "longitude": detail.get("lng"),
        "price_display": item.get("price_text"),
        "price_label": card["label"],          # «السعر» (firm) vs «السوم» (a standing bid)
        "price_on_request": True if on_request else None,
        # Tri-state, straight from the card's own words; absent when the card is silent.
        "bank_purchase_accepted": card.get("bank_purchase_accepted"),
        "price_negotiable": card.get("price_negotiable"),
        "price_includes_tax_and_commission": card.get("price_includes_tax_and_commission"),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [])}
<<<<<<< HEAD
    # NOT columns on this table shape (verified against information_schema: no *_listings table
    # carries latitude/longitude at all, and city_ar/district_ar/city_id/region_id exist only on the
    # 11-13 tables of the older extended shape, which these five new platforms do not use). They are
    # kept HERE so nothing the source published is thrown away — the location arms read city/region/
    # neighborhood, and canonical id resolution stays owned by the DB layer (district canonicalization
    # rule: the DB is match truth, the card shows source text), never guessed by a scraper.
    info.update({k: v for k, v in {
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "latitude": detail.get("lat"),
        "longitude": detail.get("lng"),
    }.items() if v not in (None, "", [])})
=======
>>>>>>> 2cdf686 (Add 5 audited Saudi platforms: therc, aouj, abralosol, arkaan, rawasidark)

    row: dict[str, Any] = {
        "ad_number": f"AK{pid}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "area_m2": _leading_int(specs.get("المساحة")),
        "bedrooms": N.to_int(specs.get("غرف النوم")),
        "reception_rooms_majlis": N.to_int(specs.get("المجلس")),
        "street_width_m": _street_width(specs.get("الشارع")),
        # db.AUTHORITATIVE_NULL is deliberately falsy, so it must be selected by an explicit
        # conditional — `absent or price` would silently fall through to the price.
        "price_total": (db.AUTHORITATIVE_NULL if on_request else price)
                       if transaction_type == "Buy" else None,
        "price_annual": (db.AUTHORITATIVE_NULL if on_request else price_annual)
                        if transaction_type == "Rent" else None,
        "price_per_meter": card["per_meter"],
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district_ar,
<<<<<<< HEAD
=======
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "latitude": detail.get("lat"),
        "longitude": detail.get("lng"),
>>>>>>> 2cdf686 (Add 5 audited Saudi platforms: therc, aouj, abralosol, arkaan, rawasidark)
        "title": _redact(ld.get("name")) or _redact(item.get("title_text")),
        "description": _redact(detail.get("ad_text")),
        "photo_urls": photos,
        "additional_info": info,
        "price_evidence": evidence,
        # Complete source payload, captured once so a future field never needs a re-scrape.
        "source_capture": {
            "schema": "arkaan.v1",
            "index_card": {k: item[k] for k in
                           ("id", "landno", "hood", "ptype", "deal", "status", "specs",
                            "price_text", "title_text", "last_updated", "index_image")},
            "json_ld": ld or None,
            "detail": {"type_text": detail.get("type_text"), "lat": detail.get("lat"),
                       "lng": detail.get("lng"), "ad_text": detail.get("ad_text"),
                       "price_card": detail.get("price_card"),
                       "http_status": detail.get("http_status")},
        },
    }
    # bathrooms / halls / property_age / rega_location_verified are DELIBERATELY ABSENT: this
    # source publishes none of them, and an absent key stores NULL without clobbering a known value.
    return row, ("commercial" if category == "Commercial" else "residential")


def crawl(limit: int = 0, dry_run: bool = False) -> tuple[list[dict], list[dict], int]:
    s = _session()
    items = crawl_index(s, limit=limit)
    print(f"Arkaan: {len(items)} listings enumerated from the index", flush=True)
    res: list[dict] = []
    com: list[dict] = []
    for i, item in enumerate(items, 1):
        detail = fetch_detail(s, item["id"])
        mapped = map_listing(item, detail)
        if not mapped:
            continue
        row, cat = mapped
        (com if cat == "commercial" else res).append(row)
        if not dry_run and i % 100 == 0:
            print(f"  …{i}/{len(items)}", flush=True)
    return res, com, len(res) + len(com)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0, help="process only the first N listings")
    ap.add_argument("--dry-run", action="store_true",
                    help="print normalized rows as JSON and perform ZERO database writes")
    args = ap.parse_args()

    if args.dry_run:
        res, com, seen = crawl(limit=args.limit, dry_run=True)
        if args.type != "all":
            keep = args.type == "commercial"
            res, com = ([] if keep else res), (com if keep else [])
        print(json.dumps([{k: v for k, v in r.items()} for r in res + com],
                         ensure_ascii=False, indent=1, default=str))
        print(f"DRY RUN — {len(res)} residential + {len(com)} commercial, {seen} parsed, 0 db writes")
        return 0

    run_id = None if args.limit else db.begin_run("arkaan")
    seen = 0
    try:
        res, com, seen = crawl(limit=args.limit)
        if args.type != "all":
            keep = args.type == "commercial"
            res, com = ([] if keep else res), (com if keep else [])
        if res:
            db.upsert_arkaan_residential_batch(res)
        if com:
            db.upsert_arkaan_commercial_batch(com)

        if args.limit:
            print(f"✓ Arkaan VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            return 0

        pruned = 0
        for tbl, rows_seen in (("arkaan_residential_listings", res),
                               ("arkaan_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Arkaan: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}",
                             check_tables=["arkaan_residential_listings", "arkaan_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
