"""Wasalt "new-only" deep enricher — fills the detail-page fields (Plan/Land number, Street, Ad
source, Facade, Building No., utilities…) for rows that don't have them yet (detail_enriched=false).

Capped per run, so cloud proxy bandwidth stays small. After the one-time local Mac backfill marks
all current rows enriched, this only ever processes the daily TRICKLE of brand-new listings — a few
hundred a day, not 57k. That makes deep-enrichment viable on the cloud (through the Saudi proxy)
without blowing the metered DataImpulse plan.

Run:
  python -m scrapers.wasalt.enrich --table wasalt_residential_listings --limit 800 --workers 6
On cloud it picks up WASALT_PROXY_URL from the env automatically (Saudi residential proxy).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from curl_cffi import requests as cc

from scrapers.common import db
from scrapers.common import normalize as N
from scrapers.wasalt.run import _yes_no, land_service_fields

BASE = "https://wasalt.sa"
NEXT_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# The detail-page rows worth keeping for the "Additional Information" panel (mirrors run.py).
KEEP_KEYS = {
    "propertyMainType", "completionYear", "propertyFacade", "street", "adSource", "planNumber",
    "landNumber", "obligations", "zipCode", "regaAdvLicDate", "additionalNumber", "buildingNumber",
    "electricityMeter", "waterMeter", "noOfFloors", "floorNumber", "furnishingType", "noOfParkings",
}

_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({"Accept-Language": "en,ar;q=0.8"})
        proxy = os.environ.get("WASALT_PROXY_URL", "").strip()
        if proxy:  # cloud → Saudi residential proxy; local → unset → user's own IP
            s.proxies = {"http": proxy, "https": proxy}
        _local.s = s
    return s


def _throttle() -> None:
    # PER-THREAD throttle: each worker paces itself, so N workers give ~N×(1/MIN_INTERVAL) req/s.
    # (A global lock here would serialize all workers down to a single 1/MIN_INTERVAL stream — the
    # bug that made the first backfill crawl.)
    last = getattr(_local, "last", 0.0)
    wait = last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _local.last = time.monotonic()


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _slug(url: str | None) -> str | None:
    return url.rsplit("/property/", 1)[-1] if url and "/property/" in url else None


def fetch_detail(slug: str) -> tuple[bool, list[dict[str, Any]]]:
    """Return (ok, rows). ok=False ONLY on network/transient failure → caller leaves the row for a
    later retry. ok=True with rows=[] means the page loaded but has no deep fields (don't retry)."""
    s = _session()
    for attempt in range(3):
        _throttle()
        try:
            r = s.get(f"{BASE}/en/property/{slug}", timeout=30)
        except Exception:
            time.sleep(1.5 * (attempt + 1)); continue
        if r.status_code in (429, 502, 503, 504):
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code in (401, 403):
            return False, []  # WAF/block → transient, retry on a later run (NOT a permanent "done")
        if r.status_code != 200:
            return True, []  # 404/410/permanent → loaded, nothing to get; don't retry forever
        m = NEXT_RE.search(r.text)
        if not m:
            return True, []
        pdv = (json.loads(m.group(1)).get("props", {}).get("pageProps", {})
               .get("propertyDetailsV3") or {})
        rows = []
        for a in pdv.get("additionalAttributes") or []:
            if isinstance(a, dict) and a.get("key") in KEEP_KEYS and a.get("value") not in (None, "", "None"):
                rows.append({"key": a["key"], "label": a.get("label"), "value": a["value"]})
        return True, rows
    return False, []  # retries exhausted → transient; retry on a later run


def meter_fields_from_deep(deep: list[dict[str, Any]]) -> dict[str, bool]:
    """separate_water_meter / separate_electricity_meter from a detail-page `deep` payload.

    SOURCE IS TRUTH (ops alert kind=wasalt_meter_parse_gap, raised 2026-09-04). This is the ONLY
    place production actually learns waterMeter/electricityMeter: run.py's cloud sweeps run with
    WASALT_FETCH_DETAIL unset (no workflow ever sets it), so the `deep` rows this daily new-only
    detail fetch reads are the SOLE producing path for these two keys. Migration 20260809151000
    parsed them from additional_info into separate_water_meter / separate_electricity_meter for the
    rows that existed on 2026-08-09, but this module's update() call used to write fresh
    additional_info without ever recomputing the two boolean columns from it — so every row
    detail-enriched since (8,284 measured 2026-09-04, all of them scraped after the repair, none
    before it) re-created the exact gap the migration had just repaired. This reuses the same
    tri-state `_yes_no()` run.py's own base row builder uses, so both producing paths agree.

    Returns only the keys that are DETERMINED (Yes -> True, No -> False). A key absent from `deep`
    or carrying any other value is OMITTED from the result entirely — never written as None —
    mirroring `db._unknown_must_not_overwrite_known()`: the caller here is a plain
    `.table().update()` that does not go through that guard, so a key present with value None would
    write SQL NULL and could erase a value a previous enrichment already read. Only a determined
    Yes/No is ever returned.
    """
    out: dict[str, bool] = {}
    wm = _yes_no(deep, "waterMeter")
    if wm is not None:
        out["separate_water_meter"] = wm
    em = _yes_no(deep, "electricityMeter")
    if em is not None:
        out["separate_electricity_meter"] = em
    return out


# Proxy-spend SAFETY cap (owner decision 2026-10-05): 15,000 pending rows. It exists only to stop a
# runaway re-crawl (a flag reset re-queuing ~57k rows), not to throttle ordinary new listings: on
# 2026-10-05 ~13k genuinely new rows were pending, which the old 5,000 would have refused.
MAX_PENDING_DEFAULT = 15000


def pending_count(c, table: str, flag: str, sel: str) -> int:
    """Active rows still waiting on `flag`. Counted as a GET with .limit(1), never a HEAD: on the pinned client
    (supabase 2.10 / postgrest 0.18) a HEAD count reads 0, which left this breaker blind from the
    day it was written (scrapers/common/tests/test_head_count_reads_zero.py). A count that cannot be
    read is not zero: it raises, so the run stops before spending proxy bandwidth."""
    res = (c.table(table).select(sel, count="exact")
           .eq("active", True).eq(flag, False).limit(1).execute())
    if res.count is None:
        raise RuntimeError(f"circuit breaker: pending count for {table} unreadable — refusing to spend proxy")
    return int(res.count)


# Over the cap, only rows scraped this recently are fetched: see enrich_table.
ARRIVALS_WINDOW_H = 48


def enrich_table(table: str, limit: int, workers: int, shard: int = 0, shards: int = 1,
                 max_pending: int = MAX_PENDING_DEFAULT, allow_backfill: bool = False) -> dict[str, int]:
    c = db.sb()
    # Circuit breaker (owner 2026-07-07): steady state is a few brand-new rows/day. A sudden large
    # un-enriched backlog means detail_enriched was reset or a bulk backfill is in play — auto-crawling
    # all of it through the metered Saudi proxy is exactly what exhausted the free tier (25-26 Jun). Refuse
    # unless explicitly authorised, so a stray flag reset can never silently re-crawl ~57k rows.
    pending = pending_count(c, table, "detail_enriched", "ad_number")
    # ARRIVALS MODE (New Listings Engineer, 2026-10-10 — the same fix as enrich_ar.py, PR #6650). Over
    # the cap this refused the WHOLE run, so from 10-08 no new wasalt ad got facade / meters / street
    # width (Advanced Filter fields per arrival 0.6 vs 1.1 over 7 days). Over the cap we now take only
    # rows scraped in the last ARRIVALS_WINDOW_H hours; a flag reset re-queues OLD rows, which the
    # window excludes, and if even the window exceeds the cap the run still refuses.
    arrivals_since = None
    if pending > max_pending and not allow_backfill:
        arrivals_since = (datetime.now(timezone.utc) - timedelta(hours=ARRIVALS_WINDOW_H)).isoformat()
        fresh = (c.table(table).select("ad_number", count="exact").eq("active", True)
                 .eq("detail_enriched", False).gte("scraped_at", arrivals_since).limit(1).execute())
        if fresh.count is None or int(fresh.count) > max_pending:
            print(f"⚠ CIRCUIT BREAKER: {pending} un-enriched rows in {table} (> {max_pending}), and the "
                  f"last {ARRIVALS_WINDOW_H}h alone holds {fresh.count}. This looks like a flag reset or a "
                  f"backfill. Refusing to crawl through the metered proxy. Re-run with --allow-backfill "
                  f"to override.", flush=True)
            return {"deep": 0, "empty": 0, "fail": 0, "aborted": pending}
        print(f"⚠ {pending} un-enriched rows (> {max_pending}): arrivals mode — only the {fresh.count} "
              f"scraped in the last {ARRIVALS_WINDOW_H}h; the old backlog waits.", flush=True)
    q = (c.table(table).select("ad_number,listing_url,property_type")
         .eq("active", True).eq("detail_enriched", False))
    if arrivals_since is not None:
        q = q.gte("scraped_at", arrivals_since)
    # Cloud matrix sharding: 10 parallel jobs, each claims a DISJOINT slice by the last digit of
    # ad_number (WST…N). Server-side, ~even, zero overlap → no duplicate proxy fetches. Only valid
    # for shards==10 (single trailing digit). shards==1 (local) skips sharding entirely.
    if shards == 10:
        q = q.like("ad_number", f"%{shard}")
    # Fair drain: least-recently-attempted first (NULLs = never tried). Prevents new high-id rows
    # from permanently starving older un-enriched rows when daily inflow exceeds the cap.
    rows = (q.order("enrich_attempted_at", desc=False, nullsfirst=True)
            .limit(limit).execute().data) or []
    print(f"── {table} shard {shard}/{shards}: {len(rows)} un-enriched rows to process (cap {limit})")
    stats = {"deep": 0, "empty": 0, "fail": 0}
    lock = threading.Lock()

    stamp = _now_iso()

    def work(row: dict) -> None:
        slug = _slug(row.get("listing_url"))
        if not slug:
            with lock: stats["fail"] += 1
            return
        ok, deep = fetch_detail(slug)
        if not ok:
            # Transient (network/403/block). Stamp the attempt so this row rotates to the BACK of the
            # fair queue instead of being re-grabbed first every run — but leave detail_enriched=false
            # so it IS retried later. (starvation guard.)
            try:
                db.sb().table(table).update({"enrich_attempted_at": stamp}).eq("ad_number", row["ad_number"]).execute()
            except Exception:
                pass
            with lock: stats["fail"] += 1
            return
        # Page loaded → mark enriched (page-loaded ⇒ no more to get). Write deep rows if any; if empty,
        # only flip the flag + stamp (the trigger leaves the existing base additional_info untouched).
        upd: dict[str, Any] = {"detail_enriched": True, "enrich_attempted_at": stamp}
        if deep:
            upd["additional_info"] = deep
            # Canonical property_age from the AUTHORITATIVE detail-page string (the search-list enum is
            # corrupt — see run.py). Same shared parser every platform uses; unknown/unmapped -> NULL,
            # never a guess. This is the only place the trustworthy string is available.
            cy = next((r.get("value") for r in deep if r.get("key") == "completionYear"), None)
            upd["property_age"] = N.parse_property_age(cy)
            upd.update(meter_fields_from_deep(deep))
            # Backlog 326: a LAND's meters are its electricity / water service (run.land_service_fields).
            upd.update(land_service_fields(row.get("property_type"), deep))
        try:
            db.sb().table(table).update(upd).eq("ad_number", row["ad_number"]).execute()
            with lock: stats["deep" if deep else "empty"] += 1
        except Exception as e:
            print(f"   ✗ update {row['ad_number']}: {str(e)[:80]}")
            with lock: stats["fail"] += 1

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, rows))
    print(f"   ✓ {table}: deep={stats['deep']} empty={stats['empty']} fail={stats['fail']}")
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", default="wasalt_residential_listings",
                    choices=["wasalt_residential_listings", "wasalt_commercial_listings"])
    ap.add_argument("--limit", type=int, default=800, help="Max rows to enrich this run (bounds proxy bandwidth).")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--shard", type=int, default=0, help="This job's shard index (0..shards-1).")
    ap.add_argument("--shards", type=int, default=1, help="Total shards (10 = cloud matrix by ad_number last digit).")
    ap.add_argument("--max-pending", type=int, default=MAX_PENDING_DEFAULT,
                    help="Circuit breaker: abort (no proxy fetches) if more than this many un-enriched rows "
                         "exist — a mass backlog means a flag reset, not the normal daily trickle.")
    ap.add_argument("--allow-backfill", action="store_true",
                    help="Override the circuit breaker to deliberately crawl a large backlog through the proxy.")
    args = ap.parse_args()
    stats = enrich_table(args.table, args.limit, args.workers, args.shard, args.shards,
                         args.max_pending, args.allow_backfill)
    return exit_code(stats)


def exit_code(stats: dict) -> int:
    """Non-zero when the circuit breaker refused the run (2026-10-10). From 10-08 the residential job
    refused every night (27,119 pending > 15,000) in 0 s and reported SUCCESS, so no new wasalt ad got
    its detail fields (facade, meters, street width) for three nights and nothing turned red. A refusal
    is a run that did not do its job: the workflow must fail where people look."""
    if stats.get("aborted"):
        print(f"✗ circuit breaker refused this run: {stats['aborted']} rows pending — nothing was enriched",
              flush=True)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
