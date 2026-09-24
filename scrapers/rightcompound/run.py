"""RightCompound — rightcompound.com. A directory of residential compounds for rent. Onboarding
2026-09-24 (batch 36, group compounds-a).

SOURCE SHAPE (measured live 2026-09-24, nothing below is assumed):
  · CATALOGUE: /sitemap.xml lists 322 URLs; 254 are compound detail pages of the shape
    /compounds/<city-slug>/<compound-slug> (the other 11 under /compounds/ are the hub and ten city
    index pages). The site's own JSON API /api/v1/compounds answers "total":254 — that counter is the
    completeness check, printed beside the sitemap count on every run. The API detail record
    (/api/v1/compounds/<slug>) carries NO units, so the units are read from the HTML page.
  · GRAIN: a compound page is NOT one listing. «Available Units» is a <ul class="rc-cd-units"> of
    <li class="rc-cd-unit"> blocks, each with its own name, «N Bedrooms», «N Bathrooms», «N sqm»,
    a price div «Rent - (SR)247,000» and a contact button carrying data-villa-id="629"
    data-is-available="True". Azure Alreem (Riyadh) publishes 14 such units at 72,000–320,000. The
    ROW GRAIN IS THE UNIT and ad_number = "RCP" + the source's own villa id (owner decision for
    compound sites, 2026-09-24); listing_url = the compound page, which is where a user lands and
    sees that unit.
  · PERIOD: the unit price carries no period word of its own. The platform states it, in its own
    machine-readable words: /api/v1/compounds answers "rentPeriod":"year" and publishes
    minAnnualRentSar/maxAnnualRentSar; /llms.txt says «Prices are ANNUAL rent in Saudi Riyals (SAR),
    not monthly». That is the source's statement about every price it prints, so rent_period is
    'annual' and the figure is stored unconverted in price_annual. A price whose label is not
    «Rent» (none seen in 254 pages, guarded anyway) is skipped as deal_not_rent — never parked.
  · AREA: «300 sqm» is m². Star Compound prints «245 sqf» — a different unit (or a typo), which is
    not converted or guessed: area_m2 NULL, the raw text kept in additional_info.area_raw.
  · LANGUAGE: English only. hreflang="ar" points at the same URL and Accept-Language: ar still
    serves English (measured). Types and cities map to the Arabic canon; the district is written
    only when the English name maps with certainty to a catalogued Arabic district of the same
    city (compoundin precedent), otherwise district_ar stays NULL and the raw English sits in
    `neighborhood`.
  · LOCATION: the city is the URL's own path segment (also the BreadcrumbList item 3). The
    district is the JSON-LD streetAddress («Near Al Thoumamah Rd. Al Munsiyah, Riyadh») or the
    description's «… Al Munsiyah District …». /compounds/al-qaseem/* names a REGION, which
    to_catalog cannot place as a city → skipped city_not_in_catalog, never defaulted.
  · PHOTOS: gallery <img src=…/videos/<id>/t/<hash>.jpg data-orig=…/images/Common/Images/Compound/
    <id>/<hash>.jpeg> on rightcompoundimages.blob.core.windows.net; data-orig is the full-size file.
    Fetched one: HTTP 200 image/jpeg.
  · REMOVAL ORACLE (measured 2026-09-24): a compound that does not exist answers a REAL HTTP 404
    (3/3 invented slugs across riyadh/jeddah/khobar → 404, 37,821-byte «We could not find that
    page» shell; 2/2 live controls → 200 with their unit list). A unit is read only from the
    compound's own page, so a unit is gone when its compound 404s, or when the compound page is
    served (200, unit card present) and its villa id is no longer listed / is data-is-available=
    "False". prune_unseen runs only after a COMPLETE enumeration (every sitemap compound fetched,
    none unreachable) and every removal is re-probed through the shared liveness law with an
    in-run positive control that fails CLOSED. Absence from the sitemap alone is never death.
  · PDPL: no phone/email/agent name is printed on a compound page; description is redacted anyway.
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
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://rightcompound.com"
SOURCE = "RightCompound"
PREFIX = "RCP"
PAUSE = 0.8  # seconds between page fetches — a directory of 254 pages, walked politely


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "text/html,application/xhtml+xml,application/json;q=0.9",
                      "Accept-Language": "ar,en;q=0.7"})
    return s


# URL city slug → the Arabic name the catalog knows. Closed: the site's /api/v1/cities lists them.
_CITY_SLUG_AR = {
    "riyadh": "الرياض", "jeddah": "جدة", "khobar": "الخبر", "dammam": "الدمام",
    "jubail": "الجبيل", "dhahran": "الظهران", "taif": "الطائف", "yanbu": "ينبع",
    "al-ahsaa": "الأحساء", "kamis-mushait": "خميس مشيط", "al-qaseem": "القصيم",
}

# English district → Arabic, accepted ONLY where the transliteration is unambiguous. Every value is
# still put through find_district_in_text() against THIS city's catalog, so an uncatalogued name
# writes NULL. Keyed on _norm_dist() output (lowercase, «District» dropped, al-/an-/ar-/as- folded).
_DISTRICT_EN_AR = {
    ("riyadh", "olaya"): "حي العليا", ("riyadh", "malqa"): "حي الملقا",
    ("riyadh", "narjis"): "حي النرجس", ("riyadh", "hittin"): "حي حطين",
    ("riyadh", "yasmin"): "حي الياسمين", ("riyadh", "yasmeen"): "حي الياسمين",
    ("riyadh", "sahafah"): "حي الصحافة", ("riyadh", "nakheel"): "حي النخيل",
    ("riyadh", "muhammadiyah"): "حي المحمدية", ("riyadh", "rabi"): "حي الربيع",
    ("riyadh", "wadi"): "حي الوادي", ("riyadh", "ghadir"): "حي الغدير",
    ("riyadh", "ghadeer"): "حي الغدير", ("riyadh", "izdihar"): "حي الازدهار",
    ("riyadh", "murabba"): "حي المربع", ("riyadh", "arid"): "حي العارض",
    ("riyadh", "munsiyah"): "حي المونسية", ("riyadh", "qairawan"): "حي القيروان",
    ("riyadh", "rawdah"): "حي الروضة", ("riyadh", "saadah"): "حي السعادة",
    ("riyadh", "dhubbat"): "حي الضباط", ("riyadh", "sulimaniyah"): "حي السليمانية",
    ("riyadh", "sulaimaniyah"): "حي السليمانية", ("riyadh", "qurtubah"): "حي قرطبة",
    ("riyadh", "safa"): "حي الصفا", ("riyadh", "rabwah"): "حي الربوة",
    ("riyadh", "hamra"): "حي الحمراء", ("riyadh", "diriyah"): "حي الدرعية",
    ("riyadh", "nada"): "حي الندى", ("riyadh", "aqiq"): "حي العقيق",
    ("riyadh", "wurud"): "حي الورود", ("riyadh", "mursalat"): "حي المرسلات",
    ("riyadh", "khuzama"): "حي الخزامى", ("riyadh", "umm al hamam"): "حي أم الحمام",
    ("riyadh", "sahafa"): "حي الصحافة", ("riyadh", "maather"): "حي المعذر",
    ("riyadh", "rimal"): "حي الرمال", ("riyadh", "qadisiyah"): "حي القادسية",
    ("riyadh", "nasim"): "حي النسيم", ("riyadh", "salam"): "حي السلام",
    ("jeddah", "shatie"): "حي الشاطئ", ("jeddah", "shati"): "حي الشاطئ",
    ("jeddah", "shatea"): "حي الشاطئ", ("jeddah", "rawdah"): "حي الروضة",
    ("jeddah", "hamra"): "حي الحمراء", ("jeddah", "zahra"): "حي الزهراء",
    ("jeddah", "salamah"): "حي السلامة", ("jeddah", "khalidiyah"): "حي الخالدية",
    ("jeddah", "basateen"): "حي البساتين", ("jeddah", "muhammadiyah"): "حي المحمدية",
    ("jeddah", "naeem"): "حي النعيم", ("jeddah", "nahdah"): "حي النهضة",
    ("jeddah", "safa"): "حي الصفا", ("jeddah", "andalus"): "حي الأندلس",
    ("jeddah", "faisaliyah"): "حي الفيصلية", ("jeddah", "obhur"): "حي أبحر الشمالية",
    ("khobar", "rakah"): "حي الراكة", ("khobar", "aqrabiyah"): "حي العقربية",
    ("khobar", "thuqbah"): "حي الثقبة", ("khobar", "yarmouk"): "حي اليرموك",
    ("khobar", "hizam al dhahabi"): "حي الحزام الذهبي", ("khobar", "olaya"): "حي العليا",
    ("khobar", "rawabi"): "حي الروابي", ("khobar", "khuzama"): "حي الخزامى",
    ("dammam", "shati"): "حي الشاطئ", ("dammam", "faisaliyah"): "حي الفيصلية",
    ("dhahran", "doha"): "حي الدوحة", ("dammam", "doha"): "حي الدوحة",
    ("jubail", "fanateer"): "حي الفناتير", ("jubail", "deffi"): "حي الدفي",
    ("al-ahsaa", "salam"): "حي السلام",
}


def _norm_dist(name: Optional[str]) -> Optional[str]:
    """«Al Munsiyah District» / «An Narjis» / «Al-Arid» → «munsiyah» / «narjis» / «arid»."""
    if not name:
        return None
    n = re.sub(r"\bdistrict\b", " ", name.strip().lower())
    n = re.sub(r"[^a-z\s-]", " ", n)
    n = re.sub(r"^\s*(?:al|an|ar|as|ad|ash|at)[\s-]+", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n or None


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


_UNIT_RE = re.compile(r'<li class="rc-cd-unit">(.*?)</li>', re.S)
_NAME_RE = re.compile(r'rc-cd-unit__name">(.*?)</div>', re.S)
_META_RE = re.compile(r'rc-cd-unit__meta">(.*?)</div>', re.S)
_PRICE_RE = re.compile(r'rc-cd-unit__price">(.*?)</div>', re.S)
_VILLA_ID_RE = re.compile(r'data-villa-id="(\d+)"')
_AVAIL_RE = re.compile(r'data-is-available="([^"]*)"')
_BED_RE = re.compile(r"(\d+)\s*Bedroom", re.I)
_BATH_RE = re.compile(r"(\d+)\s*Bathroom", re.I)
_AREA_RE = re.compile(r"([\d,\.]+)\s*(sq\s*m|sqm|m2|m²|sqf|sq\s*ft|sqft)", re.I)
# «Rent - (SR)247,000» — the label, then the figure. Anything else is not a rent price.
_RENT_PRICE_RE = re.compile(r"^\s*Rent\s*-\s*\(SR\)\s*([\d,]+)\s*$", re.I)

# The unit NAME carries the type word; the fleet folds townhouse→Villa and penthouse→Apartment.
_TYPE_WORDS = (("studio", "استوديو"), ("townhouse", "فيلا"), ("town house", "فيلا"),
               ("villa", "فيلا"), ("penthouse", "شقة"), ("apartment", "شقة"), ("apt", "شقة"),
               ("chalet", "شاليه"), ("duplex", "دوبلكس"))


def unit_type_ar(name: str) -> Optional[str]:
    """«Duplex Two Bedroom fully furnished Apartment» → شقة (the noun), «Studio … Apartment» →
    استوديو (the most specific word), a bare «… Duplex …» → دوبلكس. No type word → None."""
    low = name.lower()
    if "studio" in low:
        return "استوديو"
    last = None
    for word, ar in _TYPE_WORDS:
        if word in ("studio", "duplex"):
            continue
        for m in re.finditer(r"\b" + re.escape(word) + r"s?\b", low):   # «Apartments with …»
            if last is None or m.start() > last[0]:
                last = (m.start(), ar)
    if last:
        return last[1]
    return "دوبلكس" if re.search(r"\bduplex(?:es)?\b", low) else None


def parse_unit(block: str) -> dict[str, Any]:
    """One <li class="rc-cd-unit"> → the source's own fields, uncoerced."""
    nm, mt, pr = _NAME_RE.search(block), _META_RE.search(block), _PRICE_RE.search(block)
    vid, av = _VILLA_ID_RE.search(block), _AVAIL_RE.search(block)
    return {
        "name": plain(nm.group(1)) if nm else "",
        "meta": plain(mt.group(1)) if mt else "",
        "price_raw": plain(pr.group(1)) if pr else "",
        "villa_id": vid.group(1) if vid else None,
        "available": (av.group(1).strip().lower() if av else None),
    }


