"""تطبيق أرض / Earth App (earthapp.com.sa) — a land-first map portal. Onboarding 2026-09-26 (wave 3).

SOURCE SHAPE (measured live 2026-09-26 before any code was written)
=====================================================================
earthapp.com.sa is a marketing site; the offers («العروض العقارية») are a Vite SPA on
map.earthapp.com.sa that reads a Laravel API on earthapp.com.sa:
  GET https://earthapp.com.sa/api/offer-list-by-area?page=N
      → {"item": [...10 offers...], "pagination": {"total": 54, "total_pages": 6, ...}}
  GET https://earthapp.com.sa/api/offer/details/<id>  → the SAME record plus `features` (GIS parcel
      attributes only). The list record carries every field this scraper stores, so the detail is
      not fetched.
The server already filters live ads (status=active, expired_date >= today); both are re-checked here.
SOURCE is the site's own Arabic brand: schema.org Organization.name = «تطبيق أرض».

*** THE PRICE TRAP *** `total_price` is the SITE'S multiplication `price × space`, so `price` is, by
the site's own design, a per-m² field. On land the agent types a per-m² rate (1403 × 900 m²). On a
whole property (عمارة/فندق/فيلا/استراحة) most agents typed the WHOLE price into `price`, so the
site's total becomes nonsense (5,000,000 × 788 m² = 3.9 billion; the hotel 1.54 trillion). So:
  · `total_price` is NEVER stored anywhere — it is the site's arithmetic, not a published price.
  · LAND: `price` → price_per_meter, price_total None (the search layer derives the ≈ total).
    A land `price` above 50,000 SAR/m² (owner threshold 2026-09-26) is not a believable rate — it
    is an agent's total in a per-m² field, or not. Skipped «land price ambiguous», never guessed.
  · NON-LAND: the same one threshold read the other way. `price` above 50,000 cannot be a per-m²
    rate, so it is the whole-property price → price_total. At or below it, it is the per-m² rate the
    field is designed for (the one «دور»: 3,097.2 × 387.54 m²) → price_per_meter.
  · RENT: the period is stated nowhere → rent_period None, price stored unconverted.

LOCATION: `city` + `area` (region) are explicit fields → to_catalog(city, region). `district` →
the catalog district only when it matches the WHOLE field; the raw value stays in `neighborhood`.

TYPE: `propertyType` via the shared exact map. Land is Commercial Land only when the source's own
`using` says تجاري (macsaib precedent); «سكني»/«استعمال مختلط»/«غير معرف» keep the map's reading.
`room_count` is ROOMS (a hotel has 200), never bedrooms — kept in additional_info.

PHOTOS: none exist. `user_image` is the AGENT'S avatar — never a listing photo. photo_urls = None.
PDPL: user_name/user_mobile/user_image/user_license_number/user_id and responsibleEmployee* are
dropped from every stored object, and their VALUES are scrubbed out of offer_details (agents type
their own name and FAL licence into it) before redact_pii.
Laravel runs with debug on — a failed page is retried, then the crawl is marked incomplete (no prune).
"""
from __future__ import annotations

import argparse
import datetime as dt
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
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402

API = "https://earthapp.com.sa/api"
MAP = "https://map.earthapp.com.sa"
SOURCE = "تطبيق أرض"
PREFIX = "EAR"
SLUG = "earthapp"
TIMEOUT = 30
MAX_LAND_PPM = 50_000          # owner threshold 2026-09-26: above this a per-m² land rate is not believable

_LAND_TYPES = {"Residential Land", "Commercial Land"}
_OFFPLAN_RE = re.compile(r"تحت\s*ال[إا]نشاء|قيد\s*ال[إا]نشاء|على\s*الخارطة")
_DEALS = {"بيع": "Buy", "إيجار": "Rent", "ايجار": "Rent"}
# The site's own derived product + agent identity: never stored (see docstring).
_DROP = {"total_price", "user_name", "user_mobile", "user_image", "user_license_number", "user_id",
         "rate", "avg_rate", "count_comment", "is_favorite", "view_count", "pdf"}


def get_json(s: cc.Session, url: str) -> Any:
    last: Exception | None = None
    for attempt in range(3):     # measured: one 40 s stall on the first call, then 1.7 s responses
        try:
            r = s.get(url, timeout=TIMEOUT, headers={"Accept": "application/json"})
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise last  # type: ignore[misc]


