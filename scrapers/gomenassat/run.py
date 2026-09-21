"""شركة منصات العقارية — gomenassat.com. 256 offers, onboarding 2026-09-20.

SOURCE SHAPE (probed live before any code; the handoff note's shape was STALE — see below).

  ENUMERATION. `sitemap.xml` was generated once in 2023 and lists only /offer/148-153, i.e. SIX of
  the 256 offers this site actually publishes (live ids run 32-803). Trusting it would have shipped
  a platform at 2% of its inventory, and two of its six ids («عمارة الديرة», «أرض مستودع الفيصلية»)
  have since flipped to «تم البيع» and must be skipped — so the sitemap path yields ~3 rows.
  The real catalogue is the endpoint the /ar/offers map itself calls:
      POST /ar/get_offers   (Laravel; 419 without `_token`, so the CSRF token is scraped from the
                             offers page's inline `_token:'…'` and POSTed back on the same cookie)
  It returns `offers`: a list of 10-element ARRAYS (positional, no keys) —
      [0] id  [1] title  [2] type_ar  [3] lat  [4] lng  [5] area_raw
      [6] purpose  [7] region_ar  [8] city_ar  [9] district_ar
  plus `offers_page`, the rendered card HTML. Enumeration, location, type, purpose and area all
  come from that array; price, description, photos and rooms come from the detail page.

  A DELETED OFFER RETURNS HTTP 200. /ar/offer/152 is gone, and the handoff note calls it a 404 —
  it is not. It serves 200 with «نأسف! هذه الصفحة غير متوفرة» in the body. Status code alone would
  have archived the soft-404 shell as a successful empty listing, so the body is what decides.

  FIELDS WORTH NAMING:
    · `purpose` [6] is the ONLY deal signal: للبيع / للإيجار / تم البيع / تم الإيجار / استثمار.
      102 of 256 are «تم البيع»/«تم الإيجار» — already transacted, skipped on sight (never shown).
      9 are «استثمار» ("for investment"), which states neither sale nor lease: skipped rather than
      guessed, because putting an annual rent into price_total is a silent 1-year-vs-forever error.
      It is the first open question in this scraper's report.
    · PRICE IS A BARE FIGURE WITH NO UNIT. `<div class="price-tag">170<span>ر.س</span></div>` — the
      same element carries 2,600,000 on one villa and `1` on an office, `2` on a building, `80` on
      750 m² of land, `170` on a chalet let by the YEAR, `4,500` on 16,065 m² in Mecca. Nothing in
      the markup says whether a figure is a total, a rate per metre, or an unfilled field, and the
      site publishes no «سعر المتر» label anywhere, so the per-metre total the 2026-09-03 owner rule
      permits (ppm × area) has no SOURCE ppm to multiply. The figure is therefore stored exactly as
      the site shows it, at any size: 170 stays 170. Owner rule 2026-08-03 — no plausibility floor
      on a source-published price, high or low; the ad is the platform's, not ours to judge.
    · NO PERIOD IS EVER STATED STRUCTURALLY. Exactly one live title says it («شاليه للايجار
      السنوي»). Every other rent is a bare figure, so rent_period stays NULL and the figure goes to
      price_annual unconverted, per the period-is-source rule. The description is NOT a fallback —
      see map_listing for the 12 wrong periods that measured reading it.
    · «الغرف» IS ANOTHER UNSET-COLUMN DEFAULT. Every one of the 37 live dwellings that renders it at
      all renders «الغرف: 0». Zero bedrooms is not a bedroom count, so bedrooms is NULL sitewide.
    · THE SPEC BLOCK IS THREE TEMPLATE DEFAULTS, NOT DATA. «مؤثث: لا» and «مكيفات: لا» and
      «يوجد مواقف: 0» render identically on 50/50 sampled pages — including on bare land, which
      cannot be furnished or air-conditioned. «تاريخ البناء» renders TODAY'S date on every listing
      whose field is unset. A uniform value carries no information, so none of the four is read:
      furnished/air_conditioner/parking come only from the description prose via
      amenities_from_text (silence → NULL, never False), and property age is not captured at all.
    · AREA IS FREE TEXT AND ITS COMMA IS NOT ONE SEPARATOR. «240,16» is two-hundred-forty point
      one six; «16,065» is sixteen thousand. Same field, same character. to_int() drops every comma
      as a thousands separator by contract, which turns 240.16 m² into 24,016 m² — a 100× area on
      the card and in every area filter — so area gets the local _area_m2() parser instead, and the
      raw string is archived. The field also holds «مساحات متعددة», «متنوعه», «من 300م2 إلى 360م2»,
      «تبدا من m102», «1341 -684», «٢٠٠٢م» (Arabic-Indic), «م4583.07», «652l» and «_». A range or a
      multi-area project has no single area: NULL, never one end of the range.
    · PHOTOS MUST BE SCOPED TO <section id="slider">. The page also renders three «عروض أخرى قريبة»
      sibling cards whose images live under the same /uploads/offers/ path; an unscoped sweep
      attributes another listing's photos to this one. The gallery serves at most FOUR anchors and
      says «+ N معرض الصور» for the remainder, which is fetched by script and never appears in the
      HTML — so 4 is this source's ceiling, not a parse miss. The «تحميل ملف المشروع» PDF sits in
      the same directory and is not a photo.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://gomenassat.com"
SOURCE = "منصات"
PREFIX = "MNS"

# The soft-404 body. A deleted offer serves 200, so this string is the liveness oracle.
GONE_MARKERS = ("هذه الصفحة غير متوفرة", "نأسف!")

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩٬٫", "0123456789,.")

# Types whose «الغرف» genuinely counts BEDROOMS. On a building/showroom/warehouse the same field is
# a total room count («53 غرفة» across a whole tower), which would answer a bedroom filter as a
# 53-bedroom home — the wslnaa rooms-are-not-bedrooms finding, same shape here.
_DWELLING_TYPES = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Chalet", "Rest House"}

_IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    # impersonate owns the User-Agent; setting one contradicts the TLS fingerprint.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


# --- local helpers (deliberately NOT in scrapers/common: this onboarding may not touch shared
# --- files, and both parsers encode gomenassat-specific text shapes anyway) -----------------------

def _area_m2(raw: Optional[str]) -> Optional[int]:
    """gomenassat's free-text «المساحة» → whole m², or None when it states no single area.

    NOT normalize.to_int(): to_int drops every comma as a thousands separator by contract, and this
    field uses the comma as a DECIMAL point too («240,16» = 240.16 m², «706,25» = 706.25 m²). Under
    to_int those become 24,016 and 70,625 — a 100× area, shown on the card and searched by the area
    filter. The comma is read by the digits that follow it: three → grouping, one or two → decimal.
    """
    if raw is None:
        return None
    s = html.unescape(str(raw)).translate(_AR_DIGITS).strip()
    if not s:
        return None
    # «مساحات متعددة» / «متنوعه» / «من 300م2 إلى 360م2» / «تبدا من m102» / «1341 -684» state a RANGE
    # or a set of areas, not an area. Picking an endpoint would invent a number the source never
    # published, and would make a 300-360 m² project answer an exactly-300 filter.
    if re.search(r"متعدد|متنوع|مختلف|إلى|الى|تبدا|تبدأ|\bمن\b|-", s):
        return None
    core = re.sub(r"م²|م2|متر مربع|مربع|متر|م", " ", s)
    nums = re.findall(r"\d[\d,]*(?:\.\d+)?", core)
    if len(nums) != 1:           # 0 → «_» / prose; 2+ → «مساحة المعرض 68م … المعارض : 204م2»
        return None
    n = nums[0]
    if "," in n:
        tail = n.rsplit(",", 1)[1]
        n = n.replace(",", "." if ("." not in n and 1 <= len(tail) <= 2) else "")
    try:
        v = float(n)
    except ValueError:
        return None
    return int(v) if v > 0 else None


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def parse_detail(page: str) -> Optional[dict]:
    """The /ar/offer/<id> page → {price_figure, description, photo_urls, rooms, project_pdf}.

    None means the page is not a listing (the soft-404 shell), which is a DEFINITIVE absence, not a
    transport fault: the offer was deleted.
    """
    if any(m in page for m in GONE_MARKERS):
        return None
    out: dict[str, Any] = {}

    m = re.search(r'class="price-tag">(.*?)</div>', page, re.S)
    out["price_figure"] = normalize.to_int(_text(m.group(1))) if m else None

    # Scoped to the gallery section: the sibling «عروض أخرى قريبة» cards use the same image path.
    slider = re.search(r'<section id="slider".*?</section>', page, re.S)
    photos: list[str] = []
    if slider:
        for u in re.findall(r'href="([^"]*/uploads/offers/[^"]+)"', slider.group(0)):
            u = html.unescape(u)                       # &amp; in a href 404s every fetch
            if u.lower().endswith(_IMG_EXT) and u not in photos:
                photos.append(u)
    out["photo_urls"] = photos[:20] or None

    # The description is the free <p> that follows the specs grid; the grid itself is template
    # defaults (مؤثث/مكيفات/مواقف/تاريخ البناء all render a constant) and is deliberately not read.
    desc = None
    specs = page.find("المواصفات")
    if specs != -1:
        tail = page[specs:]
        cut = tail.find("الموقع على الخريطة")
        block = tail[:cut] if cut != -1 else tail[:6000]
        paras = [_text(p) for p in re.findall(r"<p>(.*?)</p>", block, re.S)]
        desc = "\n".join(p for p in paras if p) or None
        # «الغرف: 0» renders on all 37 live dwellings that fill the field at all — it is the same
        # unset-column default as مؤثث/مكيفات/مواقف, and zero bedrooms is not a bedroom count. `or
        # None` collapses it to absent, so the column stays NULL instead of asserting a 0-bed home.
        r = re.search(r"الغرف:\s*(?:<[^>]*>\s*)*([^<]*)", block)
        out["rooms"] = (normalize.to_int(_text(r.group(1))) or None) if r else None
        pdf = re.search(r'href="([^"]*/uploads/offers/[^"]+\.pdf)"', page)
        out["project_pdf"] = html.unescape(pdf.group(1)) if pdf else None
    out["description"] = desc
    out.setdefault("rooms", None)
    out.setdefault("project_pdf", None)
    return out


def map_listing(offer: list, detail: dict) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) from one `offers` array + its parsed detail page."""
    oid, title, type_ar, lat, lng, area_raw, purpose, region_ar, city_ar, district_raw = (
        (list(offer) + [None] * 10)[:10])
    title = (html.unescape(title or "").strip() or None)
    purpose = (purpose or "").strip()

    if "مزاد" in (title or "") or "مزاد" in purpose:
        return None, "residential", "auction"
    if purpose in ("تم البيع", "تم الإيجار", "تم الايجار"):
        return None, "residential", "already_transacted"
    if purpose == "للبيع":
        deal = "Buy"
    elif purpose in ("للإيجار", "للايجار"):
        deal = "Rent"
    else:
        # «استثمار» states neither; anything new here is unmapped. Never guessed — a rent written
        # into price_total is a silent 1-year-vs-outright error on the card.
        return None, "residential", f"purpose_unmapped_{purpose or 'blank'}"

    # The source's own `type` is authoritative. A title qualifier («ارض تجارية», «أرض زراعية») is
    # more specific, but this site's taxonomy has no commercial/agricultural land bucket at all, so
    # promoting Residential Land off the title would be derived data overruling a stated type.
    # 4 live lands are affected; raised as an open question rather than decided here.
    property_type = normalize.map_type_exact((type_ar or "").strip())
    if not property_type:
        return None, "residential", f"type_unmapped_{(type_ar or 'blank').strip()}"
    category = normalize.category_for_type(property_type).lower()

    city_ar = html.unescape(city_ar or "").strip() or None
    if not city_ar:
        return None, category, "no_city"
    # to_catalog decides what is a real city; this source's list mixes in areas («سدير», «ملهم»).
    city_id, region_id = to_catalog(city_ar, region_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"

    district_raw = html.unescape(district_raw or "").strip() or None
    district_ar = (find_district_in_text(district_raw, city_id)
                   or find_district_in_text(title, city_id))

    area = _area_m2(area_raw)
    price = detail.get("price_figure")
    price_note = None
    description = detail.get("description")
    # Title ONLY. Scanning the description measured 12 wrong periods out of 145 rows («الدخل السنوي
    # للعمارة» is a building's income, not a lease term). «ليلة» is this source's nightly word; the
    # shared helper knows only «يومي». \b keeps «قليلة» from reading as a night.
    period_text = re.sub(r"\b(?:ال)?ليلة\b", "يومي", title or "")

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{oid}",
        "listing_url": f"{BASE}/ar/offer/{oid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": description,
        # The description prose is the ONLY amenity source here — the spec grid's مؤثث/مكيفات/مواقف
        # are constants. amenities_from_text keeps the four outcomes: named → True, negated
        # («غير مفروشة») → False, prepared-only («مصعد مؤسس») → NULL, the neighbourhood's
        # («قريب من حديقة») → NULL. Silence stays absent, i.e. NULL, never False.
        **normalize.amenities_from_text(description),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,        # card shows the source's own text
        "area_m2": area,
        "bedrooms": detail.get("rooms") if property_type in _DWELLING_TYPES else None,
        "bathrooms": None,                   # never published by this source
        "photo_urls": detail.get("photo_urls"),
    }
    if deal == "Rent":
        # annual → verbatim, monthly → ×12, silent → verbatim with NULL period, and
        # daily / نصف سنوي / ربع سنوي → (None, None): no bucket, and ×365/×2/×4 would be derivation.
        period, row["price_annual"] = normalize.rent_period_and_annual(price, period_text)
        if period:
            row["rent_period"] = period
        elif price is not None and row["price_annual"] is None:
            price_note = "period_not_annualizable"
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "offer_id": oid,
        "type_ar": (type_ar or "").strip() or None,
        "source_purpose": purpose or None,
        "region_ar": html.unescape(region_ar or "").strip() or None,
        "source_area_raw": html.unescape(str(area_raw)) if area_raw else None,
        # Kept when a stated period could not be annualized, so the figure the source showed is not lost.
        "source_price_figure": price if price_note else None,
        "price_note": price_note,
        "source_rooms": detail.get("rooms"),
        "project_pdf": detail.get("project_pdf"),
        "lat": lat, "lng": lng,
    }.items() if v is not None}
    return row, category, ""


