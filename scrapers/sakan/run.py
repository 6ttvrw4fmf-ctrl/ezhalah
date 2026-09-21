"""سكن العقاري — sa.sakan.co. 3,158 listings, onboarding 2026-09-20.

SOURCE SHAPE (probed live before any code was written; every number below was measured, not
estimated):

ENUMERATION
  · https://sa.sakan.co/ar/pdpmap.xml holds 9,056 <loc> entries — but that is THREE URLs per
    listing: /ar/property/details/<id>-<slug>, /ar/loancalculator/… and
    /ar/reservation/buyonline/…. Counting every <loc> triples the catalogue. Filtering to
    /ar/property/details/ gives exactly 3,158, which matches the site's own count.
  · Pages are ~430 KB fully server-rendered; no JS is needed. Cloudflare fronts the host but
    curl_cffi's chrome impersonation passes straight through. robots.txt allows everything except
    /cms/ and /login.

WHERE EACH FACT ACTUALLY LIVES
  · Two JSON-LD blocks per page. The useful one is @type "SingleFamilyResidence".
      - THE TRAP: `offers` is a LIST, not an object —
        [{"@type":"Offer","price":1350000,"priceCurrency":"ر.س"}]. `offers.get("price")` on a list
        raises/returns nothing, and a first probe that did exactly that measured price 0/25 on a
        site whose true coverage is 30/30. Index [0].
      - `name` and `description` on that block are SEO boilerplate («افضل استراحة للبيع … ابحث
        بالخريطة»), NOT the listing's own title/description. They are ignored: writing them into
        `description` would feed amenities_from_text marketing copy about the whole site.
      - `leaseLength.unitText` is NOT a lease term — it repeats the SEO page title verbatim
        («سكن | مكتب للتأجير في منطقة الرياض,الرياض»). It is never read as a rent period.
      - `numberOfBedrooms` / `numberOfBathroomsTotal` are explicitly-named source fields (unlike
        wslnaa's ambiguous `rooms`), so they are taken as published — but only onto a DWELLING
        type, because the source also emits them on offices and land (see _DWELLING_TYPES).
  · The BreadcrumbList block is the location + deal + type oracle, and it is structured rather
    than parsed out of prose. Its items carry their own hrefs:
        /ar/buy/استراحة                                  -> deal=Buy,  type_ar=استراحة
        /ar/buy/استراحة/منطقة-مكة-المكرمة                 -> REGION  (an administrative region)
        /ar/buy/استراحة/منطقة-مكة-المكرمة/جدة             -> CITY
        /ar/buy/استراحة/منطقة-مكة-المكرمة/جدة/الصفوة      -> DISTRICT
    The region segment always starts «منطقة-» and is NEVER offered to to_catalog() as a city;
    the city is the 4th path segment only. The h1 mashes all three into one SEO string
    («… في منطقة مكة المكرمة، جدة, الصفوة») and is not used for location.
  · The listing's REAL title is the last breadcrumb item, whose `item` is "" and whose `name` is
    the position-2 name + " في " + the title. The prefix is stripped using the document's own
    position-2 name rather than a hand-written pattern.
  · PRICE + PERIOD sit together in one block, and the period is only ever read from inside it:
        <div class="price details__action--inner-section-1">
          <span class="f16">سعر الإيجار</span>
          <div class="card__price-sar"><span class="f20 f20-700 f20-red me-1">1,000</span>
            <img …real.svg> <span class="f16"> / شهري</span></div></div>
    «سعر البيع» carries no «/ period»; «سعر الإيجار» carries «/ شهري» or «/ سنوي». Scanning the
    whole page for «شهري» would hit the mortgage calculator's «التزامات شهرية» on EVERY buy page
    and turn a sale price into a monthly rent — a 12× card error — so the token is taken from this
    block alone and handed to normalize.rent_period_and_annual(). No period stated ⇒ rent_period
    NULL and the figure stored verbatim in price_annual; never defaulted.
  · AREA is «المساحة N m²» in the summary box (the only place carrying the m² suffix; the spec
    table repeats the bare number). Decimals occur («147.92 m²») and truncate through to_int.
  · «الحالة: فعال» is printed per listing — the source's own liveness statement. Anything other
    than فعال is skipped rather than published.
  · PHOTOS: the gallery uses …/property_image/<date>/mobile/property_image_mobile_<ts>.webp with a
    parallel _thumb.webp. MEASURED: the non-thumb original is 3000×4000 at 7–11 MB; the _thumb is
    525×700 at ~49 KB. Both return 200 with no CORP/ACAO restriction, so both embed — but shipping
    an 11 MB hero to a phone card is not shippable, so the published _thumb URL is stored when the
    page actually printed one, and the plain URL otherwise. Nothing is synthesised: only URLs the
    page published are emitted (a _thumb that the HTML never showed is never guessed at).
  · The spec table («ملخص») is a flat label/value grid and is captured WHOLESALE into
    additional_info — نوع العقار الفرعي, عمر العقار, حالة التأثيث, عدد الطوابق, مساحة البناء,
    رقم المخطط, واجهة العقار, وجود رهن, رقم الترخيص, boundary lengths, and ~35 more. Two of those
    labels are promoted to real columns (عمر العقار → property_age via parse_property_age, which
    already reads the spelled-out «سبع سنوات» = 7; حالة التأثيث → furnished) because the Advanced
    Filter reads columns, not additional_info.
  · «رقم العقار الفرعي تجاري/سكني» («نوع العقار») is a LAND-USE classification, not our
    Residential/Commercial category. Category comes from normalize.category_for_type() only.
  · «رقم ترخيص الإعلان» is its own spec-table cell and is ALSO repeated as prose in the
    description; measured 300/300, not the ~1-in-25 an earlier probe reported (that probe was
    reading only the description). The labelled cell wins, the prose is the fallback.
  · NO «سعر المتر» label exists anywhere on this source — 0/300 pages carry the string — so the
    per-metre branch of the price rule does not apply here: price_per_meter is never set and never
    derived from total/area, in either direction.

MEASURED COVERAGE (random 300 of the 3,158, live, through the real parser)
    enumerated 3,158 · fetched 300/300 · mapped 290 · skipped 10, ALL "city_not_in_catalog"
    price 290/290 · area 290/290 · photos 290/290 (20-cap hit on 288) · district 285/290
    bedrooms 276/290 — which is EXACTLY the dwelling count: every one of the 14 non-dwelling rows
      (13 Office + 1 Residential Land) correctly has bedrooms NULL rather than a fabricated badge
    bathrooms 251/290 · property_age 279/290 · ≥1 amenity column 287/290
    deal 265 Buy / 25 Rent; rent_period 13 monthly + 12 annual, 0 defaulted, 0 unknown
    status: 300/300 «فعال» · «سعر المتر»: 0/300 · ld+json price vs printed price: 0 disagreements
    junk agencies: 0 observed — the 300 listings come from 6 agencies, and all 60 brokers published
      at /ar/brokers are real companies. The filter below is kept as narrow insurance.
    The 10 skips are 5 distinct labels: «الاحسا» (4 — the catalogue key is «الأحساء» with the final
      hamza, so the shared resolver cannot match sakan's spelling), «بحره» (2), «العسيله» (2),
      «طريب» (1), «محائل» (1). All five are honest resolver gaps, not parse failures; adding a
      catalogue alias belongs in the shared resolver, not in this scraper.

SHARED HELPER WRITTEN LOCALLY
  · scrapers/common/db.py has no upsert_sakan_*_batch pair (another engineer owns that file and
    the migrations), so `_upsert_batch` below calls the existing generic db._wasalt_batch() with
    this platform's table names. Nothing is reimplemented — it is the same batching, sanitising
    and per-key-set grouping every sibling platform goes through.
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urlsplit

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://sa.sakan.co"
SITEMAP = f"{BASE}/ar/pdpmap.xml"
SOURCE = "Sakan Saudi"
PREFIX = "SKN"
DETAIL_PATH = "/ar/property/details/"

# The source's own liveness word. Anything else is not an offer we may publish.
STATUS_LIVE = "فعال"

# Types whose published «عدد الغرف / numberOfBedrooms» is genuinely a BEDROOM count. sakan emits the
# field on offices, shops and land too (where it means partitions, or is simply carried over), and a
# «5 غرف نوم» badge on a plot of land is a fabricated specification. Keyed on the canonical English
# type so it cannot drift from map_type_exact's output.
_DWELLING_TYPES = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Chalet", "Rest House",
                   "Room", "Building"}

# Auction / already-transacted markers. The catalogue is a live-offer feed, so these are skipped
# rather than published as available.
_AUCTION_TOKENS = ("مزاد", "المزاد", "مزايدة")
_TRANSACTED_TOKENS = ("تم البيع", "تم الإيجار", "تم الايجار", "تم التأجير", "تم بيعه", "تم بيع",
                      "مباع", "تم الحجز")

# Test/junk agencies that publish into the live catalogue («ziyada test 3», «تسجيل لا 100270»).
# Deliberately NARROW: an explicit test word, or the literal «تسجيل لا» placeholder name. A
# broader heuristic would start eating real brokerages.
_JUNK_AGENCY_RE = re.compile(r"(?:\btest\b|\btesting\b|\bdemo\b|تجريبي|تجربة|اختبار|تسجيل\s*لا)",
                             re.IGNORECASE)

# sakan's city slugs sometimes carry a trailing bare number — «الاحسا 1», «بريده 1». MEASURED: the
# listing under «الاحسا 1» is titled «فيلا - الهفوف‎ - الدانة» and the one under «بريده 1» is
# «دور للبيع - بريدة - حي النخيل», and their own «رقم المدينة» cells differ (13789 vs 13769) — i.e.
# it is a duplicate-row disambiguator in sakan's city table, not part of any city's name. No Saudi
# city name ends in a bare digit, so on a catalogue MISS the suffix is folded off and the lookup
# retried (owner's district fold rule, 2026-09-14, applied to the city slug). The raw label is kept
# in additional_info.city_ar_raw — folded, never deleted.
_CITY_SLUG_SUFFIX_RE = re.compile(r"\s+\d{1,2}$")

# Per-platform EXACT-match override for map_city, the documented escape hatch (see map_type_exact).
# MEASURED defect it guards: sakan spells Mahayel «محائل» (hamza-on-ya), and map_city's longest-
# SUBSTRING pass finds «حائل» inside it and answers "Hail" — a different city 900 km away. to_catalog
# keys on the DB catalogue exactly, so the two can disagree; this pins the English name to the
# Arabic one the source actually printed.
_CITY_OVERRIDES = {"محائل": "Mahayel", "محائل عسير": "Mahayel"}

# sakan's «مميزات العقار» chips use this platform's own wording, which is not always the wording the
# SHARED amenity token map knows. MEASURED over 117 live listings, the chip vocabulary is:
#   موقف 109 · ماستر 83 · غرفة معيشة 33 · صالة طعام 19 · غرفة خادمة 18 · حوش 16 · انترنت 14 ·
#   «اصنصير - مصاعد» 14 · مدخل سيارة 11 · تكييف مركزي 7 · غرفة سائق 7 · بلكونة 4 · أمن 3 ·
#   مطبخ راكب 2 · مسبح 1 · جيم 1 · ملحق خارجي 1 · مكتب امن 1 · مفروشة جزئي 1
# All but one already reach a column through the shared map (موقف→parking, تكييف مركزي→
# air_conditioner, غرفة خادمة→maid_room, مطبخ راكب→kitchen by substring, …). The exception is the
# lift: the shared map knows «مصعد», while sakan prints the colloquial-plus-plural «اصنصير - مصاعد»,
# which shares no substring with it — 14 of 117 listings were stating a lift that no column saw.
# This is a per-platform VOCABULARY translation, not a new amenity rule, so it lives here rather
# than in the shared map (which another engineer owns).
_CHIP_REWRITE = {"اصنصير - مصاعد": "مصعد"}

# …and one chip the schema has no honest bucket for. «مفروشة جزئي» is PARTIALLY furnished; the
# shared map would see «مفروشة» and set furnished=True, publishing a claim the source did not make.
# Dropped, so the column stays NULL — the fourth amenity outcome, applied to a chip.
_CHIP_DROP = {"مفروشة جزئي"}

_LD_RE = re.compile(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', re.S)
_SUMMARY_PAIR_RE = re.compile(
    r'<span class="fn fn--gray">([^<]+)</span>.*?<span class="fn fn--b">([^<]*)</span>', re.S)
_SPEC_LABEL_RE = re.compile(r'<span class="(?:fn|f14)">([^<]+)</span>')
_SPEC_VALUE_RE = re.compile(r'<span class="(?:fn fn--b|f16 f16-700)">([^<]*)</span>')
_PRICE_BLOCK_RE = re.compile(
    r'class="price details__action--inner-section-1">(.{0,900}?)</div>\s*</div>', re.S)
_PRICE_NUM_RE = re.compile(r'<span class="f20[^"]*">\s*([\d,.\u0660-\u0669]+)\s*</span>')
_PRICE_PERIOD_RE = re.compile(r'/\s*([^<>/]{1,24})\s*</span>')
_DESC_RE = re.compile(r'<div id="accordion_div"[^>]*>(.*?)</div>', re.S)
_PHOTO_RE = re.compile(r'https://[^\s"\'\\<>]*?/property_image/[^\s"\'\\<>]+?\.webp')
_AGENCY_RE = re.compile(r'/ar/agency/(\d+)-([^"\'\s<>]+)')
_AREA_NUM_RE = re.compile(r'([\d,.\u0660-\u0669]+)\s*m²')
_FEATURES_BLOCK_RE = re.compile(r'details__aminities--2"[^>]*>(.*?)<div class="details__location', re.S)
_FEATURE_RE = re.compile(r'<span class="fxs fxs--gray">([^<]+)</span>')
_LICENCE_RE = re.compile(r'رقم\s*(?:ترخيص\s*الإعلان|الترخيص)\s*:?\s*([\d\u0660-\u0669]{6,})')
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — setting one here would contradict the TLS fingerprint.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.7"})
    return s


def _text(raw: str) -> str:
    """HTML fragment -> readable text, <br> kept as a newline."""
    t = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = _html.unescape(t)
    t = re.sub(r"[ \t\u00a0]+", " ", t)
    return "\n".join(ln.strip() for ln in t.split("\n")).strip()


def _digits(s: Optional[str]) -> Optional[str]:
    """Arabic-Indic ٠-٩ are real digits — translate before any parse touches them."""
    return s.translate(_ARABIC_DIGITS) if s else s


def fetch_urls(s: cc.Session, limit: int = 0) -> list[str]:
    """Detail URLs from pdpmap.xml. ONLY /ar/property/details/ — the sitemap carries a
    loancalculator and a reservation URL for the same listing, which would triple the count."""
    r = s.get(SITEMAP, timeout=90)
    if r.status_code != 200:
        return []
    # HTML entities in hrefs (&amp;) must be unescaped or every fetch 404s.
    urls = [_html.unescape(u) for u in re.findall(r"<loc>([^<]+)</loc>", r.text)]
    out, seen = [], set()
    for u in urls:
        if DETAIL_PATH not in u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[:limit] if limit else out


def ad_id_from_url(url: str) -> Optional[str]:
    """`…/details/68195-استراحة-للبيع-…` -> "68195". The id is the slug's leading number."""
    slug = unquote(urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1])
    m = re.match(r"^(\d+)-", slug)
    return m.group(1) if m else None


