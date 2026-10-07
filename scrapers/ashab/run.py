"""Ashab («شركة عشاب العقارية», ashab.sa) — a Buraydah/Qassim brokerage. Onboarding 2026-09-27 (batch 7).

SOURCE SHAPE (measured live 2026-09-27 over the whole site: 51 list pages, 447 ads, 1,401 unit cards)
=====================================================================================================
A Laravel site, server-rendered HTML, curl_cffi impersonate="chrome" → 200, no API.
  list    https://ashab.sa/properties?page=N          (9 cards a page; page 52 is empty)
  ad      https://ashab.sa/properties/<id>
  unit    https://ashab.sa/properties/<internal>/unit/<unit_id>   (the units of a multi-unit ad)
An ad page states two header badges — the DEAL («بيع» 283 · «إيجار» 156 · «استثمار» 8) and the
AVAILABILITY («متاح», «متاح جزئي», «مؤجر», «مؤجر بالكامل», «مؤجر جزئي», «مباع», «مباع بالكامل», «محجوز») —
the title, «location_on بريدة،الأخضر[،ق/ب/6361]» (city،district[،plan]), «رقم الإعلان» (the office's
own ad number) and a labelled spec table: «معرف الإعلان», «نوع العقار», «رخصة فال», «صفة المُعلِن»,
«حد / سعر نهائي», «السوم», «عرض الشارع», «المساحة», «سعر المتر», «ترخيص الاعلان» (REGA ad licence),
«عمر العقار»; then «المرافق» (صالة/دورة مياة/غرفة نوم/مجلس/مطبخ … with counts), «الخدمات المتوفرة»,
«الواجهات» («شارع غربي 30 م»), a Google-Maps pin and a gallery of /public/storage/*.jpg photos
(no placeholder or logo is ever in the gallery; 973 of 1,454 pages simply have none).

MULTI-UNIT ADS (70 ads with at least one «متاح» unit, 383 such units): the page lists «الوحدات العقارية»
cards (a status badge + a link to the unit's OWN page) and its header prints «السعر يبدأ من 0 إلى 15000
ر.س» — a range over its units, never one price. The ad is a CONTAINER: one listing PER AVAILABLE UNIT,
read from the unit's own page (own price, area, photos); a rented/sold unit is a counted skip, and the
building itself is never a row. A building that says «مؤجر بالكامل»/«مباع بالكامل» while some unit card
still says «متاح» (measured: /properties/684777, 5 of 33) contradicts itself → its units are skipped.
TRAPS on a unit page:
  · its «حد / سعر نهائي» row is the BUILDING's limit, copied onto every unit (/properties/822470:
    building «الحد 44000», units priced 22000 and 25000 all show «الحد 44000»). The unit's OWN price is
    the page header («22500 ر.س»); the copied limit is kept as text only.
  · its «عقارات مشابهة» block lists the SIBLING units in the same card shape as the building's unit list
    → units are read only after a building page's «الوحدات العقارية» heading, never from a unit page.

PRICE. A single ad's price is «حد / سعر نهائي»: «الحد 20000 ر.س» = the advertiser's limit / final asking
price, the only price the ad publishes (the header repeats it) — stored verbatim (to_int reads the
site's dot-grouped «الحد 60.000» / «الحد 4.500000» as 60000 / 4500000); «لا يوجد حد» → NULL.
«السوم» (107 ads) is the CURRENT OFFER a buyer made — never the price, kept as text. «سعر المتر» (42 ads)
→ price_per_meter. When the price figure IS the page's own «سعر المتر» (land: «الحد 470» + «سعر المتر 470»,
unit header «500 ر.س» + «سعر المتر 500») the source labels that figure per-m² → price_per_meter only,
price_total NULL (almotmkenah precedent). LAND PRICED BELOW ANY POSSIBLE TOTAL (≤ 10,000 on a sale) is
the platform's per-m² figure even when «سعر المتر» is blank — owner decision 2026-09-28 («judge by the
price»): measured 35 land ads at 350–1,400 for 238–2,781 m² plots and NONE between 1,400 and 50,000, and
ad 688953 prints «سعر المتر 300» equal to its offer («السوم 300») beside «الحد 350». «0 ر.س» is no price. The site states NO rent period
(3 ads' prose does) → normalize.rent_period_from_ad(price, title+description, None, title).
TYPE: the site's «نوع العقار». Two values are COMBINED buckets — «معارض - محلات» and «شاليه - استراحة» —
resolved only when the listing's own title names exactly one side (محل → Shop, معرض → Showroom; شاليه →
Chalet, استراحة → Rest House); otherwise skipped. «مخطط الفردوس» (a plan's name used as a type) and «أخرى»
have no honest type → skipped. DEAL «استثمار» states neither sale nor lease → skipped (gomenassat precedent).
AUCTIONS live in a separate «المزادات» section that is never walked; an ad that says «مزاد» is skipped.
PDPL: the office phone/e-mail and the lead form are never stored; «صفة المُعلِن» is dropped; the FAL
licence (the office's, 12xxxxxxxx) goes to additional_info; title/description pass redact_pii.
"""
from __future__ import annotations

