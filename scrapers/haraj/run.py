"""Haraj (haraj.com.sa) LIVE ingest — real-estate OFFERS (owner 2026-10-17: «all real-estate offers», reversing
10-16's licensed-only; backlog 311). A post becomes a listing only when ALL hold
  1. it carries the حراج العقار tag (the site's own real-estate section);
  2. scrapers/haraj/classify.py says «offer» — a request («مطلوب», «ابغى»), a non-property post (jobs,
     cars, furniture, «تقبيل», broker catalogues) and a doubt are NEVER stored;
  3a. WITH REGA's ad-licence block «معلومات العقار حسب الرخصة» (parse.py): every licence field is read, the
     licence number + expiry are stored, and an EXPIRED licence is never a listing;
  3b. WITHOUT it (prose.py): a resolved TYPE, DEAL and CITY from the seller's own words / the post's city, every
     other fact only when the seller states it (price tied to a price word, area from an area phrase, «حي X»);
     the licence fields stay NULL; a plural unit word (several units) is a catalogue, never stored.
Silent → NULL, never guessed; city/district through the SHARED catalogue resolver.

DISCOVERY. Haraj's sitemap index lists one .txt file per HOUR of new/updated posts (every category,
~4,400 an hour). The URL slug is the post's own title, so a property word in it picks the candidates
(shadow.property_slug_ids); a title the classifier already calls a request/non-property is not fetched.
This is a STREAM, not a catalogue: an ad missing from tonight's files is not gone (no absence prune,
ever). REMOVAL is own-page proof only: `_verify_gone` (404/410, «العرض محذوف او قديم», or a licensed
ad's own licence expired) — strikes each crawl, and the daily scrapers/common/fleet_liveness.py read.

HONEST ACCESS (owner rule): our own bot user-agent, no impersonation, ≤ 1 request a second (shadow.fetch),
only paths robots.txt allows (ad pages /<id>/<slug>/ are allowed; /post/*, /chat, /users/*/edit are not).
PDPL: no seller / licence-holder / officer name, no phone, no advertiser number is ever stored.

    python -m scrapers.haraj.run --files 2 --dry-run    # read the last 2 complete hours, write nothing
    python -m scrapers.haraj.run --files 2              # upsert
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import REGION_EN_TO_ID, catalog_district, city_ar_for, resolve, same_city  # noqa: E402
from scrapers.common.district_bridge import bridge_rows, bridge_unique, norm_en  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402
from scrapers.haraj import parse as P  # noqa: E402
from scrapers.haraj import prose as X  # noqa: E402
from scrapers.haraj.classify import classify  # noqa: E402
from scrapers.haraj.shadow import BASE, TAG, UA, _POST_RE, fetch, property_slug_ids  # noqa: E402

SOURCE = "Haraj"
SLUG = "haraj"
PREFIX = "HRJ"
RES_TABLE = "haraj_residential_listings"
COM_TABLE = "haraj_commercial_listings"
DELETED_MARK = "العرض محذوف او قديم"

LAND_TYPES = {"Residential Land", "Commercial Land", "أرض"}
DWELLING_TYPES = {"Apartment", "Villa", "Floor", "Duplex", "Studio", "Room", "Rest House", "Chalet", "تاون هاوس"}
# «أرض» (a plot whose source states no usage, owner 2026-10-10 on aqar) lives in the residential table, as on aqar.
RESIDENTIAL_EXTRA = {"أرض", "Studio", "Duplex"}

# REGA «استخدامات العقار» → the usage word. «سكني تجاري» is COMMERCIAL (owner mixed-use rule).
_USAGE = {"residential": "سكني", "سكني": "سكني", "commercial": "تجاري", "تجاري": "تجاري",
          "residential commercial": "تجاري", "سكني تجاري": "تجاري", "سكني - تجاري": "تجاري",
          "agricultural": "زراعي", "زراعي": "زراعي", "industrial": "صناعي", "صناعي": "صناعي"}
# REGA's English «نوع العقار» enum words the shared English map does not carry.
_TYPE_EN_EXTRA = {"Rest house": "Rest House", "Resthouse": "Rest House", "Esteraha": "Rest House",
                  "Istiraha": "Rest House", "Building": "Building", "Land": "أرض",
                  # REGA's English enum prints the plural (first production crawl 2026-10-17: «Warehouses»)
                  "Warehouses": "Warehouse",
                  # REGA's Arabic enum for a studio (11190678205 «شقَّة صغيرة (استوديو)», tashkeel folded first)
                  "شقة صغيرة (استوديو)": "Studio", "شقه صغيره (استوديو)": "Studio"}
_TASHKEEL = re.compile(r"[\u064B-\u0652\u0670\u0640]")


def usage_of(raw: Optional[str]) -> Optional[str]:
    v = re.sub(r"[\s\-/,،]+", " ", (P._clean(raw) or "")).strip().lower()
    return _USAGE.get(v) if v else None


def type_of(raw_type: Optional[str], usage: Optional[str], title: Optional[str]) -> Optional[str]:
    """REGA «نوع العقار» (Arabic or English enum) → our type. Land follows the licence's own usage; with
    usage silent, the ad's own title naming «سكنية/تجارية» decides; else «أرض» (no usage stated)."""
    raw = P._clean(_TASHKEEL.sub("", raw_type or ""))
    if not raw:
        return None
    t = N.map_type_exact(raw) or N.map_type_en(raw) or _TYPE_EN_EXTRA.get(raw) \
        or N.map_type_exact(re.sub(r"\s+", " ", raw))
    if t in LAND_TYPES or raw in ("أرض", "ارض", "Land"):
        if usage == "تجاري":
            return "Commercial Land"
        if usage == "سكني":
            return "Residential Land"
        if usage == "زراعي":
            return "Farm"
        tt = N._norm_ar(title or "")
        com, res = re.search(r"ارض\s+تجاري", tt), re.search(r"ارض\s+سكني", tt)
        if com and not res:
            return "Commercial Land"
        if res and not com:
            return "Residential Land"
        return "أرض"
    if t == "Building" and usage == "تجاري":
        return "Commercial Building"
    return t