def parse_page(url: str, page: str) -> dict[str, Any]:
    """Every fact this source publishes, read off one detail page. Pure — no network, so the
    offline barrier feeds it saved HTML and exercises this exact function."""
    out: dict[str, Any] = {"url": url, "ad_id": ad_id_from_url(url)}

    res: dict[str, Any] = {}
    crumbs: list[dict[str, Any]] = []
    for blob in _LD_RE.findall(page):
        try:
            d = json.loads(blob)
        except ValueError:
            continue
        if d.get("@type") == "SingleFamilyResidence":
            res = d
        elif d.get("@type") == "BreadcrumbList":
            crumbs = [c for c in d.get("itemListElement") or [] if isinstance(c, dict)]

    # ── deal / type / region / city / district, all off the breadcrumb hrefs ────────────────────
    segs: list[str] = []
    for c in crumbs:
        item = c.get("item") or ""
        if "/ar/buy/" in item or "/ar/rent/" in item:
            parts = [unquote(p) for p in urlsplit(item).path.strip("/").split("/")]
            if len(parts) > len(segs):
                segs = parts                      # deepest crumb wins: [ar, buy|rent, type, …]
    if len(segs) >= 2:
        out["deal"] = {"buy": "Buy", "rent": "Rent"}.get(segs[1])
    if len(segs) >= 3:
        out["type_ar"] = segs[2].replace("-", " ").strip() or None
    if len(segs) >= 4:
        out["region_ar"] = segs[3].replace("-", " ").strip() or None
    if len(segs) >= 5:
        # The region segment always starts «منطقة» — the CITY is the segment AFTER it, never it.
        out["city_ar"] = segs[4].replace("-", " ").strip() or None
    if len(segs) >= 6:
        out["district_raw"] = segs[5].replace("-", " ").strip() or None

    # Real title = last crumb (item == "") minus the document's own "«type» لـ «deal» في " prefix.
    if crumbs:
        tail = (crumbs[-1].get("name") or "").strip()
        head = (crumbs[1].get("name") or "").strip() if len(crumbs) > 1 else ""
        if head and tail.startswith(head + " في "):
            tail = tail[len(head) + 4:].strip()
        out["title"] = tail or None

    # ── description: the listing's own prose, NOT the SEO ld+json `description` ─────────────────
    m = _DESC_RE.search(page)
    out["description"] = _text(m.group(1)) or None if m else None

    # ── summary box: المساحة + الحالة ───────────────────────────────────────────────────────────
    summary = {_text(k): _text(v) for k, v in _SUMMARY_PAIR_RE.findall(page)}
    out["status"] = summary.get("الحالة") or None
    # «المساحة 900 m²» — the summary box is the only place carrying the m² suffix. An earlier draft
    # regex-scanned the page up to the first "navigationAmenities" occurrence, which is the NAV
    # ANCHOR (<a href="#navigationAmenities">), printed BEFORE the summary box: the slice cut the
    # area off and measured 0/60 while the fallback quietly covered for it.
    m = _AREA_NUM_RE.search(summary.get("المساحة") or "")
    out["area_raw"] = _digits(m.group(1)) if m else None

    # ── spec table: every «<div class="tr">» label/value pair, verbatim ─────────────────────────
    specs: dict[str, str] = {}
    for chunk in page.split('<div class="tr">')[1:]:
        chunk = chunk[:1200]
        lm, vm = _SPEC_LABEL_RE.search(chunk), _SPEC_VALUE_RE.search(chunk)
        if lm and vm:
            label, value = _text(lm.group(1)), _text(vm.group(1))
            if label and value and label not in specs:
                specs[label] = value
    out["specs"] = specs

    # ── price + period, from the price block ONLY ──────────────────────────────────────────────
    out["price_label"] = out["price_shown"] = out["period_raw"] = None
    m = _PRICE_BLOCK_RE.search(page)
    if m:
        block = m.group(1)
        lm = re.search(r"<span[^>]*>([^<]*سعر[^<]*)</span>", block)
        out["price_label"] = _text(lm.group(1)) if lm else None
        nm = _PRICE_NUM_RE.search(block)
        out["price_shown"] = _digits(nm.group(1)) if nm else None
        pm = _PRICE_PERIOD_RE.search(block)
        if pm:
            out["period_raw"] = _text(pm.group(1)) or None

    # ── price from ld+json: `offers` IS A LIST ─────────────────────────────────────────────────
    offers = res.get("offers")
    if isinstance(offers, dict):                  # tolerated, never assumed
        offers = [offers]
    out["price_ld"] = None
    if isinstance(offers, list) and offers and isinstance(offers[0], dict):
        out["price_ld"] = normalize.to_int(_digits(str(offers[0].get("price"))))

    out["bedrooms_raw"] = _digits(str(res.get("numberOfBedrooms") or "")) or None
    out["bathrooms_raw"] = _digits(str(res.get("numberOfBathroomsTotal") or "")) or None
    out["rooms_raw"] = _digits(str(res.get("numberOfRooms") or "")) or None

    # ── photos: keep the page's own URLs; prefer the published _thumb (525×700 ~49 KB) over the
    #    published original (3000×4000, 7–11 MB). A _thumb the page never printed is not invented.
    shown = list(dict.fromkeys(_PHOTO_RE.findall(page)))
    thumbs = {u.replace("_thumb.webp", ".webp"): u for u in shown if u.endswith("_thumb.webp")}
    photos: list[str] = []
    for u in shown:
        stem = u.replace("_thumb.webp", ".webp")
        pick = thumbs.get(stem, u)
        if pick not in photos:
            photos.append(pick)
    out["photos"] = photos
    out["photos_full"] = [u for u in shown if not u.endswith("_thumb.webp")]

    # «مميزات العقار» is a STRUCTURED, affirmative-only list of the property's own features
    # (موقف / تكييف مركزي / حوش / انترنت …) — the source's own field, not prose. Captured
    # separately from the description so it can outrank text inference downstream.
    fb = _FEATURES_BLOCK_RE.search(page)
    out["features"] = [_text(x) for x in _FEATURE_RE.findall(fb.group(1))] if fb else []

    am = _AGENCY_RE.search(page)
    out["agency_id"] = am.group(1) if am else None
    out["agency_name"] = unquote(am.group(2)).replace("-", " ").strip() if am else None

    # The spec table states the REGA ad licence as its own labelled cell; the description repeats
    # it as prose on many listings. The labelled cell wins; the prose is the fallback.
    licence = specs.get("رقم ترخيص الإعلان")
    if not licence:
        lm = _LICENCE_RE.search(_text(page))
        licence = lm.group(1) if lm else None
    out["licence"] = _digits(licence)
    return out


