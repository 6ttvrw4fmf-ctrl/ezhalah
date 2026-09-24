"""فلل — villas-sa.com. 14 ads, onboarding 2026-09-23 (batch 36).

SOURCE SHAPE (measured live 2026-09-23 before any code was written)
===================================================================
The site is a React/Vite SPA (`/frontend/assets/index-*.js`); its HTML is a 1,296-byte shell for
every route. The SPA's own axios baseURL is `https://villas-sa.com/api` and two guest-readable JSON
endpoints hold everything:

    GET /api/real/estate          → {"data": [card, …]}   the WHOLE catalogue, unpaginated
    GET /api/real/estate/<id>     → {"data": {main, owner, details[], properites[], map,
                                              description, images[], similar_ads[]}}

· THE LIST IS COMPLETE. `?page=` is ignored: page=1 and page=2 returned the identical 14 ids
  (21,22,24,67,68,93,94,95,96,98,99,100,101,102); the 2026-09-24 browser verification saw the same
  14 across page=1..10. So one GET is the full enumeration and prune_unseen may run after it.
· THE CARD'S `category` IS «لا يوجد» ON 14/14 CARDS — useless. The TYPE is `main.category` on the
  detail («فيلا» ×5, «ارض» ×8, «شقة» ×1, «مكتب» ×1 measured), duplicated as details[«نوع العقار»].
· THE DEAL IS `main.type` («بيع»/«إيجار»), NEVER the `for_sale` flag: id 100 is «إيجار» on the
  detail with `for_sale: true` on that same detail payload (and `for_sale: false` on its card).
· PRICE — TWO PRINTED FIGURES, AND ON LAND THEY DIFFER (the trap of this source). The card prints
  `price` and the detail prints `main.price`, both as «N ريال» strings with no unit label anywhere
  (the SPA renders `main.price` verbatim + «ريال»). Measured on all 14:
      6/6 non-land ads: card == detail          (102: «4,200,000» both)
      8/8 land ads:     card == detail × area   (21: card «1,037,933», detail «1,300», area 798.41;
                                                 95: «1,699,074» = 1,300 × 1,306.98; …)
  The detail figure on land is the REGA per-metre rate and the card total is the site's own
  product. This scraper NEVER multiplies: `price_total` is the CARD's printed figure, exactly as
  published, and `price_per_meter` is the DETAIL's printed figure — each column holds a number the
  site itself prints. The per-metre reading is taken only when the two printed figures reconcile
  through the published area (±1 riyal), i.e. when the site's own arithmetic is visible; a pair
  that neither matches nor reconciles keeps the card total and parks the detail figure in
  additional_info, never as a rate. Both raw strings are always kept (`price_evidence`).
· RENT PERIOD is stated nowhere for the one rental (id 100, «3,700 ريال», an office). Its prose
  offers «بالساعة، يومي، شهري، أو سنوي» — every period at once, so it labels nothing. rent_period
  stays NULL and the figure goes to price_annual unconverted; the period is read ONLY from the
  price string itself via rent_period_and_annual (a future «3,700 ريال شهري» would convert).
· «عدد الغرف» IS TOTAL ROOMS, NOT BEDROOMS: villa 99 publishes 10 while its prose lists
  «اربع غرف نوم» + «غرفتين» + «غرفة»; villa 102 publishes 5 against «اربع غرف نوم ماستر». So it is
  kept as `source_rooms` in additional_info and `bedrooms` is read only from an explicit
  «N غرف نوم» phrase in the prose (rooms_from_phrase), which on this source is written in WORD
  numerals («اربع», «ثلاث») the shared phrase reader does not parse → bedrooms NULL on 14/14.
  Reported, not guessed. Office 100's «150» rooms is a coworking room count either way.
· LAND USAGE decides the land TYPE: details[«استخدام العقار»] is «سكني» (5 land ads) → Residential
  Land, «تجاري» → Commercial Land, «استعمال مختلط» (3 land ads: 93, 68, 67) → SKIPPED
  usage_mixed_land, because the category must be exactly one and the source does not say which.
  On a dwelling the usage is a fact kept in additional_info (apartment 98 is «استعمال مختلط»).
· AF FACTS THE API LABELS: «عرض الشارع» (12/14) → street_width_m; «واجهة العقار» (13/14) →
  direction via one_direction(diagonal=True) — a single facade or diagonal maps, a multi-street
  list («شرقية - جنوبية», «شمالية - غربية - شرقية») is NULL; «عمر العقار» («جديد», «اربع سنوات»,
  «ثمان سنوات») → exact_age, word numerals included (6/14); «رقم ترخيص الإعلان» (14/14, ten
  digits) → license_number — the AD licence. The FAL broker licence appears only in one prose
  body («رقم رخصة الوساطة العقارية: 1100260351») and is never read.
· «خدمات العقار» is a comma list of NAMED utilities (14/14): «كهرباء» → electricity,
  «مياه» → water_supply, «صرف صحي» → sanitation, «ألياف ضوئية» → optical_fibers, each True only
  when named; «هاتف» / «تصريف الفيضانات» have no column and stay in additional_info. Silence is
  no key (never False). Prose amenities go through amenities_from_text.
· PDPL: `owner` {name, phone, whatsapp}, details[«اسم مسؤول الإعلان»], details[«رقم جوال مسؤول
  الإعلان»] are never read; the description is passed through redact_pii (id 100's body carries
  «966542593555+»).
· LOCATION: `map.address` is «district-region-city» («الملقا-منطقة الرياض-الرياض»,
  «العقيق-المنطقة الشرقية-الخبر»). city_ar = the last part, region hint = the middle part with its
  «منطقة» prefix stripped, district = the first part → find_district_in_text. Measured through the
  live catalog: 7/7 cities place (الرياض, سكاكا, الدمام, مكة المكرمة, الجبيل, أبها, الخبر) and
  11/12 districts match (only «المقام» in مكة does not — the card keeps the site's text).
· PHOTOS: `images[]` are absolute `/api/watermarked-image?path=…` URLs (already percent-encoded);
  one fetched → HTTP 200 image/jpeg, JFIF magic. 13/14 ads have ≥1 (id 68 has none).
· NO TITLE FIELD EXISTS (`name` is the literal "ads" on every record). The stored title is
  composed from the source's own facts — «<type> <للبيع|للإيجار> - <card address>» — and
  additional_info records `title_composed: true` so it is never mistaken for source prose.
· listing_url = `main.url` («https://villas-sa.com/real/estate/ads/<id>»), the source's own field,
  and `/real/estate/ads/:id` is a declared route in the SPA's router (as is `/property/:id`, where
  the site's own share link `/show/<id>` redirects). The shell serves 200 on it; the SPA reads the
  same detail endpoint this scraper reads.

REMOVAL ORACLE (measured 2026-09-23)
  · 14/14 catalogue ids: detail HTTP 200, `data.main.status == "1"`                    → LIVE
  · 3/3 delisted ids (11, 90, 6 — surfaced only inside `similar_ads`): HTTP 200,
    `data.main.status == "0"`, record otherwise intact                                  → GONE
  · 4/4 never-existing ids (1, 23, 50, 999999): HTTP 500, Laravel «Undefined array key "id"».
    Under the shared liveness law a 5xx can never carry a death, so such a row sits UNKNOWN and
    is never pruned on that read; the realistic removal on this source is the status flip.
  Absence from the (complete) list only SELECTS candidates; every removal is confirmed by a direct
  re-read of the record with the id matched, and gated by an in-run positive control (a row this
  run mapped must still read "1") that fails CLOSED.

WRITES go through db._wasalt_batch("villassa_{residential,commercial}_listings", …) — the public
upsert_villassa_* wrappers are added centrally later. REMOVALS through prune_unseen with the oracle
above, only after a complete, non-limited enumeration.
"""
from __future__ import annotations

