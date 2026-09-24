"""فقط نقطة العقارية — just.sa. A Riyadh/Jeddah brokerage with its own PHP catalogue. Onboarding
2026-09-24.

SOURCE SHAPE (measured live 2026-09-24, before any code)
========================================================
· The home page is a client-side app; its JS reads ONE JSON route, which is the catalogue:
      GET /index.php?ajax=1&page=<n>&per_page=100[&type=sale|rent]
  → {"units":[…], "stats":{"page","pages","total"}}. Measured: no type → total 80 (sale 73 + rent 7),
  per_page=100 honoured (73 sale rows on one page), 80 distinct ids. The crude scan's "0" was the
  empty server-rendered shell — the count is in this JSON.
· A unit record carries: id, ad_number («J1275», the site's own displayed ad number), city,
  neighborhood, status («متاح» 78, «مباع» 1, «مؤجر» 1), price (an integer, NO period word),
  unit_type («شقة» 19, «دور أرضي» 18, «دور علوي» 16, «فيلا» 14, «تاون هاوس» 9, «بينتهاوس» 4),
  property_role («بيع» 73 / «إيجار» 7), land_area, bedrooms, facade («شرقية», «شماليه», «الجنوبية
  الغربية» …), street_width, image1, license_number (76/80), created/updated, ratings.
· DETAIL PAGE = /l/<id> (the JS card link and the site's share URL). Server-rendered; a user lands on
  THAT unit (checked: /l/373 shows «تاون هاوس … العارض - الرياض … 1,792,000 … J1275»). It adds the
  facts the JSON lacks, as `<div class="spec-item"><span>LABEL</span><strong>VALUE</strong>`:
  المساحة, المسطح (built-up), عمر العقار («جديد»), الغرف, الحمامات, المجالس, عرض الشارع («30 م»),
  الواجهة; a «مميزات المشروع» grid («سطح», «غرفة غسيل», «غرفة خادمة», «غرفة سائق», «مطبخ راكب»,
  «مكيفات», «ضمانات», «تأمين» …); the description under «تفاصيل الوحدة»; the price card
  (`rv-price-card`: an optional «قابل للتفاوض» pill, the figure, `<em>ترخيص: N</em>`); and a
  `data-media='[{"type":"img","src":…}]'` gallery. The detail is fetched for every unit, and a row
  only takes the stamp of a direct read when the page names this unit's J-number.
· PERIOD: the 7 rent prices carry NO period word anywhere — not in the JSON, not on the detail page
  (170,000 / 35,000 / 55,000 …). rent_period stays NULL and price_annual holds the figure as
  printed, unconverted (the standing silent-period rule). rent_period_and_annual is still run over
  the price-card text so a period word the site adds later is honoured on the source's own word.
· PII: the detail page shows the marketer's personal name and avatar (`rv-agent-mini`); that block
  is never read. The description is passed through pii.redact_pii.
· TYPES: «دور أرضي»/«دور علوي» → Floor (the bare «دور» is Floor); «تاون هاوس» → Villa and
  «بينتهاوس» → Apartment follow the fleet's own folds (rawasidark / rakez / dealapp).
· PRICE = SOURCE: J1516 is a «دور أرضي» for sale at 900 — stored as 900 (a 1-riyal ad stays 1).

REMOVAL ORACLE (measured 2026-09-24)
  /l/<id> for ids that are not units (1, 5, 300, 99999) → HTTP 200 with a 25-byte body that is
  exactly «لم يتم العثور على الوحدة» — 4/4. Five live controls (373, 672, 690, 411, 714) → HTTP 200,
  57-64 KB, the page names the unit's J-number — 5/5. A sold/rented unit's page still renders (624
  «مباع», 674 «مؤجر») with `property-status` carrying that word, which is this source's second
  death signal. So: 200 + the not-found sentence + no «تفاصيل سريعة» → GONE; 200 + «تفاصيل سريعة» +
  a J-number + status «متاح» → LIVE; anything else → no opinion (the shared law handles blocks).

WRITES go through db._wasalt_batch on the two justsa tables (the public upsert_justsa_*_batch
wrappers are added centrally later, with the tables).
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
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://just.sa"
SOURCE = "فقط نقطة العقارية"
PREFIX = "JST"
CATALOGUE = f"{BASE}/index.php"
PAUSE = 0.5   # seconds between detail fetches — a small office, be polite

_TYPE_OVERRIDES = {
    "دور أرضي": "Floor", "دور علوي": "Floor",
    "تاون هاوس": "Villa",        # fleet fold: TYPE_MAP_EN 'Townhouse' → 'Villa' (rawasidark)
    "بينتهاوس": "Apartment",     # a penthouse is sold as an apartment (rakez, dealapp)
}
_AVAILABLE = "متاح"
_NOT_FOUND = "لم يتم العثور على الوحدة"
_SPEC_RE = re.compile(r'<div class="spec-item">.*?<span>(.*?)</span>\s*<strong>(.*?)</strong>', re.S)
_FEATURE_RE = re.compile(r'<div class="feature-text">(.*?)</div>', re.S)
_DESC_RE = re.compile(r'<div class="unit-details">(.*?)</div>', re.S)
_PRICE_CARD_RE = re.compile(r'<div class="rv-price-card">(.*?)</div>\s*<div class="rv-agent-mini">', re.S)
_STATUS_RE = re.compile(r'class="property-status[^"]*">\s*(.*?)\s*<', re.S)
_MEDIA_RE = re.compile(r"data-media='(\[.*?\])'", re.S)
_JNUM_RE = re.compile(r"\bJ\d{3,6}\b")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent — never set one here
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _pos(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], int]:
    """Every unit record, plus the site's own stats.total as the completeness check."""
    out: list[dict] = []
    total = 0
    page = 1
    while True:
        r = s.get(CATALOGUE, params={"ajax": 1, "page": page, "per_page": 100},
                  headers={"Accept": "application/json"}, timeout=40)
        if r.status_code != 200:
            raise RuntimeError(f"catalogue page {page} → HTTP {r.status_code}")
        try:
            j = r.json()
        except ValueError as e:
            raise RuntimeError(f"catalogue page {page} is not JSON ({e})") from e
        stats = j.get("stats") or {}
        total = int(stats.get("total") or total or 0)
        out.extend(j.get("units") or [])
        if limit and len(out) >= limit:
            return out[:limit], total
        if page >= int(stats.get("pages") or 1) or not j.get("units"):
            return out, total
        page += 1