def category_of(ptype: str, usage: Optional[str]) -> str:
    if ptype in RESIDENTIAL_EXTRA:
        return "residential"
    cat = N.category_for_type(ptype).lower()
    return "commercial" if usage == "تجاري" and ptype not in DWELLING_TYPES else cat


# ── LAND «سعر الوحدة»: a total on one ad, the metre rate on another (nafithh TRAP 2) ──────────────
# Haraj 11190690713 prints «سعر الوحدة: 400000» on 473.71 m² and its own text says «السعر المطلوب:
# 400,000» and «سعر المتر التقريبي: 844.4»: a TOTAL. Nafithh's licences print the metre rate. So the
# ad's own words decide; failing them, a figure no plot sells for (≤ 20,000 on ≥ 50 m²) is the rate and
# one no metre costs (≥ 100,000) is the total; in between nothing is guessed (NULL, raw kept).
_PER_M_WORDS = re.compile(r"(?:سعر\s*(?:ال)?متر|للمتر|المتر\s*(?:ب|=|:)|ريال\s*(?:لل|/)\s*متر|/\s*م2|للم2)")
_NUMS = re.compile(r"\d[\d,٬.]*")


def land_price_basis(price: int, area: Optional[float], text: str) -> Optional[str]:
    # EVERY mention of the figure is read, not only the first, and the shared reader decides too (2026-10-18:
    # 6 of 20 haraj plots under the city floor stated their rate where the first mention did not —
    # «(المتر 1,650 ريال)», «البيع المتر 1100», «سعر المتر : 1,100 ريال», «1800ريال سعودي للمتر», «3500ريال بالمتر»).
    t = (text or "").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    mentioned = False
    for m in _NUMS.finditer(t):
        if N.to_int(m.group(0)) != price:
            continue
        mentioned = True
        if _PER_M_WORDS.search(t[max(0, m.start() - 30): m.end() + 15]):
            return "per_meter"
    if N.stated_per_metre(t, price):
        return "per_meter"
    if mentioned:
        return "total"
    if area and area >= 50 and price <= 20_000:
        return "per_meter"
    if price >= 100_000:
        return "total"
    return None


def _region_hint(licence_location: Optional[str]) -> Any:
    """The licence's own region («Jazan Region, …» or «منطقة جازان, …»): a twin-city disambiguator only."""
    head = re.split(r"[,،]", licence_location or "")[0].strip()
    if re.search(r"[ء-ي]", head):
        return head
    return REGION_EN_TO_ID.get(re.sub(r"(?i)\s*region$", "", head))


def is_catalogue_title(title: Optional[str]) -> bool:
    """A title whose first unit word is a plural («شقق تمليك فاخرة … 3و4و5 غرف») is several units — a
    catalogue, never a listing — licensed or not (owner real-user check 2026-10-17: HRJ11190739649 and
    HRJ11190629474 showed as single apartments of 1,161 m² and 2,484 m², the whole building's licence area)."""
    t = X.norm(title or "")
    for h in X._TYPE_RE.finditer(t):
        if re.search(r"[0-9٠-٩]\s*(?:و\s*)?$", t[:h.start()]):
            continue                  # a counted plural inside one unit: «للبيع عمار 4 شقق», «شقة 3 غرف»
        return bool(re.fullmatch(X._PLURAL, h.group(1)))
    return False


def deal_conflict(title: Optional[str], p: dict) -> Optional[str]:
    """Why the post's own words disagree on Buy vs Rent, or None. A doubt is never stored (backlog 656/672):
    - "blocks": two REGA licence blocks with different deals (HRJ11190666849: Sell + إيجار 28,000, stored as
      Buy 28,000);
    - "title": the title names ONE deal and the licence block the other. Measured 2026-10-19 on the 8,035 stored
      ads: 111 (1.4%), e.g. «ايجار شقه ارضي3غرف … 20 الف السنه» with a Sell block of 1,000,000,000 and «شقه
      للايجار فى لبن … بسعر 35 الف» with Sell 2,800,000 — the owner's SALE licence pasted under a rental, so
      storing the block's side served a rental as a sale at the wrong price. The ad itself does not settle it,
      so it is not a listing. A title naming both («… الايجار … او للبيع») or neither decides nothing."""
    deals = {d for d in p.get("licence_deals") or [] if d}
    if len(deals) > 1:
        return "blocks"
    said = X.deal_of(title or "", "")
    if said and p.get("deal") and said != p["deal"]:
        return "title"
    return None


