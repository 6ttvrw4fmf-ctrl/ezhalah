"""Wasalt "new-only" deep enricher — fills the detail-page fields (Plan/Land number, Street, Ad
source, Facade, Building No., utilities…) for rows that don't have them yet (detail_enriched=false).

Capped per run, so cloud proxy bandwidth stays small. After the one-time local Mac backfill marks
all current rows enriched, this only ever processes the daily TRICKLE of brand-new listings — a few
hundred a day, not 57k. That makes deep-enrichment viable on the cloud (through the Saudi proxy)
without blowing the metered Webshare plan.

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
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from curl_cffi import requests as cc

from scrapers.common import db

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
        if r.status_code != 200:
            return True, []  # 404/permanent → loaded, nothing to get; don't retry forever
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


def enrich_table(table: str, limit: int, workers: int) -> dict[str, int]:
    c = db.sb()
    rows = (c.table(table).select("ad_number,listing_url")
            .eq("active", True).eq("detail_enriched", False)
            .order("id", desc=True).limit(limit).execute().data) or []
    print(f"── {table}: {len(rows)} un-enriched rows to process (cap {limit})")
    stats = {"deep": 0, "empty": 0, "fail": 0}
    lock = threading.Lock()

    def work(row: dict) -> None:
        slug = _slug(row.get("listing_url"))
        if not slug:
            with lock: stats["fail"] += 1
            return
        ok, deep = fetch_detail(slug)
        if not ok:
            with lock: stats["fail"] += 1
            return
        # Mark enriched either way (page loaded). If we got deep rows, write them too; if empty,
        # only flip the flag (the trigger leaves existing base additional_info untouched).
        upd: dict[str, Any] = {"detail_enriched": True}
        if deep:
            upd["additional_info"] = deep
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
    args = ap.parse_args()
    enrich_table(args.table, args.limit, args.workers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
