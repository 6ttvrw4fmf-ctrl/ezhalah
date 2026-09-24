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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db  # noqa: E402
from scrapers.common.liveness_contract import direct_alive_patch

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


# Diagnostics for the bare `except Exception` below (alert_event 507, 2026-08-21): a "failed"
# verdict used to discard the real exception, so a listing stuck failing forever (timeout? TLS?
# connection reset? something route-specific?) left no trace of which. Print the exception TYPE
# once per (call-site, type) per process — never the URL/message (may carry query params) — so a
# run's logs show what class of failure is actually happening without flooding on every one of a
# large shard's rows hitting the same known issue.
_seen_exc_kinds: set[tuple[str, str]] = set()
_seen_exc_lock = threading.Lock()


def _pmap(fn, items, workers: int):
    """map(fn, items) across `workers` threads — but INLINE, on the calling thread, at workers==1.

    NOT a micro-optimisation. Playwright's sync driver is bound to the thread that started it, and
    this module opens a FRESH ThreadPoolExecutor at four separate call sites, so a "pool of one"
    hands the browser to a different worker thread each time and the second one dies with
    `greenlet.error: cannot switch to a different thread (which happens to have exited)` —
    measured on the AR enricher, 2026-09-18, before the same mistake shipped there (PR #3140).
    A pool of one looks single-threaded and is not.
    """
    if workers <= 1:
        return [fn(x) for x in items]
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(fn, items))


def _note_exc(where: str, exc: BaseException) -> None:
    kind = type(exc).__name__
    key = (where, kind)
    with _seen_exc_lock:
        if key in _seen_exc_kinds:
            return
        _seen_exc_kinds.add(key)
    print(f"  (diagnostic) {where}: first {kind} this run — {exc}", file=sys.stderr, flush=True)


# ── CLOUDFLARE PATH (WASALT_BROWSER=1) ──────────────────────────────────────────────────────────
# wasalt.sa has been unreachable by every http client since 2026-08-17 (issue #1019), and THIS
# module's `_session()` is the blocked shape exactly: curl_cffi impersonate="chrome124" through the
# Saudi residential proxy. run.py moved to a real browser in PR #3129 and enrich_ar.py in PR #3140;
# liveness was the third consumer of the blocked transport and nothing listed it.
#
# The consequence was not "liveness is a bit stale". Every read came back 403/timeout, which
# get_verdict() correctly calls 'failed' (transient, never dead), so NO wasalt row could accumulate
# a strike and NO dead wasalt listing could EVER be retired — they stayed active AND searchable
# indefinitely. Six such rows were found and repaired by hand on 2026-09-19 (migration
# 20260919010944); this is the fix that stops the next one.
_BROWSER: Any = None


def _browser_enabled() -> bool:
    from scrapers.wasalt import browser as _b
    return _b.browser_enabled()


def _browser() -> Any:
    global _BROWSER
    if _BROWSER is None:
        from scrapers.wasalt import browser as _b
        _BROWSER = _b.BrowserFetcher()
    return _BROWSER


def close_browser() -> None:
    global _BROWSER
    if _BROWSER is not None:
        _BROWSER.close()
        _BROWSER = None


def browser_verdict(url: str):
    """Browser-transport twin of get_verdict(). Returns (verdict, status, nbytes).

    THE ONE RULE THIS FUNCTION EXISTS TO HOLD: a browser that produced no parseable answer is OUR
    failure, never the listing's. `page_data()` returns None for a challenge shell, a dead proxy
    exit and a navigation timeout alike, and none of the three is evidence about the ad. They all
    map to 'failed' — transient — because the alternative is a blocked run striking every row it
    touches and, at grace, deactivating live inventory in bulk. That is the single worst outcome
    this whole module can produce, and it is one wrong branch away.

    Status is load-bearing and is NOT redundant with the payload. Measured 2026-09-19 through a
    headed Chromium: a dead listing answers HTTP 404 with a parseable __NEXT_DATA__ (`page:"/404"`,
    propertyDetailsV3 null, 211KB); a live one answers 200 with the payload (326KB). So a returned
    dict alone cannot decide anything — a 404 carries one too.
    """
    data, status, nbytes = _browser().page_data(url)
    if status in (404, 410):
        return ("dead", status, nbytes)          # the source answered: it is gone
    if data is None:
        return ("failed", status or 0, nbytes)   # no parseable answer → UNKNOWN, never dead
    if status != 200:
        return ("failed", status or 0, nbytes)   # 5xx/403/redirect → transient, never dead
    try:
        pdv = (data.get("props", {}).get("pageProps", {}) or {}).get("propertyDetailsV3")
    except Exception:
        pdv = None
    return ("live" if pdv else "dead", status, nbytes)


