"""شركة مقام للتطوير العقاري (maqamco.sa) — a Riyadh developer/manager on the Nuzul SaaS platform
(tenant 5348).

SAME ENGINE AS scrapers/goldendeal/run.py (the parametrised Nuzul tenant engine yameen already
reuses) — read that docstring for the API shape, the traps and the removal-oracle law. Only the
Tenant constants, the two Maqam-specific rules below and main() live here. Measured live 2026-09-26
over the whole catalogue (130 items).

WHERE THE LISTINGS ARE. maqamco.sa is a WordPress marketing site; its 15 «projects» pages are
brochures, not listings. The catalogue is the Nuzul storefront https://property.maqamco.sa/
(page RSC «tenantUrl: maqamco») served by maqamco.nzl-backend.com/api/public/properties
(meta.total 130, 3 pages × 50, 130 distinct ids). SOURCE is the name the storefront and the
marketing site both print (og:site_name, every listing's <title>): «شركة مقام للتطوير العقاري».
robots.txt on property.maqamco.sa disallows only /profile and /en/profile.

MEASURED 2026-09-26 (130 items):
    availability   available 50 · sold 59 · unavailable 10 · reserved 7 · rented 4 → only 50
                   publishable; the rest are skipped as status_<value> by the engine.
    Wafi           is_wafi_ad = 1 on 3 available sale floors (project «مقام 19») → skipped as
                   offplan_wafi (Wafi is the off-plan sale licence). wafi_license_number is null on
                   all 50; it is read too, so a licence number without the flag also skips.
    types          building_apartment 39 · villa 4 · floor 4 · building 2 · land 1 — category
                   residential 50 · purpose sell 34 / rent 16 · city الرياض 50 · district 50/50
    rent           all 16 publish rent_price_annually only → stored verbatim, rent_period annual.
    price          51319 (sale villa) publishes no selling_price → price_total NULL, never 0.
    area           27 of 50 are fractional (204.44, 91.84 …) → stored as the verbatim float;
                   the engine's integer area_m2 is replaced here (fleet rule: area verbatim).
    bedrooms       0 on the 3 Wafi floors + 2 buildings: a 0 is the form default, never a count
                   (engine: to_int_numeric → NULL; non-dwelling types carry no bedrooms at all).
    PII            whatsapp_number (4) and rega_advertiser_number (24) dropped by the engine's
                   PII_KEYS + redact_capture; descriptions go through redact_pii.
    coverage       measured on the 2026-09-26 dry run, 47 kept rows: city_id 47  district_ar 47
                   photos 47 (the engine's "photo_urls": _photos(L) — images[] on S3, per listing)
                   area_m2 46  bedrooms 44  license_number 24.
    listing_url    https://property.maqamco.sa/properties/{id}

    python -m scrapers.maqam.run --dry-run      # validate, zero DB writes
    python -m scrapers.maqam.run                # full crawl + prune
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.goldendeal.run import (  # noqa: E402
    Tenant, crawl, make_canary, map_listing as _map_listing, print_dry, session as _session,
    tally_str, verify_gone_for)

TENANT = Tenant("maqam", "شركة مقام للتطوير العقاري", "MQM", "https://property.maqamco.sa",
                "maqamco.nzl-backend.com")
BASE = TENANT.base
SOURCE = TENANT.source
PREFIX = TENANT.prefix
PLATFORM = TENANT.platform
SLUG = PLATFORM
RES_TABLE = "maqam_residential_listings"
COM_TABLE = "maqam_commercial_listings"


def session():
    return _session(TENANT)


def _area(v: Any) -> Optional[float]:
    """The source's area as a float, verbatim (204.44 stays 204.44). 0/blank → NULL."""
    try:
        f = float(str(v).translate(N._TRANS).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _is_wafi(L: dict) -> bool:
    return N.to_int_numeric(L.get("is_wafi_ad")) == 1 or bool(L.get("wafi_license_number"))


def map_listing(L: dict, tenant: Tenant = TENANT, **kw):
    row, cat, why = _map_listing(L, tenant, **kw)
    if not row:
        return row, cat, why                      # status/type/deal/city skips keep priority
    if _is_wafi(L):
        return None, cat, "offplan_wafi"
    # transaction_type restated as a total expression (fleet null-deal lint scans per writer file).
    row = {**row, "transaction_type": "Rent" if row["transaction_type"] == "Rent" else "Buy",
           "area_m2": _area(L.get("area"))}
    return row, cat, why


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(PLATFORM)
    skipped: dict[str, int] = {}
    try:
        items, total, res, com, skipped = crawl(s, TENANT, limit=args.limit, mapper=map_listing)
        if not items:
            raise RuntimeError("API returned no items (0 of an expected ~130)")
        complete = not args.limit and total is not None and len(items) == total
        note = f"{len(items)} items, api total {total}"
        print(f"{SOURCE}: {note}", flush=True)
        if not args.limit and not complete:
            print(f"  ! crawl/total mismatch: enumerated {len(items)} vs api total {total}")
        if args.type != "all":
            res, com = (res if args.type == "residential" else []), (com if args.type == "commercial" else [])
        tally = tally_str(skipped)
        if tally:
            print(f"  skipped (not guessed): {tally}")
        if dry:
            print_dry(SOURCE, res, com)
            return 0
        db.upsert_maqam_residential_batch(res)
        db.upsert_maqam_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        degraded = False
        if args.type == "all" and complete:
            control = next((int(r["ad_number"][len(PREFIX):]) for r in res + com), None)
            verify = verify_gone_for(TENANT, make_canary(TENANT, control))
            for table, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                pruned = db.prune_unseen(table, {r["ad_number"] for r in rows}, SOURCE,
                                         verify_gone=verify)
                degraded = degraded or pruned < 0
                print(f"  {table}: pruned {pruned}")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com), degraded=degraded,
                             notes=f"{note}; skipped: {tally or 'none'}"[:300],
                             check_tables=["maqam_residential_listings",
                                           "maqam_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e}; skipped: {tally_str(skipped) or 'none'}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
