"""MAQRAT (maqrat.com) — REGA-sourced listings platform. Onboarding 2026-09-26 (wave 3).

SOURCE SHAPE (measured live 2026-09-26 over all 83 listings before any code was written)
=========================================================================================
ASP.NET MVC. /Property shows 12 cards and every GET pagination parameter returns the same 12 — the
real paging is the page script's own call: a multipart POST to /Property/_Properities with
`start=<page>`, `length=12`, `Language=ar`, `Sort=`. The partial carries #TotalRecord (83); pages
1..7 returned 83 distinct ids and page 8 was empty, so the walk is complete and self-declaring.

Each /Property/Details/<id> page states «البيانات المستحضرة من هيئة العقار، غير قابلة للتعديل» and
renders the REGA licence block as two label/value structures — `.pd-overview-label/-value` and
`.ap-ro-field-label/-value` — read BY LABEL, never by position. Arabic is HTML-entity-encoded.

TYPE = «نوع العقار» (it matched the page title's own type word on 83 of 83). DEAL = the index card's
«بيع»/«إيجار» badge, cross-checked against the title's «للبيع»/«للإيجار»; a disagreement skips.

PRICE = SOURCE.
  · Sale of LAND: the page prints «سعر المتر» AND «إجمالي سعر بيع الأرض»; the published total is
    stored and the rate kept as price_per_meter (19 of 20 plots print both).
  · Everything else: «سعر الوحدة».
  · RENT PERIOD comes from the AD'S OWN TEXT, tied to its own price — never from the card suffix.
    Every rent card prints «سنويًا» (25 of 25), which is right for some ads and wrong for others:
      MQR23  price 1,800   text «1800 ريال سعودي شهريًا»        → the price IS monthly
      MQR22  price 2,500   text «إيجار شهري قدره 2500 ريال»     → the price IS monthly
      MQR85  price 72,000  text «٦,٠٠٠ ريال شهريًا» (×12 = 72,000) → the price is the YEARLY total
      MQR14  price 45,600  text «3,800 ريال شهريًا» (×12 = 45,600) → the price is the YEARLY total
    Owner rule 2026-09-26 («check the price — if it looks monthly, put it monthly, even though the
    card says yearly»), applied in this order:
      1. the ad's own text ties a period to THIS price → that period (a monthly figure whose ×12
         equals the price → the price is the yearly total);
      2. otherwise a price ≤ normalize.MONTHLY_LOOKING_MAX (10,000) → MONTHLY: no unit here rents for under
         10,000 a YEAR, so the card's «سنويًا» contradicts the listing (rooms 1,800 / 2,500 / 4,500);
      3. otherwise → yearly, the card's own «سنويًا», which the price agrees with.
    Measured 2026-09-26: rent prices split cleanly — rooms ≤ 4,500, everything else ≥ 15,000.
    Monthly rents are stored ×12 in price_annual (the fleet convention; displayed back monthly).

PHOTOS: the gallery images are named Property_<this id>_<hash>_{main,thumb}.webp; the page also
renders other listings' thumbnails (Property_52_…, Property_110_…), which are ignored.

PDPL: «اسم مسؤول الإعلان» and «رقم جوال مسؤول الإعلان» (name + mobile) are never stored, nor the
deed-location prose's owner references; descriptions go through redact_pii.
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

from curl_cffi import CurlMime
from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://maqrat.com"
SOURCE = "MAQRAT"
PREFIX = "MQR"
SLUG = "maqrat"
IMPERSONATE = "chrome"
TIMEOUT = 40
PAGE_SIZE = 12

_NEVER_STORE = {"اسم مسؤول الإعلان", "رقم جوال مسؤول الإعلان", "رابط ترخيص الإعلان"}
_UNSTATED = {"غير محدد", "بدون", "لا يوجد", "لايوجد", ""}
_OFFPLAN_RE = re.compile(r"تحت\s*ال[إا]نشاء|قيد\s*ال[إا]نشاء|على\s*الخارطة|على\s*المخطط")
_SERVICES = {"كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation",
             "ألياف ضوئية": "optical_fibers", "الياف ضوئية": "optical_fibers", "مصعد": "elevator"}
_PAIR_A = re.compile(r'class="pd-overview-label">(.*?)</span>.*?class="pd-overview-value[^"]*">(.*?)</span>', re.S)
_PAIR_B = re.compile(r'class="ap-ro-field-label">([^<]*)</span>\s*<span class="ap-ro-field-value[^"]*">(.*?)</span>', re.S)
_CHIPS = re.compile(r'class="ap-ro-field-label">خدمات العقار</span>\s*<div class="pd-chip-row">(.*?)</div>', re.S)


def _clean(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _val(kv: dict[str, str], k: str) -> Optional[str]:
    v = (kv.get(k) or "").strip()
    return None if v in _UNSTATED else v


def _num(v: Optional[str]) -> Optional[float]:
    m = re.search(r"[\d,]+(?:\.\d+)?", v or "")
    if not m:
        return None
    f = float(m.group(0).replace(",", ""))
    return f if f > 0 else None


def list_cards(s: cc.Session) -> tuple[dict[str, dict], Optional[int]]:
    """{id: {deal, lat, lng}} for every card, walking the page script's own POST paging until a page
    comes back empty. Each card is an <article class="listing-style1 …"> carrying data-id, the
    listing's coordinates, and a `for-what` badge («للبيع»/«للإيجار») — the structured deal."""
    cards: dict[str, dict] = {}
    total = None
    for page in range(1, 60):
        mp = CurlMime()
        for k, v in (("start", str(page)), ("Language", "ar"), ("length", str(PAGE_SIZE)), ("Sort", "")):
            mp.addpart(name=k, data=v.encode())
        h = ihtml.unescape(s.post(f"{BASE}/Property/_Properities", multipart=mp,
                                  impersonate=IMPERSONATE, timeout=TIMEOUT).text)
        t = re.search(r'id="TotalRecord"[^>]*value="(\d+)"', h) or re.search(r'value="(\d+)"[^>]*id="TotalRecord"', h)
        if t:
            total = int(t.group(1))
        arts = h.split('<article class="listing-style1')[1:]
        for a in arts:
            m = re.search(r'data-id="(\d+)"', a)
            if not m:
                continue
            fw = re.search(r'class="for-what[^"]*">(.*?)</', a, re.S)
            lat = re.search(r'data-latitude="(-?[\d.]+)"', a)
            lng = re.search(r'data-longitude="(-?[\d.]+)"', a)
            cards.setdefault(m.group(1), {"deal": _clean(fw.group(1)) if fw else "",
                                          "lat": lat.group(1) if lat else None,
                                          "lng": lng.group(1) if lng else None})
        if not arts:
            break
    return cards, total