def area_m2(meta: str) -> tuple[Optional[int], Optional[str]]:
    """(area_m2, raw) — «300 sqm» → (300, "300 sqm"); «245 sqf» → (None, "245 sqf"): a unit that
    is not m² is neither converted nor assumed."""
    m = _AREA_RE.search(meta)
    if not m:
        return None, None
    raw = f"{m.group(1)} {m.group(2)}"
    unit = re.sub(r"\s+", "", m.group(2).lower())
    if unit not in ("sqm", "m2", "m²"):
        return None, raw
    return normalize.to_int(m.group(1).replace(",", "")), raw


def rent_price(price_raw: str) -> tuple[Optional[int], str]:
    """«Rent - (SR)247,000» → (247000, ""); no figure → (None, ""); a non-Rent label →
    (None, "deal_not_rent")."""
    if not price_raw.strip():
        return None, ""
    m = _RENT_PRICE_RE.match(price_raw)
    if not m:
        return None, "deal_not_rent"
    return normalize.to_int(m.group(1).replace(",", "")), ""


def _ld_blocks(page_html: str) -> list[dict]:
    out = []
    for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page_html, re.S):
        try:
            out.append(json.loads(raw))
        except ValueError:
            continue
    return out


def compound_facts(url: str, page_html: str) -> dict[str, Any]:
    """Everything a page states about the COMPOUND (shared by all its units)."""
    lds = _ld_blocks(page_html)
    place = next((d for d in lds if isinstance(d.get("address"), dict) and d.get("geo")), {})
    addr = place.get("address") or {}
    geo = place.get("geo") or {}
    name = None
    hm = re.search(r"<h1[^>]*>(.*?)</h1>", page_html, re.S)
    if hm:
        name = plain(hm.group(1))
    about = None
    am = re.search(r'rc-cd-card__heading">About This Compound</h2>.*?rc-cd-card__body">(.*?)</div>',
                   page_html, re.S)
    if am:
        about = plain(am.group(1))
    district_en = None
    dm = re.search(r"\b([A-Z][A-Za-z\-]+(?: [A-Z][A-Za-z\-]+){0,2}) [Dd]istrict\b", page_html)
    if dm:
        district_en = dm.group(1).strip()
    elif addr.get("streetAddress"):
        # «Near Al Thoumamah Rd. Al Munsiyah, Riyadh» → the segment right before the city.
        parts = [p.strip() for p in re.split(r"[,.]", str(addr["streetAddress"])) if p.strip()]
        if len(parts) >= 2:
            district_en = parts[-2]
    features = [str(f.get("name", "")).strip() for f in (place.get("amenityFeature") or [])
                if isinstance(f, dict) and f.get("value") is True]
    return {
        "name": name, "about": about, "district_en": district_en,
        "city_slug": url.rstrip("/").split("/")[-2] if url.count("/") >= 5 else None,
        "postal": str(addr.get("postalCode") or "").strip() or None,
        "lat": geo.get("latitude"), "lng": geo.get("longitude"),
        "features": features,
    }


