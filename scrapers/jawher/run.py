"""جواهر للوساطة والتسويق العقاري — www.jawher2030.com. Onboarding 2026-09-24.

THE PLATFORM. jawher2030.com, m3tmd.com and senanrealestate.sa are three tenants of ONE product,
«منصة نزل» (Nuzul SaaS): identical Next.js build (same chunk hashes), same routes, same JSON. The
Nuzul reading lives HERE once and is imported by scrapers/m3tmd/run.py and scrapers/senan/run.py,
which add only their identity (BASE/SOURCE/PREFIX), their own map_listing() and their own main().
(Promoting it to scrapers/common/nuzul_platform.py is a central change and is listed as an open
issue; the tenant files must keep their own end_run()/transaction_type writes for the fleet's AST
barriers either way.)

SOURCE SHAPE — measured live 2026-09-24, every number below from a real request:
  · THE SITEMAP IS NOT THE CATALOGUE. sitemap.xml lists exactly the 9 /properties/<id> of the first
    catalogue page (= the manifest's «9»); the site's own footer says «عرض 9 من 145». The catalogue
    is the same-origin JSON API the page's own JS calls (chunk app/[lang]/properties/page-*.js):
        GET /api/public/v2/properties?page=N&per_page=50   → {"data":[card…],"meta":{current_page,
                                                            last_page,per_page,total}}
    per_page is capped at 50 by the server (200 asked → 50 served). ?page= on the HTML route is
    ignored (every variant re-serves page 1), so the HTML is never paginated.
        GET /api/public/v2/properties/<id>                  → {"data":{…102 keys…}}  the full record
    The detail record is the SAME object the server renders into the page's RSC payload, so the
    JSON is read directly; no HTML/RSC parsing. Apex 301s to www; the API lives on www.
  · IDENTITY: `id` is the URL id (/properties/<id>) and the API key — the stable id. `unit_number`
    is the office's own display number (jawher 24915 shows «رقم الوحدة #1535509»; on m3tmd it
    equals the id; on senan it is «#1»/«#55» — not unique). ad_number = PREFIX + id.
    listing_url = https://www.jawher2030.com/properties/<id> — fetched, 200, renders that listing.
  · PRICE = SOURCE: `selling_price` (int) for purpose=sell; `price`/`price_label` are the display
    copies («1,700,000.00», «ابتداءً من 2,500,000.00» on the 6 rents). 145/145 price == the field it
    mirrors. 2 available sale rows publish NO price (24915 قصر, 38723 عمارة) → price_total is
    AUTHORITATIVE_NULL with authoritative_absent evidence, never dropped, never guessed. m3tmd
    37109's DESCRIPTION says «سعر المتر 2000 ريال» — prose, banned as a price source; stays NULL.
  · RENT PERIOD = SOURCE: the record carries FOUR labelled rent fields — rent_price_annually («/
    سنوياً» on the page), rent_price_monthly, rent_price_quarterly, rent_price_semi_annually — plus
    daily_price + seven weekday prices (product «siyaha», short stay). Only the annual and monthly
    fields have a bucket in this schema: annual → verbatim; monthly → ×12 via annualize_rent;
    quarterly/semi-annual/daily only → rent_period NULL, price_annual NULL, raw kept in
    additional_info. Both annual and monthly stated → the annual figure (it IS the annual).
    Measured: 6 rents on jawher, all rent_price_annually only; 0 on m3tmd/senan.
  · STATUS: availability_status ∈ available/reserved/sold/rented/unavailable/soon (the platform's
    own dictionary: متاحة/محجوزة/مباعة/مؤجرة/غير متاحة/قريباً). Sold rows STAY in the catalogue
    with a «مباعة» badge — jawher: 51 available, 74 sold, 18 unavailable, 2 reserved. Anything but
    `available` is skipped and tallied `status_<value>`.
  · OFF-PLAN: `is_wafi_ad` = «البيع على الخارطة (وافي)» → skipped `off_plan_wafi` (1/145).
  · TYPE: `type` is an English key; the platform's own Arabic dictionary (in every page's RSC
    payload) gives the label, which goes through normalize.map_type_exact with the overrides below.
    The record's own `category` («نوع العقار»: residential/commercial, the office's pick and the
    site's own filter facet) qualifies a land/building to «أرض تجارية»/«عمارة تجارية»; the
    `is_for_*` land-USE flags are a different question (sakan precedent) and stay in
    additional_info. Category = category_for_type(). OWNER-AWARENESS: 51496's office title says
    «أرض تجارية للبيع» and its use flag is commercial-only, but the office filed category
    residential → Residential Land (structured facet over prose; title stored verbatim). Whether
    an office title stating «تجارية» should override the platform's facet is an owner decision.
  · LOCATION: city.name_ar / district.name_ar are structured; 14/145 records carry NO city →
    skipped `no_city` (never defaulted; senan's city TAG is noted as a possible recovery, open issue).
    district_ar = find_district_in_text(district.name_ar, city_id); neighborhood = the raw label.
  · COUNTS ARE ZERO-DEFAULTED: bedrooms/bathrooms/elevators/kitchens/… are 0 when the office left
    them blank (the mansion 24915 prints «0 غرفة»). 0 is therefore SILENCE → NULL; >0 → the value.
    has_electricity/has_water/has_sewage default false the same way (the page shows no «الخدمات»
    row at all when false) → only true is written. Amenity columns are tri-state: the structured
    counters and the prose (amenities_from_text over description_ar) are merged, structured last.
  · LICENCE: `rega_ad_number` = «رقم الاعلان (من الهيئة العامة للعقار)» = the AD licence →
    license_number (77/145 here; 0 on m3tmd and senan, which print «لا يوجد»). `rega_advertiser_
    number` = «رقم الرخصة (من الهيئة العامة للعقار)» = the office's FAL licence → additional_info.
  · FACADE + STREETS: `facade` ∈ north/south/…/north_south_east_west → the platform's Arabic label →
    normalize.one_direction(diagonal=True); three-plus sides → NULL, raw kept. `street_width` is
    the NORTH street («عرض الشارع الشمالي»), plus _east/_south/_west: exactly one stated → street_
    width_m, several → NULL (a corner plot has no single width), all kept in additional_info.
  · PHOTOS: cover_image + images[], S3 (nuzul-saas-production…amazonaws.com), 720px webp preview
    preferred. Fetched one: 200 image/webp, no CORP/ACAO header. 134/145 carry a gallery.
  · PDPL: `whatsapp_number` is in every record and is dropped; description_ar carried a mobile
    on 18/145 → redact_pii on title/description; additional_info goes through redact_capture.
  · DESCRIPTION is HTML on some rows (<p style=…>) → tags stripped.

REMOVAL ORACLE (measured 2026-09-24, API detail route) — TWO death modes, both measured:
  1 DELETED: gone ids 24916 / 1 / 99999999 → HTTP 404 application/json {"message":"No query
    results for model [App\\Models\\Property] N"} (3/3); senan 44629 → 404 {"message":""}.
  2 STATUS FLAG: a sold/reserved/unavailable row is NOT deleted — it stays served with its badge.
    jawher sold 48506 / 45942 / 44329, unavailable 39450 / 26004, reserved 48840 / 36684 → all
    HTTP 200, data.id == id, availability_status == that status (7/7); senan sold 41223 / 41222 /
    44628 + unavailable 44610 / 44591 / 44579 → 200 with the status (6/6). The signal therefore
    reads the body: 200 for THIS id AND availability_status == available → live; 200 for THIS id
    with any other status → gone (the source's own removal statement; fix 2026-09-24 — the first
    build called every matching 200 «live», so a row that sold after being stored would have
    self-healed in prune_unseen forever).
  live controls 24915 / 42818 / 52519 → 200, data.id == id, available (3/3; same on m3tmd/senan).
  The HTML page is a SOFT 404: /properties/<gone> answers 200 with <title>Property Not Found…
  — never a death signal on its own. prune_unseen probes the API route through the shared
  LivenessProbe law (403/429/5xx/timeout = UNKNOWN; a 200 for another record = no opinion), gated
  by an in-run positive control that fails CLOSED, and only after a COMPLETE, un-limited enumeration.

MEASURED COVERAGE (2026-09-24, full --dry-run, all 145 records through the real map_listing):
    enumerated 145 (complete) · mapped 44 = 36 residential + 8 commercial
    skipped 101: status_sold 74, status_unavailable 18, no_city 7, status_reserved 2
    of the 44: price_total 41 (+1 authoritative NULL, 24915) · rent 3 (all annual, verbatim)
    area 44/44 · district 44/44 · photos 44/44 · direction 42 · street_width 15 · licence 26
    bedrooms/bathrooms 18/18 (= every dwelling; land/shop/building stay NULL) · halls 18
    majlis 16 · elevator 18 · parking 22 · kitchen 17 · maid 13 · driver 14 · electricity 42
    water 40 · sanitation 39 · floor_number 10 · lat/long 37 · description 23
    source-does-not-publish: property_age, furnished (prose only: 1), air_conditioner (prose: 3),
    price_per_meter (never — no per-metre field), rent_now_pay_later (no RNPL-enabled rent).
WRITES go through db._wasalt_batch (the public upsert_jawher_* wrappers are added centrally
later); REMOVALS through prune_unseen + the oracle above.
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://www.jawher2030.com"
SOURCE = "جواهر للوساطة والتسويق العقاري"
PREFIX = "JWH"
SLUG = "jawher"
API_PATH = "/api/public/v2/properties"
ORACLE = "nuzul.api.v2.properties.detail"   # what mark_direct_alive certifies was read
PER_PAGE = 50                               # server cap, measured


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.5"})
    return s


# ── the platform's own vocabulary (its Arabic dictionary, verbatim from the RSC payload) ────────
_TYPE_KEY_AR = {
    "building": "عمارة", "mansion": "قصر", "duplex": "دبلكس", "villa": "فيلا", "apartment": "شقة",
    "tower_apartment": "شقة في برج", "building_apartment": "شقة في عمارة",
    "villa_apartment": "شقة في فيلا", "land": "أرض", "townhouse": "تاونهاوس",
    "villa_floor": "دور", "floor": "دور", "farm": "مزرعة", "istraha": "استراحة",
    "store": "محل تجاري", "office": "مكتب", "storage": "مخزن", "resort": "منتجع", "hotel": "فندق",
    "compound": "مجمع", "showroom": "معرض", "studio": "استوديو", "room": "غرفة",
    "workshop": "ورشة", "factory": "مصنع", "hospital": "مستشفى", "kiosk": "كشك",
    "school": "مدرسة", "station": "محطة", "atm": "صراف آلي", "cinema": "سينما",
    "parking": "موقف سيارات", "power_station": "محطة كهرباء",
    "telecommunications_tower": "برج اتصالات", "building_studio": "استوديو في عمارة",
    "tower_studio": "استوديو في برج",
}
# Labels the shared map does not key, read literally. DELIBERATELY ABSENT (skip, ask-first): منتجع,
# مجمع (the canonical Compound is categorised Commercial — nufouth precedent), مستشفى, كشك, مدرسة,
# محطة, صراف آلي, سينما, موقف سيارات, محطة كهرباء, برج اتصالات.
_TYPE_OVERRIDES = {
    "دبلكس": "Duplex", "شقة في برج": "Apartment", "شقة في عمارة": "Apartment",
    "شقة في فيلا": "Apartment", "تاونهاوس": "Villa",          # TYPE_MAP_EN folds Townhouse→Villa
    "محل تجاري": "Shop", "مخزن": "Warehouse", "استوديو في عمارة": "Studio",
    "استوديو في برج": "Studio", "عمارة تجارية": "Commercial Building",
}
# Types whose bedrooms/bathrooms counters answer a BEDROOM filter. A building's or a shop's
# counters never do.
_DWELLING_TYPES = {"Apartment", "Villa", "Floor", "Room", "Rest House", "Chalet", "Duplex", "Studio"}
_FACADE_AR = {"north": "شمالية", "south": "جنوبية", "east": "شرقية", "west": "غربية"}
_STATUS_LIVE = "available"
_PURPOSES = {"sell", "rent"}
_LISTING_PRODUCT = "office"     # the brokerage product; «siyaha» is the short-stay product


def plain(s: Optional[str]) -> Optional[str]:
    """HTML → text, PDPL-redacted, marks and whitespace collapsed. None when nothing is left."""
    if not s:
        return None
    t = _html.unescape(re.sub(r"<[^>]+>", " ", str(s)))
    t = re.sub(r"[‎‏⁠]", "", t)
    return redact_pii(re.sub(r"\s+", " ", t).strip())


def _count(v: Any) -> Optional[int]:
    """A zero-defaulted counter: 0 / None / non-numeric → NULL (silence), n>0 → n."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def type_ar_for(d: dict[str, Any]) -> Optional[str]:
    """The platform's Arabic label for `type`. A land or building the office itself filed under
    the platform's «نوع العقار: تجاري» (`category`) is «أرض تجارية» / «عمارة تجارية» — the source
    answering our own residential/commercial question directly. The `is_for_*` land-USE flags are
    a different question (measured: m3tmd files 11 commercial-use-only plots as residential) and
    only ever reach additional_info."""
    label = _TYPE_KEY_AR.get(str(d.get("type") or "").strip().lower())
    if not label:
        return None
    if str(d.get("category") or "") == "commercial" and label in ("أرض", "عمارة"):
        return label + " تجارية"
    return label