import argparse
import json
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

BASE = "https://villas-sa.com"
SOURCE = "فلل"
PREFIX = "VLS"
API_LIST = f"{BASE}/api/real/estate"
ORACLE = "villassa.api.real_estate.detail.status_1_id_match"   # what mark_direct_alive certifies

# The site's exact type spellings. «ارض» is resolved by its stated usage (see _land_type), so it is
# deliberately NOT in the shared-map path: the bare word would map to Residential Land on a plot
# whose own «استخدام العقار» says «تجاري».
_TYPE_OVERRIDES: dict[str, str] = {}
_LAND = ("ارض", "أرض")
_LAND_BY_USAGE = {"سكني": "Residential Land", "تجاري": "Commercial Land"}
_DWELLINGS = {"شقة", "فيلا", "دور", "فله", "فلة"}

_SERVICE_COLS = {"كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation",
                 "ألياف ضوئية": "optical_fibers"}
_DEAL = {"بيع": "Buy", "إيجار": "Rent", "ايجار": "Rent"}
_DEAL_AR = {"Buy": "للبيع", "Rent": "للإيجار"}
_REGION_PREFIX = re.compile(r"^(?:ال)?منطقة\s+")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent — never set one
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def fetch_list(s: cc.Session) -> list[dict]:
    r = s.get(API_LIST, timeout=40)
    if r.status_code != 200:
        raise RuntimeError(f"{API_LIST} answered HTTP {r.status_code}")
    data = r.json().get("data")
    if not isinstance(data, list):
        raise RuntimeError(f"{API_LIST}: 'data' is not a list — API shape changed")
    return data