def photos(page_html: str) -> Optional[list[str]]:
    """The compound's own gallery on rightcompoundimages.blob.core.windows.net — full-size
    data-orig preferred over the /videos/<id>/t/ thumbnail it lazy-loads first."""
    out: list[str] = []
    for tag in re.findall(r"<img[^>]+>", page_html):
        orig = re.search(r'data-orig="([^"]+)"', tag)
        src = re.search(r'\ssrc="([^"]+)"', tag)
        u = orig.group(1) if orig else (src.group(1) if src else "")
        if "rightcompoundimages.blob.core.windows.net" in u and re.search(r"\.(?:jpe?g|png|webp)(?:\?|$)", u, re.I):
            if u not in out:
                out.append(u)
    return out[:20] or None


def map_units(url: str, page_html: str) -> tuple[list[dict], str, dict[str, int]]:
    """Every AVAILABLE unit on one compound page as its own row.
    Returns (rows, page_skip_reason_if_no_rows, per-unit skip tally)."""
    facts = compound_facts(url, page_html)
    city_ar = _CITY_SLUG_AR.get(facts["city_slug"] or "")
    if not city_ar:
        return [], "city_not_mapped", {}
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return [], "city_not_in_catalog", {}
    blocks = _UNIT_RE.findall(page_html)
    if not blocks:
        return [], "no_units", {}

    district_ar = None
    nd = _norm_dist(facts["district_en"])
    if nd:
        cand = _DISTRICT_EN_AR.get((facts["city_slug"], nd))
        if cand:
            district_ar = find_district_in_text(cand, city_id)

    rows: list[dict] = []
    skips: dict[str, int] = {}

    def skip(why: str) -> None:
        skips[why] = skips.get(why, 0) + 1

    for block in blocks:
        u = parse_unit(block)
        if not u["villa_id"]:
            skip("no_unit_id")
            continue
        if u["available"] != "true":
            skip("unit_not_available")
            continue
        type_ar = unit_type_ar(u["name"])
        property_type = normalize.map_type_exact(type_ar) if type_ar else None
        if not property_type:
            skip("type_unmapped")
            continue
        amount, why = rent_price(u["price_raw"])
        if why:
            skip(why)
            continue
        a_m2, a_raw = area_m2(u["meta"])
        bm, hm = _BED_RE.search(u["meta"]), _BATH_RE.search(u["meta"])
        row: dict[str, Any] = {
            "ad_number": f"{PREFIX}{u['villa_id']}",
            "listing_url": url,
            "source": SOURCE,
            "active": True,
            "title": " – ".join(x for x in (facts["name"], u["name"]) if x) or None,
            "description": redact_pii(facts["about"]) if facts["about"] else None,
            "property_type": property_type,
            "transaction_type": "Rent",
            "city": normalize.map_city(city_ar),
            "city_ar": city_ar,
            "city_id": city_id,
            "region_id": region_id,
            "district_ar": district_ar,
            "neighborhood": facts["district_en"],
            "area_m2": a_m2,
            "bedrooms": normalize.to_int(bm.group(1)) if bm else None,
            "bathrooms": normalize.to_int(hm.group(1)) if hm else None,
            "price_annual": amount,
            # The platform's own statement, not a per-unit token: see the module header.
            "rent_period": "annual" if amount is not None else None,
            "zip_code": facts["postal"],
            "photo_urls": photos(page_html),
            "price_evidence": normalize.price_evidence(
                field="rc-cd-unit__price", raw=u["price_raw"] or None, stored=amount,
                kind="annual", origin="structured"),
            "additional_info": {k: v for k, v in {
                "unit_name": u["name"], "unit_id": u["villa_id"], "compound": facts["name"],
                "latitude": facts["lat"], "longitude": facts["lng"],
                "area_raw": a_raw, "unit_meta": u["meta"],
                "period_statement": "platform: /api/v1/compounds rentPeriod=year; /llms.txt "
                                    "«Prices are ANNUAL rent in Saudi Riyals (SAR), not monthly»",
                "compound_facilities_en": ", ".join(facts["features"]) or None,
            }.items() if v is not None},
        }
        # «fully furnished» is the unit's OWN statement about itself; silence stays NULL.
        for col, val in normalize.amenities_from_text(u["name"]).items():
            row[col] = val
        if any("air condition" in f.lower() for f in facts["features"]):
            row["air_conditioner"] = True
        rows.append(row)
    return rows, ("" if rows else "no_available_units"), skips


