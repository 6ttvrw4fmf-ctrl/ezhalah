"""Rich enricher for the Aqar residential pipeline.

Returns a dict ready for `db.upsert_aqar_residential()` — every column the new
`aqar_residential_listings` table has. Each field is grabbed from the page with a
targeted regex; missing values stay None (or False for boolean features).
"""
from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import urlparse, unquote

from scrapers.common.http import get
from scrapers.common import normalize as N


# PDPL: never store broker/advertiser contact. Strip Saudi mobile numbers from any free text we keep.
_PII_PHONE_RE = re.compile(r"(?:(?:\+|00)?966|0)5\d{8}")


def _redact_pii(s: str) -> str:
    return _PII_PHONE_RE.sub("[redacted]", s)


LISTING_ID_RE = re.compile(r"-(\d{6,})/?$")

# (column_name, list-of-Arabic-patterns) — feature is True if ANY pattern matches anywhere
# in the HTML. NOTE: this is a coarse signal (a listing that says "لا يوجد مصعد" still
# matches the elevator pattern). Good enough for v1; we can refine with negation later.
FEATURE_PATTERNS: list[tuple[str, list[str]]] = [
    ("elevator",                   [r"مصعد"]),
    ("kitchen",                    [r"مطبخ"]),
    ("car_entrance",               [r"مدخل\s*سيارة", r"مدخل\s*للسيارة", r"كراج"]),
    ("parking",                    [r"موقف\s*سيارة", r"مواقف"]),
    ("maid_room",                  [r"غرفة\s*خادم(?:ة|ه)", r"غرفة\s*شغّ?الة"]),
    ("driver_room",                [r"غرفة\s*سائق"]),
    ("water_supply",               [r"توفر\s*الماء", r"\bالماء\b", r"\bمياه\b"]),
    ("air_conditioner",            [r"مكيف", r"تكييف"]),
    ("electricity",                [r"توفر\s*الكهرباء", r"كهرباء"]),
    ("sanitation",                 [r"صرف\s*صحي"]),
    ("private_entrance",           [r"مدخل\s*خاص", r"مدخل\s*مستقل"]),
    ("optical_fibers",             [r"ألياف\s*بصرية", r"الياف\s*بصرية", r"فايبر", r"FTTH"]),
    ("laundry_room",               [r"غرفة\s*غسيل", r"غرفة\s*الغسيل"]),
    ("balcony_terrace",            [r"بلكونة", r"شرفة", r"تراس"]),
    ("separate_water_meter",       [r"عداد\s*ماء\s*(?:مستقل|منفصل)"]),
    ("separate_electricity_meter", [r"عداد\s*كهرباء\s*(?:مستقل|منفصل)"]),
    ("extension",                  [r"إمكانية\s*التوسعة", r"امكانية\s*التوسعة", r"قابلة\s*للتوسعة"]),
    ("special_surface",            [r"واجهة\s*مميزة", r"وجه\s*مميز"]),
    ("special_position",           [r"موقع\s*مميز"]),
    ("villa_on_roof",              [r"فيلا\s*على\s*السطح", r"شقة\s*على\s*السطح"]),
    ("apartment_in_project",       [r"ضمن\s*مشروع", r"داخل\s*مشروع"]),
]


def _flag(html: str, patterns: list[str]) -> bool:
    return any(re.search(p, html) for p in patterns)


def _int_after_label(html: str, *labels: str) -> Optional[int]:
    """Find the first number that appears right after ANY of the given Arabic labels."""
    for lbl in labels:
        m = re.search(rf"{lbl}[\s:]*?(\d+)", html)
        if m:
            return int(m.group(1))
    return None


def _text_after_label(html: str, *labels: str, max_len: int = 80) -> Optional[str]:
    for lbl in labels:
        m = re.search(rf"{lbl}[\s:]*([^\n<]{{1,{max_len}}})", html)
        if m:
            v = re.sub(r"\s+", " ", m.group(1)).strip()
            if v:
                return v
    return None


def _html_to_text(html: str) -> str:
    """Strip HTML tags + collapse whitespace so 'غرف النوم<span>3</span>' becomes
    'غرف النوم 3' — which our label+number regexes can match."""
    # Drop scripts/styles entirely (we don't want their content)
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    # Drop all remaining tags
    s = re.sub(r"<[^>]+>", " ", s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s)
    return s