def _amenities(p: dict[str, Any], specs: dict[str, str]) -> dict[str, bool]:
    """Tri-state amenity columns from this source's TWO amenity statements, read separately.

    The prose («الوصف» + «حالة التأثيث») can negate and can talk about the street; the structured
    «مميزات العقار» field is an affirmative-only list of this property's own features. They are read
    apart and then merged, and where they CONTRADICT each other (prose «بدون مصعد» against a
    «مصعد» chip) the key is DROPPED rather than picked: a source that contradicts itself has not
    stated the fact, and NULL is the only answer it supports. Picking a side would publish a
    fixture claim on a coin flip. Agreement, and each side's unique keys, pass straight through.
    """
    prose = normalize.amenities_from_text(
        "\n".join(x for x in (p.get("description"), specs.get("حالة التأثيث")) if x))
    chips = [_CHIP_REWRITE.get(c, c) for c in (p.get("features") or []) if c not in _CHIP_DROP]
    struct = normalize.amenities_from_text(", ".join(chips))
    out = dict(prose)
    for k, v in struct.items():
        if k in out and out[k] != v:
            out.pop(k)
        else:
            out[k] = v
    return out


def map_listing(p: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). Returns (None, category, why) for anything this source has
    not actually established — never a guess."""
    if not p.get("ad_id"):
        return None, "residential", "no_ad_id"

    status = (p.get("status") or "").strip()
    if status and status != STATUS_LIVE:
        return None, "residential", f"status_{status}"

    blob = " ".join(x for x in (p.get("title"), p.get("description")) if x)
    if any(t in blob for t in _AUCTION_TOKENS):
        return None, "residential", "auction"
    if any(t in blob for t in _TRANSACTED_TOKENS):
        return None, "residential", "already_transacted"

    agency = p.get("agency_name") or ""
    if agency and _JUNK_AGENCY_RE.search(agency):
        return None, "residential", "junk_agency"

    specs = p.get("specs") or {}
    # The breadcrumb type and «نوع العقار الفرعي» are two source statements of the same fact; either
    # one alone is the source speaking, so the second is a fallback, never an override.
    property_type = (normalize.map_type_exact(p.get("type_ar"))
                     or normalize.map_type_exact(specs.get("نوع العقار الفرعي")))
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    deal = p.get("deal")
    if deal not in ("Buy", "Rent"):
        return None, category, "no_deal"

    city_raw = p.get("city_ar")
    region_ar = p.get("region_ar")
    if not city_raw:
        return None, category, "no_city"
    # to_catalog() decides what a real city is — the source's own «منطقة …» label never does, and
    # neither does its city list (which carries regions and numbered duplicates).
    city_ar = city_raw
    city_id, region_id = to_catalog(city_ar, region_ar)
    if not city_id:
        folded = _CITY_SLUG_SUFFIX_RE.sub("", city_raw).strip()
        if folded and folded != city_raw:
            city_id, region_id = to_catalog(folded, region_ar)
            if city_id:
                city_ar = folded
    if not city_id:
        return None, category, "city_not_in_catalog"

    district_raw = p.get("district_raw")
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    area = normalize.to_int(p.get("area_raw")) or normalize.to_int(specs.get("المساحة"))

    # PRICE = SOURCE. The visible block and the ld+json Offer are the same published figure; the
    # ld+json one is already an int, the visible one is the cross-check. Neither is ever derived,
    # rounded, or reconciled against the area — sakan publishes no «سعر المتر» at all, so a total
    # is only ever the total the page printed.
    price = p.get("price_ld")
    if price is None:
        price = normalize.to_int(p.get("price_shown"))

    bedrooms = (normalize.to_int(p.get("bedrooms_raw"))
                if property_type in _DWELLING_TYPES else None)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{p['ad_id']}",
        "listing_url": p["url"],
        "source": SOURCE,
        "active": True,
        "title": p.get("title"),
        "description": p.get("description"),
        # Silence stays NULL, «غير مؤثثة» is False, «مصعد مؤسس» and «قريب من حديقة» stay NULL — all
        # four outcomes are amenities_from_text's job, not this scraper's. Read TWICE and merged in
        # that order because the two inputs are not equal evidence: prose can negate and can talk
        # about the street, while «مميزات العقار» is a structured, affirmative-only field about this
        # property. SOURCE outranks text inference, so the structured pass is applied last.
        **_amenities(p, specs),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar, overrides=_CITY_OVERRIDES),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": normalize.to_int(p.get("bathrooms_raw")),
        "photo_urls": (p.get("photos") or [])[:20] or None,
        "property_age": normalize.parse_property_age(specs.get("عمر العقار")),
    }
    if deal == "Rent":
        # PERIOD = SOURCE. The token comes from the price block alone («/ شهري», «/ سنوي»); the
        # word «شهري» also appears in the mortgage widget on every page, which is why the whole
        # page text is never searched. No token ⇒ rent_period NULL, figure stored as published.
        rent_period, price_annual = normalize.rent_period_and_annual(price, p.get("period_raw"))
        row["rent_period"] = rent_period
        row["price_annual"] = price_annual
    else:
        row["price_total"] = price

    row["additional_info"] = {k: v for k, v in {
        "type_ar": p.get("type_ar"),
        "city_ar_raw": city_raw if city_raw != city_ar else None,
        "features": p.get("features") or None,
        "region_ar": region_ar,
        "price_label": p.get("price_label"),
        "price_shown": p.get("price_shown"),
        "rent_period_raw": p.get("period_raw"),
        "status_raw": status or None,
        "source_rooms": p.get("rooms_raw"),
        "agency_id": p.get("agency_id"),
        "agency_name": agency or None,
        "rega_ad_license_number": p.get("licence"),
        "photo_urls_full_res": p.get("photos_full") or None,
        "spec_table": specs or None,
    }.items() if v is not None}
    return row, category, ""


# The marker that says "this response really is a listing page". A soft-404 or a Cloudflare
# interstitial can return 200 with a fully parseable body (see the 2026-09 «a 404 page is still a
# PARSEABLE page» incident), and such a body would parse to an empty record and be filed as an
# ordinary type/deal skip instead of a fetch failure. Requiring the listing's own JSON-LD block
# keeps the two apart: no payload → DEFINITIVE miss, transport failure → retried.
_LISTING_MARKER = "SingleFamilyResidence"


def fetch_page(s: cc.Session, url: str, *, tries: int = 3) -> Optional[str]:
    for attempt in range(tries):
        try:
            r = s.get(url, timeout=60)
        except Exception:
            r = None
        if r is not None and r.status_code == 200:
            return r.text if _LISTING_MARKER in r.text else None
        if r is not None and r.status_code == 404:
            return None                           # definitively gone, not a transient block
        time.sleep(1.5 * (attempt + 1))           # 403/5xx/timeout: transient until proven otherwise
    return None


def _upsert_batch(table: str, rows: list[dict[str, Any]]) -> None:
    """db.py has no upsert_sakan_*_batch pair (that file is owned centrally), so this reuses the
    generic batch path every sibling platform already goes through — same sanitisers, same
    per-key-set grouping, same on_conflict=ad_number."""
    db._wasalt_batch(table, rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delay", type=float, default=0.35)
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("sakan")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        urls = fetch_urls(s, limit=args.limit)
        if not urls:
            raise RuntimeError(f"{SITEMAP} returned no {DETAIL_PATH} entries")
        print(f"{SOURCE}: {len(urls)} listings discovered", flush=True)
        for i, u in enumerate(urls, 1):
            page = fetch_page(s, u)
            if not page:
                skipped["fetch_miss"] = skipped.get("fetch_miss", 0) + 1
                continue
            row, cat, why = map_listing(parse_page(u, page))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if args.delay:
                time.sleep(args.delay)            # 3,158 pages — be polite
            if i % 250 == 0:
                print(f"  …{i}/{len(urls)}  kept={len(res) + len(com)}", flush=True)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>10} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):14} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>7} "
                      f"bd={str(r0['bedrooms']):>3} ba={str(r0['bathrooms']):>3} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        if res:
            _upsert_batch("sakan_residential_listings", res)
        if com:
            _upsert_batch("sakan_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="sakan_residential_listings", com_table="sakan_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # Pass the tally through even on a healthy run: an empty run must say WHY in the database.
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls),
                             rows_upserted=len(res) + len(com),
                             notes=notes[:300] or None,
                             check_tables=["sakan_residential_listings",
                                           "sakan_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            tally = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e} | skips: {tally}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
