"""Property Finder Saudi (propertyfinder.sa) — the STAGED ingest. Owner approved the source 2026-11-04; the
rows are stored and NOTHING reaches a customer until the owner launches it (docs/ops/PROPERTYFINDER_LAUNCH.md).

SOURCE SHAPE (measured 2026-11-04 on a full walk of all four sides: 3,461 + 1,027 + 23 + 160 ads)
================================================================================================
crawl.py walks the four Arabic category pages + ?page=N (robots-allowed). Each ad is the page's
__NEXT_DATA__ searchResult.listings[i].property — the WHOLE ad: we never open a single-ad page (403 to robots).
  property_type  «شقة» «فيلا» «طابق كامل» «أرض» «عمارة بالكامل» «استراحة» «مجمع سكني» «مزرعة» «مكتب»
                 «صالة عرض» «مستودع» — mapped one word to one type below; an unmapped word is SKIPPED, counted.
  price          {value, currency SAR, period sell|yearly|monthly|weekly|daily, is_hidden}. PRICE = SOURCE,
                 PERIOD = SOURCE: sell → price_total; yearly → annual, verbatim; monthly → monthly (stored ×12,
                 the fleet's storage convention: the app divides by 12, so the shown figure IS the source's);
                 weekly / daily → no period bucket exists (owner 2026-08-09: daily/weekly is not monthly), so
                 price_annual stays NULL and the price lives in price_evidence; is_hidden or no value → price on
                 request (AUTHORITATIVE_NULL, the source settled it). A period that contradicts the side
                 (a «sell» price on the rent side) is skipped, never guessed.
  size           {value, unit sqm} → area_m2 (an int on every ad). A non-sqm unit is kept raw, area NULL.
  bedrooms_value / bathrooms_value are the source's own numbers behind «7+» / «استوديو» (0) / «لا شيء» (0).
  location_tree  REGION → CITY → DISTRICT (DISTRICT on 4,629 of 4,671; CITY-only on 42) + coordinates on every ad.
  amenity_names  only utilities on this site: «كهرباء» «مياه» «صرف صحي» «هاتف» (a phone LINE) → electricity /
                 water_supply / sanitation; a missing name is silence, never a «no».
  rera           the REGA ad licence (4,670 of 4,671) → license_number.
  rnpm.enabled   Property Finder's «rent now, pay monthly» → rent_now_pay_later on RENT ads (the column the
                 instalment question reads). payment_method is kept raw (empty on every ad on 2026-11-04).
  completion_status off_plan / off_plan_primary (155 sale ads) → propertyfinder_offplan_units, never a listing
                 (owner 2026-10-25: off-plan is stored, hidden).
PF BADGES (is_great_value, is_high_demand, is_price_drop, is_verified, is_luxe, listing_level …) are an opinion
of the source's: stored RAW in source_capture only (no anon read), never in a column a card or the agent reads.

PDPL: agent / broker / client objects (person names, phones, emails, addresses) and contact_options are dropped
before anything is stored; title / description go through the shared idempotent redactor (pii.redact_pii, and
the tables' zz_redact_pii trigger on top).

LIVENESS («own full list = the check»): a side is COMPLETE when every page was read and the unique ads reach
98% of the smallest total_count the site printed during the walk (a short side is walked a second time and
merged — the default order drifts a few ads while we read). prune_unseen runs per table only when BOTH sides
that feed it are complete; an ad absent from 3 complete crawls in a row is HIDDEN (its own page is robots-403,
so the complete list is the only reading there is) — owner decision 2026-11-10 for THIS SITE ONLY, the one named
exception to «absence never hides» (LISTING_LIVENESS.md §7.3, liveness_policies.COMPLETE_LIST_ABSENCE_HIDES).
Hidden, never deleted; an ad the list shows again comes back by the upsert. A partial walk, a wall or an
exception prunes nothing.

    python -m scrapers.propertyfinder.run --dry-run      # walk + map, write nothing
    python -m scrapers.propertyfinder.run                # upsert (staged tables)
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.facts.one_reader import amenity_answers  # noqa: E402
from scrapers.common.arabic_location import catalog_district, norm_district_tok, resolve  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.liveness_policies import COMPLETE_LIST_ABSENCE_VERDICT  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402
from scrapers.propertyfinder import crawl as C  # noqa: E402

SOURCE = "Property Finder"
SLUG = "propertyfinder"
PREFIX = "PF"
RES_TABLE = "propertyfinder_residential_listings"
COM_TABLE = "propertyfinder_commercial_listings"
OFFPLAN_TABLE = "propertyfinder_offplan_units"

# Property Finder's own type word → our type. The side decides land and whole buildings (PF files each ad under a
# residential or a commercial category — that IS the source's usage statement).
_TYPE = {"شقة": "Apartment", "فيلا": "Villa", "طابق كامل": "Floor", "استراحة": "Rest House",
         "مجمع سكني": "Compound", "مزرعة": "Farm", "مكتب": "Office", "صالة عرض": "Showroom",
         "مستودع": "Warehouse", "محل تجاري": "Shop", "محل": "Shop", "تاون هاوس": "تاون هاوس",
         "دوبلكس": "Duplex", "بنتهاوس": "Apartment", "شاليه": "Chalet", "غرفة": "Room"}
_BY_SIDE = {"أرض": ("Residential Land", "Commercial Land"),
            "عمارة بالكامل": ("Building", "Commercial Building")}
_DEAL_WORD = {"Buy": ("للبيع", "تجارية للبيع"), "Rent": ("للايجار", "للإيجار", "تجارية للايجار", "تجارية للإيجار")}
_PERIOD_SIDE = {"sell": "Buy", "yearly": "Rent", "monthly": "Rent", "weekly": "Rent", "daily": "Rent"}
_FURNISHED = {"YES": True, "NO": False}            # «PARTLY» is neither: NULL, the raw word kept
_UTILITY = {"كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation"}
# Never stored, at any depth: person / company identity and every contact channel.
_NEVER_STORE = ("agent", "broker", "client", "contact_options", "lead_value")
# The source's ranking / promotion opinions — kept raw for audit, never a column (neutrality).
BADGES = ("is_great_value", "is_high_demand", "is_price_drop", "is_verified", "is_luxe", "is_featured",
          "is_premium", "is_exclusive", "is_pf_exclusive", "is_spotlight_listing", "is_smart_ad",
          "is_community_expert", "is_super_agent", "listing_level", "listing_level_label", "rank_score",
          "ranking_factors", "qs", "rsp", "rss", "is_upgraded", "is_extended", "is_fhm", "is_cts")


def _int(v: Any) -> Optional[int]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(round(f)) if f >= 0 else None


def clean_record(p: dict) -> dict:
    """The ad's own object minus every person / contact field, its free text phone-redacted."""
    kept = {k: v for k, v in p.items() if k not in _NEVER_STORE}
    return redact_capture(strip_pii_fields(kept))


