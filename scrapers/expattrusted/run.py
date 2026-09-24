"""Expat Trusted Housing — expattrustedhousingriyadh.com. Expat compounds, RENT only. Onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24, every number below from a real fetch):
  · ENUMERATION: /sitemap.xml lists 351 <loc>, of which 301 are /p/<locale>/property/<slug> for the
    SAME 43 compounds repeated across 7 locales (en/de/es/fr/it/pt/tr — there is NO Arabic locale).
    Only the /p/en/ entries are enumerated. The <loc> values are SCHEME-LESS
    («expattrustedhousingriyadh.com/p/en/property/al-hamra»), so the scheme is prefixed here.
  · A COMPOUND PAGE IS NOT ONE LISTING. It is Next.js SSR; the raw HTML carries a
    <script id="__NEXT_DATA__"> whose props.pageProps.property holds the compound and its
    `residences` — the UNIT TYPES. Owner rule for compound sites: EACH UNIT TYPE is one listing,
    ad_number = prefix + compound slug + the source's residence id, listing_url = the compound page.
    Measured: 43 compounds, 55 residences on 16 of them; 27 compounds publish no residence at all
    (they yield no row — a compound without a unit type has no type, no rooms and no price).
  · PRICE lives ONLY in the JSON: residence.pricing = [{low, high, currency:"SAR", duration:"Year"}].
    30 of 55 residences are priced, all SAR/Year; 12 have low == high, 18 are a RANGE. The rendered
    page prints a range as «SAR 194,000 + per year» — the LOW figure with a plus — so price_annual
    is `low` (exactly the printed figure) and `high` is archived in additional_info.price_high_annual.
    An empty pricing list renders «Contact for pricing» → price NULL, never guessed.
    duration "Year" is the source's own period word → rent_period = "annual".
  · NEIGHBOUR CONTAMINATION TRAP: pageProps.recommendations embeds OTHER compounds with THEIR
    residences and pricing (al-hamra's page carries al-bustan-village's 205,000/Year). A regex over
    the whole HTML for «pricing» attributes another compound's price to this one — the verifier's
    probe did exactly that. Only pageProps.property is ever read.
  · RENDERED-TEXT TRAP: in the DOM the price label sits ABOVE the unit name, so the visible text
    order is «Contact for pricing · 1 Bedroom Apartment · SAR 194,000 + per year · 2 Bedroom …» —
    pairing label-after-name mis-prices every unit by one row. The JSON pairs them explicitly.
  · FIELDS: bedrooms / fullBathrooms are WORDS («three»); area is present on 8/55 (sqm);
    halfBathrooms is null on all 55. The residence `name` carries the type («2 Bedroom Villa»,
    «Studio Apartment», «3 Bedroom Townhouse»); names with no type word («3 Bedroom», «Single Room
    Suite», «Family Double Room», «2 Bedroom Bungalow») are skipped type_unmapped, not guessed.
  · LOCATION: `address` is free text («Ash Shuhada, Riyadh 13241, Saudi Arabia»). The city is the
    English city word in the address, else the compound's own description (andorra-village states
    «northeast Riyadh» only there); no city anywhere (al-yasmin-compound) → skipped, never defaulted.
    40 Riyadh, 2 Jeddah, 2 Diriyah, 1 Madinah. The district is the address segment before the city,
    mapped through a closed English→Arabic table and then ATTESTED by find_district_in_text against
    THAT city's catalog (antara-living's «Ar Rihab, Diriyah» stays NULL — الرحاب is a Riyadh district).
    Three addresses carry Arabic «حي X» tokens — those are attested directly. The whole address is
    NEVER fed to find_district_in_text: «وادي الليسن, حي الرفيعة» came back as حي الوادي.
  · FEATURES: featureType "home" (Furnished, Air Conditioner, Reserved Parking, Terrace…) describes
    the units → amenity columns; featureType "building" (pool, gym, «Shaded Parking Area») is the
    compound's → archived as compound_facilities_en, parking being the only column it feeds.
    «Laundry Service» (9 compounds) is a service, not a laundry room: never laundry_room=True.
  · PII: property.propertyEmail / propertyPhoneNumber / propertyWhatsApp are never read; the
    description passes through redact_pii.
  · PHOTOS: images[].image.data.attributes.url — absolute https://assetservices.imgix.net/… JPEG
    (fetched one: 200 image/jpeg, 42 KB).
  · REMOVAL ORACLE: an unknown slug answers a REAL HTTP 404 with no `property` in pageProps —
    measured on 3 invented slugs (404, 404, 404) against 43 live compounds (200 + property, 43/43).
    A unit type is also gone when its compound is live but its id is no longer in `residences`.
    Prune runs only after a complete enumeration and through LivenessProbe with an in-run positive
    control (the first row of this run must probe live), so a blocked transport fails CLOSED.
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

BASE = "https://expattrustedhousingriyadh.com"
SOURCE = "Expat Trusted Housing"
PREFIX = "ETH"
PAUSE = 0.6


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.8"})
    return s


# ── location ─────────────────────────────────────────────────────────────────────────────────────
_CITY_EN_AR = {
    "riyadh": "الرياض", "diriyah": "الدرعية", "jeddah": "جدة", "madinah": "المدينة المنورة",
    "medina": "المدينة المنورة", "dammam": "الدمام", "khobar": "الخبر",
}
_CITY_RE = re.compile(r"\b(" + "|".join(_CITY_EN_AR) + r")\b", re.I)

# Normalised English district → the Arabic candidate. Closed; every value is still attested by
# find_district_in_text against the compound's own city before it is written.
_DISTRICT_EN_AR = {
    "arid": "حي العارض", "aarid": "حي العارض", "safarat": "حي السفارات", "shuhada": "حي الشهداء",
    "qurtubah": "حي قرطبة", "qurtuba": "حي قرطبة", "hamra": "حي الحمراء", "munsiyah": "حي المونسية",
    "saadah": "حي السعادة", "olaya": "حي العليا", "malqa": "حي الملقا", "malga": "حي الملقا",
    "yasmin": "حي الياسمين", "yasmeen": "حي الياسمين", "alyasmeen": "حي الياسمين",
    "rimal": "حي الرمال", "rihab": "حي الرحاب", "mursilat": "حي المرسلات", "hada": "حي الهدا",
    "ghirnatah": "حي غرناطة", "granada": "حي غرناطة", "mathar ash shamali": "حي المعذر الشمالي",
    "rahmaniyyah": "حي الرحمانية", "rahmaniyah": "حي الرحمانية", "ishbiliyah": "حي اشبيلية",
    "ishbilia": "حي اشبيلية", "rabi": "حي الربيع", "narjis": "حي النرجس", "shati": "حي الشاطئ",
    "janadriyah": "حي الجنادرية", "janadriyyah": "حي الجنادرية", "qirawan": "حي القيروان",
    "qairawan": "حي القيروان", "uyun": "حي العيون", "khuzama": "حي الخزامى",
}
_STREET_WORDS_RE = re.compile(r"\b(street|st|rd|road|exit|way|highway|hwy|branch)\b", re.I)
_AR_DISTRICT_RE = re.compile(r"حي\s+([ء-ي]+)")


def _norm_dist(seg: str) -> str:
    n = re.sub(r"\b(district|dist)\b", " ", seg.lower())
    n = re.sub(r"[^a-z]+", " ", n)
    n = re.sub(r"^\s*(?:al|an|ar|as|ash|ath|ad)\s+", "", n.strip())
    return re.sub(r"\s+", " ", n).strip()


def _dist_key(norm: str) -> Optional[str]:
    toks = norm.split()
    for key in _DISTRICT_EN_AR:
        kt = key.split()
        if any(toks[i:i + len(kt)] == kt for i in range(len(toks))):
            return key
    return None


def location(address: Optional[str], description: Optional[str]) -> dict[str, Any]:
    """city_ar / city_id / region_id / district_ar / neighborhood / zip_code, or {} when the source
    names no city. The address decides; the description is only a city fallback."""
    address = address or ""
    m = _CITY_RE.search(address) or _CITY_RE.search(description or "")
    if not m:
        return {}
    city_ar = _CITY_EN_AR[m.group(1).lower()]
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return {}
    out: dict[str, Any] = {"city_ar": city_ar, "city_id": city_id, "region_id": region_id,
                           "district_ar": None, "neighborhood": None, "zip_code": None}
    pm = re.search(r"\b([1-9]\d{4})\b", address)
    if pm:
        out["zip_code"] = pm.group(1)
    am = _AR_DISTRICT_RE.search(address)
    if am:
        cand = f"حي {am.group(1)}"
        out["district_ar"] = find_district_in_text(cand, city_id)
        out["neighborhood"] = cand if out["district_ar"] else None
        return out
    for seg in reversed(re.split(r"[,،–]|\s-\s|-(?=[A-Z])", address)):
        seg = seg.strip()
        if not seg or _CITY_RE.search(seg) or _STREET_WORDS_RE.search(seg):
            continue
        key = _dist_key(_norm_dist(seg))
        if key:
            attested = find_district_in_text(_DISTRICT_EN_AR[key], city_id)
            if attested:
                out["district_ar"], out["neighborhood"] = attested, seg
            break
    return out


# ── residence (unit type) ────────────────────────────────────────────────────────────────────────
_TYPE_WORD_AR = [("studio", "استوديو"), ("apartment", "شقة"), ("townhouse", "فيلا"), ("villa", "فيلا")]
_WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
             "eight": 8, "nine": 9, "ten": 10}


def _count(v: Any) -> Optional[int]:
    if v is None:
        return None
    s = str(v).strip().lower()
    return _WORD_NUM.get(s, normalize.to_int(s))


def type_ar_for(name: Optional[str]) -> Optional[str]:
    low = (name or "").lower()
    for word, ar in _TYPE_WORD_AR:
        if re.search(rf"\b{word}\b", low):
            return ar
    return None


def price_from_pricing(pricing: Any) -> tuple[Optional[int], Optional[str], dict[str, Any]]:
    """(price_annual, rent_period, extra) exactly as the source states it. Empty → NULL («Contact
    for pricing»). Anything not SAR-per-Year is archived raw, never converted."""
    if not pricing:
        return None, None, {}
    p = pricing[0]
    low, high = normalize.to_int(p.get("low")), normalize.to_int(p.get("high"))
    if p.get("currency") != "SAR" or p.get("duration") != "Year" or low is None:
        return None, None, {"pricing_raw": pricing}
    extra: dict[str, Any] = {}
    if high is not None and high != low:
        extra["price_high_annual"] = high
    if len(pricing) > 1:
        extra["pricing_raw"] = pricing
    return low, "annual", extra


def property_from_html(page_html: str) -> Optional[dict]:
    """pageProps.property ONLY — recommendations carry other compounds' prices (see header)."""
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page_html or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("property")
    except (ValueError, AttributeError):
        return None


