"""Haraj (haraj.com.sa) LIVE ingest — LICENSED property OFFERS only (owner 2026-10-16, backlog 311).

The owner: «Haraj is public, like Facebook Marketplace»: a post becomes a listing ONLY when ALL hold
  1. it carries the حراج العقار tag (the site's own real-estate section);
  2. scrapers/haraj/classify.py says «offer» — a request («مطلوب», «ابغى»), a non-property post (jobs,
     cars, furniture, «تقبيل», broker catalogues) and a doubt are NEVER stored;
  3. it carries REGA's ad-licence block «معلومات العقار حسب الرخصة» (parse.py) — no licence, however
     clear the offer, is never a listing;
  4. that licence's own «تاريخ انتهاء رخصة الإعلان» has not passed (normalize.ad_expiry_state).
Everything the licence block and the ad's own words state is kept (parse.py; silent → NULL), in Arabic,
the city/district through the SHARED catalogue resolver (deed lines first; an unresolved district is
NULL and its raw spelling is kept in additional_info.district_raw_ar).

DISCOVERY. Haraj's sitemap index lists one .txt file per HOUR of new/updated posts (every category,
~4,400 an hour). The URL slug is the post's own title, so a property word in it picks the candidates
(shadow.property_slug_ids); a title the classifier already calls a request/non-property is not fetched.
This is a STREAM, not a catalogue: an ad missing from tonight's files is not gone (no absence prune,
ever). REMOVAL is own-page proof only: `_verify_gone` (404/410, «العرض محذوف او قديم», the licence
block gone from its own page, or its licence expired) — read daily by scrapers/common/fleet_liveness.py.

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
from collections import Counter
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import REGION_EN_TO_ID, catalog_district, resolve  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402
from scrapers.haraj import parse as P  # noqa: E402
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
    t = (text or "").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    for m in _NUMS.finditer(t):
        if N.to_int(m.group(0)) != price:
            continue
        near = t[max(0, m.start() - 30): m.end() + 15]
        return "per_meter" if _PER_M_WORDS.search(near) else "total"
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


def map_post(pid: str, ld: dict, page_html: str, verdict: str, why: str, today: Any = None
             ) -> tuple[Optional[dict], str, str, dict]:
    """(row, category, skip_reason, facts). row is None exactly when the post must not be a listing."""
    p = P.parse_post(ld, page_html)
    facts = {"district_raw_ar": p["district_ar"], "city_raw_ar": p["city_ar"]}
    if verdict != "offer":
        return None, "", f"not_offer_{verdict}", facts
    if not p["rega_block"]:
        return None, "", "no_licence_block", facts
    state = N.ad_expiry_state(p["licence_expiry"], today)
    if state == "expired":
        return None, "", "licence_expired", facts
    if not p["deal"]:
        return None, "", "deal_unstated", facts
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
        **N.prose_amenities_yes(f"{title}\n{free_text}", skip=tuple(services)),
        **services,
        "property_type": ptype,
        "transaction_type": "Rent" if p["deal"] == "Rent" else "Buy",   # deal is validated above
        "city": N.map_city(p["city_ar"]),
        "region": N.region_for_city(N.map_city(p["city_ar"])),
        "city_ar": p["city_ar"],
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": p["district_ar"] if district else None,
        "neighborhood": p["district_ar"] if district else None,
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


def _has_tag(h: str) -> bool:
    return TAG in h or quote(TAG) in h


def read_post(pid: str) -> tuple[int, str]:
    return fetch(f"{BASE}/{pid}/")


def candidate_ids(files: int, skip_hours: int) -> tuple[list[str], dict]:
    """Post ids of the last `files` COMPLETE hourly sitemap files (the newest file, still filling, is
    skipped), property-titled, newest first; titles the classifier already rejects are not fetched."""
    st, sm = fetch(f"{BASE}/sitemap.xml")
    if st != 200:
        raise RuntimeError(f"sitemap.xml answered {st}")
    locs = re.findall(r"<loc>([^<]+)</loc>", sm)
    end = len(locs) - 1 - skip_hours
    picked = locs[max(0, end - files):end]
    ids: list[str] = []
    pre = Counter()
    for u in picked[::-1]:
        st2, t = fetch(u)
        if st2 != 200:
            raise RuntimeError(f"sitemap file {u} answered {st2}")
        titles = {m.group(1): unquote(m.group(2)).replace("_", " ") for m in _POST_RE.finditer(t)}
        for i in property_slug_ids(t):
            if i in ids:
                continue
            v, _ = classify(titles.get(i), None)
            if v in ("request", "other"):
                pre[f"title_{v}"] += 1
                continue
            ids.append(i)
    return ids, {"files": picked, "prefiltered": dict(pre)}


def crawl(files: int, skip_hours: int, limit: int = 0, today: Any = None):
    ids, meta = candidate_ids(files, skip_hours)
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
        if DELETED_MARK in h and "RealEstateListing" not in h:
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
        if not row.get("license_number"):
            c["stored_without_licence_number"] += 1
        if not facts.get("district_resolved"):
            c["district_unresolved"] += 1
            if facts.get("district_raw_ar"):
                unresolved[f"{facts.get('city_raw_ar')} / {facts['district_raw_ar']}"] += 1
        if row.get("additional_info", {}).get("latitude") is not None:
            c["with_pin"] += 1
        (com if cat == "commercial" else res).append(row)
    c["stored"] = len(res) + len(com)
    return res, com, c, unresolved


# ── removal: own-page proof only (fleet_liveness reads this daily) ─────────────────────────────
def _signal(status, body, moved):
    if status in (404, 410) and not moved:
        return "gone"
    if status != 200 or not body:
        return None
    if DELETED_MARK in body and "RealEstateListing" not in body:
        return "gone"                       # the post's own page: «العرض محذوف او قديم»
    ld = P.ld_listing(body)
    if not ld:
        return None
    desc = _html.unescape(ld.get("description") or "")
    if P.LICENCE_HEAD not in desc:
        return "gone"                       # no licence on its own page any more: never a listing
    if N.ad_expiry_state(P.licence_expiry(desc)) == "expired":
        return "gone"                       # its own licence has ended
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


def _notes(c: Counter, unresolved: Counter) -> str:
    top = ", ".join(f"{k}×{v}" for k, v in unresolved.most_common(10))
    return json.dumps({**dict(c), "district_unresolved_top": top}, ensure_ascii=False)[:1900]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", type=int, default=2, help="complete hourly sitemap files to read")
    ap.add_argument("--skip-hours", type=int, default=0, help="skip the newest N complete hours")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    try:
        res, com, c, unresolved = crawl(a.files, a.skip_hours, a.limit)
        print(f"  counts: {_notes(c, unresolved)}", flush=True)
        if a.dry_run:
            for row in (res + com)[:20]:
                print("   ", json.dumps({k: row.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "price_total", "price_annual",
                    "price_per_meter", "rent_period", "city_ar", "district_ar", "area_m2", "license_number",
                    "license_expiry", "direction", "street_width_m", "property_age")}, ensure_ascii=False), flush=True)
            return 0
        db.upsert_haraj_residential_batch(res)
        db.upsert_haraj_commercial_batch(com)
        db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                      com_ads={r["ad_number"] for r in com}, source=SOURCE)
        # A stream: NO absence prune (an ad missing from these hours is not gone). Removal = own-page proof:
        # strike_read_gone reads the oldest-seen stored ads' OWN pages through _verify_gone and hands the same
        # verify_gone= to db.prune_unseen for ONLY the ones that read gone (3 strikes, collapse cap kept);
        # fleet_liveness reads every active row daily with the same oracle.
        if not a.limit:
            seen = {r["ad_number"] for r in res + com}     # empty → strike_read_gone reads nothing (no control)
            for tbl in (RES_TABLE, COM_TABLE):
                db.strike_read_gone(tbl, seen, SOURCE, verify_gone=_verify_gone, max_reads=30)
        healthy = db.end_run(run_id, ok=True, rows_seen=c["fetched"], rows_upserted=len(res) + len(com),
                             notes=_notes(c, unresolved),
                             check_tables=["haraj_residential_listings", "haraj_commercial_listings"])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial licensed offers upserted", flush=True)
        return 0 if healthy else 1
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
