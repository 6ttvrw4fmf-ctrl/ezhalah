"""نوافذ الوطن (nawafethalwatan.com) — «منصة نوافذ الوطن», a REGA-licensed ad platform (FAL platform
licence 1200026976). Onboarding 2026-09-26 (wave 3).

SOURCE SHAPE (measured live 2026-09-26 before any code was written)
=====================================================================
Server-rendered ASP.NET MVC. The listing is an antiforgery-protected POST:
  GET  /                                   → cookie + hidden `__RequestVerificationToken`
  POST /Home/FilterAdvertisment            → HTML cards (`<input class="adsId" value="N">`) plus
       filter.page=N, filter.pageSize=10     `<input class="hasMoreAds" value="0|1">`
Pages 1-2 held 20 ids (151, 153-158, 160-165, 168-174), page 2 said hasMoreAds=0, page 3 was empty.
  GET  /Advserments/GetAdvsertismentDetail?advsertismentId=<id>
       → one labelled block, `<p>LABEL: <span class="text-primary">VALUE</span></p>`, printed twice
         (mobile + desktop; identical). A bad id answers 404 today (159, 1, 0, abc), but a page is
         judged by CONTENT, never status: a real listing carries «رقم ترخيص الإعلان» and a title.
Id 152 answers 200 with a full block but is NOT in the list — its licence expired 2026-06-25. Ids
come only from the POST walk; nothing is enumerated.

PRICE (owner rule 2026-09-26). «سعر الوحدة» is a TOTAL for built units («5500000 ر.س» on a villa)
but a PER-m² rate for land («120 ر.س» on 210 m², «4300 ر.س» on 702 m²). So a plot's figure goes to
`price_per_meter` with `price_total` NULL — the search layer shows ppm × area as a labelled ≈ total;
this scraper never multiplies. A land figure above 50,000 SAR/m² cannot be a per-m² rate and is
not stored at all: the row is skipped, counted, "land_price_ambiguous".

DEAL (owner rule 2026-09-26). The source has NO deal field (the filter form has none either). The
only statement is the title's «للبيع» / «للإيجار» (+ «للاستئجار» …). Exactly one → that deal;
neither or both (#169 «للبيع أو الاستئجار») → skipped, "deal_not_stated". Never from type or price.
«بيع» alone is NOT a sale word: it is inside «الربيع» (#174 «فيلا في الربيع»).

ROOMS. «عدد الغرف» is TOTAL rooms (an office prints 150) — kept as additional_info.total_rooms,
never bedrooms. No bathroom field exists. «0» in a count/width cell is the form default → NULL.

TYPE is «نوع العقار». A plot is Commercial Land only when the source's own «استخدام العقار» says
«تجاري» (the fleet reading, as macsaib). «شقَّة صغيرة (استوديو)» → Studio (abaad's fold).

NOT STORED: coordinates — the page's map pin is unreliable (#156, a plot in دخنه/القصيم, is pinned
at 27.02, 49.57 in the Eastern Province). The header date carries no label saying whether it is a
posting or an update date, so it is kept in additional_info only, never as date_added.

PDPL: «اسم/رقم الموظف المسؤول عن الاعلان» and the header «الإسم» are never read into the row.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

SITE = "https://nawafethalwatan.com"
SOURCE = "نوافذ الوطن"
PREFIX = "NWF"
SLUG = "nawafeth"
IMPERSONATE = "chrome"
TIMEOUT = 40
LAND_PPM_MAX = 50_000   # owner: a land figure above this is not a per-m² rate → skip, never store

_MARKS = dict.fromkeys(list(range(0x064B, 0x0653)) + [0x0640, 0x0670])   # harakat + tatweel
_TYPE_OVERRIDES = {"شقة صغيرة (استوديو)": "Studio"}
_LAND_WORDS = {"ارض", "أرض"}
_LABEL_RE = re.compile(r'<p>\s*([^<:]+?)\s*:\s*<span class="text-primary">(.*?)</span>', re.S)
_PHOTO_RE = re.compile(r'<img src="(https://dashboard\.nawafethalwatan\.com/images/Advertisment/[^"]+)"'
                       r'[^>]*class="pro-slide-img')
# A deal WORD, whole, with its own prefix (و/ل/لل/ال/ب/بال) — «الربيع» must not read as «بيع».
_P = r"(?<!\w)(?:و?(?:لل|بال|ال|ل|ب))?"
_SALE_RE = re.compile(_P + r"بيع(?!\w)")
_RENT_RE = re.compile(_P + r"(?:ايجار|استئجار|تاجير)(?!\w)")
_EXCLUDE = [("auction", re.compile(r"مزاد")),
            ("offplan", re.compile(r"على\s*الخارطة|على\s*الخارطه|تحت\s*الانشاء|قيد\s*الانشاء")),
            ("test_row", re.compile(r"تجربة|تجربه|\btest\b", re.I))]


def _alif(s: str) -> str:
    return s.translate(_MARKS).replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")


def labels(page: str) -> dict[str, str]:
    """Every «LABEL: VALUE» pair of the detail block (first occurrence wins; the block is doubled)."""
    out: dict[str, str] = {}
    for m in _LABEL_RE.finditer(page):
        out.setdefault(m.group(1).strip(), re.sub(r"\s+", " ", html.unescape(m.group(2))).strip())
    return out


def photos(page: str) -> list[str]:
    """The listing's own gallery (#big slides) — not thumbs, not «إعلانات مشابهة»."""
    return list(dict.fromkeys(_PHOTO_RE.findall(page)))


