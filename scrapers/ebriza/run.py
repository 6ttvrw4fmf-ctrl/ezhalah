"""إبريزة العقارية — ebriza.com.sa. 207 listings (177 sale + 30 rent), onboarding 2026-09-24.

SOURCE SHAPE (probed live before any code — every number below is measured, not estimated):
  · A custom PHP site with an OPEN JSON API and no auth:
      GET  /RestApi/MainApi.php?action=get_properties&type=<بيع|إيجار>&page=N&filters[sort]=latest
           → {"propertiesData": [10 items], "total": 177|30, "title": "عدد العقارات المتاحة"}
      POST /RestApi/MainApi.php  action=get_property_data&id=<id>  → the same record + agent fields
    The list record is already the FULL record (price/space/rooms/address/licence/features) — the
    detail call adds only the agent's identity, which we never store. So one enumeration is 22
    requests and no per-listing fetch is needed.

  · THE DEFAULT ORDER IS RANDOM. Without `filters[sort]=latest` the API pages over a shuffled
    catalogue: 21 pages returned 207 rows but only 138 DISTINCT ids (55 twice, 69 never), and page 1
    fetched twice gave two disjoint sets. `filters[sort]=latest` (id desc) is deterministic — the
    same 22 pages then give 207 distinct ids = the site's own two totals. The run compares the
    distinct count with the site's `total`s and treats a shortfall as INCOMPLETE (rows are still
    upserted; nothing is ever pruned from an incomplete walk).

  · THE SITEMAP IS STALE AND ITS IDS ARE DEAD. sitemap.xml lists 574 /for_sell|/rent URLs; only 207
    of those ids exist on the API, and get_property_data for the others answers 404. Never
    enumerate from it.

  · LISTING URL: /for_sell/<id>/<city>/<district>/<type>-<deal> (sale) and /rent/<id>/… (rent).
    The server injects `const id = <id>` and the page opens that listing's modal from the API —
    verified on /rent/690/الرياض/العارض/شقة-إيجار (200, `const id = 690`). The path after the id
    is decorative: /rent/690/x/y/z renders the same listing. /for_sell/690 without a tail is 404.
    A GONE id still renders the shell with HTTP 200 (`/rent/999999/x/y/z` → 200, `const id =
    999999`), so THE HTML PAGE IS NOT THE ORACLE — the API is (below).

  · PRICE FIELDS, exactly as the site's own JS displays them (assets/js/property_details.js:42):
      propertyType == «ارض» & بيع   → shows `landTotalPrice`  (`price` is the PER-METRE rate)
      propertyType == «ارض» & إيجار → shows `LandTotalAnnualRent` (its own name states the period)
      anything else                  → shows `price`
    Measured on the 29 lands: price 445 / landTotalPrice 200250 / space 450 (445 × 450). We store
    the site's total AS PRINTED in price_total and its rate in price_per_meter — never multiplied
    here. Two apartments print 490 and 470 ﷼ (ids 451, 400): stored as printed, PRICE = SOURCE.
    Fractional figures («3971236.64», «2113.9») are truncated by the fleet's to_int and the raw
    string is kept in additional_info.

  · RENT PERIOD: the API has NO period field. 30 rent rows; the period lives only in prose, and
    the prose is a trap: id 765 says «قريبة من الخدمات اليومية» (a DAILY token that is about the
    neighbourhood), id 576 states «27,000 ريال سنوي» AND «إيجار شهري … 3,000 ريال». So the period
    is read ONLY from a token bound to the rent word or to the currency («الإيجار السنوي», «ريال
    سنوي»), preferring the token adjacent to THIS row's own figure; two different periods bound to
    the figure → NULL, unconverted. Measured: 7 of 30 state a period (all annual), 23 → NULL.

  · STRUCTURED FACTS (per-field coverage from the 207): rooms/bathes/halls/floor_no carry the
    placeholder «اختر» on ~55% (→ NULL); date_created is the shared age vocabulary («جديد» 119,
    «اكثر من عشر سنوات» 11 → open bound → NULL); street_width «0» on 137 (→ NULL); propertyFace
    lists up to four bearings («شرقية - غربية - شمالية - جنوبية») → one_direction → NULL, raw
    kept; features is a comma list of chips (مؤثث/مطبخ/مكيفات/مصعد/مدخل خاص/مدخل سيارة/توافر
    الماء/توافر الكهرباء/صرف صحي …); propertyUtilities «كهرباء,مياه,صرف صحي» or the explicit
    negation «لايوجد خدمات» (8 rows → electricity/water/sanitation False).

  · RESULT of the full walk (2026-09-24): 207 records → 204 mapped (195 residential + 9
    commercial); skipped city_not_in_catalog 3. Per-field: area 204, licence 204, photos 203,
    age 165, district_ar 183, bedrooms 91, bathrooms 89, halls 88, floor 78, street width 63,
    direction 70 (of 105 with a facade cell; the rest list several bearings).

  · LICENCES: `adLicenseNumber` (72…, 10 digits) is the REGA AD licence → license_number.
    `ad_lisance` (1010…) is the commercial registration and `brokerageAndMarketingLicenseNumber`
    the FAL broker licence — neither is the ad licence.

  · PII in the record: advertiserName, phoneNumber, agent_number, responsibleEmployeeName/Phone.
    None of them is read. Descriptions carry phone numbers and maps links → redact_pii.

  · CITIES: city_title/region_title are structured. to_catalog placed 20 of 23 distinct names
    (204/207 rows); «صبيا - المحله», «الظبية والجمعه», «دفاين الضبا» are not in the catalog → SKIP
    (never a default). district_title «غير محدد» (3) is a placeholder → neighborhood NULL.

  · PHOTOS: `images` is a comma list of relative paths under /Agent/assets/properties_images/…,
    one has a non-ASCII filename → percent-encoded. Fetched one: 200 image/jpeg, JFIF bytes.

REMOVAL ORACLE (measured 2026-09-24 against the POST detail route):
  gone   — sitemap ids 59, 67, 68 (no longer on the API): HTTP 404 {"error":"No property found"}
           (29 bytes); ids 0 and -1 the same; a non-numeric id: HTTP 400 {"error":"Invalid ID"}.
  live   — 770, 769, 308 (three controls from the catalogue): HTTP 200, {"id": <same>, "status": "1"}.
  So: 404 + «No property found» → GONE; 200 whose id echoes ours → LIVE; anything else → no opinion.
  Prune runs only after a COMPLETE walk (distinct ids == the site's totals) AND after three rows
  parsed live this run answer LIVE through the same route (fails CLOSED). The route is POST-only
  (GET → 400 «Invalid ID»), so the probe posts and hands the answer to the shared liveness law.
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
import time
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import decide, read_is_unbelievable  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://ebriza.com.sa"
API = f"{BASE}/RestApi/MainApi.php"
SOURCE = "إبريزة العقارية"
PREFIX = "EBZ"
PAUSE = 0.7
PAGE = 10                      # the API's fixed page size


# ── transport ─────────────────────────────────────────────────────────────────────────────────────
def session() -> cc.Session:
    # impersonate OWNS the User-Agent — only Accept-* are ours.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json, text/plain, */*", "Accept-Language": "ar,en;q=0.7",
                      "Referer": f"{BASE}/"})
    return s


def fetch_listings(s: cc.Session, limit: int = 0) -> tuple[list[dict], int]:
    """Every record of both deal types, in the API's deterministic «latest» order.

    Returns (records, expected) where `expected` is the sum of the site's own `total` counters.
    Raises when a page is not JSON (a challenge/outage must fail the run, not read as empty)."""
    out: dict[int, dict] = {}
    expected = 0
    for deal in ("بيع", "إيجار"):
        for page in range(1, 200):
            r = s.get(API, params={"action": "get_properties", "type": deal, "page": page,
                                   "filters[sort]": "latest"}, timeout=60)
            if r.status_code != 200:
                raise RuntimeError(f"get_properties type={deal} page={page}: HTTP {r.status_code}")
            try:
                j = r.json()
            except ValueError:
                raise RuntimeError(f"get_properties type={deal} page={page}: not JSON") from None
            items = j.get("propertiesData") if isinstance(j, dict) else None
            if page == 1:
                expected += int(j.get("total") or 0)
            if not items:
                break
            for it in items:
                if isinstance(it, dict) and it.get("id") is not None:
                    out.setdefault(int(it["id"]), it)
            if limit and len(out) >= limit:
                return list(out.values())[:limit], expected
            if len(items) < PAGE:
                break
            time.sleep(PAUSE)
        time.sleep(PAUSE)
    return list(out.values()), expected


# ── text helpers ──────────────────────────────────────────────────────────────────────────────────
def _strip_tags(h: Optional[str]) -> str:
    if not h:
        return ""
    t = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", _html.unescape(t).replace("\xa0", " ")).strip()


def _unset(v) -> bool:
    """The API's own "not filled" values: '', 'اختر' (the form's «choose» placeholder), None, 'null'."""
    return v is None or str(v).strip() in ("", "اختر", "null", "0")


def _count(v) -> Optional[int]:
    return None if _unset(v) else normalize.to_int(v)


# ── rent period, bound to the rent word / the figure ──────────────────────────────────────────────
_PERIOD_TOKEN_RE = re.compile(r"(نصف\s*سنوي|ربع\s*سنوي|سنوي|شهري|يومي|أسبوعي|اسبوعي)")
_ANCHOR_RE = re.compile(r"يجار|اجار|إجار|ريال|﷼|سعر|SAR", re.I)


def _figure_forms(price: Optional[int]) -> list[str]:
    if not price:
        return []
    forms = [f"{price:,}", str(price)]
    if price % 1000 == 0:
        k = price // 1000
        forms += [f"{k} الف", f"{k} ألف", f"{k}الف", f"{k}ألف"]
    if price == 1_000_000:
        forms.append("مليون")
    return forms


def rent_period_stated(price: Optional[int], text: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """(rent_period, price_annual) from a period token the ad binds to its RENT or its CURRENCY.

    A bare token is not a statement about the price: «الخدمات اليومية» (id 765) is the
    neighbourhood. A token bound to the figure itself («27,000 ريال سنوي») outranks one bound to
    the rent word elsewhere; two different periods at the same rank → NULL, figure unconverted.
    The shared helper does the conversion so يومي/أسبوعي/نصف سنوي land as (None, None)."""
    t = re.sub(r"\s+", " ", text or "")
    figs = _figure_forms(price)
    bound: list[tuple[str, bool]] = []
    for m in _PERIOD_TOKEN_RE.finditer(t):
        before, after = t[max(0, m.start() - 24):m.start()], t[m.end():m.end() + 16]
        if not (_ANCHOR_RE.search(before) or _ANCHOR_RE.search(after)):
            continue
        near = any(f in before or f in after for f in figs)
        bound.append((re.sub(r"\s+", " ", m.group(1)), near))
    if not bound:
        return None, price
    near = {tok for tok, n in bound if n}
    chosen = near or {tok for tok, _ in bound}
    if len(chosen) != 1:
        return None, price
    return normalize.rent_period_and_annual(price, chosen.pop())


# ── mapping ───────────────────────────────────────────────────────────────────────────────────────
# The site's exact spellings that the shared map lacks or must shadow. Exact-match only.
TYPE_OVERRIDES = {
    "شقة صغيرة (استوديو)": "Studio",     # the API spells it «شقَّة» with diacritics; see _plain
    "مجمع": "Commercial Building",       # «مجمع تجاري للبيع» — the fleet's word for a complex
}
_AUCTION_RE = re.compile(r"مزاد")
# A closed deal is a STATUS, read from the title only — descriptions say «مؤجرة بـ 20,000» about a
# building's tenants (id 554), which is a fact about an offer that is very much open.
_CLOSED_TITLE_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع|مؤجر")
_OFFPLAN_RE = re.compile(r"على\s*الخارطة|(?<![ء-ي])قريب[اً]+(?![ء-ي])")

# features chips → tri-state amenity columns (present → True; a chip never says «no»)
_FEATURE_COLS = {
    "مؤثث": "furnished", "مطبخ": "kitchen", "مكيفات": "air_conditioner", "مصعد": "elevator",
    "مدخل خاص": "private_entrance", "مدخل سيارة": "parking",
    "توافر الماء": "water_supply", "توافر الكهرباء": "electricity", "صرف صحي": "sanitation",
}
_UTILITY_COLS = {"كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation"}


def _plain(t: str) -> str:
    """Drop Arabic diacritics: the API writes «شقَّة» with a shadda+fatha whose ORDER differs from
    any typed key, so an exact map lookup on the raw string can never match it."""
    return re.sub(r"[\u064B-\u0652]", "", t or "").strip()


def _chips(raw: Optional[str]) -> list[str]:
    return [c.strip() for c in (raw or "").split(",") if c.strip()]


def amenities(features: Optional[str], utilities: Optional[str], description: str) -> dict[str, bool]:
    """Prose first (it carries negations), then the structured chips on top — a chip is the
    source's own tick box and wins over a sentence. «لايوجد خدمات» is an explicit «no» for the
    three utilities; silence stays absent."""
    out = normalize.amenities_from_text(description)
    for chip in _chips(features):
        col = _FEATURE_COLS.get(chip)
        if col:
            out[col] = True
    if utilities and "لايوجدخدمات" in utilities.replace(" ", ""):
        out.update({c: False for c in _UTILITY_COLS.values()})
    else:
        for chip in _chips(utilities):
            col = _UTILITY_COLS.get(chip)
            if col:
                out[col] = True
    return out


def listing_url(it: dict) -> str:
    url_kind = "rent" if it.get("advertisementType") == "إيجار" else "for_sell"     # a URL path
                                                                                   # segment, NOT transaction_type
    tail = f"{it.get('propertyType') or 'عقار'}-{it.get('advertisementType') or ''}"
    return (f"{BASE}/{url_kind}/{int(it['id'])}/{quote(str(it.get('city_title') or 'x'))}/"
            f"{quote(str(it.get('district_title') or 'x'))}/{quote(tail)}")


def photo_urls(it: dict) -> list[str]:
    return [f"{BASE}/{quote(p.strip())}" for p in (it.get("images") or "").split(",") if p.strip()]


def map_listing(it: dict) -> tuple[Optional[dict], str, str]:
    if it.get("id") in (None, ""):
        return None, "residential", "no_id"
    if str(it.get("status")) != "1" or str(it.get("final_status")) != "1":
        return None, "residential", f"status_{it.get('status')}_{it.get('final_status')}"

    title = _strip_tags(it.get("title"))
    description = redact_pii(_strip_tags(it.get("description")))
    body = f"{title} {description or ''}"
    if _AUCTION_RE.search(body):
        return None, "residential", "auction"
    if _CLOSED_TITLE_RE.search(title):
        return None, "residential", "sold_or_rented"
    if _OFFPLAN_RE.search(title):
        return None, "residential", "off_plan"

    deal = {"بيع": "Buy", "إيجار": "Rent"}.get(it.get("advertisementType") or "")
    if not deal:
        return None, "residential", "deal_unknown"

    type_ar = _plain(it.get("propertyType") or "")
    property_type = normalize.map_type_exact(type_ar, TYPE_OVERRIDES)
    if property_type == "Residential Land" and "تجاري" in _chips(it.get("features")):
        property_type = "Commercial Land"       # the source's own usage chip on the plot
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()
    is_land = type_ar == "ارض"

    city_ar = (it.get("city_title") or "").strip()
    city_id, region_id = to_catalog(city_ar, it.get("region_title")) if city_ar else (None, None)
    if not city_id:
        return None, category, "city_not_in_catalog" if city_ar else "city_not_stated"
    district_raw = (it.get("district_title") or "").strip() or None
    if district_raw and district_raw in ("غير محدد",):
        district_raw = None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    area_m2 = normalize.to_int(it.get("space"))
    if area_m2 is not None and area_m2 <= 0:
        area_m2 = None

    facade_raw = (it.get("propertyFace") or "").strip() or None
    sw_raw = (it.get("street_width") or "").strip()
    age_raw = (it.get("date_created") or "").strip()
    licence = str(it.get("adLicenseNumber") or "").strip()

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{int(it['id'])}",
        "listing_url": listing_url(it),
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": description,
        **amenities(it.get("features"), it.get("propertyUtilities"), description or ""),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area_m2,
        "bedrooms": None if is_land else _count(it.get("rooms")),
        "bathrooms": None if is_land else _count(it.get("bathes")),
        "halls": None if is_land else _count(it.get("halls")),
        "floor_number": None if is_land else _count(it.get("floor_no")),
        "property_age": normalize.exact_age(age_raw) if age_raw and age_raw != "null" else None,
        "street_width_m": normalize.one_street_width(sw_raw) if sw_raw not in ("", "0") else None,
        "direction": normalize.one_direction(facade_raw) if facade_raw else None,
        "license_number": licence if re.fullmatch(r"\d{6,}", licence) else None,
        "photo_urls": photo_urls(it)[:20] or None,
    }

    # ── price: exactly what the site's own JS prints (see docstring) ──
    price_raw = it.get("price")
    land_total_raw = it.get("landTotalPrice")
    land_rent_raw = it.get("LandTotalAnnualRent")
    if deal == "Buy":
        if is_land:
            row["price_total"] = normalize.to_int(land_total_raw)
            row["price_per_meter"] = normalize.to_int(price_raw)
            ev = normalize.price_evidence(field="landTotalPrice", raw=land_total_raw,
                                          stored=row["price_total"], kind="total", unit="total",
                                          origin="api")
        else:
            row["price_total"] = normalize.to_int(price_raw)
            ev = normalize.price_evidence(field="price", raw=price_raw, stored=row["price_total"],
                                          kind="total", unit="total", origin="api")
    else:
        if is_land:
            # The field's own name states the period; nothing else on the record does.
            rent = normalize.to_int(land_rent_raw)
            row["rent_period"], row["price_annual"] = ("annual", rent) if rent is not None else (None, None)
            row["price_per_meter"] = normalize.to_int(price_raw)
            ev = normalize.price_evidence(field="LandTotalAnnualRent", raw=land_rent_raw, stored=rent,
                                          kind="annual", unit="total", origin="api")
        else:
            rent = normalize.to_int(price_raw)
            row["rent_period"], row["price_annual"] = rent_period_stated(rent, body)
            ev = normalize.price_evidence(field="price", raw=price_raw, stored=row["price_annual"],
                                          kind=row["rent_period"] or "total", unit="total", origin="api")

    lat_lng = [p.strip() for p in str(it.get("Coordinates") or "").split(",")]
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar,
        "features_raw": it.get("features") or None,
        "utilities_raw": it.get("propertyUtilities") or None,
        "facade_raw": facade_raw,
        "street_width_raw": sw_raw or None,
        "age_raw": age_raw or None,
        "floor_raw": None if _unset(it.get("floor_no")) else it.get("floor_no"),
        "area_raw": it.get("space") if area_m2 is not None and "." in str(it.get("space")) else None,
        "price_raw": price_raw,
        "land_total_price_raw": land_total_raw or None,
        "land_annual_rent_raw": land_rent_raw or None,
        "price_evidence": ev,
        "street": (it.get("street") or "").strip() or None,
        "plan_number": it.get("planNumber") or None,
        "land_number": it.get("landNumber") or None,
        "deed_type": it.get("titleDeedTypeName") or None,
        "is_pawned": {"1": True, "0": False}.get(str(it.get("isPawned"))),
        "is_constrained": {"1": True, "0": False}.get(str(it.get("isConstrained"))),
        "latitude": lat_lng[0] if len(lat_lng) == 2 and lat_lng[0] else None,
        "longitude": lat_lng[1] if len(lat_lng) == 2 and lat_lng[1] else None,
        "region_title": it.get("region_title") or None,
        "created_at": it.get("created_at") or None,
        "licence_end_date": it.get("endDate") or None,
        "photo_count": len(photo_urls(it)) or None,
    }.items() if v is not None}
    return row, category, ""


# ── liveness ──────────────────────────────────────────────────────────────────────────────────────
def _signal_for(pid: int):
    def _signal(status, body, _moved):
        try:
            j = json.loads(body)
        except (ValueError, TypeError):
            return None
        if not isinstance(j, dict):
            return None
        if status == 404 and "No property found" in str(j.get("error", "")):
            return "gone"
        if status == 200 and j.get("id") == pid:
            return "live" if str(j.get("status")) == "1" else "gone"
        return None
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    """POST-only detail route, judged under the shared liveness law (decide/read_is_unbelievable)."""
    pid = ad_number[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
    last = "no attempt made"
    for attempt in (0, 1):
        try:
            r = session().post(API, data={"action": "get_property_data", "id": pid}, timeout=45)
            status, body = r.status_code, (r.text or "")
        except Exception:  # noqa: BLE001 — an unreachable source is never proof of death
            status, body = None, ""
        last = read_is_unbelievable(status, body) or f"HTTP {status}, no opinion from the signal"
        verdict = decide(status, body, False, _signal_for(int(pid)))
        if verdict is not None:
            return verdict
        time.sleep(1.2 * (attempt + 1))
    return "unknown", f"no verdict after 2 attempts — {last}"


def _controls_live(ad_numbers: list[str]) -> bool:
    """In-run positive control: three rows parsed live THIS run must answer LIVE through the same
    oracle, else the transport may not testify about anyone's absence. Fails closed."""
    if len(ad_numbers) < 3:
        return False
    for ad in ad_numbers[:3]:
        verdict, why = _verify_gone(ad)
        if verdict != "live":
            print(f"  ⚠ oracle control {ad} answered {verdict} ({why}) — prune withheld", flush=True)
            return False
        time.sleep(PAUSE)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("ebriza")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    items: list[dict] = []
    try:
        items, expected = fetch_listings(s, limit=args.limit)
        if not items:
            raise RuntimeError("get_properties answered 0 records — treated as blocked, not empty")
        complete = not args.limit and len(items) == expected
        print(f"{SOURCE}: {len(items)} distinct records (site counters say {expected})"
              f"{'' if complete else ' — INCOMPLETE walk, prune withheld'}", flush=True)
        for it in items:
            row, cat, why = map_listing(it)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):8} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0['bedrooms']):>4} pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ppm={r0.get('price_per_meter')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0

        # The public upsert_ebriza_*_batch wrappers are added centrally later; this is the same
        # shared batch writer they will wrap.
        db._wasalt_batch("ebriza_residential_listings", res)
        db._wasalt_batch("ebriza_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="ebriza_residential_listings", com_table="ebriza_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after a COMPLETE walk (distinct ids == the site's totals; --limit never
        # reaches here; a --type run leaves the other table's seen-set empty by construction) and
        # only once the in-run positive control passed. prune_unseen's own breakers sit on top.
        pruned = 0
        if args.type == "all" and complete and _controls_live([r["ad_number"] for r in res + com]):
            for tbl, rows in (("ebriza_residential_listings", res), ("ebriza_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; walk={len(items)}/{expected}; {notes}"[:300],
                             degraded=not complete,
                             check_tables=["ebriza_residential_listings", "ebriza_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            tally = ";".join(f"{k}={v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=len(items), rows_upserted=0,
                       notes=f"{e}"[:200] + (f" | skips: {tally}" if tally else ""))
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
