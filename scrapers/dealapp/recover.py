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
SELECT_CHUNK = 200   # ad_numbers per protection-lookup round-trip

# A dual-table platform routes each ad to exactly ONE of these; the other is its sibling.
SIBLING = {TABLES[0]: TABLES[1], TABLES[1]: TABLES[0]}


def _protected(table: str, rows: list[dict]) -> set[int]:
    """Row ids this sweep must NEVER reactivate, whatever the live page says.

    THE ORACLE CANNOT ANSWER THIS QUESTION. `_classify` asks "is this URL still live?" — but a
    res/com collision is two of OUR rows sharing ONE source URL, so the page is live for both and
    'live' is returned for the superseded row just as confidently as for the surviving one. That
    verdict then sets active=true, and the orphan is back as a second Normal Filter card clicking
    through to the same ad. This is the exact self-healing failure `retire_superseded_siblings`
    documents for verify_gone, in a second code path that was left unguarded.

    Measured live 2026-08-31: run 38444 reported `recovered=2` and those two rows were dealapp
    DA499170 + DA549199 — retired by the 2026-08-30 collision repair with recorded source evidence
    («محطة وقود», «أرض تجارية») and reactivated by this sweep the next night.

    Two independent protections, because they cover different rows:
      • ADJUDICATED — a decision is on record for this row (ops_adjudicated_listing). The SQL
        recovery path auto_recover_false_inactive() grew exactly this guard on 2026-08-30; this
        job is the other half of the same net and must agree with it, or a nightly sweep simply
        undoes what the adjudication settled.
      • SIBLING-ACTIVE — the same ad_number is live in the sibling table. Structural and needs no
        prior decision, so it also protects a collision nobody has adjudicated yet.
    """
    if not rows:
        return set()
    by_ad = {(r.get("ad_number") or ""): r["id"] for r in rows if r.get("ad_number")}
    ids = {r["id"] for r in rows}

    adjudicated = {
        r["listing_id"]
        for r in (sb().table("ops_adjudicated_listing").select("listing_id")
                  .eq("tbl", table).execute().data or [])
    } & ids

    sibling_live: set[int] = set()
    ads = sorted(by_ad)
    for i in range(0, len(ads), SELECT_CHUNK):
        chunk = ads[i:i + SELECT_CHUNK]
        live = (sb().table(SIBLING[table]).select("ad_number")
                .in_("ad_number", chunk).eq("active", True).execute().data or [])
        sibling_live |= {by_ad[r["ad_number"]] for r in live if r.get("ad_number") in by_ad}

    blocked = adjudicated | sibling_live
    if blocked:
        print(f"   ⛔ {table}: {len(blocked)} row(s) protected from recovery "
              f"({len(adjudicated)} adjudicated, {len(sibling_live)} live in "
              f"{SIBLING[table]}) — a shared URL cannot prove which row is the live one", flush=True)
    return blocked


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
    # Filter BEFORE --limit so a protected row can never consume a slot, and before any fetch so
    # the sweep does not spend a request deciding something it is not allowed to act on.
    blocked = _protected(table, rows)
    rows = [r for r in rows if r["id"] not in blocked]
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
