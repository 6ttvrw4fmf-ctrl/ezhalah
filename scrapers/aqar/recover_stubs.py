"""Re-enrich Aqar rows stuck on the June `backfill.v1` STUB capture.

WHY THIS EXISTS
---------------
The 2026-06-18..30 bulk load stored a stub `source_capture.source_text` — the description only,
averaging ~381 chars, with NO «تفاصيل الإعلان» specification block (healthy captures average ~2,594
chars and contain it). Every label-anchored parser in enrich_residential.py reads that block, so on a
stub row they silently extract NOTHING. That single root cause is why those rows are missing bedrooms,
bathrooms, floor, direction, age, licence and amenities — and it is why 184 of them hold a NULL
rent_period while aqar publishes «سنوي», leaving them invisible in BOTH annual and monthly search.

Neither of the two jobs that touch these rows can heal them:
  • sweep.py re-reads only the first N pages per city, so deep rows are never revisited;
  • liveness.py checks whether a listing still exists and never re-parses it.

So the fix is to re-fetch each listing and re-run the CURRENT parser over it. Nothing here re-implements
parsing: it calls the production `enrich_residential()` and the production `db.upsert_aqar_residential()`,
so the recovered rows go through the exact same triggers, canonical mapping and sync as a normal crawl.

MUST RUN FROM AN ENVIRONMENT AQAR SERVES
----------------------------------------
aqar.fm returns a ~241 KB app SHELL (title «تطبيق عقار», no listing payload) to unfamiliar clients. The
GitHub Actions runners get real listing pages, which is why the nightly crawls work. This script is
therefore designed to run in CI, not on a laptop. It fails loudly rather than writing on a bad fetch.

FIDELITY
--------
Nothing is invented. `enrich_residential()` writes only what it can read from the page; a field aqar
does not publish stays NULL. `--dry-run` prints the before/after diff without writing, so the recovery
can be inspected before it touches production.

Usage:
  python -m scrapers.aqar.recover_stubs --limit 200 --dry-run
  python -m scrapers.aqar.recover_stubs --limit 2000 --deal rent --type apartment
"""
from __future__ import annotations

import argparse
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.aqar.enrich_residential import enrich_residential  # noqa: E402

TABLE = "aqar_residential_listings"
# The fields the stub costs us. Used only for the before/after report — never to decide a write.
REPORT_FIELDS = (
    "rent_period", "price_annual", "price_total", "area_m2", "bedrooms", "bathrooms",
    "property_age", "floor_number", "direction", "furnished", "elevator", "parking",
    "kitchen", "license_number", "street_width_m",
)

# canonical property_type -> the aqar URL slug enrich_residential expects
TYPE_TO_SLUG = {v: k for k, v in N.SLUG_TO_TYPE.items()}


def stub_cohort(limit: int, deal: Optional[str], ptype: Optional[str]) -> list[dict[str, Any]]:
    """Active rows whose stored capture has no «تفاصيل الإعلان» spec block."""
    c = db.sb()
    q = (c.table(TABLE)
         .select("id, ad_number, listing_url, property_type, transaction_type, "
                 + ", ".join(REPORT_FIELDS))
         .eq("active", True)
         .not_.is_("listing_url", "null"))
    if deal:
        q = q.eq("transaction_type", "Rent" if deal == "rent" else "Buy")
    if ptype:
        q = q.eq("property_type", ptype)
    rows: list[dict[str, Any]] = []
    page = 0
    while len(rows) < limit:
        batch = q.range(page * 1000, page * 1000 + 999).execute().data or []
        if not batch:
            break
        rows.extend(batch)
        page += 1
        if page > 60:
            break
    # The stub test itself needs source_text, which is large — fetch it per row only for candidates.
    out: list[dict[str, Any]] = []
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        ids = [r["id"] for r in chunk]
        caps = (c.table(TABLE).select("id, source_capture").in_("id", ids).execute().data or [])
        by_id = {x["id"]: (x.get("source_capture") or {}) for x in caps}
        for r in chunk:
            txt = (by_id.get(r["id"]) or {}).get("source_text") or ""
            if "تفاصيل الإعلان" not in txt:
                r["_stub_len"] = len(txt)
                out.append(r)
                if len(out) >= limit:
                    return out
    return out