def type_of(raw: Optional[str], category: str) -> Optional[str]:
    raw = (raw or "").strip()
    if raw in _BY_SIDE:
        return _BY_SIDE[raw][0 if category == "residential" else 1]
    return _TYPE.get(raw)


def is_off_plan(p: dict) -> bool:
    return str(p.get("completion_status") or "").startswith("off_plan")


# Contract G (owner 2026-10-17): a SPELLING of a catalogued district is MAPPED here, never added to the catalog.
# 🆕 2026-11-05, unknown_named_districts(3): Property Finder's DISTRICT names that are the same place as a catalogued
# district of that city, judged by the ads' own pins against the catalogued district's served pins:
#   الرياض «مطار الملك خالد الدولي» ×7 (24.952N 46.632E)  = «مطار الملك خالد» (served 24.937N 46.640E)
#   مكة «ريع اذاخر» ×3 (21.444N 39.834E)                  = «حي ريع زاخر»   (served 21.455N 39.837E)
#   مكة «الهجلة الجديد» ×3 (21.287N 39.827E)              = «حي الهجلة»     (served 21.294N 39.840E)
# A word not listed here and not on the city's list still stays None (never a guess).
_DISTRICT_SPELLING = {(3, norm_district_tok("مطار الملك خالد الدولي")): "مطار الملك خالد",
                      (6, norm_district_tok("ريع اذاخر")): "حي ريع زاخر",
                      (6, norm_district_tok("الهجلة الجديد")): "حي الهجلة"}


def _district(city_id: Optional[int], district: Optional[str]) -> Optional[str]:
    if not (city_id and district):
        return None
    alt = _DISTRICT_SPELLING.get((city_id, norm_district_tok(district)))
    return catalog_district(city_id, district) or (catalog_district(city_id, alt) if alt else None)