def property_type_for(d: dict[str, Any]) -> Optional[str]:
    return normalize.map_type_exact(type_ar_for(d), _TYPE_OVERRIDES)


def rent_price_fields(d: dict[str, Any]) -> tuple[Optional[str], Any, str, Any]:
    """(rent_period, price_annual, evidence_field, raw) from the record's OWN labelled rent fields.
    Annual verbatim; monthly ×12 (annualize_rent); a quarterly/semi-annual/daily-only figure has
    no bucket → (None, AUTHORITATIVE_NULL). Silence → (None, AUTHORITATIVE_NULL) too: the source's
    explicit nulls say «no rent published», which is an authoritative absence, not a fetch miss."""
    annual = normalize.to_int_numeric(d.get("rent_price_annually"))
    if annual is not None:
        return "annual", annual, "rent_price_annually", d.get("rent_price_annually")
    monthly = normalize.to_int_numeric(d.get("rent_price_monthly"))
    if monthly is not None:
        return "monthly", normalize.annualize_rent(monthly, "monthly"), "rent_price_monthly", d.get("rent_price_monthly")
    for k in ("rent_price_quarterly", "rent_price_semi_annually", "daily_price"):
        if d.get(k) is not None:
            return None, db.AUTHORITATIVE_NULL, k, d.get(k)
    return None, db.AUTHORITATIVE_NULL, "rent_price_annually", None