def fetch_detail(s: cc.Session, pid: str) -> Optional[str]:
    for attempt in range(3):
        if attempt:
            time.sleep(3 * attempt)
        try:
            r = s.get(f"{BASE}/Property/Details/{pid}", impersonate=IMPERSONATE, timeout=TIMEOUT)
            if r.status_code == 200 and "pd-overview-label" in r.text:
                return r.text
        except Exception:  # noqa: BLE001
            continue
    return None


def parse_detail(page: str, pid: str) -> dict[str, Any]:
    kv: dict[str, str] = {}
    for a, b in _PAIR_A.findall(page) + _PAIR_B.findall(page):
        k = _clean(a)
        if k and k not in kv:
            kv[k] = _clean(b)
    chips = _CHIPS.search(page)
    services = [_clean(x) for x in re.findall(r'class="pd-chip">(.*?)</span>', chips.group(1))] if chips else []
    title = _clean((re.search(r"<title>(.*?)</title>", page, re.S) or [None, ""])[1]).split(" - منصة")[0]
    desc = re.search(r'<h3>وصف العقار</h3>\s*<p>(.*?)</p>', page, re.S)
    own = re.findall(rf"https://api\.maqrat\.com/uploads/properties/Property_{pid}_([0-9a-f]+)_(main|thumb)\.webp", page)
    stems: dict[str, str] = {}
    for stem, kind in own:
        if stems.get(stem) != "main":
            stems[stem] = kind
    photos = [f"https://api.maqrat.com/uploads/properties/Property_{pid}_{st}_{k}.webp" for st, k in stems.items()]
    return {"kv": kv, "services": services, "title": title, "description": _clean(desc.group(1)) if desc else "",
            "photos": photos}