def licence_district(p: dict, city_id: Optional[int]) -> tuple[Optional[str], Optional[str]]:
    """(district, district_source) from REGA's licence location when the deed names a city but no «الحي:» (owner
    2026-10-19): only when the licence's city IS the deed's city (same_city: by name or the catalogue alias table).
    English locations go through the shared EN→AR bridge (unique key, confirmed in this city's catalogue)."""
    deed = p.get("deed_city_ar")
    city, district, form = P.licence_place(p.get("licence_location"))
    if not (deed and city_id and district):
        return None, None
    if form == "en":
        city_en = N.map_city(city_ar_for(city_id) or "")
        if not city_en or city.lower() != city_en.lower():
            return None, None
        ar = bridge_unique(bridge_rows(city_en), norm_en).get(norm_en(district) or "")
        return (ar, "licence_location_en_bridge") if ar and catalog_district(city_id, ar) else (None, None)
    if form == "text":
        words = re.sub(r"[.،,]", " ", city).split()
        same = any(same_city(" ".join(words[:k]), deed) for k in (1, 2, 3))
    else:
        same = same_city(city, deed)
    return (district, "licence_location") if same else (None, None)


def map_post(pid: str, ld: dict, page_html: str, verdict: str, why: str, today: Any = None
             ) -> tuple[Optional[dict], str, str, dict]:
    """(row, category, skip_reason, facts). row is None exactly when the post must not be a listing."""
    p = P.parse_post(ld, page_html)
    facts = {"district_raw_ar": p["district_ar"], "city_raw_ar": p["city_ar"]}
    if verdict != "offer":
        return None, "", f"not_offer_{verdict}", facts
    if not p["rega_block"]:
        # Owner 2026-10-17 (reverses 10-16's licensed-only): an OFFER without REGA's block is a listing too,
        # read from the seller's own words only (prose.py). Its licence fields stay NULL.
        return map_unlicensed(pid, ld, p, verdict, why, facts)
    state = N.ad_expiry_state(p["licence_expiry"], today)
    if state == "expired":
        return None, "", "licence_expired", facts
    if not p["deal"]:
        return None, "", "deal_unstated", facts
    if is_catalogue_title(ld.get("name")) or X.body_offers_several_units(ld.get("description")):
        return None, "", "catalogue", facts
    conflict = deal_conflict(ld.get("name"), p)
    if conflict:
        return None, "", f"deal_conflict:{conflict}", facts
    usage = usage_of(p["usage_raw"])
    ptype = type_of(p["property_type_ar"], usage, ld.get("name"))
    if not ptype:
        return None, "", f"type_unmapped:{p['property_type_ar']}", facts
    category = category_of(ptype, usage)

    loc = resolve(p["city_ar"], p["district_ar"], region_hint=_region_hint(p["licence_location"]))
    city_id, region_id = loc.get("city_id"), loc.get("region_id")
    district = catalog_district(city_id, p["district_ar"]) if city_id and p["district_ar"] else None
    facts["district_resolved"] = bool(district)
    facts["city_resolved"] = bool(city_id)
    if not city_id:
        return None, category, "city_not_in_catalog", facts
    if p["district_source"] in (None, "post_neighbourhood"):
        lic_d, lic_src = licence_district(p, city_id)
        if lic_d:
            p["district_ar"], p["district_source"] = lic_d, lic_src
            facts["district_raw_ar"] = lic_d
            district = catalog_district(city_id, lic_d)
            facts["district_resolved"] = bool(district)

    raw_text = p["description_raw_lines"]
    free_text = raw_text[:raw_text.find(P.LICENCE_HEAD)] if P.LICENCE_HEAD in raw_text else raw_text
    title = ld.get("name") or ""
    price = N.to_int(str(int(p["price"]))) if p["price"] else None
    price = price if price and price > 0 else None
    area = p["area_m2"]
    price_total = price_annual = price_per_meter = rent_period = None
    basis = None
    if price and ptype in LAND_TYPES:
        basis = land_price_basis(price, area, free_text)
    if price and basis == "per_meter":
        price_per_meter = price
        if p["deal"] == "Buy":
            price_total = db.AUTHORITATIVE_NULL      # a stated rate, no total: clears a total an older read stored
    elif price and p["deal"] == "Buy" and (ptype not in LAND_TYPES or basis == "total"):
        price_total = price
    elif price and p["deal"] == "Rent" and (ptype not in LAND_TYPES or basis == "total"):
        # PERIOD = the ad's own words tied to THIS price, else the repo's «≤ 10,000 looks monthly» rule,
        # else unstated (price stored unconverted, period NULL: it stays out of yearly/monthly searches).
        rent_period, price_annual = N.rent_period_from_ad(price, f"{title}\n{free_text}", None, title)
    services = P.services_of(p["services_raw"])
    dwelling = ptype in DWELLING_TYPES
    rooms = N.rooms_from_phrase(f"{title}\n{free_text}") if dwelling else {}
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": p["source_url"] or f"{BASE}/{pid}/",
        "source": SOURCE,
        "active": True,
        "title": p["title"] or None,
        "description": p["description"],
        # amenities the ad's own words state, yes-only (no structured amenity field on Haraj); the
        # licence's «خدمات العقار» list wins for the four services it carries.
        **N.prose_amenities(f"{title}\n{free_text}", skip=tuple(services)),
        **services,
        "property_type": ptype,
        "transaction_type": "Rent" if p["deal"] == "Rent" else "Buy",   # deal is validated above
        "city": N.map_city(p["city_ar"]),
        "region": N.region_for_city(N.map_city(p["city_ar"])),
        "city_ar": p["city_ar"],
        "city_id": city_id,
        "region_id": region_id,
        # The source's own word, kept as written whether or not the catalogue attests it (owner 2026-10-18:
        # «exact-match against the city's catalog or keep the source word as-is»); additional_info carries
        # the catalogue spelling when it does and which field the word came from.
        "district_ar": p["district_ar"],
        "neighborhood": p["district_ar"],
        "area_m2": round(area) if area else None,
        # «عدد الغرف» is a TOTAL room count, never bedrooms (owner 2026-07-28, aqar + dealapp): bedrooms
        # come only from the ad's own «N غرف …» phrase; the licence count is kept in additional_info.
        "bedrooms": rooms.get("bedrooms"),
        "halls": rooms.get("halls"),
        "bathrooms": P.baths_of(f"{title}\n{free_text}") if dwelling else None,
        "property_age": P.age_of(p["age_raw"]),
        "direction": P.facade_of(p["facade_raw"]),
        "street_width_m": N.one_street_width(p["street_width_raw"]),
        "plan_parcel": " / ".join(x for x in (p["plan_no"], p["plot_no"]) if x) or None,
        "license_number": p["licence_number"],
        "license_expiry": p["licence_expiry"],
        "rega_location_verified": bool(p["licence_number"]),
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "photo_urls": p["images"],
        "date_added": p["date_posted"],
        "last_update": p["date_modified"],
    }
    if category == "commercial":
        row.pop("furnished", None)
    info = {
        "post_id": pid,
        "rega_ad_license_number": p["licence_number"],
        "license_expiry": p["licence_expiry"],
        "licence_expiry_state": state,
        "type_ar": p["property_type_ar"],
        "usage_ar": p["usage_raw"],
        "deal_ar": p["deal_raw"],
        "unit_price_printed": p["price_raw"],
        "price_basis": basis,
        "area_printed": p["area_raw"],
        "rooms_count": p["rooms_raw"],
        "age_printed": p["age_raw"],
        "facade_printed": p["facade_raw"],
        "street_width_printed": p["street_width_raw"],
        "plan_no": p["plan_no"],
        "plot_no": p["plot_no"],
        "services_ar": p["services_raw"],
        "guarantees": p["guarantees"],
        "other_obligations": p["other_obligations"],
        "transfer_commission": p["transfer_commission"],
        "licence_location": p["licence_location"],
        "city_raw_ar": p["city_ar"],
        "district_raw_ar": p["district_ar"],
        "post_text_district_ar": p["post_text_district_ar"],
        "district_source": p["district_source"],
        "district_catalog_ar": district,
        "haraj_neighbourhood_ar": p["haraj_neighbourhood_ar"],
        "city_basis": "rega_deed_lines",
        "rega_facts": {k: v for k, v in p["licence_fields"].items() if P._clean(v)},
        "deed_facts": {k: v for k, v in p["deed_fields"].items() if P._clean(v)},
        "photo_count": len(p["images"]),
        "date_posted": p["date_posted"],
        "classifier": f"{verdict}: {why}",
        "latitude": p["latitude"],
        "longitude": p["longitude"],
    }
    row["additional_info"] = redact_capture({k: v for k, v in info.items() if v not in (None, "", [], {})})
    row["source_capture"] = redact_capture({"schema": "haraj.post.v1", "post_id": pid, "url": p["source_url"],
                                            "licence_fields": p["licence_fields"], "deed_fields": p["deed_fields"]})
    row["price_evidence"] = N.price_evidence(
        field="سعر الوحدة (REGA licence block)", raw=p["price_raw"],
        stored=price_total or price_annual or price_per_meter,
        kind="per_meter" if price_per_meter else ("annual" if price_annual else "total"),
        unit="per_meter" if price_per_meter else "total", origin="structured")
    return row, category, "", facts


