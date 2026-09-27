"""Manafe («منافع العقارية», manafe.com.sa) — a Jeddah property-management company. Onboarding 2026-09-27 (batch 7).

One listing per AVAILABLE unit row of each building page (a sale BUILDING is one listing — see SALE below).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
TRANSPORT: Cloudflare answers the chrome*/edge*/safari17_0/safari17_2_ios/safari172_ios TLS fingerprints with
a 403 «Just a moment...» JS challenge, and SERVES firefox133/135/144/147, safari15_3/15_5/18_0/18_4/26_0 and
tor145 (all 43 curl_cffi 0.15.0 profiles tried, fresh session each). So the shared http.negotiated_session()
picks a profile the host serves (firefox133 on the measured day) — no browser, no proxy. Photos
(/admin/upfile/…) are not behind the challenge.

DISCOVERY: the index (/index, «جميع المشاريع») links only 40 of the buildings, and its «عرض المزيد»
(`?type=paginate&limit=N`) and search (`?type=filter`) endpoints are broken — every call returns the same one
building (325). The site's own counters on the index declare 185 العمائر · 9 الفلل · 4 المكاتب الادارية ·
9 المعارض التجارية · 3 المستودعات = 210 buildings, so the walk probes /manafemar/project/<id> from 1 upward
until TAIL ids past the highest live id: 210 live ids in 1..345 (widest hole 78: 150→227). The walk is
COMPLETE only when every page read and the per-section tally equals those counters (then prune is allowed).
THREE page kinds, told apart by content (every one is HTTP 200):
  real        — the «القسم العقاري» table + the «الوحده/الوحدات المتاحة» table (the licence row is only
                printed when there is a licence: 70 of 210);
  missing id  — a PHP «Notice: Trying to access array offset on value of type null» shell (46 KB);
  host error  — «Fatal error … PDOException … Operation not permitted» / mysqli_connect (1.2 KB): the
                shared host's DB refuses connections under load (163 of 519 ids with 3 parallel workers,
                0 when sequential). TRANSIENT → retried, then counted unreadable (never read as "gone").
                That page prints the site's DB credentials — it is never stored or logged.

PAGE: licence «رقم الترخيص الإعلاني» (7200935018; «000000000» placeholders on 2 pages = none), «عدد الواحدات»
(the building's total, not what is free), «القسم العقاري» (section), «الغرض العقاري» (purpose — carries the
deal: «… للإيجار» / «عقارات للبيع»), المدينة (all 210: جدة), الحي, العنوان (a street line), N × «تصميم i»
layout lines, and the table «الوحده/الوحدات المتاحة»: unit, type, rooms, halls, baths, kitchens, maid room,
balcony, store, area, price. Layout lines and table rows are the same list (equal counts on all 210 pages).
Measured: 190 buildings with rows · 281 rows · 20 buildings with none.

TRAPS
* TYPE: the unit-type cell «معارض تجارية» is the admin form's DEFAULT, not a type: 153 of its 159 rows sit in
  apartment/office/villa/warehouse buildings and carry bedrooms + kitchens («معارض تجارية», 3 غرف, 1 صالة,
  2 حمام, 1 مطبخ in «شقق للإيجار» buildings). It is ignored and the building's own purpose decides. Any OTHER
  unit type that disagrees with the purpose's category (a «شقة» row in a showroom building, «مكاتب آدارية»
  rows in an apartment building) is SKIPPED as a conflict — never guessed.
* PRICE: «0 ر.س» (97 rows) and an empty «ر.س» are the site's no-price → the source AFFIRMS no price
  (AUTHORITATIVE_NULL, «السعر عند الطلب»). Unit rows otherwise print one plain number, verbatim.
* PERIOD: no page and no card states a period anywhere (0 × سنوي/شهري on all 210 pages). The period comes
  only from the shared rule (≤10,000 looks monthly); above that it stays UNKNOWN — never a hard-coded annual.
  NB 1-room units priced 4,800–10,000 look YEARLY at this company (owner decision pending).
* SALE: a «عقارات للبيع» BUILDING (القسم العمائر) lists its composition as rows — «1 شقة», «10 شقق», «5 معارض»
  — each printing the SAME 9,000,000: that is the building's price, so the building is ONE listing (type
  Building). A sale VILLA row is a villa and stays one listing per row.
* LICENCE: 140 of 210 pages print no REGA ad licence (all 55 all-zero-price buildings among them); the index's
  own 40 are 39 licensed. REQUIRE_AD_LICENCE skips an unlicensed page (counted). Two licences repeat on two
  pages each (283/290 identical villa; 308/311) → the later id is a duplicate of the same ad.
* PHOTOS: the gallery (alt «Property Detail»); 25 buildings show only a placeholder
  «https://manafe.com.saß//public/imgs/main/1x/photo-building.jpg» — only /admin/upfile/ images are kept.
PDPL: the page prints marketing phones, the office e-mail and «اسم المعلن وصفته» — never stored.
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, http, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

INDEX = "https://www.manafe.com.sa/index"
PROJECT = "https://manafe.com.sa/manafemar/project/{}"
SOURCE = "منافع العقارية"
PREFIX = "MNF"
SLUG = "manafe"

TAIL = 150            # ids probed past the highest live id; the widest measured hole is 78 (150→227)
PAUSE = 0.4           # sequential + paced: the shared host's DB refuses connections under parallel load
REQUIRE_AD_LICENCE = True   # an unlicensed page is not published as a listing (owner may flip — see docstring)
SECTIONS = ("العمائر", "الفلل", "المكاتب الادارية", "المعارض التجارية", "المستودعات")
FORM_DEFAULT_UNIT_TYPE = "معارض تجارية"

# This site's own closed vocabulary (unit-type cells, purpose nouns, sections) — exact match only.
_TYPE_OVERRIDES = {
    "معارض تجارية": "Showroom", "مكاتب إدارية": "Office", "مكاتب آدارية": "Office",
    "فيلا عادي": "Villa", "فلل دوبلكس": "Villa", "فلل": "Villa", "الفلل": "Villa",
    "مستودعات": "Warehouse", "العمائر": "Building",
}
_DEAL_RE = re.compile(r"\s*لل(إيجار|ايجار|بيع)\s*$")
_UNIT_COLS = ("name", "type", "rooms", "halls", "baths", "kitchens", "maid", "balcony", "store", "area", "price")


def _clean(raw: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", raw or ""))).strip()


def page_kind(page: str) -> str:
    """'missing' (the id is no project), 'real', or 'unreadable' (host DB error, challenge, anything else)."""
    if "array offset on value of type null" in page:
        return "missing"
    if "القسم العقاري" in page and "الوحده/الوحدات المتاحة" in page:
        return "real"
    return "unreadable"


def fetch(s, n: int) -> str:
    """The project page, "" for an id that is no project; raises when it stays unreadable."""
    why = ""
    for attempt in range(4):
        try:
            r = s.get(PROJECT.format(n), timeout=40)
            kind = page_kind(r.text) if r.status_code == 200 else "unreadable"
            if kind != "unreadable":
                return r.text if kind == "real" else ""
            why = f"HTTP {r.status_code}, {len(r.text)} B"   # never the body: the DB-error page prints credentials
        except Exception as e:  # noqa: BLE001
            why = type(e).__name__
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"project {n} unreadable ({why})")


def declared_counts(index: str) -> dict[str, int]:
    return {lab.strip(): int(n) for n, lab in
            re.findall(r'<strong data-to="(\d+)">\d+</strong>\s*<label>([^<]+)</label>', index)}


def walk(s, floor: int) -> tuple[dict[int, str], list[int]]:
    pages: dict[int, str] = {}
    unreadable: list[int] = []
    n, last = 0, floor
    while n < last + TAIL:
        n += 1
        try:
            page = fetch(s, n)
        except Exception:  # noqa: BLE001
            unreadable.append(n)
            continue
        if page:
            pages[n] = page
            last = max(last, n)
        time.sleep(PAUSE)
    return pages, unreadable


def _field(page: str, label: str) -> Optional[str]:
    m = re.search(r"<td[^>]*>\s*" + label + r"\s*</td>\s*<td[^>]*>(.*?)</td>", page, re.S)
    return _clean(m.group(1)) or None if m else None


def _items(page: str, heading: str) -> list[str]:
    m = re.search(heading + r"\s*</h4>\s*<ul[^>]*>(.*?)</ul>", page, re.S)
    return list(dict.fromkeys(x for x in (redact_pii(_clean(li)) for li in
                                          re.findall(r"<li[^>]*>(.*?)</li>", m.group(1), re.S)) if x)) if m else []


def parse_building(n: int, page: str) -> dict[str, Any]:
    lic = re.search(r"رقم الترخيص الإعلاني\s*:\s*</td>\s*<td[^>]*>\s*([^<]*?)\s*<", page)
    title = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    i = page.find("الوحده/الوحدات المتاحة")
    table = re.sub(r"<!--.*?-->", "", page[i:page.find("</table>", i)] if i >= 0 else "", flags=re.S)
    units = []
    for tr in re.findall(r"<tr>(.*?)</tr>", table, re.S):
        cells = [_clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) == len(_UNIT_COLS):
            units.append(dict(zip(_UNIT_COLS, cells)))
    geo = re.search(r"!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)", page)
    photos = re.findall(r'<img alt="Property Detail" src="\s*(https://manafe\.com\.sa/admin/upfile/[^"\s]+)', page)
    return {
        "id": n, "title": _clean(title.group(1)) if title else None,
        "licence": lic.group(1) if lic and re.fullmatch(r"7\d{9}", lic.group(1)) else None,
        "units_total": _field(page, "عدد الواحدات"), "views": _field(page, "عدد المشاهدات"),
        "section": _field(page, "القسم العقاري"), "purpose": _field(page, "الغرض العقاري"),
        "city": _field(page, "المدينة"), "district": _field(page, "الحي"),
        "address": redact_pii(_field(page, "العنوان") or "") or None,
        "street_facade": _field(page, "مساحة الشارع وواجهة العقار"),
        "specs": _items(page, "المواصفات"), "features": _items(page, "المميزات"),
        "lat": geo.group(2) if geo else None, "lng": geo.group(1) if geo else None,
        "photos": list(dict.fromkeys(photos)), "units": units,
    }


def _type(word: Optional[str]) -> Optional[str]:
    return normalize.map_type_exact(word, _TYPE_OVERRIDES)


def _pos(v: Optional[str]) -> Optional[int]:
    x = normalize.to_int(v)
    return x if x and x > 0 else None   # the form prints 0 for "not filled in" — silent, never a "no"


def map_building(b: dict[str, Any]) -> list[tuple[Optional[tuple[dict, str]], str]]:
    """One ((row, category), "") or (None, reason) per unit row (a sale building: one for the building)."""
    units = b["units"]
    if not units:
        return [(None, "no_available_units")]
    if REQUIRE_AD_LICENCE and not b["licence"]:
        return [(None, "no_rega_ad_licence")] * len(units)
    purpose = b["purpose"] or ""
    m = _DEAL_RE.search(purpose)
    deal = ("Buy" if m.group(1) == "بيع" else "Rent") if m else None
    if not deal:
        return [(None, f"deal_unstated_{purpose}")] * len(units)
    building_type = _type(_DEAL_RE.sub("", purpose)) or _type(b["section"])
    if deal == "Buy" and b["section"] == "العمائر":
        # the rows are the building's composition, each printing the building's one price → ONE listing
        prices = sorted({u["price"] for u in units})
        whole = {"type": "عمارة", "composition": units}
        whole.update({"price": prices[0]} if len(prices) == 1 else {"price_text": " / ".join(prices)})
        return [map_unit(b, whole, 0, deal, building_type)]
    return [map_unit(b, u, i, deal, building_type) for i, u in enumerate(units, 1)]


def map_unit(b: dict[str, Any], u: dict[str, Any], idx: int, deal: str,
             building_type: Optional[str]) -> tuple[Optional[tuple[dict, str]], str]:
    raw_type = (u.get("type") or "").strip()
    unit_type = None if raw_type == FORM_DEFAULT_UNIT_TYPE else _type(raw_type)
    if raw_type and raw_type != FORM_DEFAULT_UNIT_TYPE and not unit_type:
        return None, f"type_unmapped_{raw_type}"
    if not (unit_type or building_type):
        return None, f"type_unmapped_{b['purpose']}"
    if unit_type and building_type and \
            normalize.category_for_type(unit_type) != normalize.category_for_type(building_type):
        return None, f"type_conflict_{raw_type}_vs_{b['purpose']}"
    ptype = unit_type or building_type
    category = normalize.category_for_type(ptype).lower()

    price = _pos(u.get("price"))
    name = redact_pii(u.get("name") or "") or None
    title = " - ".join(x for x in (b["title"], name) if x)
    row: dict[str, Any] = {}
    if deal == "Buy":
        row["price_total"] = price
    else:
        row["rent_period"], row["price_annual"] = normalize.rent_period_from_ad(
            price, f"{title} {b['purpose']}", None, title)   # the site states no period anywhere — no card label
    no_price = price is None and not u.get("price_text")      # the cell reads «0 ر.س» / «ر.س»: the source says none
    if no_price:
        row["price_total" if deal == "Buy" else "price_annual"] = db.AUTHORITATIVE_NULL
    row["price_evidence"] = normalize.price_evidence(
        field="الوحده/الوحدات المتاحة: السعر", raw=u.get("price") or u.get("price_text"), stored=price,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="structured", authoritative_absent=no_price)

    city_ar = b["city"]
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_raw = b["district"]
    district_ar = find_district_in_text("حي " + district_raw, city_id) if (city_id and district_raw) else None
    maid, balcony = _pos(u.get("maid")), _pos(u.get("balcony"))
    row.update({
        "ad_number": f"{PREFIX}{b['id']}" + (f"-{idx}" if idx else ""),
        "listing_url": PROJECT.format(b["id"]),
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(" · ".join(x for x in (b["purpose"], b["address"]) if x)) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated in map_building
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "license_number": b["licence"],
        "area_m2": float(_pos(u.get("area"))) if _pos(u.get("area")) else None,
        "bedrooms": _pos(u.get("rooms")),
        "halls": _pos(u.get("halls")),
        "bathrooms": _pos(u.get("baths")),
        "kitchen": True if _pos(u.get("kitchens")) else None,
        "maid_room": True if maid else None,
        "balcony_terrace": True if balcony else None,
        "elevator": True if "مصعد" in b["specs"] else None,
        "views_count": _pos(b["views"]),
        "photo_urls": list(b["photos"]),
    })
    info = {"project_id": b["id"], "unit": name, "unit_type_ar": raw_type or None, "store_rooms": _pos(u.get("store")),
            "building_units_total": _pos(b["units_total"]), "section_ar": b["section"], "purpose_ar": b["purpose"],
            "street_facade_ar": b["street_facade"], "specs": b["specs"], "features": b["features"],
            "price_text": u.get("price_text"), "latitude": b["lat"], "longitude": b["lng"],
            "composition": [{k: c[k] for k in _UNIT_COLS} for c in u.get("composition") or []]}
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    row["source_capture"] = strip_pii_fields({
        "schema": "manafe.project.v1", "project_id": b["id"],
        "unit": {k: u.get(k) for k in _UNIT_COLS if u.get(k) not in (None, "")},
        "building": {k: b[k] for k in ("title", "licence", "units_total", "section", "purpose", "city",
                                        "district", "address")}})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = http.negotiated_session(INDEX, served=lambda r: r.status_code == 200 and "manafemar/project/" in r.text)
    index = s.get(INDEX, timeout=40).text
    declared = {k: v for k, v in declared_counts(index).items() if k in SECTIONS}
    index_ids = {int(x) for x in re.findall(r"manafemar/project/(\d+)", index)}
    print(f"{SOURCE}: TLS profile {getattr(s, '_impersonate_profile', '?')}; index links {len(index_ids)} "
          f"building(s), counters declare {sum(declared.values())} {declared}", flush=True)
    if not index_ids:
        raise RuntimeError("index carried no project links — challenge or layout change")

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: Counter = Counter()
    pages: dict[int, str] = {}
    try:
        pages, unreadable = walk(s, max(index_ids))
        buildings = [parse_building(n, p) for n, p in sorted(pages.items())]
        walked = Counter(b["section"] for b in buildings)
        complete = not unreadable and dict(walked) == declared
        print(f"  walked {len(buildings)} building(s) {dict(walked)}; unreadable {len(unreadable)} {unreadable[:20]}; "
              f"units {sum(len(b['units']) for b in buildings)}; complete={complete}", flush=True)
        seen_licence: dict[str, int] = {}
        for b in buildings:
            if b["units"] and b["licence"] in seen_licence:     # one REGA ad licence = one ad
                skipped["duplicate_ad_licence"] += len(b["units"])
                continue
            if b["units"] and b["licence"]:
                seen_licence[b["licence"]] = b["id"]
            for got, why in map_building(b):
                if not got:
                    skipped[why] += 1
                    continue
                row, cat = got
                (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): " + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            rows = res + com
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            print("  type/deal:", dict(Counter((r["property_type"], r["transaction_type"]) for r in rows)))
            print("  period:", dict(Counter(r.get("rent_period") for r in rows if r["transaction_type"] == "Rent")),
                  "· no price:", sum(1 for r in rows if r.get("price_annual") is db.AUTHORITATIVE_NULL
                                     or r.get("price_total") is db.AUTHORITATIVE_NULL))
            for row in rows[:40]:
                print("   ", json.dumps({k: (None if row.get(k) is db.AUTHORITATIVE_NULL else row.get(k)) for k in
                      ("ad_number", "title", "property_type", "transaction_type", "price_total", "price_annual",
                       "rent_period", "area_m2", "bedrooms", "city_ar", "district_ar", "license_number")},
                      ensure_ascii=False)[:260])
            return 0

        db.upsert_manafe_residential_batch(res)
        db.upsert_manafe_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="manafe_residential_listings", com_table="manafe_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        for tbl, rr in (("manafe_residential_listings", res), ("manafe_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: walk incomplete (walked {dict(walked)} vs declared {declared}, "
                  f"{len(unreadable)} unreadable)", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(pages), rows_upserted=len(res) + len(com),
                             check_tables=["manafe_residential_listings", "manafe_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(pages), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