def parse_detail(page_html: str) -> dict[str, Any]:
    """The labelled facts of one /l/<id> page. Only the blocks named in the docstring are read —
    never the marketer card."""
    specs = {plain(k): plain(v) for k, v in _SPEC_RE.findall(page_html)}
    features = [plain(f) for f in _FEATURE_RE.findall(page_html) if plain(f)]
    dm = _DESC_RE.search(page_html)
    pc = _PRICE_CARD_RE.search(page_html)
    card = plain(pc.group(1)) if pc else ""
    lic = re.search(r"ترخيص\s*[:：]\s*([\d٠-٩]{6,12})", card)
    st = _STATUS_RE.search(page_html)
    photos: list[str] = []
    mm = _MEDIA_RE.search(page_html)
    if mm:
        try:
            for item in json.loads(ihtml.unescape(mm.group(1))):
                src = (item or {}).get("src")
                if item.get("type") == "img" and isinstance(src, str) and src.startswith("http"):
                    photos.append(src)
        except (ValueError, AttributeError, TypeError):
            pass
    return {
        "specs": specs,
        "features": features,
        "description": plain(re.sub(r"<br\s*/?>", "\n", dm.group(1))) if dm else None,
        "price_card": card,
        "negotiable": "قابل للتفاوض" in card,
        "license_number": lic.group(1).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")) if lic else None,
        "status": plain(st.group(1)) if st else None,
        "photos": photos,
        "j_numbers": set(_JNUM_RE.findall(page_html)),
    }


def fetch_detail(s: cc.Session, unit_id: int) -> Optional[dict[str, Any]]:
    r = s.get(f"{BASE}/l/{unit_id}", timeout=40)
    if r.status_code != 200 or _NOT_FOUND in (r.text or "") or "تفاصيل سريعة" not in (r.text or ""):
        return None
    return parse_detail(r.text)


def _amenities(features: list[str], description: Optional[str]) -> dict[str, Any]:
    """Prose fills gaps; the feature list decides (joined on «، » so one item's negation cannot
    reach the next). Silence stays absent — NULL, never False."""
    out = dict(normalize.amenities_from_text(description or ""))
    out.update(normalize.amenities_from_text("، ".join(features)))
    return out


