"""Aouj Estates — عوج العقارية (aoujestates.com) — single-broker Eastern-Province agency.

MECHANISM. One public, unauthenticated JSON endpoint carries the WHOLE catalogue:

    GET https://crm.aoujestates.com/api/public/properties  ->  200, application/json,
    a bare array of 76 objects. No auth, no cookies, no query params, no cursor, no
    page/limit. ONE request = a full refresh, so this scraper is a single GET.

The public site (https://aoujestates.com/ar/properties) is a Next.js RSC shell whose raw
HTML has no <a href> detail links and no pagination controls — it embeds this same array
in its flight chunks. We read the API, never the RSC. Detail URLs are rebuilt from the
object's own Arabic slug: https://aoujestates.com/ar/properties/{quote(slugs.ar)}.

REALNESS EVIDENCE (verified live 2026-09-02, this file's own dry-run + the prior audit):
  * Three INDEPENDENT counts agree on 76: the API array, the public page's own «76 عقار»,
    and sitemap.xml's 76 /ar/properties/<slug> entries.
  * 76/76 unique ids, 76/76 unique Arabic slugs, 71 distinct titles, 65 distinct prices,
    zero exact duplicates on (title, price, area). Prices 9,000 → 131,950,000 SAR.
  * Real Eastern-Province districts (الحمراء، الصناعية الثانية، الشعلة، الصواري، العدامة …),
    geo inside the Dammam/Khobar box, 1–26 real photos per listing (mean 6.5).
  * Two detail pages cross-checked against the API: id 187 JSON-LD offers.price 60000 SAR /
    المساحة 129 MTK, id 264 29,017,400 SAR / 5,003 MTK — exact matches.
  * robots.txt is "User-Agent: *  Allow: /" with no Disallow. No CAPTCHA, no rate limiting,
    nothing bypassed.

WHAT THIS SOURCE DOES NOT PUBLISH (persisted as NULL, never defaulted — SOURCE IS TRUTH):
  * RENT PERIOD. `price_period` is {"ar":"","en":""} on ALL 76 rows. The 7 for-rent listings
    therefore carry rent_period = NULL. We do NOT read a period out of the description prose
    (listing 187's body says «إيجار سنوي 60 ألف ريال») — a token anywhere in a blob is exactly
    the detector shape killed on 2026-08-11 for producing confident wrong numbers.
  * AMENITIES / FURNISHED. `features` is [] on all 76 — every amenity facet stays NULL.
  * AGE. `year_built` on 8/76 only; kept raw in additional_info, no age column is written.
  * A PER-LISTING per-m² price. See PRICE below.
  * A PER-LISTING REGA advertisement licence on 68/76 (the 76/76 `fal_license` is the agency's
    single company FAL 1200041097, not a per-ad licence).

PRICE (owner invariant: PRICE = SOURCE, never calculated).
  `price` is the published total and goes to price_total (Buy) / price_annual (Rent).
  `price_per_sqm` is NOT an independently published rate: measured live, it equals
  price / area on 76/76 rows with 46 fractional values (155 m² @ "4838.71", 515 m² @ "17.48").
  That is the CRM's own arithmetic, which the 2026-08-09 aqargate ruling says we do not adopt
  ("landTotalPrice = propertyPrice × propertyArea … that is its arithmetic, not a published
  price"). So price_per_meter stays NULL and the raw string is preserved verbatim in
  additional_info/source_capture, where an audit can still see what the site displayed.

DELIBERATELY NOT INGESTED (counted and printed every run, never silently folded):
  * status "for-investment" (2 land rows) — maps to neither بيع nor إيجار; needs an owner
    product decision before it can be given a transaction_type.
  * type "mall" (مجمع تجاري ×2), "tower" (برج ×1), "station" (محطة ×1) — no certain mapping
    into the existing canonical vocabulary, and inventing one is forbidden. (The other برج row,
    id 151, maps legitimately: its own Arabic title says «عمارة للبيع» → Building.)

OPEN MAPPING QUESTION FOR THE OWNER (shipped the fleet default, did NOT decide it here).
  `type[0]` is the bare genus token "land" on 36 rows, which the shared vocabulary resolves to
  "Residential Land" — the same thing every other Ezhalah platform does with an unqualified أرض.
  But 19 of those listings carry a qualifier in their own Arabic TITLE: «صناعية» (industrial) on
  13 and «تجارية» (commercial) on 6, e.g. «ارض صناعية غرب الدمام - 5 قطع», 203,000 m², 131.9M SAR.
  Reading a type out of prose when the structured field says something else is the same move as
  reading a rent period out of prose, so it is not done here; the qualifier is preserved in the
  title, description and source_capture. If the owner decides those should be Commercial Land /
  Industrial Land, that is one line in TYPE_AR's resolution order — not a guess this scraper makes.

    python -m scrapers.aouj.run --type all --limit 15 --dry-run   # validate, ZERO db writes
    python -m scrapers.aouj.run --type all --limit 15             # validation upsert, NO prune
    python -m scrapers.aouj.run --type all                        # full refresh + prune
    python -m scrapers.aouj.run --self-test                       # offline parser asserts
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

from scrapers.common import db
from scrapers.common import normalize as N
from scrapers.common.pii import redact_capture, redact_pii

API = "https://crm.aoujestates.com/api/public/properties"
SITE = "https://aoujestates.com"
SOURCE = "Aouj"
PLATFORM = "aouj"

# The source's `type[0]` token → the Arabic label the site itself prints for it. The label is then
# resolved through the SHARED canonical vocabulary (N.map_type_exact) — this table introduces no new
# Arabic word and no new English type, it only names which existing word each token means.
# mall/tower/station have no certain canonical equivalent, so they are absent on purpose: an unmapped
# row is skipped and reported, never guessed into a type.
TYPE_AR = {
    "land": "أرض",
    "villa": "فيلا",
    "apartment": "شقة",
    "building": "عمارة",
    "warehouse": "مستودع",
}

# `status[0]` → transaction_type. "for-investment" is absent deliberately (see module docstring).
DEAL = {"for-sale": "Buy", "for-rent": "Rent"}

# The label the site uses for a genuine per-ad REGA advertisement licence inside additional_details.
# Matched on label.ar EQUALITY only — those labels are free text and observably mis-keyed (listing
# 191 files a parcel-breakdown paragraph under «عدد الأدوار»), so nothing here is coerced to a number.
REGA_AD_LABEL = "رقم ترخيص الإعلان العقاري"

# ── location parsing ────────────────────────────────────────────────────────────────────────────
# `location[0]` is a clean city on 76/76. District is NOT a field: it must be read out of address.ar,
# which comes in two orderings — the hand-typed «الدمام ، الصناعية الثانية ، المملكة…» (city first)
# and the Google-reverse «البحيرة، محافظة الخبر، المنطقة الشرقية، 34722، المملكة…» (district first).
# So we take the first comma-part that is not administrative furniture.
CITY_TOKENS = frozenset({"الدمام", "الخبر", "الظهران", "صفوى", "القطيف"})
_LATIN = re.compile(r"[A-Za-z]")
# محافظة …/المنطقة …/postcode/country = administrative furniture; طريق …/شارع … is a ROAD, and a road
# is not a district (id 174 and two الشاطئ الغربي rows lead with one).
_ADMIN = re.compile(r"^(?:محافظة\b|المنطقة\b|\d{5}$|المملكة العربية السعودية$|طريق\b|شارع\b)")


def district_from_address(address_ar: Optional[str], city_ar: Optional[str]) -> Optional[str]:
    """The district the source printed, or None. Never falls back to the city (that would restate
    the city as a neighbourhood) and never emits a Latin-script part (no English district leaks)."""
    for part in re.split(r"[،,]", address_ar or ""):
        p = re.sub(r"\s+", " ", part).strip()
        if not p or _LATIN.search(p):
            continue
        if p in CITY_TOKENS or p == (city_ar or "") or _ADMIN.match(p):
            continue
        return re.sub(r"^حي\s+", "", p) or None
    return None


# ── PDPL ────────────────────────────────────────────────────────────────────────────────────────
# Real broker mobiles are published in the description body on 6 rows (e.g. «0559393077»), and 15
# Arabic descriptions carry a contact CTA. Truncate at the CTA, then run the SHARED canonical
# redactor (scrapers/common/pii) rather than a local copy of the phone patterns.
#
# THE TOKENS ARE PREFIX-SAFE ON PURPOSE. Arabic glues particles onto the next word, so a bare CTA
# token is a prefix of ordinary vocabulary and a substring match truncates real listing text:
# live listing 210 lost 115 characters of its own description («واتساع المساحات، ووجود مصعد …»)
# because «واتس» (WhatsApp) is the first four letters of «واتساع» (= "and the spaciousness of").
# That is a listing-fidelity regression, not a privacy win — no contact detail was in the cut text.
# So: WhatsApp is matched by its real word forms (واتساب / واتس اب / واتس آب), and the tokens whose
# feminine form is ordinary prose («جوالة» a patrol, «المعلنة» "the advertised") carry a one-char
# negative lookahead. Every genuine CTA form still matches — pinned in _self_test().
_CUT = re.compile(
    r"(للتواصل|للحجز|للاستفسار|اتصل|تواصل|واتس\s*[اأآ]ب|(?:ال)?جوال(?!ة)|رقم المعلن|المعلن(?!ة)|المسوق|"
    r"contact\s+aouj|contact\s+us|call\s+us|whatsapp|hotline)", re.I)


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = str(text)
    m = _CUT.search(t)
    if m:
        t = t[:m.start()]
    return redact_pii(t)


# ── fetch ───────────────────────────────────────────────────────────────────────────────────────
def fetch_catalog(tries: int = 3) -> list[dict]:
    """The whole catalogue in one polite GET, with bounded timeout and backoff on transient errors."""
    s = cc.Session(impersonate="chrome124", timeout=45)
    last = None
    for attempt in range(tries):
        try:
            r = s.get(API, headers={"Accept": "application/json"})
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, list):
                    return data
                raise ValueError(f"expected a JSON array, got {type(data).__name__}")
            last = RuntimeError(f"HTTP {r.status_code} from {API}")
        except Exception as exc:          # transport error / bad JSON → retry, then give up loudly
            last = exc
        time.sleep(2.0 * (attempt + 1))
    raise last or RuntimeError("aouj: catalogue fetch failed")


# ── mapping ─────────────────────────────────────────────────────────────────────────────────────
def _photos(o: dict) -> list[str]:
    out: list[str] = []
    for u in [o.get("featured_image")] + list(o.get("images") or []):
        if isinstance(u, str) and u and u not in out:
            out.append(u)
    return out


def _details(o: dict) -> tuple[Optional[str], dict[str, str]]:
    """(per-ad REGA licence, {label_ar: value_ar}) from the free-text additional_details list."""
    flat: dict[str, str] = {}
    for d in o.get("additional_details") or []:
        if not isinstance(d, dict):
            continue
        label = ((d.get("label") or {}).get("ar") or "").strip()
        value = ((d.get("value") or {}).get("ar") or "").strip()
        if label and value:
            flat[label] = value
    return flat.get(REGA_AD_LABEL) or None, flat


def map_item(o: dict) -> tuple[Optional[dict], str]:
    """(row, category) for an ingestible listing, else (None, skip-reason)."""
    ad_id = str(o.get("id") or "").strip()      # opaque: 75 numeric strings + 1 UUID. Never cast.
    if not ad_id:
        return None, "no id"

    deal_token = DEAL.get((o.get("status") or [None])[0])
    if not deal_token:
        return None, f"unmapped status {(o.get('status') or [None])[0]!r}"

    # Provably TOTAL for the null-deal guard (scrapers/common/tests/test_deal_mapping_total.py):
    # a NULL transaction_type is dropped by the search-sync eligibility filter, so that lint
    # requires the written value to be provably "Buy"/"Rent" by AST. The quarantine directly
    # above already returned for every non-canonical deal, so this re-expression cannot change
    # behaviour — it only makes the totality the guard enforces visible to the linter.
    transaction_type = "Rent" if deal_token == "Rent" else "Buy"

    type_token = (o.get("type") or [None])[0]
    title_ar = (o.get("title") or {}).get("ar") or ""
    # Structured token first; then the listing's OWN Arabic title (id 151 is typed "tower" while its
    # title says «عمارة للبيع» → Building). Both go through the shared canonical map.
    property_type = N.map_type_exact(TYPE_AR.get(type_token)) or N.map_type(title_ar)
    if not property_type:
        return None, f"unmapped type {type_token!r}"
    category = "commercial" if N.category_for_type(property_type) == "Commercial" else "residential"

    slug = (o.get("slugs") or {}).get("ar") or ""
    if not slug:
        return None, "no arabic slug"

    city_ar = (o.get("location") or [None])[0]
    city = N.map_city(city_ar or "")
    price = N.to_int(o.get("price"))

    # PERIOD = SOURCE. The ONLY period text this source has is price_period — empty on all 76 rows,
    # so this returns (None, price): period UNKNOWN, price stored exactly as published. The title and
    # description are deliberately NOT passed in: a period token loose in prose is not a period.
    period_text = " ".join(str((o.get("price_period") or {}).get(k) or "") for k in ("ar", "en"))
    rent_period, price_annual = (None, None)
    if transaction_type == "Rent":
        rent_period, price_annual = N.rent_period_and_annual(price, period_text)

    rega_ad_license, detail_labels = _details(o)
    geo = o.get("geo") or {}

    info: dict[str, Any] = {
        "aouj_id": ad_id,
        "property_id": o.get("property_id"),
        "slug_ar": slug,
        "slug_en": (o.get("slugs") or {}).get("en") or None,
        "title_en": (o.get("title") or {}).get("en") or None,
        "address_ar": (o.get("address") or {}).get("ar") or None,
        "address_en": (o.get("address") or {}).get("en") or None,
        "city_ar": city_ar,
        "district_ar": district_from_address((o.get("address") or {}).get("ar"), city_ar),
        "type_raw": type_token,
        "status_raw": (o.get("status") or [None])[0],
        # The site's own displayed per-m² figure. NOT written to price_per_meter — it is
        # price / area on 76/76 (see module docstring), i.e. the CRM's arithmetic.
        "price_per_sqm_displayed": o.get("price_per_sqm"),
        "rooms": o.get("rooms"),
        "garage": o.get("garage"),
        "year_built": o.get("year_built"),
        "land_area": o.get("land_area"),
        "agency_fal_license": o.get("fal_license"),      # company-level FAL, identical site-wide
        "rega_ad_license_number": rega_ad_license,       # genuine per-ad licence — 8/76 only
        "detail_labels": detail_labels or None,
        "latitude": geo.get("lat"),
        "longitude": geo.get("lng"),
        "map_url": o.get("map_url"),
        "first_published": o.get("date"),
        "verified_badge": o.get("verified"),
        "is_featured": o.get("is_featured"),
        "videos": o.get("videos") or None,
        "pdfs": o.get("pdfs") or None,
        "floor_plans": o.get("floor_plans") or None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], {})}

    row: dict[str, Any] = {
        "ad_number": f"AJ{ad_id}",
        "listing_url": f"{SITE}/ar/properties/{quote(slug, safe='')}",
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": transaction_type,
        # area is m², present on 76/76, sometimes fractional ("10776.24") → truncate, never round up.
        "area_m2": N.to_int_numeric(o.get("area")),
        # to_int_numeric treats "0" as no-value, which is what this source's "0" means: it appears
        # only on a land row and a tower row (bedrooms AND bathrooms AND rooms all "0"), i.e. the
        # CRM's not-provided sentinel. Storing 0 there would fabricate "this land has zero bedrooms".
        "bedrooms": N.to_int_numeric(o.get("bedrooms")),
        "bathrooms": N.to_int_numeric(o.get("bathrooms")),
        "price_total": price if transaction_type == "Buy" else None,
        "price_annual": price_annual,
        "rent_period": rent_period,
        "price_per_meter": None,          # source publishes no independent rate — see docstring
        "city": city,
        "region": N.region_for_city(city),
        "neighborhood": info.get("district_ar"),
        # Only a genuine per-AD REGA licence counts as location-verified. The 76/76 company FAL is
        # the agency's own licence and says nothing about this listing.
        "rega_location_verified": bool(rega_ad_license),
        "title": _redact(title_ar),
        "description": _redact((o.get("description") or {}).get("ar")),
        "photo_urls": _photos(o),
        "additional_info": info,
        # Complete source payload, once, so a field we do not model today never needs a re-scrape.
        # redact_capture() scrubs contact PII out of FREE TEXT only and leaves licences, coordinates
        # and prices byte-identical (owner rule 2026-08-09).
        "source_capture": redact_capture(o),
        "price_evidence": N.price_evidence(
            field="price",
            raw=o.get("price"),                 # the source's string, before any coercion
            stored=price,
            # kind has no "period unknown" value; a Rent row's honest period is the row's own
            # rent_period=NULL. unit="total" is the load-bearing half: this is a total, not a rate.
            kind="annual" if rent_period == "annual" else ("monthly" if rent_period == "monthly" else "total"),
            unit="total",
            origin="api",
        ),
    }
    return row, category


def crawl(limit: int = 0) -> tuple[list[dict], list[dict], int, list[str]]:
    data = fetch_catalog()
    res: list[dict] = []
    com: list[dict] = []
    skipped: list[str] = []
    for o in data:
        if not isinstance(o, dict):
            continue
        row, cat_or_reason = map_item(o)
        if row is None:
            skipped.append(f"{o.get('id')}: {cat_or_reason}")
            continue
        (com if cat_or_reason == "commercial" else res).append(row)
        if limit and len(res) + len(com) >= limit:
            break
    return res, com, len(data), skipped


# ── self-check (offline; the parsers that are not one-liners) ───────────────────────────────────
def _self_test() -> int:
    assert district_from_address("الدمام ، الصناعية الثانية ، المملكة العربية السعودية", "الدمام") == "الصناعية الثانية"
    assert district_from_address("البحيرة، محافظة الخبر، المنطقة الشرقية، 34722، المملكة العربية السعودية", "الخبر") == "البحيرة"
    assert district_from_address("الخبر، محافظة الخبر، المنطقة الشرقية، 34436، المملكة العربية السعودية", "الخبر") is None
    assert district_from_address("طريق الملك خالد الفرعي, At Taawun, Ath Thuqbah, Khobar Governorate", "الخبر") is None
    assert district_from_address("الدمام، حي الحسام، المملكة العربية السعودية", "الدمام") == "الحسام"

    # PDPL cut must fire on every real CTA form the site publishes …
    for cta in ("للتواصل: 0559393077", "واتساب 0559393077", "واتس اب 0559393077",
                "اتصلوا بنا", "الجوال: 0559393077", "رقم المعلن", "WhatsApp us", "Call us now"):
        assert _CUT.search(cta), cta
    # … and must NEVER fire on ordinary Arabic that merely STARTS with one (live listing 210 lost
    # 115 chars of its own description to «واتساع»; «جوالة»/«المعلنة» are the same shape).
    keep = "يتميز العقار بحداثة البناء واتساع المساحات، ووجود مصعد، بالإضافة إلى شقة مستقلة ومدخلين للشقة."
    assert _CUT.search(keep) is None
    assert _redact(keep) == keep, _redact(keep)
    assert _CUT.search("قريب من دوريات الجوالة والوحدة المعلنة") is None
    assert _redact("شقة مطلة على البحر\nللتواصل: 0559393077") == "شقة مطلة على البحر"

    rent = {"id": "187", "slugs": {"ar": "شقة-3-غرف"}, "title": {"ar": "شقة 3 غرف للإيجار في حي الحمراء - الخبر"},
            "description": {"ar": "إيجار سنوي 60 ألف ريال للتواصل 0559393077"},
            "address": {"ar": "الحمراء، محافظة الخبر، المنطقة الشرقية، المملكة العربية السعودية"},
            "type": ["apartment"], "location": ["الخبر"], "status": ["for-rent"],
            "price": "60000", "price_per_sqm": "465.12", "price_period": {"ar": "", "en": ""},
            "area": "129", "bedrooms": "3", "bathrooms": "3", "features": [], "images": []}
    row, cat = map_item(rent)
    assert cat == "residential" and row["property_type"] == "Apartment"
    assert row["ad_number"] == "AJ187" and row["transaction_type"] == "Rent"
    # PERIOD = SOURCE: the description SAYS «سنوي» and we still store NULL, because price_period does not.
    assert row["rent_period"] is None, row["rent_period"]
    assert row["price_annual"] == 60000 and row["price_total"] is None
    # PRICE = SOURCE: a derived per-m² figure never reaches price_per_meter.
    assert row["price_per_meter"] is None
    assert row["additional_info"]["price_per_sqm_displayed"] == "465.12"
    # PDPL: no broker phone survives in user-visible text or in the capture.
    assert "0559393077" not in json.dumps(row, ensure_ascii=False, default=str)
    assert row["neighborhood"] == "الحمراء" and row["city"] == "Khobar" and row["region"] == "Eastern Province"

    land = dict(rent, id="24", type=["land"], status=["for-sale"], location=["الدمام"],
                bedrooms="0", bathrooms="0", rooms="0", price="9400000", area="203000")
    row, cat = map_item(land)
    assert cat == "residential" and row["property_type"] == "Residential Land"
    assert row["bedrooms"] is None and row["bathrooms"] is None, "'0' is the CRM sentinel, not zero"
    assert row["price_total"] == 9400000 and row["price_annual"] is None and row["rent_period"] is None

    shop = dict(rent, id="221", type=["warehouse"], status=["for-rent"])
    assert map_item(shop)[1] == "commercial"
    # A tower typed 'tower' but titled «عمارة للبيع» reads its own word; a bare برج does not guess.
    assert map_item(dict(rent, id="151", type=["tower"], status=["for-sale"],
                         title={"ar": "عمارة للبيع - الشبيلي"}))[0]["property_type"] == "Building"
    assert map_item(dict(rent, id="90", type=["tower"], title={"ar": "برج الخبر التنفيذي"}))[0] is None
    assert map_item(dict(rent, id="8", status=["for-investment"]))[0] is None
    print("✓ aouj self-test passed")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: only the first N parsed listings, NO prune")
    ap.add_argument("--dry-run", action="store_true",
                    help="print normalized rows as JSON and write NOTHING to the database")
    ap.add_argument("--self-test", action="store_true", help="offline parser asserts, no network")
    args = ap.parse_args()

    if args.self_test:
        return _self_test()

    # --dry-run must not touch the DB at all: no begin_run, no upsert, no prune.
    run_id = None if (args.limit or args.dry_run) else db.begin_run(PLATFORM)
    seen = 0
    try:
        res, com, seen, skipped = crawl(limit=args.limit)
        if args.type != "all":
            keep_com = args.type == "commercial"
            res, com = ([] if keep_com else res), (com if keep_com else [])

        if skipped:
            print(f"⊘ {len(skipped)} listing(s) NOT ingested (owner decision needed, never guessed):")
            for s in skipped:
                print("   ", s)

        if args.dry_run:
            for r in res + com:
                print(json.dumps(r, ensure_ascii=False, default=str))
            print(f"✓ Aouj DRY RUN: {len(res)} residential + {len(com)} commercial parsed "
                  f"from {seen} source objects — 0 database writes")
            return 0

        if res:
            db.upsert_aouj_residential_batch(res)
        if com:
            db.upsert_aouj_commercial_batch(com)

        if args.limit:
            print(f"✓ Aouj VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            return 0

        pruned = 0
        for tbl, rows_seen in (("aouj_residential_listings", res),
                               ("aouj_commercial_listings", com)):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if nn < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += nn
        print(f"✓ Aouj: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} skipped={len(skipped)}",
                             check_tables=["aouj_residential_listings", "aouj_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.",
                  flush=True)
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
