"""Every number in the 🆕 New Listings Engineer's report block, computed from the database.

    python -m scrapers.common.new_listings_report [--hours 24] [--json]

The engineer PASTES this output (docs/ops/NEW_LISTINGS_ENGINEER.md, "Report"); anything it writes
by hand is marked "(hand-computed)". READ-ONLY. The numbers are the rulebook scorecard's own
(SCORECARD_SQL below, copied verbatim from "Run the scorecard FIRST"), computed here over the same
window through PostgREST because this key cannot run raw SQL. A number that could not be read
prints as "?", never as 0.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

PAGE = 1000

# The rulebook's scorecard, verbatim (docs/ops/NEW_LISTINGS_ENGINEER.md). Anyone with SQL access
# runs THIS; collect() computes the same facts row by row.
SCORECARD_SQL = """
with w as (
  select platform, (first_seen_at > now() - interval '24 hours') as today,
         production_ready, city_id, district_ar, deal_ar, type_ar, rent_period_ar,
         coalesce(price_total, price_annual, price_per_meter) as price, area_m2, bedrooms,
         num_nonnulls(furnished, property_age, elevator, parking, kitchen, air_conditioner, maid_room,
           driver_room, private_entrance, street_width_m, floor_number, direction_ar, rent_now_pay_later,
           installment_available, balcony, pool, garden, living_rooms, majlis_rooms, total_floors,
           ac_type, furnishing_level) as af_n
  from search_listings_ar where first_seen_at > now() - interval '8 days')
select platform,
  count(*) filter (where today) as new_24h,
  round(100.0*avg(production_ready::int) filter (where today)) as searchable,
  round(100.0*avg((city_id is not null)::int) filter (where today)) as city,
  round(100.0*avg((district_ar is not null)::int) filter (where today)) as district,
  round(100.0*avg((district_ar is not null)::int) filter (where not today)) as district_7d,
  round(100.0*avg((type_ar is not null and deal_ar is not null)::int) filter (where today)) as type_deal,
  round(100.0*avg((rent_period_ar is not null)::int) filter (where today and deal_ar='إيجار')) as period,
  round(100.0*avg((price is not null)::int) filter (where today)) as price,
  round(100.0*avg((price is not null)::int) filter (where not today)) as price_7d,
  round(100.0*avg((area_m2 is not null)::int) filter (where today)) as size,
  round(100.0*avg((area_m2 is not null)::int) filter (where not today)) as size_7d,
  round(avg(af_n) filter (where today),1) as af_fields,
  round(avg(af_n) filter (where not today),1) as af_fields_7d