def map_listing(u: dict, detail: Optional[dict[str, Any]]) -> tuple[Optional[dict], str, str]:
    uid = u.get("id")
    if not uid:
        return None, "residential", "no_id"
    status = (u.get("status") or "").strip()
    if status != _AVAILABLE:
        return None, "residential", f"status_{status or 'blank'}"
    if detail and detail.get("status") and detail["status"] != _AVAILABLE:
        return None, "residential", f"status_{detail['status']}"
    type_ar = (u.get("unit_type") or "").strip()
    property_type = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()
    role = (u.get("property_role") or "").strip()
    if role == "بيع":
        deal = "Buy"
    elif role == "إيجار":
        deal = "Rent"
    else:
        return None, category, f"deal_unknown_{role or 'blank'}"
    city_raw = (u.get("city") or "").strip()
    if not city_raw:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_raw)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = (u.get("neighborhood") or "").strip() or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    price_raw = u.get("price")
    price = _pos(price_raw)
    d = detail or {}
    specs: dict[str, str] = d.get("specs") or {}
    features: list[str] = d.get("features") or []
    description = redact_pii(d.get("description")) if d.get("description") else None
    photos = [u["image1"] if str(u.get("image1") or "").startswith("http")
              else BASE + u["image1"] for u in [u] if u.get("image1")]
    for p in d.get("photos") or []:
        if p not in photos:
            photos.append(p)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{uid}",
        "listing_url": f"{BASE}/l/{uid}",
        "source": SOURCE,
        "active": True,
        "title": " – ".join(x for x in (type_ar, district_raw, city_raw) if x) or None,
        "description": description,
        **_amenities(features, description),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_raw),
        "city_ar": city_raw,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(u.get("land_area")),                       # the site's headline «المساحة»
        "bedrooms": _pos(u.get("bedrooms")),
        "bathrooms": _pos(specs.get("الحمامات")),
        "reception_rooms_majlis": _pos(specs.get("المجالس")),
        "street_width_m": normalize.one_street_width(u.get("street_width")),
        # The facade is the site's own single-choice cell, so a diagonal («شمالية شرقية») is one
        # answer; «الجنوبية الغربية» goes through the same reader.
        "direction": normalize.one_direction(u.get("facade"), diagonal=True),
        "property_age": normalize.exact_age(specs.get("عمر العقار")),
        "license_number": (str(u.get("license_number") or "").strip() or d.get("license_number") or None),
        "photo_urls": photos[:20] or None,
        "price_evidence": normalize.price_evidence(
            field="units[].price", raw=price_raw, stored=price,
            kind="annual" if deal == "Rent" else "total", origin="api"),
    }
    if deal == "Rent":
        # Only the source's own period word beside the price may set a period; the JSON has none
        # and the price card reads «قابل للتفاوض» at most → NULL, figure unconverted.
        period, annual = normalize.rent_period_and_annual(price, d.get("price_card"))
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "source_ad_number": u.get("ad_number"),
        "unit_id": uid,
        "type_ar": type_ar,
        "status": status,
        "facade_raw": u.get("facade"),
        "street_width_raw": u.get("street_width"),
        "land_area_raw": u.get("land_area"),
        "built_area_raw": specs.get("المسطح"),           # «المسطح 400 م²» — built-up, not the headline
        "age_raw": specs.get("عمر العقار"),
        "specs": specs,
        "features": features,
        "negotiable": True if d.get("negotiable") else None,
        "created_at": u.get("created_at"),
        "updated_at": u.get("updated_at"),
    }.items() if v not in (None, "", {}, [])}
    if detail and u.get("ad_number") in (d.get("j_numbers") or set()):
        # A direct read of THIS unit's own page that named THIS unit — never the list.
        db.mark_direct_alive(row, oracle="just.sa./l/<id>.detail_page")
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
_AD_NUMBER = re.compile(rf"^{PREFIX}(\d+)$")


def _signal(status, body, _moved):
    if status != 200:
        return None
    if _NOT_FOUND in body and "تفاصيل سريعة" not in body:
        return "gone"
    if "تفاصيل سريعة" in body and _JNUM_RE.search(body):
        st = _STATUS_RE.search(body)
        word = plain(st.group(1)) if st else ""
        if word == _AVAILABLE:
            return "live"
        if word in ("مباع", "مؤجر"):
            return "gone"
    return None


def _url_for(ad_number: str) -> Optional[str]:
    m = _AD_NUMBER.match(ad_number)
    return f"{BASE}/l/{m.group(1)}" if m else None


def _make_verify_gone(control):
    def probe(ad_number: str, canary=None) -> tuple[str, str]:
        return LivenessProbe(platform="justsa", signal=_signal, session=session, url_for=_url_for,
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
    ap.add_argument("--no-detail", action="store_true", help="skip the per-unit page (JSON only)")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("justsa")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    detail_hits = 0
    try:
        units, total = fetch_catalogue(s, limit=args.limit)
        print(f"{SOURCE}: {len(units)} units fetched (site says total={total})", flush=True)
        if not units:
            raise RuntimeError("the catalogue endpoint returned no units")
        for u in units:
            seen += 1
            detail = None
            if not args.no_detail and u.get("id") and (u.get("status") or "").strip() == _AVAILABLE:
                try:
                    detail = fetch_detail(s, int(u["id"]))
                except Exception:   # noqa: BLE001 — a missed detail is fewer fields, not a skip
                    detail = None
                time.sleep(PAUSE)
                if detail:
                    detail_hits += 1
            row, cat, why = map_listing(u, detail)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}", flush=True)
        print(f"  detail pages read: {detail_hits}/{seen}", flush=True)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {r0['property_type']:9} "
                      f"{r0['city_ar']:7} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>4} "
                      f"bd={str(r0['bedrooms']):>2} ba={str(r0['bathrooms']):>2} "
                      f"p={r0.get('price_total') or r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"dir={r0.get('direction')} sw={r0.get('street_width_m')} ph={len(r0.get('photo_urls') or [])}")
            return 0

        # The public upsert_justsa_*_batch wrappers are added centrally with the tables.
        db._wasalt_batch("justsa_residential_listings", res)
        db._wasalt_batch("justsa_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="justsa_residential_listings", com_table="justsa_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        # Only after a COMPLETE enumeration (the site's own total agrees), never on --type.
        if args.type == "all" and len(units) >= total:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("justsa_residential_listings", res),
                              ("justsa_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} detail={detail_hits}/{seen} {notes}"[:300],
                             check_tables=["justsa_residential_listings",
                                           "justsa_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