def photos(prop: dict) -> Optional[list[str]]:
    urls: list[str] = []
    primary = ((prop.get("primaryCardPhoto") or {}).get("data") or {}).get("attributes") or {}
    if primary.get("url"):
        urls.append(primary["url"])
    for im in prop.get("images") or []:
        u = (((im.get("image") or {}).get("data") or {}).get("attributes") or {}).get("url")
        if u:
            urls.append(u)
    urls = [u for u in dict.fromkeys(urls) if u.startswith("https://")]
    return urls[:20] or None


def map_listing(prop: dict, res: dict, url: str, loc: dict) -> tuple[Optional[dict], Optional[str], Optional[str]]:
    """(row, category, skip_reason) for ONE residence (unit type) of a compound."""
    rid = res.get("id")
    if rid is None:
        return None, None, "residence_without_id"
    type_ar = type_ar_for(res.get("name"))
    property_type = normalize.map_type_exact(type_ar) if type_ar else None
    if not property_type:
        return None, None, "type_unmapped"
    if not loc:
        return None, None, "city_not_stated"
    # A residential compound's unit types are residential by construction (azure and rightcompound
    # write their residential table only). The fleet routes the raw «Studio» commercial — the 2026-09-24
    # first crawl filed 3 «Studio Apartment» types commercial and collided with the compound URL's
    # residential rows (url_collision_res_vs_com) — so the category is fixed here, never derived.
    category = "residential"
    price, period, extra = price_from_pricing(res.get("pricing"))

    features = [f.get("attributes") or {} for f in (prop.get("features") or {}).get("data") or []]
    home = ", ".join(f["name"] for f in features if f.get("featureType") == "home" and f.get("name"))
    building = ", ".join(f["name"] for f in features if f.get("featureType") == "building" and f.get("name"))
    compound_name = prop.get("name") or prop.get("title")

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}-{prop.get('slug')}-{rid}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "title": " – ".join(x for x in (compound_name, res.get("name")) if x) or None,
        "description": redact_pii(prop.get("description")),
        "property_type": property_type,
        "transaction_type": "Rent",
        "city": normalize.map_city(loc["city_ar"]),
        "city_ar": loc["city_ar"],
        "city_id": loc["city_id"],
        "region_id": loc["region_id"],
        "district_ar": loc["district_ar"],
        "neighborhood": loc["neighborhood"],
        "zip_code": loc["zip_code"],
        "bedrooms": _count(res.get("bedrooms")),
        "bathrooms": _count(res.get("fullBathrooms")),
        "area_m2": normalize.to_int(res.get("area")) if res.get("areaUnit") in (None, "sqm") else None,
        "price_annual": price,
        "rent_period": period,
        "photo_urls": photos(prop),
        "additional_info": {k: v for k, v in {
            "compound": compound_name, "compound_slug": prop.get("slug"), "residence_id": rid,
            "unit_type_en": res.get("name"), "unit_description": redact_pii(res.get("description")),
            "latitude": prop.get("latitude"), "longitude": prop.get("longitude"),
            "home_features_en": home or None, "compound_facilities_en": building or None,
            "area_unit": res.get("areaUnit"), **extra,
        }.items() if v is not None},
    }
    # "home" features are the units' own statement → columns (silence stays NULL). «Laundry
    # Service» is a SERVICE, not a laundry room — amenities_from_text would read it as one, so it
    # is stripped first (measured: 9 compounds publish it; none says "laundry room").
    row.update(normalize.amenities_from_text(re.sub(r"(?i)laundry service", "", home)))
    if re.search(r"parking", building, re.I):
        row["parking"] = True   # a compound car park is shared by every unit in it
    return row, category, None