def fetch_compounds(s: cc.Session, limit: int = 0) -> list[str]:
    r = s.get(f"{BASE}/sitemap.xml", timeout=40)
    if r.status_code != 200:
        return []
    # Slugs carry commas, «%7C» and «%E2%80%93» on six pages — anything but a slash is a slug.
    urls = sorted({u for u in re.findall(r"<loc>([^<]+)</loc>", r.text)
                   if re.match(rf"{re.escape(BASE)}/compounds/[^/]+/[^/]+/?$", u)})
    return urls[:limit] if limit else urls


def site_total(s: cc.Session) -> Optional[int]:
    """The site's own «total» from /api/v1/compounds — the completeness counter."""
    try:
        r = s.get(f"{BASE}/api/v1/compounds?limit=1", timeout=30)
        return int(r.json().get("total")) if r.status_code == 200 else None
    except Exception:  # noqa: BLE001 — a missing counter is a warning, never a crash
        return None


# ── removal oracle ────────────────────────────────────────────────────────────────────────────────
# Absence from the crawl only SELECTS candidates; prune_unseen asks this oracle before it may
# deactivate anything, through the shared law (scrapers/common/http_liveness.py): a 403/429/5xx, a
# timeout or an empty body can never read as a death. The unit's own page is its compound page
# (read back from the row's stored listing_url — the villa id alone does not name the compound).
def _unit_signal(villa_id: str):
    def signal(status, body, _moved):
        if status in (404, 410):
            return "gone"                       # measured: 3/3 invented slugs → 404
        if status != 200 or 'rc-cd-units' not in body:
            return None                         # not a compound page we can read
        for block in _UNIT_RE.findall(body):
            u = parse_unit(block)
            if u["villa_id"] == villa_id:
                return "live" if u["available"] == "true" else "gone"
        return "gone"                           # the compound is served; this unit is not on it
    return signal