def one_street_width(d: dict[str, Any]) -> Optional[int]:
    """`street_width` (north) / _east / _south / _west: exactly ONE stated → that width."""
    widths = [normalize.one_street_width(d.get(k)) for k in
              ("street_width", "street_width_east", "street_width_south", "street_width_west")]
    stated = [w for w in widths if w is not None]
    return stated[0] if len(stated) == 1 else None


def direction_for(d: dict[str, Any]) -> Optional[str]:
    parts = [p for p in str(d.get("facade") or "").split("_") if p]
    if not parts or any(p not in _FACADE_AR for p in parts):
        return None
    return normalize.one_direction(" ".join(_FACADE_AR[p] for p in parts), diagonal=True)


def photos(d: dict[str, Any]) -> Optional[list[str]]:
    """The 720px webp preview when the record published one, else the original. Cap 20."""
    out: list[str] = []
    for img in [d.get("cover_image")] + list(d.get("images") or []):
        if not isinstance(img, dict):
            continue
        u = (img.get("previews") or {}).get("720") or img.get("url")
        if isinstance(u, str) and u.startswith("http") and u not in out:
            out.append(u)
    return out[:20] or None


def _title(d: dict[str, Any], type_ar: str, district_raw: Optional[str]) -> Optional[str]:
    """The office's own title, else the page's generated h1 («أرض للبيع في حي الهدا»)."""
    own = plain(d.get("name_ar"))
    if own:
        return own
    deal = "للإيجار" if d.get("purpose") == "rent" else "للبيع"
    return f"{type_ar} {deal}" + (f" في {district_raw}" if district_raw else "")


