"""مكسب العقارية (macsaib.sa) — Buraydah agency on the Taearif tenant-website platform. Onboarding
2026-09-26 (wave 3).

SOURCE SHAPE (measured live 2026-09-26 before any code was written)
=====================================================================
The site is a Next.js shell; every listing comes from Taearif's public JSON API for the tenant:
  GET https://api.taearif.com/api/v1/tenant-website/macsaib.sa/properties?page=N
      → {"properties": [...], "pagination": {"total": 77, "last_page": 4, ...}}   (20 per page)
  GET …/properties/<slug>                         → the full record (building_age, street widths…)
  GET …/properties/categories/direct              → the tenant's 20 type categories
  GET …/properties?category_ids=<id>              → the listings filed under one category
Pagination is REAL and self-declaring (pages 1-4 returned 77 distinct ids = total), and the
purpose split agreed (48 sale + 29 rent). `status=unavailable` returned 0; all 77 are `available`.

*** `property_type` IS NOT A TYPE. *** It is «سكني»/«تجاري» (or null for 48 of 77) — a usage
class. The TYPE lives only in the category the agency filed the listing under, which the list
record does not carry. So the scraper walks each category with `category_ids=` and learns
id → category name; measured: the categories PARTITION the 77 exactly (أرض 36, محل تجاري 27,
استراحة 5, فيلا 5, شقة في عمارة 4 — no listing in two, none in none). A listing no category claims
is skipped, never typed from its title.

LAND USAGE: a plot is Commercial Land only when the source's own `property_type_en` says
"commercial"; otherwise the shared map's reading of «أرض» (Residential Land) applies. Many plot
TITLES say «تجارية سكنية» (mixed); a title is prose and does not override the structured field.

PRICE = SOURCE. 71 of 77 publish price "0" — the site prints 0 — so price is NULL (unpublished),
never 0. Two plots print «750» on ~570 m² (a per-metre rate in the total field, by every sign) but
the listing page itself shows «750» as the price, so it is stored exactly (owner rule 2026-08-03:
no plausibility gate at any magnitude). `pricePerMeter` is kept only where non-zero. Ad 1781's
price field (164,000) disagrees with its own ppm × area and description (146,000); the field is
what the site displays, so the field is stored.

RENT PERIOD: no field states one, so rent rows carry rent_period NULL and the price verbatim
(normalize.rent_period_and_annual with no token) — unstated periods stay out of period searches.

TRI-STATE: the detail record's amenity flags are 0/1 FORM defaults — 0 is also what an agent who
never touched the field leaves behind. So 1 → True and 0 → NULL (unknown), never False. The same
holds for bedrooms/bathrooms/building_age = 0.

LOCATION: `district` is filled for 5 of 77 («حي الرحاب - بريدة»); `location.address` is usually
just «بريدة», and 72 records share one pin (24.766317, …) — a latitude in Riyadh for a Buraydah
agency, i.e. the form's default. Coordinates are therefore stored only when the address is more
than a bare city. District comes from the district field, else from the title, both resolved
against the catalog (find_district_in_text never invents one).

READY ONLY: status must be `available`, and an off-plan phrase in the title/description skips.
PDPL: the API carries no agent contact fields; descriptions go through redact_pii.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, stated_city, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

SITE = "https://macsaib.sa"
API = "https://api.taearif.com/api/v1/tenant-website/macsaib.sa"
SOURCE = "مكسب العقارية"
PREFIX = "MKS"
SLUG = "macsaib"
IMPERSONATE = "chrome"
TIMEOUT = 40

# Category names the shared map does not carry; each is unambiguous on its face.
_TYPE_OVERRIDES = {"شقة في عمارة": "Apartment", "محل تجاري": "Shop"}
_OFFPLAN_RE = re.compile(r"تحت\s*ال[إا]نشاء|قيد\s*ال[إا]نشاء|على\s*الخارطة|على\s*المخطط")
_DEFAULT_PIN_LAT = 24.766317   # the form default every bare-city record carries (see docstring)
_FLAGS = {"elevator": "elevator", "maid_room": "maid_room", "driver_room": "driver_room",
          "private_parking": "parking", "balcony": "balcony_terrace"}


def get_json(s: cc.Session, url: str) -> Any:
    r = s.get(url, impersonate=IMPERSONATE, timeout=TIMEOUT, headers={"Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def walk(s: cc.Session, query: str) -> tuple[list[dict], int]:
    """Every property for `query`, following the API's own last_page; returns (rows, declared)."""
    rows: list[dict] = []
    page, last, total = 1, 1, 0
    while page <= last and page <= 50:
        j = get_json(s, f"{API}/properties?{query}&page={page}")
        rows += j.get("properties") or []
        pg = j.get("pagination") or {}
        last, total = int(pg.get("last_page") or 1), int(pg.get("total") or 0)
        page += 1
    return rows, total


