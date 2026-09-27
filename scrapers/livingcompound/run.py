"""LivingCompound — livingcompound.com. A Jeddah brokerage's WordPress site (HomeID theme, G5
real-estate plugin) listing individual villas/apartments for rent and sale. Onboarding 2026-09-24
(batch 36, group compounds-a). Despite the name this is NOT a compound site: every /property/<slug>/
page is ONE advertised unit with its own REGA ad licence, so the grain is the page and ad_number =
"LCP" + the WordPress post id (body class postid-9543, also printed as «Property ID»).

SOURCE SHAPE (measured live 2026-09-24):
  · CATALOGUE: /property-sitemap.xml (Yoast) lists 20 URLs: the /property/ archive + 19 listing
    pages. wp/v2/property REST is NOT exposed (rest_no_route) — HTML it is. Server-rendered.
  · FIELDS (the <li class="col-sm-6 col-12 <key>"> detail/address rows, verbatim keys):
      price «SAR 85,000» + postfix «/ Year» · type (taxonomy link «Villa») · status «For Rent» /
      «For Sale» · label «Premium» · bedrooms · bathrooms · size «121 m2» · property_year «2018» ·
      real_estate_rega-ad-license-no «7200654129» · real_estate_number-of-floors ·
      real_estate_number-of-entrance · real_estate_number-of-hall · address «J45F+5F8 An Nahdah,
      Jeddah» · country · state «Jeddah» · city «Al Nahdah».
    TRAP: the theme's «Province/State» row holds the CITY (Jeddah) and its «City/Town» row holds
    the DISTRICT (Al Nahdah, Al Shati). Mapped accordingly; the raw district text is `neighborhood`,
    district_ar only when it maps with certainty to a catalogued Arabic district of that city.
  · PERIOD: only the price postfix speaks for the price — «/ Year» → annual, «/ Month» → monthly
    ×12, none → NULL with the figure unconverted. A «For Sale» page stores price_total.
  · LICENCE: «Rega Ad License No» is the AD licence (10 digits) → license_number.
  · AGE: «Year Built» → property_age via age_from_completion_year. «Number of Hall» → halls.
  · AMENITIES: the «Features» chips are the unit's own statement (Maid Room, Laundry Room, Private
    Parking, Air-Condition, Kitchen Cabinet…) → amenities_from_text; «Close By …» chips are the
    neighbourhood's and stay NULL by the shared proximity rule.
  · SOLD/RENTED: a status or label reading Sold / Rented is skipped sold_or_rented.
  · PHOTOS: the slick slider's <a class="g5core__zoom-image" href="…/wp-content/uploads/…jpg">.
    Fetched one: HTTP 200 image/jpeg.
  · REMOVAL ORACLE (measured 2026-09-24): WordPress answers «/?p=<post id>» with a 301 to the
    property's own URL when it exists (3/3 live ids) and a REAL HTTP 404 when it does not (3/3
    invented ids). So the probe fetches /?p=<id>: a landed page whose body class carries
    postid-<id> is live; 404 is gone. prune_unseen runs only after a complete enumeration with an
    in-run positive control that fails CLOSED. Absence from the sitemap alone is never death.
  · LANGUAGE: English only (lang="en-US"). PDPL: agent cards are outside the parsed blocks;
    description is redacted anyway.
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://livingcompound.com"
SOURCE = "LivingCompound"
PREFIX = "LCP"
PAUSE = 1.0


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.7"})
    return s


_CITY_EN_AR = {"jeddah": "جدة", "riyadh": "الرياض", "makkah": "مكة المكرمة", "mecca": "مكة المكرمة",
               "khobar": "الخبر", "dammam": "الدمام", "madinah": "المدينة المنورة", "taif": "الطائف"}
_DISTRICT_EN_AR = {
    ("جدة", "nahdah"): "حي النهضة", ("جدة", "nahda"): "حي النهضة", ("جدة", "shati"): "حي الشاطئ",
    ("جدة", "shatea"): "حي الشاطئ", ("جدة", "shatie"): "حي الشاطئ", ("جدة", "khalidiyah"): "حي الخالدية",
    ("جدة", "khalidiya"): "حي الخالدية", ("جدة", "andalus"): "حي الأندلس", ("جدة", "rawdah"): "حي الروضة",
    ("جدة", "hamra"): "حي الحمراء", ("جدة", "zahra"): "حي الزهراء", ("جدة", "salamah"): "حي السلامة",
    ("جدة", "basateen"): "حي البساتين", ("جدة", "muhammadiyah"): "حي المحمدية", ("جدة", "naeem"): "حي النعيم",
    ("جدة", "safa"): "حي الصفا", ("جدة", "faisaliyah"): "حي الفيصلية", ("جدة", "obhur"): "حي أبحر الشمالية",
    ("جدة", "marwah"): "حي المروة", ("جدة", "aziziyah"): "حي العزيزية", ("جدة", "rehab"): "حي الرحاب",
    ("جدة", "bawadi"): "حي البوادي", ("جدة", "nuzhah"): "حي النزهة", ("جدة", "mohammadiyah"): "حي المحمدية",
    ("جدة", "fyha"): "حي الفيحاء", ("جدة", "fayha"): "حي الفيحاء", ("جدة", "ruwais"): "حي الرويس",
    ("جدة", "rabwah"): "حي الربوة", ("جدة", "khalidiyyah"): "حي الخالدية",
}
# The site's own taxonomy words → Arabic canon (townhouse→Villa is the fleet override).
_TYPE_EN_AR = {"villa": "فيلا", "apartment": "شقة", "town houses": "فيلا", "town house": "فيلا",
               "townhouse": "فيلا", "compound villa": "فيلا", "office": "مكتب", "store": "محل",
               "duplex": "دوبلكس", "studio": "استوديو", "penthouse": "شقة"}


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


_ROW_RE = re.compile(r'<li class="col-sm-6 col-12 ([a-z_\-]+)">\s*<div class="d-flex g5ere__property-'
                     r'(?:detail|address)-item">\s*<strong class="mr-2">([^<]*)</strong>\s*(.*?)</div>', re.S)


def detail_rows(page_html: str) -> dict[str, str]:
    """{row key: plain value} for every detail/address row; the LAST occurrence of a key wins."""
    return {key: plain(val) for key, _label, val in _ROW_RE.findall(page_html)}


def post_id(page_html: str) -> Optional[str]:
    m = re.search(r'<body[^>]*class="[^"]*\bpostid-(\d+)\b', page_html)
    return m.group(1) if m else None


def price_block(page_html: str) -> tuple[Optional[int], str, str]:
    """(figure, raw_price_text, postfix) from <span class="g5ere__property-price">."""
    m = re.search(r'g5ere__property-price">(.*?</span>)\s*</span>', page_html, re.S)
    if not m:
        return None, "", ""
    blk = m.group(1)
    pm = re.search(r'g5ere__lpp-price">(.*?)</span>', blk, re.S)
    xm = re.search(r'g5ere__pp-postfix">(.*?)</span>', blk, re.S)
    raw = plain(pm.group(1)) if pm else ""
    digits = re.sub(r"[^\d]", "", raw)
    return (normalize.to_int(digits) if digits else None), raw, (plain(xm.group(1)) if xm else "")


def rent_period_en(postfix: str) -> tuple[Optional[str], Optional[int]]:
    """The postfix is the source's only period word. Returns (rent_period, multiplier)."""
    p = postfix.lower()
    if re.search(r"\byear|annual|yr\b", p):
        return "annual", 1
    if re.search(r"\bmonth|mo\b", p):
        return "monthly", 12
    return None, None