def head_status(url: str, tries: int = 3):
    """HEAD status code (cheap), or None after transient failures."""
    s = _session()
    for attempt in range(tries):
        try:
            _throttle()
            return s.head(url, timeout=20, allow_redirects=True).status_code
        except Exception as e:
            if attempt == tries - 1:
                _note_exc("head_status", e)
                return None
            _backoff(attempt)
    return None


def get_verdict(url: str, tries: int = 3):
    """Return (verdict, status, nbytes). verdict ∈ {'live','dead','failed'} — GET is the ground truth."""
    if _browser_enabled():
        _throttle()
        return browser_verdict(url)
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
        except Exception as e:
            if attempt == tries - 1:
                _note_exc("get_verdict", e)
                return ("failed", 0, 0)
            _backoff(attempt)
    return ("failed", 0, 0)


def check_hybrid(row):
    """ENFORCE worker: (tbl, id, url, cur_missing) ->
    (tbl, id, cur_missing, verdict, used_get, nbytes, head_code, get_code).
    HEAD 200 short-circuits to 'live' with NO GET; anything else escalates to a GET-confirm.
    head_code/get_code are carried out (not just the verdict) so a kill can be re-checked later from
    the status that actually caused it — 404 vs 200-without-propertyDetailsV3 are different evidence."""
    tbl, lid, url, cur = row
    # ponytail: the browser path has no cheap HEAD, so it always pays for the GET. Playwright has
    # no HEAD primitive, and curl_cffi's HEAD is the blocked transport — a HEAD there returns the
    # same 403 the GET does, so short-circuiting on it would be worse than useless. The cost is
    # bounded because only the enum-ABSENT candidates are confirmed (--confirm-limit, default
    # 1500), not the whole table: ~1500 × ~300KB ≈ 450MB/run, ~7GB/month at the 2-day cadence,
    # against the ~700GB/month that got per-listing liveness disabled in the first place.
    # Upgrade path if that ever matters: context.request.head() reuses the browser context's
    # cf_clearance cookie, which may pass once a navigation has solved the challenge — untested.
    if _browser_enabled():
        verdict, st, nbytes = get_verdict(url)
        return (tbl, lid, cur, verdict, True, nbytes, None, st)
    hc = head_status(url)
    if hc == 200:
        return (tbl, lid, cur, "live", False, 0, hc, None)
    verdict, st, nbytes = get_verdict(url)
    return (tbl, lid, cur, verdict, True, nbytes, hc, st)


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


def _flush_detail(rows: list[dict]) -> None:
    """Per-row evidence for every listing the confirm step decided on, into the existing
    `wasalt_liveness_pilot_detail` table (head/get status + verdict + bytes).

    Why: enum-strike inactivates ~1.2-1.5k rows per run but used to persist only AGGREGATE counts in
    `wasalt_liveness_runs`, so "was that kill correct?" could not be answered from our own data —
    it needed an outside oracle (wasalt's sitemap) re-fetched by hand. One row per decision makes
    every inactivation independently re-checkable afterwards.

    Best-effort: an audit-log write must never fail or roll back a liveness run."""
    for i in range(0, len(rows), 500):
        try:
            db._execute(db.sb().table("wasalt_liveness_pilot_detail").insert(rows[i:i + 500]),
                        what="wasalt_liveness_pilot_detail.insert")
        except Exception as exc:  # noqa: BLE001 — logging must not break the lifecycle
            print(f"⚠ detail-log insert failed (non-fatal, {len(rows[i:i + 500])} rows): "
                  f"{str(exc)[:160]}", flush=True)
    _mirror_probe_evidence(rows)


# Verdict vocabulary translation. `check_hybrid` speaks live/dead/failed; the fleet-wide ledger
# speaks the three-valued contract. 'failed' is UNKNOWN — never GONE (LISTING_LIVENESS.md §1).
_LEDGER_VERDICT = {"dead": "GONE", "live": "LIVE", "failed": "UNKNOWN"}


