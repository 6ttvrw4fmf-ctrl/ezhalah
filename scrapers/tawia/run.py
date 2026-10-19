"""Tawia («مكتب طوية للعقار», tawia.sa) — a Jubail brokerage. Onboarding 2026-09-27 (batch 7).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
A Next.js App Router site backed by its own Supabase store (the photos live there). No JSON API is
exposed; every detail page carries its facts twice, and both are read:
  JSON-LD «RealEstateListing» — name («<type label> - <title>»), description, datePosted,
      address{streetAddress, addressLocality = the DISTRICT, addressRegion = the CITY},
      numberOfBedroomsTotal, numberOfBathroomsTotal, floorSize{value, unitCode MTK} (only when set),
      offers{price (a string, SAR), availability, businessFunction LeaseOut|Sell}.
  RSC flight (self.__next_f.push) — the gallery props {"images":[{publicUrl,isCover}],
      "propertyName", "isInvestmentOpportunity", "listingPurpose": rent|sale}, the floor stat
      «الدور N», and the «تفاصيل إضافية» <dt>/<dd> grid (e.g. «نظام التكييف: سبليت»).
THE WALK: /sitemap.xml lists every /properties/<uuid> (5) and /properties?page=N lists the same 5
(page 2 is empty). Both are read and unioned, so a property missing from one still gets fetched.
The homepage's «many property words» are the site's i18n type dictionary (29 types), not listings.
Measured: 5 listings — 4 rent (شقة ×2, دور (شقة ضمن فيلا) ×1, فيلا ×1), 1 sale (فيلا, 1,100,000).

TRAPS
-----
1. RENT PERIOD: the card and the page print a bare «20,500 ريال» — no period anywhere but the ad's
   own prose. Two ads say «الإيجار السنوي 22,000» → annual. Two say only «خيارات الإيجار: 20,500
   ريال دفعة واحدة، أو 11,250 ريال كل 6 أشهر» — no period word, so rent_period_from_ad leaves the
   period NULL (never a default). Those alternative payment plans are ONE unit's payment options,
   not several units: the stored price stays offers.price and the options sentence goes to
   additional_info["price_options_text"] verbatim.
2. TYPE: the site labels a unit «دور (شقة ضمن فيلا)» — its own type word is «دور» (the site's key is
   floor_unit), so it maps through «دور» → Floor. Any other unmapped label is skipped, never guessed.
3. AREA: floorSize is the BUILDING area (the villa's prose: «مساحة أرض 493 م² ومساحة بناء 595.48 م²»);
   it is the one area the site shows, so it is area_m2. The land figure lives only in prose → not stored.
4. PDPL: the office phone/email sit in the JSON-LD seller/agent blocks and the page chrome — never read.
   The FAL numbers (1200002826 brokerage, 2200003235 management) are the OFFICE's licences, not a
   REGA ad licence → additional_info only. No «ترخيص الإعلان» appears on any page (license_number NULL).
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
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402

BASE = "https://tawia.sa"
SOURCE = "مكتب طوية للعقار"
PREFIX = "TWA"
SLUG = "tawia"

# the site's own label → its Arabic type word (only where the label is not already a type word)
_TYPE_AR = {"دور (شقة ضمن فيلا)": "دور"}
_DEAL = {"LeaseOut": "Rent", "Sell": "Buy"}
_PURPOSE = {"rent": "Rent", "sale": "Buy"}
# sold / let / reserved / auction / off-plan words in the listing's OWN title or label
_NOT_READY_RE = re.compile(r"مؤجر|مباع|محجوز|تم التأجير|تم البيع|مزاد|على الخارطة|تحت الإنشاء")
_ID_RE = re.compile(r"/properties/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")


class Gone(Exception):
    pass


def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40)
            if r.status_code == 404:
                raise Gone(url)
            r.raise_for_status()
            return r.text
        except Gone:
            raise
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def walk(s: cc.Session) -> list[str]:
    """Every property id on the sitemap AND on the list pages (unioned, order kept)."""
    ids = list(dict.fromkeys(_ID_RE.findall(get(s, f"{BASE}/sitemap.xml"))))
    for p in range(1, 50):
        new = [i for i in dict.fromkeys(_ID_RE.findall(get(s, f"{BASE}/properties?page={p}"))) if i not in ids]
        if not new:
            break
        ids += new
    return ids


def flight(page: str) -> str:
    return "".join(json.loads('"' + c + '"') for c in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', page, re.S))


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse_page(pid: str, page: str) -> dict[str, Any]:
    ld = None
    for raw in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S):
        try:
            j = json.loads(raw)
        except ValueError:
            continue
        if j.get("@type") == "RealEstateListing":
            ld = j
    blob = flight(page)
    imgs = re.search(r'"images":(\[[^\]]*\])', blob)
    name = re.search(r'"propertyName":("(?:[^"\\]|\\.)*")', blob)
    purpose = re.search(r'"listingPurpose":"(\w+)"', blob)
    invest = re.search(r'"isInvestmentOpportunity":(true|false)', blob)
    floor = re.search(r'"الدور (-?\d+)"', blob)
    fal = re.search(r"رخصة فال للوساطة والتسويق:\s*(\d{10})", page)
    return {
        "id": pid, "ld": ld,
        "images": json.loads(imgs.group(1)) if imgs else [],
        "name": json.loads(name.group(1)) if name else None,
        "purpose": purpose.group(1) if purpose else None,
        "investment": invest.group(1) == "true" if invest else None,
        "floor": int(floor.group(1)) if floor else None,
        "details": {_text(k): _text(v) for k, v in re.findall(r"<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", page, re.S)},
        "fal": fal.group(1) if fal else None,
    }


def map_page(d: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    ld = d.get("ld")
    if not ld:
        return None, "no_structured_listing"
    offer = ld.get("offers") or {}
    avail = (offer.get("availability") or "").rsplit("/", 1)[-1]
    if avail != "InStock":
        return None, f"availability_{avail or 'none'}"
    deal = _DEAL.get((offer.get("businessFunction") or "").rsplit("#", 1)[-1])
    if not deal:
        return None, f"deal_unmapped_{offer.get('businessFunction')}"
    if d.get("purpose") and _PURPOSE.get(d["purpose"]) != deal:
        return None, f"deal_mismatch_{d['purpose']}"
    title = (d.get("name") or "").strip()
    full = (ld.get("name") or "").strip()
    label = full[:-len(" - " + title)].strip() if title and full.endswith(" - " + title) else None
    if not label:
        return None, "type_label_missing"
    title = title or full
    if _NOT_READY_RE.search(f"{label} {title}"):
        return None, "not_ready_" + _NOT_READY_RE.search(f"{label} {title}").group(0)
    ptype = normalize.map_type_exact(_TYPE_AR.get(label, label))
    if not ptype:
        return None, f"type_unmapped_{label}"
    category = normalize.category_for_type(ptype).lower()

    desc = ld.get("description") or ""
    raw_price = offer.get("price")
    price = normalize.to_int(raw_price)
    price = price if price and price > 0 else None
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = price
    else:
        # the site prints no period label anywhere → card_period None; the ad's own words decide
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            price, f"{title} {desc}", None, title)

    addr = ld.get("address") or {}
    city_ar = (addr.get("addressRegion") or "").strip() or None
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_raw = (addr.get("addressLocality") or "").strip() or None
    district_ar = find_district_in_text("حي " + district_raw, city_id) if (city_id and district_raw) else None
    fs = ld.get("floorSize") or {}
    area = fs.get("value") if fs.get("unitCode") in (None, "MTK") else None
    lic = normalize.ad_licence_from_prose(desc)
    photos = [i["publicUrl"] for i in sorted(d.get("images") or [], key=lambda i: not i.get("isCover"))
              if i.get("publicUrl")]
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d['id']}",
        "listing_url": f"{BASE}/properties/{d['id']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": float(area) if isinstance(area, (int, float)) and area > 0 else None,
        "bedrooms": ld.get("numberOfBedroomsTotal") if isinstance(ld.get("numberOfBedroomsTotal"), int) else None,
        "bathrooms": ld.get("numberOfBathroomsTotal") if isinstance(ld.get("numberOfBathroomsTotal"), int) else None,
        "floor_number": d.get("floor"),
        # the REGA AD licence only (7xxxxxxxxx); the office's FAL numbers are never an ad licence
        "license_number": lic if lic and lic.startswith("7") else None,
        "photo_urls": photos,
        **row_price,
    }
    for k, v in (d.get("details") or {}).items():
        row.update(normalize.amenities_from_text(f"{k} {v}"))
    row["price_evidence"] = normalize.price_evidence(
        field="JSON-LD offers.price", raw=raw_price, stored=row.get("price_total" if deal == "Buy" else "price_annual"),
        kind="total" if deal == "Buy" else "annual", unit="total", origin="structured", authoritative_absent=False)
    options = re.search(r"خيارات الإيجار[^.]*", desc)
    info = {
        "source_id": d["id"],
        "type_label_ar": label,
        "listing_purpose": d.get("purpose"),
        "is_investment_opportunity": d.get("investment"),
        "date_posted": ld.get("datePosted"),
        "street_address_ar": addr.get("streetAddress"),
        "price_options_text": options.group(0).strip() if options else None,
        "details": d.get("details") or None,
        "fal_licence": d.get("fal"),   # the office's FAL licence (a key with «brokerage» is stripped as PII)
    }
    row["additional_info"] = redact_capture(strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})}))
    row["source_capture"] = redact_capture(strip_pii_fields({"schema": "tawia.jsonld.v1", "listing": ld, "type_label": label,
                                              "listing_purpose": d.get("purpose"), "floor": d.get("floor")}))
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    s, tried = retry_smarter_session(BASE, timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    ids = walk(s)
    print(f"{SOURCE}: {len(ids)} property page(s) on its sitemap + list", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for pid in ids:
            try:
                d = parse_page(pid, get(s, f"{BASE}/properties/{pid}"))
            except Gone:
                skipped["gone_404"] = skipped.get("gone_404", 0) + 1
                continue
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_page(d)
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
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_annual", "rent_period",
                       "area_m2", "bedrooms", "floor_number", "city_id", "district_ar")}, ensure_ascii=False)[:260])
            return 0

        db.upsert_tawia_residential_batch(res)
        db.upsert_tawia_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="tawia_residential_listings", com_table="tawia_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(ids) > 0
        for tbl, rr in (("tawia_residential_listings", res), ("tawia_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} of {len(ids)} page(s) unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             check_tables=["tawia_residential_listings", "tawia_commercial_listings"])
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