def description(page_html: str) -> Optional[str]:
    body = re.sub(r"<style.*?</style>|<script.*?</script>", "", page_html, flags=re.S)
    m = re.search(r'class="[^"]*g5ere__property-block-description[^"]*">.*?<div class="card-body">(.*?)</div>',
                  body, re.S)
    return plain(m.group(1)) or None if m else None


def features(page_html: str) -> list[str]:
    m = re.search(r'class="[^"]*g5ere__property-block-features[^"]*">(.*?)</ul>', page_html, re.S)
    return [plain(x) for x in re.findall(r"<li[^>]*>(.*?)</li>", m.group(1), re.S)] if m else []


def photos(page_html: str) -> Optional[list[str]]:
    urls = list(dict.fromkeys(re.findall(
        r'class="g5core__zoom-image"[^>]*href="(https://livingcompound\.com/wp-content/uploads/[^"]+\.(?:jpe?g|png|webp))"'
        r'|href="(https://livingcompound\.com/wp-content/uploads/[^"]+\.(?:jpe?g|png|webp))"[^>]*class="g5core__zoom-image"',
        page_html, re.I)))
    flat = [a or b for a, b in urls if (a or b)]
    return list(dict.fromkeys(flat))[:20] or None


def map_listing(url: str, page_html: str) -> tuple[Optional[dict], Optional[str], str]:
    """One /property/<slug>/ page → (row, category, skip_reason). row is None iff skip_reason."""
    pid = post_id(page_html)
    if not pid:
        return None, None, "no_id"
    d = detail_rows(page_html)
    status = (d.get("status") or "").strip().lower()
    label = (d.get("label") or "").strip().lower()
    if re.search(r"\b(sold|rented|leased)\b", f"{status} {label}"):
        return None, None, "sold_or_rented"
    if "rent" in status:
        txn = "Rent"
    elif "sale" in status:
        txn = "Buy"     # CANONICAL = {"Buy","Rent"}; "Sale" was never a valid transaction_type value
    else:
        return None, None, "deal_unstated"
    types = [t.strip().lower() for t in re.split(r",", d.get("type") or "") if t.strip()]
    canon = {normalize.map_type_exact(_TYPE_EN_AR[t]) for t in types if t in _TYPE_EN_AR}
    canon.discard(None)
    if len(canon) != 1:
        return None, None, ("type_ambiguous" if len(canon) > 1 else "type_unmapped")
    property_type = canon.pop()
    category = normalize.category_for_type(property_type).lower()   # main() routes on the lowercase word
    city_ar = _CITY_EN_AR.get((d.get("state") or "").strip().lower())
    if not city_ar:
        return None, None, "city_not_mapped"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, None, "city_not_in_catalog"
    district_en = (d.get("city") or "").strip() or None
    district_ar = None
    if district_en:
        key = re.sub(r"^(?:al|an|ar|as|ash)[\s-]+", "", district_en.lower().replace("-", " ")).strip()
        cand = _DISTRICT_EN_AR.get((city_ar, key))
        if cand:
            district_ar = find_district_in_text(cand, city_id)

    amount, raw_price, postfix = price_block(page_html)
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "title": plain(next(iter(re.findall(r"<h1[^>]*>(.*?)</h1>", page_html, re.S)), "")) or None,
        "description": redact_pii(description(page_html)),
        "property_type": property_type,
        "transaction_type": txn,
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_en,
        "bedrooms": normalize.to_int(d.get("bedrooms")),
        "bathrooms": normalize.to_int(d.get("bathrooms")),
        "halls": normalize.to_int(d.get("real_estate_number-of-hall")),
        "license_number": (d.get("real_estate_rega-ad-license-no") or "").strip() or None,
        "property_age": normalize.age_from_completion_year(d.get("property_year"), this_year=date.today().year),
        "photo_urls": photos(page_html),
        "additional_info": {k: v for k, v in {
            "property_id": d.get("property_id"), "label": d.get("label") or None,
            "address": d.get("address"), "floors": d.get("real_estate_number-of-floors"),
            "entrances": d.get("real_estate_number-of-entrance"), "year_built": d.get("property_year"),
            "size_raw": d.get("size"), "features_en": ", ".join(features(page_html)) or None,
            "price_postfix": postfix or None,
        }.items() if v},
    }
    sz = re.search(r"([\d,\.]+)\s*m", d.get("size") or "")
    if sz:
        row["area_m2"] = normalize.to_int(sz.group(1).replace(",", ""))
    if txn == "Rent":
        period, mult = rent_period_en(postfix)
        if amount is None:
            row["rent_period"], row["price_annual"] = None, None
        elif period:
            row["rent_period"], row["price_annual"] = period, amount * mult
        elif postfix:
            # A postfix IS present but states an unsupported period (e.g. a hypothetical "/ Day")
            # — the owner's law treats that the same as daily/weekly/نصف سنوي: (None, None), never
            # parked indistinguishably from a genuinely SILENT price (no postfix element at all,
            # normalize.rent_period_and_annual()'s own pattern for an unrecognized period token).
            row["rent_period"], row["price_annual"] = None, None
        else:
            row["rent_period"], row["price_annual"] = None, amount
        row["price_evidence"] = normalize.price_evidence(
            field="g5ere__lpp-price + g5ere__pp-postfix", raw=f"{raw_price} {postfix}".strip() or None,
            stored=row["price_annual"], kind=(period or "total"), origin="structured")
    else:
        row["price_total"] = amount
        row["price_evidence"] = normalize.price_evidence(
            field="g5ere__lpp-price", raw=raw_price or None, stored=amount, kind="total",
            origin="structured")
    # The Features chips are this unit's own statement; «Air-Condition» is the theme's spelling.
    feat = " ، ".join(features(page_html)).replace("Air-Condition", "Air Condition")
    for col, val in normalize.amenities_from_text(feat).items():
        row[col] = val
    if re.search(r"\bair[\s-]*condition", feat, re.I):
        row["air_conditioner"] = True
    return row, category, ""