# Haraj's own city list spells a few catalogue cities its own way (sample 2026-10-17: «الطايف» on 7 of 140 posts,
# unresolved). An exact spelling fold, never a guess: anything not listed goes to the resolver as written.
HARAJ_CITY_SPELLING = {"الطايف": "الطائف"}


def map_unlicensed(pid: str, ld: dict, p: dict, verdict: str, why: str, facts: dict
                   ) -> tuple[Optional[dict], str, str, dict]:
    """An unlicensed offer: stored only with a resolved TYPE, DEAL and CITY (owner 2026-10-17, rule 3). Price,
    area and the rest are the seller's own phrases (prose.py) — silent or ambiguous → NULL."""
    title = ld.get("name") or ""
    description = P.strip_person_lines(_html.unescape(ld.get("description") or ""))
    ptype, type_why = X.type_of(title, description)
    facts["licensed"] = False
    if not ptype:
        return None, "", ("catalogue" if type_why.startswith("catalogue") else "type_unresolved"), facts
    deal = X.deal_of(title, description)
    if not deal:
        return None, "", "deal_unresolved", facts
    city_raw = (ld.get("address") or {}).get("addressLocality")
    facts["city_raw_ar"] = city_raw
    loc = resolve(HARAJ_CITY_SPELLING.get(city_raw or "", city_raw))
    city_id, region_id = loc.get("city_id"), loc.get("region_id")
    facts["city_resolved"] = bool(city_id)
    if not city_id:
        return None, "", "city_not_in_catalog", facts
    # Haraj's OWN neighbourhood field, as written; the seller's prose («حي X» in the text) is never a district
    # (owner 2026-10-18). Catalogue attestation is recorded, not required.
    district = p["haraj_neighbourhood_ar"]
    facts["district_raw_ar"] = district
    facts["district_resolved"] = bool(catalog_district(city_id, district)) if district else False
    category = category_of(ptype, None)
    # PRICE from the seller's own words — owner decision 2026-10-17 (declared in verify-no-derived-price.ts):
    # only a figure tied to a price word; a bid («السوم»), a range or two figures → NULL.
    prose_price = X.asking_price(title, description)
    price = prose_price["price"]
    price_total = price_annual = price_per_meter = rent_period = None
    if price and prose_price["per_meter"]:
        price_per_meter = price if ptype in LAND_TYPES else None
    elif price and deal == "Buy":
        price_total = price
    elif price and deal == "Rent":
        if prose_price["period"] == "daily":
            price_annual = None                                           # no daily bucket: not a figure we store
        elif prose_price["period"]:
            rent_period, price_annual = N.rent_period_and_annual(
                price, {"monthly": "شهري", "annual": "سنوي"}[prose_price["period"]])
        else:
            rent_period, price_annual = N.rent_period_from_ad(price, prose_price["phrase"], None, title)
    area = X.area_of(title, description)
    more = X.facts(title, description, ptype)
    if category == "commercial":
        more.pop("furnished", None)
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": ld.get("url") or f"{BASE}/{pid}/",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(description) or None,
        **more,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": N.map_city(city_raw),
        "region": N.region_for_city(N.map_city(city_raw)),
        "city_ar": city_raw,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district,
        "neighborhood": district,
        # The seller's own words are this post's ONLY area source and this fetch read them: no area phrase
        # means the source states none, so a value an older parser misread from the same words is cleared
        # (HRJ11190652057 «مساحتة 10في 8» kept 10 m² after the fix, 2026-10-17) — never kept as None would.
        "area_m2": round(area["area"]) if area["area"] else db.AUTHORITATIVE_NULL,
        "license_number": None,
        "license_expiry": None,
        "rega_location_verified": False,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "photo_urls": [u for u in dict.fromkeys(ld.get("image") or []) if isinstance(u, str) and u.startswith("http")],
        "date_added": ld.get("datePosted"),
        "last_update": ld.get("dateModified"),
    }
    info = {
        "post_id": pid, "licensed": False, "classifier": f"{verdict}: {why}", "type_basis": type_why,
        "price_phrase": prose_price["phrase"], "price_basis": prose_price["why"], "price_period_stated": prose_price["period"],
        "area_phrase": area["phrase"], "area_basis": area["why"], "city_raw_ar": city_raw,
        "district_raw_ar": facts["district_raw_ar"],
        "district_source": "post_neighbourhood" if district else None, "photo_count": len(row["photo_urls"]),
        "date_posted": ld.get("datePosted"), "city_basis": "post_address_locality",
    }
    row["additional_info"] = redact_capture({k: v for k, v in info.items() if v not in (None, "", [], {})})
    row["source_capture"] = redact_capture({"schema": "haraj.post.v2.unlicensed", "post_id": pid, "url": ld.get("url"),
                                            "price_phrase": prose_price["phrase"], "area_phrase": area["phrase"]})
    row["price_evidence"] = N.price_evidence(
        field="the seller's own price phrase (owner 2026-10-17)", raw=prose_price["phrase"],
        stored=price_total or price_annual or price_per_meter,
        kind="per_meter" if price_per_meter else ("annual" if price_annual else "total"),
        unit="per_meter" if price_per_meter else "total", origin="seller_text",
        authoritative_absent=prose_price["why"].startswith("bid"))
    return row, category, "", facts


