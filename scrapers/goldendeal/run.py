"""الصفقة الذهبية العقارية (goldendeal.sa) — a Jeddah brokerage on the Nuzul SaaS platform (tenant
7102). Every number below was MEASURED live on 2026-09-23 over the WHOLE catalogue (275 items).

THIS FILE IS ALSO THE NUZUL TENANT ENGINE. scrapers/yameen/run.py (tenant 4561, host
`meteen.nzl-backend.com`) imports session/crawl/map_listing/verify_gone_for from here and supplies
only its own Tenant constants + main(). REPORTED: the fleet already has five older Nuzul tenants
(aldarim, abwbna, bahadhabab, alobid, october), each a private copy of this API's semantics — the
engine belongs in scrapers/common/nuzul_platform.py, a shared-module change this build may not make.

WHAT THE SITE IS. A Next.js front-end over the tenant's public JSON API:
    https://goldendeal.nzl-backend.com/api/public/properties?page=N&per_page=50
      → {"data": [item…], "links": {...}, "meta": {"current_page","last_page","per_page","total"}}
    https://goldendeal.nzl-backend.com/api/public/properties/{id}
      → 200 {"data": item}  |  404 {"message": "No query results for model [App\\Models\\Property] N"}
The tenant host is printed in the page's own RSC payload («tenantUrl»), which is how yameen's odd
`meteen` host was found. The web catalogue (/properties) is CLIENT-paginated: `?page=2` returns
page 1 again, and its RSC `initialData` holds only 9 items — so the API, not the page, is the
enumerator. meta.total (275) is the exact figure the page footer prints («عرض 9 من 275 العقارات»);
6 pages × 50 yielded 275 distinct ids. The list item and the detail item carry the SAME 108 keys,
so no per-listing fetch is needed. sitemap.xml lists 9 ids (all in the API) — stale, NOT the catalogue.

THE SHAPE OF ONE ITEM (the keys read, all measured present on 275/275):
    id · type (english token) · purpose sell|rent · category residential|commercial ·
    availability_status available|sold|rented|unavailable · name_ar (null on many; the site then
    renders «<type_ar> للبيع») · description_ar (HTML, 275/275) · city/district {name_ar,name_en} ·
    selling_price · rent_price_{monthly,quarterly,semi_annually,annually} · daily_price ·
    area (float m², 144/275) · built_up_area · bedrooms (167) · bathrooms · living_rooms ·
    majlis_rooms · maid_rooms · driver_rooms · kitchens · is_kitchen_installed · is_ac_installed ·
    is_furnished ('0' 256 / null 19) · elevators · parking_spots · balconies ·
    has_electricity/has_water/has_sewage · unit_floor_number · number_of_floors · year_built
    ('0' 173 / null 19 / a year 83) · facade (null 262; english tokens else) · street_width (the
    site labels it «عرض الشارع الشمالي») + _east/_south/_west · rega_ad_number (271/275) ·
    cover_image_url + images[].url (275/275, S3 originals; one fetched: 200 image/jpeg 40,315 B) ·
    latitude/longitude · unit_number (the office's own ref «GD969») · whatsapp_number +
    rega_advertiser_number (PII, dropped).

THE TRAPS, EACH MEASURED:
1. RETIRED IN PLACE. availability_status is the office's own «مباع» / «مؤجر» / «غير متاح» badge and
   the API keeps serving such items (goldendeal: 1 sold + 1 unavailable; yameen: 12 rented + 2
   unavailable of 27). SKIPPED, tallied as status_<value>, and the liveness oracle reads them as GONE
   so a row the crawl refuses cannot be self-healed back to life.
2. FOUR RENT FIELDS FOR ONE UNIT. A rent item may publish monthly AND quarterly AND semi-annual AND
   annual figures at once (yameen 43065: 2,500 / 7,500 / 15,000 / 30,000). PERIOD = SOURCE: when the
   source publishes an ANNUAL figure that figure is stored verbatim as annual; monthly-only is
   annualised ×12 through the shared helper and tagged monthly; quarterly/semi-annual-only has no
   bucket in this schema → (NULL, NULL), never parked as annual. Every published figure is kept in
   additional_info.rent_published. daily_price-only would be a nightly let → skipped (0 today).
3. NO PER-METRE PRICE EXISTS on this API (no such field), so price_per_meter is never written and
   area is never multiplied. selling_price is stored exactly as published (0/null → no price).
4. THE TYPE TOKEN IS ENGLISH; the site's own Arabic label for it lives in the page's i18n block and
   is copied into TYPE_AR (type_ar + the title fallback). Mapping goes through the shared
   normalize.map_type_en with exact overrides for the four tokens it lacks (building_studio, kiosk,
   workshop, istraha). `land` under the source's own category=commercial is Commercial Land.
   category_for_type() then decides the table — it files Duplex/Studio/Compound as commercial.
5. A ZERO IS NEVER PRINTED. Every count/flag is published on 100% of items, yet the page renders a
   labelled row ONLY for a positive value (measured on the visible DOM 2026-09-23): 53959
   (elevators 1, maid_rooms 1, kitchens 1) shows «المصعد 1 · غرفة الخادمات 1 · المطبخ 1»; 45882
   (elevators 0) shows «الصالة 6» and nothing about a lift; the «الخدمات» strip lists «كهرباء ·
   ماء · صرف صحي» and simply omits «صرف صحي» at has_sewage 0 (49287, yameen 43065). is_furnished /
   is_ac_installed / is_kitchen_installed are 0 on 216/216 available non-land items and have NO
   label on the page at all (dead form fields) — while the office's own prose says «مؤثثة» on 9 and
   «مكيف» on 18 of them. So a 0 here is the office not typing, never a published negative; the
   first build stored furnished=False on 90% of rows from it (reviewer-caught, the aldarim
   count_flag rule is that tenant's rendering, not this one's). Rule: a positive count/flag →
   True (exactly what the page prints); the tri-state comes from the office's words through the
   shared amenities_from_text (named → True, «بدون مصعد» → False, silent/«مؤسس»/«قريب من» →
   absent); a rendered positive contradicted by the prose is absent (the source disagrees with
   itself). Utilities the same way: 1 → True, 0/null → NULL. A bare plot carries no amenity key
   at all (38 of the 62 land items publish every count as 0, the other 24 as null).
6. year_built IS FREE ENTRY: "0" = not provided (173/275) → NULL; a 4-digit year → age via
   age_from_completion_year; a small integer is an age typed directly → the shared bounds gate.
   Land never carries an age.
7. street_width is the NORTH street; a plot with two or more widths keeps them all in
   additional_info.street_widths and street_width_m stays NULL (one number only).
8. facade tokens are English compounds («north_south_west»); the site's own Arabic label is mapped
   and direction is set only when normalize.one_direction accepts it (a single compass word, or a
   diagonal) — a three-sided facade stays NULL with the raw token kept.
9. THE DESCRIPTION IS HTML and carries phone numbers and «رقم الترخيص» prose: de-tagged, then
   redact_pii. license_number = rega_ad_number (the AD licence). rega_advertiser_number is the FAL
   broker licence and is dropped with whatsapp_number (PDPL).
11. THE TITLE NAMES THE OTHER DEAL. yameen 48429 is purpose=rent with rent_price_annually
   1,300,000 while its name_ar, JSON-LD and description say «فيلا للبيع … السعر: 1,300,000 ريال
   الرهن: مليون ريال لدى بنك الراجحي» — a sale keyed as a rent; goldendeal 49031 «شقة فاخرة للبيع…»
   is purpose=rent at 55,000/year. Following the structured field alone published a 1.3M/year
   rental (reviewer-caught). A name_ar naming the opposite deal from purpose is skipped as
   deal_conflict — a source stating both deals has stated neither (measured: 1 per tenant).
10. CITY. city.name_ar is the office's own city; to_catalog() must accept it or the row is skipped
   (never defaulted). Measured cities: جدة 251, مكة المكرمة 15, عرعر 3, المدينة المنورة 2, الدمام 2,
   مدينة الملك عبدالله الاقتصادية 1, الرياض 1. district.name_ar («حي الروضة») goes to
   find_district_in_text for the canonical district_ar; the raw text is the card's neighborhood.

REMOVAL ORACLE (measured 2026-09-23, both tenants, through the API the page itself renders from):
    live controls    goldendeal 4/4 → HTTP 200, data.id echoes, status available
                     yameen     3/3 → HTTP 200, data.id echoes, status available
    retired in place goldendeal 2/2 (sold, unavailable) → HTTP 200, status ≠ available
                     yameen     3/3 (rented)            → HTTP 200, status rented
    not served       6/6 goldendeal (3 yameen ids + 3 in-range gaps 53007/53011/53019) → HTTP 404
                     3/3 yameen (3 goldendeal ids)                                     → HTTP 404
                     body: {"message":"No query results for model [App\\Models\\Property] N"}
    The WEB page cannot be the oracle: an unknown id renders a 200 «Property Not Found» shell, and a
    retired id renders the full listing (200, RealEstate JSON-LD) — it never says gone.
    Signal: 404 + that message → gone; 200 whose data.id is THIS id → live iff status is available,
    else gone (the crawl's own predicate). Anything else → no opinion; the shared law refuses a
    death on 403/429/5xx/timeout/empty. Removals are canary-gated: before any kill, one id this run
    positively mapped is re-fetched and must echo its own id — fails CLOSED. prune runs only after a
    COMPLETE enumeration (len(items) == meta.total, no --limit).

MEASURED COVERAGE 2026-09-24 (re-measured after the trap-11 test was added; all 275 items through
the REAL map_listing, the location catalog read through the public anon key, read-only). 272
mapped (239 residential + 33 commercial); skipped 3: status_unavailable 1, status_sold 1,
deal_conflict 1 (id 49031). Buy 165 / Rent 107 (annual 106, monthly 1).
    title 272  description 272  city_id 272  district_ar 269  photo_urls 272 (all S3)
    price_total 164 (1 sale publishes no figure)  price_annual 107  rent_period 107
    area_m2 144  bedrooms 165  bathrooms 163  halls 159  reception_rooms_majlis 99
    floor_number 152  property_age 82  license_number 268  latitude 134
    street_width_m 4 (single-width plots; 6 more carry 2-4 widths → NULL, raw kept)
    direction 11  electricity/water/sanitation 272  furnished/elevator/parking/kitchen/AC/maid/
    driver/balcony 215 (the 57 land rows carry no amenity key)
    source-does-not-publish: price_per_meter, rent_now_pay_later, private_entrance, amenities[] (0/275)
    PII check over every stored field with the shared regexes on free text: 0 hits; 6 descriptions
    carry a «[redacted]» marker where the office typed a phone number.

    python -m scrapers.goldendeal.run --type all --limit 20 --dry-run   # validate, zero writes
    python -m scrapers.goldendeal.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, NamedTuple, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402


class Tenant(NamedTuple):
    platform: str      # scraper slug = table prefix
    source: str        # the site's official Arabic name (manifest name_ar)
    prefix: str        # ad_number prefix
    base: str          # the site origin the user lands on
    api_host: str      # the tenant's nzl-backend host (from the page's own «tenantUrl»)


TENANT = Tenant("goldendeal", "الصفقة الذهبية العقارية", "GDL", "https://www.goldendeal.sa",
                "goldendeal.nzl-backend.com")
BASE = TENANT.base
SOURCE = TENANT.source
PREFIX = TENANT.prefix
PLATFORM = TENANT.platform
RES_TABLE = "goldendeal_residential_listings"
COM_TABLE = "goldendeal_commercial_listings"

PER_PAGE = 50
MAX_PAGES = 40           # safety stop; the catalogue is 6 pages
PAGE_PAUSE = 0.6

# The site's OWN Arabic label per type token (copied from the page's i18n block, 2026-09-23).
TYPE_AR = {
    "building": "عمارة", "mansion": "قصر", "duplex": "دبلكس", "villa": "فيلا", "apartment": "شقة",
    "tower_apartment": "شقة في برج", "building_apartment": "شقة في عمارة",
    "villa_apartment": "شقة في فيلا", "building_studio": "استوديو في عمارة", "studio": "استوديو",
    "land": "أرض", "townhouse": "تاونهاوس", "villa_floor": "دور", "floor": "دور", "farm": "مزرعة",
    "istraha": "استراحة", "store": "محل تجاري", "office": "مكتب", "storage": "مخزن",
    "resort": "منتجع", "hotel": "فندق", "compound": "مجمع", "showroom": "معرض", "kiosk": "كشك",
    "workshop": "ورشة",
}
# Exact overrides for the tokens normalize.TYPE_MAP_EN lacks (map_type_en is exact-match, no
# substring pass). Every value is an existing canonical type. The shared map already folds the
# site's other tokens (mansion → Villa, resort → Hotel, townhouse → Villa); a token neither map
# knows («palace») is skipped as type_unmapped, never forced.
TYPE_OVERRIDES_EN = {"building_studio": "Studio", "kiosk": "Kiosk", "workshop": "Workshop",
                     "istraha": "Rest House", "villa_floor": "Floor"}
LAND_TYPES = {"Residential Land", "Commercial Land"}
# Types whose bedroom/bathroom counts describe ONE dwelling. A Building's counts describe units
# inside it; a Showroom's are a form default.
DWELLING_TYPES = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Room", "Rest House", "Chalet"}
# The site's own Arabic facade labels (i18n block) — fed to the shared direction resolver.
FACADE_AR = {
    "north": "شمالية", "east": "شرقية", "west": "غربية", "south": "جنوبية",
    "north_east": "شمالية شرقية", "north_west": "شمالية غربية", "south_east": "جنوبية شرقية",
    "south_west": "جنوبية غربية", "north_east_west": "شمالية شرقية غربية",
    "north_south_east": "شمالية جنوبية شرقية", "north_south_west": "شمالية جنوبية غربية",
    "south_east_west": "جنوبية شرقية غربية", "north_south_east_west": "شمالية جنوبية شرقية غربية",
    "north_south": "شمالية جنوبية", "east_west": "شرقية غربية",
}
# PDPL: the advertiser's contact channel and the FAL broker licence. redact_capture() drops
# «whatsapp»/«advertiser» keys on its own; these are named so the intent is readable.
PII_KEYS = {"whatsapp_number", "rega_advertiser_number", "is_whatsapp_number_enabled",
            "is_member_whatsapp_number_enabled"}
_NOT_FOUND = "No query results"
# trap 11: the deal the title names, when it is not the deal `purpose` keys.
_OPPOSITE_DEAL = {"rent": ("للبيع",), "sell": ("للإيجار", "للايجار", "للأيجار")}
# trap 5: amenity column ← the API fields whose POSITIVE value the page renders as a labelled row.
_POSITIVE_KEYS = {
    "kitchen": ("kitchens", "is_kitchen_installed"), "air_conditioner": ("is_ac_installed",),
    "furnished": ("is_furnished",), "elevator": ("elevators",), "parking": ("parking_spots",),
    "maid_room": ("maid_rooms",), "driver_room": ("driver_rooms",), "balcony_terrace": ("balconies",),
}


def session(tenant: Tenant = TENANT) -> cc.Session:
    # impersonate OWNS the User-Agent (feedback_impersonate_owns_the_user_agent).
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7",
                      "Origin": tenant.base, "Referer": tenant.base + "/"})
    return s


def api_url(tenant: Tenant, pid: Optional[int] = None) -> str:
    u = f"https://{tenant.api_host}/api/public/properties"
    return f"{u}/{pid}" if pid is not None else u


def fetch_all(s: cc.Session, tenant: Tenant, limit: int = 0) -> tuple[list[dict], Optional[int]]:
    """Walk the API pages. Returns (items, the API's OWN meta.total) so the caller can prove the
    crawl was complete rather than assume it."""
    items: list[dict] = []
    seen: set[int] = set()
    total: Optional[int] = None
    last_page = 1
    for page in range(1, MAX_PAGES + 1):
        if page > last_page:
            break
        r = s.get(f"{api_url(tenant)}?page={page}&per_page={PER_PAGE}", timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"API page {page} answered HTTP {r.status_code}")
        body = r.json()
        meta = body.get("meta") or {}
        total = N.to_int_numeric(meta.get("total")) if total is None else total
        last_page = int(meta.get("last_page") or 1)
        rows = body.get("data") or []
        if not rows:
            break
        for L in rows:
            pid = L.get("id")
            if isinstance(pid, int) and pid not in seen:
                seen.add(pid)
                items.append(L)
        if limit and len(items) >= limit:
            return items[:limit], total
        time.sleep(PAGE_PAUSE)
    return items, total


# ── FIELD HELPERS ───────────────────────────────────────────────────────────────────────────────
def _name_ar(v: Any) -> Optional[str]:
    if isinstance(v, dict):
        return (v.get("name_ar") or "").strip() or None
    return None


def _text(fragment: Optional[str]) -> Optional[str]:
    """De-tag the HTML description, keeping paragraph breaks; entities unescaped."""
    if not fragment:
        return None
    s = re.sub(r"</p>|<br\s*/?>", "\n", fragment)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html_mod.unescape(s)
    s = re.sub(r"[ \t ]+", " ", s)
    s = "\n".join(ln.strip() for ln in s.split("\n") if ln.strip())
    return s or None


def _positive(v: Any) -> Optional[bool]:
    """A count or 0/1 flag → True only when the page would RENDER it (> 0). A 0 and a null are
    both silence on this platform (trap 5), so neither becomes a stored negative."""
    return True if N.count_flag(v) else None


def _amenities(L: dict, prose: str) -> dict[str, bool]:
    """Tri-state from the office's own words (shared matcher), then each rendered positive count
    sets True — unless the prose negates that same amenity, in which case the source disagrees
    with itself and the key is left out (trap 5)."""
    out = N.amenities_from_text(prose)
    for col, keys in _POSITIVE_KEYS.items():
        if any(_positive(L.get(k)) for k in keys):
            if out.get(col) is False:
                del out[col]
            else:
                out[col] = True
    return out


def _int_keep_zero(v: Any) -> Optional[int]:
    """unit_floor_number: 0 is the ground floor, a real value; null is silence."""
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _age(year_built: Any, property_type: str, this_year: int) -> Optional[int]:
    if property_type in LAND_TYPES:
        return None
    try:
        n = int(str(year_built).strip())
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None                                   # "0" = not provided
    if n >= 1900:
        return N.age_from_completion_year(str(n), this_year=this_year)
    return N.parse_property_age(n)                    # an age typed directly, bounds-gated


_LICENCE_RE = re.compile(r"^\d{7,12}$")


def _licence(v: Any) -> Optional[str]:
    """rega_ad_number is free entry: yameen 43065 carries «.» in it. Only a REGA-shaped digit
    string is a licence; anything else is NULL (the raw value survives in source_capture)."""
    s = str(v).strip().translate(N._TRANS) if v is not None else ""
    return s if _LICENCE_RE.match(s) else None


def _street_widths(L: dict) -> dict[str, int]:
    out = {}
    for key, side in (("street_width", "north"), ("street_width_east", "east"),
                      ("street_width_south", "south"), ("street_width_west", "west")):
        w = N.to_int_numeric(L.get(key))
        if w is not None:
            out[side] = w
    return out


def _photos(L: dict) -> list[str]:
    out: list[str] = []
    cov = L.get("cover_image_url")
    if isinstance(cov, str) and cov.startswith("http"):
        out.append(cov)
    for im in L.get("images") or []:
        u = im.get("url") if isinstance(im, dict) else im
        if isinstance(u, str) and u.startswith("http") and u not in out:
            out.append(u)
    return out[:20]


def rent_price(L: dict) -> tuple[Optional[str], Optional[int], dict[str, int], str]:
    """(rent_period, price_annual, every published figure, skip_reason) — docstring trap 2."""
    pub = {k: N.to_int_numeric(L.get(f"rent_price_{k}"))
           for k in ("monthly", "quarterly", "semi_annually", "annually")}
    pub = {k: v for k, v in pub.items() if v is not None}
    daily = N.to_int_numeric(L.get("daily_price"))
    if daily is not None:
        pub["daily"] = daily
        if len(pub) == 1:
            return None, None, pub, "daily_only"
    if "annually" in pub:
        return "annual", pub["annually"], pub, ""
    if "monthly" in pub:
        return "monthly", N.annualize_rent(pub["monthly"], "monthly"), pub, ""
    return None, None, pub, ""       # quarterly / semi-annual only, or nothing published


def _title(L: dict, tok: str, transaction_type: str) -> Optional[str]:
    name = (L.get("name_ar") or "").strip()
    if name:
        return name
    type_ar = TYPE_AR.get(tok)
    if not type_ar:
        return None
    return f"{type_ar} {'للبيع' if transaction_type == 'Buy' else 'للإيجار'}"


# ── MAPPING ─────────────────────────────────────────────────────────────────────────────────────
def map_listing(L: dict, tenant: Tenant = TENANT, *,
                this_year: Optional[int] = None) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row is None exactly when skip_reason is set."""
    this_year = this_year or datetime.now(timezone.utc).year
    pid = L.get("id")
    if not isinstance(pid, int) or pid <= 0:
        return None, "residential", "missing_id"
    status = (L.get("availability_status") or "").strip().lower()
    if status != "available":
        return None, "residential", f"status_{status or 'blank'}"      # trap 1

    tok = (L.get("type") or "").strip().lower()
    src_category = (L.get("category") or "").strip().lower()
    property_type = N.map_type_en(tok, TYPE_OVERRIDES_EN)
    if tok == "land" and src_category == "commercial":
        property_type = "Commercial Land"
    if not property_type:
        return None, "residential", "type_unmapped"
    category = N.category_for_type(property_type).lower()

    purpose = (L.get("purpose") or "").strip().lower()
    if purpose not in ("sell", "rent"):
        return None, category, "purpose_unmapped"
    transaction_type = "Rent" if purpose == "rent" else "Buy"
    if any(t in (L.get("name_ar") or "") for t in _OPPOSITE_DEAL[purpose]):
        return None, category, "deal_conflict"                           # trap 11

    city_ar = _name_ar(L.get("city"))
    if not city_ar:
        return None, category, "city_missing"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = _name_ar(L.get("district"))
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    price_total = price_annual = rent_period = None
    rent_published: dict[str, int] = {}
    if transaction_type == "Buy":
        price_total = N.to_int_numeric(L.get("selling_price"))
    else:
        rent_period, price_annual, rent_published, why = rent_price(L)
        if why:
            return None, category, why

    area_raw = L.get("area")
    area_m2 = N.to_int_numeric(area_raw)
    dwelling = property_type in DWELLING_TYPES
    land = property_type in LAND_TYPES
    title = _title(L, tok, transaction_type)
    description = redact_pii(_text(L.get("description_ar")))
    # trap 5: a bare plot carries no amenity key; elsewhere the office's words + rendered positives.
    amenities = _amenities(L, f"{title or ''}\n{description or ''}") if not land else {}
    widths = _street_widths(L)
    facade = (L.get("facade") or "").strip().lower() or None

    row: dict[str, Any] = {
        "ad_number": f"{tenant.prefix}{pid}",
        "listing_url": f"{tenant.base}/properties/{pid}",
        "source": tenant.source,
        "active": True,
        "title": title,
        "description": description,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": N.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area_m2,
        "bedrooms": N.to_int_numeric(L.get("bedrooms")) if dwelling else None,
        "bathrooms": N.to_int_numeric(L.get("bathrooms")) if dwelling else None,
        "halls": N.to_int_numeric(L.get("living_rooms")) if not land else None,
        "reception_rooms_majlis": N.to_int_numeric(L.get("majlis_rooms")) if not land else None,
        "floor_number": _int_keep_zero(L.get("unit_floor_number")) if not land else None,
        "property_age": _age(L.get("year_built"), property_type, this_year),
        "street_width_m": next(iter(widths.values())) if len(widths) == 1 else None,   # trap 7
        "direction": N.one_direction(FACADE_AR.get(facade or "", ""), diagonal=True) or None,
        "license_number": _licence(L.get("rega_ad_number")),
        "electricity": _positive(L.get("has_electricity")),            # the «الخدمات» strip lists
        "water_supply": _positive(L.get("has_water")),                 # only what is 1; a 0 is
        "sanitation": _positive(L.get("has_sewage")),                  # never printed → silence
        **amenities,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": None,                                             # trap 3
        "rent_period": rent_period,
        "photo_urls": _photos(L),
        "additional_info": redact_capture({k: v for k, v in {
            "latitude": _float(L.get("latitude")),
            "longitude": _float(L.get("longitude")),
            "ref": (L.get("unit_number") or None),
            "type_token": tok,
            "type_ar": TYPE_AR.get(tok),
            "source_category": src_category or None,
            "usages": L.get("usages") or None,
            "availability_status": status,
            "area_exact": (str(area_raw) if isinstance(area_raw, float)
                           and area_raw != int(area_raw) else None),
            "built_up_area": N.to_int_numeric(L.get("built_up_area")),
            "rent_published": rent_published or None,
            "plan_number": L.get("plan_number") or None,
            "plot_number": L.get("plot_number") or None,
            "number_of_floors": N.to_int_numeric(L.get("number_of_floors")),
            "apartments": N.to_int_numeric(L.get("apartments")),
            "stores": N.to_int_numeric(L.get("stores")),
            "width": N.to_int_numeric(L.get("width")),
            "length": N.to_int_numeric(L.get("length")),
            "street_widths": widths or None,
            "facade_raw": facade,
            "year_built_raw": L.get("year_built") if L.get("year_built") not in (None, "", "0", 0) else None,
            "dining_rooms": N.to_int_numeric(L.get("dining_rooms")),
            "mulhaq_rooms": N.to_int_numeric(L.get("mulhaq_rooms")),
            "storage_rooms": N.to_int_numeric(L.get("storage_rooms")),
            "basement_rooms": N.to_int_numeric(L.get("basement_rooms")),
            "gardens": N.to_int_numeric(L.get("gardens")),
            "pools": N.to_int_numeric(L.get("pools")),
            "parking_shade": _positive(L.get("is_parking_shade")),
            "created_at": L.get("created_at"),
            "updated_at": L.get("updated_at"),
        }.items() if v is not None}),
        # Raw-capture standard: the whole item minus PII and the image preview ladders.
        "source_capture": redact_capture({
            "schema": "nuzul.v1",
            "tenant_host": tenant.api_host,
            **{k: v for k, v in L.items() if k not in PII_KEYS and k not in ("images", "cover_image")},
            "image_urls": _photos(L),
        }),
    }
    return row, category, ""


def _float(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f != 0.0 else None


def crawl(s: cc.Session, tenant: Tenant, limit: int = 0, mapper: Callable = None):
    """(items, api_total, res_rows, com_rows, skip_tally). `mapper` lets a tenant module put its
    own map_listing wrapper on the write path (yameen restates the deal write there so the fleet's
    per-file null-deal lint can prove it total)."""
    mapper = mapper or map_listing
    items, total = fetch_all(s, tenant, limit=limit)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    for L in items:
        row, cat, why = mapper(L, tenant)
        if not row:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        (com if cat == "commercial" else res).append(row)
    return items, total, res, com, skipped


def tally_str(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


# ── LIVENESS (docstring: REMOVAL ORACLE) ────────────────────────────────────────────────────────
def _signal_for(pid: int):
    def _signal(status, body, _moved):
        if status == 404 and _NOT_FOUND in (body or ""):
            return "gone"
        if status == 200:
            try:
                data = json.loads(body).get("data") or {}
            except (ValueError, AttributeError):
                return None
            if data.get("id") != pid:
                return None
            live = (data.get("availability_status") or "").strip().lower() == "available"
            return "live" if live else "gone"
        return None
    return _signal


def make_canary(tenant: Tenant, control_pid: Optional[int],
                session_factory: Callable[[], Any] = session) -> Callable[[], tuple[bool, str]]:
    """In-run positive control: an id THIS run positively mapped must still echo itself before any
    removal is allowed. Memoised per run; fails CLOSED on no control, a block, or a bad echo."""
    memo: dict[str, tuple[bool, str]] = {}

    def canary() -> tuple[bool, str]:
        if "v" in memo:
            return memo["v"]
        if not control_pid:
            memo["v"] = (False, "no live control id from this run")
            return memo["v"]
        try:
            r = session_factory().get(api_url(tenant, control_pid), timeout=30)
            echoed = r.status_code == 200 and (r.json().get("data") or {}).get("id") == control_pid
            memo["v"] = (echoed, f"control {control_pid} answered HTTP {r.status_code}"
                                 + ("" if echoed else " without echoing its own id"))
        except Exception as e:  # noqa: BLE001 — an unreachable source withholds every removal
            memo["v"] = (False, f"control {control_pid} unreachable: {type(e).__name__}")
        return memo["v"]
    return canary


def verify_gone_for(tenant: Tenant, canary: Callable[[], tuple[bool, str]],
                    session_factory: Callable[[], Any] = session):
    def _verify(ad_number: str) -> tuple[str, str]:
        pid = ad_number[len(tenant.prefix):]
        if not ad_number.startswith(tenant.prefix) or not pid.isdigit():
            return "unknown", f"{ad_number!r} is not a {tenant.prefix}<id> ad number"
        return LivenessProbe(platform=tenant.platform, signal=_signal_for(int(pid)),
                             session=session_factory,
                             url_for=lambda _ad: api_url(tenant, int(pid)),
                             canary=canary).verify_gone(ad_number)
    return _verify


def revisit_verify():
    """scrapers/common/fleet_revisit.py hook: this platform's oracle, unable to return 'gone'."""
    from scrapers.common.fleet_revisit import refuse_removals
    return verify_gone_for(TENANT, refuse_removals)


def print_dry(source: str, res: list[dict], com: list[dict]) -> None:
    print(f"✓ {source} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
    for r0 in (res + com)[:12]:
        print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} {str(r0['property_type']):16} "
              f"c={str(r0['city_ar'])[:10]:10} d={str(r0['district_ar'])[:14]:14} "
              f"a={str(r0['area_m2']):>6} bd={str(r0['bedrooms']):>4} pt={r0['price_total']} "
              f"pa={r0['price_annual']} rp={r0['rent_period']} ph={len(r0.get('photo_urls') or [])}")


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    s = session(TENANT)
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(PLATFORM)
    skipped: dict[str, int] = {}
    try:
        items, total, res, com, skipped = crawl(s, TENANT, limit=args.limit)
        if not items:
            raise RuntimeError("API returned no items (0 of an expected ~275)")
        complete = not args.limit and total is not None and len(items) == total
        note = f"{len(items)} items, api total {total}"
        print(f"{SOURCE}: {note}", flush=True)
        if not args.limit and not complete:
            print(f"  ! crawl/total mismatch: enumerated {len(items)} vs api total {total}")
        if args.type != "all":
            res, com = (res if args.type == "residential" else []), (com if args.type == "commercial" else [])
        tally = tally_str(skipped)
        if tally:
            print(f"  skipped (not guessed): {tally}")
        if dry:
            print_dry(SOURCE, res, com)
            return 0
        # The public upsert_goldendeal_*_batch wrappers are added centrally later; the private
        # batch writer is the same code path every wrapper delegates to.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        degraded = False
        if args.type == "all" and complete:
            control = next((int(r["ad_number"][len(PREFIX):]) for r in res + com), None)
            verify = verify_gone_for(TENANT, make_canary(TENANT, control))
            for table, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                pruned = db.prune_unseen(table, {r["ad_number"] for r in rows}, SOURCE,
                                         verify_gone=verify)
                degraded = degraded or pruned < 0
                print(f"  {table}: pruned {pruned}")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com), degraded=degraded,
                             notes=f"{note}; skipped: {tally or 'none'}"[:300],
                             check_tables=["goldendeal_residential_listings",
                                           "goldendeal_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e}; skipped: {tally_str(skipped) or 'none'}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
