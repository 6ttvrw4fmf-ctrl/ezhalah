"""Wasalt liveness — LIGHTWEIGHT existence/status check (HEAD-first), pilot-safe.

Why this exists separately from `scrapers.aqar.liveness`: that module GETs each listing's full
~400 KB detail page and kills after 3 strikes. For Wasalt that runs through the METERED Saudi
residential proxy — ~58k rows/day ≈ ~700 GB/month — which is exactly why the cloud Wasalt liveness
was disabled. This module instead checks existence CHEAPLY: a HEAD request first, and a GET only to
CONFIRM validity (propertyDetailsV3 present). The pilot records whether HEAD alone agrees with the
GET verdict, so at scale we can drop the GET and run HEAD-only (tiny bandwidth).

PILOT MODE (default):
  * NEVER marks anything inactive, NEVER deletes — classify only.
  * Updates last_seen_at (+ resets missing_count) ONLY for confirmed-live listings.
  * Writes a heartbeat row to public.wasalt_liveness_runs (checked/live/dead/failed/skipped/bytes/runtime).

Verdict per listing:
  * live   — final GET 200 AND __NEXT_DATA__.propertyDetailsV3 is present.
  * dead   — 404/410, or 200 with no propertyDetailsV3 (removed / placeholder page).
  * failed — timeout / proxy 5xx / network error → NEVER counted as dead (transient).

Low concurrency (default 4 workers, each its own session + politeness throttle). Bounded by --limit.

Usage:
  python -m scrapers.wasalt.liveness --limit 800 --workers 4 --mode pilot
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import random
import re
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db  # noqa: E402

BASE = "https://wasalt.sa"
NEXT_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
TABLES = ("wasalt_residential_listings", "wasalt_commercial_listings")
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.4"))

# Per-thread session + politeness throttle (curl_cffi Session is not thread-safe; one per worker).
_tls = threading.local()


def _session() -> cc.Session:
    s = getattr(_tls, "sess", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({"Accept-Language": "en,ar;q=0.8"})
        proxy = os.environ.get("WASALT_PROXY_URL", "").strip()
        if proxy:  # Saudi residential proxy on cloud (wasalt.sa geo-blocks datacenter IPs)
            s.proxies = {"http": proxy, "https": proxy}
        _tls.sess = s
    return s


def _throttle() -> None:
    last = getattr(_tls, "last", 0.0)
    wait = last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _tls.last = time.monotonic()


def _backoff(attempt: int) -> None:
    time.sleep(min(8.0, 2.0 ** attempt) + random.uniform(0.0, 0.5))


def head_status(url: str, tries: int = 3):
    """HEAD status code (cheap), or None after transient failures."""
    s = _session()
    for attempt in range(tries):
        try:
            _throttle()
            return s.head(url, timeout=20, allow_redirects=True).status_code
        except Exception:
            if attempt == tries - 1:
                return None
            _backoff(attempt)
    return None


def get_verdict(url: str, tries: int = 3):
    """Return (verdict, status, nbytes). verdict ∈ {'live','dead','failed'} — GET is the ground truth."""
    s = _session()
    for attempt in range(tries):
        try:
            _throttle()
            r = s.get(url, timeout=30)
            nbytes = len(r.content or b"")
            if r.status_code in (404, 410):
                return ("dead", r.status_code, nbytes)
            if r.status_code != 200:
                if attempt == tries - 1:
                    return ("failed", r.status_code, nbytes)  # 5xx etc. → transient, never 'dead'
                _backoff(attempt)
                continue
            m = NEXT_RE.search(r.text)
            pdv = None
            if m:
                try:
                    pdv = (json.loads(m.group(1)).get("props", {})
                           .get("pageProps", {}).get("propertyDetailsV3"))
                except Exception:
                    pdv = None
            return ("live" if pdv else "dead", r.status_code, nbytes)
        except Exception:
            if attempt == tries - 1:
                return ("failed", 0, 0)
            _backoff(attempt)
    return ("failed", 0, 0)


def check_one(row):
    """Worker: (tbl, id, url) -> (tbl, id, verdict, head_code, nbytes)."""
    tbl, lid, url = row
    hc = head_status(url)
    verdict, _status, nbytes = get_verdict(url)
    return (tbl, lid, verdict, hc, nbytes)


def sample(limit: int):
    """Oldest-last_seen ACTIVE Wasalt rows (residential first, then commercial), up to `limit`.
    Oldest-first deliberately surfaces the most-likely-stale rows so the pilot truly tests dead detection."""
    out: list[tuple[str, int, str]] = []
    for tbl in TABLES:
        need = limit - len(out)
        if need <= 0:
            break
        res = db._execute(
            db.sb().table(tbl).select("id, listing_url")
            .eq("active", True).order("last_seen_at", desc=False).limit(need),
            what=f"{tbl}.sample",
        )
        for x in (res.data or []):
            if (x.get("listing_url") or "").strip():
                out.append((tbl, x["id"], x["listing_url"].strip()))
    return out[:limit]


def main() -> int:
    ap = argparse.ArgumentParser(description="Wasalt lightweight liveness (pilot-safe)")
    ap.add_argument("--limit", type=int, default=800)
    ap.add_argument("--workers", type=int, default=4, help="Low concurrency; each worker gets its own session.")
    ap.add_argument("--mode", default="pilot", choices=["pilot", "full"])
    args = ap.parse_args()

    started = time.time()
    rows = sample(args.limit)
    print(f"sampled {len(rows)} active Wasalt rows (oldest last_seen first); workers={args.workers}", flush=True)

    checked = live = dead = failed = skipped = 0
    total_bytes = 0
    head_agree = 0  # HEAD-only verdict matched the GET ground truth
    alive_ids: dict[str, list[int]] = {t: [] for t in TABLES}
    now_iso = datetime.now(timezone.utc).isoformat()

    with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        for tbl, lid, verdict, hc, nbytes in ex.map(check_one, rows):
            checked += 1
            total_bytes += nbytes
            if hc is not None:
                head_says = "live" if hc == 200 else ("dead" if hc in (404, 410) else None)
                if head_says is not None and head_says == verdict:
                    head_agree += 1
            if verdict == "live":
                live += 1
                alive_ids[tbl].append(lid)
            elif verdict == "dead":
                dead += 1  # PILOT: classify only — never inactivate, never touch the row. (rule 6)
            else:
                failed += 1
            if checked % 50 == 0:
                el = max(1e-6, time.time() - started)
                print(f"  [{checked}] live={live} dead={dead} failed={failed} "
                      f"({checked / el:.1f}/s, {total_bytes / 1e6:.1f}MB)", flush=True)

    # Confirmed-live ONLY → batch-refresh last_seen_at (+ reset missing_count). (rule 5)
    for tbl, ids in alive_ids.items():
        for i in range(0, len(ids), 200):
            chunk = ids[i:i + 200]
            if chunk:
                db._execute(
                    db.sb().table(tbl).update({"last_seen_at": now_iso, "missing_count": 0}).in_("id", chunk),
                    what=f"{tbl}.touch_alive",
                )

    runtime = round(time.time() - started, 1)
    avg_kb = (total_bytes / checked / 1024) if checked else 0.0
    notes = (f"mode={args.mode} workers={args.workers} head_agree={head_agree}/{checked} "
             f"runtime_s={runtime} avg_kb_per_check={avg_kb:.1f}")
    db._execute(
        db.sb().table("wasalt_liveness_runs").insert({
            "finished_at": now_iso, "shard": "oldest-last_seen", "mode": args.mode,
            "checked": checked, "live": live, "dead": dead, "failed": failed, "skipped": skipped,
            "bytes_downloaded": total_bytes, "notes": notes,
        }),
        what="wasalt_liveness_runs.insert",
    )
    print(f"\n✓ Wasalt liveness {args.mode}: checked={checked} live={live} dead={dead} "
          f"failed={failed} bytes={total_bytes} runtime_s={runtime} "
          f"head_agree={head_agree}/{checked}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