def map_listing(pid: str, card: dict, d: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    kv, title, desc = d["kv"], d["title"], d["description"]
    if _OFFPLAN_RE.search(title) or _OFFPLAN_RE.search(desc):
        return None, "not_ready_offplan"
    type_ar = _val(kv, "نوع العقار")
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{type_ar}"
    category = normalize.category_for_type(ptype).lower()

    badge = card.get("deal") or ""
    by_badge = {"للبيع": "Buy", "للإيجار": "Rent"}.get(badge)
    by_title = "Rent" if "للإيجار" in title else ("Buy" if "للبيع" in title else None)
    if not by_badge and not by_title:
        return None, "deal_unstated"
    if by_badge and by_title and by_badge != by_title:
        return None, f"deal_conflict_{by_badge}_vs_{by_title}"
    deal = by_badge or by_title

    is_land = "Land" in ptype or ptype in ("Farm", "Agriculture Plot")
    unit_price = _num(_val(kv, "سعر الوحدة"))
    ppm = _num(_val(kv, "سعر المتر"))
    land_total = _num(_val(kv, "إجمالي سعر بيع الأرض"))
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = land_total if (is_land and land_total) else unit_price
        row_price["price_per_meter"] = ppm
    else:
        price_int = normalize.to_int(str(unit_price)) if unit_price else None
        # every rent card says «سنويًا» — the shared owner rule decides whether this ad's price is
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            price_int, f"{title} {desc}", "annual")

    region_ar, city_ar, district_raw = _val(kv, "المنطقة"), _val(kv, "المدينة"), _val(kv, "الحي")
    city_id, region_id = to_catalog(city_ar, region_hint=region_ar) if city_ar else (None, None)
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None

    street = _num(_val(kv, "عرض الشارع"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/Property/Details/{pid}",
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
        "area_m2": _num(_val(kv, "مساحة العقار")),
        "property_age": normalize.exact_age(_val(kv, "عمر العقار")),
        "direction": normalize.one_direction(_val(kv, "واجهة العقار"), diagonal=True),
        "street_width_m": int(street) if street else None,
        "bathrooms": normalize.to_int(_val(kv, "حمام")),
        "plan_parcel": " / ".join(x for x in (_val(kv, "رقم المخطط"), _val(kv, "رقم القطعة")) if x) or None,
        "license_number": _val(kv, "رقم رخصة الإعلان"),
        "license_expiry": _val(kv, "تاريخ انتهاء رخصة الإعلان"),
        "photo_urls": d["photos"] or None,
        **row_price,
    }
    for word, col in _SERVICES.items():
        if word in d["services"]:
            row[col] = True
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    field = "إجمالي سعر بيع الأرض" if (deal == "Buy" and is_land and land_total) else "سعر الوحدة"
    row["price_evidence"] = normalize.price_evidence(
        field=field, raw=kv.get(field), stored=stored, kind="total" if deal == "Buy" else "annual",
        unit="total", origin="structured", authoritative_absent=False)
    info = {
        "source_id": pid,
        "type_ar": type_ar,
        "region_ar": region_ar,
        "source_rooms": _val(kv, "عدد الغرف"),       # «عدد الغرف» is never labelled as bedrooms
        "age_ar": _val(kv, "عمر العقار"),
        "services_ar": d["services"] or None,
        "price_per_m2_printed": kv.get("سعر المتر"),
        "unit_price_printed": kv.get("سعر الوحدة"),
        "land_total_printed": kv.get("إجمالي سعر بيع الأرض"),
        "building_code": _val(kv, "مطابقة كود البناء السعودي"),
        "encumbrances_ar": _val(kv, "الالتزامات الأخرى على العقار"),
        "warranties_ar": _val(kv, "الضمانات ومدتها"),
        "negotiable": _val(kv, "السعر قابل للتفاوض"),
        "deal_badge": badge or None,
        "latitude": card.get("lat"),
        "longitude": card.get("lng"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in kv.items() if k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "maqrat.details.v1", "fields": cap,
                                              "title": row["title"], "services": d["services"]})
    normalize.gate_ad_end(row, row.get("license_expiry"))  # the ad's OWN licence end date: expired → inactive + pinned
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    cards, declared = list_cards(s)
    ids = list(cards)
    if a.limit:
        ids = ids[: a.limit]
    print(f"{SOURCE}: {len(ids)} listing(s) (site declares TotalRecord={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for pid in ids:
            page = fetch_detail(s, pid)
            if not page:
                unreadable += 1
                continue
            got, why = map_listing(pid, cards[pid], parse_detail(ihtml.unescape(page), pid))
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)

        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in (res[:3] + com[:2]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_annual",
                       "area_m2", "city_ar", "district_ar")}, ensure_ascii=False)[:200])
            return 0

        db.upsert_maqrat_residential_batch(res)
        db.upsert_maqrat_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="maqrat_residential_listings", com_table="maqrat_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and not a.limit and declared is not None and len(ids) >= declared
        for tbl, rr in (("maqrat_residential_listings", res), ("maqrat_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable detail(s) or a short walk this run", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             check_tables=["maqrat_residential_listings", "maqrat_commercial_listings"])
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
