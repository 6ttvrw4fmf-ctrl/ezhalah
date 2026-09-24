"""البداح للعقارات — albdah.sa. 10 listings (Buraydah / Qassim), onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24 with curl_cffi, impersonate="chrome"; plain Django HTML, no JS).

  ENUMERATION. The homepage and /property/filter/ both list every listing as
  `<a class="card" href="/property/<id>/details/">` (10/10 ids identical on both), and the site
  prints its own total: «10 عقار متاح الآن في بريدة والقصيم». TYPE, however, is stated nowhere on a
  card or a detail page except as a free label («شقة مفروشة للايجار»), so the catalogue is walked
  by the site's OWN taxonomy pages, /property/filter-result/<slug>/ for the 11 slugs the homepage
  links (apartment, branch, building, chalet, commercial_office, farm, floor, land, resthouse,
  shop, villa). Each page prints its own «N عقار» counter; measured: apartment 6, chalet 2, land 1,
  villa 1 = 10, the other seven empty. A run is COMPLETE only when the per-type sum equals the
  homepage total; anything else disables pruning.

  IDS are 5-char case-sensitive tokens (05WmN, 97RVw); the detail page prints «إعلان رقم 05WmN».
  ad_number = BDH + id.

  DETAIL PAGE fields, all measured on 10/10 pages:
    · price: `<div class="price-big"><span class="num">1,200</span><span class="cur">﷼</span>
      <span class="per">/ شهرياً</span></div>`. The `per` span is the ONLY period statement:
      «/ شهرياً» on 6 rents, «/ سنوياً» on 2 rents, absent on the 2 sales. The «دفعة شهرية /
      نصف سنوية / سنوية: متاح» rows below the price are PAYMENT SCHEDULES, not the rent period
      (09zJt is priced «20,000 / سنوياً» and also offers «دفعة نصف سنوية») — never read as a period.
    · deal: `<span class="bdg sale">للإيجار|للبيع</span>` (8 rent, 2 sale).
    · loc: `<p class="loc">` = city · district · tenants(عزّاب/عوائل) · «إعلان رقم <id>» · views.
      22UzT prints only «القرعاء» (a Qassim town to_catalog cannot place) → skipped, never defaulted
      to Buraydah.
    · facts (`<span class="v">..</span><span class="k">..</span>`): متر مربع, غرف نوم, صالات,
      دورات مياه, الدور («علوي» — a label, not a number), عمر العقار («جديد»/«مجدد»/4/7 —
      «مجدد» = renovated, NOT an age → NULL), عرض الشارع.
    · rows (`<div class="row">`): الماء/الكهرباء/الصرف الصحي «متوفر(ة)» → tri-state utilities;
      «رخصة فال» is the BROKER's FAL licence (1200017006 on 9/10, 1100027006 on 97AxA) — never
      license_number, which this source does not publish (no «رقم ترخيص الإعلان» anywhere);
      الغرض / العرض / الطول on land; صفة المعلن: مسوق.
    · `<div class="amen"><span>مكيفات</span>…` — named amenity chips (مصعد, مفروش, مطبخ, مسبح,
      حوش, غرفة خادمة, مدخل سيارة, مدخل خاص, ألعاب). Chips + description go through
      amenities_from_text (named → True, negated → False, silent → NULL).
    · photos: `<div class="gal">` imgs under /media/property/images/ (1–23 per page; 22UzT repeats
      one file → deduped). One fetched: 200 image/jpeg, JFIF magic.
    · description `<div class="desc">` is free HTML; run through pii.redact_pii.

  REMOVAL ORACLE (measured 2026-09-24). Django DEBUG is on: an unknown id answers HTTP 500 with
  «DoesNotExist at /property/<id>/details/» in the body — 4/4 fabricated ids (ZZZZZ, 00000, AAAAA,
  12345) did exactly that; 10/10 live ids answer 200 with «إعلان رقم <id>». So: 500 + DoesNotExist
  → gone; 200 + the page's own «إعلان رقم <id>» → live; any other 500 (DEBUG turned off) → no
  opinion. Removal is additionally gated by an in-run positive control that fails CLOSED.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://albdah.sa"
SOURCE = "البداح للعقارات"
PREFIX = "BDH"

# The site's own taxonomy slugs (its /property/filter-result/<slug>/ pages), exact keys → canonical.
# «branch» (فرع) has no canonical type and is deliberately absent: unknown → skip, never guess.
_TYPE_OVERRIDES = {
    "apartment": "Apartment", "villa": "Villa", "chalet": "Chalet", "building": "Building",
    "commercial_office": "Office", "farm": "Farm", "floor": "Floor", "land": "Residential Land",
    "resthouse": "Rest House", "shop": "Shop",
}
_KNOWN_SLUGS = tuple(_TYPE_OVERRIDES) + ("branch",)
_DWELLINGS = {"Apartment", "Villa", "Floor", "Chalet", "Rest House"}
_UTILITY_ROWS = {"الماء": "water_supply", "الكهرباء": "electricity", "الصرف الصحي": "sanitation"}


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def _text(fragment: Optional[str]) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _ids(page: str) -> list[str]:
    out: list[str] = []
    for i in re.findall(r'href="/property/([^/"]+)/details/"', page):
        if i not in out:
            out.append(i)
    return out


def site_total(home: str) -> Optional[int]:
    """«<span class="num">10</span> عقار متاح الآن» — the site's own total, read off the page text."""
    m = re.search(r"(\d[\d,]*)\s*عقار\s*متاح\s*الآن", _text(home))
    return normalize.to_int(m.group(1)) if m else None


