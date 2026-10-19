"""Nafithh (nafithh.sa, «معرض نافذة») — REGA-licensed listings gallery. Onboarding 2026-09-26 (wave 3, b4).

SOURCE SHAPE (measured live 2026-09-26)
=======================================
Server-rendered HTML only (Yii2 + pjax), no JSON anywhere:
  list    https://nafithh.sa/web/gallery/index?page=N&per-page=12  — page N past the end CLAMPS to the
          last page, so the walk stops on the first page that adds no new id (30 ids: 12 + 12 + 6,
          matching the site's own filter buckets 22 sale + 8 rent).
  detail  https://nafithh.sa/web/gallery/<id>  — the REGA licence block as `lableShow` / `showData`
          pairs, read BY LABEL. An unknown id returns HTTP 404.

TRAP 1 — the site's own footer text («السماح بنشر الاعلان اضافة الاعلان شركة نافذة الرقمية …») is
pasted INSIDE the ad prose of ~7 ads. Nothing here cuts on it; the block is read by label.
TRAP 2 — PRICE for LAND is PER m². «سعر الوحدة» on every land sale is the metre rate: ad 217 prints
7,900 on 1,902.5 m² and its own text says 15,029,750 (= 7,900 × 1,902.5); ad 259 prints 1,152 on
625 m² and says «720 الف». The page's headline «سعر العقار 261.00 SR» (ad 255) repeats the rate. So
land stores it as price_per_meter and price_total stays NULL — the search layer derives the labelled
≈ total (owner rule 2026-09-03), nothing is multiplied here. A land RENT rate has no annual meaning,
so it is kept as price_per_meter with no period.
RENT PERIOD: Nafithh prints none; the ad's own words decide (normalize.rent_period_from_ad): ad 228
«الإيجار السنوي لهذه الشقة هو 47,000», ad 178's title «… للايجار الشهري».
«مجمع» has no fleet type (2 ads) → skipped, as on MAQRAT.

PDPL: «اسم الموظف المسؤول», «رقم هاتف الموظف المسؤول», the broker's name/phone and the deed
description / boundaries are never stored.
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
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://nafithh.sa"
SOURCE = "معرض نافذة"
PREFIX = "NFH"
SLUG = "nafithh"
IMPERSONATE = "safari17_0"

_PAIR = re.compile(r'<div class="lableShow">([^<]*)</div>\s*<div class="showData[^"]*"[^>]*>(.*?)</div>', re.S)
_NEVER_STORE = {"اسم الموظف المسؤول", "رقم هاتف الموظف المسؤول", "اسم الوسيط العقاري",
                "وصف موقع العقار حسب الصك", "حدود وأطوال العقار", "الموقع على الخريطة"}
_SERVICES = {"كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation",
             "ألياف ضوئية": "optical_fibers"}
_LAND = {"Residential Land", "Commercial Land", "Farm"}


def _clean(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _num(v: Optional[str]) -> Optional[float]:
    m = re.search(r"\d[\d,]*(?:\.\d+)?", (v or "").translate(normalize._TRANS))
    if not m:
        return None
    f = float(m.group(0).replace(",", ""))
    return f if f > 0 else None


def get(s: cc.Session, url: str) -> Optional[str]:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return None


def list_ids(s: cc.Session) -> list[str]:
    ids: list[str] = []
    for page in range(1, 60):
        t = get(s, f"{BASE}/web/gallery/index?page={page}&per-page=12") or ""
        fresh = [i for i in dict.fromkeys(re.findall(r'/web/gallery/(\d+)"', t)) if i not in ids]
        if not fresh:                       # the list clamps past its end — a repeat means done
            break
        ids += fresh
    return ids


def parse_detail(page: str) -> dict[str, Any]:
    kv: dict[str, str] = {}
    for a, b in _PAIR.findall(page):
        k = _clean(a)
        if k and k not in kv:
            kv[k] = _clean(b)
    title = _clean((re.search(r"<title>(.*?)</title>", page, re.S) or [None, ""])[1])
    title = re.sub(r"^معرض نافذة\s*-\s*", "", title)
    desc = re.search(r"<h5>تفاصيل العقار</h5>\s*<span[^>]*>(.*?)</span>\s*</div>", page, re.S)
    photos = list(dict.fromkeys(BASE + p for p in re.findall(
        r'(/web/uploads/attachment/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp))', page, re.I)))
    geo = re.search(r"maps\.google\.com/maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)", page)
    return {"kv": kv, "title": title, "description": _clean(desc.group(1)) if desc else "",
            "photos": photos, "lat": geo.group(1) if geo else None, "lng": geo.group(2) if geo else None}


def map_listing(pid: str, d: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    kv, title, desc = d["kv"], d["title"], d["description"]
    deal = {"بيع": "Buy", "إيجار": "Rent", "ايجار": "Rent"}.get(kv.get("غرض الإعلان", ""))
    if not deal:
        return None, "deal_unstated"
    type_ar = kv.get("نوع العقار")
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{type_ar}"
    category = normalize.category_for_type(ptype).lower()

    unit = _num(kv.get("سعر الوحدة"))
    unit_int = normalize.to_int(str(unit)) if unit else None
    row_price: dict[str, Any] = {}
    if ptype in _LAND:
        row_price["price_per_meter"] = unit_int        # land «سعر الوحدة» is the metre rate — see TRAP 2
    elif deal == "Buy":
        row_price["price_total"] = unit_int
    else:
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            unit_int, f"{title} {desc}", None, title)

    region_ar, city_ar, district_raw = kv.get("المنطقة"), kv.get("المدينة"), kv.get("الحي")
    city_id, region_id = to_catalog(city_ar, region_hint=region_ar) if city_ar else (None, None)
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None
    street = _num(kv.get("عرض الشارع"))
    services = kv.get("خدمات العقار") or ""
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/web/gallery/{pid}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _num(kv.get("مساحة العقار")),
        "property_age": normalize.exact_age(kv.get("عمر العقار") or None),
        "direction": normalize.one_direction(kv.get("واجهة العقار"), diagonal=True),
        "street_width_m": int(street) if street else None,
        "plan_parcel": " / ".join(x for x in (kv.get("رقم المخطط"), kv.get("رقم القطعة")) if x and x != "-") or None,
        "license_number": kv.get("رقم ترخيص الإعلان"),
        "license_expiry": kv.get("تاريخ انتهاء رخصة الإعلان"),
        "photo_urls": d["photos"] or None,
        **row_price,
    }
    for word, col in _SERVICES.items():
        if word in services:
            row[col] = True
    if ptype in _LAND:
        stored, kind = row_price.get("price_per_meter"), "per_meter"
    elif deal == "Buy":
        stored, kind = row_price.get("price_total"), "total"
    else:
        stored, kind = row_price.get("price_annual"), "annual"
    row["price_evidence"] = normalize.price_evidence(
        field="سعر الوحدة", raw=kv.get("سعر الوحدة"), stored=stored, kind=kind,
        unit="per_meter" if ptype in _LAND else "total", origin="structured", authoritative_absent=False)
    info = {
        "source_id": pid,
        "type_ar": type_ar,
        "region_ar": region_ar,
        "source_rooms": kv.get("عدد الغرف") or None,     # «عدد الغرف» is never labelled as bedrooms
        "age_ar": kv.get("عمر العقار") or None,
        "services_ar": services or None,
        "usage_ar": kv.get("استخدام العقار"),
        "unit_price_printed": kv.get("سعر الوحدة"),
        "latitude": d["lat"],
        "longitude": d["lng"],
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", "-", [])})
    cap = {k: v for k, v in kv.items() if k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "nafithh.gallery.v1", "fields": cap, "title": row["title"]})
    if normalize.ad_expiry_state(row["license_expiry"]) == "expired":
        # Its own ad licence ended. Still written (the gate is PR #5103's, the owner's call), but the
        # list sighting does not certify it as checked-alive (2026-10-03).
        db.mark_presence_unproven(row)
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    ids = list_ids(s)
    print(f"{SOURCE}: {len(ids)} listing id(s)", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for pid in ids:
            try:
                page = get(s, f"{BASE}/web/gallery/{pid}")
            except Exception:  # noqa: BLE001
                page = None
            if not page or "lableShow" not in page:
                unreadable += 1
                continue
            got, why = map_listing(pid, parse_detail(page))
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
            time.sleep(0.3)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_per_meter",
                       "price_annual", "rent_period", "area_m2", "city_id", "district_ar")},
                      ensure_ascii=False)[:250])
            return 0

        db.upsert_nafithh_residential_batch(res)
        db.upsert_nafithh_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="nafithh_residential_listings", com_table="nafithh_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(ids) > 0
        for tbl, rr in (("nafithh_residential_listings", res), ("nafithh_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable detail page(s)", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             check_tables=["nafithh_residential_listings", "nafithh_commercial_listings"])
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