def fetch_listing_urls(s: cc.Session, limit: int = 0) -> list[str]:
    r = s.get(f"{BASE}/property-sitemap.xml", timeout=40)
    if r.status_code != 200:
        return []
    urls = sorted({u for u in re.findall(r"<loc>([^<]+)</loc>", r.text)
                   if re.match(rf"{re.escape(BASE)}/property/[^/]+/?$", u)})
    return urls[:limit] if limit else urls


# ── removal oracle (see the module header for the measurement) ───────────────────────────────────
def _post_signal(pid: str):
    def signal(status, body, _moved):
        if status in (404, 410):
            return "gone"
        if status == 200 and re.search(rf'<body[^>]*class="[^"]*\bpostid-{pid}\b', body):
            d = detail_rows(body)
            if re.search(r"\b(sold|rented|leased)\b", f"{d.get('status', '')} {d.get('label', '')}".lower()):
                return "gone"
            return "live"
        return None
    return signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):]
        if not pid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
        return LivenessProbe(platform="livingcompound", signal=_post_signal(pid), session=session,
                             url_for=lambda _ad: f"{BASE}/?p={pid}", canary=canary).verify_gone(ad_number)

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
    run_id = None if dry else db.begin_run("livingcompound")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        urls = fetch_listing_urls(s, limit=args.limit)
        if not urls:
            raise RuntimeError("property-sitemap returned no /property/<slug>/ urls")
        print(f"{SOURCE}: {len(urls)} listings discovered", flush=True)
        complete = True
        for u in urls:
            try:
                r = s.get(u, timeout=45)
            except Exception:  # noqa: BLE001
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                complete = False
                continue
            if r.status_code != 200:
                skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                complete = complete and r.status_code == 404
                continue
            row, cat, why = map_listing(u, r.text)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            db.mark_direct_alive(row, oracle="livingcompound.property_page.postid")
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            time.sleep(PAUSE)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:25]:
                print(f"   {r0['ad_number']:>8} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):6} d={str(r0['district_ar'])[:12]:12} a={str(r0.get('area_m2')):>5} "
                      f"bd={str(r0['bedrooms']):>3} pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} lic={r0.get('license_number')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # Public upsert_livingcompound_*_batch wrappers are added centrally later; same shared writer.
        db._wasalt_batch("livingcompound_residential_listings", res)
        db._wasalt_batch("livingcompound_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="livingcompound_residential_listings",
            com_table="livingcompound_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("livingcompound_residential_listings", res),
                              ("livingcompound_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  ⚠ enumeration incomplete (unreachable/5xx pages) — prune skipped")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["livingcompound_residential_listings",
                                           "livingcompound_commercial_listings"])
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