def _pos(v) -> Optional[float]:
    try:
        f = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _count(v) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def city_of(district_field: str, addr: str, text: str) -> tuple[Optional[str], Optional[int], Optional[int]]:
    """The city the SOURCE states, validated against the catalog — or (None, None, None).
    Only explicit city statements count, in order: the district field's «حي X - <city>» suffix, an
    address that is itself a bare city, «مدينة <city>» in the listing text. NOT resolve_slug on the
    free text: «حي الخضر» (a Buraydah district) resolves there to the TOWN الخضر in Makkah region
    (measured 2026-09-26), which would file a Buraydah plot 800 km away."""
    strip = lambda x: re.sub(r"\s+", " ", (x or "").replace("\u0640", "")).strip()   # tatweel: «مــدينة»
    district_field, addr, text = strip(district_field), strip(addr), strip(text)
    cands = []
    if " - " in district_field:
        cands.append(district_field.split(" - ")[-1])
    stated = stated_city(f"{text} {addr}")            # «مدينة X», the fleet's one reading of it
    if stated[1]:
        cands.append(stated[0])
    words = addr.split()
    if addr and "،" not in addr and not addr.startswith(("حي ", "طريق ", "شارع ")):
        cands.append(addr)                               # the address IS a bare city («بريدة»)
    elif len(words) >= 3 and words[0] == "حي":
        # «حي البصر بريدة»: the trailing word counts only if the catalog confirms the words before
        # it are a district OF that city. «حي الربوة الشرقية» must not become the town الشرقية.
        cid, rid = to_catalog(words[-1])
        if cid and find_district_in_text(" ".join(words[:-1]), cid):
            cands.append(words[-1])
    elif "،" in addr:
        cands.append(addr.split("،")[-1])
    for c in cands:
        c = c.strip(" .،,")
        for cand in (c, c.split()[0] if c.split() else c):
            cid, rid = to_catalog(cand)
            if cid:
                return cand, cid, rid
    return None, None, None