def fetch_detail(s: cc.Session, ad_id: int) -> tuple[Optional[int], Optional[dict]]:
    """(http_status, data) — data is None when the answer is not a record (HTTP 500 = the id does
    not exist on this Laravel app; measured 4/4)."""
    r = s.get(f"{API_LIST}/{ad_id}", timeout=40)
    if r.status_code != 200:
        return r.status_code, None
    try:
        data = r.json().get("data")
    except Exception:  # noqa: BLE001 — a non-JSON 200 is not a record
        return r.status_code, None
    return r.status_code, data if isinstance(data, dict) and isinstance(data.get("main"), dict) else None


def _num(v: Any) -> Optional[float]:
    """The published figure as a float («798.41», «1,306.98», «200.25»), or None."""
    if v is None:
        return None
    t = re.sub(r"[^\d.]", "", str(v).translate(normalize._TRANS))
    try:
        return float(t) if t and t != "." else None
    except ValueError:
        return None


def _kv(items: Any) -> dict[str, str]:
    """details[] / properites[] are [{name, value}] lists → {name: value} with stripped values."""
    out: dict[str, str] = {}
    for it in items or []:
        if isinstance(it, dict) and it.get("name"):
            v = it.get("value")
            if v is not None and str(v).strip():
                out[str(it["name"]).strip()] = str(v).strip()
    return out