def parse_detail(page: str) -> dict[str, Any]:
    """/property/<id>/details/ → the fields listed in the module docstring, as printed."""
    d: dict[str, Any] = {}
    m = re.search(r'class="ref">إعلان رقم\s*([^<]+)<', page)
    d["id"] = m.group(1).strip() if m else None
    m = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    d["title"] = _text(m.group(1)) if m else None
    m = re.search(r'<span class="bdg sale">([^<]*)</span>', page)
    d["deal"] = _text(m.group(1)) if m else None
    m = re.search(r'<p class="loc"[^>]*>(.*?)</p>', page, re.S)
    parts: list[str] = []
    if m:
        loc = re.sub(r'<span class="ref">.*?</span>|<span class="num">.*?</span>\s*مشاهدة', "", m.group(1), flags=re.S)
        parts = [p for p in (_text(x) for x in loc.split('<span class="s"></span>')) if p]
    d["loc_parts"] = parts
    m = re.search(r'<div class="price-big">(.*?)</div>', page, re.S)
    d["price_raw"] = _text(m.group(1)) if m else None
    n = re.search(r'<span class="num">([^<]*)</span>', m.group(1)) if m else None
    d["price"] = normalize.to_int(n.group(1)) if n else None
    p = re.search(r'<span class="per">([^<]*)</span>', m.group(1)) if m else None
    d["period_text"] = _text(p.group(1)) if p else None
    d["facts"] = {_text(k): _text(v) for v, k in
                  re.findall(r'<span class="v">(.*?)</span><span class="k">(.*?)</span>', page, re.S)}
    # Scoped to the listing's own facts block: unscoped, this regex also matches the office
    # sidebar's identically-classed `<div class="rows">` box (and the footer), so a colliding key
    # («رخصة فال» differs on 97AxA: 1100027006 for the listing vs 1200017006 for the office) had
    # dict(rows) silently keep whichever occurred LAST in page order — the office's, not the ad's.
    box = re.search(r'<div class="box rows">(.*?)</div>\s*<div class="sec-h"', page, re.S)
    rows: list[tuple[str, str]] = [(_text(k), _text(v)) for k, v in re.findall(
        r'<div class="row"><span class="k">(.*?)</span><span class="v">(.*?)</span></div>',
        box.group(1) if box else "", re.S)]
    d["rows"] = rows
    m = re.search(r'<div class="amen">(.*?)</div>', page, re.S)
    d["chips"] = [_text(c) for c in re.findall(r"<span>(.*?)</span>", m.group(1), re.S)] if m else []
    m = re.search(r'<div class="desc">(.*?)</div>\s*<div class="sec-h"', page, re.S)
    desc = None
    if m:
        raw = re.sub(r"</(?:p|li|ul|div|br)>|<br\s*/?>", "\n", m.group(1))
        desc = "\n".join(l for l in (_text(x) for x in raw.split("\n")) if l) or None
    d["description"] = desc
    gal = re.search(r'<div class="gal">(.*?)<div class="layout">', page, re.S)
    photos: list[str] = []
    for u in re.findall(r'<img src="(/media/property/images/[^"]+)"', gal.group(1) if gal else ""):
        u = BASE + quote(html.unescape(u), safe="/")
        if u not in photos:
            photos.append(u)
    d["photo_urls"] = photos or None
    m = re.search(r'<source src="(/media/[^"]+)"', page)
    d["video_url"] = BASE + quote(html.unescape(m.group(1)), safe="/") if m else None
    m = re.search(r"maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)", page)
    d["lat"], d["lng"] = (float(m.group(1)), float(m.group(2))) if m else (None, None)
    return d


