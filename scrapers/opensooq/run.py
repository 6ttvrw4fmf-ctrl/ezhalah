"""OpenSooq KSA (sa.opensooq.com) — real-estate vertical only. Onboarding 2026-09-26 (wave 3, batch 4).

SOURCE SHAPE (measured live 2026-09-26)
=======================================
  list  https://sa.opensooq.com/ar/عقارات?page=N  — server-rendered; the whole SERP is inline JSON at
        <script id="__NEXT_DATA__"> → props.pageProps.serpApiResponse.listings {items[], meta}
        (meta.count 78, 30/page, 3 pages). The _next/data route is dead (410); this IS the feed.
  page  https://sa.opensooq.com/ar/search/<id>
Each item: id, title, price_amount («650,000 ريال»), city_label, nhood_label, cat1_code (for sale /
for rent), cat2_code (the type), `cps` — the card's own attribute chips (rooms, bathrooms, furnished,
area, floor, building age, and the RENT PERIOD «شهري» / «سنوي» / «يومي») — and image_uri.

TYPE = cat2_code; land by its usage chip (سكنية / تجارية / زراعية). «الاستخدام المتعدد» (multi-use)
is not resolved here — the same OWNER QUESTION as Mobasher's mixed-use plots, skipped until answered.
DEAL = cat1_code, cross-checked against the title's «للبيع» / «للإيجار»; a conflict skips (285424182
is filed under villas FOR SALE, titled «للإيجار فيلا فاخرة», priced 150,000).
READY ONLY: «عمر البناء: قيد الإنشاء» (under construction) skips.
AGE: the chips are RANGES. «0 - 11 شهر» is age 0; any wider range («1 - 5 سنوات», «20+ سنة») is
not an exact age → NULL (normalize.exact_age would read the leading number); the chip is kept.
RENT PERIOD: the listing's own chip is its period; the shared owner rule applies on top
(normalize.rent_period_from_ad) — the co-working desk ads (996–4,600, no period chip) are monthly.
DUPLICATES: the same office is sometimes posted twice (287292450 / 287291798: same REGA licence,
district, price and area). A later id with the identical (licence, district, price, area) is dropped;
a shared licence ALONE is not a duplicate (one licence covers a Jeddah villa and a Madinah flat).

PDPL: the item names the member / shop and carries a masked phone number — none is stored.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://sa.opensooq.com"
LIST = BASE + "/ar/" + urllib.parse.quote("عقارات")
IMG = "https://opensooq-imagesv2.os-cdn.com/previews/2048x0/{}.webp"
SOURCE = "السوق المفتوح"
PREFIX = "OSQ"
SLUG = "opensooq"
IMPERSONATE = "chrome"

_TYPE_AR = {"ApartmentsForSale": "شقة", "ApartmentsForRent": "شقة", "VillasAndPalacesForSale": "فيلا",
            "VillasAndPalacesForRent": "فيلا", "WholeBuildingForSale": "عمارة", "WholeBuildingForRent": "عمارة",
            "property_rent_commercial_Offices": "مكتب", "RE_HotelApartments": "شقة"}
_LAND_USAGE = {"سكنية": "ارض", "تجارية": "أرض تجارية", "زراعية": "أرض زراعية"}
_PERIOD = {"شهري": "monthly", "سنوي": "annual"}
_NEVER_STORE = {"member_id", "member_display_name", "member_user_name", "member_avatar_uri", "shop_name",
                "shop_logo_uri", "phone_number", "phone_reveal_key", "member_rating_avg", "member_rating_count"}


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


def walk(s: cc.Session) -> tuple[list[dict], int]:
    items: list[dict] = []
    count = 0
    for page in range(1, 30):
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', get(s, f"{LIST}?page={page}"), re.S)
        listings = json.loads(m.group(1))["props"]["pageProps"]["serpApiResponse"]["listings"]
        count = int((listings.get("meta") or {}).get("count") or 0)
        seen = {x["id"] for x in items}
        fresh = [x for x in listings.get("items") or [] if x.get("id") not in seen]
        items += fresh
        if not fresh or page >= int((listings.get("meta") or {}).get("pages") or 1):
            break
    return items, count


def chips(x: dict) -> list[str]:
    return [c.strip() for c in (x.get("cps") or []) if isinstance(c, str) and c.strip()]


def _chip_num(cs: list[str], label: str) -> Optional[float]:
    for c in cs:
        if c.startswith(label):
            v = normalize.to_int(c[len(label):].translate(normalize._TRANS))
            return float(v) if v else None
    return None


def _count(cs: list[str], noun_re: str) -> Optional[int]:
    """«٥ غرف نوم» → 5, «غرفة نوم» → 1, «٢ غرفتا نوم» → 2, «أكثر من 6 غرف» → None (open bound)."""
    for c in cs:
        if re.search(noun_re, c):
            if "أكثر" in c:
                return None
            n = normalize.to_int(c.translate(normalize._TRANS))
            if n:
                return n
            if re.search(r"غرفتا|حمّامين|حمامين", c):
                return 2
            return 1
    return None


def map_listing(x: dict) -> tuple[Optional[tuple[dict, str]], str]:
    cs = chips(x)
    title = x.get("title") or ""
    if any("قيد الإنشاء" in c for c in cs):
        return None, "not_ready_under_construction"
    deal = {"RealEstateForSale": "Buy", "RealEstateForRent": "Rent"}.get(x.get("cat1_code") or "")
    by_title = "Rent" if re.search(r"للإيجار|للايجار", title) else ("Buy" if "للبيع" in title else None)
    if not deal:
        return None, f"deal_unstated_{x.get('cat1_code')}"
    if by_title and by_title != deal:
        return None, f"deal_conflict_{deal}_vs_{by_title}"

    cat2 = x.get("cat2_code") or ""
    if cat2 == "LandsForSale":
        usage = next((c for c in cs if c in _LAND_USAGE or c == "الاستخدام المتعدد"), None)
        if usage not in _LAND_USAGE:
            return None, f"land_usage_{usage or 'unstated'}_owner_question"
        type_ar = _LAND_USAGE[usage]
    else:
        type_ar = _TYPE_AR.get(cat2)
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{cat2}"
    category = normalize.category_for_type(ptype).lower()

    price = normalize.to_int(x.get("price_amount")) if x.get("price_amount") else None
    desc = x.get("masked_description") or ""
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = price
    else:
        card = next((_PERIOD[c] for c in cs if c in _PERIOD), None)
        if not card and any(c == "يومي" for c in cs):
            row_price["rent_period"], row_price["price_annual"] = None, None   # no daily bucket
        else:
            row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
                price, f"{title} {desc}", card, title)

    city_ar = x.get("city_label")
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_raw = x.get("nhood_label")
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None
    age_chip = next((c.split(":", 1)[1].strip() for c in cs if c.startswith("عمر البناء")), None)
    furnished = next(({"مفروشة": True, "غير مفروشة": False}.get(c) for c in cs
                      if c in ("مفروشة", "غير مفروشة", "مفروش جزئياً")), None)
    licence = next((c for c in cs if re.fullmatch(r"7[12]\d{8}", c)), None)
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{x['id']}",
        "listing_url": f"{BASE}/ar/search/{x['id']}",
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
        "area_m2": _chip_num(cs, "المساحة:") or _chip_num(cs, "مساحة الأرض:"),
        "bedrooms": _count(cs, r"غرف(?:ة|تا)? نوم|^أكثر من \d+ غرف$"),
        "bathrooms": _count(cs, r"حم(?:ّ)?ام"),
        "property_age": 0 if age_chip == "0 - 11 شهر" else None,
        "furnished": furnished,
        "license_number": licence,
        "photo_urls": [IMG.format(x["image_uri"])] if x.get("image_uri") else None,
        **row_price,
    }
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="price_amount", raw=x.get("price_amount"), stored=stored,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="api", authoritative_absent=False)
    info = {
        "source_id": x["id"],
        "cat2_code": cat2,
        "chips": cs or None,
        "age_ar": age_chip,
        "expires": x.get("expired_at"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in x.items() if k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "opensooq.serp.v1", "item": cap})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    items, declared = walk(s)
    print(f"{SOURCE}: {len(items)} item(s) (SERP declares count={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen_keys: set[tuple] = set()
    try:
        for x in sorted(items, key=lambda i: i["id"]):          # oldest id wins a duplicate pair
            got, why = map_listing(x)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            key = (row.get("license_number"), row.get("neighborhood"), x.get("price_amount"), row.get("area_m2"))
            if row.get("license_number") and key in seen_keys:
                skipped["duplicate_post_same_licence_district_price_area"] = \
                    skipped.get("duplicate_post_same_licence_district_price_area", 0) + 1
                continue
            seen_keys.add(key)
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_annual",
                       "rent_period", "area_m2", "bedrooms", "property_age", "city_id", "district_ar")},
                      ensure_ascii=False)[:250])
            return 0

        db.upsert_opensooq_residential_batch(res)
        db.upsert_opensooq_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="opensooq_residential_listings", com_table="opensooq_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = len(items) >= declared > 0
        for tbl, rr in (("opensooq_residential_listings", res), ("opensooq_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print("  NOT pruning: the walk fell short of the declared count", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items), rows_upserted=len(res) + len(com),
                             check_tables=["opensooq_residential_listings", "opensooq_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(items), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
