"""سداسيات العقارية — sodasyat.sa. 11 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24):
  · A custom Laravel-style site (assets under /public, photos on dashboard.sodasyat.sa),
    server-rendered, no JS needed; plain curl_cffi chrome answers 200 everywhere.
  · CATALOGUE = /search — one page, no pager markup; prints its own counter «11 نتيجه» and 11
    distinct card links https://sodasyat.sa/single/<id> (2702, 2721-2722, 2725, 2727-2732, 2734).
    8 of the 11 map; 2729 and 2727 are OFF-PLAN villas («المشروع تحت الإنشاء … بيع على الخارطة»)
    and 2734 is a Wafi PROJECT («سدنة تاون هاوس … تابع لنظام وافي» — نظام وافي is the Saudi
    off-plan sales programme; its specs are the project's 4,891 m² plot, not a unit) → skip
    off_plan, tallied — never shown as available units.
    The counter is the completeness check: counter ≠ links → the enumeration is not complete and
    the run never prunes (bossbih pattern).
  · DETAIL = /single/<id>, keyed by the site's numeric id (ad_number SDS<id>). Its <h1> is
    «اعلان رقم : 7200906376» — a 10-digit REGA advertisement-licence number (7xxxxxxxxx; 10/11
    are 72…, 2725 is 7100307318 — the same shape masar/aalbarrak print under «رقم ترخيص
    الإعلان»; the facts block labels the same number «رقم الترخيص : 7200906376» beside its «تاريخ
    إصدار رخصة الإعلان») → license_number, raw kept in ad_no_raw. The
    office's FAL number (1200016192) sits INSIDE AN HTML COMMENT and is never read: all comments
    are stripped before parsing, which also drops the commented-out «حاله العقار : جديد» and «إسم
    المعلن». The LIVE facts block (one «label : value» <span> per fact, 11/11 measured) publishes
    the Advanced-Filter facts and each lands in its column: «عمر العقار : جديد» → property_age 0
    (the fleet's labelled reader); «عرض الشارع : 15 م» → street_width_m (apartments print «- م»
    → NULL); «واجهة العقار : شرقية» → direction (2734 «غربية - شرقية» = two facades → NULL);
    «خدمات : كهرباء , مياه» → electricity/water_supply True (silent → NULL); «سعر المتر : 7587
    ريال» → price_per_meter AS PRINTED beside the printed total (never multiplied). The block also
    prints «اسم مسؤول الإعلان : <a person>» — PDPL, read by nobody, stored nowhere.
    Fields, all measured on 2721/2702/2734:
      location h4 «منطقة مكة المكرمة ، جدة ، الروضة» → region / city / district (11/11 جدة)
      «قيمه العقار 2,200,000» (+ a SAR glyph, no text) → price_total; «تصنيف الاعلان : بيع» → the
        deal (بيع 11/11; «إيجار» would be Rent and its period would be read from the page's own
        words, NULL when silent); «نوع العقار : شقة» → type
      #project-ing spec grid, TRI-STATE by the site's own wording: «مساحة 290م» (also «120.6م» —
        float kept raw, int stored), «غرف (6)», «حمام (6)» — 2731 prints «حمام (-2)»: a negative
        count is not a count → NULL, the raw spec kept; «غرفة خادمة» / «بدون غرفة خادمة»,
        «بها مصعد» / «بدون مصعد», «غرفة سائق» / «بدون غرفة سائق», «بها جراج» «موقف خاص», «بها مسبح»
        (no column → additional_info.specs). «بدون X» → False, named → True, absent → NULL.
      «قسط شهري يبدأ من 14,391» is a FINANCING instalment (the site brokers mortgages: «بدون دفعة
        أولى … طلب تمويل») — NOT rent, NOT the price → additional_info.monthly_installment_from.
      «الموقع حسب الصك من وزارة العدل: حي الروضة بمدينة جدة مساحة الوحدة من الأرض 144.68 متر …» —
        the deed text, kept raw; its area is the deed's, not the spec's, so it is never the column.
      «تفاصيل اكثر» → description.
  · PHOTOS: https://dashboard.sodasyat.sa/public/storage/photos/<id>.webp from the page (ASCII
    paths). Fetched one: 200 image/webp 593 KB.
  · REMOVAL ORACLE: a gone id answers HTTP 302 Location: /search (4/4: 2710, 2723, 2733, 99999 —
    ids the catalogue does not hold), i.e. the listing path is LEFT; a live id answers 200 on its
    own /single/<id> with the «اعلان رقم» h1 (3/3: 2702, 2721, 2734). So: landed off the path →
    gone; 200 on the path with the h1 → live; anything else → no opinion (the law then holds).
"""
from __future__ import annotations

