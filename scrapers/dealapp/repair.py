"""Legacy fidelity repair for Deal App rows (bug-hunt 2026-07-30).

WHY: two legacy-parser corruption classes are frozen in old rows and never self-heal —
recover.py only flips liveness, and the crawler doesn't systematically re-parse known ads:
  1) PRICE x100 — before the 2026-07-13 normalize.to_int decimal fix, a fractional source
     price ("7000098.99") had its '.' stripped -> 700009899 stored (live-confirmed ids
     1726109/1039869/956949...). Integer-priced ads were always faithful.
  2) AREA digit-concatenation — an old text parser concatenated digit runs from the free-text
     description ("المساحة : 450م ... شارع 20 بطول 18م" -> 4502018) instead of the structured
     المساحة field (live-confirmed 1206554/956972/2295991).

WHAT: re-fetch each candidate ad's live page and re-parse it with the CURRENT fetch_one() +
map_listing() — the exact production path — then batch-upsert the fresh row. Source-faithful by
construction: a candidate whose live values already match simply rewrites the same values. No
arithmetic "fixes" are ever applied locally (listing-fidelity rule: never blanket-/100 — some
%100<>0 prices are genuinely faithful, e.g. DA221536).

Candidates (ACTIVE rows only, both tables), computed client-side after a full page-through:
  scraped_at < 2026-07-14 (pre-decimal-fix legacy)
  OR price_total % 100 <> 0  OR price_annual % 100 <> 0   (x100 candidates)
  OR area_m2 > 10000                                       (concatenation candidates)

404/410 ads are reported but left untouched (liveness belongs to recover/prune, not here).
A parse whose category no longer matches its source table is skipped and reported — repair
never dual-writes a row into the other table.

  python -m scrapers.dealapp.repair [--limit N] [--workers 6] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from scrapers.common.db import sb, upsert_dealapp_commercial_batch, upsert_dealapp_residential_batch
from scrapers.dealapp.run import _pin_sold_inactive, fetch_one, map_listing

TABLES = {
    "dealapp_residential_listings": "residential",
    "dealapp_commercial_listings": "commercial",
}
PAGE = 1000
CUTOFF = "2026-07-14"  # first crawl day fully on the decimal-safe to_int
BATCH = 50


def _candidates(table: str) -> list[dict]:
    rows: list[dict] = []
    lo = 0
    while True:
        page = (
            sb().table(table)
            .select("id,ad_number,scraped_at,price_total,price_annual,area_m2")
            .eq("active", True)
            .order("id")
            .range(lo, lo + PAGE - 1)
            .execute().data or []
        )
        rows.extend(page)
        if len(page) < PAGE:
            break
        lo += PAGE

    def is_candidate(r: dict) -> bool:
        if (r.get("scraped_at") or "9999") < CUTOFF:
            return True
        for k in ("price_total", "price_annual"):
            v = r.get(k)
            if isinstance(v, int) and v % 100 != 0:
                return True
        a = r.get("area_m2")
        return isinstance(a, int) and a > 10_000

    return [r for r in rows if is_candidate(r)]


def main() -> int:
    ap = argparse.ArgumentParser(description="Deal App legacy fidelity repair (re-fetch + current parser)")
    ap.add_argument("--limit", type=int, default=0, help="cap candidates per table (0 = all)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true", help="fetch+parse+report, write nothing")
    args = ap.parse_args()

    started = datetime.now(timezone.utc).isoformat()
    grand = {"candidates": 0, "repaired": 0, "gone": 0, "cat_flip": 0, "fetch_fail": 0, "changed_price": 0, "changed_area": 0}

    for table, category in TABLES.items():
        cands = _candidates(table)
        if args.limit:
            cands = cands[: args.limit]
        grand["candidates"] += len(cands)
        print(f"{table}: {len(cands)} candidates", flush=True)

        by_ad = {re.sub(r"\D", "", str(r["ad_number"])): r for r in cands if r.get("ad_number")}
        buf: list[dict] = []
        sold_ads: list[str] = []

        def flush() -> None:
            nonlocal buf
            if buf and not args.dry_run:
                (upsert_dealapp_residential_batch if category == "residential" else upsert_dealapp_commercial_batch)(buf)
            buf = []

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            for adid, result in zip(by_ad.keys(), ex.map(fetch_one, by_ad.keys())):
                old = by_ad[adid]
                if result is None:
                    grand["gone"] += 1  # 404/410 or unreachable — liveness is recover/prune's job
                    continue
                html, _ = result
                row, cat, sold = map_listing(html, adid)
                if not row:
                    grand["fetch_fail"] += 1
                    continue
                if cat != category:
                    grand["cat_flip"] += 1  # never dual-write across tables from a repair
                    print(f"  SKIP category-flip ad {adid}: table={category} parsed={cat}", flush=True)
                    continue
                if row.get("price_total") != old.get("price_total") or row.get("price_annual") != old.get("price_annual"):
                    grand["changed_price"] += 1
                if row.get("area_m2") != old.get("area_m2"):
                    grand["changed_area"] += 1
                grand["repaired"] += 1
                buf.append(row)
                if sold:
                    # The re-fetch found a source-confirmed SOLD/RENTED ad among candidates (repair
                    # only re-fetches currently-ACTIVE rows, so this is a state change, not a no-op).
                    # Without this pin, upsert_dealapp_*_batch's shared _wasalt_batch path writes
                    # active=False + missing_count=0 (the batch upsert always resets missing_count),
                    # which is exactly the unverified-kill signature auto_recover_false_inactive()
                    # resurrects every morning — the same defect class Batch 3 fixed in run.py's
                    # own sold path (see test_sold_pin_coverage.py), but repair.py (added 2026-07-30,
                    # after that guard) was never wired to the pin and silently regressed it.
                    sold_ads.append(row["ad_number"])
                if len(buf) >= BATCH:
                    flush()
        flush()
        if sold_ads and not args.dry_run:
            _pin_sold_inactive(table, sold_ads)
            grand["sold_pinned"] = grand.get("sold_pinned", 0) + len(sold_ads)

    print(f"REPAIR {'DRY-RUN ' if args.dry_run else ''}done (started {started}): {grand}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