import argparse
import html as ihtml
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
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://ashab.sa/"
LIST = BASE + "properties?page={}"
SOURCE = "عشاب العقارية"
PREFIX = "ASB"
SLUG = "ashab"
SLEEP = 0.4

_DEAL = {"بيع": "Buy", "إيجار": "Rent", "ايجار": "Rent"}
AVAILABLE = "متاح"
# a building whose own status is one of these may hold available units; anything else («مؤجر بالكامل»,
# «مباع بالكامل», «مؤجر», «مباع» …) says none is — its unit cards are not trusted over it
_BUILDING_OPEN = {"متاح", "متاح جزئي", "مؤجر جزئي"}
# the site's own «نوع العقار» spellings (exact-match overrides; every target an existing canonical type)
TYPE_OVERRIDES = {
    "أرض سكنية": "Residential Land", "ارض سكنية": "Residential Land",
    "شقة علوية": "Apartment", "شقة أرضية": "Apartment",           # bossbih/aqalemhajer precedent
    "شقق مدخل مشترك": "Apartment",
    "دبلوكس": "Duplex",
    "مكاتب إدارية": "Office",
    "عمارة سكنية": "Building", "عمارة تجارية": "Commercial Building",
}
# combined buckets: the listing's own title must name exactly one side
_BUCKETS = {
    "معارض - محلات": {"Shop": r"محل", "Showroom": r"معرض|معارض"},
    "شاليه - استراحة": {"Chalet": r"شالي", "Rest House": r"استراح"},
}
_AMENITIES = {"مدخل سيارة": "car_entrance", "غرفة غسيل": "laundry_room", "ملحق": "extension",
              "تكييف متوفر": "air_conditioner", "مطبخ": "kitchen", "المطبخ": "kitchen", "مطبخ راكب": "kitchen",
              "كراج": "parking"}
_URL_RE = re.compile(r'https://ashab\.sa/properties/(\d+)"')
_UNIT_RE = re.compile(r'<span class="badge"[^>]*>\s*([^<]+?)\s*</span>\s*<a href="(https://ashab\.sa/properties/\d+/unit/(\d+))"')
_NUM_RE = re.compile(r"[\d٠-٩][\d٠-٩,٬.]*")
_SAR_RE = re.compile(r"([\d٠-٩][\d٠-٩,٬.]*)\s*ر\.?\s*س")
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


_LAND_PPM_MAX = 10_000   # a land sale below this is a per-m² figure (no plot here costs ≤ 10,000 in total)