def deal_from_title(title: str) -> Optional[str]:
    t = _alif(title or "")
    sale, rent = bool(_SALE_RE.search(t)), bool(_RENT_RE.search(t))
    return "Buy" if sale and not rent else "Rent" if rent and not sale else None


def expiry(raw: str) -> Optional[date]:
    """«2027-01-23» or «07/10/2026» (DD/MM/YYYY — 15/08, 23/06, 26/01, 30/11 fix the order)."""
    raw = (raw or "").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).strip()
    try:
        if m := re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw):
            return date(int(m[1]), int(m[2]), int(m[3]))
        if m := re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw):
            return date(int(m[3]), int(m[2]), int(m[1]))
    except ValueError:
        return None
    return None


def _num(raw: Optional[str]):
    """A verbatim positive number (int when whole), Arabic-Indic digits read as 0-9; 0/blank → None."""
    s = (raw or "").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩٫", "0123456789.")).replace(",", "").strip()
    try:
        f = float(s)
    except ValueError:
        return None
    return None if f <= 0 else int(f) if f.is_integer() else f


def map_listing(ad_id: int, page: str, today: date) -> tuple[Optional[tuple[dict, str]], str]:
    """((row, category) | None, skip_reason) for one detail page."""
    kv = labels(page)
    title = kv.get("عنوان الإعلان") or ""
    if not kv.get("رقم ترخيص الإعلان") or not title:
        return None, "not_a_listing"                      # a 200 without the licence block is no listing
    exp = expiry(kv.get("تاريخ انتهاء رخصة الاعلان", ""))
    if exp is None:
        return None, "licence_expiry_unreadable"
    if exp < today:
        return None, "licence_expired"
    for why, rx in _EXCLUDE:
        if rx.search(_alif(title)):
            return None, why

    type_ar = (kv.get("نوع العقار") or "").translate(_MARKS).strip()
    ptype = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES)
    if not ptype:
        return None, f"type_unmapped_{type_ar or 'blank'}"
    usage = kv.get("استخدام العقار") or None
    is_land = type_ar in _LAND_WORDS
    if is_land and usage == "تجاري":
        ptype = "Commercial Land"
    category = normalize.category_for_type(ptype).lower()

    deal = deal_from_title(title)
    if not deal:
        return None, "deal_not_stated"

    price_raw = kv.get("سعر الوحدة")
    price = normalize.to_int(price_raw)
    price = price if price and price > 0 else None
    if is_land and price and price > LAND_PPM_MAX:
        return None, "land_price_ambiguous"

    city_raw = kv.get("المدينة") or None
    region_raw = kv.get("المنطقة") or None
    city_id, region_id = to_catalog(city_raw, region_raw) if city_raw else (None, None)
    district_raw = kv.get("الحي") or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw and city_id else None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ad_id}",
        "listing_url": f"{SITE}/Advserments/GetAdvsertismentDetail?advsertismentId={ad_id}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": None,                               # the source publishes no free text
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # provably Buy/Rent: an unstated deal was already skipped above
        "city": normalize.map_city(city_raw) if city_id else None,
        "city_ar": city_raw if city_id else None,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _num(kv.get("مساحة العقار")),
        "bedrooms": None,                                  # «عدد الغرف» is TOTAL rooms, not bedrooms
        "bathrooms": None,
        "property_age": normalize.parse_property_age(kv.get("عمر العقار") or None),
        "street_width_m": _num(kv.get("عرض الشارع")),
        "direction": normalize.one_direction(kv.get("واجهة العقار") or None, diagonal=True),
        "plan_parcel": kv.get("رقم القطعة") or None,
        "license_number": kv.get("رقم ترخيص الإعلان"),
        "license_expiry": exp.isoformat(),
        "photo_urls": photos(page) or None,
        "price_per_meter": price if is_land else None,
    }
    if is_land:
        row["price_total"] = None                          # never ppm × area here; the search layer does it
        if deal == "Rent":
            row["rent_period"], row["price_annual"] = None, None
    elif deal == "Buy":
        row["price_total"] = price
    else:
        row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(price, title)

    stored = row["price_per_meter"] if is_land else row.get("price_total" if deal == "Buy" else "price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="سعر الوحدة", raw=price_raw, stored=stored,
        kind="per_meter" if is_land else ("total" if deal == "Buy" else (row.get("rent_period") or "annual")),
        unit="per_meter" if is_land else "total", origin="structured", authoritative_absent=False)
    info = {
        "source_id": ad_id,
        "type_ar": kv.get("نوع العقار"),
        "usage_ar": usage,
        "region_ar": region_raw,
        "city_printed": city_raw,
        "price_printed": price_raw,
        "price_is_per_meter": is_land or None,
        "area_printed": kv.get("مساحة العقار"),
        "total_rooms": normalize.to_int(kv.get("عدد الغرف")) or None,
        "plan_number": kv.get("رقم المخطط") or None,
        "fal_license_number": kv.get("رقم رخصة فال للوساطة والتسويق العقاري") or None,
        "licence_expiry_printed": kv.get("تاريخ انتهاء رخصة الاعلان"),
        "deed_location_ar": redact_pii(kv.get("وصف موقع العقار حسب الصك") or None),
        "other_obligations_ar": redact_pii(kv.get("الالتزامات الاخرى على العقار") or None),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    return (row, category), ""


def walk(s: cc.Session) -> tuple[list[int], bool]:
    """Every id the POST listing returns; `complete` = the source itself said hasMoreAds=0."""
    home = s.get(f"{SITE}/", impersonate=IMPERSONATE, timeout=TIMEOUT)
    home.raise_for_status()
    tok = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', home.text)
    if not tok:
        raise RuntimeError("no __RequestVerificationToken on / — the POST would be refused")
    ids: list[int] = []
    for page in range(1, 101):
        r = s.post(f"{SITE}/Home/FilterAdvertisment", impersonate=IMPERSONATE, timeout=TIMEOUT,
                   data={"__RequestVerificationToken": tok.group(1), "filter.page": str(page),
                         "filter.pageSize": "10"})
        r.raise_for_status()
        got = [int(x) for x in re.findall(r'class="adsId" value="(\d+)"', r.text)]
        ids += [i for i in got if i not in ids]
        more = re.search(r'class="hasMoreAds" value="(\d)"', r.text)
        if not got or not more or more.group(1) == "0":
            return ids, bool(more) and more.group(1) == "0"
    return ids, False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")   # the fleet workflow passes --type all to every scraper
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    ids, walked_to_end = walk(s)
    if a.limit:
        ids = ids[: a.limit]
    print(f"{SOURCE}: {len(ids)} listing id(s) (walk reached hasMoreAds=0: {walked_to_end})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, list[int]] = {}
    unreadable = 0
    today = date.today()
    try:
        for ad_id in ids:
            try:
                r = s.get(f"{SITE}/Advserments/GetAdvsertismentDetail?advsertismentId={ad_id}",
                          impersonate=IMPERSONATE, timeout=TIMEOUT)
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_listing(ad_id, r.text if r.status_code == 200 else "", today)
            if not got:
                if why == "not_a_listing":
                    unreadable += 1                        # a listed id with no listing → no prune
                skipped.setdefault(why, []).append(ad_id)
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)

        if skipped:
            print("  skipped (not guessed): " + ", ".join(
                f"{k}x{len(v)} {v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in (res[:3] + com[:2]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_per_meter",
                       "price_annual", "rent_period", "area_m2", "city_ar", "district_ar", "neighborhood",
                       "listing_url")}, ensure_ascii=False))
            return 0

        db.upsert_nawafeth_residential_batch(res)
        db.upsert_nawafeth_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="nawafeth_residential_listings", com_table="nawafeth_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and not a.limit and walked_to_end
        for tbl, rr in (("nawafeth_residential_listings", res), ("nawafeth_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable detail(s) or a short walk this run", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             check_tables=["nawafeth_residential_listings", "nawafeth_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(ids), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