def map_compound(prop: dict, url: str) -> tuple[list[tuple[dict, str]], dict[str, int]]:
    rows: list[tuple[dict, str]] = []
    skipped: dict[str, int] = {}
    residences = prop.get("residences") or []
    if not residences:
        return rows, {"compound_without_unit_types": 1}
    loc = location(prop.get("address"), prop.get("description"))
    for res in residences:
        row, cat, why = map_listing(prop, res, url, loc)
        if row:
            rows.append((row, cat))
        else:
            skipped[why] = skipped.get(why, 0) + 1
    return rows, skipped


# ── enumeration + oracle ─────────────────────────────────────────────────────────────────────────
def fetch_slugs(s: cc.Session, limit: int = 0) -> list[str]:
    r = s.get(f"{BASE}/sitemap.xml", timeout=40)
    if r.status_code != 200:
        return []
    slugs = sorted({m.group(1) for m in re.finditer(r"/p/en/property/([a-z0-9-]+)", r.text)})
    return slugs[:limit] if limit else slugs


def compound_url(slug: str) -> str:
    return f"{BASE}/p/en/property/{slug}"


def _signal_for(rid: str):
    def _signal(status, body, _moved):
        if status == 404:
            return "gone"
        if status != 200:
            return None
        prop = property_from_html(body)
        if not prop:
            return None           # a 200 without the page JSON is an unreadable answer, not a death
        return "live" if rid in {str(r.get("id")) for r in prop.get("residences") or []} else "gone"
    return _signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None) -> tuple[str, str]:
        m = re.fullmatch(rf"{PREFIX}-([a-z0-9-]+)-(\d+)", ad_number or "")
        if not m:
            return "unknown", f"{ad_number!r} is not a {PREFIX}-<compound slug>-<residence id> ad number"
        slug, rid = m.group(1), m.group(2)
        return LivenessProbe(platform="expattrusted", signal=_signal_for(rid), session=session,
                             url_for=lambda _ad: compound_url(slug), canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("expattrusted")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        slugs = fetch_slugs(s, limit=args.limit)
        if not slugs:
            raise RuntimeError("sitemap returned no /p/en/property/ slugs")
        print(f"{SOURCE}: {len(slugs)} compounds discovered", flush=True)
        complete = not args.limit
        for slug in slugs:
            url = compound_url(slug)
            try:
                r = s.get(url, timeout=45)
            except Exception:
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                complete = False
                continue
            time.sleep(PAUSE)
            if r.status_code == 404:
                skipped["http_404"] = skipped.get("http_404", 0) + 1
                continue
            prop = property_from_html(r.text) if r.status_code == 200 else None
            if not prop:
                skipped[f"http_{r.status_code}_unreadable"] = skipped.get(f"http_{r.status_code}_unreadable", 0) + 1
                complete = False
                continue
            rows, why = map_compound(prop, url)
            for k, v in why.items():
                skipped[k] = skipped.get(k, 0) + v
            for row, cat in rows:
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written; complete={complete})")
            for r0 in (res + com)[:60]:
                print(f"   {r0['ad_number']:38} {str(r0['property_type']):10} {str(r0['city_ar']):9} "
                      f"d={str(r0['district_ar'])[:14]:14} bd={str(r0['bedrooms']):>4} ba={str(r0['bathrooms']):>4} "
                      f"a={str(r0['area_m2']):>4} pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # Public upsert_expattrusted_*_batch wrappers are added centrally later; the shared batch
        # writer is the same function they will call.
        db._wasalt_batch("expattrusted_residential_listings", res)
        db._wasalt_batch("expattrusted_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="expattrusted_residential_listings",
            com_table="expattrusted_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("expattrusted_residential_listings", res),
                              ("expattrusted_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(slugs),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["expattrusted_residential_listings",
                                           "expattrusted_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