def _mirror_probe_evidence(rows: list[dict]) -> None:
    """Mirror each decision into the FLEET-WIDE ledger, `ops_stale_inactivation_probe`.

    WHY THIS EXISTS (2026-09-06). wasalt already recorded per-row evidence — but only in its own
    private `wasalt_liveness_pilot_detail`, which nothing outside this file reads. Measured that
    day: 678 of 678 rows wasalt deactivated had a same-day DIRECT `dead` verdict sitting in that
    private table, while `ops_stale_inactivation_probe` held ZERO wasalt rows ALL-TIME and
    `mon_detect_deletion_clock_without_evidence` was reporting 7,559 wasalt rows as having
    "NOTHING in the database recording a source verdict".

    Both statements were true at once, and that is the defect: the kills were evidenced, the
    evidence was invisible. An audit that cannot see the evidence has to re-probe the source to
    answer "was that kill correct?" — and wasalt needs the Saudi residential proxy, so from any
    other egress the honest answer was "unknown". Evidence nobody can reach is not far from
    evidence that does not exist; this is the same shape as a dark detector reading as a clean bill
    of health, one layer down.

    Writing the canonical row makes every wasalt inactivation auditable in SQL, from anywhere, with
    no proxy — which is the whole point. It is shaped to what the detector actually reads
    (`source_table` + `ad_number` + `verdict='GONE'` + `probed_at >= deactivated_at - 1 hour`), not
    to what looks reasonable: a mirror the detector cannot match would be pure theatre.

    FORWARD-ONLY, DELIBERATELY. This writes at probe time, for rows probed on this run. It does not
    and must not backfill the existing backlog: stamping today's verdict onto a July deactivation
    would make a kill that was unverifiable AT THE TIME look verified, which is precisely the
    anti-pattern `liveness_contract.verification_patch` exists to prevent for
    `last_verified_alive_at`. Those rows go green by being RE-VERIFIED, never by being re-labelled.

    Best-effort, like its caller: monitoring must never fail the lifecycle it observes."""
    if not rows:
        return
    by_tbl: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r.get("tbl") and r.get("listing_id") is not None:
            by_tbl[r["tbl"]].append(r)

    for tbl, group in by_tbl.items():
        ids = [r["listing_id"] for r in group]
        # The confirm step carries only listing_id; the ledger is keyed on ad_number because that is
        # what the detector joins on. Resolve it rather than inventing one — a probe row under the
        # wrong key is worse than no probe row, since it reads as evidence for another listing.
        ident: dict[int, dict] = {}
        try:
            for i in range(0, len(ids), 200):
                res = db._execute(
                    db.sb().table(tbl).select("id, ad_number, listing_url").in_("id", ids[i:i + 200]),
                    what=f"{tbl}.probe_ident")
                for row in (getattr(res, "data", None) or []):
                    ident[row["id"]] = row
        except Exception as exc:  # noqa: BLE001
            print(f"⚠ probe-ledger identity lookup failed for {tbl} (non-fatal): {str(exc)[:160]}",
                  flush=True)
            continue

        payload = []
        for r in group:
            who = ident.get(r["listing_id"])
            if not who or not who.get("ad_number"):
                continue          # cannot key it → write nothing rather than something unjoinable
            payload.append({
                "source_table": tbl,
                "listing_id": r["listing_id"],
                "ad_number": who["ad_number"],
                "listing_url": who.get("listing_url") or "",
                "http_status": r.get("get_status") if r.get("get_status") is not None else r.get("head_status"),
                "body_bytes": r.get("nbytes"),
                "verdict": _LEDGER_VERDICT.get(r.get("get_verdict"), "UNKNOWN"),
                "oracle": "wasalt.liveness.check_hybrid",
                "note": (f"head={r.get('head_status')} get={r.get('get_status')} "
                         f"verdict={r.get('get_verdict')} "
                         f"property_details={r.get('has_property_details')}")[:300],
            })
        for i in range(0, len(payload), 200):
            try:
                db._execute(db.sb().table("ops_stale_inactivation_probe").insert(payload[i:i + 200]),
                            what="ops_stale_inactivation_probe.insert")
            except Exception as exc:  # noqa: BLE001 — the ledger must never break the sweep
                print(f"⚠ probe-ledger insert failed (non-fatal, {len(payload[i:i + 200])} rows): "
                      f"{str(exc)[:160]}", flush=True)


