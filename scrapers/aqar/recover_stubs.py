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

# Fields whose value comes from aqar's own STRUCTURED keys (the RSC listing object) or from a
# label-anchored spec-table read. These are safe to recover: the re-read either finds aqar's stated
# value or leaves the field unknown.
_STRUCTURED_SAFE = {
    "furnished", "property_age", "bathrooms", "bedrooms", "floor_number", "street_width_m",
    "license_number", "license_expiry", "ad_source", "tenant_category", "direction",
    "elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room",
    "private_entrance", "car_entrance", "water_supply", "electricity", "sanitation",
    "optical_fibers", "laundry_room", "balcony_terrace", "separate_water_meter",
    "separate_electricity_meter", "extension", "special_surface", "special_position",
    "villa_on_roof", "apartment_in_project", "master_bedrooms", "halls",
    "reception_rooms_majlis", "rega_location_verified", "num_apartments",
}
# Fields the recovery holds back by default.
#
# HISTORY — these were withheld on 2026-08-05 because the price path was unverified. A dry-run had
# produced three unexplained moves (6668912 24,000->2,000, 6609974 30,000->2,500, 6663318 550->16,000)
# and overwriting a correct price with a prose number is as much a fidelity breach as guessing one.
#
# RESOLVED 2026-08-09 by verifying the path against live aqar pages from a runner aqar serves. All
# three moves are now explained, and two of them were aqar being right:
#   • 6668912 and 6609974 — aqar publishes exactly 2,000 and 2,500 (`price_text` "2,000"/"2,500",
#     rendered «سنوي»). The ÷12 shape was a coincidence, not a monthly figure in an annual column.
#   • 6663318 — aqar publishes 16,000 and our stored 550 was a prose number. The move was a REPAIR.
# enrich_residential now reads aqar's structured `price`/`rent_period` instead of scanning prose,
# and refuses to import a `published: false` figure, so a recovery can no longer invent or inflate.
#
# They stay OFF BY DEFAULT anyway: turning them on rewrites money on every touched row, so it should
# be a deliberate `--include-price` run whose dry-run diff a human has read — not a side effect of
# recovering a bathroom count. `area_m2` rides with them because price_per_meter derives from it.
_PRICE_AND_PERIOD = {"price_annual", "price_total", "price_per_meter", "rent_period", "area_m2"}

# canonical property_type -> the aqar URL slug enrich_residential expects
TYPE_TO_SLUG = {v: k for k, v in N.SLUG_TO_TYPE.items()}


def explicit_cohort(ads: list[str]) -> list[dict[str, Any]]:
    """The named rows, whatever their capture looks like.

    The stub cohort is one population that needs re-enriching; it is not the only one. Rows whose
    stored price disagrees with the figure their OWN capture rendered are another, and they are not
    stubs. Rather than grow a second detector in here, the caller identifies its cohort however it
    likes and passes the ad numbers in — the re-enrich path is identical either way.
    """
    c = db.sb()
    cols = ("id, ad_number, listing_url, property_type, transaction_type, " + ", ".join(REPORT_FIELDS))
    out: list[dict[str, Any]] = []
    for i in range(0, len(ads), 200):                       # PostgREST caps the URL length
        out += (c.table(TABLE).select(cols).in_("ad_number", ads[i:i + 200])
                .not_.is_("listing_url", "null").execute().data or [])
    return out


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
    # Page through the WHOLE matching population, testing each page for stubs as we go, until we have
    # `limit` STUBS. The earlier version capped the CANDIDATE pool at `limit` and only then filtered,
    # so a run with limit=1500 examined the first 2,000 rows and found 486 stubs — it could never
    # reach the rest of the cohort no matter how high the limit was set. (Found live 2026-08-05 when
    # a limit=1500 run reported a 486-row cohort against a known ~5k population.)
    out: list[dict[str, Any]] = []
    page = 0
    while len(out) < limit:
        batch = q.range(page * 1000, page * 1000 + 999).execute().data or []
        if not batch:
            break
        page += 1
        # The stub test needs source_text, which is large — fetch it only for this page's ids.
        for i in range(0, len(batch), 200):
            chunk = batch[i:i + 200]
            caps = (c.table(TABLE).select("id, source_capture")
                    .in_("id", [r["id"] for r in chunk]).execute().data or [])
            by_id = {x["id"]: (x.get("source_capture") or {}) for x in caps}
            for r in chunk:
                txt = (by_id.get(r["id"]) or {}).get("source_text") or ""
                if "تفاصيل الإعلان" not in txt:
                    r["_stub_len"] = len(txt)
                    out.append(r)
                    if len(out) >= limit:
                        return out
        if page > 200:      # runaway guard: 200k rows scanned
            break
    return out
    return out


def recover(rows: list[dict[str, Any]], dry_run: bool, workers: int,
            structured_only: bool = True) -> dict[str, int]:
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
        if fresh and structured_only:
            # Carry the EXISTING price/period/area through untouched, so the upsert cannot move them.
            for f in _PRICE_AND_PERIOD:
                if f in r:
                    fresh[f] = r.get(f)
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
        reportable = [f for f in REPORT_FIELDS
                      if not (structured_only and f in _PRICE_AND_PERIOD)]
        gained = {f: fresh.get(f) for f in reportable
                  if r.get(f) is None and fresh.get(f) is not None}
        changed = {f: (r.get(f), fresh.get(f)) for f in reportable
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
    ap.add_argument("--include-price", action="store_true",
                    help="ALSO recover price/period/area. OFF by default so rewriting money is "
                         "always a deliberate run whose dry-run diff someone has read.")
    ap.add_argument("--ads", default="",
                    help="comma-separated ad numbers to re-enrich instead of selecting the stub "
                         "cohort. Lets a caller target a cohort identified elsewhere (e.g. rows "
                         "whose stored price disagrees with the figure their own capture rendered) "
                         "without teaching this script a second detection heuristic.")
    args = ap.parse_args()

    ads = [s.strip() for s in args.ads.split(",") if s.strip()]
    rows = explicit_cohort(ads) if ads else stub_cohort(args.limit, args.deal, args.ptype)
    print(f"mode: {'ALL FIELDS (price included)' if args.include_price else 'STRUCTURED-ONLY (price/period/area preserved)'}")
    print(f"{'explicit' if ads else 'stub'} cohort: {len(rows)} rows "
          + (f"(of {len(ads)} ad numbers given)" if ads else
             f"(deal={args.deal or 'any'} type={args.ptype or 'any'} limit={args.limit})"))
    if not rows:
        print("nothing to recover")
        return 0

    run_id = None if args.dry_run else db.begin_run("aqar_stub_recovery")
    c = recover(rows, args.dry_run, args.workers, structured_only=not args.include_price)
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