def _place(address: Optional[str], card_address: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(district_raw, region_hint, city_ar) from «district-region-city» (detail) or
    «district - city» (card). Never invents a city: an address with one part yields no city."""
    parts = [p.strip() for p in (address or "").split("-") if p.strip()]
    if len(parts) < 2:
        parts = [p.strip() for p in (card_address or "").split("-") if p.strip()]
    if len(parts) >= 3:
        return parts[0], _REGION_PREFIX.sub("", parts[1]) or None, parts[-1]
    if len(parts) == 2:
        return parts[0], None, parts[1]
    return None, None, None


def _land_type(usage: Optional[str]) -> tuple[Optional[str], str]:
    """A plot's canonical type from its stated usage, or (None, skip_reason)."""
    t = _LAND_BY_USAGE.get((usage or "").strip())
    if t:
        return t, ""
    return None, ("usage_mixed_land" if usage else "usage_unstated_land")


def split_prices(card_raw: Any, detail_raw: Any, area_raw: Any) -> tuple[Optional[int], Optional[int], str]:
    """(price_total, price_per_meter, kind) from the two PRINTED figures. Nothing is multiplied
    into a stored value: the total is always the card's own string, the rate the detail's.

    kind: 'card_equals_detail' | 'card_total_detail_per_metre' | 'card_only' | 'detail_only' |
          'unreconciled' (both printed, they differ, and the area does not explain it — the card
          total is stored, the detail figure is parked in additional_info, no rate is claimed)."""
    card, detail, area = normalize.to_int(card_raw), normalize.to_int(detail_raw), _num(area_raw)
    if card is None and detail is None:
        return None, None, "none"
    if card is None:
        return detail, None, "detail_only"
    if detail is None:
        return card, None, "card_only"
    if card == detail:
        return card, None, "card_equals_detail"
    if area and abs(detail * area - card) <= 1.0:
        return card, detail, "card_total_detail_per_metre"
    return card, None, "unreconciled"


def _services(raw: Optional[str]) -> dict[str, bool]:
    """«خدمات العقار» is a comma list of NAMED utilities → True per named column. Silence → no key."""
    named = {t.strip() for t in (raw or "").split(",") if t.strip()}
    return {col: True for tok, col in _SERVICE_COLS.items() if tok in named}


def map_listing(card: dict, detail: dict) -> tuple[Optional[dict], str, str]:
    """One card + its detail record → (row|None, category, skip_reason)."""
    main = detail.get("main") or {}
    ad_id = main.get("id") or card.get("id")
    if not ad_id or str(ad_id) != str(card.get("id") or ad_id):
        return None, "residential", "no_id"
    ad_id = int(ad_id)
    status = str(main.get("status") or "").strip()
    if status != "1":
        return None, "residential", f"status_{status or 'blank'}"

    details, props = _kv(detail.get("details")), _kv(detail.get("properites"))
    type_ar = (main.get("category") or details.get("نوع العقار") or "").strip()
    if not type_ar or type_ar == "لا يوجد":
        return None, "residential", "type_unmapped"
    usage = details.get("استخدام العقار") or props.get("نوع الاستخدام الرئيسي للوحدة")
    if type_ar in _LAND:
        property_type, why = _land_type(usage)
        if not property_type:
            return None, "residential", why
    else:
        property_type = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES)
        if not property_type:
            return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    deal = _DEAL.get((main.get("type") or "").strip())
    if not deal:
        return None, category, f"deal_unknown_{(main.get('type') or 'blank').strip()}"

    district_raw, region_hint, city_ar = _place((detail.get("map") or {}).get("address"), card.get("address"))
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, region_hint)
    if not city_id and region_hint:
        city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    area_raw = details.get("مساحة العقار") or main.get("estate_space")
    area = normalize.to_int(area_raw)
    description = redact_pii(detail.get("description"))
    total, ppm, price_kind = split_prices(card.get("price"), main.get("price"), area_raw)

    listing_url = str(main.get("url") or "").strip()
    if not re.fullmatch(rf"{re.escape(BASE)}/real/estate/ads/{ad_id}", listing_url):
        listing_url = f"{BASE}/property/{ad_id}"      # the route the site's own /show/<id> lands on

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ad_id}",
        "listing_url": listing_url,
        "source": SOURCE,
        "active": True,
        "title": f"{type_ar} {_DEAL_AR[deal]} - {(card.get('address') or '').strip()}".strip(" -"),
        "description": description,
        **normalize.amenities_from_text(description),
        **_services(details.get("خدمات العقار") or props.get("الخدمات المتوفرة")),
        **{k: v for k, v in normalize.rooms_from_phrase(description).items() if k == "bedrooms"
           and type_ar in _DWELLINGS},
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area if area and area > 0 else None,
        "street_width_m": normalize.one_street_width(details.get("عرض الشارع")),
        "direction": normalize.one_direction(details.get("واجهة العقار") or props.get("واجهة العقار"),
                                             diagonal=True),
        "property_age": normalize.exact_age(details.get("عمر العقار")),
        "license_number": details.get("رقم ترخيص الإعلان") or None,   # the AD licence, 14/14
        "photo_urls": [u for u in (detail.get("images") or []) if isinstance(u, str) and u.startswith("http")][:20] or None,
    }
    if deal == "Rent":
        # The period is read ONLY from the price string's own words; silence stays NULL with the
        # figure unconverted (id 100: «3,700 ريال» → rent_period None, price_annual 3700).
        period, annual = normalize.rent_period_and_annual(total, str(main.get("price") or ""))
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = total
        if ppm is not None:
            row["price_per_meter"] = ppm

    row["additional_info"] = {k: v for k, v in {
        "ad_id": ad_id,
        "title_composed": True,
        "type_ar": type_ar,
        "usage": usage,
        "unit_usage": props.get("نوع الاستخدام الرئيسي للوحدة"),
        "price_evidence": normalize.price_evidence(
            field="list.price + detail.main.price", raw=f"{card.get('price')} | {main.get('price')}",
            stored=total, kind="annual" if deal == "Rent" else "total", unit="total", origin="api"),
        "price_kind": price_kind,
        "card_price_raw": card.get("price"),
        "detail_price_raw": main.get("price"),
        "area_raw": area_raw,                      # exact figure incl. fraction («200.25»)
        "source_rooms": details.get("عدد الغرف"),  # TOTAL rooms, not bedrooms (see docstring)
        "age_raw": details.get("عمر العقار"),
        "facade_raw": details.get("واجهة العقار"),
        "street_raw": details.get("عرض الشارع"),
        "services_raw": details.get("خدمات العقار"),
        "plan_number": details.get("رقم المخطط"),
        "parcel_number": details.get("رقم القطعة"),
        "obligations": details.get("الالتزامات الأخرى على العقار"),
        "deed_location": details.get("وصف موقع العقار حسب الصك"),
        "deed_type": props.get("نوع الصك"),
        "red_zone": props.get("نوع المنطقة الحمراء"),
        "building_code": props.get("مدى الالتزام بكود البناء السعودي"),
        "ad_source": props.get("مصدر الإعلان"),
        "ad_licence_url": props.get("رابط رخصة الإعلان"),
        "ad_licence_expiry": details.get("تاريخ انتهاء رخصة الإعلان"),
        "rega_ad_license_number": details.get("رقم ترخيص الإعلان"),
        "created_at": main.get("created_at"),
        "views": main.get("views"),
        "lat": (detail.get("map") or {}).get("lat"),
        "lng": (detail.get("map") or {}).get("lon"),
        "address": (detail.get("map") or {}).get("address"),
    }.items() if v is not None and v != ""}
    # A direct read of THIS record (id matched, status "1") — zero extra requests.
    db.mark_direct_alive(row, oracle=ORACLE)
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
def _signal_for(ad_id: int):
    def signal(status, body, _moved):
        if status != 200:
            return None                       # a 500 is «the source is broken», never a death (law)
        try:
            main = (json.loads(body).get("data") or {}).get("main") or {}
        except Exception:  # noqa: BLE001
            return None
        if str(main.get("id")) != str(ad_id):
            return None                       # someone else's record is no evidence about this one
        return "live" if str(main.get("status") or "").strip() == "1" else "gone"
    return signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None) -> tuple[str, str]:
        digits = ad_number[len(PREFIX):]
        if not ad_number.startswith(PREFIX) or not digits.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform="villassa", signal=_signal_for(int(digits)), session=session,
                             url_for=lambda _ad: f"{API_LIST}/{digits}",
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
    run_id = None if dry else db.begin_run("villassa")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    notes = ""
    try:
        cards = fetch_list(s)
        if not cards:
            raise RuntimeError(f"{API_LIST} returned an empty catalogue")
        if args.limit:
            cards = cards[:args.limit]
        print(f"{SOURCE}: {len(cards)} ads in the catalogue", flush=True)
        for card in cards:
            seen += 1
            time.sleep(0.8)                                   # polite: one record at a time
            status, detail = fetch_detail(s, int(card.get("id") or 0))
            if not detail:
                skipped[f"detail_http_{status}"] = skipped.get(f"detail_http_{status}", 0) + 1
                continue
            row, cat, why = map_listing(card, detail)
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
                ai = r0["additional_info"]
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {str(r0['property_type']):17} "
                      f"{str(r0['city_ar']):12} d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>6} "
                      f"p={str(r0.get('price_total') or r0.get('price_annual')):>9} "
                      f"ppm={str(r0.get('price_per_meter')):>5} [{ai['price_kind']}] rp={r0.get('rent_period')} "
                      f"sw={r0['street_width_m']} dir={r0['direction']} age={r0['property_age']} "
                      f"lic={r0['license_number']} ph={len(r0.get('photo_urls') or [])}")
            return 0

        # The public upsert_villassa_* wrappers are added centrally later; the shared batch writer
        # is the same path they will delegate to.
        db._wasalt_batch("villassa_residential_listings", res)
        db._wasalt_batch("villassa_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="villassa_residential_listings", com_table="villassa_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after the complete enumeration (a --type run holds the other table's seen-set
        # empty by construction; --limit never reaches here), confirmed per row by the record
        # re-read and gated by the in-run positive control. prune_unseen's own breakers sit on top.
        pruned = 0
        if args.type == "all":
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("villassa_residential_listings", res),
                              ("villassa_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["villassa_residential_listings",
                                           "villassa_commercial_listings"])
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
