"""Wajaf («وجف العقارية», wajaf.sa) — a Buraydah (Qassim) brokerage. Onboarding 2026-09-27 (batch 7).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
A server-rendered Laravel site, no JSON API:
  list    https://wajaf.sa/properties?page=N   — 9 per page, «عرض 1 – 9 من 41 نتيجة»
  page    https://wajaf.sa/properties/<id>     — <id> is the ad's own «معرف الإعلان»
  unit    https://wajaf.sa/properties/<p>/unit/<u>  — a plot/villa inside a subdivision page
The site's language is SESSION state: GET /language?lang=ar&type=frontend first (a bare frontLang
cookie is ignored). The ENGLISH type labels are crossed — «أرض سكنية» renders as "Commercial building",
«أرض تجارية» as "Land" — so only the Arabic page is read.

Every page carries one detail table: معرف الإعلان · نوع العقار · صفة المُعلِن · حد / سعر نهائي · السوم ·
عرض الشارع · المساحة · سعر المتر · رقم الإعلان (an internal number, not a REGA licence — the site shows
none). 41 pages: 34 single ads + 7 SUBDIVISIONS (مخطط …) whose header is a range «السعر يبدأ من 800 إلى
850» and whose plots are 65 unit pages with their own table. A subdivision is a container → skipped;
its units are the listings (owner 2026-09-13: a completed project's units are real listings).

PRICE TRAPS
  «السوم» is the current best OFFER from buyers, never the price → additional_info only.
  «الحد» (limit / final price) has NO unit. Land ads usually put the per-m² rate there AND repeat it in
  the site's own «سعر المتر» cell (1390: حد 1000, سعر المتر 1000 on 3125 m²); some land ads leave that
  cell empty (2766: حد 1000 on 3036 m²), and some land units put a TOTAL there (unit 67: حد 150000 on
  487 m²). So:
    · «سعر المتر» stated (alone, or equal to الحد)   → price_per_meter, price_total NULL
    · «سعر المتر» ≠ «الحد» (unit 43: 850 vs 900)     → two prices → NULL, raw kept (price_text)
    · «الحد» alone on LAND                            → unit unstated → NULL, raw kept (OWNER QUESTION)
    · «الحد» alone on a building/warehouse/office     → the «سعر نهائي» total (sale) / the rent
  A «00» per-metre cell (unit 67) is no value.
STATUS: متاح only — مباع / محجوز / مؤجر / مؤجر جزئي … are skipped. All 4 rent ads are «مؤجر جزئي»
(partly let) → skipped (OWNER QUESTION). A subdivision that is itself not متاح contributes no units.
TYPE «شاليه / استراحة» (two types in one), «وحدة سكنية» and «أخرى» have no single honest mapping → skipped.
DEAL «استثمار» (1424, a building «للاستثمار» at 150,000) states neither sale nor rent → skipped.
PDPL: the page shows the office phone and e-mail only; the unlabelled number after the district in the
address line («بريدة،الحمر، 008001653») is never stored — it may be a deed or plan number.
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
from scrapers.common.arabic_location import find_district_in_text, norm_district_tok, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://wajaf.sa"
SOURCE = "وجف العقارية"
PREFIX = "WJF"
SLUG = "wajaf"
IMPERSONATE = "chrome"

_DEAL = {"بيع": "Buy", "إيجار": "Rent"}
# map_type_exact's per-platform escape hatch: plain readings the shared map does not key (nufouth precedent)
_TYPE_OVERRIDES = {"أرض سكنية": "Residential Land", "عمارة سكنية": "Building",
                   "مستودعات": "Warehouse", "مكاتب إدارية": "Office"}
_LAND = {"Residential Land", "Commercial Land"}


def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def arabic_session() -> cc.Session:
    s = cc.Session()
    get(s, f"{BASE}/language?lang=ar&type=frontend")
    return s


def walk(s: cc.Session) -> tuple[list[str], Optional[int]]:
    ids: list[str] = []
    declared = None
    for p in range(1, 100):
        page = get(s, f"{BASE}/properties?page={p}")
        m = re.search(r"من\s*(\d+)\s*نتيجة", page)
        declared = declared or (int(m.group(1)) if m else None)
        new = [i for i in dict.fromkeys(re.findall(r'href="https://wajaf\.sa/properties/(\d+)"', page)) if i not in ids]
        if not new:
            break
        ids += new
        time.sleep(0.3)
    return ids, declared


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _widget(page: str, head: str) -> list[str]:
    m = re.search(rf">{head}</h4>(.*?)(?:<h4|سجل اهتمامك)", page, re.S)
    return [_clean(x) for x in re.findall(r"<h6[^>]*>(.*?)</h6>", m.group(1), re.S)] if m else []


def parse_page(url: str, page: str) -> dict[str, Any]:
    lists = [[_clean(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", blk, re.S)]
             for blk in re.findall(r'<div class="pd-list">(.*?)</div>', page, re.S)]
    cells: dict[str, str] = {}
    for labels, values in zip(lists[0::2], lists[1::2]):
        cells.update(zip(labels, values))
    # the header (title → price) holds deal, status and type; sibling unit cards below reuse the badge classes
    header = page[page.find("sp-lg-title"):page.find('<h3 class="price')]
    loc = re.search(r"distance\s*</span>\s*<span>(.*?)</span>", header, re.S)
    deal = re.search(r'<a class="ff-heading text-thm[^"]*"[^>]*>\s*<span[^>]*>(.*?)</span>', header, re.S)
    title = re.search(r'<h2 class="sp-lg-title[^"]*">(.*?)</h2>', page, re.S)
    desc = re.search(r">نظرة عامة</h4>(.*?)<h4", page, re.S)
    head = re.search(r'<h3 class="price[^"]*">(.*?)</h3>', page, re.S)
    geo = re.search(r"google\.com/maps\?q=(-?\d+\.\d+),+(-?\d+\.\d+)", page)
    is_unit = "/unit/" in url
    return {
        "url": url,
        "is_unit": is_unit,
        "title": _clean(title.group(1)) if title else "",
        "description": _clean(desc.group(1)) if desc else "",
        # [city, district, <unlabelled number>] — the third part is never kept (see docstring)
        "location": [x.strip() for x in _clean(loc.group(1)).split("،")][:2] if loc else [],
        "deal": _clean(deal.group(1)) if deal else None,
        # [status, type] — a unit page prints its status as «cbadge», a top-level page as «s-badge-secondary»
        "badges": [_clean(x) for x in re.findall(r'<span class="(?:s-badge-secondary|cbadge)"[^>]*>(.*?)</span>',
                                                  header, re.S)],
        "header_price": _clean(head.group(1)) if head else None,
        "cells": cells,
        "facades": _widget(page, "الواجهات"),
        "facilities": _widget(page, "المرافق"),
        "photos": list(dict.fromkeys(re.findall(r'<div class="item">\s*<img[^>]*?src="([^"]+)"', page))),
        # a unit page lists its SIBLING units too — only a top-level page is a container
        "units": [] if is_unit else list(dict.fromkeys(
            re.findall(r'href="(https://wajaf\.sa/properties/\d+/unit/\d+)"', page))),
        "lat": geo.group(1) if geo else None,
        "lng": geo.group(2) if geo else None,
    }


def _num(cell: Optional[str]) -> Optional[int]:
    n = normalize.to_int(cell) if cell else None
    return n or None          # «لا يوجد» → None, and the «00» cell is no value


def _area(cell: Optional[str]) -> Optional[float]:
    m = re.search(r"\d+(?:\.\d+)?", (cell or "").replace(",", ""))
    return float(m.group(0)) if m and float(m.group(0)) > 0 else None


def _district(raw: Optional[str], city_id: Optional[int]) -> Optional[str]:
    raw = re.sub(r"^حي\s+", "", raw or "").strip()
    if not (raw and city_id):
        return None
    hit = find_district_in_text("حي " + raw, city_id)
    # the WHOLE name only: «الحمر الشمالي» (its own district on this site) must never become «حي الحمر»
    return hit if hit and norm_district_tok(hit) == norm_district_tok(raw) else None


def map_page(d: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    if d["units"]:
        return None, "project_container"
    status = d["badges"][0] if d["badges"] else None
    if status != "متاح":
        return None, f"status_{status}"
    deal = _DEAL.get(d["deal"] or "")
    if not deal:
        return None, f"deal_unmapped_{d['deal']}"
    cells = d["cells"]
    type_ar = cells.get("نوع العقار")
    ptype = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES)
    if not ptype:
        return None, f"type_unmapped_{type_ar}"
    category = normalize.category_for_type(ptype).lower()

    limit_cell, ppm_cell = cells.get("حد / سعر نهائي"), cells.get("سعر المتر")
    limit, ppm = _num(limit_cell), _num(ppm_cell)
    price: Optional[int] = None
    per_metre: Optional[int] = None
    note: Optional[str] = None
    if limit and ppm and limit != ppm:
        note = "limit_and_per_metre_disagree"
    elif ppm:
        per_metre = ppm
    elif limit and ptype in _LAND:
        note = "land_limit_unit_unstated"       # OWNER QUESTION — see docstring
    else:
        price = limit

    title, desc = d["title"], d["description"]
    row_price: dict[str, Any] = {"price_per_meter": per_metre}
    if deal == "Buy":
        row_price["price_total"] = price
    else:
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            price, f"{title} {desc}", None, title)

    city_ar = d["location"][0] if d["location"] else None
    city_en = normalize.map_city(city_ar) if city_ar else None
    # the shared city→region map is the sanctioned twin hint: «الهفوف» is two catalog towns (Eastern, Riyadh)
    city_id, region_id = to_catalog(city_ar, region_hint=normalize.region_for_city(city_en)) if city_ar else (None, None)
    district_raw = d["location"][1] if len(d["location"]) > 1 else None
    uid = re.search(r"/unit/(\d+)$", d["url"])
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}U{uid.group(1)}" if uid else f"{PREFIX}{d['url'].rstrip('/').rsplit('/', 1)[-1]}",
        "listing_url": d["url"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": city_en,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": _district(district_raw, city_id),
        "neighborhood": district_raw,
        "area_m2": _area(cells.get("المساحة")),
        "street_width_m": normalize.one_street_width(cells.get("عرض الشارع")),
        # one facade only; the widget lists every open side («غرب جنوب شرق» = three streets → NULL)
        "direction": normalize.one_direction(" ".join(d["facades"])) if len(d["facades"]) == 1 else None,
        "photo_urls": list(d["photos"]),
        **row_price,
    }
    stored = per_metre or (row.get("price_total") if deal == "Buy" else row.get("price_annual"))
    row["price_evidence"] = normalize.price_evidence(
        field="سعر المتر" if per_metre else "حد / سعر نهائي", raw=ppm_cell if per_metre else limit_cell,
        stored=stored, kind="per_meter" if per_metre else ("total" if deal == "Buy" else "annual"),
        unit="per_meter" if per_metre else "total", origin="structured",
        authoritative_absent=not (limit or ppm))
    info = {
        "source_id": cells.get("معرف الإعلان"),
        "site_ad_number": cells.get("رقم الإعلان"),
        "type_ar": type_ar,
        "lister_role": cells.get("صفة المُعلِن"),
        "soum": _num(cells.get("السوم")),               # the buyers' current offer — never the price
        "price_text": f"الحد: {limit_cell} · سعر المتر: {ppm_cell}" if note else None,
        "price_note": note,
        "facades": d["facades"],
        "facilities": d["facilities"],
        "project_url": d["url"].split("/unit/")[0] if uid else None,
        "latitude": d.get("lat"),
        "longitude": d.get("lng"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    row["source_capture"] = strip_pii_fields({"schema": "wajaf.page.v1", "cells": cells, "badges": d["badges"],
                                              "deal": d["deal"], "header_price": d["header_price"],
                                              "location": d["location"]})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = arabic_session()
    ids, declared = walk(s)
    print(f"{SOURCE}: {len(ids)} page(s) (site declares {declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = seen = 0
    try:
        queue = [f"{BASE}/properties/{i}" for i in ids]
        while queue:
            url = queue.pop(0)
            try:
                d = parse_page(url, get(s, url))
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            seen += 1
            if d["units"] and d["badges"][:1] != ["متاح"]:
                # the subdivision itself is sold/reserved while its unit pages may still say متاح — the source
                # contradicts itself, so none of its units is claimed (6483 «مباع» with 3 «متاح» plots)
                skipped["unit_of_unavailable_project"] = skipped.get("unit_of_unavailable_project", 0) + len(d["units"])
            else:
                queue += d["units"]
            got, why = map_page(d)
            time.sleep(0.3)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({seen} pages, {unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_per_meter",
                       "price_annual", "rent_period", "area_m2", "city_id", "district_ar")}, ensure_ascii=False)[:260])
            return 0

        db.upsert_wajaf_residential_batch(res)
        db.upsert_wajaf_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="wajaf_residential_listings", com_table="wajaf_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and declared is not None and len(ids) >= declared > 0
        for tbl, rr in (("wajaf_residential_listings", res), ("wajaf_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: walked {len(ids)} of a declared {declared}, {unreadable} unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             check_tables=["wajaf_residential_listings", "wajaf_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