def _make_verify_gone(control: Optional[dict]):
    url_for = stored_listing_url(("rightcompound_residential_listings",))

    def probe(ad_number: str, canary=None):
        vid = ad_number[len(PREFIX):]
        if not vid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<villa id> ad number"
        return LivenessProbe(platform="rightcompound", signal=_unit_signal(vid), session=session,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = LivenessProbe(
            platform="rightcompound", signal=_unit_signal(control["ad_number"][len(PREFIX):]),
            session=session, url_for=lambda _ad: control["listing_url"]).verify_gone(control["ad_number"])
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
    run_id = None if dry else db.begin_run("rightcompound")
    res: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        urls = fetch_compounds(s, limit=args.limit)
        if not urls:
            raise RuntimeError("sitemap returned no /compounds/<city>/<slug> urls")
        total = site_total(s)
        print(f"{SOURCE}: {len(urls)} compounds in the sitemap; site's own /api/v1 total = {total}",
              flush=True)
        if total is not None and not args.limit and len(urls) != total:
            print(f"  ⚠ sitemap ({len(urls)}) ≠ site counter ({total}) — enumeration may be partial")
        complete = True
        for i, u in enumerate(urls, 1):
            try:
                r = s.get(u, timeout=45)
            except Exception:  # noqa: BLE001
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                complete = False
                continue
            if r.status_code != 200:
                skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                complete = complete and r.status_code == 404   # a 404 IS an answer; a 5xx is not
                continue
            rows, why, unit_skips = map_units(u, r.text)
            for k, v in unit_skips.items():
                skipped[k] = skipped.get(k, 0) + v
            if not rows:
                skipped[why] = skipped.get(why, 0) + 1
            for row in rows:
                db.mark_direct_alive(row, oracle="rightcompound.compound_page.unit_card")
            res.extend(rows)
            if i % 25 == 0:
                print(f"   … {i}/{len(urls)} compounds, {len(res)} units", flush=True)
            time.sleep(PAUSE)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if args.type == "commercial":
            res = []          # compounds are residential by definition on this source
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} units (nothing written)")
            for r0 in res[:12]:
                print(f"   {r0['ad_number']:>9} {str(r0['property_type']):10} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>5} "
                      f"bd={str(r0['bedrooms']):>3} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # Public upsert_rightcompound_*_batch wrappers are added centrally later; the shared batch
        # writer is the same code path they will call.
        db._wasalt_batch("rightcompound_residential_listings", res)
        superseded = db.retire_superseded_siblings(
            res_table="rightcompound_residential_listings",
            com_table="rightcompound_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads=set(), source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s)")
        pruned = 0
        if args.type == "all" and complete:
            n = db.prune_unseen("rightcompound_residential_listings", {r["ad_number"] for r in res},
                                source=SOURCE, verify_gone=_make_verify_gone(res[0] if res else None))
            if n < 0:
                print("  ⚠ prune guard tripped — kept existing active rows")
            else:
                pruned = n
        elif args.type == "all":
            print("  ⚠ enumeration incomplete (unreachable/5xx pages) — prune skipped")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=len(res),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["rightcompound_residential_listings",
                                           "rightcompound_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} units upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