import argparse
import html as _html
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

BASE = "https://sodasyat.sa"
SOURCE = "سداسيات العقارية"
PREFIX = "SDS"

TYPE_OVERRIDES = {"شقق": "Apartment", "فلل": "Villa", "أدوار": "Floor", "عمارة سكنية": "Building"}
_DEAL = {"بيع": "Buy", "للبيع": "Buy", "إيجار": "Rent", "ايجار": "Rent", "للإيجار": "Rent", "للايجار": "Rent"}
_CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|مباع|محجوز")
_AUCTION_RE = re.compile(r"مزاد")
# «قريبا» is left-anchored so «تقريبا» (approximately, common beside areas) can never read as coming soon.
# «وافي» = نظام وافي, the off-plan sales programme: a project «تابع لنظام وافي» is sold on the map.
_OFFPLAN_RE = re.compile(r"(?<![ء-ي])قريبا|(?<![ء-ي])قريباً|على الخارطة|تحت الإنشاء|تحت الانشاء|(?<![ء-ي])وافي(?![ء-ي])")
_ID_RE = re.compile(r'href="https://sodasyat\.sa/single/(\d+)"')
_COUNTER_RE = re.compile(r"([\d٠-٩]+)\s*نتيج")
_NUM = r"([\d٠-٩][\d٠-٩,]*(?:\.[\d٠-٩]+)?)"
_AR_PHONE_RE = re.compile(r"[٠]?٥[٠-٩]{8}")
# spec keyword → tri-state column (named → True, «بدون …» → False, absent → NULL)
SPEC_COLS = (("مصعد", "elevator"), ("غرفة خادمة", "maid_room"), ("غرفة سائق", "driver_room"),
             ("جراج", "parking"), ("موقف", "parking"), ("مطبخ", "kitchen"), ("مكيف", "air_conditioner"),
             ("مفروش", "furnished"), ("مؤثث", "furnished"), ("مدخل خاص", "private_entrance"),
             ("بلكون", "balcony_terrace"), ("تراس", "balcony_terrace"), ("حوش", "balcony_terrace"))
# «خدمات : كهرباء , مياه» — the services the site names; silence stays NULL.
SERVICE_COLS = (("كهرباء", "electricity"), ("مياه", "water_supply"), ("ماء", "water_supply"), ("صرف", "sanitation"))


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — never set one. Only Accept-* are ours.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _strip(h: Optional[str]) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    out = redact_pii(text)
    return _AR_PHONE_RE.sub("[redacted]", out) if isinstance(out, str) else out


def _num(text: Optional[str]) -> Optional[float]:
    m = re.search(_NUM, text or "")
    if not m:
        return None
    try:
        return float(m.group(1).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).replace(",", ""))
    except ValueError:
        return None


