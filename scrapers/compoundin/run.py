"""CompoundIn — compoundin.com. Residential compounds for rent. Onboarding 2026-09-19.

SOURCE SHAPE (probed live before any code):
  · Sitemap lists ~125 compounds at /rent/show/<hex-id>/<slug>, plus city index pages and a blog.
  · A compound page is NOT one listing. It carries a gallery of UNIT cards, each with its own
    unit id, bedrooms, bathrooms, area and PRICE:
        <h3 class="cin-unit-card__title">Apartment</h3>
        <p class="cin-unit-card__subtitle">Classic One Bedroom Apartment - Ground Floor</p>
        <p class="cin-compound-card__specs">1 Bedrooms  2 Bathrooms  70 sqm</p>
        <span class="cin-compound-card__amount-value">95,000</span>
        <button … data-cin-contact-unit="485">
    One real compound (The Residence Olaya) carries EIGHT units priced 95,000–170,000. Filing the
    compound as a single listing would throw away seven properties and put one arbitrary price on
    the eighth, so the ROW GRAIN IS THE UNIT and the ad_number is the source's own unit id.
  · PERIOD: the unit price carries no period label of its own. The platform states it in its own
    copy — "Pay your annual rent in easy monthly installments with Ejari", alongside an RNPL badge
    — so the figure is the ANNUAL rent, which is also the standing RNPL→ANNUAL reading. It is a
    platform-level statement, recorded here rather than inferred per listing.
  · DELISTED compounds answer HTTP 200 with «<h1>This compound is no longer listed</h1>» and a
    strip of OTHER compounds as recommendations. That is this source's death signal — a 200, not a
    404 — and the recommendation cards carry their own bedrooms/bathrooms/sqm/price, so they are
    exactly the neighbour-contamination shape. They cannot leak here because a UNIT is only read
    from a block carrying `cin-unit-card__title`, which recommendation cards never have.
  · LANGUAGE: this source is ENGLISH. Under the no-English-leaks rule a district is only written
    when an English name maps to a catalogued Arabic district of the SAME city with certainty;
    otherwise district_ar stays NULL and the card shows «الحي غير محدد». The raw English is kept
    in `neighborhood`, which is never displayed.
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://compoundin.com"
SOURCE = "CompoundIn"
PREFIX = "CIN"


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "en,ar;q=0.7"})
    return s


# English city → the Arabic the catalog knows. Small and closed: the source only serves six cities.
_CITY_EN_AR = {
    "riyadh": "الرياض", "jeddah": "جدة", "khobar": "الخبر", "al khobar": "الخبر",
    "dammam": "الدمام", "makkah": "مكة المكرمة", "mecca": "مكة المكرمة",
    "buraydah": "بريدة", "buraidah": "بريدة",
}

# English district → Arabic, accepted ONLY where the transliteration is unambiguous AND the Arabic
# is already catalogued for that city. Anything not listed here stays NULL — accuracy over
# coverage, per the standing English-district mapping standard.
# Keyed on a NORMALISED English name (see _norm_dist): lowercased, «District» dropped, and the
# Arabic definite-article transliterations al-/ al / an / ar / as folded to one form, because the
# source spells the same district «Al Narjis District», «An Narjis» and «Al-Arid» on different
# pages. Every value is then still put through find_district_in_text() against THIS city's
# catalog, so a name that is not already catalogued for that city writes NULL. Accuracy over
# coverage: a district we cannot attest shows «الحي غير محدد».
_DISTRICT_EN_AR = {
    ("riyadh", "olaya"): "حي العليا", ("riyadh", "malqa"): "حي الملقا",
    ("riyadh", "narjis"): "حي النرجس", ("riyadh", "hittin"): "حي حطين",
    ("riyadh", "yasmin"): "حي الياسمين", ("riyadh", "yasmeen"): "حي الياسمين",
    ("riyadh", "sahafah"): "حي الصحافة", ("riyadh", "nakheel"): "حي النخيل",
    ("riyadh", "muhammadiyah"): "حي المحمدية", ("riyadh", "rabi"): "حي الربيع",
    ("riyadh", "wadi"): "حي الوادي", ("riyadh", "ghadir"): "حي الغدير",
    ("riyadh", "izdihar"): "حي الازدهار", ("riyadh", "murabba"): "حي المربع",
    ("riyadh", "arid"): "حي العارض", ("riyadh", "munsiyah"): "حي المونسية",
    ("riyadh", "qairawan"): "حي القيروان", ("riyadh", "rawdah"): "حي الروضة",
    ("riyadh", "saadah"): "حي السعادة", ("riyadh", "dhubbat"): "حي الضباط",
    ("riyadh", "sulimaniyah"): "حي السليمانية", ("riyadh", "ghadeer"): "حي الغدير",
    ("jeddah", "shatie"): "حي الشاطئ", ("jeddah", "shati"): "حي الشاطئ",
    ("jeddah", "rawdah"): "حي الروضة", ("jeddah", "hamra"): "حي الحمراء",
    ("jeddah", "zahra"): "حي الزهراء", ("jeddah", "obhur"): "حي أبحر الشمالية",
    ("jeddah", "abhur"): "حي أبحر الشمالية", ("jeddah", "safa"): "حي الصفا",
    ("khobar", "aqrabiyah"): "حي العقربية", ("khobar", "ulaya"): "حي العليا",
    ("khobar", "sadafa"): "حي الصدفة", ("khobar", "corniche"): "حي الكورنيش",
    ("dammam", "faisaliah"): "حي الفيصلية", ("dammam", "faisaliyah"): "حي الفيصلية",
}


def _norm_dist(name: Optional[str]) -> Optional[str]:
    """«Al Narjis District» / «An Narjis» / «Al-Arid» → «narjis» / «narjis» / «arid»."""
    if not name:
        return None
    n = re.sub(r"\bdistrict\b", " ", name.strip().lower())
    n = re.sub(r"[^a-z\s-]", " ", n)
    n = re.sub(r"^\s*(?:al|an|ar|as|ad|ash)[\s-]+", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n or None

_UNIT_RE = re.compile(
    r'cin-unit-card__title">([^<]*)<'          # 1 unit type
    r'.*?cin-unit-card__subtitle">([^<]*)<'    # 2 unit subtitle
    r'.*?cin-compound-card__specs">(.*?)</p>'  # 3 specs blob
    r'.*?cin-compound-card__amount-value">([^<]*)<'  # 4 price
    r'.*?data-cin-contact-unit="(\d+)"',       # 5 unit id
    re.S)
_BED_RE = re.compile(r"(\d+)\s*Bedroom", re.I)
_BATH_RE = re.compile(r"(\d+)\s*Bathroom", re.I)
_SQM_RE = re.compile(r"([\d,\.]+)\s*sqm", re.I)

_TYPE_EN_AR = {
    "apartment": "شقة", "studio": "استوديو", "villa": "فيلا", "townhouse": "فيلا",
    "duplex": "دوبلكس", "penthouse": "شقة", "chalet": "شاليه", "room": "غرفة",
}


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _int(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    try:
        n = int(float(str(s).replace(",", "").strip()))
        return n if n > 0 else None
    except ValueError:
        return None


_DELISTED_RE = re.compile(r"no longer listed", re.I)


def is_delisted(page_html: str) -> bool:
    m = re.search(r"<h1[^>]*>(.*?)</h1>", page_html, re.S)
    return bool(m and _DELISTED_RE.search(m.group(1)))


def compound_location(page_html: str) -> tuple[Optional[str], Optional[str]]:
    """(city_en, district_en), each read from a place the source uses for that field only.

    addressLocality is NOT reliable for the city here: on azure-narjis it holds «Al Narjis», a
    DISTRICT. The breadcrumb trail states the city explicitly («Residential compound for rent in
    Riyadh», «Compounds in Riyadh»), so that is read first and addressLocality only as a last
    resort. The district comes from the source's own «… living in X» / «X District» line.
    """
    city = None
    for pat in (r"compound for rent in ([A-Za-z ]{3,25})",
                r"Compounds in ([A-Za-z ]{3,25})"):
        m = re.search(pat, page_html)
        if m:
            city = m.group(1).strip()
            break
    if not city:
        m = re.search(r'"addressLocality":\s*"([^"]+)"', page_html)
        if m:
            city = m.group(1).strip()
    district = None
    dm = (re.search(r"living in ([A-Z][A-Za-z\- ]{2,28}?)\s*[<\".,]", page_html)
          or re.search(r"([A-Z][A-Za-z\- ]{2,28}?)\s+District", page_html))
    if dm:
        district = dm.group(1).strip()
    return city, district


def map_units(url: str, page_html: str) -> tuple[list[dict], str]:
    """Every UNIT on one compound page as its own row. Returns (rows, skip_reason_if_empty)."""
    if is_delisted(page_html):
        return [], "delisted"
    city_en, district_en = compound_location(page_html)
    if not city_en:
        return [], "no_city"
    city_ar = _CITY_EN_AR.get(city_en.strip().lower())
    if not city_ar:
        return [], "city_not_mapped"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return [], "city_not_in_catalog"

    district_ar = None
    nd = _norm_dist(district_en)
    if nd:
        cand = _DISTRICT_EN_AR.get((city_en.strip().lower(), nd))
        # Only write a district our own catalog already attests for THIS city.
        if cand:
            district_ar = find_district_in_text(cand, city_id)

    compound_name = None
    cm = re.search(r'<h1[^>]*>(.*?)</h1>', page_html, re.S)
    if cm:
        compound_name = plain(cm.group(1))

    rows: list[dict] = []
    for utype, subtitle, specs, price, uid in _UNIT_RE.findall(page_html):
        spec = plain(specs)
        type_ar = _TYPE_EN_AR.get(plain(utype).lower())
        if not type_ar:
            continue
        property_type = normalize.map_type_exact(type_ar)
        if not property_type:
            continue
        amount = _int(price)
        rows.append({
            "ad_number": f"{PREFIX}{uid}",
            "listing_url": url,
            "source": SOURCE,
            "active": True,
            "title": " – ".join(x for x in (compound_name, plain(subtitle)) if x) or None,
            "property_type": property_type,
            "transaction_type": "Rent",
            "city": normalize.map_city(city_ar),
            "city_ar": city_ar,
            "city_id": city_id,
            "region_id": region_id,
            "district_ar": district_ar,
            "neighborhood": district_en,      # raw English; never displayed
            "area_m2": _int(_SQM_RE.search(spec).group(1)) if _SQM_RE.search(spec) else None,
            "bedrooms": _int(_BED_RE.search(spec).group(1)) if _BED_RE.search(spec) else None,
            "bathrooms": _int(_BATH_RE.search(spec).group(1)) if _BATH_RE.search(spec) else None,
            "price_annual": amount,
            # Platform-level statement, not a per-listing token: see the module header.
            "rent_period": "annual" if amount else None,
            "photo_urls": photos(page_html),
            "additional_info": {k: v for k, v in {
                "type_en": plain(utype), "unit_subtitle": plain(subtitle),
                "compound": compound_name, "unit_id": uid,
                "amenities_en": (lambda m: plain(m.group(1)) if m else None)(
                    re.search(r'cin-unit-card__amenities">([^<]*)<', page_html)),
            }.items() if v is not None},
        })
    return rows, ("" if rows else "no_units")


# Gallery images are lazy-loaded, so the real URL sits in data-src/data-lazy-src as often as src.
_IMG_RE = re.compile(r'(?:src|data-src|data-lazy-src|data-cin-gallery-src)="(https://[^"]+)"')


def photos(page_html: str) -> Optional[list[str]]:
    """The compound's own gallery. Images are served as AVIF from /uploads/properties/ — an
    extension filter of jpg|png|webp matched none of them and every listing came back with zero
    photos. Full-size files are preferred over the «sm-» thumbnails, and the YouTube video
    poster (i.ytimg.com) is not a photo of the property."""
    urls = [u for u in dict.fromkeys(_IMG_RE.findall(page_html))
            if "/uploads/properties/" in u
            and re.search(r"\.(?:avif|jpe?g|png|webp)(?:\?|$)", u, re.I)
            and not re.search(r"logo|icon|avatar|placeholder|flag", u, re.I)]
    full = [u for u in urls if "/sm-" not in u]
    return (full + [u for u in urls if u not in full])[:20] or None


def fetch_compounds(s: cc.Session, limit: int = 0) -> list[str]:
    r = s.get(f"{BASE}/sitemap.xml", timeout=40)
    if r.status_code != 200:
        return []
    urls = sorted({u for u in re.findall(r"<loc>([^<]+)</loc>", r.text) if "/rent/show/" in u})
    return urls[:limit] if limit else urls


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("compoundin")
    res: list[dict] = []
    try:
        urls = fetch_compounds(s, limit=args.limit)
        if not urls:
            raise RuntimeError("sitemap returned no /rent/show/ urls")
        print(f"{SOURCE}: {len(urls)} compounds discovered", flush=True)
        skipped: dict[str, int] = {}
        for i, u in enumerate(urls, 1):
            try:
                r = s.get(u, timeout=45)
            except Exception:
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                continue
            if r.status_code != 200:
                skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                continue
            rows, why = map_units(u, r.text)
            if not rows:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            res.extend(rows)
            if i % 25 == 0:
                print(f"   … {i}/{len(urls)} compounds, {len(res)} units", flush=True)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} units (nothing written)")
            for r0 in res[:12]:
                print(f"   {r0['ad_number']:>10} {str(r0['property_type']):10} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>5} "
                      f"bd={str(r0['bedrooms']):>3} "
                      f"pa={r0.get('price_annual')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # Compounds are residential by definition on this source; nothing is written commercial.
        if res:
            db.upsert_compoundin_residential_batch(res)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=len(res),
                             check_tables=["compoundin_residential_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} units upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