def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40)
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def _txt(s: str) -> str:
    s = re.sub(r'<span[^>]*material-symbols[^>]*>.*?</span>', " ", s or "", flags=re.S)   # icon names
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse_page(page: str) -> dict[str, Any]:
    """Everything one ad/unit page states, as raw source text. Nothing is interpreted here."""
    start = page.find('id="page-title"')
    main = page[start:] if start >= 0 else page
    for stop in ('id="similar-properties"', "عقارات مشابهة"):     # sibling units / other ads
        if (k := main.find(stop)) > 0:
            main = main[:k]
    g = main.find('id="gallery-carousel"')
    head = main[:g] if g > 0 else main[:6000]
    # the ad page prints its title in <b class="d-flex…">, a unit page in <strong class="d-flex…">
    title = re.search(r'<(b|strong) class="d-flex[^"]*"[^>]*>(.*?)</\1>', head, re.S)
    loc = re.search(r"location_on</span>\s*<span>(.*?)</span>", head, re.S)
    top = re.search(r"<!--Price-->\s*<h(\d)[^>]*>(.*?)</h\1>", head, re.S)
    spec: dict[str, str] = {}
    for label, value in re.findall(r'font-weight-bolder">\s*([^<]+?)\s*</a>\s*(?:<span[^>]*>)?\s*([^<]*?)\s*<', main):
        spec.setdefault(_txt(label), _txt(value))
    features: dict[str, dict[str, str]] = {}
    for sec, body in re.findall(r'<h5 class="mfp-property"><b>(.*?)</b></h5>(.*?)(?=<h5 class="mfp-property"|id="locationMap")',
                                main, re.S):
        features[_txt(sec)] = {_txt(k): _txt(v) for k, v in re.findall(
            r'font-weight-bolder">([^<]+?)<span[^>]*>\s*<b>([^<]*)</b>', body)}
    desc = re.search(r'<section id="description"[^>]*>\s*<b>[^<]*</b>(.*?)</section>', main, re.S)
    geo = re.search(r"maps\.google\.com/maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)", main)
    gal = main[g:main.find('id="content"', g)] if g > 0 else ""
    units_at = main.find("<b>الوحدات العقارية</b>")
    return {
        "badges": [_txt(b) for b in re.findall(r'<span class="badge"[^>]*>(.*?)</span>', head, re.S)],
        "title": _txt(title.group(2)) if title else "",
        "location": _txt(loc.group(1)) if loc else "",
        "office_ad_no": (re.search(r"رقم الإعلان\s*(\d+)", _txt(head)) or [None, None])[1],
        "top_price": _txt(top.group(2)) if top else "",
        "spec": spec,
        "features": features,
        "description": _txt(desc.group(1)) if desc else "",
        "lat": geo.group(1) if geo else None,
        "lng": geo.group(2) if geo else None,
        "photos": list(dict.fromkeys(re.findall(r'class="ts-image"\s*data-bg-image="([^"]+)"', gal))),
        # (status, url, unit_id) per «الوحدات العقارية» card — a building page only
        "units": _UNIT_RE.findall(main[units_at:]) if units_at > 0 else [],
    }


def _sar(text: str) -> Optional[int]:
    """The one «N ر.س» figure a cell states; 0, none, or two figures («يبدأ من X إلى Y ر.س») → None."""
    hits = _SAR_RE.findall(text or "")
    v = normalize.to_int(hits[0]) if len(hits) == 1 and len(set(_NUM_RE.findall(text))) == 1 else None
    return v if v else None


def _area(text: str) -> Optional[float]:
    m = re.search(r"([\d٠-٩][\d٠-٩,٬.]*)\s*م", text or "")
    v = float(re.sub(r"[,٬]", "", m.group(1)).translate(_DIGITS)) if m else 0
    return v if v > 0 else None


def _count(features: dict, *names: str) -> Optional[int]:
    for n in names:
        for sec in features.values():
            if n in sec:
                v = normalize.to_int(sec[n])
                return v if v and v > 0 else None
    return None


def _type(type_ar: str, title: str) -> tuple[Optional[str], str]:
    if type_ar in _BUCKETS:
        hits = [t for t, rx in _BUCKETS[type_ar].items() if re.search(rx, title)]
        return (hits[0], "") if len(hits) == 1 else (None, f"type_bucket_unresolved_{type_ar}")
    ptype = normalize.map_type_exact(type_ar, TYPE_OVERRIDES)
    return (ptype, "") if ptype else (None, f"type_unmapped_{type_ar or 'missing'}")