def nuzul_fields(d: dict[str, Any]) -> tuple[Optional[dict[str, Any]], str, str]:
    """(fields, category, skip_reason) for one Nuzul property record — everything except the
    tenant's identity (ad_number / listing_url / source) and its transaction_type write.
    fields is None exactly when skip_reason is set. Never guesses; every skip is tallied."""
    pid = normalize.to_int_numeric(d.get("id"))
    if not pid:
        return None, "residential", "no_id"
    product = str(d.get("product") or "")
    if product != _LISTING_PRODUCT:
        return None, "residential", f"product_{product or 'none'}"
    purpose = str(d.get("purpose") or "")
    if purpose not in _PURPOSES:
        return None, "residential", f"purpose_{purpose or 'none'}"
    status = str(d.get("availability_status") or "")
    if status != _STATUS_LIVE:
        return None, "residential", f"status_{status or 'none'}"
    if d.get("is_wafi_ad"):
        return None, "residential", "off_plan_wafi"
    type_ar = type_ar_for(d)
    property_type = property_type_for(d)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    city_raw = plain((d.get("city") or {}).get("name_ar")) if isinstance(d.get("city"), dict) else None
    if not city_raw:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_raw)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = plain((d.get("district") or {}).get("name_ar")) if isinstance(d.get("district"), dict) else None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    description = plain(d.get("description_ar"))
    area_raw, area_field = d.get("area"), "area"
    if area_raw is None and d.get("built_up_area") is not None:
        area_raw, area_field = d.get("built_up_area"), "built_up_area"   # what the page prints as م²
    area = normalize.to_int_numeric(area_raw)

    fields: dict[str, Any] = {
        "active": True,
        "title": _title(d, type_ar or "", district_raw),
        "description": description,
        # prose first, structured counters LAST — the source's own field outranks text inference
        **normalize.amenities_from_text(description),
        "property_type": property_type,
        "city": normalize.map_city(city_raw),
        "city_ar": city_raw,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "bedrooms": _count(d.get("bedrooms")) if property_type in _DWELLING_TYPES else None,
        "bathrooms": _count(d.get("bathrooms")) if property_type in _DWELLING_TYPES else None,
        "floor_number": _count(d.get("unit_floor_number")),
        "halls": _count(d.get("living_rooms")),
        "reception_rooms_majlis": _count(d.get("majlis_rooms")),
        "street_width_m": one_street_width(d),
        "direction": direction_for(d),
        "license_number": (str(d["rega_ad_number"]).strip() or None) if d.get("rega_ad_number") else None,
        "photo_urls": photos(d),
    }
    # Tri-state from zero-defaulted counters / false-defaulted flags: only a POSITIVE statement
    # is a statement. (An explicit «بدون مصعد» in the prose already landed as False above.)
    for col, key in (("elevator", "elevators"), ("parking", "parking_spots"), ("kitchen", "kitchens"),
                     ("maid_room", "maid_rooms"), ("driver_room", "driver_rooms")):
        if _count(d.get(key)):
            fields[col] = True
    for col, key in (("electricity", "has_electricity"), ("water_supply", "has_water"),
                     ("sanitation", "has_sewage")):
        if d.get(key) is True:
            fields[col] = True
    if purpose == "rent" and (d.get("is_ejari_enabled") is True or d.get("is_rize_enabled") is True):
        fields["rent_now_pay_later"] = True     # Ejari / Rize = the platform's RNPL providers

    if purpose == "rent":
        period, annual, ev_field, raw = rent_price_fields(d)
        fields["rent_period"] = period
        fields["price_annual"] = annual
        fields["price_evidence"] = normalize.price_evidence(
            field=ev_field, raw=raw, stored=annual if isinstance(annual, int) else None,
            kind=period or "annual", origin="api", authoritative_absent=annual is db.AUTHORITATIVE_NULL)
    else:
        total = normalize.to_int_numeric(d.get("selling_price"))
        fields["price_total"] = total if total is not None else db.AUTHORITATIVE_NULL
        fields["price_evidence"] = normalize.price_evidence(
            field="selling_price", raw=d.get("selling_price"), stored=total, kind="total",
            origin="api", authoritative_absent=total is None)

    projects = [p for p in (d.get("projects") or []) if isinstance(p, dict)]
    fields["additional_info"] = redact_capture({k: v for k, v in {
        "unit_number": d.get("unit_number") or None,
        "latitude": d.get("latitude") if d.get("latitude") not in (None, "") else None,
        "longitude": d.get("longitude") if d.get("longitude") not in (None, "") else None,
        "type_key": d.get("type"), "type_ar": type_ar, "purpose": purpose,
        "source_category": d.get("category"),
        "usages": [u for u, on in (("residential", d.get("is_for_residential")),
                                   ("commercial", d.get("is_for_commercial")),
                                   ("farming", d.get("is_for_farming")),
                                   ("education", d.get("is_for_education")),
                                   ("health", d.get("is_for_health")),
                                   ("factory", d.get("is_for_factory"))) if on] or None,
        "availability_status": status,
        "price_label": d.get("price_label"),
        "rent_prices_raw": {k: d.get(k) for k in ("rent_price_annually", "rent_price_monthly",
                                                  "rent_price_quarterly", "rent_price_semi_annually",
                                                  "daily_price") if d.get(k) is not None} or None,
        "area_field": area_field if area is not None else None,
        "area_exact": area_raw if isinstance(area_raw, float) and area_raw != int(area_raw) else None,
        "built_up_area": d.get("built_up_area") if area_field == "area" else None,
        "number_of_floors": _count(d.get("number_of_floors")),
        "counters": {k: _count(d.get(k)) for k in
                     ("apartments", "stores", "dining_rooms", "storage_rooms", "mulhaq_rooms",
                      "balconies", "gardens", "pools", "basement_rooms") if _count(d.get(k))} or None,
        "plan_number": d.get("plan_number"), "plot_number": d.get("plot_number"),
        "plot_width": d.get("width"), "plot_length": d.get("length"),
        "facade_raw": d.get("facade"),
        "street_widths": {k: d.get(k) for k in ("street_width", "street_width_east",
                                                "street_width_south", "street_width_west")
                          if d.get(k) is not None} or None,
        "fal_licence_number": d.get("rega_advertiser_number"),
        "project": {"id": projects[0].get("id"), "name_ar": plain(projects[0].get("name_ar"))} if projects else None,
        "tags": [t.get("name_ar") for t in (d.get("tags") or []) if isinstance(t, dict) and t.get("name_ar")] or None,
        "youtube_video_url": d.get("youtube_video_url"),
        "updated_at": d.get("updated_at"),
    }.items() if v is not None})
    fields["source_capture"] = redact_capture({
        "schema": "nuzul.api.v2.property",
        "record": {k: v for k, v in d.items() if k not in ("cover_image", "images", "viewer_context")},
    })
    return fields, category, ""