def catalogue(page_html: str) -> tuple[list[str], Optional[int], dict[str, list[str]]]:
    """(ids in page order, the site's own «N نتيجه» counter or None, card spec texts per id).
    The card states negations the detail page omits («بدون مصعد», «بدون غرفة سائق» on 2734/2732)
    — the source's own words about the listing, so they feed the tri-state columns too."""
    ids = list(dict.fromkeys(_ID_RE.findall(page_html)))
    m = _COUNTER_RE.search(_strip(page_html))
    cards: dict[str, list[str]] = {}
    for item in page_html.split('<div class="item">')[1:]:
        link = _ID_RE.search(item)
        if link:
            cards[link.group(1)] = [x for x in (_strip(v) for v in re.findall(r"<span>(.*?)</span>", item, re.S)) if x]
    return ids, (normalize.to_int(m.group(1)) if m else None), cards


def parse_detail(page_html: str) -> dict[str, Any]:
    """The listing's own fields. HTML comments are removed FIRST: the page comments out an
    advertiser-name field, a «حاله العقار» field and the office's FAL licence, none of which is
    published to the user."""
    h = re.sub(r"<!--.*?-->", " ", page_html, flags=re.S)
    t = _strip(h)
    ad_no = re.search(r"اعلان رقم\s*:\s*([\d٠-٩]+)", t)
    loc = re.search(r'uk-icon="icon: location"></span>(.*?)</h4>', h, re.S)
    price = re.search(r"قيمه العقار\s*</h5>(.*?)</div>", h, re.S)
    inst = re.search(r"قسط شهري يبدأ من\s*</h5>(.*?)</p>", h, re.S)
    deed = re.search(r"الموقع حسب الصك من وزارة العدل:\s*</strong>\s*</h3>\s*<h2[^>]*>(.*?)</h2>", h, re.S)
    grid = re.search(r'id="project-ing".*?</div>', h, re.S)
    # «تفاصيل اكثر» is a tab label; its text is the first <p> of the uk-switcher panel below it.
    desc = re.search(r'class="uk-switcher[^"]*">\s*<p[^>]*>(.*?)</p>', h, re.S)
    # Every «label : value» <span> of the comment-stripped page (deal, type, age, street, facade,
    # services, per-metre price …). Only named labels are ever read; the block also carries a
    # person's name («اسم مسؤول الإعلان») that no caller touches.
    facts: dict[str, str] = {}
    for sp in re.findall(r"<span>(.*?)</span>", h, re.S):
        k, sep, v = _strip(sp).partition(":")
        if sep and k.strip():
            facts.setdefault(k.strip(), v.strip())
    return {
        "ad_no": ad_no.group(1).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")) if ad_no else None,
        "location": [x.strip() for x in _strip(loc.group(1)).split("،")] if loc else [],
        "price_text": _strip(price.group(1)) if price else "",
        "installment_text": _strip(inst.group(1)) if inst else "",
        "deed_text": _strip(deed.group(1)) if deed else "",
        "specs": [x for x in (_strip(v) for v in re.findall(r"<span>(.*?)</span>", grid.group(0), re.S)) if x]
        if grid else [],
        "description": _strip(desc.group(1)) if desc else "",
        "deal_text": facts.get("تصنيف الاعلان") or None,
        "type_text": facts.get("نوع العقار") or None,
        "facts": facts,
        "photos": list(dict.fromkeys(re.findall(r'https://dashboard\.sodasyat\.sa/public/storage/photos/[^"\s]+', h))),
    }


def specs_to_fields(specs: list[str]) -> tuple[dict[str, Any], list[str]]:
    """The spec grid → (columns, leftover spec texts). Tri-state by the site's own wording."""
    cols: dict[str, Any] = {}
    rest: list[str] = []
    for sp in specs:
        if sp.startswith("تأسيس") or sp.startswith("تاسيس"):
            rest.append(sp)          # «تأسيس مصعد» = a prepared shaft, not an elevator → NULL
            continue
        neg = sp.startswith("بدون")
        core = re.sub(r"^(?:بدون|بها|به|يوجد)\s*", "", sp).strip()
        if core.startswith("مساحة"):
            a = _num(core)
            if a is not None and a > 0:
                cols["area_m2"], cols["_area_raw"] = int(a), core
            continue
        if (core.startswith("غرف") and "(" in core) or core.startswith("حمام"):
            n = None if re.search(r"\(\s*-", core) else normalize.to_int(core)
            if n is None:
                rest.append(sp)      # «حمام (-2)» (live on 2731): a negative count is not a count → NULL
            else:
                cols["bedrooms" if core.startswith("غرف") else "bathrooms"] = n
            continue
        col = next((c for k, c in SPEC_COLS if k in core), None)
        if col:
            cols[col] = not neg
        else:
            rest.append(sp)
    return cols, rest