def walk(s: cc.Session) -> tuple[list[dict], int, bool]:
    """(offers, declared total, every page read)."""
    rows: list[dict] = []
    page, last, total, ok = 1, 1, 0, True
    while page <= last and page <= 50:
        try:
            j = get_json(s, f"{API}/offer-list-by-area?page={page}")
        except Exception as e:  # noqa: BLE001
            print(f"  page {page} unreadable: {str(e)[:120]}", flush=True)
            ok = False
            page += 1
            continue
        rows += j.get("item") or []
        pg = j.get("pagination") or {}
        last, total = int(pg.get("total_pages") or 1), int(pg.get("total") or 0)
        page += 1
    return rows, total, ok


def _pos(v) -> Optional[float]:
    try:
        f = float(str(v).translate(normalize._TRANS).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _txt(v) -> Optional[str]:
    v = (v or "").strip() if isinstance(v, str) else v
    return None if v in (None, "", "-", "0", "غير معرف", "غير متوفر") else v


_CONTACT_NAME_RE = re.compile(r"((?:الوسيط[ةه]?|للتواصل)[^\n\d\[]{0,14}?[:*\s]\s*)"
                              r"([^\n\d\[📞📱/]{2,40}?)(\s*(?:جوال|📞|📱|/)?\s*:?\s*0?\[redacted\])")
_PII_KEYS = ("user_name", "user_mobile", "user_license_number", "responsibleEmployeeName",
             "responsibleEmployeePhone")


def scrub(text: str, o: dict) -> Optional[str]:
    """redact_pii plus two name scrubs. Agents type identity into offer_details (measured 13 of 54):
      1. the record's OWN identity values (name, FAL licence) wherever they appear;
      2. the words between a «الوسيط/للتواصل» marker and a (now redacted) phone — the names of
         OTHER people («الوسيط: حسين الفيفي 📞 05…») that no field lists.
    ponytail: a name with no marker and no phone next to it survives; a PII-NER pass is the upgrade."""
    for k in _PII_KEYS:
        v = str(o.get(k) or "").strip()
        if len(v) >= 4 and v != "-":
            text = text.replace(v, "[redacted]")
    text = redact_pii(text) or ""
    return _CONTACT_NAME_RE.sub(lambda m: m.group(1) + "[redacted]" + m.group(3), text) or None


def classify_price(ptype: str, price: Optional[float], deal: str = "Buy") -> tuple[Optional[str], str]:
    """('per_meter' | 'total' | None, skip_reason). Only the owner's one threshold is used.

    A NON-LAND RENT is refused outright. The field is labelled «سعر المتر», so for a rented
    building/villa/rest house a figure under the threshold could be either a per-m² rate or the
    whole rent (a 40,000/yr rest house), and the card would print a yearly rent as «سعر المتر
    40,000». Neither reading can be proved from the source, so the row is skipped rather than
    guessed. Zero such rows exist on 2026-09-26 — this closes the trap before one arrives.
    Land rent stays per-m² (its rate is the site's designed meaning of the field)."""
    if price is None:
        return None, ""
    if ptype in _LAND_TYPES:
        return (None, "land price ambiguous") if price > MAX_LAND_PPM else ("per_meter", "")
    if deal == "Rent":
        return None, "non-land rent price ambiguous"
    return ("total", "") if price > MAX_LAND_PPM else ("per_meter", "")


def map_offer(o: dict, today: dt.date) -> tuple[Optional[tuple[dict, str]], str]:
    """((row, category) | None, skip_reason)."""
    if (o.get("status") or "").lower() != "active" or (o.get("active") or "").lower() != "yes":
        return None, f"inactive_{o.get('status')}_{o.get('active')}"
    try:
        if dt.date.fromisoformat(str(o.get("expired_date"))[:10]) < today:
            return None, "licence_expired"
    except ValueError:
        return None, "licence_expiry_unstated"
    desc = o.get("offer_details") or ""
    if _OFFPLAN_RE.search(desc):
        return None, "not_ready_offplan"

    type_ar = (o.get("propertyType") or "").strip()
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{type_ar or 'none'}"
    usage = _txt(o.get("using"))
    if ptype == "Residential Land" and usage == "تجاري":
        ptype = "Commercial Land"
    category = normalize.category_for_type(ptype).lower()

    deal = _DEALS.get((o.get("offer_type") or "").strip())
    if not deal:
        return None, f"deal_unstated_{o.get('offer_type') or 'none'}"

    price = _pos(o.get("price"))
    kind, why = classify_price(ptype, price, deal)
    if why:
        return None, why
    whole = (int(price) if price.is_integer() else price) if kind == "total" else None   # "150000000.0" → 150000000

    city_raw, region_raw = _txt(o.get("city")), _txt(o.get("area"))
    city_id, region_id = to_catalog(city_raw, region_raw) if city_raw else (None, None)
    district_raw = _txt(o.get("district"))
    district_ar = find_district_in_text(district_raw, city_id) if district_raw and city_id else None
    # The field is structured, so the catalog district must BE the whole field, not one word of it:
    # «الشبيكة الجديد» (south Makkah, 21.29°N) is not «حي الشبيكة» (by the Haram, 21.42°N).
    if district_ar and norm_district_tok(district_ar) != norm_district_tok(district_raw):
        district_ar = None
    views = [v.get("title") for v in (o.get("view") or []) if isinstance(v, dict) and v.get("title")]

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{o.get('id')}",
        "listing_url": f"{MAP}/offers/{o.get('id')}",
        "source": SOURCE,
        "active": True,
        "title": None,                      # every record's title is «-»
        "description": scrub(desc, o),
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # provably Buy/Rent: an unstated deal was already skipped above
        "city": normalize.map_city(city_raw) if city_id else None,
        "city_ar": city_raw if city_id else None,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(o.get("space")),
        "property_age": normalize.exact_age(o.get("property_age")),
        "street_width_m": normalize.one_street_width(o.get("street_width")),
        "direction": normalize.one_direction(views[0]) if len(views) == 1 else None,
        "date_added": o.get("created_at") or None,
        "photo_urls": None,                 # no listing photos exist; user_image is the agent's avatar
        "license_number": _txt(o.get("ad_license_number")),
        "license_expiry": o.get("expired_date"),
        "ad_source": _txt(o.get("ad_source")),
        "price_per_meter": price if kind == "per_meter" else None,
    }
    if deal == "Buy":
        row["price_total"] = whole
    else:
        row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(whole, None)
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=o.get("price"), stored=row["price_per_meter"] if kind == "per_meter" else whole,
        kind="per_meter" if kind == "per_meter" else ("total" if deal == "Buy" else "unconverted"),
        unit="per_meter" if kind == "per_meter" else "total", origin="api")

    info = {
        "source_id": o.get("id"),
        "type_ar": type_ar,
        "usage_ar": usage,
        "region_ar": region_raw,
        "rooms": normalize.to_int(o.get("room_count")) or None,
        "facades_ar": views or None,
        "street_name": _txt(o.get("street_name")),
        "land_number": _txt(o.get("land_number")),
        "plan_parcel": _txt(o.get("subdivisionplan_id")),
        "red_zone_ar": _txt(o.get("redZoneType")),
        "latitude": o.get("latitude"),
        "longitude": o.get("longitude"),
        "age_raw": _txt(o.get("property_age")),
    }
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [])}
    cap = {k: v for k, v in o.items() if k not in _DROP}
    cap["offer_details"] = row["description"]
    row["source_capture"] = strip_pii_fields(redact_capture({"schema": "earthapp.offer.v1", **cap}))
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")   # the fleet workflow passes --type all to every scraper
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    s, tried = retry_smarter_session(API, timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    offers, declared, pages_ok = walk(s)
    if a.limit:
        offers = offers[: a.limit]
    print(f"{SOURCE}: {len(offers)} offer(s) (API declares total={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    today = dt.date.today()
    try:
        for o in offers:
            got, why = map_offer(o, today)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)

        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            for row in (res[:3] + com[:2]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_per_meter",
                       "price_annual", "area_m2", "city_ar", "district_ar", "license_number",
                       "photo_urls", "listing_url")}, ensure_ascii=False))
            return 0

        db.upsert_earthapp_residential_batch(res)
        db.upsert_earthapp_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="earthapp_residential_listings", com_table="earthapp_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = pages_ok and not a.limit and len(offers) >= declared
        for tbl, rr in (("earthapp_residential_listings", res), ("earthapp_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print("  NOT pruning: an unreadable page or a short walk this run", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(offers), rows_upserted=len(res) + len(com),
                             check_tables=["earthapp_residential_listings", "earthapp_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(offers), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