def _flag(v: str) -> Optional[bool]:
    v = v.strip()
    if v.startswith("غير") or v.startswith("لا"):
        return False
    return True if v.startswith("متوفر") or v == "متاح" else None


def map_listing(slug: str, d: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) from the taxonomy slug the id was listed under + its detail."""
    oid = d.get("id")
    if not oid:
        return None, "residential", "no_id"
    title = d.get("title") or ""
    if "مزاد" in title:
        return None, "residential", "auction"
    property_type = normalize.map_type_exact(slug, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{slug}"
    category = normalize.category_for_type(property_type).lower()
    deal = d.get("deal") or ""
    if deal in ("للبيع",):
        tx = "Buy"
    elif deal in ("للإيجار", "للايجار"):
        tx = "Rent"
    else:
        return None, category, f"deal_unmapped_{deal or 'blank'}"

    parts = d.get("loc_parts") or []
    city_ar = parts[0] if parts else None
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = parts[1] if len(parts) >= 2 else None
    tenants = parts[2] if len(parts) >= 3 else None
    district_ar = find_district_in_text(district_raw, city_id) or find_district_in_text(title, city_id)

    facts = d.get("facts") or {}
    rows = d.get("rows") or []
    description = redact_pii(d.get("description"))
    amen_text = "، ".join(d.get("chips") or []) + "\n" + (description or "")
    age = normalize.parse_property_age(facts.get("عمر العقار"))
    floor_raw = facts.get("الدور")
    floor_num = normalize.to_int(floor_raw) if floor_raw and re.fullmatch(r"[\d٠-٩]+", floor_raw) else None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{oid}",
        "listing_url": f"{BASE}/property/{oid}/details/",
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": description,
        **normalize.amenities_from_text(amen_text),
        "property_type": property_type,
        "transaction_type": tx,
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": normalize.to_int(facts.get("متر مربع")),
        "bedrooms": normalize.to_int(facts.get("غرف نوم")) if property_type in _DWELLINGS else None,
        "bathrooms": normalize.to_int(facts.get("دورات مياه")) if property_type in _DWELLINGS else None,
        "halls": normalize.to_int(facts.get("صالات")),
        "street_width_m": normalize.to_int(facts.get("عرض الشارع")),
        "floor_number": floor_num,
        "property_age": age,
        "license_number": None,              # source publishes only the broker's FAL licence
        "photo_urls": d.get("photo_urls"),
    }
    for k, v in rows:
        col = _UTILITY_ROWS.get(k)
        if col and _flag(v) is not None:
            row[col] = _flag(v)
    price = d.get("price")
    price_note = None
    if tx == "Rent":
        period, row["price_annual"] = normalize.rent_period_and_annual(price, d.get("period_text"))
        if period:
            row["rent_period"] = period
        elif price is not None and row["price_annual"] is None:
            price_note = "period_not_annualizable"
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "source_id": oid,
        "type_slug": slug,
        "tenants": tenants,
        "source_price_raw": d.get("price_raw"),
        "price_note": price_note,
        "floor_label": floor_raw if floor_num is None else None,
        "property_age_raw": facts.get("عمر العقار") if age is None and facts.get("عمر العقار") else None,
        "amenity_chips": d.get("chips") or None,
        "purpose": dict(rows).get("الغرض"),
        "plot_width_m": dict(rows).get("العرض"),
        "plot_length_m": dict(rows).get("الطول"),
        "advertiser_role": dict(rows).get("صفة المعلن"),
        "fal_licence": dict(rows).get("رخصة فال"),
        "posted": dict(rows).get("تاريخ الإضافة"),
        "payment_options": [k for k, v in rows if k.startswith("دفعة") and v == "متاح"] or None,
        "video_url": d.get("video_url"),
        "lat": d.get("lat"), "lng": d.get("lng"),
    }.items() if v is not None}
    return row, category, ""


def fetch_catalogue(s: cc.Session) -> tuple[dict[str, list[str]], Optional[int], list[str]]:
    """{id: [slugs]} from the site's own type pages, the homepage total, and the homepage ids."""
    home = s.get(f"{BASE}/", timeout=40)
    if home.status_code != 200:
        raise RuntimeError(f"homepage returned {home.status_code}")
    total = site_total(home.text)
    slugs = list(_KNOWN_SLUGS)
    for sl in re.findall(r'href="/property/filter-result/([^/"]+)/"', home.text):
        if sl not in slugs:
            slugs.append(sl)
    by_id: dict[str, list[str]] = {}
    for sl in slugs:
        r = s.get(f"{BASE}/property/filter-result/{sl}/", timeout=40)
        if r.status_code != 200:
            raise RuntimeError(f"filter-result/{sl} returned {r.status_code}")
        for i in _ids(r.text):
            by_id.setdefault(i, []).append(sl)
    return by_id, total, _ids(home.text)