def fetch_offers(s: cc.Session, limit: int = 0) -> list[list]:
    """The site's own map endpoint. The 2023 sitemap lists 6 of 256 offers, so it is not used."""
    page = s.get(f"{BASE}/ar/offers", timeout=40)
    if page.status_code != 200:
        raise RuntimeError(f"/ar/offers returned {page.status_code}")
    tok = re.search(r"_token\s*:\s*'([^']+)'", page.text) or re.search(
        r'name="csrf-token"\s+content="([^"]+)"', page.text)
    if not tok:
        raise RuntimeError("no CSRF _token on /ar/offers — POST /ar/get_offers would 419")
    r = s.post(f"{BASE}/ar/get_offers", data={"_token": tok.group(1)}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"/ar/get_offers returned {r.status_code}")
    try:
        body = r.json()
    except ValueError as exc:
        raise RuntimeError(f"/ar/get_offers is no longer JSON: {exc}") from exc
    offers = [o for o in (body.get("offers") or []) if isinstance(o, list) and len(o) >= 10]
    if not offers:
        raise RuntimeError("/ar/get_offers returned no usable offer arrays")
    offers.sort(key=lambda o: -int(o[0]))
    return offers[:limit] if limit else offers


def fetch_detail(s: cc.Session, oid: int) -> Optional[dict]:
    r = s.get(f"{BASE}/ar/offer/{oid}", timeout=40)
    if r.status_code != 200:
        return None                          # transport/server fault, NOT an absence
    return parse_detail(r.text)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("gomenassat")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        offers = fetch_offers(s, limit=args.limit)
        print(f"{SOURCE}: {len(offers)} offers discovered", flush=True)
        for o in offers:
            purpose = (o[6] or "").strip()
            # Save 102 pointless detail fetches: an already-transacted ad is skipped whatever the
            # page says, and the purpose is stated in the index.
            if purpose in ("تم البيع", "تم الإيجار", "تم الايجار"):
                skipped["already_transacted"] = skipped.get("already_transacted", 0) + 1
                continue
            detail = fetch_detail(s, int(o[0]))
            if detail is None:
                skipped["detail_gone_or_unreachable"] = (
                    skipped.get("detail_gone_or_unreachable", 0) + 1)
                continue
            row, cat, why = map_listing(o, detail)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>8} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):17} {str(r0['city_ar']):9} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>8} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # db.py has no gomenassat wrapper yet (the tables + the named upsert_gomenassat_*_batch
        # helpers are another engineer's central change). _wasalt_batch is the shared batch writer
        # every small platform's wrapper delegates to, so it is called directly here; swap these two
        # lines for the named wrappers once they land.
        if res:
            db._wasalt_batch("gomenassat_residential_listings", res)
        if com:
            db._wasalt_batch("gomenassat_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="gomenassat_residential_listings",
            com_table="gomenassat_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(offers),
                            rows_upserted=len(res) + len(com), notes=notes or None,
                            check_tables=["gomenassat_residential_listings",
                                          "gomenassat_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            # An empty run says WHY in the database: the exception AND the skip tally, so a run that
            # wrote nothing because everything was already sold reads differently from a blocked one.
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