from w group by platform having count(*) filter (where today) > 0
order by new_24h desc;
"""

AF_BOOLEANS = ("furnished", "elevator", "parking", "kitchen", "air_conditioner", "maid_room",
               "driver_room", "private_entrance", "rent_now_pay_later", "installment_available",
               "balcony", "pool", "garden")
COLS = ("platform,production_ready,region_ar,city_id,district_ar,deal_ar,type_ar,rent_period_ar,"
        "price_total,price_annual,price_per_meter,area_m2,bedrooms," + ",".join(AF_BOOLEANS))
RENT = "إيجار"   # إيجار
BUY = "بيع"                # بيع


def _all(q) -> list[dict]:
    out: list[dict] = []
    lo = 0
    while True:
        rows = q.range(lo, lo + PAGE - 1).execute().data or []
        out += rows
        if len(rows) < PAGE:
            return out
        lo += PAGE


def _pct(part: int, whole: int) -> float | None:
    return round(100.0 * part / whole, 1) if whole else None


def _rng(vals: list) -> dict | None:
    v = sorted(x for x in vals if x is not None)
    return {"min": v[0], "median": statistics.median(v), "max": v[-1]} if v else None


def collect(client, *, hours: int = 24, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(hours=hours)).isoformat()
    errors: list[str] = []
    try:
        rows = _all(client.table("search_listings_ar").select(COLS)
                    .gte("first_seen_at", since).order("listing_id"))
    except Exception as e:  # noqa: BLE001 — the report must still print, every number "?"
        errors.append(f"search_listings_ar: {str(e)[:160]}")
        rows = None

    sites: dict[str, dict] = {}
    totals = None
    if rows is not None:
        by_site: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            by_site[r["platform"]].append(r)
        for p, rs in sorted(by_site.items(), key=lambda kv: -len(kv[1])):
            sites[p] = _bucket(rs)
        totals = _bucket(rows)

    try:
        backlog = (client.table("search_listings_ar").select("listing_id", count="exact")
                   .eq("production_ready", True).is_("district_ar", "null").limit(1).execute().count)
    except Exception as e:  # noqa: BLE001
        errors.append(f"no-district backlog: {str(e)[:160]}")
        backlog = None

    try:
        open_items = _all(client.table("ops_engineer_backlog").select("id,item,opened_at,evidence")
                          .eq("engineer", "new_listings_engineer").eq("status", "open").order("opened_at"))
    except Exception as e:  # noqa: BLE001 — until the migration lands the table does not exist
        errors.append(f"ops_engineer_backlog: {str(e)[:120]} (open items unknown until the table exists)")
        open_items = None

    return {"hours": hours, "now": now.isoformat(), "errors": errors, "sites": sites,
            "totals": totals, "no_district_backlog": backlog, "open_items": open_items}


def _bucket(rs: list[dict]) -> dict:
    n = len(rs)
    deals = defaultdict(int)
    for r in rs:
        if r.get("deal_ar") == BUY:
            deals["buy"] += 1
        elif r.get("deal_ar") == RENT:
            deals[r.get("rent_period_ar") or "rent_no_stated_period"] += 1
        else:
            deals["no_deal"] += 1
    price = [r.get("price_total") or r.get("price_annual") or r.get("price_per_meter") for r in rs]
    af = {}
    for c in AF_BOOLEANS:
        yes = sum(1 for r in rs if r.get(c) is True)
        no = sum(1 for r in rs if r.get(c) is False)
        if yes or no:
            af[c] = {"yes": yes, "no": no, "unknown": n - yes - no}
    return {
        "new": n,
        "searchable_pct": _pct(sum(1 for r in rs if r.get("production_ready")), n),
        "region_pct": _pct(sum(1 for r in rs if r.get("region_ar") is not None), n),
        "city_pct": _pct(sum(1 for r in rs if r.get("city_id") is not None), n),
        "district_pct": _pct(sum(1 for r in rs if r.get("district_ar") is not None), n),
        "deal_split": dict(deals),
        "price": {
            "buy": _rng([p for r, p in zip(rs, price) if r.get("deal_ar") == BUY]),
            "rent": _rng([p for r, p in zip(rs, price) if r.get("deal_ar") == RENT]),
        },
        "af": af,
    }


def _n(v) -> str:
    return "?" if v is None else str(v)


def render(rep: dict) -> str:
    out = [f"# \U0001f195 New-listings numbers · last {rep['hours']} h · computed {rep['now']}", ""]
    if rep["errors"]:
        out += ["**Could not read (these numbers are «?», never 0):**"] + [f"- {e}" for e in rep["errors"]] + [""]
    t = rep["totals"]
    if t is None:
        out.append("new in the window: ? · searchable ?% · region ?% · city ?% · district ?%")
    else:
        out.append(f"**Total:** {t['new']} new · searchable {_n(t['searchable_pct'])}% · "
                   f"region {_n(t['region_pct'])}% · city {_n(t['city_pct'])}% · "
                   f"district {_n(t['district_pct'])}%")
        out.append("deal split: " + (", ".join(f"{k}={v}" for k, v in t["deal_split"].items()) or "none"))
        for k in ("buy", "rent"):
            r = t["price"][k]
            out.append(f"price {k}: " + ("?" if r is None else f"{r['min']}–{r['max']} (typical {r['median']})"))
    out += ["", f"**No-district backlog (production_ready, NULL district):** {_n(rep['no_district_backlog'])}", "",
            "| website | new | searchable | region | city | district | deal split |", "|---|---|---|---|---|---|---|"]
    for p, s in rep["sites"].items():
        split = " ".join(f"{k}:{v}" for k, v in s["deal_split"].items())
        out.append(f"| {p} | {s['new']} | {_n(s['searchable_pct'])}% | {_n(s['region_pct'])}% | "
                   f"{_n(s['city_pct'])}% | {_n(s['district_pct'])}% | {split} |")
    out += ["", "**Advanced Filter, all new listings (yes / no / unknown):**"]
    if t:
        for c, v in t["af"].items():
            out.append(f"- {c}: yes {v['yes']} · no {v['no']} · unknown {v['unknown']}")
        if not t["af"]:
            out.append("- no AF boolean got a value in the window")
    else:
        out.append("- ?")
    items = rep["open_items"]
    out += ["", "**Open items (ops_engineer_backlog, engineer=new_listings_engineer):**"]
    if items is None:
        out.append("- ? (table not readable; see errors)")
    elif not items:
        out.append("- none")
    else:
        out += [f"- #{i['id']} {i['item']} (opened {i['opened_at']})" for i in items]
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    from scrapers.common.db import sb
    rep = collect(sb(), hours=args.hours)
    sys.stdout.write(json.dumps(rep, ensure_ascii=False, indent=1, default=str) + "\n" if args.json
                     else render(rep))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