def _has_tag(h: str) -> bool:
    return TAG in h or quote(TAG) in h


def read_post(pid: str) -> tuple[int, str]:
    return fetch(f"{BASE}/{pid}/")


# The catch-up's sharper title gate (census 2026-10-17, 780 property-titled posts): a property noun AND a
# deal word keeps 11% of the reads and 11 of the 12 live licensed offers.
_CATCHUP_NOUN = re.compile(r"(ارض|أرض|شق[ةه]|شقق|فل[ةه]|فيلا|دور|عمار[ةه]|استراح[ةه]|محل|مستودع|مزرع[ةه]|بيت|"
                           r"منزل|روف|دبلكس|دوبلكس|مكتب|قطع[ةه]|مخطط|ملحق|غرف[ةه]|شاليه|قصر|تاون)")
_CATCHUP_DEAL = re.compile(r"(لل?بيع|للإ?ي?جار|للاجار|ايجار|إيجار|تقبيل|للتقبيل)")


def hour_files() -> list[str]:
    """Every hourly sitemap file Haraj lists (oldest first, ~3 months); the newest is still filling."""
    st, sm = fetch(f"{BASE}/sitemap.xml")
    if st != 200:
        raise RuntimeError(f"sitemap.xml answered {st}")
    return re.findall(r"<loc>([^<]+)</loc>", sm)