def map_listing(d: dict[str, Any]) -> tuple[Optional[dict[str, Any]], str, str]:
    """(row, category, skip_reason). row is None exactly when skip_reason is set."""
    fields, category, why = nuzul_fields(d)
    if not fields:
        return None, category, why
    row = {
        "ad_number": f"{PREFIX}{d['id']}",
        "listing_url": f"{BASE}/properties/{d['id']}",
        "source": SOURCE,
        "transaction_type": "Rent" if d.get("purpose") == "rent" else "Buy",
        **fields,
    }
    return row, category, ""


# ── transport ────────────────────────────────────────────────────────────────────────────────────
def fetch_ids(s: cc.Session, base: str, *, limit: int = 0) -> tuple[list[int], bool]:
    """Every property id in the catalogue, in the site's own order. (ids, complete): complete is
    False when any page failed, and a --limit run is never complete — prune is gated on it."""
    ids: list[int] = []
    page, last = 1, 1
    while page <= last:
        try:
            r = s.get(f"{base}{API_PATH}?page={page}&per_page={PER_PAGE}", timeout=40)
            body = r.json() if r.status_code == 200 else None
        except Exception:
            body = None
        if not isinstance(body, dict) or not isinstance(body.get("data"), list):
            return ids, False
        ids += [x["id"] for x in body["data"] if isinstance(x, dict) and isinstance(x.get("id"), int)]
        last = int((body.get("meta") or {}).get("last_page") or 1)
        if limit and len(ids) >= limit:
            return list(dict.fromkeys(ids))[:limit], False
        page += 1
        time.sleep(0.4)
    return list(dict.fromkeys(ids)), True