def enrich_residential(url: str, *, type_slug: str, deal_slug: str) -> Optional[dict[str, Any]]:
    """Fetch one Aqar residential listing and return the row dict, or None on failure."""
    r = get(url)
    if r is None:
        return None
    html = r.text
    # `html` is kept for image-URL extraction (URLs survive tag-stripping fine, but the
    # regex was already written against the raw markup). `text` is the de-tagged plain
    # version we run all label+number regexes against from now on.
    text = _html_to_text(html)

    # ad_number — always the trailing numeric segment of the URL.
    m = LISTING_ID_RE.search(url)
    if not m:
        return None
    ad_number = m.group(1)

    # Map our slug → canonical type, then localize deal.
    property_type = N.SLUG_TO_TYPE.get(type_slug)
    transaction_type = "Rent" if deal_slug == "rent" else "Buy"

    # Land ZONING split: Aqar lumps every plot under one أراضي category (→ "Residential Land"). Read the
    # listing text to tag the real zoning so commercial/industrial/agricultural plots aren't all labelled
    # residential. Most-specific wins; no keyword → residential (Aqar's default). (user: split the land.)
    if property_type == "Residential Land":
        if re.search(r"صناعي", text):
            property_type = "Industrial Land"
        elif re.search(r"زراعي|مزرع", text):
            property_type = "Agriculture Plot"
        elif re.search(r"تجاري", text):
            property_type = "Commercial Land"

    # ─── Basic info ──────────────────────────────────────────────────────────
    area_m2           = _int_after_label(text, r"المساحة\s*(?:الكلية|الإجمالية)?", r"\bالمساحة\b")
    interior_space_m2 = _int_after_label(text, r"المساحة\s*الداخلية", r"مساحة\s*البناء")
    outdoor_area_m2   = _int_after_label(text, r"المساحة\s*الخارجية", r"مساحة\s*خارجية")
    bedrooms          = _int_after_label(text, r"غرف\s*النوم", r"عدد\s*الغرف")
    bathrooms         = _int_after_label(text, r"دورات\s*المياه", r"الحمامات", r"حمامات")
    master_bedrooms   = _int_after_label(text, r"غرف\s*ماستر", r"غرفة\s*ماستر", r"ماستر")
    halls             = _int_after_label(text, r"صالات", r"صالة", r"غرفة\s*المعيشة", r"المعيشة")
    reception_majlis  = _int_after_label(text, r"مجالس", r"مجلس")
    property_age      = _int_after_label(text, r"عمر\s*العقار")
    street_width_m    = _int_after_label(text, r"عرض\s*الشارع")
    direction         = _text_after_label(text, r"الواجهة", r"واجهة\s*العقار")
    residence_type    = _text_after_label(text, r"نوع\s*السكن")
    project_name      = _text_after_label(text, r"اسم\s*المشروع")

    # ─── Pricing ─────────────────────────────────────────────────────────────
    price_annual: Optional[int] = None
    price_total:  Optional[int] = None
    price_per_meter: Optional[int] = None
    # The listing's billing period. Aqar shows rent as "69,000 §/سنوي" (yearly) OR "5,000 §/شهري"
    # (monthly). We keep the ORIGINAL period so the app can filter "per month" to true monthly rentals
    # instead of converting everything to yearly and losing the distinction. Default annual for Rent
    # (the Saudi norm); None for Buy. (user request: "per month = charged monthly, not yearly".)
    rent_period: Optional[str] = "annual" if transaction_type == "Rent" else None

    mp_yr = re.search(r"(\d[\d,]{2,})\s*[§ر﷼]?\s*/?\s*سنوي", text)
    if mp_yr:
        price_annual = N.to_int(mp_yr.group(1))

    mp_mo = re.search(r"(\d[\d,]{2,})\s*[§ر﷼]?\s*/?\s*شهري", text)
    if not price_annual and mp_mo:
        # No yearly price, but a "/شهري" figure → this is a genuinely MONTHLY rental. Tag it and store
        # the annualized figure too (monthly × 12) so sorting/compare still works. The app divides it
        # back by 12 for the monthly display.
        v = N.to_int(mp_mo.group(1))
        if v:
            price_annual = v * 12
            rent_period = "monthly"

    mp_m2 = re.search(r"(\d[\d,]{1,})\s*[§ر﷼]?\s*/?\s*(?:متر|م²)", text)
    if mp_m2:
        price_per_meter = N.to_int(mp_m2.group(1))

    if transaction_type == "Buy":
        # Aqar Buy prices show up as "1,200,000 §" / "299,000 §" / sometimes plain "1200000 §".
        # Try several formats; sanity-check that the number is >= 50K SAR (rules out per-meter
        # figures and stray numbers that happen to sit next to the riyal symbol).
        for pat in (
            r"(\d{1,3}(?:,\d{3}){2,3})\s*[§ر﷼]",  # 1,200,000 §
            r"(\d{1,3}(?:,\d{3}){1,3})\s*[§ر﷼]",  # 299,000 §
            r"(\d{6,9})\s*[§ر﷼]",                  # 1200000 §
        ):
            mp_total = re.search(pat, text)
            if mp_total:
                v = N.to_int(mp_total.group(1))
                if v and v >= 50_000:
                    price_total = v
                    break

    # The bulletproof signal is the internal route URL `/rnpl/seek?id=...` which Aqar
    # only embeds when this financing option is enabled for the listing. We check the
    # raw HTML (not the de-tagged text) so the URL stays intact. Text-form variants are
    # a backup. (user request: pick up the actual Arabic wording used by Aqar.)
    rent_now_pay_later = (
        "/rnpl/" in html
        or _flag(text, [
            r"استأجر\s*الآن(?:\s*و?)?\s*(?:ا?دفع|أدفع)?\s*لاحق",  # "استأجر الآن وأدفع لاحقًا" + variants
            r"إيجار\s*الآن[^.<\n]{0,30}لاحق",
            r"ادفع\s*لاحقاً?",
            r"تمكين",
            r"rent\s*now\s*pay\s*later",
        ])
    )

    # When RNPL is offered Aqar prints the starting monthly installment like
    # "استأجر الآن وأدفع لاحقًا ابتداءً من 8,025 § شهريا". Capture that monthly figure so the app can
    # surface a "from SAR X/month" badge on the listing card. (user request.)
    rent_now_pay_later_monthly: Optional[int] = None
    if rent_now_pay_later:
        # Look for the "starting from N شهريا" snippet near the RNPL phrase. Two patterns: the
        # explicit "ابتداءً من" prefix, OR a bare "N § شهريا" / "N شهرياً" near the RNPL trigger.
        for pat in (
            r"ابتداء[ًاء]?\s*من\s*(\d[\d,]{2,})\s*[§ر﷼]?\s*شهري",
            r"(\d[\d,]{2,})\s*[§ر﷼]?\s*/?\s*شهري[ا]?\b",
        ):
            mp_rnpl = re.search(pat, text)
            if mp_rnpl:
                v = N.to_int(mp_rnpl.group(1))
                # Sanity-check: RNPL installments are reasonable monthly rents, not annual figures.
                if v and 500 <= v <= 100_000:
                    rent_now_pay_later_monthly = v
                    break

    # ─── Location ────────────────────────────────────────────────────────────
    # The URL slug always tells us the city + neighborhood reliably.
    city_ar = None
    md_city = re.search(r"/([^/]+?)/", url.split("aqar.fm")[-1].lstrip("/"))
    if md_city:
        city_ar = md_city.group(1)
    # Every city in our scrape matrix is in CITY_MAP_AR, so this maps cleanly. Fall back to
    # "Other" (NOT "Riyadh") if an unexpected slug ever appears — silently defaulting to Riyadh
    # is what buried 70+ towns inside Riyadh before. "Other" is a loud, harmless signal instead.
    city = N.map_city(city_ar or "") or "Other"

    # Region is DERIVED from the (reliable, URL-slug-based) city — NOT scraped from the page. The
    # page's "المنطقة" label proved fragile: when the layout differed it captured the <title>/
    # breadcrumb blob and leaked it into region for ~2.6k listings. City is trustworthy; region
    # follows from it via the canonical CITY_TO_REGION map. (June 2026 region audit.)
    region = N.region_for_city(city)
    neighborhood = None
    md_nbhd = re.search(r"/(?:حي|الحي)-([^/]+?)/", url)
    if md_nbhd:
        neighborhood = "حي " + md_nbhd.group(1).replace("-", " ")

    street_name       = _text_after_label(text, r"الشارع", r"اسم\s*الشارع")
    building_number   = _text_after_label(text, r"رقم\s*المبنى",  max_len=20)
    zip_code          = _text_after_label(text, r"الرمز\s*البريدي", max_len=20)
    additional_number = _text_after_label(text, r"الرقم\s*الإضافي", max_len=20)
    rega_verified     = _flag(text, [r"موقع\s*موثق", r"REGA", r"الهيئة\s*العامة\s*للعقار"])

    # ─── Features ────────────────────────────────────────────────────────────
    features = {col: _flag(text, pats) for col, pats in FEATURE_PATTERNS}

    # ─── Media & Metadata ────────────────────────────────────────────────────
    # ALL listing photos (no cap). Scoped to images.aqar.fm — the gallery CDN — so the broker
    # avatar on cdn.aqar.fm/users/* (PII) and the REGA s3 license icons are NOT swept in.
    # (capture-complete contract: store every photo URL the source exposes; the old [:30] cap was
    # silently dropping galleries — observed up to 65 distinct image URLs on a single listing.)
    photos = list(dict.fromkeys(re.findall(r'https://images\.aqar\.fm[^"\'\s]+', html)))
    mv = re.search(r'https://[^"\'\s]+\.(?:mp4|webm|mov)', html, re.IGNORECASE)
    video_url = mv.group(0) if mv else None
    mt = re.search(r"<title>(.*?)</title>", html, re.DOTALL)
    title = mt.group(1).strip() if mt else None
    md = re.search(r'<meta\s+name="description"\s+content="([^"]+)"', html)
    description = md.group(1).strip() if md else None
    date_added  = _text_after_label(text, r"تاريخ\s*الإعلان", r"تاريخ\s*الإضافة")
    last_update = _text_after_label(text, r"آخر\s*تحديث")

    # ── Complete-source capture (capture-once contract) ──────────────────────────
    # Stored in the DEDICATED `source_capture` column — NOT `additional_info` (which the app selects
    # on every search and renders as the {key,label,value} panel; Aqar keeps that NULL). source_capture
    # is never selected by the client, so this adds zero query weight to live search.
    # Aqar pages carry no clean JSON-LD/__NEXT_DATA__ blob and expose no coordinates; the de-tagged
    # visible `text` already holds every field the page shows (title, description, all specs, location
    # text, features, dates). Store it verbatim — minus Saudi phone numbers (PDPL) — so any field we
    # don't promote to a dedicated column today stays recoverable from stored data WITHOUT a re-scrape.
    # `url_path` keeps the full Arabic location hierarchy the slug encodes. Images = URLs only.
    # (The richer Next.js `self.__next_f` RSC flight payload is a future option, stored PII-redacted, if
    # a NON-visible structured field is ever needed; the visible text covers all Aqar displays today.)
    source_capture = {
        "schema": "aqar.v2-fulltext",
        "source_text": _redact_pii(text),
        "url_path": unquote(urlparse(url).path),
        "image_count": len(photos),
    }

    return {
        "ad_number":               ad_number,
        "listing_url":             url,
        "active":                  True,
        # basic
        "property_type":           property_type,
        "transaction_type":        transaction_type,
        "area_m2":                 area_m2,
        "interior_space_m2":       interior_space_m2,
        "outdoor_area_m2":         outdoor_area_m2,
        "bedrooms":                bedrooms,
        "bathrooms":               bathrooms,
        "master_bedrooms":         master_bedrooms,
        "halls":                   halls,
        "reception_rooms_majlis":  reception_majlis,
        "property_age":            property_age,
        "direction":               direction,
        "street_width_m":          street_width_m,
        "residence_type":          residence_type,
        "project_name":            project_name,
        # pricing
        "price_annual":            price_annual,
        "price_total":             price_total,
        "price_per_meter":         price_per_meter,
        "rent_period":             rent_period,
        "rent_now_pay_later":         rent_now_pay_later,
        "rent_now_pay_later_monthly": rent_now_pay_later_monthly,
        # location
        "city":                    city,
        "region":                  region,
        "neighborhood":            neighborhood,
        "street_name":             street_name,
        "building_number":         building_number,
        "zip_code":                zip_code,
        "additional_number":       additional_number,
        "rega_location_verified":  rega_verified,
        # features
        **features,
        # media
        "photo_urls":              photos,
        "video_url":               video_url,
        "title":                   title,
        "description":             description,
        "date_added":              date_added,
        "last_update":             last_update,
        # complete-source capture (full visible content + location path, PII-redacted). Dedicated
        # column the client never selects; keeps `additional_info` NULL for Aqar as the app expects.
        "source_capture":          source_capture,
    }