def location(p: dict) -> dict[str, Any]:
    tree = {t.get("type"): t for t in (p.get("location_tree") or []) if isinstance(t, dict)}
    region = (tree.get("REGION") or {}).get("name")
    city = (tree.get("CITY") or {}).get("name")
    district = (tree.get("DISTRICT") or {}).get("name")
    r = resolve(city, district, region_hint=region) if city else {}
    city_id = r.get("city_id")
    coords = (p.get("location") or {}).get("coordinates") or {}
    return {"region": region, "city_ar": r.get("city_ar") or city, "city_id": city_id,
            "region_id": r.get("region_id"), "neighborhood": district,
            "district_ar": _district(city_id, district),
            "pin": pin_dict(coords.get("lat"), coords.get("lon")),
            "pf_location": {"tree": [{k: t.get(k) for k in ("id", "type", "name", "slug_en")} for t in tree.values()],
                            "full_name": (p.get("location") or {}).get("full_name")}}


# OWNER 2026-11-04: a RESIDENTIAL rent Property Finder labels «yearly» at a per-month-sized figure is a MONTHLY price.
# Same band as the fleet's cheap-yearly / silent-period rule (src/lib/rentPool.ts CHEAP_YEARLY_FROM/BELOW,
# judge_silent_rent_period_ar): 300 <= value < 8,000. Below 300 is a placeholder and stays as published.
PER_MONTH_FROM, PER_MONTH_BELOW = 300, 8_000


def price_fields(p: dict, deal: str, category: str = "residential") -> tuple[Optional[dict], str]:
    pr = p.get("price") or {}
    period = pr.get("period")
    if period and _PERIOD_SIDE.get(period) not in (None, deal):
        return None, f"price_period_{period}_on_{deal.lower()}_side"
    value = _int(pr.get("value")) if not pr.get("is_hidden") else None
    on_request = bool(pr.get("is_hidden")) or not value
    out: dict[str, Any] = {}
    if deal == "Buy":
        out["price_total"] = db.AUTHORITATIVE_NULL if on_request else value
        stored, kind = (None if on_request else value), "total"
    elif on_request:
        out["price_annual"] = db.AUTHORITATIVE_NULL
        out["rent_period"] = {"yearly": "annual", "monthly": "monthly"}.get(period)
        stored, kind = None, "annual"
    elif period == "yearly" and category == "residential" and PER_MONTH_FROM <= value < PER_MONTH_BELOW:
        # stored the monthly way (×12); the evidence keeps PF's own figure + word and says why
        out["rent_period"], out["price_annual"] = N.rent_period_and_annual(value, "شهري")
        stored, kind = out["price_annual"], "monthly"
        out["_yearly_label_judged_monthly"] = True
    elif period == "yearly":
        out["rent_period"], out["price_annual"] = N.rent_period_and_annual(value, "سنوي")
        stored, kind = out["price_annual"], "annual"
    elif period == "monthly":
        out["rent_period"], out["price_annual"] = N.rent_period_and_annual(value, "شهري")
        stored, kind = out["price_annual"], "monthly"
    else:  # weekly / daily / unstated: no bucket, nothing derived; the source's figure stays in the evidence
        out["rent_period"], out["price_annual"] = None, None
        stored, kind = None, period or "annual"
    out["price_evidence"] = N.price_evidence(
        field="property.price.value", raw=pr.get("value"), stored=stored, kind=kind, unit="total",
        origin="api", authoritative_absent=on_request)
    if out.pop("_yearly_label_judged_monthly", False):
        out["price_evidence"].update(source_period="yearly", judged_monthly=True,
                                     judged_by="owner 2026-11-04: PF «yearly» residential rent 300–7,999 = monthly ×12")
    return out, ""