def _flush_alive(tbl: str, ids: list[int], now_iso: str) -> None:
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        if chunk:
            db._execute(
                db.sb().table(tbl).update({"last_seen_at": now_iso, "missing_count": 0,
                                           "last_liveness_probe_at": now_iso,
                                           **direct_alive_patch(now_iso=now_iso)}).in_("id", chunk),
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
    for tbl, lid, verdict, hc, nbytes in _pmap(check_one, rows, args.workers):
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
        # started_at/finished_at must mean what they say (run #29): `now_iso` is captured at the TOP
        # of the run, so writing it into finished_at — and letting started_at fall to its now()
        # default at INSERT time, i.e. at the end — recorded every row backwards.
        "started_at": now_iso, "finished_at": datetime.now(timezone.utc).isoformat(),
        "shard": "oldest-last_seen", "mode": "pilot",
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

    for tbl, lid, cur, verdict, used_get, nbytes, _hc, _gc in _pmap(check_hybrid, rows, args.workers):
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
        "started_at": now_iso, "finished_at": datetime.now(timezone.utc).isoformat(),
        "shard": f"enforce:{args.shard}/{args.shards}", "mode": "enforce",
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
#   EVIDENCE: every confirm decision is written to `wasalt_liveness_pilot_detail` (listing, HEAD
#     status, GET status, verdict, bytes) so any inactivation can be re-checked from our own data
#     later. Aggregate counts alone can't answer "was that kill right?" — proving the 2026-08-02
#     cohort needed wasalt's sitemap re-fetched by hand. Best-effort: a failed log never blocks a run.
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


def plan_confirm_budget(available: list[int], cap: int) -> list[int]:
    """Split `cap` confirm slots across TABLES so a saturated table can never starve another.

    The old cohort loop filled tables in order and broke once the cap was reached, so the FIRST
    table took every slot it could use and later tables got whatever was left — nothing, once the
    first table saturated. Observed 2026-08-14: wasalt_residential filled all 1500 slots, so the
    22 struck wasalt_commercial rows could not be confirmed at all, and would stay served for as
    long as residential keeps saturating (the cohort has grown 356 → 952 → 1206 → 1489 per run).

    Each table is offered an equal share; any share a table cannot use spills over to the tables
    that still want slots. This is a FAIRNESS change, not a loosening: the post-conditions are
    sum(result) == min(cap, sum(available)) and result[i] <= available[i], so no run ever confirms
    more rows than --confirm-limit and no table is starved while it has struck rows waiting.
    """
    n = len(available)
    if n == 0 or cap <= 0:
        return [0] * n
    take = [0] * n
    remaining = cap
    while remaining > 0:
        wants = [i for i in range(n) if take[i] < available[i]]
        if not wants:
            break
        share = max(1, remaining // len(wants))
        for i in wants:
            if remaining <= 0:
                break
            grant = min(share, available[i] - take[i], remaining)
            take[i] += grant
            remaining -= grant
    return take


def control_ok(live: int, dead: int, failed: int, n: int, min_live: float) -> bool:
    """Pure guard: the checker must see ≥min_live of known-live controls as live, on a mostly-decided
    sample. Too many transient failures = can't trust the checker either."""
    decided = live + dead
    if decided < max(5, n // 2):
        return False
    return (live / decided) >= min_live


SHARD_PLATFORM = "wasalt_enum_shard"


def rollup_ok(shards_seen: int, shards_expected: int, rows: int, min_rows: int) -> tuple[bool, str]:
    """Pure: may these shard runs be published as ONE qualifying enumeration?

    Both conditions are load-bearing and neither implies the other:
      * EVERY shard must have reported. A missing shard is a whole slice of the catalogue nobody
        looked at, and every active listing in it would be counted "unseen by the enum" and struck.
        `needs:` in the workflow already gates on job success, but a job can succeed having written
        no run row at all, so the count is re-checked here against the DB rather than against CI.
      * The SUM must still clear the absolute floor, so a set of shards that all ran but returned
        almost nothing cannot publish a row the coverage guard would then bless.

    Deliberately does NOT re-implement coverage_ok(): the relative-to-median guard downstream is
    unchanged and is still what decides whether a complete-LOOKING enumeration is trustworthy.
    This only decides whether the shards ADD UP to one enumeration at all.
    """
    if shards_expected <= 0:
        return False, "shards_expected must be positive — refusing to publish an unbounded rollup"
    if shards_seen < shards_expected:
        return False, (f"only {shards_seen}/{shards_expected} shards reported — a missing slice is "
                       f"a slice nobody enumerated, and every live listing in it would be struck")
    if rows < min_rows:
        return False, f"shards summed to {rows} rows < floor {min_rows}"
    return True, f"{shards_seen}/{shards_expected} shards, {rows} rows"


def rollup_started_at(shard_started_ats: list[str]) -> str:
    """Pure: the enumeration's real start is the EARLIEST of its shards' own started_at — never the
    rollup job's own clock (bug found 2026-09-24, ops_incident, routine #11).

    THE BUG. run_enum_rollup() used to stamp its published `platform='wasalt'` row with
    `db.begin_run("wasalt")`, which sets `started_at = now()` at the moment the ROLLUP job runs —
    the summing step, which by design runs AFTER every shard has already finished
    (`needs: [enum, rollup]` in the workflow). Measured 2026-09-24: the 34 shards started
    2026-09-23T21:03:07 through 21:50:24; the rollup that summed them ran at 2026-09-24T00:38:56 —
    almost 3 HOURS after enumeration actually began. `run_enum_strike()` then reads that row's
    `started_at` as "when the enumeration started" for two queries that must answer "was this row
    just seen": the control group (`last_seen_at >= enum_start`, proving the checker is healthy on
    known-live rows) and the strike scan (`last_seen_at < enum_start` = "unseen by the enum" ⇒
    +1 strike). Every listing genuinely refreshed during the real 3-hour enumeration window has a
    `last_seen_at` BEFORE the rollup's clock and therefore AFTER none of it — it reads as "not seen"
    on both queries at once. Reproduced live and read-only against production the same day: with the
    rollup's own timestamp as the cutoff the control-group query returns 0 (bit-for-bit the
    `control group=0` the job actually logged); with the earliest shard's timestamp it returns
    49,782. Real listing id 475284 was refreshed at 00:37:51 — 65 seconds before the wrong cutoff —
    and was struck as "unseen" for it.

    Consequence, all from one wrong clock: the CONTROL GUARD (`control_ok`) always sees an empty
    sample, so `aborted_flips=True` on every run since the sharded design shipped (2026-09-20) —
    zero confirms, zero self-heals, zero kills — while the STRIKE step (which is NOT gated by that
    guard) keeps incrementing `missing_count` on nearly the whole active table every single run,
    because on this wrong clock nearly every row looks unseen. Neither guard is loosened by this fix;
    both keep exactly the logic they had. Only the timestamp they are FED is corrected.
    """
    if not shard_started_ats:
        raise ValueError("rollup_started_at() called with no shard rows — refuse rather than guess")
    return min(shard_started_ats)


def run_enum_rollup(args) -> int:
    """Sum this dispatch's shard runs into ONE `platform='wasalt'` scrape_runs row.

    WHY THIS EXISTS. The enumeration used to be one job walking ~3,300 pages; through the browser
    that is 10-16h against a 6h runner ceiling (measured 2026-09-19 — run 35416642741 died at the
    330-minute wall, two-thirds through). Sharding it one job per slice is the only way it
    completes. But run_enum_strike()'s coverage guard reads the single newest `platform='wasalt'`
    run with rows_seen >= enum_min_rows, and twenty ~3k-row shards would each look like a
    catastrophically partial crawl.

    Rather than loosen that guard — it is the one thing standing between a partial crawl and
    mass-deactivating live inventory — the shards publish under a DIFFERENT platform and are rolled
    up here into the single row the guard already expects. THE GUARD'S CODE IS UNTOUCHED.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.enum_window_hours)).isoformat()
    runs = db._execute(
        db.sb().table("scrape_runs").select("id, started_at, rows_seen, ok")
        .eq("platform", SHARD_PLATFORM).gte("started_at", cutoff)
        .order("started_at", desc=True).limit(200),
        what="scrape_runs.enum_shards",
    ).data or []
    good = [r for r in runs if r.get("ok")]
    rows = sum(int(r.get("rows_seen") or 0) for r in good)
    ok, why = rollup_ok(len(good), args.shards_expected, rows, args.enum_min_rows)

    print(f"enum-rollup: {len(good)}/{args.shards_expected} ok shards in the last "
          f"{args.enum_window_hours}h, {rows} rows summed → {'PUBLISH' if ok else 'REFUSE'} ({why})",
          flush=True)
    if args.dry_run:
        print("  [DRY-RUN] no scrape_runs row written", flush=True)
        return 0
    if not ok:
        # Refusing is not something to hide: record the attempt so the shard set stays auditable,
        # but NEVER as a row the coverage guard could bless.
        rid = db.begin_run("wasalt_enum_rollup_refused")
        db.end_run(rid, ok=False, rows_seen=rows, rows_upserted=0, notes=f"refused: {why}",
                   allow_empty=True)
        return 1

    rid = db.begin_run("wasalt")
    db.end_run(rid, ok=True, rows_seen=rows, rows_upserted=rows,
               notes=f"enum-rollup of {len(good)} shards ({why})",
               check_tables=["wasalt_residential_listings", "wasalt_commercial_listings"])
    # begin_run() stamped started_at=now() — the ROLLUP's own clock, ~3h after the shards it is
    # summing actually ran. run_enum_strike() reads this row's started_at as "when the enumeration
    # began" for both its control-group and its strike queries; left as the rollup's own timestamp,
    # every listing genuinely refreshed during the real enumeration window reads as unseen by BOTH
    # (see rollup_started_at()'s docstring for the measured 2026-09-24 proof). Overwrite it with the
    # true start: the earliest of the shards actually being published.
    db._execute(
        db.sb().table("scrape_runs")
        .update({"started_at": rollup_started_at([r["started_at"] for r in good])})
        .eq("id", rid),
        what="scrape_runs.enum_rollup_started_at_fix",
    )
    return 0


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
                # We LOOKED, whatever the verdict — see migration 20260924. Not evidence of life.
                db._execute(db.sb().table(tbl).update(
                    {"missing_count": mc + 1,
                     "last_liveness_probe_at": datetime.now(timezone.utc).isoformat()}).in_("id", ids[i:i + 200]),
                            what=f"{tbl}.enum_strike")
    print(f"  strikes (unseen by enum): " +
          ", ".join(f"mc{mc}→{mc+1}: {n}" for mc, n in sorted(struck.items())), flush=True)

    # 3) CONFIRM cohort: rows at ≥grace consecutive missed enumerations (oldest last_seen first).
    # Each table's candidates are read independently and the budget is then split by
    # plan_confirm_budget(), so one saturated table can never starve another (see that docstring).
    # Reading is still bounded by the same --confirm-limit per table, and the cap is unchanged.
    per_table: list[list[tuple[str, int, str, int]]] = []
    for tbl in TABLES:
        rows = db._execute(
            db.sb().table(tbl).select("id, listing_url, missing_count")
            .eq("active", True).gte("missing_count", args.grace)
            .order("last_seen_at", desc=False).limit(args.confirm_limit),
            what=f"{tbl}.enum_confirm_cohort",
        ).data or []
        cand: list[tuple[str, int, str, int]] = []
        for x in rows:
            url = (x.get("listing_url") or "").strip()
            if url:
                cand.append((tbl, x["id"], url, int(x.get("missing_count") or 0)))
        per_table.append(cand)
    take = plan_confirm_budget([len(p) for p in per_table], args.confirm_limit)
    cohort: list[tuple[str, int, str, int]] = [r for p, k in zip(per_table, take) for r in p[:k]]
    if any(len(p) > k for p, k in zip(per_table, take)):
        print("  confirm budget split " +
              ", ".join(f"{t}: {k}/{len(p)}" for t, p, k in zip(TABLES, per_table, take)) +
              " (cap bound — remainder waits for the next run)", flush=True)
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
        for _tbl, _lid, _cur, verdict, _g, nbytes, _hc, _gc in _pmap(check_hybrid, control, args.workers):
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
            detail: list[dict] = []
            for tbl, lid, _cur, verdict, used_get, nbytes, hc, gc in _pmap(check_hybrid, cohort, args.workers):
                    checked += 1
                    total_bytes += nbytes
                    detail.append({
                        "tbl": tbl, "listing_id": lid, "head_status": hc, "get_status": gc,
                        "get_verdict": verdict, "nbytes": nbytes,
                        # Only meaningful when a GET actually ran: a HEAD-200 short-circuit never
                        # looked at the body, so "was propertyDetailsV3 there?" is unknown, not False.
                        "has_property_details": (verdict == "live") if used_get else None,
                    })
                    if verdict == "live":
                        live += 1; alive_ids[tbl].append(lid)
                    elif verdict == "dead":
                        dead += 1; dead_ids[tbl].append(lid)
                    else:
                        failed += 1
            _flush_detail(detail)   # evidence first: written even if a flip below fails
            for tbl, ids in alive_ids.items():
                _flush_alive(tbl, ids, now_iso)          # missing_count=0 + fresh last_seen
            for tbl, ids in dead_ids.items():
                for i in range(0, len(ids), 200):
                    db._execute(db.sb().table(tbl).update(
                        {"active": False,
                         "last_liveness_probe_at": datetime.now(timezone.utc).isoformat()}).in_("id", ids[i:i + 200]),
                                what=f"{tbl}.enum_kill")
                killed += len(ids)

    runtime = round(time.time() - started, 1)
    notes = (f"mode=enum-strike enum_run={cur['id']} enum_rows={cur['rows_seen']} "
             f"struck={sum(struck.values())} cohort={len(cohort)} killed={killed} "
             f"aborted_flips={aborted_flips} dry_run={args.dry_run} runtime_s={runtime}")
    if not args.dry_run:
        db._execute(db.sb().table("wasalt_liveness_runs").insert({
            "started_at": now_iso, "finished_at": datetime.now(timezone.utc).isoformat(),
            "shard": "enum", "mode": "enum-strike",
            "checked": checked, "live": live, "dead": dead, "failed": failed,
            "skipped": int(aborted_flips), "bytes_downloaded": total_bytes, "notes": notes}),
            what="wasalt_liveness_runs.insert")
    print(f"\n✓ Wasalt enum-strike: struck={sum(struck.values())} cohort_checked={checked} "
          f"live(self-healed)={live} killed(→inactive)={killed} failed(untouched)={failed} "
          f"aborted_flips={aborted_flips} runtime_s={runtime}", flush=True)
    return 0


def run_repair_clock_bug_backlog(args) -> int:
    """ONE-TIME repair for the confirm-eligible backlog the enum-rollup clock bug produced
    (ops_incident, routine #11, 2026-09-24 — see rollup_started_at() for the full writeup).

    Every row this cohort selects reached `missing_count >= grace` via strikes computed against the
    WRONG clock (the rollup's own start time, measured ~3h later than the enumeration it was
    summarising), so an ordinary enum-strike confirm cannot be trusted to decide them: it would treat
    three clock-bug strikes as three legitimately earned ones and deactivate on the very first
    post-fix confirm. This mode instead:

      * confirmed LIVE  → full self-heal (missing_count=0, last_seen_at refreshed). Correct
                          regardless of how the row was flagged — a true "it's fine" is a true
                          "it's fine".
      * confirmed DEAD  → missing_count=1, and active is NEVER touched. This is real, honestly
                          obtained evidence — a direct GET performed right now, this run — and it is
                          not thrown away. But it counts as exactly ONE freshly earned strike under
                          the now-fixed pipeline, not three unearned ones inherited from the bug. It
                          must reach grace again through correctly-clocked runs (or another confirm)
                          before this listing can ever be deactivated.
      * FAILED/unclear  → missing_count=0. Nothing was proven either way, and the existing value was
                          already unproven — the safe direction wins, exactly as everywhere else in
                          this module (LISTING_LIVENESS.md: absence of an answer is never evidence of
                          death).

    `active` DOES NOT APPEAR as a key anywhere a write happens in this function. That is not
    discipline this run happens to exercise — it is structurally absent from the code, so this mode
    cannot deactivate a single listing no matter what the checks return.

    A degenerate read (checker apparently unable to distinguish anything — overwhelmingly dead, or
    overwhelmingly failed) skips even the missing_count writes: it means don't trust today's DEAD
    verdicts as freshly-earned strikes either, not just "don't kill anyone" (which was never on the
    table). Mirrors the collapse guard in run_enforce() at the same 90% degenerate threshold used
    there is deliberately stricter (that guard's job is to stop a kill; this one has no kill to stop,
    so it only needs to protect the QUALITY of the strike it is about to hand back to the ordinary
    pipeline).
    """
    started = time.time()
    now_iso = datetime.now(timezone.utc).isoformat()
    cohort: list[tuple[str, int, str, int]] = []
    for tbl in TABLES:
        rows = db._execute(
            db.sb().table(tbl).select("id, listing_url, missing_count")
            .eq("active", True).gte("missing_count", args.grace)
            .order("id", desc=False).limit(100_000),
            what=f"{tbl}.repair_backlog_cohort",
        ).data or []
        for x in rows:
            url = (x.get("listing_url") or "").strip()
            if url:
                cohort.append((tbl, x["id"], url, int(x.get("missing_count") or 0)))

    print(f"repair-clock-bug-backlog: {len(cohort)} rows at missing_count>={args.grace} "
          f"(this mode can only ever write missing_count=0 or 1 — never active)", flush=True)
    if args.dry_run or not cohort:
        print("  [DRY-RUN or empty cohort] no checks performed, no writes", flush=True)
        return 0

    checked = live = dead = failed = 0
    total_bytes = 0
    alive_ids: dict[str, list[int]] = {t: [] for t in TABLES}
    fresh_strike_ids: dict[str, list[int]] = {t: [] for t in TABLES}   # dead → mc=1, never a kill
    reset_ids: dict[str, list[int]] = {t: [] for t in TABLES}          # failed → mc=0
    detail: list[dict] = []

    for tbl, lid, _cur, verdict, used_get, nbytes, hc, gc in _pmap(check_hybrid, cohort, args.workers):
            checked += 1
            total_bytes += nbytes
            detail.append({
                "tbl": tbl, "listing_id": lid, "head_status": hc, "get_status": gc,
                "get_verdict": verdict, "nbytes": nbytes,
                "has_property_details": (verdict == "live") if used_get else None,
            })
            if verdict == "live":
                live += 1; alive_ids[tbl].append(lid)
            elif verdict == "dead":
                dead += 1; fresh_strike_ids[tbl].append(lid)
            else:
                failed += 1; reset_ids[tbl].append(lid)
            if checked % 500 == 0:
                el = max(1e-6, time.time() - started)
                print(f"  [{checked}/{len(cohort)}] live={live} dead={dead} failed={failed} "
                      f"({checked / el:.1f}/s)", flush=True)

    _flush_detail(detail)  # evidence first, exactly as enum-strike's confirm step does

    decided = live + dead
    degenerate = decided >= 20 and (dead > 0.9 * decided or failed > 0.9 * checked)
    if degenerate:
        print(f"⚠ REPAIR GUARD: live={live} dead={dead} failed={failed} of {checked} — reads as a "
              f"broken checker, not a broken backlog. Skipping missing_count writes this run "
              f"(nothing here was ever going to be deactivated either way).", flush=True)
    else:
        for tbl, ids in alive_ids.items():
            _flush_alive(tbl, ids, now_iso)
        for tbl, ids in fresh_strike_ids.items():
            for i in range(0, len(ids), 200):
                db._execute(db.sb().table(tbl).update({"missing_count": 1}).in_("id", ids[i:i + 200]),
                            what=f"{tbl}.repair_fresh_strike")
        for tbl, ids in reset_ids.items():
            for i in range(0, len(ids), 200):
                db._execute(db.sb().table(tbl).update({"missing_count": 0}).in_("id", ids[i:i + 200]),
                            what=f"{tbl}.repair_reset_unproven")

    runtime = round(time.time() - started, 1)
    notes = (f"mode=repair-clock-bug-backlog checked={checked} live={live} dead={dead} failed={failed} "
             f"degenerate={degenerate} runtime_s={runtime}")
    db._execute(db.sb().table("wasalt_liveness_runs").insert({
        "started_at": now_iso, "finished_at": datetime.now(timezone.utc).isoformat(),
        "shard": "repair", "mode": "repair-clock-bug-backlog",
        "checked": checked, "live": live, "dead": dead, "failed": failed,
        "skipped": int(degenerate), "bytes_downloaded": total_bytes, "notes": notes}),
        what="wasalt_liveness_runs.insert")
    print(f"\n✓ repair-clock-bug-backlog: checked={checked} live(self-healed)={live} "
          f"dead(ONE fresh strike, never killed)={dead} failed(reset to 0)={failed} "
          f"degenerate={degenerate} runtime_s={runtime}", flush=True)
    return 0 if not degenerate else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Wasalt hybrid liveness (HEAD-first, GET-confirm)")
    ap.add_argument("--mode", default="pilot",
                    choices=["pilot", "enforce", "enum-strike", "enum-rollup",
                             "repair-clock-bug-backlog"])
    ap.add_argument("--shards-expected", type=int, default=20,
                    help="enum-rollup: how many shard runs MUST have reported before their sum may "
                         "be published as one enumeration. A missing shard is a slice nobody "
                         "enumerated, whose live listings would then all be struck.")
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
    # ONE BROWSER, ONE THREAD. See _pmap(): Playwright's sync driver is bound to the thread that
    # started it, and this module maps over rows from four separate call sites. Serialising here is
    # not a throughput regression to apologise for — a browser confirm is seconds either way, and
    # the cohort is bounded by --confirm-limit.
    if _browser_enabled() and args.workers != 1:
        print(f"ⓘ browser transport → --workers {args.workers} forced to 1 "
              f"(Playwright's sync API is thread-bound)", flush=True)
        args.workers = 1
    try:
        if args.mode == "enum-rollup":
            return run_enum_rollup(args)
        if args.mode == "enum-strike":
            return run_enum_strike(args)
        if args.mode == "repair-clock-bug-backlog":
            return run_repair_clock_bug_backlog(args)
        return run_enforce(args) if args.mode == "enforce" else run_pilot(args)
    finally:
        # Chromium is a child process, not a socket — an un-closed one can hold the CI step open.
        close_browser()


if __name__ == "__main__":
    sys.exit(main())