def map_listing(pid: str, d: dict[str, Any], card_specs: list[str] = ()) -> tuple[Optional[dict], str, str]:
    if not d.get("ad_no"):
        return None, "residential", "not_a_listing_page"
    desc = d.get("description") or ""
    words = " ".join([desc, *(d.get("specs") or []), *card_specs, d.get("deed_text") or ""])
    if _AUCTION_RE.search(words):
        return None, "residential", "auction"
    if _CLOSED_RE.search(words):
        return None, "residential", "sold_or_rented"
    if _OFFPLAN_RE.search(words):
        return None, "residential", "off_plan"
    deal = _DEAL.get((d.get("deal_text") or "").strip())
    if not deal:
        return None, "residential", "no_deal_stated"
    type_ar = d.get("type_text")
    property_type = normalize.map_type_exact(type_ar, TYPE_OVERRIDES) if type_ar else None
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    loc = d.get("location") or []
    region_raw = loc[0].removeprefix("منطقة").strip() if loc else None
    city_raw = loc[1] if len(loc) > 1 else None
    district_raw = loc[2] if len(loc) > 2 else None
    if not city_raw:
        return None, category, "city_not_stated"
    city_id, region_id = to_catalog(city_raw, region_raw)
    if not city_id:
        return None, category, "city_not_in_catalog"

    price = _num(d.get("price_text"))
    price = int(price) if price is not None else None
    facts = d.get("facts") or {}
    # The card's specs fill what the detail page leaves silent (its negations); the detail wins.
    card_cols, _ = specs_to_fields([sp for sp in card_specs if not sp.startswith("جدة")])
    cols, leftover = specs_to_fields(d.get("specs") or [])
    cols = {**card_cols, **cols}
    area_raw = cols.pop("_area_raw", None)
    services = facts.get("خدمات") or ""
    cols.update({c: True for k, c in SERVICE_COLS if k in services})
    ppm = _num(facts.get("سعر المتر"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/single/{pid}",
        "source": SOURCE,
        "active": True,
        "title": f"{type_ar} — {district_raw or city_raw}",
        "description": _redact(desc) if desc else None,
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_raw),
        "city_ar": city_raw,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": find_district_in_text(district_raw, city_id) if district_raw else None,
        "neighborhood": district_raw,
        # The page labels it «رقم الترخيص : 72…» in the facts block (the h1 «اعلان رقم» repeats it).
        "license_number": next((x for x in (facts.get("رقم الترخيص"), d["ad_no"]) if re.fullmatch(r"7[0-9]{9}", x or "")), None),
        # The facts block, each through the fleet reader: «جديد» → 0, «- م» → NULL, two facades → NULL.
        "property_age": normalize.age_from_labelled_prose(f"عمر العقار : {facts['عمر العقار']}") if facts.get("عمر العقار") else None,
        "street_width_m": normalize.one_street_width(facts.get("عرض الشارع")),
        "direction": normalize.one_direction(facts.get("واجهة العقار")),
        "price_per_meter": int(ppm) if ppm else None,          # as printed; the total is printed too
        "photo_urls": (d.get("photos") or [])[:20] or None,
        **cols,
    }
    if deal == "Rent":
        row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(price, words)
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar, "deal_ar": d.get("deal_text"), "ad_no_raw": d["ad_no"],
        "region_raw": region_raw, "price_raw": d.get("price_text") or None, "area_raw": area_raw,
        "monthly_installment_from": (lambda x: int(x) if x else None)(_num(d.get("installment_text"))),
        "age_raw": facts.get("عمر العقار") or None, "street_raw": facts.get("عرض الشارع") or None,
        "facade_raw": facts.get("واجهة العقار") or None, "services_raw": services or None,
        "price_per_meter_raw": facts.get("سعر المتر") or None,
        "deed_location_text": d.get("deed_text") or None, "specs": leftover or None,
        "photo_count": len(d.get("photos") or []) or None,
    }.items() if v is not None}
    return row, category, ""


