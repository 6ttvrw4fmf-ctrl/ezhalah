"""Wasalt liveness — bandwidth-cheap HYBRID existence check (HEAD-first, GET-confirm).

Why this exists separately from `scrapers.aqar.liveness`: that module GETs each listing's full
~400 KB detail page for EVERY row and kills after 3 strikes. For Wasalt that runs through the METERED
Saudi residential proxy — ~58k rows/day ≈ ~700 GB/month — which is exactly why the cloud Wasalt
liveness was disabled. This module checks existence CHEAPLY: a HEAD request first (~1-2 KB), and a full
GET ONLY when HEAD is not a clean 200 (to CONFIRM before ever acting).

HYBRID VERDICT (per listing):
  * HEAD 200                       → live   (no GET — the pilot proved 0 soft-404s among HEAD-200s:
                                     799/800 HEAD⇄GET agreement, every HEAD-200 had propertyDetailsV3).
  * HEAD 404/410/other/failed      → escalate to GET (the ground truth):
      - GET 200 AND __NEXT_DATA__.propertyDetailsV3 present → live (HEAD was wrong/transient).
      - GET 404/410, or GET 200 with NO propertyDetailsV3   → dead (removed / placeholder page).
      - GET timeout / 5xx / network / 403 challenge         → failed  (transient — NEVER 'dead').

MODES:
  pilot  (default) — CLASSIFY ONLY. Never marks inactive, never deletes. Refreshes last_seen_at
                     (+resets missing_count) for confirmed-live rows only. Samples the oldest-last_seen
                     N active rows and records HEAD⇄GET agreement in wasalt_liveness_runs. (safe recon.)
  enforce          — the real lifecycle. Sweeps ALL active rows in a shard (keyset by id). Confirmed
                     LIVE  → reset missing_count=0 + refresh last_seen_at (recovery + freshness).
                     Confirmed DEAD → missing_count += 1; flip active=false ONLY when it reaches the
                     grace threshold (default 3) — i.e. 3 consecutive sweeps BOTH HEAD-and-GET-dead.
                     FAILED/transient → row left completely untouched (no strike).
                     COLLAPSE GUARD: if >max_dead_frac (default 30%) of a shard's verdicts come back
                     dead, the whole shard is treated as a broken crawl — NOTHING is struck or killed
                     (proxy-wide 404 storms can't cascade). Mirrors prune_unseen()'s guard.

  A listing therefore needs THREE things before it can go inactive: a definitive GET-confirmed 404
  (not just a HEAD), three sweeps in a row, and a non-collapsed run each time. No guessing; the safe
  direction (keeping a listing) always wins on any ambiguity. Card display is never touched — this
  only flips the `active` flag the app already filters on.

Usage:
  python -m scrapers.wasalt.liveness --mode pilot   --limit 800
  python -m scrapers.wasalt.liveness --mode enforce --shards 8 --shard 0
  python -m scrapers.wasalt.liveness --mode enforce --limit 2000   # bounded proof run
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
from collections import defaultdict
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
                    return ("failed", r.status_code, nbytes)  # 5xx / 403 etc. → transient, never 'dead'
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


def check_hybrid(row):
    """ENFORCE worker: (tbl, id, url, cur_missing) -> (tbl, id, cur_missing, verdict, used_get, nbytes).
    HEAD 200 short-circuits to 'live' with NO GET; anything else escalates to a GET-confirm."""
    tbl, lid, url, cur = row
    hc = head_status(url)
    if hc == 200:
        return (tbl, lid, cur, "live", False, 0)
    verdict, _st, nbytes = get_verdict(url)
    return (tbl, lid, cur, verdict, True, nbytes)


def check_one(row):
    """PILOT worker: (tbl, id, url) -> (tbl, id, verdict, head_code, nbytes). Runs BOTH HEAD and GET on
    every row so the pilot can measure HEAD⇄GET agreement (that measurement is the pilot's whole point)."""
    tbl, lid, url = row
    hc = head_status(url)
    verdict, _status, nbytes = get_verdict(url)
    return (tbl, lid, verdict, hc, nbytes)


def sample(limit: int):
    """PILOT sampler: oldest-last_seen ACTIVE Wasalt rows (residential first, then commercial), up to
    `limit`. Oldest-first deliberately surfaces the most-likely-stale rows so the pilot tests dead
    detection hardest."""
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


def sweep_rows(shards: int, shard: int, limit: int):
    """ENFORCE row source: EVERY active Wasalt row (both tables), keyset-paginated by id within this
    shard's contiguous id-window. Keyset (not offset) so flipping rows active=false mid-sweep can't
    shift the window and skip rows, and it can't hit the deep-offset statement timeout as the table
    grows. `limit` (0 = all) bounds the total for a bounded proof run."""
    out: list[tuple[str, int, str, int]] = []
    for tbl in TABLES:
        maxid = db._execute(db.sb().table(tbl).select("id").order("id", desc=True).limit(1),
                            what=f"{tbl}.maxid").data
        max_id = (maxid[0]["id"] if maxid else 0)
        bucket = (max_id // max(1, shards)) + 1
        lo, hi = shard * bucket, shard * bucket + bucket  # [lo, hi)
        last = lo - 1
        while True:
            if limit and len(out) >= limit:
                return out[:limit]
            page = db._execute(
                db.sb().table(tbl).select("id, listing_url, missing_count")
                .eq("active", True).gt("id", last).lt("id", hi).order("id", desc=False).limit(1000),
                what=f"{tbl}.sweep",
            ).data or []
            if not page:
                break
            for x in page:
                last = x["id"]
                url = (x.get("listing_url") or "").strip()
                if url:
                    out.append((tbl, x["id"], url, int(x.get("missing_count") or 0)))
    return out[:limit] if limit else out


def _flush_alive(tbl: str, ids: list[int], now_iso: str) -> None:
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        if chunk:
            db._execute(
                db.sb().table(tbl).update({"last_seen_at": now_iso, "missing_count": 0}).in_("id", chunk),
                what=f"{tbl}.touch_alive",
            )


def run_pilot(args) -> int:
    started = time.time()
    rows = sample(args.limit)
    print(f"PILOT: sampled {len(rows)} active Wasalt rows (oldest last_seen first); workers={args.workers}",
          flush=True)
    checked = live = dead = failed = 0
    total_bytes = 0
    head_agree = 0
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
                dead += 1  # PILOT: classify only — never inactivate.
            else:
                failed += 1
    for tbl, ids in alive_ids.items():
        _flush_alive(tbl, ids, now_iso)
    runtime = round(time.time() - started, 1)
    avg_kb = (total_bytes / checked / 1024) if checked else 0.0
    notes = (f"mode=pilot workers={args.workers} head_agree={head_agree}/{checked} "
             f"runtime_s={runtime} avg_kb_per_check={avg_kb:.1f}")
    db._execute(db.sb().table("wasalt_liveness_runs").insert({
        "finished_at": now_iso, "shard": "oldest-last_seen", "mode": "pilot",
        "checked": checked, "live": live, "dead": dead, "failed": failed, "skipped": 0,
        "bytes_downloaded": total_bytes, "notes": notes}), what="wasalt_liveness_runs.insert")
    print(f"\n✓ Wasalt liveness pilot: checked={checked} live={live} dead={dead} failed={failed} "
          f"head_agree={head_agree}/{checked}", flush=True)
    return 0


def run_enforce(args) -> int:
    started = time.time()
    grace = args.grace
    rows = sweep_rows(args.shards, args.shard, args.limit)
    # Bandwidth stagger (owner 2026-07-07): instead of spending metered-proxy HEAD/GETs on ALL ~58k
    # active rows EVERY day, spread them across `stagger_mod` days by id — each row is checked once every
    # ~stagger_mod days, cutting daily proxy bandwidth ~stagger_mod×. Row SELECTION from the DB is
    # unchanged (Supabase, not proxied); only the subset we spend proxy requests on shrinks. The 3-strike
    # grace + collapse guard are untouched, so accuracy (never false-kill a live listing) is preserved —
    # only the time to confirm a genuinely-dead listing lengthens to ~grace×stagger_mod days.
    if args.stagger_mod and args.stagger_mod > 1:
        idx = (args.stagger_idx if args.stagger_idx >= 0
               else datetime.now(timezone.utc).toordinal() % args.stagger_mod)
        rows = [r for r in rows if r[1] % args.stagger_mod == idx]
        print(f"STAGGER: mod={args.stagger_mod} idx={idx} → {len(rows)} rows this shard today "
              f"(each active row checked every ~{args.stagger_mod}d)", flush=True)
    print(f"ENFORCE: {len(rows)} active Wasalt rows (shard {args.shard}/{args.shards}"
          f"{', limit ' + str(args.limit) if args.limit else ''}); grace={grace} workers={args.workers}",
          flush=True)
    now_iso = datetime.now(timezone.utc).isoformat()
    checked = live = dead = failed = 0
    total_bytes = 0
    alive_ids: dict[str, list[int]] = {t: [] for t in TABLES}
    dead_rows: list[tuple[str, int, int]] = []  # (tbl, id, cur_missing) — confirmed dead this run

    with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        for tbl, lid, cur, verdict, used_get, nbytes in ex.map(check_hybrid, rows):
            checked += 1
            total_bytes += nbytes
            if verdict == "live":
                live += 1
                alive_ids[tbl].append(lid)
            elif verdict == "dead":
                dead += 1
                dead_rows.append((tbl, lid, cur))
            else:
                failed += 1
            if checked % 100 == 0:
                el = max(1e-6, time.time() - started)
                print(f"  [{checked}] live={live} dead={dead} failed={failed} "
                      f"({checked / el:.1f}/s, {total_bytes / 1e6:.1f}MB)", flush=True)

    # Confirmed-live → reset missing_count + refresh last_seen_at (recovery + freshness). Always safe.
    for tbl, ids in alive_ids.items():
        _flush_alive(tbl, ids, now_iso)

    # COLLAPSE GUARD: an abnormally high dead fraction = broken crawl (proxy-wide block). Strike NOTHING.
    verdicts = live + dead  # exclude 'failed' (transient) from the denominator
    collapsed = verdicts >= 20 and dead > args.max_dead_frac * verdicts
    struck = killed = 0
    if collapsed:
        print(f"⚠ COLLAPSE GUARD tripped: dead={dead}/{verdicts} > {int(args.max_dead_frac*100)}% "
              f"— treating as a broken crawl, NO strikes applied this run.", flush=True)
    else:
        # Group dead rows by (table, current missing_count) so each distinct increment is one batched UPDATE.
        by_cur = defaultdict(list)
        for tbl, lid, cur in dead_rows:
            by_cur[(tbl, cur)].append(lid)
        for (tbl, cur), ids in by_cur.items():
            new_missing = cur + 1
            payload = {"missing_count": new_missing}
            if new_missing >= grace:
                payload["active"] = False  # 3rd consecutive GET-confirmed-dead sweep → hide it
            for i in range(0, len(ids), 200):
                db._execute(db.sb().table(tbl).update(payload).in_("id", ids[i:i + 200]),
                            what=f"{tbl}.strike")
            if new_missing >= grace:
                killed += len(ids)
            else:
                struck += len(ids)

    runtime = round(time.time() - started, 1)
    avg_kb = (total_bytes / checked / 1024) if checked else 0.0
    notes = (f"mode=enforce shard={args.shard}/{args.shards} grace={grace} "
             f"struck={struck} killed={killed} collapsed={collapsed} "
             f"runtime_s={runtime} avg_kb_per_check={avg_kb:.1f}")
    db._execute(db.sb().table("wasalt_liveness_runs").insert({
        "finished_at": now_iso, "shard": f"enforce:{args.shard}/{args.shards}", "mode": "enforce",
        "checked": checked, "live": live, "dead": dead, "failed": failed, "skipped": int(collapsed),
        "bytes_downloaded": total_bytes, "notes": notes}), what="wasalt_liveness_runs.insert")
    print(f"\n✓ Wasalt liveness enforce: checked={checked} live={live} dead={dead} failed={failed} "
          f"struck(→missing_count+1)={struck} killed(→inactive)={killed} collapsed={collapsed} "
          f"runtime_s={runtime}", flush=True)
    return 0


# ── ENUM-STRIKE (the production Wasalt lifecycle, 2026-07-12) ─────────────────────────────────────
# Replaces per-listing polling (enforce over ~59.7k rows/day) with the FULL-ENUMERATION model:
# a daily `run.py --all --pages 2000` sweep walks every list page of every slice (~2k pages ≈ 285MB
# gzip — ~1% of the old detail-GET cost) and, via the normal upserts, refreshes last_seen_at on every
# listing that still exists. Liveness then falls out almost for free:
#   STRIKE (DB-only, zero proxy bytes): active rows the completed enumeration did NOT see get
#     missing_count += 1. Applied in DESCENDING missing_count order so one run can never
#     double-increment a row.
#   CONFIRM (tiny, bounded): only rows reaching --grace consecutive missed enumerations are
#     HEAD→GET-verified with the existing check_hybrid(). GET-confirmed dead → active=false
#     (deactivated_at trigger starts the retention clock); confirmed live → missing_count=0 +
#     last_seen refreshed (self-healing); transient/failed → untouched, no strike consumed.
# GUARDS (all must pass before anything flips):
#   • enum-coverage: strikes only run against a scrape_runs row with ok=true AND rows_seen ≥
#     --enum-min-rows AND started within --enum-window-hours AND ≥ --coverage-frac × the median of
#     the previous qualifying enumerations. A blocked proxy / partial crawl / wasalt layout change
#     ⇒ no qualifying run ⇒ NO strikes (fail-safe direction).
#   • control-group: before any flip, --control-n rows the enumeration JUST saw (known-live) are
#     verified with the same checker; if fewer than --control-min-live verify live, the CHECKER
#     (not the listings) is broken — abort all flips. (The old 30% dead-frac guard is wrong here:
#     a 3-strike cohort is EXPECTED to be mostly dead, so it would always trip.)
# A live listing can therefore only be hidden if it was missed by THREE consecutive
# coverage-verified full enumerations AND a direct GET confirmed it dead AND the checker proved
# itself healthy on known-live controls in the same run — belt, suspenders, and a second belt.
def _keyset_ids(tbl: str, *, mc: int, before_iso: str) -> list[int]:
    """ids of ACTIVE rows with missing_count=mc AND last_seen_at < before_iso (keyset-paged)."""
    out: list[int] = []
    last = -1
    while True:
        page = db._execute(
            db.sb().table(tbl).select("id")
            .eq("active", True).eq("missing_count", mc).lt("last_seen_at", before_iso)
            .gt("id", last).order("id", desc=False).limit(1000),
            what=f"{tbl}.enum_strike_ids",
        ).data or []
        if not page:
            return out
        for x in page:
            out.append(x["id"])
            last = x["id"]


def coverage_ok(current_rows: int, history_rows: list[int], frac: float) -> bool:
    """Pure guard: current enumeration must reach `frac` of the median of previous qualifying runs.
    With <2 history runs there is no baseline yet — accept (min-rows floor still applied upstream)."""
    if len(history_rows) < 2:
        return True
    hist = sorted(history_rows)
    median = hist[len(hist) // 2] if len(hist) % 2 else (hist[len(hist) // 2 - 1] + hist[len(hist) // 2]) / 2
    return current_rows >= frac * median


def control_ok(live: int, dead: int, failed: int, n: int, min_live: float) -> bool:
    """Pure guard: the checker must see ≥min_live of known-live controls as live, on a mostly-decided
    sample. Too many transient failures = can't trust the checker either."""
    decided = live + dead
    if decided < max(5, n // 2):
        return False
    return (live / decided) >= min_live


def run_enum_strike(args) -> int:
    started = time.time()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1) The qualifying enumeration run (fail-safe: none ⇒ nothing happens).
    q = db._execute(
        db.sb().table("scrape_runs").select("id, started_at, rows_seen")
        .eq("platform", "wasalt").eq("ok", True).gte("rows_seen", args.enum_min_rows)
        .order("started_at", desc=True).limit(4),
        what="scrape_runs.enum_candidates",
    ).data or []
    if not q:
        print(f"⚠ enum-strike: no qualifying enumeration (ok=true, rows_seen≥{args.enum_min_rows}) "
              f"found — NO strikes. (Run run.py --all --pages 2000 first.)", flush=True)
        return 0
    cur = q[0]
    cutoff = datetime.now(timezone.utc).timestamp() - args.enum_window_hours * 3600
    cur_started = datetime.fromisoformat(cur["started_at"].replace("Z", "+00:00"))
    if cur_started.timestamp() < cutoff:
        print(f"⚠ enum-strike: newest qualifying enumeration ({cur['started_at']}) is older than "
              f"{args.enum_window_hours}h — NO strikes.", flush=True)
        return 0
    history = [int(r["rows_seen"]) for r in q[1:]]
    if not coverage_ok(int(cur["rows_seen"]), history, args.coverage_frac):
        print(f"⚠ enum-strike COVERAGE GUARD: rows_seen={cur['rows_seen']} < "
              f"{args.coverage_frac} × median{history} — partial crawl, NO strikes.", flush=True)
        return 0
    enum_start = cur["started_at"]
    print(f"enum-strike: qualifying enumeration run id={cur['id']} started={enum_start} "
          f"rows_seen={cur['rows_seen']} (history={history}) grace={args.grace}"
          f"{' [DRY-RUN]' if args.dry_run else ''}", flush=True)

    # 2) STRIKE — descending missing_count so one run can never double-increment a row.
    struck = {n: 0 for n in range(args.grace)}
    for mc in range(args.grace - 1, -1, -1):
        for tbl in TABLES:
            ids = _keyset_ids(tbl, mc=mc, before_iso=enum_start)
            struck[mc] += len(ids)
            if args.dry_run or not ids:
                continue
            for i in range(0, len(ids), 200):
                db._execute(db.sb().table(tbl).update({"missing_count": mc + 1}).in_("id", ids[i:i + 200]),
                            what=f"{tbl}.enum_strike")
    print(f"  strikes (unseen by enum): " +
          ", ".join(f"mc{mc}→{mc+1}: {n}" for mc, n in sorted(struck.items())), flush=True)

    # 3) CONFIRM cohort: rows at ≥grace consecutive missed enumerations (oldest last_seen first).
    cohort: list[tuple[str, int, str, int]] = []
    for tbl in TABLES:
        need = args.confirm_limit - len(cohort)
        if need <= 0:
            break
        rows = db._execute(
            db.sb().table(tbl).select("id, listing_url, missing_count")
            .eq("active", True).gte("missing_count", args.grace)
            .order("last_seen_at", desc=False).limit(need),
            what=f"{tbl}.enum_confirm_cohort",
        ).data or []
        for x in rows:
            url = (x.get("listing_url") or "").strip()
            if url:
                cohort.append((tbl, x["id"], url, int(x.get("missing_count") or 0)))
    # Control group: rows the enumeration JUST saw (known-live) — proves the checker itself works.
    control: list[tuple[str, int, str, int]] = []
    for tbl in TABLES:
        rows = db._execute(
            db.sb().table(tbl).select("id, listing_url, missing_count")
            .eq("active", True).gte("last_seen_at", enum_start)
            .order("id", desc=True).limit(args.control_n // len(TABLES) + 1),
            what=f"{tbl}.enum_control",
        ).data or []
        for x in rows:
            url = (x.get("listing_url") or "").strip()
            if url:
                control.append((tbl, x["id"], url, int(x.get("missing_count") or 0)))
    control = control[:args.control_n]
    print(f"  confirm cohort={len(cohort)} (cap {args.confirm_limit}), control group={len(control)}",
          flush=True)

    checked = live = dead = failed = 0
    killed = 0
    total_bytes = 0
    aborted_flips = False
    if args.dry_run:
        print(f"  DRY-RUN: skipping network confirm; {len(cohort)} rows WOULD be HEAD/GET-verified "
              f"(flips only for GET-confirmed dead).", flush=True)
    elif cohort:
        # 3a) control first — if the checker can't see known-live rows as live, trust nothing.
        c_live = c_dead = c_failed = 0
        with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
            for _tbl, _lid, _cur, verdict, _g, nbytes in ex.map(check_hybrid, control):
                total_bytes += nbytes
                c_live += verdict == "live"; c_dead += verdict == "dead"; c_failed += verdict == "failed"
        if not control_ok(c_live, c_dead, c_failed, len(control), args.control_min_live):
            aborted_flips = True
            print(f"⚠ enum-strike CONTROL GUARD: known-live controls verified live={c_live} dead={c_dead} "
                  f"failed={c_failed} — checker/proxy unhealthy, NO flips this run.", flush=True)
        else:
            print(f"  control healthy: live={c_live}/{len(control)} (dead={c_dead} failed={c_failed})",
                  flush=True)
            # 3b) verify the cohort; flip ONLY GET-confirmed dead. live → self-heal. failed → untouched.
            alive_ids: dict[str, list[int]] = {t: [] for t in TABLES}
            dead_ids: dict[str, list[int]] = {t: [] for t in TABLES}
            with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
                for tbl, lid, _cur, verdict, _g, nbytes in ex.map(check_hybrid, cohort):
                    checked += 1
                    total_bytes += nbytes
                    if verdict == "live":
                        live += 1; alive_ids[tbl].append(lid)
                    elif verdict == "dead":
                        dead += 1; dead_ids[tbl].append(lid)
                    else:
                        failed += 1
            for tbl, ids in alive_ids.items():
                _flush_alive(tbl, ids, now_iso)          # missing_count=0 + fresh last_seen
            for tbl, ids in dead_ids.items():
                for i in range(0, len(ids), 200):
                    db._execute(db.sb().table(tbl).update({"active": False}).in_("id", ids[i:i + 200]),
                                what=f"{tbl}.enum_kill")
                killed += len(ids)

    runtime = round(time.time() - started, 1)
    notes = (f"mode=enum-strike enum_run={cur['id']} enum_rows={cur['rows_seen']} "
             f"struck={sum(struck.values())} cohort={len(cohort)} killed={killed} "
             f"aborted_flips={aborted_flips} dry_run={args.dry_run} runtime_s={runtime}")
    if not args.dry_run:
        db._execute(db.sb().table("wasalt_liveness_runs").insert({
            "finished_at": now_iso, "shard": "enum", "mode": "enum-strike",
            "checked": checked, "live": live, "dead": dead, "failed": failed,
            "skipped": int(aborted_flips), "bytes_downloaded": total_bytes, "notes": notes}),
            what="wasalt_liveness_runs.insert")
    print(f"\n✓ Wasalt enum-strike: struck={sum(struck.values())} cohort_checked={checked} "
          f"live(self-healed)={live} killed(→inactive)={killed} failed(untouched)={failed} "
          f"aborted_flips={aborted_flips} runtime_s={runtime}", flush=True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Wasalt hybrid liveness (HEAD-first, GET-confirm)")
    ap.add_argument("--mode", default="pilot", choices=["pilot", "enforce", "enum-strike"])
    ap.add_argument("--limit", type=int, default=0,
                    help="Cap rows checked (0 = all). pilot defaults to 800 when unset.")
    ap.add_argument("--workers", type=int, default=4, help="Low concurrency; each worker gets its own session.")
    ap.add_argument("--grace", type=int, default=3,
                    help="ENFORCE: consecutive GET-confirmed-dead sweeps before active=false.")
    ap.add_argument("--shards", type=int, default=1, help="ENFORCE: split active rows into N id-buckets.")
    ap.add_argument("--shard", type=int, default=0, help="ENFORCE: which 0-indexed bucket this job handles.")
    ap.add_argument("--max-dead-frac", type=float, default=0.30,
                    help="ENFORCE collapse guard: skip ALL strikes if dead fraction exceeds this.")
    ap.add_argument("--stagger-mod", type=int, default=1,
                    help="ENFORCE bandwidth stagger: check only rows where id %% N == today's index, so "
                         "each active row is checked every ~N days (1 = every row every run). Cuts proxy GB ~N×.")
    ap.add_argument("--stagger-idx", type=int, default=-1,
                    help="ENFORCE: which stagger bucket to check today (default -1 = auto from UTC ordinal date).")
    ap.add_argument("--enum-min-rows", type=int, default=40000,
                    help="ENUM-STRIKE: a scrape_runs row must have rows_seen ≥ this to count as a full "
                         "enumeration (distinguishes it from the small 3-page sweep runs).")
    ap.add_argument("--enum-window-hours", type=int, default=36,
                    help="ENUM-STRIKE: the qualifying enumeration must have started within this window.")
    ap.add_argument("--coverage-frac", type=float, default=0.85,
                    help="ENUM-STRIKE coverage guard: current enum rows_seen must reach this fraction of "
                         "the median of previous qualifying enums, else NO strikes.")
    ap.add_argument("--confirm-limit", type=int, default=1500,
                    help="ENUM-STRIKE: max rows HEAD/GET-verified per run (bounds proxy bandwidth; the "
                         "backlog simply drains across days).")
    ap.add_argument("--control-n", type=int, default=30,
                    help="ENUM-STRIKE: known-live control rows verified first; flips abort if they fail.")
    ap.add_argument("--control-min-live", type=float, default=0.90,
                    help="ENUM-STRIKE control guard: required live fraction among decided controls.")
    ap.add_argument("--dry-run", action="store_true",
                    help="ENUM-STRIKE: print what would be struck/verified; write NOTHING.")
    args = ap.parse_args()
    if args.mode == "pilot" and not args.limit:
        args.limit = 800
    if args.mode == "enum-strike":
        return run_enum_strike(args)
    return run_enforce(args) if args.mode == "enforce" else run_pilot(args)


if __name__ == "__main__":
    sys.exit(main())