def map_listing(p: dict, d: dict, cat_name: Optional[str]) -> tuple[Optional[tuple[dict, str]], str]:
    """((row, category) | None, skip_reason). `p` is the list record, `d` the detail record."""
    if (p.get("status") or "").lower() != "available":
        return None, f"not_ready_{p.get('status') or 'unstated'}"
    title = p.get("title") or ""
    desc = d.get("description") or p.get("description") or ""
    features = [f for f in (d.get("features") or p.get("features") or []) if isinstance(f, str)]
    if _OFFPLAN_RE.search(title) or _OFFPLAN_RE.search(desc) or any(_OFFPLAN_RE.search(f) for f in features):
        return None, "not_ready_offplan"

    if not cat_name:
        return None, "type_unstated_no_category"
    usage = (p.get("property_type_en") or "").lower()
    ptype = normalize.map_type_exact(cat_name, _TYPE_OVERRIDES)
    if ptype == "Residential Land" and usage == "commercial":
        ptype = "Commercial Land"
    if not ptype:
        return None, f"type_unmapped_{cat_name}"
    category = normalize.category_for_type(ptype).lower()

    deal_en = (p.get("transactionType_en") or "").lower()
    purpose = (p.get("listing_purpose") or "").lower()
    if deal_en not in ("sale", "rent"):
        return None, f"deal_unstated_{deal_en or 'none'}"
    if purpose and purpose != deal_en:
        return None, f"deal_conflict_{deal_en}_vs_{purpose}"
    deal = "Buy" if deal_en == "sale" else "Rent"

    price = normalize.to_int(p.get("price"))
    price = price if price and price > 0 else None
    ppm = _pos(d.get("pricePerMeter"))

    loc = p.get("location") or {}
    addr = (loc.get("address") or "").strip()
    district_field = (p.get("district") or "").strip()
    city_ar, city_id, region_id = city_of(district_field, addr, f"{title} {desc}")
    district_ar = None
    if city_id:
        for text in (district_field.split(" - ")[0], title, addr):
            district_ar = find_district_in_text(text, city_id) if text else None
            if district_ar:
                break
    real_pin = "،" in addr and loc.get("lat") not in (None, _DEFAULT_PIN_LAT)

    images = [u for u in (d.get("images") or p.get("images") or []) if isinstance(u, str) and u.startswith("http")]
    if not images and isinstance(p.get("image"), str) and p["image"].startswith("http"):
        images = [p["image"]]

    area = _pos(p.get("area")) or _pos(d.get("size"))
    widths = [w for w in (_pos(d.get(f"street_width_{k}")) for k in ("north", "south", "east", "west")) if w]

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{p.get('id')}",
        "listing_url": f"{SITE}/property/{p.get('slug')}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii("\n".join([desc] + features).strip()) or None,
        "property_type": ptype,
        "transaction_type": deal,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_field.split(" - ")[0].strip() or None if district_field else None,
        "area_m2": area,
        "bedrooms": _count(d.get("bedrooms", p.get("bedrooms"))),
        "bathrooms": _count(d.get("bathrooms", p.get("bathrooms"))),
        "property_age": _count(d.get("building_age")),
        "street_width_m": int(max(widths)) if len(widths) == 1 else None,
        "date_added": p.get("createdAt") or None,
        "photo_urls": images or None,
        "video_url": d.get("video_url") or None,
        "price_per_meter": ppm,
    }
    for src, col in _FLAGS.items():
        if normalize.to_int(d.get(src)) and normalize.to_int(d.get(src)) > 0:
            row[col] = True
    if deal == "Buy":
        row["price_total"] = price
    else:
        row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(price, None)

    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=p.get("price"), stored=stored,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="api",
        authoritative_absent=stored is None)
    info = {
        "source_id": p.get("id"),
        "slug": p.get("slug"),
        "category_ar": cat_name,
        "usage_en": usage or None,
        "price_printed": p.get("price"),
        "area_printed": p.get("area"),
        "street_widths_m": widths or None,
        "rooms": _count(d.get("rooms")),
        "floors": _count(d.get("floors")),
        "latitude": loc.get("lat") if real_pin else None,
        "longitude": loc.get("lng") if real_pin else None,
        "address_ar": addr or None,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in d.items() if k not in ("description", "features", "faqs")}
    cap["title"], cap["description"] = row["title"], row["description"]
    row["source_capture"] = strip_pii_fields({"schema": "macsaib.taearif.v1", **cap})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    # The run is opened BEFORE the catalogue walk: a walk that fails (2026-10-03: a 40 s connect
    # timeout on page 1) must close a failed run row, not crash with no row at all, which left the
    # ledger showing yesterday's success.
    run_id = None if dry else db.begin_run(SLUG)
    listings: list[dict] = []
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        listings, declared = walk(s, "")
        # id → category name, learned by walking each category (the list record carries no type).
        cat_of: dict[str, str] = {}
        for c in get_json(s, f"{API}/properties/categories/direct").get("data") or []:
            members, _ = walk(s, f"category_ids={c.get('id')}")
            for m in members:
                cat_of[str(m.get("id"))] = c.get("name")
        if a.limit:
            listings = listings[: a.limit]
        print(f"{SOURCE}: {len(listings)} listing(s) (API declares total={declared}), "
              f"{len(cat_of)} categorised", flush=True)

        for p in listings:
            try:
                d = get_json(s, f"{API}/properties/{p.get('slug')}").get("property") or {}
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_listing(p, d, cat_of.get(str(p.get("id"))))
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
                       "area_m2", "city_ar", "district_ar", "listing_url")}, ensure_ascii=False)[:220])
            return 0

        db.upsert_macsaib_residential_batch(res)
        db.upsert_macsaib_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="macsaib_residential_listings", com_table="macsaib_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        # The catalogue is complete only if the walk reached the declared total and every detail read.
        complete = unreadable == 0 and not a.limit and len(listings) >= declared
        for tbl, rr in (("macsaib_residential_listings", res), ("macsaib_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable detail(s) or a short walk this run", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(listings), rows_upserted=len(res) + len(com),
                             check_tables=["macsaib_residential_listings", "macsaib_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(listings), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