def ids_in(u: str, pre: Counter, tight: bool = False) -> list[str]:
    st, t = fetch(u)
    if st != 200:
        raise RuntimeError(f"sitemap file {u} answered {st}")
    titles = {m.group(1): unquote(m.group(2)).replace("_", " ") for m in _POST_RE.finditer(t)}
    out = []
    for i in property_slug_ids(t):
        title = titles.get(i) or ""
        if tight and not (_CATCHUP_NOUN.search(title) and _CATCHUP_DEAL.search(title)):
            pre["title_catchup_gate"] += 1
            continue
        v, _ = classify(titles.get(i), None)
        if v in ("request", "other"):
            pre[f"title_{v}"] += 1
            continue
        out.append(i)
    return out


def candidate_ids(files: int, skip_hours: int) -> tuple[list[str], dict]:
    """Post ids of the last `files` COMPLETE hourly sitemap files (the newest file, still filling, is
    skipped), property-titled, newest first; titles the classifier already rejects are not fetched."""
    locs = hour_files()
    end = len(locs) - 1 - skip_hours
    picked = locs[max(0, end - files):end]
    ids: list[str] = []
    pre = Counter()
    for u in picked[::-1]:
        ids += [i for i in ids_in(u, pre) if i not in ids]
    return ids, {"files": picked, "prefiltered": dict(pre), "locs": locs}


def crawl(files: int, skip_hours: int, limit: int = 0, today: Any = None, only: Optional[list[str]] = None,
          meta: Optional[dict] = None):
    if meta is None:
        ids, meta = (only, {"files": ["--ids"], "prefiltered": {}}) if only else candidate_ids(files, skip_hours)
    else:
        ids = only or []
    if limit:
        ids = ids[:limit]
    print(f"{SOURCE}: {len(ids)} candidate post(s) from {len(meta['files'])} hourly file(s) "
          f"{meta['files'][:1]}…{meta['files'][-1:]} · prefiltered {meta['prefiltered']}", flush=True)
    res: list[dict] = []
    com: list[dict] = []
    c = Counter()
    unresolved: Counter = Counter()
    for pid in ids:
        st, h = read_post(pid)
        c["fetched"] += 1
        if st != 200:
            c[f"http_{st}"] += 1
            continue
        if DELETED_MARK in h:               # gone, even when the page still carries its JSON-LD (below)
            c["deleted_at_source"] += 1
            continue
        if not _has_tag(h):
            continue
        ld = P.ld_listing(h)
        if not ld:
            c["real_estate_no_ld"] += 1
            continue
        c["real_estate"] += 1
        desc = _html.unescape(ld.get("description") or "")
        verdict, why = classify(ld.get("name"), P.strip_person_lines(desc))
        c[f"verdict_{verdict}"] += 1
        lic = P.LICENCE_HEAD in desc
        if lic:
            c["licence_block"] += 1
            if verdict == "offer":
                c["offer_with_licence"] += 1
        row, cat, skip, facts = map_post(pid, ld, h, verdict, why, today)
        if not row:
            c[f"skip_{skip.split(':')[0]}"] += 1
            if skip.startswith("type_unmapped"):
                c[skip[:60]] += 1
            continue
        c["stored_licensed" if row["additional_info"].get("licensed", True) else "stored_unlicensed"] += 1
        if lic and not row.get("license_number"):
            c["stored_without_licence_number"] += 1
        if not facts.get("district_resolved"):
            c["district_unresolved"] += 1
            if facts.get("district_raw_ar"):
                unresolved[f"{facts.get('city_raw_ar')} / {facts['district_raw_ar']}"] += 1
        if row.get("additional_info", {}).get("latitude") is not None:
            c["with_pin"] += 1
        # The crawl just read this post's OWN page. When the liveness oracle's own reader says that same
        # body is live and the page names this post, record it (no new request). 2026-10-18: the catch-up
        # stored 3,800 posts from their own pages and 4,074 of 4,478 active rows read «never checked».
        if _signal(st, h, False) == "live" and pid in h:
            db.mark_direct_alive(row, oracle="haraj.post_page.own_read")
            c["stamped_live"] += 1
        (com if cat == "commercial" else res).append(row)
    c["stored"] = len(res) + len(com)
    return res, com, c, unresolved, meta