def fetch_detail(s: cc.Session, oid: str) -> Optional[dict]:
    r = s.get(f"{BASE}/property/{oid}/details/", timeout=40)
    if r.status_code != 200:
        return None
    return parse_detail(r.text)


# ── LIVENESS (measured 2026-09-24; see docstring) ────────────────────────────────────────────────
def _signal(status, body, _moved):
    if status == 500 and "DoesNotExist" in body:
        return "gone"
    if status == 200:
        m = re.search(r'class="ref">إعلان رقم\s*([^<]+)<', body)
        return "live" if m else None
    return None


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        oid = ad_number[len(PREFIX):]
        if not oid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform="albdah", signal=_signal, session=session,
                             url_for=lambda _ad: f"{BASE}/property/{oid}/details/",
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
    run_id = None if dry else db.begin_run("albdah")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        by_id, total, home_ids = fetch_catalogue(s)
        ids = list(by_id)
        # Completeness = the site's own counter equals what its type pages listed.
        complete = total is not None and total == len(ids) and set(home_ids) <= set(ids)
        print(f"{SOURCE}: {len(ids)} ids on type pages, site says {total}, complete={complete}",
              flush=True)
        if args.limit:
            ids = ids[:args.limit]
        for oid in ids:
            slugs = by_id[oid]
            if len(slugs) != 1:
                skipped["type_ambiguous"] = skipped.get("type_ambiguous", 0) + 1
                continue
            d = fetch_detail(s, oid)
            if d is None:
                complete = False
                skipped["detail_unreachable"] = skipped.get("detail_unreachable", 0) + 1
                continue
            row, cat, why = map_listing(slugs[0], d)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = f"complete={complete} " + _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + _tally(skipped))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):7} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_albdah_*_batch wrappers are added centrally later; same funnel.
        db._wasalt_batch("albdah_residential_listings", res)
        db._wasalt_batch("albdah_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="albdah_residential_listings", com_table="albdah_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("albdah_residential_listings", res), ("albdah_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                            notes=f"pruned={pruned} {notes}"[:300],
                            check_tables=["albdah_residential_listings", "albdah_commercial_listings"])
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
