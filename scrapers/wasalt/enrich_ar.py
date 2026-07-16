"""Wasalt ADDITIVE Arabic enricher — captures the COMPLETE Arabic source from /ar into the additive
`ar_data` column WITHOUT touching the live English path.

For each active row with ar_fetched=false, fetch /ar/property/{slug}, parse propertyDetailsV3, and
store the FULL payload MINUS broker PII into `ar_data`, plus the Arabic city/district and the
catalog-derived region_id. The live `city` (English, run.py's CITY_MAP), the `additional_info` panel,
and `photo_urls` are LEFT UNTOUCHED — flipping the /ar page to the PRIMARY source is part of the
engine cutover, not this enricher. (capture-complete + Arabic-native, shadow/additive only.)

This is the STANDING ongoing counterpart to the one-time local backfill: once the backfill clears the
existing ~58k rows (ar_fetched=true), this only processes the daily TRICKLE of brand-new listings, so
it stays cheap on the cloud Saudi proxy (bounded by --limit, sharded by ad_number last digit).

Run (local — user's own Saudi IP, free bandwidth):
  python -m scrapers.wasalt.enrich_ar --table wasalt_residential_listings --limit 800 --workers 6
Cloud picks up WASALT_PROXY_URL from the env automatically (Saudi residential proxy); --limit bounds
the metered bandwidth. --shards 10 --shard N runs the GitHub matrix (disjoint slice per job).
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from curl_cffi import requests as cc

from scrapers.common import db

BASE = "https://wasalt.sa"
NEXT_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# PDPL: never store these containers — they hold broker/agent identity, phone, lead + reservation PII.
PII_KEYS = {"propertyOwner", "leadContactInfo", "reservation"}

_BIDI = "‎‏‌‍"


def _norm_ar(s: Optional[str]) -> str:
    """Mirror the SQL normalize_ar(): lowercase, fold أإآٱ→ا / ة→ه / ى→ي, strip tatweel + bidi marks,
    collapse whitespace. MUST match the normalization that built loc_catalog_city.city_norm, or the
    region lookup silently misses."""
    s = (s or "").strip().lower()
    for a in "أإآٱ":
        s = s.replace(a, "ا")
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    for z in _BIDI:
        s = s.replace(z, "")
    return re.sub(r"\s+", " ", s)


# Catalog city_norm → (city_id, region_id), loaded once. Resolves the Arabic city to its stable
# catalog region without going through the English pivot.
_CATALOG: dict[str, tuple[int, Optional[int]]] = {}


def _load_catalog() -> None:
    if _CATALOG:
        return
    c = db.sb()
    cat = c.table("loc_catalog_city").select("city_norm,city_id,region_id").execute().data or []
    cid2reg = {r["city_id"]: r["region_id"] for r in cat}
    for r in cat:
        _CATALOG.setdefault(r["city_norm"], (r["city_id"], r["region_id"]))
    aliases = c.table("loc_catalog_city_alias").select("alias_norm,city_id").execute().data or []
    for a in aliases:
        _CATALOG.setdefault(a["alias_norm"], (a["city_id"], cid2reg.get(a["city_id"])))


def _region_for(city_ar: Optional[str]) -> Optional[int]:
    hit = _CATALOG.get(_norm_ar(city_ar))
    return hit[1] if hit else None


def _extract(pdv: dict) -> tuple[dict, Optional[str], Optional[str]]:
    """Full propertyDetailsV3 minus the PII containers + the Arabic city/district. Storing the whole
    payload (boundaries, dimensions, description, facade, all photos, REGA, …) means no field is ever
    lost — we never re-scrape to use a new field later. Advanced fields stay PARKED in ar_data."""
    d = {k: v for k, v in pdv.items() if k not in PII_KEYS}
    pi = pdv.get("propertyInfo") or {}
    return d, pi.get("city"), pi.get("district")


_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({"Accept-Language": "ar,en;q=0.8"})  # /ar → Arabic propertyInfo
        proxy = os.environ.get("WASALT_PROXY_URL", "").strip()
        if proxy:  # cloud → Saudi residential proxy; local → unset → user's own IP
            s.proxies = {"http": proxy, "https": proxy}
        _local.s = s
    return s


def _throttle() -> None:
    # PER-THREAD throttle (a global lock would serialize all workers to one stream).
    last = getattr(_local, "last", 0.0)
    wait = last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _local.last = time.monotonic()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(url: Optional[str]) -> Optional[str]:
    return url.rsplit("/property/", 1)[-1] if url and "/property/" in url else None


def fetch_ar(slug: str) -> tuple[bool, Optional[dict], Optional[str], Optional[str]]:
    """Return (ok, ar_data, city_ar, district_ar).
    ok=False  → transient (network / 429 / 403 block / retries exhausted): leave ar_fetched=false so a
                later run retries. ok=True with ar_data={'_err':…} → page loaded but no usable payload
                (404/410/no __NEXT_DATA__): mark done so we don't retry forever."""
    s = _session()
    for attempt in range(3):
        _throttle()
        try:
            r = s.get(f"{BASE}/ar/property/{slug}", timeout=30)
        except Exception:
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code in (429, 502, 503, 504):
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code in (401, 403):
            return False, None, None, None  # WAF/geo block → transient, retry later
        if r.status_code != 200:
            return True, {"_err": r.status_code}, None, None  # 404/410 → loaded, nothing to get
        m = NEXT_RE.search(r.text)
        if not m:
            return True, {"_err": "noNEXT"}, None, None
        pdv = (json.loads(m.group(1)).get("props", {}).get("pageProps", {})
               .get("propertyDetailsV3") or {})
        d, city_ar, dist_ar = _extract(pdv)
        return True, d, city_ar, dist_ar
    return False, None, None, None  # retries exhausted → transient