# ── fetch ─────────────────────────────────────────────────────────────────────────────────────────
def fetch(s: cc.Session, url: str) -> tuple[Optional[int], str, str]:
    """(status, final url, body) — the final url is how a gone id shows itself (302 → /search)."""
    try:
        r = s.get(url, timeout=45, allow_redirects=True)
        return r.status_code, str(r.url or url), r.text or ""
    except Exception:  # noqa: BLE001
        return None, url, ""


# ── LIVENESS ─────────────────────────────────────────────────────────────────────────────────────
def _signal(status, body, path_changed):
    if status == 200 and path_changed and "جميع العقارات" in body:
        return "gone"          # 302 → /search, whose title is «سداسيات - جميع العقارات» (4/4 gone ids)
    if status == 200 and "اعلان رقم" in body:
        return "live"
    return None


_probe = LivenessProbe(platform="sodasyat", signal=_signal, session=session,
                       url_for=lambda ad: f"{BASE}/single/{ad[len(PREFIX):]}" if ad[len(PREFIX):].isdigit() else None)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("sodasyat")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    ids: list[str] = []
    try:
        status, _url, body = fetch(s, f"{BASE}/search")
        ids, counter, cards = catalogue(body) if status == 200 else ([], None, {})
        if not ids:
            raise RuntimeError(f"/search answered HTTP {status} with no listing links")
        if args.limit:
            ids = ids[:args.limit]
        print(f"{SOURCE}: {len(ids)} listings discovered (site counter {counter})", flush=True)
        fetched = 0
        for pid in ids:
            st, landed, page = fetch(s, f"{BASE}/single/{pid}")
            time.sleep(0.6)
            if st != 200 or not page:
                skipped["fetch_failed"] = skipped.get("fetch_failed", 0) + 1
                continue
            if f"/single/{pid}" not in landed:
                skipped["redirected_off_listing"] = skipped.get("redirected_off_listing", 0) + 1
                continue
            fetched += 1
            row, cat, why = map_listing(pid, parse_detail(page), cards.get(pid, []))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        complete = not args.limit and counter == len(ids) and fetched == len(ids)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:15]:
                am = {k: r0[k] for k in ("elevator", "maid_room", "driver_room", "parking") if k in r0}
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):5} d={str(r0['district_ar'])[:12]:12} a={str(r0.get('area_m2')):>4} "
                      f"bd={str(r0.get('bedrooms')):>2} ba={str(r0.get('bathrooms')):>2} pt={r0.get('price_total')} "
                      f"lic={r0['license_number']} ph={len(r0.get('photo_urls') or [])} {am}")
            return 0
        # The public upsert_sodasyat_*_batch wrappers are added centrally later; same funnel.
        db._wasalt_batch("sodasyat_residential_listings", res)
        db._wasalt_batch("sodasyat_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="sodasyat_residential_listings", com_table="sodasyat_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            for tbl, rows in (("sodasyat_residential_listings", res), ("sodasyat_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=_probe.verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print(f"  ⚠ enumeration incomplete (counter {counter}, links {len(ids)}, read {fetched}) — no prune")
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; complete={complete}; {notes}"[:300],
                             check_tables=["sodasyat_residential_listings", "sodasyat_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            notes = f"{e}"[:200] + " | skips: " + ",".join(f"{k}x{v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=len(ids), rows_upserted=0, notes=notes[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