def fetch_detail(s: cc.Session, base: str, pid: int, *, tries: int = 3) -> tuple[Optional[dict[str, Any]], str]:
    """(record, 'live') for a 200 whose data.id is THIS id; (None, 'gone') on the measured 404
    JSON; (None, 'unknown') for anything transient (403/429/5xx/timeout) after `tries`."""
    for attempt in range(tries):
        try:
            r = s.get(f"{base}{API_PATH}/{pid}", timeout=40)
        except Exception:
            r = None
        if r is not None and r.status_code == 200:
            try:
                data = r.json().get("data")
            except Exception:
                data = None
            if isinstance(data, dict) and data.get("id") == pid:
                return data, "live"
            return None, "unknown"          # a 200 that is not this record is not evidence
        if r is not None and r.status_code == 404 and '"message"' in (r.text or ""):
            return None, "gone"
        time.sleep(1.5 * (attempt + 1))
    return None, "unknown"


def make_verify_gone(base: str, prefix: str, slug: str, control: Optional[dict[str, Any]]) -> Callable[[str], Any]:
    """prune_unseen's oracle: the API detail route under the shared liveness law, gated by an
    in-run positive control (a row this run mapped must still answer as itself) — fails CLOSED."""
    def url_for(ad_number: str) -> Optional[str]:
        ad_id = ad_number[len(prefix):] if ad_number.startswith(prefix) else ""
        return f"{base}{API_PATH}/{ad_id}" if ad_id.isdigit() else None

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform=slug, signal=_signal_for(ad_number), session=session,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def _signal_for(ad_number: str):
        ad_id = normalize.to_int_numeric(ad_number[len(prefix):])

        def _sig(status, body, _moved):
            if status == 404 and '"message"' in (body or ""):
                return "gone"               # the measured 404 JSON: the record no longer exists
            if status != 200:
                return None                 # everything else is the LivenessProbe law's call
            try:
                data = json.loads(body).get("data")
            except Exception:
                return None
            if not isinstance(data, dict) or data.get("id") != ad_id:
                return None                 # a 200 for a DIFFERENT record is no opinion
            # THIS record, still served: the source's own status flag is the removal statement.
            # Sold/reserved/unavailable rows stay published with a badge (94 of 145 on jawher),
            # so a 200 is «live» only while availability_status == available.
            return "live" if data.get("availability_status") == _STATUS_LIVE else "gone"
        return _sig

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
    ap.add_argument("--delay", type=float, default=0.4)
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        ids, complete = fetch_ids(s, BASE, limit=args.limit)
        if not ids:
            raise RuntimeError(f"{BASE}{API_PATH} returned no properties")
        print(f"{SOURCE}: {len(ids)} listings discovered (complete={complete})", flush=True)
        for i, pid in enumerate(ids, 1):
            d, verdict = fetch_detail(s, BASE, pid)
            if d is None:
                skipped[f"fetch_{verdict}"] = skipped.get(f"fetch_{verdict}", 0) + 1
                continue
            row, cat, why = map_listing(d)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            db.mark_direct_alive(row, oracle=ORACLE)      # this record, fetched by its own id
            (com if cat == "commercial" else res).append(row)
            if args.delay:
                time.sleep(args.delay)
            if i % 50 == 0:
                print(f"  …{i}/{len(ids)}  kept={len(res) + len(com)}", flush=True)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):10} d={str(r0['district_ar'])[:12]:12} "
                      f"a={str(r0['area_m2']):>6} bd={str(r0['bedrooms']):>4} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_jawher_{residential,commercial}_batch wrappers are added centrally later.
        db._wasalt_batch("jawher_residential_listings", res)
        db._wasalt_batch("jawher_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="jawher_residential_listings", com_table="jawher_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = make_verify_gone(BASE, PREFIX, SLUG, (res + com)[0] if (res or com) else None)
            for tbl, rows in (("jawher_residential_listings", res), ("jawher_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["jawher_residential_listings",
                                           "jawher_commercial_listings"])
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