def enrich_table(table: str, limit: int, workers: int, shard: int = 0, shards: int = 1,
                 max_pending: int = 5000, allow_backfill: bool = False) -> dict[str, int]:
    _load_catalog()
    c = db.sb()
    # Circuit breaker (owner 2026-07-07): steady state is a few brand-new rows/day. A sudden large
    # un-fetched backlog means ar_fetched was reset or a bulk backfill is in play — auto-crawling all of
    # it through the metered Saudi proxy is exactly what exhausted the free tier (25-26 Jun). Refuse
    # unless explicitly authorised, so a stray flag reset can never silently re-crawl ~57k rows.
    pending = ((c.table(table).select("id", count="exact", head=True)
                .eq("active", True).eq("ar_fetched", False).execute().count) or 0)
    if pending > max_pending and not allow_backfill:
        print(f"⚠ CIRCUIT BREAKER: {pending} un-fetched rows in {table} (> {max_pending}). Steady state "
              f"is a few/day — this looks like a flag reset or a backfill. Refusing to crawl the backlog "
              f"through the metered proxy. Re-run with --allow-backfill to override.", flush=True)
        return {"ok": 0, "empty": 0, "fail": 0, "aborted": pending, "pending_before": pending}
    q = (c.table(table).select("id,ad_number,listing_url")
         .eq("active", True).eq("ar_fetched", False))
    # Cloud matrix sharding: 10 parallel jobs, each claims a disjoint slice by the last digit of
    # ad_number (WST…N). Server-side, ~even, zero overlap → no duplicate proxy fetches.
    if shards == 10:
        q = q.like("ad_number", f"%{shard}")
    rows = q.order("id").limit(limit).execute().data or []
    print(f"── {table} shard {shard}/{shards}: {len(rows)} un-fetched rows (cap {limit})", flush=True)
    stats = {"ok": 0, "empty": 0, "fail": 0}
    lock = threading.Lock()

    def work(row: dict) -> None:
        sl = _slug(row.get("listing_url"))
        if not sl:
            # No slug → can't fetch; mark done with an error marker so it doesn't churn forever.
            try:
                c.table(table).update({"ar_fetched": True, "ar_fetched_at": _now_iso(),
                                       "ar_data": {"_err": "noslug"}}).eq("id", row["id"]).execute()
            except Exception:
                pass
            with lock:
                stats["empty"] += 1
            return
        ok, d, city_ar, dist_ar = fetch_ar(sl)
        if not ok:
            # Transient — leave ar_fetched=false so a later run retries this row.
            with lock:
                stats["fail"] += 1
            return
        upd: dict[str, Any] = {"ar_fetched": True, "ar_fetched_at": _now_iso(), "ar_data": d}
        if city_ar:
            upd["city_ar"] = city_ar
        if dist_ar:
            upd["district_ar"] = dist_ar
        reg = _region_for(city_ar)
        if reg:
            upd["region_id"] = reg
        # Placeholder guard (2026-07-10 architecture redesign — see docs/LOCATION_RESOLUTION.md):
        # this write goes straight through .table().update(), bypassing the upsert helpers in
        # scrapers/common/db.py entirely (confirmed gap, adversarial review 2026-07-10) — so it
        # must call the guard explicitly rather than relying on the upsert-path backstop.
        db.guard_location_update(upd, table=table, ref=f"id={row['id']}")
        try:
            c.table(table).update(upd).eq("id", row["id"]).execute()
            with lock:
                stats["ok" if "_err" not in d else "empty"] += 1
        except Exception as e:
            print(f"   ✗ update id={row['id']}: {str(e)[:80]}", flush=True)
            with lock:
                stats["fail"] += 1

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, rows))
    print(f"   ✓ {table}: ok={stats['ok']} empty={stats['empty']} fail={stats['fail']}", flush=True)
    stats["pending_before"] = pending
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", default="wasalt_residential_listings",
                    choices=["wasalt_residential_listings", "wasalt_commercial_listings"])
    ap.add_argument("--limit", type=int, default=800, help="Max rows this run (bounds proxy bandwidth).")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--shard", type=int, default=0, help="This job's shard index (0..shards-1).")
    ap.add_argument("--shards", type=int, default=1, help="Total shards (10 = cloud matrix by ad_number last digit).")
    ap.add_argument("--max-pending", type=int, default=5000,
                    help="Circuit breaker: abort (no proxy fetches) if more than this many un-fetched rows "
                         "exist — a mass backlog means a flag reset, not the normal daily trickle.")
    ap.add_argument("--allow-backfill", action="store_true",
                    help="Override the circuit breaker to deliberately crawl a large backlog through the proxy.")
    args = ap.parse_args()
    # Own platform name per table, DISTINCT from the real scraper's own 'wasalt' scrape_runs rows —
    # this is backlog-processing throughput (rows_seen = pending backlog at start), not "listings
    # scraped this run", so mixing the two into one platform stream would corrupt the existing
    # silent-scraper-death detector's rows_seen>0 health signal for the real scraper.
    suffix = "commercial" if "commercial" in args.table else "residential"
    platform = f"wasalt_enrich_ar_{suffix}"
    run_id = db.begin_run(platform)
    stats = enrich_table(args.table, args.limit, args.workers, args.shard, args.shards,
                          args.max_pending, args.allow_backfill)
    aborted = stats.get("aborted", 0)
    ok_count, empty_count, fail_count = stats.get("ok", 0), stats.get("empty", 0), stats.get("fail", 0)
    attempted = ok_count + empty_count + fail_count
    # ok=False when the circuit breaker fired (0 rows processed despite a real backlog) or when more
    # than half of attempted rows failed — both are the "reports success but does nothing useful"
    # shape this monitoring exists to catch, not a healthy empty-queue run (attempted==0, no pending).
    run_ok = aborted == 0 and (attempted == 0 or fail_count <= attempted / 2)
    db.end_run(
        run_id, ok=run_ok, rows_seen=stats.get("pending_before", 0), rows_upserted=ok_count + empty_count,
        notes=(f"ok={ok_count} empty={empty_count} fail={fail_count} aborted={aborted} "
               f"limit={args.limit} allow_backfill={args.allow_backfill}"),
        # allow_empty: unlike a scraper (rows_seen==0 → dead/blocked source, a real problem), this job's
        # rows_seen is the PENDING BACKLOG at start — 0 pending is the ideal steady-state once this fix
        # has been running a while, not a failure. Without this, end_run's RC-B honesty demotion would
        # wrongly flip every healthy "fully caught up" run to ok=False.
        allow_empty=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
