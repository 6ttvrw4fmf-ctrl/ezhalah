"""Deal App inactive-row recovery — re-check inactive rows against their LIVE ad pages.

WHY (owner decision 2026-07-21): dealapp's inactive stock (~2.4k rows) is almost entirely mc=0
age-sweep kills from mark_stale_listings_inactive — "not crawled for 7 days", NOT "page says
gone". A 40-row source audit found ZERO dead ads in that stock: 12 schema-InStock + browser-
verified live ads among the rest. dealapp's crawler enumerates ~half the catalog on a good day,
so a live ad routinely goes unseen past the stale window and gets killed while still published.
auto_recover_false_inactive() can't help — it only fires when the crawler re-SEES a row.

WHAT THIS DOES: for every active=false row, fetch its real /ad-details page (same session,
retry and skeleton discipline as the main scraper via fetch_one) and:
  • schema offers.availability=InStock and no مباع/مؤجر badge  → REACTIVATE
    (active=true, missing_count=0, last_seen_at=now — the page IS a sighting).
  • SoldOut/OutOfStock availability or a تم البيع/تم التأجير badge → stays inactive (genuinely gone).
  • 404/410, persistent skeleton, or no parseable schema           → UNTOUCHED (unknown ≠ alive).
This job NEVER sets active=false on anything — recovery is strictly additive.

Usage:  python -m scrapers.dealapp.recover [--table dealapp_residential_listings|
        dealapp_commercial_listings|all] [--limit N] [--workers N]
"""
from __future__ import annotations

import argparse
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from scrapers.common.db import begin_run, end_run, sb
from scrapers.dealapp.run import _listing_schema, fetch_one

TABLES = ["dealapp_residential_listings", "dealapp_commercial_listings"]
PAGE = 1000          # supabase select page size
UPDATE_CHUNK = 100   # reactivations per update round-trip


def _inactive_rows(table: str, limit: int) -> list[dict]:
    rows: list[dict] = []
    lo = 0
    while True:
        page = (
            sb().table(table)
            .select("id,ad_number")
            .eq("active", False)
            .order("id")
            .range(lo, lo + PAGE - 1)
            .execute().data or []
        )
        rows.extend(page)
        if len(page) < PAGE or (limit and len(rows) >= limit):
            break
        lo += PAGE
    return rows[:limit] if limit else rows


def _classify(html: str) -> str:
    """'live' | 'sold' | 'unknown' — mirrors map_listing's active/sold rules exactly."""
    schema = _listing_schema(html)
    if not schema:
        return "unknown"
    availability = ((schema.get("offers") or {}).get("availability") or "").lower()
    head = html[: html.find("real-estate")] if "real-estate" in html else ""
    if "soldout" in availability or "outofstock" in availability \
       or "تم البيع" in head or "تم التأجير" in head:
        return "sold"
    if "instock" in availability:
        return "live"
    return "unknown"  # schema without an explicit availability: not proof of life


def recover_table(table: str, limit: int, workers: int) -> dict:
    rows = _inactive_rows(table, limit)
    stats = {"checked": 0, "recovered": 0, "sold": 0, "unknown": 0}
    lock = threading.Lock()
    to_reactivate: list[int] = []

    def work(row: dict) -> None:
        adid = (row.get("ad_number") or "").removeprefix("DA")
        verdict = "unknown"
        if adid.isdigit():
            got = fetch_one(adid)
            if got:
                verdict = _classify(got[0])
        with lock:
            stats["checked"] += 1
            if verdict == "live":
                stats["recovered"] += 1
                to_reactivate.append(row["id"])
            else:
                stats["sold" if verdict == "sold" else "unknown"] += 1
            if stats["checked"] % 100 == 0:
                print(f"   [{stats['checked']}/{len(rows)}] recovered={stats['recovered']} "
                      f"sold={stats['sold']} unknown={stats['unknown']}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, rows))

    now = datetime.now(timezone.utc).isoformat()
    for i in range(0, len(to_reactivate), UPDATE_CHUNK):
        chunk = to_reactivate[i:i + UPDATE_CHUNK]
        sb().table(table).update(
            {"active": True, "missing_count": 0, "last_seen_at": now}
        ).in_("id", chunk).execute()

    print(f"   ✓ {table}: checked={stats['checked']} recovered(→active)={stats['recovered']} "
          f"sold-confirmed={stats['sold']} unknown-untouched={stats['unknown']}", flush=True)
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description="Deal App inactive-row recovery sweep")
    ap.add_argument("--table", default="all", choices=TABLES + ["all"])
    ap.add_argument("--limit", type=int, default=0, help="cap rows per table (0 = all)")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    tables = TABLES if args.table == "all" else [args.table]
    run_id = begin_run("dealapp_recover")
    totals = {"checked": 0, "recovered": 0, "sold": 0, "unknown": 0}
    ok = True
    try:
        for t in tables:
            st = recover_table(t, args.limit, args.workers)
            for k in totals:
                totals[k] += st[k]
        notes = (f"recovered={totals['recovered']} sold={totals['sold']} "
                 f"unknown={totals['unknown']} of checked={totals['checked']}")
    except Exception as e:  # noqa: BLE001
        ok = False
        notes = str(e)[:400]
        print(f"\n✗ FATAL: {e}")
    finally:
        # allow_empty: a sweep that finds nothing to recover is a legitimate, healthy outcome.
        end_run(run_id, ok=ok, rows_seen=totals["checked"], rows_upserted=totals["recovered"],
                notes=notes, allow_empty=True)
    print(f"\n📊 Deal App recovery done. {totals['recovered']} reactivated / "
          f"{totals['checked']} checked. (run_id={run_id})")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
