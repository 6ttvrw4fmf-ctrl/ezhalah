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

RETRY PASS (2026-07-16 backlog fix): definitive fetch errors (404/noNEXT/noslug) used to be marked
ar_fetched=true with ar_data={'_err':…} and then NEVER looked at again — 738 active rows accumulated
with city_ar/district_ar/region_id all NULL, even though 90% of them were re-captured by the list
scraper afterwards (run.py refreshes listing_url with the CURRENT slug on every upsert, so a slug
that drifted between capture and enrichment 404s once and would succeed on retry). Each run now also
re-attempts a BOUNDED batch of previously-errored rows (--retry-errs, oldest ar_fetched_at first,
>=24h between attempts on the same row). Every definitive failure increments ar_data._errn; at
ERR_MAX_ATTEMPTS the row is parked (ar_data._parked=true) and permanently leaves the retry queue —
truly-dead listings are owned by the liveness sweep (active=false), which also removes them here.
The cap keeps the extra metered-proxy spend flat (<=retry_errs detail fetches per run).

TRANSPORT (2026-09-18): wasalt.sa has been unreachable by every http client since Cloudflare
tightened on 2026-08-17 (issue #1019). Set WASALT_BROWSER=1 and this fetches through
scrapers/wasalt/browser.py — the real headed Chromium the sweep switched to in PR #3129 — instead of
curl_cffi. Without it this job kept quietly failing transient, so every row the browser sweep
captured from 2026-09-17 on had ar_data=NULL while ar_data is the very thing
docs/ops/DATA_INTEGRITY_ENGINEER.md §25 makes the oracle for adjudicating a suspect wasalt price.
The browser path runs SINGLE-THREADED (Playwright's sync API is thread-bound) and needs a display —
`xvfb-run` on CI, because headless=False is what clears the challenge.

Run (local — user's own IP, free bandwidth):
  WASALT_BROWSER=1 python -m scrapers.wasalt.enrich_ar --table wasalt_residential_listings --limit 800
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
from datetime import datetime, timedelta, timezone
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


# Definitive-error retry policy: a row gets this many DEFINITIVE attempts (404/noNEXT/noslug — each
# >=24h apart via --err-backoff-hours) before it is parked forever. Transient failures never count.
# Truly-dead listings normally leave the queue earlier anyway: the liveness sweep flips them
# active=false within ~3 sweeps, and the retry query only selects active rows.
ERR_MAX_ATTEMPTS = 5


def bump_err(err: dict, prev_ar_data: Any) -> dict:
    """Attempt bookkeeping for a definitive enrichment error. Returns the ar_data to store: the new
    error marker plus `_errn` (total definitive attempts so far) and, once ERR_MAX_ATTEMPTS is
    reached, `_parked: true` — which permanently removes the row from the retry queue (the standing
    selection filters on `ar_data->_parked is null`). Rows written before this counter existed
    (bare `{'_err': …}`, incl. the legacy `{'_err': 'transient'}` stamps from 2026-06-25) count as
    ONE prior attempt. Pure — unit-tested in scrapers/common/tests/test_wasalt_enrich_ar_retry.py."""
    prev_n = 0
    if isinstance(prev_ar_data, dict) and "_err" in prev_ar_data:
        try:
            prev_n = max(1, int(prev_ar_data.get("_errn") or 1))
        except (TypeError, ValueError):
            prev_n = 1
    out = dict(err)
    out["_errn"] = prev_n + 1
    if out["_errn"] >= ERR_MAX_ATTEMPTS:
        out["_parked"] = True
    return out


def retry_eligible(ar_data: Any) -> bool:
    """Client-side mirror of the server-side retry filter (defence in depth): only a stored ERROR
    marker that has not been parked is ever re-fetched — never a successful payload, never a parked
    row, never a row with no ar_data."""
    return isinstance(ar_data, dict) and "_err" in ar_data and not ar_data.get("_parked")


# One Chromium per PROCESS, created on first use and reused for every row in this slice — the same
# shape scrapers/wasalt/run.py uses, for the same reason (launching Chromium per page would dominate
# the wall clock). Kept local to this module rather than imported from run.py: these are two separate
# entrypoints that never share a process, and run.py drags in the whole upsert pipeline.
_BROWSER: Any = None


def _browser_fetch_enabled() -> bool:
    from scrapers.wasalt import browser as _b
    return _b.browser_enabled()


def _browser() -> Any:
    global _BROWSER
    if _BROWSER is None:
        from scrapers.wasalt import browser as _b
        _BROWSER = _b.BoundedBrowserFetcher()   # hard per-call deadline — ops_incident #708
    return _BROWSER


def close_browser() -> None:
    global _BROWSER
    if _BROWSER is not None:
        _BROWSER.close()
        _BROWSER = None


def _from_next_data(data: dict) -> tuple[bool, dict, Optional[str], Optional[str]]:
    """Shared tail of BOTH transports: a parsed __NEXT_DATA__ → the tuple fetch_ar returns.

    A wasalt URL whose listing is gone still renders a perfectly parseable Next.js document.
    MEASURED 2026-09-18 on a bogus slug through the browser: HTTP 200, __NEXT_DATA__ present,
    `pageProps` carrying nothing but the two Sentry keys, `propertyDetailsV3` null. Without the
    guard below `_extract({})` returns `{}`, which work() stores as `ar_data = {}` and counts as
    ok — a vanished listing archived as "wasalt published nothing about this property", which is
    precisely the false negative the ar_data oracle exists to prevent
    (docs/ops/DATA_INTEGRITY_ENGINEER.md §25 reads ar_data to adjudicate a suspect price).
    `nodetail` is DEFINITIVE — the page answered, it just has no listing — so it counts toward the
    ERR_MAX_ATTEMPTS budget and eventually parks, exactly like the http path's 404.

    The http path could always hit this too (a 200 shell with no propertyDetailsV3); it is fixed
    here rather than in the browser branch so one guard covers both transports.
    """
    pdv = (data.get("props", {}).get("pageProps", {}).get("propertyDetailsV3") or {})
    if not pdv:
        return True, {"_err": "nodetail"}, None, None
    d, city_ar, dist_ar = _extract(pdv)
    return True, d, city_ar, dist_ar


# An `_err` that means "this route answered and there is NO LISTING here" — as opposed to one that
# means "something went wrong on the way". Only the first kind is evidence of absence, so only the
# first kind may trigger the /en salvage below. `noNEXT` is deliberately NOT here: a page that is
# not a Next.js document at all can be a WAF shell, which is evidence of nothing.
_NO_LISTING_ERRS = {"nodetail", 404, 410}


def _fetch_route(route: str, slug: str) -> tuple[bool, Optional[dict], Optional[str], Optional[str]]:
    """Fetch ONE language route of a listing → the tuple fetch_ar returns. `route` is 'ar' or 'en'."""
    url = f"{BASE}/{route}/property/{slug}"

    # CLOUDFLARE PATH (WASALT_BROWSER=1). wasalt.sa tightened bot protection on 2026-08-17 and no
    # http client has reached it since (issue #1019; the fix landed for the sweep in PR #3129).
    # THIS job kept using the blocked http path, so every row the browser sweep captured from
    # 2026-09-17 on got ar_data=NULL — and ar_data is the oracle
    # docs/ops/DATA_INTEGRITY_ENGINEER.md §25 tells an adjudicator to consult before concluding a
    # suspect wasalt price is ours. The oracle was blind on exactly the newest rows, which is why
    # the ×1000 price alerts of 2026-09-18 (PR #3137) needed a fresh live fetch to settle.
    #
    # `next_data()` already carries its own 4-attempt ladder with a fresh proxy exit per retry, so
    # this is ONE call — wrapping it in the http path's 3-attempt loop would mean 12 navigations
    # per row. It returns the ALREADY-PARSED dict, so there is no regex/json.loads step here.
    if _browser_fetch_enabled():
        _throttle()
        data = _browser().next_data(url)
        if data is None:
            # A BLOCK, NOT A VERDICT. next_data() returns None for "no parseable answer" — a
            # Cloudflare challenge shell, a dead proxy exit and a navigation timeout all look
            # identical from here, and NONE of them is evidence about the listing. Recording it
            # as a definitive `_err` would spend one of the row's ERR_MAX_ATTEMPTS attempts, so a
            # single blocked day would park rows permanently on the strength of our own outage.
            # Transient → the row is left completely untouched and the next run retries it.
            return False, None, None, None
        return _from_next_data(data)

    s = _session()
    for attempt in range(3):
        _throttle()
        try:
            r = s.get(url, timeout=30)
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
        return _from_next_data(json.loads(m.group(1)))
    return False, None, None, None  # retries exhausted → transient


def fetch_ar(slug: str) -> tuple[bool, Optional[dict], Optional[str], Optional[str]]:
    """Return (ok, ar_data, city_ar, district_ar).
    ok=False  → transient (network / 429 / 403 block / retries exhausted): leave ar_fetched=false so a
                later run retries. ok=True with ar_data={'_err':…} → page loaded but no usable payload
                (404/410/no __NEXT_DATA__): mark done for THIS run; the bounded retry pass re-attempts
                such rows (oldest-first, >=24h apart) up to ERR_MAX_ATTEMPTS, then parks them.

    /en SALVAGE (2026-09-18). Some listings have NO ARABIC PAGE AT ALL. Measured on ids 11939663 /
    11939667 / 11939669: `/ar/property/{slug}` answers Next.js `page: "/404"` while
    `/en/property/{slug}` serves a complete payload. It is NOT a slug mismatch — wasalt publishes
    the Arabic slug as `propertyInfo.alternateSlug`, and `/ar/property/{alternateSlug}` 404s for
    these three as well, while the control listing resolves on either slug. Nor is it liveness:
    the listings are alive, so the liveness sweep will never retire them, and without this they
    simply burn five attempts and park — permanently absent from the §25 price oracle.

    So when — and only when — /ar says there is no listing, fall back to /en and archive THAT.
    `salePrice` is language-independent, which is the field the oracle exists to answer on.

    WHAT THE SALVAGE MUST NOT DO: write English into the Arabic columns. `city_ar`/`district_ar`
    are Arabic-only (the /en payload says 'Jeddah' / 'Al-Fanar'), and `_region_for()` resolves
    against the Arabic catalog, so a leak here would corrupt both the column and the region
    lookup. The salvage therefore returns city/district as None — there IS no Arabic city for
    this listing, and NULL is the honest value (SOURCE IS TRUTH: silent → NULL). The payload is
    stamped `_lang: "en"` so nothing downstream mistakes an English archive for an Arabic one;
    its absence keeps meaning Arabic, so no existing row needs rewriting."""
    ok, d, city_ar, dist_ar = _fetch_route("ar", slug)
    if not (ok and isinstance(d, dict) and d.get("_err") in _NO_LISTING_ERRS):
        return ok, d, city_ar, dist_ar

    ok_en, d_en, _, _ = _fetch_route("en", slug)
    if not ok_en:
        # The salvage attempt was BLOCKED, not answered. We still do not know whether an English
        # page exists, so this is our failure, not the listing's — stay transient rather than
        # spending one of the row's ERR_MAX_ATTEMPTS attempts on our own outage.
        return False, None, None, None
    if not isinstance(d_en, dict) or "_err" in d_en:
        return True, {"_err": "nodetail"}, None, None  # gone on BOTH routes → genuinely absent
    d_en["_lang"] = "en"
    return True, d_en, None, None


def enrich_table(table: str, limit: int, workers: int, shard: int = 0, shards: int = 1,
                 max_pending: int = 5000, allow_backfill: bool = False,
                 retry_errs: int = 100, err_backoff_hours: float = 24.0,
                 max_seconds: float = 0.0) -> dict[str, int]:
    _load_catalog()
    # ONE BROWSER, ONE THREAD. Playwright's sync API binds its driver to the thread that started it
    # (scrapers/wasalt/browser.py:_ensure has the scar tissue — a second start() in one thread dies
    # with "Playwright Sync API inside the asyncio loop"), so the shared BrowserFetcher cannot be
    # driven from a pool. The alternatives were a browser per worker — 6 Chromiums and 6 proxy
    # sessions on one runner, which is both a memory and a bandwidth problem — or a lock around
    # next_data(), which serializes to exactly this anyway while looking parallel. The http path
    # keeps its pool; the time budget, not the worker count, is what bounds a browser run.
    if _browser_fetch_enabled() and workers != 1:
        print(f"   ⓘ browser transport → --workers {workers} forced to 1 (Playwright's sync API is "
              f"thread-bound; --max-seconds is what bounds this run)", flush=True)
        workers = 1
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
    stats = {"ok": 0, "empty": 0, "fail": 0, "skipped": 0}
    lock = threading.Lock()

    # SELF-IMPOSED DEADLINE — stop cleanly instead of being killed at the CI wall.
    #
    # WHY (ops_incident #307, root-caused 2026-09-18). ex.map() below walks every row it was handed
    # with no time budget, so on the residential table the job simply ran until GitHub's
    # `timeout-minutes: 60` killed it. Measured on run 35367340468: the commercial job finished in
    # 18 SECONDS (nothing pending) while the residential job ran 16:15:05 → 17:15:11 — exactly 60
    # minutes — and GitHub reports a timeout kill as `cancelled`, which is why the history reads
    # "cancelled" rather than "failure". 7 of the last 12 runs died that way.
    #
    # Two things that kill does, beyond wasting the runner:
    #   1. db.end_run() never executes, so the scrape_runs row is left open — the standing
    #      `run_killed_by_timeout` P1s are this job telling the truth about being killed;
    #   2. the retry pass below never runs at all, so errored rows are starved every long run.
    # Rows already written ARE durable (each row is its own UPDATE), so the kill loses no data —
    # it loses the HONEST ACCOUNTING of what happened, which is the part monitoring depends on.
    #
    # A skipped row is left completely untouched (ar_fetched stays false), so it is simply picked up
    # by the next scheduled run — the same semantics a transient failure already has, but counted
    # separately because "I ran out of clock" is not "the source failed me".
    deadline = (time.monotonic() + max_seconds) if max_seconds > 0 else None
    out_of_time = lambda: deadline is not None and time.monotonic() >= deadline

    def work(row: dict) -> None:
        if out_of_time():
            with lock:
                stats["skipped"] += 1
            return
        sl = _slug(row.get("listing_url"))
        if not sl:
            # No slug → can't fetch; error marker + attempt counter (a later re-capture can refresh
            # listing_url, so a few retries are worth it — they cost zero proxy fetches).
            try:
                c.table(table).update({"ar_fetched": True, "ar_fetched_at": _now_iso(),
                                       "ar_data": bump_err({"_err": "noslug"}, row.get("ar_data"))
                                       }).eq("id", row["id"]).execute()
            except Exception:
                pass
            with lock:
                stats["empty"] += 1
            return
        ok, d, city_ar, dist_ar = fetch_ar(sl)
        if not ok:
            # Transient — row left untouched: a pending row keeps ar_fetched=false, a retry row
            # keeps its old ar_fetched_at (stays at the front of the oldest-first retry queue).
            # Transient failures never consume a definitive attempt.
            with lock:
                stats["fail"] += 1
            return
        if "_err" in d:
            d = bump_err(d, row.get("ar_data"))
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

    def run_rows(batch: list[dict]) -> None:
        """workers==1 runs INLINE, never through a pool of one.

        MEASURED 2026-09-18, not assumed: a BrowserFetcher driven from a one-thread pool works on
        the first pass and then dies on the second with
        `greenlet.error: cannot switch to a different thread (which happens to have exited)`.
        Playwright's sync driver is bound to the thread that started it, and this function is
        called TWICE — once for the pending rows and once for the retry pass — so each call gets a
        fresh worker thread from a fresh executor. A pool of one looks single-threaded and is not;
        it would have taken out the errored-row retry pass on every single browser run, which is
        the one pass that drains rows nobody else revisits.
        """
        if workers == 1:
            for r in batch:
                work(r)
            return
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(work, batch))

    run_rows(rows)
    print(f"   ✓ {table}: ok={stats['ok']} empty={stats['empty']} fail={stats['fail']} "
          f"skipped={stats['skipped']}", flush=True)
    if stats["skipped"]:
        print(f"   ⏳ {table}: out of time budget ({max_seconds:.0f}s) — {stats['skipped']} row(s) left "
              f"pending for the next scheduled run. This is a CLEAN stop, not a failure.", flush=True)

    # ── Bounded retry pass over previously-errored rows (runs AFTER the pending pass so brand-new
    # listings always get bandwidth first; its own cap keeps proxy spend flat). Oldest failure
    # first; each definitive re-failure refreshes ar_fetched_at, sending the row to the back of
    # the queue for >=err_backoff_hours. Parked rows are excluded server-side forever.
    retry_rows: list[dict] = []
    # The retry pass is deliberately LAST, so brand-new listings get bandwidth first — which also
    # means it is the first thing a 60-minute kill used to destroy. Skip it honestly when the clock
    # is already gone rather than opening a query we cannot finish.
    if retry_errs > 0 and not out_of_time():
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=err_backoff_hours)).isoformat()
        rq = (c.table(table).select("id,ad_number,listing_url,ar_data")
              .eq("active", True).eq("ar_fetched", True)
              .not_.is_("ar_data->_err", "null")
              .is_("ar_data->_parked", "null")
              .lt("ar_fetched_at", cutoff))
        if shards == 10:
            rq = rq.like("ad_number", f"%{shard}")
        fetched = rq.order("ar_fetched_at").limit(retry_errs).execute().data or []
        retry_rows = [r for r in fetched if retry_eligible(r.get("ar_data"))]
    stats["retry_attempted"] = len(retry_rows)
    if retry_rows:
        pre = {k: stats[k] for k in ("ok", "empty", "fail")}
        run_rows(retry_rows)
        stats["retry_ok"] = stats["ok"] - pre["ok"]
        stats["retry_empty"] = stats["empty"] - pre["empty"]
        stats["retry_fail"] = stats["fail"] - pre["fail"]
        print(f"   ↻ {table} err-retry: attempted={len(retry_rows)} recovered={stats['retry_ok']} "
              f"still-err={stats['retry_empty']} transient={stats['retry_fail']}", flush=True)

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
    ap.add_argument("--retry-errs", type=int, default=100,
                    help=f"Also re-attempt up to this many previously-errored rows (ar_data._err, oldest "
                         f"first, one attempt per row per --err-backoff-hours, parked forever after "
                         f"{ERR_MAX_ATTEMPTS} definitive failures). 0 disables. Bounds the extra metered-"
                         f"proxy spend per run.")
    ap.add_argument("--err-backoff-hours", type=float, default=24.0,
                    help="Minimum hours between two attempts on the same errored row (default 24).")
    # Must stay comfortably INSIDE the workflow's `timeout-minutes`, which remains the backstop.
    # 2700s (45 min) under a 60-minute wall leaves room for pip install, the retry pass and end_run.
    ap.add_argument("--max-seconds", type=float, default=2700.0,
                    help="Self-imposed wall clock for row processing. On expiry the run stops CLEANLY, "
                         "finalizes its scrape_runs row and leaves the remainder pending for the next "
                         "scheduled run, instead of being killed by the CI timeout (ops_incident #307). "
                         "0 disables the budget (local/one-off backfills).")
    args = ap.parse_args()
    # Own platform name per table, DISTINCT from the real scraper's own 'wasalt' scrape_runs rows —
    # this is backlog-processing throughput (rows_seen = pending backlog at start), not "listings
    # scraped this run", so mixing the two into one platform stream would corrupt the existing
    # silent-scraper-death detector's rows_seen>0 health signal for the real scraper.
    suffix = "commercial" if "commercial" in args.table else "residential"
    platform = f"wasalt_enrich_ar_{suffix}"
    run_id = db.begin_run(platform)
    try:
        stats = enrich_table(args.table, args.limit, args.workers, args.shard, args.shards,
                             args.max_pending, args.allow_backfill,
                             args.retry_errs, args.err_backoff_hours, args.max_seconds)
    finally:
        # Chromium is a child process, not a socket — leaving it up keeps the runner alive past the
        # job and can hold the whole step open. finally, so a raise still tears it down.
        close_browser()
    aborted = stats.get("aborted", 0)
    ok_count, empty_count, fail_count = stats.get("ok", 0), stats.get("empty", 0), stats.get("fail", 0)
    skipped = stats.get("skipped", 0)
    attempted = ok_count + empty_count + fail_count
    # ok=False when the circuit breaker fired (0 rows processed despite a real backlog) or when more
    # than half of attempted rows failed — both are the "reports success but does nothing useful"
    # shape this monitoring exists to catch, not a healthy empty-queue run (attempted==0, no pending).
    #
    # A time-budget skip is NOT counted as a failure (the source never let us down; the clock ran
    # out), and partial progress under the budget is a healthy run. But skipping work while getting
    # NOTHING done is the "reports success, did nothing" shape again, so that one is not ok.
    run_ok = (aborted == 0
              and (attempted == 0 or fail_count <= attempted / 2)
              and not (skipped > 0 and attempted == 0))
    db.end_run(
        run_id, ok=run_ok, rows_seen=stats.get("pending_before", 0), rows_upserted=ok_count + empty_count,
        notes=(f"ok={ok_count} empty={empty_count} fail={fail_count} aborted={aborted} "
               f"skipped_out_of_time={skipped} "
               f"retried={stats.get('retry_attempted', 0)} recovered={stats.get('retry_ok', 0)} "
               f"limit={args.limit} max_seconds={args.max_seconds:.0f} "
               f"allow_backfill={args.allow_backfill}"),
        # allow_empty: unlike a scraper (rows_seen==0 → dead/blocked source, a real problem), this job's
        # rows_seen is the PENDING BACKLOG at start — 0 pending is the ideal steady-state once this fix
        # has been running a while, not a failure. Without this, end_run's RC-B honesty demotion would
        # wrongly flip every healthy "fully caught up" run to ok=False.
        allow_empty=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