def recover(rows: list[dict[str, Any]], dry_run: bool, workers: int) -> dict[str, int]:
    counter = {"done": 0, "fetched": 0, "written": 0, "unfetchable": 0, "no_gain": 0}
    lock = threading.Lock()

    def work(r: dict[str, Any]) -> None:
        slug = TYPE_TO_SLUG.get(r.get("property_type") or "")
        deal_slug = "rent" if (r.get("transaction_type") == "Rent") else "buy"
        if not slug or not r.get("listing_url"):
            with lock:
                counter["done"] += 1
                counter["unfetchable"] += 1
            return
        fresh = enrich_residential(r["listing_url"], type_slug=slug, deal_slug=deal_slug)
        with lock:
            counter["done"] += 1
        if not fresh:
            with lock:
                counter["unfetchable"] += 1
                print(f"  [{counter['done']}] ✗ unfetchable ad={r['ad_number']}")
            return
        with lock:
            counter["fetched"] += 1
        # What the re-read actually recovers, purely for the operator's report.
        gained = {f: fresh.get(f) for f in REPORT_FIELDS
                  if r.get(f) is None and fresh.get(f) is not None}
        changed = {f: (r.get(f), fresh.get(f)) for f in REPORT_FIELDS
                   if r.get(f) is not None and fresh.get(f) is not None and r.get(f) != fresh.get(f)}
        if not gained and not changed:
            with lock:
                counter["no_gain"] += 1
                print(f"  [{counter['done']}] · ad={r['ad_number']} no change "
                      f"(aqar publishes nothing further for this listing)")
            return
        if dry_run:
            with lock:
                print(f"  [{counter['done']}] DRY ad={r['ad_number']} +{gained} ~{changed}")
            return
        try:
            db.upsert_aqar_residential(fresh)
            with lock:
                counter["written"] += 1
                print(f"  [{counter['done']}] ✓ ad={r['ad_number']} +{gained} ~{changed}")
        except Exception as e:  # noqa: BLE001
            with lock:
                print(f"  [{counter['done']}] ✗ upsert failed ad={r['ad_number']}: {str(e)[:120]}")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(work, rows))
    return counter


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=200, help="max stub rows to recover this run")
    ap.add_argument("--deal", choices=["rent", "buy"], default=None)
    ap.add_argument("--type", dest="ptype", default=None,
                    help="canonical property_type, e.g. Apartment")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true", help="print the diff, write nothing")
    args = ap.parse_args()

    rows = stub_cohort(args.limit, args.deal, args.ptype)
    print(f"stub cohort: {len(rows)} rows "
          f"(deal={args.deal or 'any'} type={args.ptype or 'any'} limit={args.limit})")
    if not rows:
        print("nothing to recover")
        return 0

    run_id = None if args.dry_run else db.begin_run("aqar_stub_recovery")
    c = recover(rows, args.dry_run, args.workers)
    print(f"\nfetched={c['fetched']} written={c['written']} "
          f"unfetchable={c['unfetchable']} no_gain={c['no_gain']} of {len(rows)}")

    # An environment aqar does not serve returns the app shell for EVERY row. Writing nothing is the
    # correct outcome there, but it must be loud — a silent 0 would look like "already clean".
    if c["fetched"] == 0 and rows:
        print("✗ 0 of {} listings returned a parseable page — this environment is not being served "
              "by aqar.fm. Run this from CI.".format(len(rows)))
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(rows), rows_upserted=0,
                       notes="aqar unreachable: 0 parseable pages")
        return 1
    if run_id:
        db.end_run(run_id, ok=True, rows_seen=c["fetched"], rows_upserted=c["written"],
                   notes=f"stub_recovery written={c['written']} no_gain={c['no_gain']} "
                         f"unfetchable={c['unfetchable']}",
                   check_tables=[TABLE])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