def map_listing(p: dict, deal: str, category: str) -> tuple[Optional[tuple[dict, str]], str]:
    pid = str(p.get("id") or "")
    if not pid:
        return None, "no_id"
    offering = (p.get("offering_type") or "").strip()
    if offering and offering not in _DEAL_WORD[deal]:
        return None, f"offering_{offering}_on_{deal.lower()}_side"
    if p.get("is_available") is False:
        return None, "not_available_at_source"
    ptype = type_of(p.get("property_type"), category)
    if not ptype:
        return None, f"type_unmapped_{p.get('property_type')}"
    prices, why = price_fields(p, deal, category)
    if prices is None:
        return None, why
    loc = location(p)
    size = p.get("size") or {}
    area = _int(size.get("value")) if size.get("unit") == "sqm" else None
    names = [n for n in (p.get("amenity_names") or []) if isinstance(n, str)]
    utilities = {_UTILITY[n]: True for n in names if n in _UTILITY}
    title = redact_pii(p.get("title")) or None
    desc = redact_pii(p.get("description"), keep_lines=True) or None
    # ONE READER (owner 2026-11-03): prose amenities come from the Advanced Filter's word reader, never the older
    # normalize.prose_amenities — on 2026-11-05 that matcher had stored «مداخل مكيفة» (a lobby) as unit AC on 76 ads here.
    prose = amenity_answers(f"{title or ''}\n{desc or ''}", ("kitchen", "parking", "elevator", "maid_room", "driver_room",
                                                           "air_conditioner", "private_entrance"))
    rnpm = (p.get("rnpm") or {}).get("enabled")
    images = [i.get("medium") or i.get("small") for i in (p.get("images") or []) if isinstance(i, dict)]
    path = p.get("details_path") or ""
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": (C.BASE + path) if path.startswith("/") else (p.get("share_url") or None),
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": desc,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is one of the two (SIDES)
        "city": N.map_city(loc["city_ar"]) if loc["city_ar"] else None,
        "city_ar": loc["city_ar"],
        "city_id": loc["city_id"],
        "region_id": loc["region_id"],
        "district_ar": loc["district_ar"],
        "neighborhood": loc["neighborhood"],
        "area_m2": area,
        "bedrooms": _int(p.get("bedrooms_value")),
        "bathrooms": _int(p.get("bathrooms_value")),
        "furnished": _FURNISHED.get(str(p.get("furnished") or "")),
        "license_number": str(p["rera"]).strip() if p.get("rera") else None,
        "rent_now_pay_later": bool(rnpm) if deal == "Rent" and rnpm is not None else None,
        "photo_urls": [u for u in images if u] or None,
        "date_added": p.get("listed_date"),
        "last_update": p.get("last_refreshed_at"),
        **prose,
        **utilities,
        **prices,
    }
    info = {
        "source_id": pid,
        "pf_reference": p.get("reference"),
        "pf_property_type": p.get("property_type"),
        "pf_offering_type": offering,
        "pf_category_id": p.get("category_id"),
        "price_period": (p.get("price") or {}).get("period"),
        "price_value": (p.get("price") or {}).get("value"),
        "price_per_area": p.get("price_per_area"),
        "size": size or None,
        "bedrooms_label": p.get("bedrooms"),
        "bathrooms_label": p.get("bathrooms"),
        "furnished_label": p.get("furnished"),
        "completion_status": p.get("completion_status") or None,
        "amenities": p.get("amenities") or None,
        "amenity_names": names or None,
        "payment_method": p.get("payment_method") or None,
        "rnpm": p.get("rnpm"),
        "utilities_price_type": p.get("utilities_price_type"),
        "mortgage_cashback": p.get("mortgage_cashback"),
        "images_count": p.get("images_count"),
        # the card's «رقم رخصة الإعلان» row reads this key (remote.ts ADDL_FIELDS), as Haraj's run.py writes it
        "rega_ad_license_number": row["license_number"],
        "location": loc["pf_location"],
        **loc["pin"],
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    row["source_capture"] = {"schema": "propertyfinder.category.v1", "item": clean_record(p),
                             "badges": {k: p.get(k) for k in BADGES if k in p}}
    return (row, category), ""


def offplan_row(p: dict, side: str) -> dict:
    path = p.get("details_path") or ""
    return {"ad_number": f"{PREFIX}{p['id']}", "side": side,
            "listing_url": (C.BASE + path) if path.startswith("/") else None,
            "completion_status": p.get("completion_status"), "record": clean_record(p),
            "last_seen_at": datetime.now(timezone.utc).isoformat()}


def walk_all(log=print) -> dict[str, dict]:
    sides: dict[str, dict] = {}
    for key, _deal, _cat, path in C.SIDES:
        log(f"{SOURCE}: walking {key}")
        s = C.walk_side(path, log=lambda _m: None)
        if not C.complete(s, floor=1.0) and s["pages_read"] >= s["page_count"]:
            # the default order drifts while we read: walk once more and merge (owner: reach EVERY ad)
            again = C.walk_side(path, log=lambda _m: None)
            s["props"] = {**again["props"], **s["props"]}
            s["min_total"] = min(s["min_total"] or again["min_total"], again["min_total"] or s["min_total"])
            s["second_pass"] = True
        log(f"  {key}: {len(s['props'])} unique of total_count {s['min_total']}–{s['total_count']} "
            f"({s['pages_read']}/{s['page_count']} pages, complete={C.complete(s)})")
        sides[key] = s
    return sides


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--save", default="", help="also write the walk's coverage + ids to this JSON file")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    sides: dict[str, dict] = {}
    try:
        sides = walk_all()
        res: list[dict] = []
        com: list[dict] = []
        offplan: list[dict] = []
        skipped: Counter = Counter()
        for key, deal, cat, _path in C.SIDES:
            for p in sides[key]["props"].values():
                if is_off_plan(p):
                    offplan.append(offplan_row(p, key))
                    continue
                got, why = map_listing(p, deal, cat)
                if not got:
                    skipped[why] += 1
                    continue
                (res if got[1] == "residential" else com).append(got[0])
        cover = {k: {"unique": len(s["props"]), "total_count": s["total_count"], "min_total": s["min_total"],
                     "pages": f"{s['pages_read']}/{s['page_count']}", "complete": C.complete(s)}
                 for k, s in sides.items()}
        print(f"  coverage: {json.dumps(cover)}", flush=True)
        print(f"  mapped: {len(res)} residential + {len(com)} commercial; off-plan stored hidden: {len(offplan)}; "
              f"skipped (not guessed): {dict(skipped)}", flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps({"coverage": cover, "skipped": skipped,
                                                "ids": {k: sorted(s["props"]) for k, s in sides.items()}}))
        if a.dry_run:
            return 0
        for i in range(0, max(len(res), len(com)), 200):   # 200 a request: a 3,400-row body would time out
            db.upsert_propertyfinder_residential_batch(res[i:i + 200])
            db.upsert_propertyfinder_commercial_batch(com[i:i + 200])
        db.upsert_propertyfinder_offplan(offplan)
        notes = [f"coverage {json.dumps(cover)}"]
        # an ad that moved between Property Finder's residential and commercial categories leaves its old table
        superseded = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE,
                                                   res_ads={r["ad_number"] for r in res},
                                                   com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            notes.append(f"superseded={superseded}")
        feeds = {RES_TABLE: ("res_buy", "res_rent"), COM_TABLE: ("com_buy", "com_rent")}
        for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
            if rows and all(cover[k]["complete"] for k in feeds[tbl]):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=_absent_from_complete_list)
                notes.append(f"{tbl} pruned={n}")
            else:
                notes.append(f"{tbl} NOT pruned: a side feeding it was not walked completely")
        print("  " + "; ".join(notes[1:]), flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=sum(len(s["props"]) for s in sides.values()),
                             rows_upserted=len(res) + len(com), notes="; ".join(notes)[:900],
                             check_tables=["propertyfinder_residential_listings", "propertyfinder_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001 — a wall or any error: record it, prune nothing
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=sum(len(s["props"]) for s in sides.values()), rows_upserted=0,
                       notes=f"{type(e).__name__}: {e}"[:300])
        raise


def _absent_from_complete_list(ad_number: str) -> tuple[str, str]:
    """prune_unseen's answer at grace: «absent», never «gone». The ad's own page is robots-403 and is never fetched,
    so nothing here read a removal. OWNER DECISION 2026-11-10, this site only (LISTING_LIVENESS.md §7.3): an ad
    missing from 3 COMPLETE list walks in a row is HIDDEN. db.prune_unseen honours «absent» only for a platform named
    in liveness_policies.COMPLETE_LIST_ABSENCE_HIDES; main() calls it only when every side feeding the table walked
    completely. The row is kept, never deleted, and the next walk that lists it again un-hides it (the upsert)."""
    return COMPLETE_LIST_ABSENCE_VERDICT, ("absent from 3 consecutive COMPLETE category-list walks; own page is "
                                           "robots-403, never read — hidden by owner decision 2026-11-10, returns "
                                           "when the list shows it again")


if __name__ == "__main__":
    raise SystemExit(main())