def map_page(d: dict[str, Any], ad_id: str, url: str, unit_of: Optional[str] = None,
             building_licence: str = "") -> tuple[Optional[tuple[dict, str]], str]:
    """One listing from one ad page (unit_of=None) or one unit page (unit_of = the building's id; a unit
    page prints no «ترخيص الاعلان», so the building ad's licence — which covers its units — is passed in)."""
    badges = d["badges"]
    deal_ar = badges[0] if badges else ""
    status = badges[1] if len(badges) > 1 else ""
    type_ar = d["spec"].get("نوع العقار") or ""
    blob = f"{d['title']} {d['description']} {type_ar}"
    if re.search(r"مزاد", blob):
        return None, "auction"
    if status != AVAILABLE:
        return None, f"status_{status or 'missing'}"
    deal = _DEAL.get(deal_ar)
    if not deal:
        return None, f"deal_unmapped_{deal_ar or 'missing'}"
    if re.search(r"على الخارطة|تحت الإنشاء|تحت الانشاء", blob):
        return None, "off_plan"
    ptype, why = _type(type_ar, d["title"])
    if not ptype:
        return None, why
    category = normalize.category_for_type(ptype).lower()

    limit_raw = d["spec"].get("حد / سعر نهائي") or ""
    if unit_of:
        # the unit's OWN price is its header; the page's «الحد» row is the building's, copied
        price_field, price_raw = "unit page header", d["top_price"]
    else:
        if len(set(_NUM_RE.findall(d["top_price"]))) > 1:      # «يبدأ من X إلى Y», X≠Y: several prices
            return None, "price_range"
        price_field, price_raw = "حد / سعر نهائي", limit_raw
    price = _sar(price_raw)
    ppm_raw = d["spec"].get("سعر المتر") or ""
    ppm = _sar(ppm_raw)
    per_meter = bool(price and ppm and price == ppm)             # the source labels this figure per-m²
    # a land sale priced below any possible plot total is this site's per-m² figure (owner 2026-09-28, see top)
    land_ppm = bool(not per_meter and price and price <= _LAND_PPM_MAX and deal == "Buy"
                    and ptype in ("Residential Land", "Commercial Land"))
    if land_ppm:
        ppm = price
    if per_meter or land_ppm:
        price = None
    title = redact_pii(d["title"]) or ""
    desc = redact_pii(d["description"]) or ""
    row_price: dict[str, Any] = {"price_per_meter": ppm}
    if deal == "Buy":
        # a per-m² figure means the source publishes no total: write NULL for real, so a row that earlier
        # held the per-m² number as its «total» is cleared (a plain None is dropped by the upsert)
        row_price["price_total"] = db.AUTHORITATIVE_NULL if (per_meter or land_ppm) else price
    else:
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            price, f"{title} {desc}", None, title)

    parts = [p.strip() for p in re.split(r"[،,]", d["location"]) if p.strip()]
    city_ar = parts[0] if parts else None
    # «بريدة،ق/ب/6660»: a digit in the 2nd slot is a plan number, not a district
    district_raw = parts[1] if len(parts) > 1 and not re.search(r"[\d٠-٩]", parts[1]) else None
    plans = [x for x in parts[1:3] if x != district_raw and re.search(r"ق|مخطط", x)]   # «ق/ب/6361», «مخطط نجد»
    plan = plans[0] if plans else None
    plot = (d["features"].get("المرافق") or {}).get("رقم القطعة")
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = find_district_in_text("حي " + district_raw, city_id) if (city_id and district_raw) else None
    facades = d["features"].get("الواجهات") or {}
    licence = re.sub(r"\D", "", d["spec"].get("ترخيص الاعلان") or building_licence or "")
    age_raw = d["spec"].get("عمر العقار")
    # «0» may be a form default and «2-3 سنين» is a range: neither is an exact age
    age = None if not age_raw or age_raw.strip() == "0" or re.search(r"\d\s*[-–]\s*\d", age_raw) \
        else normalize.exact_age(age_raw)
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ad_id}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": desc[:4000] or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "plan_parcel": " / ".join(x for x in (plan, f"قطعة {plot}" if plot else None) if x) or None,
        "area_m2": _area(d["spec"].get("المساحة") or ""),
        "street_width_m": normalize.one_street_width(d["spec"].get("عرض الشارع")),
        # one facade only; two streets (a corner plot) is not one direction
        "direction": normalize.one_direction(next(iter(facades))) if len(facades) == 1 else None,
        "property_age": age,
        "bedrooms": _count(d["features"], "غرفة نوم", "الغرف", "غرف"),
        "bathrooms": _count(d["features"], "دورة مياة", "دورة مياه", "دورة المياه"),
        "halls": _count(d["features"], "صالة"),
        "reception_rooms_majlis": _count(d["features"], "مجلس"),
        "license_number": licence if re.fullmatch(r"7\d{9}", licence) else None,
        "photo_urls": [p for p in d["photos"] if "/public/storage/" in p and not re.search(r"logo", p, re.I)],
        **row_price,
    }
    for word, col in _AMENITIES.items():
        if _count(d["features"], word):
            row[col] = True
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="سعر المتر" if per_meter else price_field, raw=(ppm_raw if per_meter else price_raw) or None,
        stored=ppm if (per_meter or land_ppm) else stored,
        kind="per_meter" if (per_meter or land_ppm) else ("total" if deal == "Buy" else "annual"),
        unit="per_meter" if (per_meter or land_ppm) else "total", origin="spec_table",
        authoritative_absent=not price and not ppm and bool(re.search(r"لا يوجد|^0 ر", price_raw.strip())))
    info = {
        "source_ad_id": d["spec"].get("معرف الإعلان"),
        "office_ad_number": d["office_ad_no"],
        "unit_of": f"{PREFIX}{unit_of}" if unit_of else None,
        "type_ar": type_ar,
        "status_ar": status,
        "price_text": price_raw or None,
        "building_limit_text": limit_raw if unit_of else None,        # the building's «الحد», not the unit's
        "current_offer_text": d["spec"].get("السوم"),                  # «السوم»: an offer, never the price
        "price_per_meter_text": ppm_raw or None,
        "fal_licence": re.sub(r"\D", "", d["spec"].get("رخصة فال") or "") or None,
        "ad_licence_text": d["spec"].get("ترخيص الاعلان") if not row["license_number"] else None,
        "facades_ar": facades or None,
        "age_text": age_raw,
        "latitude": d["lat"],
        "longitude": d["lng"],
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    row["source_capture"] = strip_pii_fields({
        "schema": "ashab.page.v1", "badges": badges, "top_price": d["top_price"],
        "spec": {k: v for k, v in d["spec"].items() if k != "صفة المُعلِن"}, "features": d["features"]})
    return (row, category), ""


def walk(s: cc.Session) -> list[str]:
    ids: list[str] = []
    for p in range(1, 400):
        new = [i for i in dict.fromkeys(_URL_RE.findall(get(s, LIST.format(p)))) if i not in ids]
        if not new:
            break
        ids += new
        time.sleep(SLEEP)
    return ids


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    dry = ap.parse_args().dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    s, tried = retry_smarter_session(LIST.format(1), timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    ids = walk(s)
    print(f"{SOURCE}: {len(ids)} ad(s) on its own list", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = seen = 0

    def skip(why: str, n: int = 1) -> None:
        skipped[why] = skipped.get(why, 0) + n

    def take(got: tuple[Optional[tuple[dict, str]], str]) -> None:
        row_cat, why = got
        if not row_cat:
            return skip(why)
        (com if row_cat[1] == "commercial" else res).append(row_cat[0])

    try:
        for ad_id in ids:
            url = f"{BASE}properties/{ad_id}"
            try:
                d = parse_page(get(s, url))
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            time.sleep(SLEEP)
            seen += 1
            if not d["units"]:
                take(map_page(d, ad_id, url))
                continue
            # a building: one listing per AVAILABLE unit, from the unit's own page — never the building
            b_status = d["badges"][1] if len(d["badges"]) > 1 else ""
            if b_status not in _BUILDING_OPEN:
                skip(f"building_{b_status or 'missing'}")
                continue
            for status, unit_url, unit_id in d["units"]:
                if status != AVAILABLE:
                    skip(f"unit_{status}")
                    continue
                try:
                    u = parse_page(get(s, unit_url))
                except Exception:  # noqa: BLE001
                    unreadable += 1
                    continue
                time.sleep(SLEEP)
                seen += 1
                take(map_page(u, f"{ad_id}-U{unit_id}", unit_url, unit_of=ad_id,
                              building_licence=d["spec"].get("ترخيص الاعلان") or ""))
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in (res + com)[:40]:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_annual", "rent_period",
                       "price_per_meter", "area_m2", "city_ar", "district_ar")}, ensure_ascii=False)[:260])
            return 0

        db.upsert_ashab_residential_batch(res)
        db.upsert_ashab_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="ashab_residential_listings", com_table="ashab_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(ids) > 0
        for tbl, rr in (("ashab_residential_listings", res), ("ashab_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable page(s)", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             check_tables=["ashab_residential_listings", "ashab_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