# ── removal: own-page proof only (fleet_liveness reads this daily) ─────────────────────────────
def _signal(status, body, moved):
    if status in (404, 410) and not moved:
        return "gone"
    if status != 200 or not body:
        return None
    # The post's own page: «العرض محذوف او قديم». Census 2026-10-17: 93 of 565 gone pages still carry the
    # RealEstateListing JSON-LD (the old «and no JSON-LD» test kept them live forever); a live page never
    # prints the banner (3 of 3 stored live ads re-read 10-17).
    if DELETED_MARK in body:
        return "gone"
    ld = P.ld_listing(body)
    if not ld:
        return None
    desc = _html.unescape(ld.get("description") or "")
    # (2026-10-17) the licence block is no longer required, so its absence is not a removal; an ad whose
    # OWN licence has ended still is.
    if N.ad_expiry_state(P.licence_expiry(desc)) == "expired":
        return "gone"                       # its own licence has ended
    # (2026-10-17) a stored post whose OWN page now reads as a request or not-property was never an offer
    # (HRJ11190645357 «طلب شقه للايجار مستعجل» was stored before the classifier knew «طلب»): positive own-page
    # evidence, removed through the same strike path, never a private deactivation.
    if classify(ld.get("name"), P.strip_person_lines(desc))[0] in ("request", "other"):
        return "gone"
    if is_catalogue_title(ld.get("name")):    # several units in one post was never one listing (2026-10-17)
        return "gone"
    if X.body_offers_several_units(desc):     # the same, offered in the body (backlog 615, 2026-10-18)
        return "gone"
    p = P.parse_post(ld, body)
    if p["rega_block"] and p["deal"] and deal_conflict(ld.get("name"), p):
        return "gone"                       # its own words disagree on the deal: never a listing (656/672, 10-19)
    return "live"


def _probe_session():
    from curl_cffi import requests as cc   # NO impersonate: the honest client, owner rule
    s = cc.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ar"})
    return s


