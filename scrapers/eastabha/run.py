"""East Abha (eastabha.sa / شرق أبها للخدمات العقارية) scraper — Saudi WordPress + WP Residence theme.

شرق أبها للخدمات العقارية is an Asir-based (عسير / Abha) real-estate office. Saudi-owned →
passes the Saudi-only rule. ~229 listings. No auth, no proxy, cloud-friendly. 8th source.

Data path: a clean public WordPress REST API exposes the list + the taxonomy term names, but NOT
the numeric specs. So:
  1. List via /wp-json/wp/v2/estate_property (paginate using the x-wp-totalpages header). Each
     record carries id, slug, link, title.rendered, content.rendered (Arabic spec text),
     featured_media, date, modified, and taxonomy term-ID arrays.
  2. Resolve the 7 taxonomies once (id→Arabic name dicts):
        property_category        → property type (mixed with some deal words → cleaned)
        property_action_category → deal type  بيع→Buy | إيجار→Rent | مزاد→SKIP (auctions)
        property_city            → raw Arabic city
        property_area            → raw Arabic district/area
        property_county_state    → raw Arabic region (عسير → Asir)
        property_features        → amenity list (→ boolean columns + features list)
        property_status          → raw status label
  3. Numeric specs are NOT in REST meta → parse the detail page HTML at the listing link. WP
     Residence renders the main listing's specs as data-attributes on the map pin:
         data-rooms / data-size / data-bathrooms / data-clean_price
     plus the price text in .price_area, geo in data-cur_lat / data-cur_long. Area / age can also
     fall back to the Arabic content text. Gallery photos come from the #property_slider_carousel
     <a class="prettygalery"> hrefs (full-size) + the featured-media source_url.

DEAL TYPE comes from property_action_category (the clean signal). مزاد (auction) → the whole
listing is SKIPPED (user decision: NO auctions).

STATUS: property_status labels تأجرت (rented out) / تم البيع (sold) mean the listing is GONE from
the market even though the site keeps publishing it → stored with active=false + a post-upsert
missing_count=3 pin (see GONE_STATUS_AR + _pin_sold_inactive) so the nightly auto-recover sweep
can't resurrect it. Any other/unknown status stays ACTIVE (never over-hide), and auction statuses
("مزاد …") are NOT gated — hiding auctions by status is not owner-approved.

PDPL: this site shows no advertiser name/number in the REST content (verified in recon), but we
still defensively redact any 05xxxxxxxx / +9665… / wa.me out of title+description and never store
a name/number anywhere. No REGA advertising-license number is shown on this site (noted in
additional_info).

Usage:
  python -m scrapers.eastabha.run --limit 18           # small live validation run (no prune)
  python -m scrapers.eastabha.run --type all           # full production crawl (+ prune unseen)
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
import urllib.parse as up
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, http, normalize  # noqa: E402

BASE = "https://eastabha.sa"
LIST_API = f"{BASE}/wp-json/wp/v2/estate_property"
TAXONOMIES = (
    "property_category",
    "property_action_category",
    "property_city",
    "property_area",
    "property_county_state",
    "property_features",
    "property_status",
)

# --- property type (canonical English) from the Arabic property_category term -------------------
# property_category mixes pure-type terms with a few deal-flavoured ones ("شقه للبيع", "إيجار",
# "روف للبيع"); we strip the deal words first, then match the residual.
#
# UNIFIED 2026-07-16 (fix/normalize-unification): the 43-key private TYPE_MAP_AR that lived here now
# routes through normalize.map_type_exact() — 16 keys were literal duplicates of shared TYPE_MAP_AR
# entries (dropped), 7 (شقق سكنية/شقق/قصر/إستراحة/محطة بنزين/كافيه/كافيه - لاونج) were promoted
# verbatim into the shared map, and the 20 below stay as Eastabha-only EXACT-match overrides
# (contract: normalize.map_type_exact docstring). Overrides exist for two reasons, both listed in
# the unification report for owner review (locked owner rule: never guess on a mapping conflict):
#   • CONFLICT — Eastabha's owner-shipped value differs from the shared layer's (the أرض family is
#     stored as "Land"/"Commercial Land" here, vs shared "Residential Land"; دوبلكس is "Duplex" here
#     vs Mustqr's "Villa"; استوديو is "Studio" here vs Wasalt folding Studio→Apartment; صناعي/تجاري
#     are Eastabha-context judgments).
#   • ORDER-PRESERVING — keys the shared map only reaches via its substring pass (دور سكني,
#     دور أرضي, عمارة عضم, محلات تجارية, محلات) or not at all (روف/روف للبيع — deliberately NOT
#     promoted: "روف" is a substring of common words like معروف and would false-positive fleet-wide).
#     Keeping them exact-match here keeps _derive_type()'s two-phase name scan byte-identical.
TYPE_OVERRIDES_AR = {
    "استوديو": "Studio", "ستوديو": "Studio",
    "دوبلكس": "Duplex", "دوبليكس": "Duplex",
    "دور سكني": "Floor", "دور أرضي": "Floor", "روف": "Floor", "روف للبيع": "Floor",
    "عمارة عضم": "Building",
    "أرض": "Land", "ارض": "Land", "أرض سكنية": "Land", "ارض سكنية": "Land",
    "أرض زراعية": "Land", "ارض زراعية": "Land", "أرض تجارية": "Commercial Land",
    "محلات تجارية": "Shop", "محلات": "Shop",
    "صناعي": "Warehouse", "تجاري": "Commercial Land",
}
# words to strip from a category term before type lookup (deal/status noise mixed into the taxonomy)
_DEAL_WORDS = ("للبيع", "للايجار", "للإيجار", "إيجار", "ايجار", "بيع", "مزاد", "سكنية", "سكني", "أرضي", "ارضي")

RESIDENTIAL_TYPES = {
    "Apartment", "Villa", "Floor", "Duplex", "House", "Building", "Studio", "Rest House",
    "Chalet", "Farm", "Land",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Commercial Land", "Commercial Building",
    "Gas Station",
}

# --- city → canonical English + region ----------------------------------------------------------
# UNIFIED 2026-07-16 (fix/normalize-unification): the 51-key private CITY_MAP_AR that lived here now
# routes through normalize.map_city() — 34 keys already resolved identically via the shared map
# (dropped), 4 (النماص/تنومة/ظهران الجنوب/البرك) were promoted verbatim into the shared map (+ their
# Asir region entries in REGION_CITIES), and the 13 below stay as Eastabha-only EXACT-match
# overrides because Eastabha's historical English label DIFFERS from the canonical label the shared
# map (or another platform) uses for the same city — e.g. it stores "Majmaah" where the rest of the
# fleet stores "Al Majmaah". Changing a stored label is a production data change, so every one of
# these is preserved verbatim and listed in the unification report for owner review (they are a
# real cross-platform findability gap: a city filter can't match both spellings). CITY_TO_REGION
# below still keys off these historical labels — keep the two in sync if the owner ever
# canonicalizes them.
CITY_OVERRIDES_AR = {
    # value ≠ shared CITY_MAP_AR for the same Arabic key:
    "تثليث": "Tathleeth",    # shared: Tathlith
    "محايل": "Muhayil",      # shared: Mahayel
    "المجمعة": "Majmaah",    # shared: Al Majmaah
    "الزلفي": "Zulfi",       # shared: Al Zulfi
    "القويعية": "Quwaiiyah", # shared: Al Quwayiyah
    "تربة": "Turbah",        # shared: Turabah
    "بقيق": "Buqayq",        # shared: Abqaiq
    "البكيرية": "Bukayriyah",# shared: Al Bukayriyah
    "المذنب": "Muthnib",     # shared: Al Mithnab
    "بيش": "Bish",           # shared: Baysh
    # label contested across platforms (Wasalt folds these into a parent city; Eastabha keeps them
    # as their own city) — NOT promoted to shared, owner decision needed:
    "سراة عبيدة": "Sarat Abidah",  # wasalt: Sarat Ubaida → Khamis Mushait
    "بلجرشي": "Baljurashi",        # wasalt: Baljurashi → Al Baha
    "العقيق": "Al Aqiq",           # wasalt: Al-Aqiq → Al Baha
}
REGION_MAP_AR = {
    "عسير": "Asir", "الرياض": "Riyadh", "مكة المكرمة": "Makkah", "المدينة المنورة": "Madinah",
    "الشرقية": "Eastern Province", "القصيم": "Qassim", "تبوك": "Tabuk", "حائل": "Hail",
    "جازان": "Jazan", "نجران": "Najran", "الباحة": "Al Bahah", "الجوف": "Al Jawf",
    "الشماليه": "Northern Borders", "الحدود الشمالية": "Northern Borders",
    "المملكة العربية السعودية": None,  # the country-level term — ignore, not a region
}
CITY_TO_REGION = {
    "Abha": "Asir", "Ahad Rafidah": "Asir", "Khamis Mushait": "Asir", "Al Namas": "Asir",
    "Tanomah": "Asir", "Bisha": "Asir", "Tathleeth": "Asir", "Muhayil": "Asir",
    "Dhahran Al Janub": "Asir", "Sarat Abidah": "Asir",
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Dawadmi": "Riyadh", "Majmaah": "Riyadh",
    "Zulfi": "Riyadh", "Quwaiiyah": "Riyadh", "Diriyah": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah", "Al Jumum": "Makkah", "Turbah": "Makkah",
    "Medina": "Madinah", "Al Ula": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Dhahran": "Eastern Province",
    "Qatif": "Eastern Province", "Jubail": "Eastern Province", "Hofuf": "Eastern Province",
    "Khafji": "Eastern Province", "Buqayq": "Eastern Province",
    "Buraidah": "Qassim", "Ar Rass": "Qassim", "Bukayriyah": "Qassim", "Muthnib": "Qassim",
    "Tabuk": "Tabuk", "Tayma": "Tabuk", "Hail": "Hail", "Najran": "Najran",
    "Jazan": "Jazan", "Bish": "Jazan", "Al Baha": "Al Bahah", "Baljurashi": "Al Bahah", "Al Aqiq": "Al Bahah",
    "Qurayyat": "Al Jawf", "Al Birk": "Asir",
}

# --- features (Arabic) → canonical boolean columns ----------------------------------------------
FEATURE_COL = {
    "مصعد": "elevator", "اسانسير": "elevator", "صنصير": "elevator",
    "مطبخ مجهز": "kitchen", "مطبخ": "kitchen",
    "كراج ملحق": "parking", "كراج": "parking", "موقف": "parking", "مواقف": "parking",
    "تكييف مركزي": "air_conditioner", "تكييف": "air_conditioner",
    "كهرباء": "electricity", "ماء": "water_supply", "مياه": "water_supply",
    "شُرفة ، بلكونة": "balcony_terrace", "شرفة": "balcony_terrace", "بلكونة": "balcony_terrace",
    "غرفة غسيل": "laundry_room", "سطح خاص": "villa_on_roof",
    "حديقة": "balcony_terrace",  # closest canonical column
    "مدخل خاص": "private_entrance", "ألياف بصرية": "optical_fibers",
}

# action-category Arabic → deal handling
ACTION_BUY = ("بيع", "استثمار")
ACTION_RENT = ("إيجار", "ايجار", "تأجير")
ACTION_AUCTION = ("مزاد",)

# property_status labels that mean the listing is GONE from the market. The status taxonomy is
# messy — it mixes type/deal labels ("شقة إيجار", "فيلا للبيع") and promo labels ("عرض جديد",
# "عرض ساخن", "بيت مفتوح") — so we gate ONLY on the two labels confirmed off-market in the
# live-DB audit (2026-07-09): تأجرت (rented out) and تم البيع (sold). Exact match on the trimmed
# term; ANY other/unknown status stays ACTIVE (neutrality rule: never over-hide a listing on a
# value we haven't confirmed means off-market). NOTE: auction statuses ("مزاد …") are DELIBERATELY
# not gated — the owner has not approved hiding auctions by status.
GONE_STATUS_AR = ("تأجرت", "تم البيع")

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_PHONE_RE = re.compile(r"(?:\+?9665\d{8}|05\d{8}|\b966\s?5\d{8}\b|wa\.me/\S+|واتس\S*\s*[\d٠-٩]{6,})")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _redact(s: str) -> str:
    """PDPL: strip any phone/WhatsApp out of free text before storing."""
    return _PHONE_RE.sub("", s or "").strip()


def _num(s: Optional[str]) -> Optional[int]:
    # DELIBERATELY kept local (2026-07-16 normalize-unification audit): this extracts the FIRST
    # number token out of free Arabic text ("مساحة 593م شارعين" → 593). normalize.to_int() strips
    # ALL non-digits globally, so it would concatenate every digit run in the string ("2 غرف 3 دورات"
    # → 23) — categorically wrong for the embedded-text shapes this scraper feeds. Same for
    # _price_from_text below (ألف/مليون magnitude words are an Eastabha-source quirk).
    if not s:
        return None
    s = str(s).translate(_AR_DIGITS).replace("٬", ",")
    m = re.search(r"[\d,]+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        v = float(m.group(0).replace(",", ""))
        return int(v) if v else None
    except ValueError:
        return None


def _price_from_text(s: Optional[str]) -> Optional[int]:
    """Parse a price from free Arabic text, honouring magnitude words: '400 ألف ريال' → 400000,
    '1.2 مليون' → 1200000. Plain numbers pass through. Sub-1000 results are treated as parse
    noise (the bug that stored land prices as 400/100 — the 'ألف' was being dropped)."""
    if not s:
        return None
    txt = re.sub(r"<[^>]+>", " ", up.unquote(str(s))).translate(_AR_DIGITS).replace("٬", ",")
    m = re.search(r"[\d,]+(?:\.\d+)?", txt)
    if not m:
        return None
    try:
        val = float(m.group(0).replace(",", ""))
    except ValueError:
        return None
    if any(w in txt for w in ("مليون", "ملايين")):
        val *= 1_000_000
    elif any(w in txt for w in ("ألف", "الف", "آلاف")):
        val *= 1_000
    val = int(val)
    return val if val >= 1000 else None


def _attr(name: str, html: str) -> Optional[str]:
    """First value of a data-* attribute, read independently of sibling-attribute order."""
    m = re.search(name + r'="([^"]*)"', html)
    return m.group(1) if m else None


def fetch_taxonomies(get) -> dict[str, dict[int, str]]:
    out: dict[str, dict[int, str]] = {}
    for tax in TAXONOMIES:
        d: dict[int, str] = {}
        page = 1
        while True:
            r = get(f"{BASE}/wp-json/wp/v2/{tax}?per_page=100&page={page}")
            if not r or r.status_code != 200:
                break
            arr = r.json() or []
            for t in arr:
                d[int(t["id"])] = (t.get("name") or "").strip()
            if len(arr) < 100:
                break
            page += 1
        out[tax] = d
    return out


def fetch_list(get) -> list[dict]:
    out: list[dict] = []
    page = 1
    pages = 1
    while page <= pages:
        r = get(f"{LIST_API}?per_page=100&page={page}")
        if not r or r.status_code != 200:
            break
        if page == 1:
            pages = int(r.headers.get("x-wp-totalpages", "1") or "1")
        out += r.json() or []
        page += 1
    return out


def _names(p: dict, tax: str, taxd: dict[str, dict[int, str]]) -> list[str]:
    return [taxd[tax][i] for i in (p.get(tax) or []) if i in taxd.get(tax, {})]


def _lookup_type(raw: str) -> Optional[str]:
    """EXACT-match lookup: Eastabha overrides first, then the shared canonical map. Deliberately
    map_type_exact (NO substring pass) so _derive_type's two-phase scan below keeps its historical
    ordering — phase 1 is exact-per-name across ALL names before any fuzzy work starts."""
    return normalize.map_type_exact(raw, overrides=TYPE_OVERRIDES_AR)


def _derive_type(cat_names: list[str]) -> Optional[str]:
    for raw in cat_names:
        hit = _lookup_type(raw)
        if hit:
            return hit
    # strip deal/status words and retry on the residual token(s)
    for raw in cat_names:
        residual = raw
        for w in _DEAL_WORDS:
            residual = residual.replace(w, " ")
        residual = re.sub(r"\s+", " ", residual).strip()
        for tok in (residual, residual.replace("ة", "ه"), residual.replace("ه", "ة")):
            hit = _lookup_type(tok)
            if hit:
                return hit
        # commercial hints
        if "تجار" in raw or "محل" in raw or "مكتب" in raw or "مستودع" in raw:
            return "Commercial Land" if "ارض" in raw or "أرض" in raw else "Shop"
    return None


def parse_detail(html_text: str) -> dict[str, Any]:
    """Pull numeric specs + geo + gallery from the WP Residence detail page."""
    out: dict[str, Any] = {}
    # Read each map-pin attribute INDEPENDENTLY — their order isn't stable, and the old fixed-order
    # regex silently matched nothing (→ null beds/area) when the order differed.
    out["bedrooms"] = _num(_attr("data-rooms", html_text))      # 0 → None (lister left it blank)
    out["bathrooms"] = _num(_attr("data-bathrooms", html_text))
    size = _attr("data-size", html_text)
    if size:
        out["area_m2"] = _num(re.sub(r"<[^>]+>", "", up.unquote(size)))
    # Price: trust the numeric data-clean_price when > 0, else parse the display text WITH its
    # ألف/مليون magnitude word (land listings carry clean_price=0 and a "400 ألف ريال" text).
    clean = _num(_attr("data-clean_price", html_text))
    out["price"] = clean if (clean and clean > 0) else _price_from_text(_attr("data-price", html_text))
    if not out.get("price"):
        pm = re.search(r'class="price_area">(.*?)</div>', html_text, re.S)
        if pm:
            out["price"] = _price_from_text(pm.group(1))
    # geo
    g = re.search(r'data-cur_lat="([\d.\-]+)"\s+data-cur_long="([\d.\-]+)"', html_text)
    if g and g.group(1) not in ("", "0"):
        out["lat"], out["lng"] = g.group(1), g.group(2)
    # gallery from the carousel's full-size hrefs; fall back to any uploads image on the page so a
    # non-standard gallery markup still yields photos (build_photos filters theme assets + dedupes).
    cm = re.search(r'id="property_slider_carousel"(.*?)</ol>', html_text, re.S)
    block = cm.group(1) if cm else html_text
    hrefs = re.findall(r'<a href="(https://eastabha\.sa/wp-content/uploads/[^"]+?\.(?:jpe?g|png|webp))"[^>]*class="prettygalery"', block, re.I)
    if not hrefs:
        hrefs = re.findall(r'https://eastabha\.sa/wp-content/uploads/[^"\'\s]+?\.(?:jpe?g|png|webp)', html_text, re.I)
    out["gallery"] = hrefs
    return out


def _content_specs(content: str) -> dict[str, Any]:
    """Best-effort numeric pulls from the Arabic content text (area / age)."""
    txt = _clean(content)
    out: dict[str, Any] = {}
    am = re.search(r"(?:المساحة|مساحة|مساحه)\D{0,6}([\d٠-٩,\.]+)\s*(?:م|متر)", txt)
    if am:
        out["area_m2"] = _num(am.group(1))
    gm = re.search(r"عمر\D{0,8}([\d٠-٩]+)\s*(?:سنة|سنوات|عام)", txt)
    if gm:
        out["property_age"] = _num(gm.group(1))
    return out


def _is_real_photo(u: str) -> bool:
    low = u.lower()
    if any(x in low for x in ("/themes/", "/plugins/", "logo", "placeholder", "icon", "avatar", "artboard")):
        return False
    return True


def _strip_size(u: str) -> str:
    # turn ...-835x467.jpg into the original (...-scaled or bare). Keep -scaled, drop -WxH.
    return re.sub(r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)", "", u, flags=re.I)


def build_photos(featured_src: Optional[str], gallery: list[str]) -> list[str]:
    seen: list[str] = []
    for u in ([featured_src] if featured_src else []) + gallery:
        if not u or not _is_real_photo(u):
            continue
        u = _strip_size(u)
        if u not in seen:
            seen.append(u)
    return seen


def _listing_url(p: dict) -> str:
    """The real, working public URL. eastabha.sa renders pages at the SLUG path
    (/properties/<slug>/); the post-id path /properties/<id>/ 404s for most listings, so we store
    and fetch the slug `link` that the REST API gives us."""
    link = p.get("link")
    if isinstance(link, str) and link.startswith("http"):
        return link
    return f"{BASE}/properties/{p.get('id')}/"


def map_listing(p: dict, taxd: dict[str, dict[int, str]], detail: dict, featured_src: Optional[str]):
    """Return (row, category, gone) or (None, None, False) if it must be skipped (auction / unmappable)."""
    actions = _names(p, "property_action_category", taxd)
    if any(any(a in name for a in ACTION_AUCTION) for name in actions):
        return None, None, False  # SKIP auctions entirely
    is_rent = any(any(a in name for a in ACTION_RENT) for name in actions)
    # if action is missing, infer rent from category words
    cat_names = _names(p, "property_category", taxd)
    if not actions and any("إيجار" in c or "ايجار" in c or "للايجار" in c for c in cat_names):
        is_rent = True
    if any("مزاد" in c for c in cat_names):  # auction also shows up in category sometimes
        return None, None, False

    # Batch 2 type-truth contract (owner directive 2026-07-16, applied here by the normalize
    # unification): an UNMAPPED category must be preserved RAW — never confidently stored as the old
    # guessed "Land" default — so the DB novel-type detector can see and quarantine it. The legacy
    # "Land" value survives ONLY as the routing variable below (never stored), keeping the
    # residential/commercial table routing byte-identical to the pre-fix behaviour.
    mapped_type = _derive_type(cat_names)
    property_type = mapped_type or "Land"  # type-truth: routing-legacy only — never stored
    stored_property_type = mapped_type or (cat_names[0].strip() if cat_names else None) or "unknown"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    city_ar = (_names(p, "property_city", taxd) or [""])[0]
    area_names = _names(p, "property_area", taxd)
    district_ar = area_names[0] if area_names else None
    region_names = [r for r in _names(p, "property_county_state", taxd)]
    region_ar = next((r for r in region_names if REGION_MAP_AR.get(r)), None) or next(
        (r for r in region_names if r != "المملكة العربية السعودية"), None
    )
    # Overrides first (Eastabha's historical labels, exact match), then the shared canonical map —
    # which also brings map_city()'s normalization + substring tolerance to inputs the old private
    # .get() missed (those all returned an honest None before, so this is coverage gain only).
    city = normalize.map_city(city_ar, overrides=CITY_OVERRIDES_AR)
    # Forward-fix (2026-07-10 location-data-quality audit): removed the hardcoded "Asir" region
    # default — city was already an honest None here when unresolved; region should be too.
    region = (REGION_MAP_AR.get(region_ar) if region_ar else None) or CITY_TO_REGION.get(city or "")

    price = detail.get("price")
    area_m2 = detail.get("area_m2") or _content_specs((p.get("content") or {}).get("rendered", "")).get("area_m2")
    age = _content_specs((p.get("content") or {}).get("rendered", "")).get("property_age")
    ppm = None
    if price and area_m2:
        ppm = round(price / area_m2)

    title = _redact(_clean((p.get("title") or {}).get("rendered", "")))
    description = _redact(_clean((p.get("content") or {}).get("rendered", "")))[:4000] or None

    features_ar = _names(p, "property_features", taxd)
    status_ar = (_names(p, "property_status", taxd) or [None])[0]

    # ── availability: تأجرت / تم البيع mean off-market (owner decision). Exact trimmed match
    # against GONE_STATUS_AR only; any other/unknown status (incl. "مزاد …") stays active.
    gone = (status_ar or "").strip() in GONE_STATUS_AR

    amenity_cols: dict[str, bool] = {}
    for fa in features_ar:
        col = FEATURE_COL.get(fa)
        if col:
            amenity_cols[col] = True

    photos = build_photos(featured_src, detail.get("gallery") or [])

    add: dict[str, Any] = {
        "city_ar": city_ar or None,
        "region_ar": region_ar or None,
        "district_ar": district_ar,
        "property_category_ar": cat_names or None,
        "action_category_ar": actions or None,
        "features_ar": features_ar or None,
        "status_ar": status_ar,
        "published": p.get("date"),
        "modified": p.get("modified"),
        "rega_license": None,  # this site shows no REGA advertising-license number
        "rega_note": "No REGA advertising license number is displayed on eastabha.sa.",
    }
    if detail.get("lat"):
        add["lat"], add["lng"] = detail["lat"], detail["lng"]

    row = {
        "ad_number": f"EA{p.get('id')}",
        "listing_url": _listing_url(p),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "active": not gone,
        "source": "Eastabha",
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area_m2,
        "bedrooms": detail.get("bedrooms") or None,
        "bathrooms": detail.get("bathrooms") or None,
        "property_age": age,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": district_ar,
        "rega_location_verified": False,
        "photo_urls": photos,
        "title": title or None,
        "description": description,
        "date_added": p.get("date"),
        "last_update": p.get("modified"),
        "additional_info": add,
        **amenity_cols,
    }
    return row, category, gone


def _pin_sold_inactive(table: str, ad_numbers: list[str]) -> None:
    """Make source-confirmed SOLD/RENTED rows survive the nightly auto_recover_false_inactive() sweep.

    That pg_cron job (05:20 UTC) re-activates any active=false row with
    coalesce(missing_count, 0) = 0 and a fresh last_seen_at — and the shared batch upsert
    (db._wasalt_batch) unconditionally writes missing_count=0 for every row it touches, which is
    exactly what would let sold/rented listings resurrect every morning. So AFTER the batch upsert
    we pin the gone rows to missing_count=3 (the existing prune 3-strike threshold) + active=false.
    prune_unseen() never undoes this: it only selects active=true rows and only updates ids NOT
    in its seen set. When a listing is later relisted, its next upsert carries active=true and
    the upsert's own missing_count=0 reset applies — the pin is only written for ids that are
    sold/rented THIS crawl."""
    for i in range(0, len(ad_numbers), 200):
        db._execute(
            db.sb().table(table).update({"active": False, "missing_count": 3})
            .in_("ad_number", ad_numbers[i:i + 200]),
            what=table + ".sold_pin",
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="East Abha (eastabha.sa) scraper")
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="small validation run: scrape only N listings, no prune, no run-row")
    args = ap.parse_args()

    get = http.get
    small = args.limit > 0

    taxd = fetch_taxonomies(get)
    print(f"taxonomies: " + ", ".join(f"{k}={len(v)}" for k, v in taxd.items()))
    listings = fetch_list(get)
    print(f"East Abha: {len(listings)} listings from REST")

    run_id = None if small else db.begin_run("eastabha")
    res: list[dict] = []
    com: list[dict] = []
    sold_res: list[str] = []
    sold_com: list[str] = []
    gone_ct = 0
    skipped_auction = 0
    seen = 0
    try:
        for p in listings:
            pid = p.get("id")
            if not pid:
                continue
            r = get(_listing_url(p))
            detail = parse_detail(r.text) if r and r.status_code == 200 else {}
            featured_src = None
            fm = p.get("featured_media")
            if fm:
                mr = get(f"{BASE}/wp-json/wp/v2/media/{fm}")
                if mr and mr.status_code == 200:
                    featured_src = (mr.json() or {}).get("source_url")
            row, cat, gone = map_listing(p, taxd, detail, featured_src)
            if not row:
                skipped_auction += 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if gone:
                gone_ct += 1
                (sold_com if cat == "commercial" else sold_res).append(row["ad_number"])
            seen += 1
            if small and seen >= args.limit:
                break

        if res:
            db.upsert_eastabha_residential_batch(res)
        if com:
            db.upsert_eastabha_commercial_batch(com)
        # Pin sold/rented rows immediately after the upsert (which reset their missing_count to 0),
        # so the 05:20 auto-recover job can never flip them back to active. See _pin_sold_inactive.
        if sold_res:
            _pin_sold_inactive("eastabha_residential_listings", sold_res)
        if sold_com:
            _pin_sold_inactive("eastabha_commercial_listings", sold_com)

        pruned = 0
        if not small:  # prune unseen only on full runs (db.prune_unseen guards against 0-scrape wipes)
            # Sold/rented rows were upserted with active=False + pinned missing_count=3 above;
            # prune_unseen never touches them (it only reads active=true rows and only updates ids
            # ABSENT from the seen set), so passing their ad_numbers in rows_seen is harmless.
            for tbl, rows_seen in (("eastabha_residential_listings", res), ("eastabha_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Eastabha")
                if n < 0:
                    print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
                else:
                    pruned += n

        print(f"✓ Eastabha: {len(res)} residential + {len(com)} commercial upserted, "
              f"{gone_ct} sold/rented (inactive), {skipped_auction} auctions skipped, {pruned} stale pruned")
        if run_id:
            db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                       notes=f"auctions_skipped={skipped_auction} gone={gone_ct} pruned={pruned}", check_tables=["eastabha_residential_listings", "eastabha_commercial_listings"])
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