def _verify_gone(ad_number: str) -> tuple[str, str]:
    pid = str(ad_number or "")[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
    return LivenessProbe(platform=SLUG, signal=_signal, session=_probe_session,
                         url_for=lambda _ad: f"{BASE}/{pid}/").verify_gone(ad_number)


def liveness_controls(n: int, max_reads: int = 60, max_hours: int = 12) -> list[dict]:
    """fleet_liveness controls (CONTROL_POOLS): property offers posted in Haraj's newest COMPLETE hours
    whose own page reads live now. Fresh posts are alive almost always; a block or a redesign reads
    none live, so fewer than n come back and the run quarantines (fails closed).

    Walks back hour by hour (newest complete first, at most `max_hours` files, `max_reads` page reads
    in all) until n read live. One quiet hour is not a block: the 07:48 UTC daily run on 2026-10-18
    found 3 licensed-titled posts in the 06:00 hour, all 3 read live, and the gate (5 needed)
    quarantined 3,600 ads with every control it had alive, while 273 struck at 1 strike sat on screen.

    The read budget is 60 (was 20, 2026-10-19): since 10-17/10-18 the own-page reader calls a request,
    a catalogue, a deal conflict or an ended licence «gone», so most fresh tight-titled posts are honest
    non-offers. The 20:48 UTC recheck on 10-18 spent its 20 reads, found 3 live and 0 blocked, and
    quarantined 6,317 ads with 4 dead ones on screen at 2 strikes. A block still reads none live."""
    locs = hour_files()
    out: list[dict] = []
    reads = 0
    for u in reversed(locs[max(0, len(locs) - 1 - max_hours):-1]):
        for pid in ids_in(u, Counter(), tight=True):
            if reads >= max_reads:
                return out
            reads += 1
            if _verify_gone(f"{PREFIX}{pid}")[0] == "live":
                out.append({"ad_number": f"{PREFIX}{pid}", "listing_url": f"{BASE}/{pid}/"})
                if len(out) >= n:
                    return out
    return out


def _notes(c: Counter, unresolved: Counter, head: Optional[dict] = None) -> str:
    top = ", ".join(f"{k}×{v}" for k, v in unresolved.most_common(10))
    return json.dumps({**(head or {}), **dict(c), "district_unresolved_top": top}, ensure_ascii=False)[:1900]


# ── catch-up (owner 2026-10-17: «start with the ones with a licence»; 2026-10-25: every offer) ────────
# Every scheduled run, after the live hours, walks the OLDER hourly files Haraj still lists (~3 months),
# newest first, for a time budget: sharper title gate, the same map_post (licensed AND unlicensed offers,
# owner rule 10-17) and own-page gone banner. The cursor is the oldest finished file, kept in the run's
# own notes; a failed run never advances it, so the next one redoes those files (upserts are idempotent).
# 2026-10-25: the licensed-only walk finished at «catchup_before» 2026-07-20-00, having read every
# unlicensed offer and thrown it away. A NEW key restarts the walk from the live window for all offers;
# the old key is no longer read.
_STAMP = re.compile(r"sitemap-(\d{4}-\d{2}-\d{2}-\d{2})\.txt")
_CURSOR_KEY = "catchup_all_before"
_CURSOR = re.compile(r'"%s": "(\d{4}-\d{2}-\d{2}-\d{2})"' % _CURSOR_KEY)


def _stamp(u: str) -> str:
    m = _STAMP.search(u)
    return m.group(1) if m else ""


def last_catchup_cursor() -> Optional[str]:
    q = (db.sb().table("scrape_runs").select("notes").eq("platform", SLUG).eq("ok", True)
         .order("started_at", desc=True).limit(30))
    for r in db._execute(q, what="haraj catch-up cursor").data or []:
        m = _CURSOR.search(r.get("notes") or "")
        if m:
            return m.group(1)
    return None


def catchup(locs: list[str], live_files: list[str], budget_s: float, cursor: Optional[str], today: Any = None):
    """(res, com, counts, unresolved, head) for the hour files older than `cursor` (or than the live window)."""
    floor = cursor or (_stamp(live_files[0]) if live_files else "")
    older = [u for u in locs if _stamp(u) and _stamp(u) < floor]
    res: list[dict] = []
    com: list[dict] = []
    c, unresolved = Counter(), Counter()
    done, t0 = floor, time.time()
    for u in reversed(older):
        pre = Counter()
        try:
            ids = ids_in(u, pre, tight=True)
        except RuntimeError as e:          # a file Haraj does not serve: stop here, the cursor stays put
            c["catchup_file_error"] += 1
            print(f"  catch-up stopped: {e}", flush=True)
            break
        r, m, cc_, un, _ = crawl(0, 0, today=today, only=ids,
                                 meta={"files": [u], "prefiltered": dict(pre)})
        res += r
        com += m
        c.update(cc_)
        c.update(pre)
        unresolved.update(un)
        c["catchup_files"] += 1
        done = _stamp(u)
        if time.time() - t0 > budget_s:   # checked after a file: every run moves the cursor at least one file
            break
    left = sum(1 for u in older if _stamp(u) < done)
    return res, com, c, unresolved, {_CURSOR_KEY: done, "catchup_files_left": left,
                                     "catchup_stored": len(res) + len(com)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", type=int, default=2, help="complete hourly sitemap files to read")
    ap.add_argument("--skip-hours", type=int, default=0, help="skip the newest N complete hours")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--ids", default="", help="re-read exactly these post ids (comma list) instead of the sitemap — a parser repair")
    ap.add_argument("--catchup-minutes", type=float, default=0,
                    help="after the live hours, walk older hour files for offers this long (0 = off)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    try:
        only = [i.strip().removeprefix(PREFIX) for i in a.ids.split(",") if i.strip()]
        res, com, c, unresolved, meta = crawl(a.files, a.skip_hours, a.limit, only=only or None)
        head: dict = {}
        if a.catchup_minutes > 0 and not only and not a.limit:
            cres, ccom, cc_, cun, head = catchup(meta["locs"], meta["files"], a.catchup_minutes * 60,
                                                 None if a.dry_run else last_catchup_cursor())
            res, com = res + cres, com + ccom
            c.update({f"catchup_{k}" if not k.startswith(("catchup", "title_")) else k: v for k, v in cc_.items()})
            unresolved.update(cun)
            print(f"  catch-up: {head}", flush=True)
        print(f"  counts: {_notes(c, unresolved, head)}", flush=True)
        if a.dry_run:
            for row in (res + com)[:20]:
                print("   ", json.dumps({k: row.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "price_total", "price_annual",
                    "price_per_meter", "rent_period", "city_ar", "district_ar", "area_m2", "license_number",
                    "license_expiry", "direction", "street_width_m", "property_age")}, ensure_ascii=False, default=repr), flush=True)
            return 0
        db.upsert_haraj_residential_batch(res)
        db.upsert_haraj_commercial_batch(com)
        db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                      com_ads={r["ad_number"] for r in com}, source=SOURCE)
        # A stream: NO absence prune (an ad missing from these hours is not gone). Removal = own-page proof:
        # strike_read_gone reads the oldest-seen stored ads' OWN pages through _verify_gone and hands the same
        # verify_gone= to db.prune_unseen for ONLY the ones that read gone (3 strikes, collapse cap kept);
        # fleet_liveness reads every active row daily with the same oracle.
        if not a.limit and not only:
            seen = {r["ad_number"] for r in res + com}     # empty → strike_read_gone reads nothing (no control)
            for tbl in (RES_TABLE, COM_TABLE):
                db.strike_read_gone(tbl, seen, SOURCE, verify_gone=_verify_gone, max_reads=30)
        healthy = db.end_run(run_id, ok=True, rows_seen=c["fetched"], rows_upserted=len(res) + len(com),
                             notes=_notes(c, unresolved, head),
                             check_tables=["haraj_residential_listings", "haraj_commercial_listings"])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial offers upserted", flush=True)
        return 0 if healthy else 1
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
