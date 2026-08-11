"""Supabase client + upsert helpers shared by every per-platform scraper.

`sb()` returns a service-role client (bypasses RLS).
`upsert_<platform>_*_batch(rows)` — the REAL write path: every scheduled scraper writes into its
own per-platform `<platform>_{residential,commercial}_listings` table via these wrappers
(all funnel through `_wasalt_batch`, which sanitizes, captures, and batch-upserts).
`upsert_listing(row)` is a LEGACY single-row writer into `public.listings` — deprecated, see its
docstring; do not use it for new scrapers.
`begin_run(platform)` / `end_run(...)` write to `scrape_runs` so we can spot a broken source fast.
"""
from __future__ import annotations

import os
import random
import re
import signal
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

from scrapers.common.pii import is_free_text, redact_capture, redact_pii
from scrapers.common.placeholder_tokens import PLACEHOLDER_TOKENS, is_placeholder


# Load .env once when this module is first imported.
load_dotenv()


# Transient failures worth retrying instead of crashing the whole scrape. A SATURATED database returns
# Cloudflare 522 (origin connection timed out) with an HTML body that PostgREST surfaces as
# "JSON could not be generated"; we also retry other gateway 5xx, rate-limits, request-timeouts, and
# connection/SSL resets. Everything else (e.g. a real 400/schema error) raises immediately so genuine
# bugs still surface. (Added 2026-06: scrapers were dying on transient 522s during DB-overload windows.)
_TRANSIENT_MARKERS = ("522", "520", "524", "503", "502", "504", "429", "408",
                      "timed out", "timeout", "connection", "json could not be generated",
                      "temporarily unavailable", "eof", "reset by peer", "server disconnected")


def _execute(query, *, what: str = "db", tries: int = 5):
    """Run a PostgREST query with exponential backoff + jitter on TRANSIENT errors (522 etc.), then
    re-raise after the last attempt. Upserts/selects/updates here are idempotent, so retrying is safe.

    NOT SAFE for a bare INSERT that has no conflict key — a transient error can be raised AFTER the
    server already committed the row, so the retry inserts a SECOND one. `scrape_runs` is the only
    such insert in this module; it goes through `_begin_run_idempotent` below instead of this
    helper. Do not route a new plain insert through here without giving it an idempotency key."""
    last_exc: Optional[BaseException] = None
    for attempt in range(tries):
        try:
            return query.execute()
        except Exception as exc:  # inspect, then either retry (transient) or re-raise
            last_exc = exc
            msg = str(exc).lower()
            transient = any(m in msg for m in _TRANSIENT_MARKERS)
            if not transient or attempt == tries - 1:
                raise
            delay = min(30.0, 2.0 ** attempt) + random.uniform(0.0, 1.0)
            print(f"⚠ {what}: transient DB error (attempt {attempt + 1}/{tries}), "
                  f"retrying in {delay:.1f}s — {str(exc)[:140]}", flush=True)
            time.sleep(delay)
    raise last_exc  # unreachable; satisfies type checkers


def sb() -> Client:
    """Service-role Supabase client. Cached on the module for reuse across calls."""
    global _client
    try:
        return _client  # type: ignore[name-defined]
    except NameError:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = create_client(url, key)
        return _client


def upsert_listing(row: dict[str, Any]) -> None:
    """DEPRECATED — legacy/dead write path. Do NOT use for new scrapers.

    Upserts one row into `public.listings` keyed on (source_platform, source_id) — the ORIGINAL
    prototype table from before the per-platform architecture. Reality check (2026-07-16):
    `public.listings` holds 13 rows, has ZERO scheduled callers, and nothing in search reads it;
    the only remaining caller is the unscheduled `scrapers/aqar/run.py` (itself legacy — the live
    Aqar pipeline writes `aqar_residential_listings` / `aqar_commercial_listings`).

    The production path is one table per platform (`<platform>_{residential,commercial}_listings`)
    written via the `upsert_<platform>_*_batch()` wrappers below (all funneling through
    `_wasalt_batch`). Kept only so the legacy script still runs; the table is kept for audit.
    """
    row = dict(row)  # don't mutate the caller's dict
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _execute(
        sb().table("listings").upsert(row, on_conflict="source_platform,source_id"),
        what="listings",
    )


# The scrape_runs row this process opened, if any — read by the kill-handler below.
_OPEN_RUN: dict[str, Any] = {"run_id": None, "platform": None}


def _finalize_open_run_on_signal(signum, _frame) -> None:  # pragma: no cover - signal path
    """Close this process's open scrape_runs row when the CI job is killed.

    THE BUG THIS EXISTS TO FIX (2026-08-08). Every scraper puts `end_run()` in a `finally:`
    block, which is airtight for Python-level exceptions — and useless when the process is
    killed by a signal, because `finally` never runs. GitHub Actions kills a job that exceeds
    `timeout-minutes`, so the row stays ok=NULL / finished_at=NULL FOREVER:

      • dealapp run 25397 — "Small sources sync" job cancelled at timeout-minutes:90
        (GH run 31239278341, 04:22:49→05:52:46), 1,800 rows written, row never closed.
      • 7 aqar_residential shards from the weekly deep-fill — `Fill turabah`, `Fill umluj`,
        `Fill abu_arish`, `Fill ahad_al_masarihah` and 3 more each ran ~90.2m against
        `timeout-minutes: 90` (GH run 31233959785) and were cancelled.

    A dangling row is worse than a failed one: `ops_freshness_by_layer` never advances the
    platform's last-OK, `mon_detect_silent_scraper_death` reads `ok IS NULL` as not-healthy but
    needs THREE consecutive bad runs, and the row still reports rows_seen=0 even though the run
    really did write rows — so a killed job reads as a dead SOURCE rather than an infra kill.

    Actions sends SIGINT, then SIGTERM, then SIGKILL after a grace period, so one small UPDATE
    lands comfortably. We deliberately do NOT call end_run(): its check_tables field-range RPCs
    are far too slow for a grace window, and we must not guess rows_seen/rows_upserted — they
    stay as begin_run() left them and the note says why.

    The write is conditional on the row still being open (`ok is null`), so it can never
    overwrite a run that finalized normally, and the handler re-raises with the default
    disposition so the process still dies exactly as the runner expects.
    """
    run_id = _OPEN_RUN.get("run_id")
    _OPEN_RUN["run_id"] = None  # re-entrancy: a second signal must not double-write
    if run_id is not None:
        name = signal.Signals(signum).name
        try:
            sb().table("scrape_runs").update(
                {
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "ok": False,
                    "notes": (
                        f"killed by {name} before end_run() — the CI job hit its timeout-minutes "
                        "budget or was cancelled. Rows upserted before the kill are kept; "
                        "prune/liveness and the run's own bookkeeping did NOT run, so "
                        "rows_seen/rows_upserted are NOT meaningful for this row."
                    ),
                }
            ).is_("ok", "null").eq("id", run_id).execute()
        except Exception:
            pass  # never let bookkeeping stop the process from dying
    signal.signal(signum, signal.SIG_DFL)
    os.kill(os.getpid(), signum)


def _install_run_signal_handlers() -> None:
    """Arm the kill-handler, without stomping on a handler a caller already installed.

    `signal.signal` only works on the main thread; a scraper that calls begin_run() from a
    worker thread simply keeps the old (unprotected) behaviour rather than crashing.
    """
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            if signal.getsignal(sig) in (signal.SIG_DFL, signal.default_int_handler):
                signal.signal(sig, _finalize_open_run_on_signal)
        except (ValueError, OSError, AttributeError):
            pass  # not the main thread, or a platform without this signal


# Must comfortably exceed the LONGEST job budget in .github/workflows, so a legitimately-running
# sibling shard can never be finalized out from under itself. The longest is 330 min / 5.5h
# (muktamel-sync, wasalt-enrich-matrix, wasalt-enum-liveness — all just under GitHub's 6h cap), so
# 6h would leave only 30 min of margin and could close a job that is still working. 12h is >2x the
# longest budget, and still bounds the lag well since every platform runs at least daily.
# scripts/verify-scrape-run-finalized-on-kill.ts fails if this ever drops back near a real budget.
ORPHAN_RUN_HOURS = 12


def reconcile_orphaned_runs(platform: str, *, older_than_hours: int = ORPHAN_RUN_HOURS) -> int:
    """Finalize THIS platform's abandoned scrape_runs stubs as ok=false. Returns rows closed.

    WHY THIS EXISTS ON TOP OF THE SIGTERM HANDLER (2026-08-09). `_finalize_open_run_on_signal`
    closes the row when the job is stopped *gracefully* — but a process can also be SIGKILLed
    (which is uncatchable by definition), OOM-killed by the kernel, or lose its runner VM outright.
    No in-process handler can survive any of those, so the row still dangles at ok=NULL forever.

    That is not hypothetical: it is what happened the day after the handler shipped. Of 32 aqar
    liveness shards on 2026-08-09, 31 finished ok and shard 8 of aqar_residential_listings
    (run 25880) died at ~77 min — well inside its 120-min budget, so NOT a timeout — with GH run
    31287355118 concluding `failure`. `aqar_stub_recovery` run 26102 went the same way. The handler
    closed neither, because neither got a signal it could catch.

    So the complete fix needs BOTH halves:
      • in-process handler  → closes instantly on SIGTERM/SIGINT (graceful cancel, job timeout)
      • this reconciliation → closes on the next run of the same platform, bounded lag, and covers
                              SIGKILL / OOM / lost runner, which the handler cannot.

    Scoped to the EXACT platform string so parallel shards never race each other
    ('aqar_liveness:<table>:<shard>/<shards>' is unique per shard; the deep-fill shards share
    'aqar_residential', which is why the age cutoff must exceed the longest job budget). rows_seen
    is deliberately left as-is: the killed process's true progress is unknown, and inventing a
    number would be worse than the honest stub value.

    Generalised from scrapers/aqar/liveness.py's reconcile_orphaned_stubs() (2026-07-16), which
    solved exactly this — but only ever for aqar liveness. Every other platform was uncovered.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=older_than_hours)).isoformat()
    try:
        res = _execute(
            sb().table("scrape_runs").update(
                {
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "ok": False,
                    "notes": "orphaned — presumed killed (SIGKILL/OOM/lost runner, so no handler "
                             "could close it); finalized by the next run's startup reconciliation. "
                             "rows_seen/rows_upserted are NOT meaningful for this row.",
                }
            ).eq("platform", platform).is_("finished_at", "null").lt("started_at", cutoff),
            what="scrape_runs.reconcile",
        )
        n = len(res.data or [])
    except Exception as exc:
        # Bookkeeping must never stop a scrape from starting.
        print(f"⚠ scrape_runs.reconcile({platform}) skipped: {str(exc)[:140]}", flush=True)
        return 0
    if n:
        print(f"reconciled {n} orphaned run stub(s) for {platform} → ok=false", flush=True)
    return n


def _begin_run_idempotent(platform: str, *, tries: int = 5) -> int:
    """Insert THIS run's scrape_runs row exactly once, even if the insert has to be retried.

    THE DEFECT THIS FIXES (2026-08-10 senior audit, run #8). `_execute` retries transient DB errors
    on the assumption — stated in its own docstring — that every operation it runs is idempotent.
    A bare INSERT is not. PostgREST can fail the RESPONSE (522/timeout/connection reset) after the
    server has already COMMITTED the row; the retry then inserts a duplicate. The caller keeps the
    second id, so the first row is orphaned at ok=NULL/rows_seen=0 forever, raises a false P1
    `dangling_scrape_run`, and makes a healthy platform look like it had a killed run.

    PROOF IT HAPPENS, not a theory: scrape_runs 26326 and 26327 both carry
    started_at = 2026-08-10 00:09:56.826524+00 — identical to the MICROSECOND. Two independent
    shard processes cannot produce that; two attempts at the same payload must, because started_at
    is computed once here in the client and re-sent verbatim on retry. 26327 finished ok with 468
    rows; 26326 dangles. That blip also tripped four other aqar_residential shards and made pg_cron
    report `job startup timeout` on 4 unrelated jobs at 00:10:00 — one infra wobble, several
    symptoms.

    THE FIX uses the client-side timestamp that caused the collision as the idempotency KEY: it is
    generated once, so it uniquely identifies this attempt-set. After a transient failure, look for
    a row already carrying it before inserting again — if the server did commit, adopt that id
    instead of creating a twin. No schema change, no unique index, no behaviour change on the happy
    path (one insert, one row).
    """
    started_at = datetime.now(timezone.utc).isoformat()
    last_exc: Optional[BaseException] = None
    for attempt in range(tries):
        try:
            res = sb().table("scrape_runs").insert({"platform": platform, "started_at": started_at}).execute()
            return int(res.data[0]["id"])
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            if not any(m in msg for m in _TRANSIENT_MARKERS) or attempt == tries - 1:
                raise
            # The failure may have been purely on the response path. If the row landed, adopt it.
            try:
                found = sb().table("scrape_runs").select("id").eq("platform", platform) \
                    .eq("started_at", started_at).limit(1).execute()
                if found.data:
                    run_id = int(found.data[0]["id"])
                    print(f"scrape_runs.begin: insert response failed but the row COMMITTED "
                          f"(id={run_id}) — adopting it instead of inserting a duplicate", flush=True)
                    return run_id
            except Exception as probe_exc:  # probe is best-effort; fall through to the normal retry
                print(f"⚠ scrape_runs.begin: commit probe failed ({str(probe_exc)[:100]}) — retrying insert",
                      flush=True)
            delay = min(30.0, 2.0 ** attempt) + random.uniform(0.0, 1.0)
            print(f"⚠ scrape_runs.begin: transient DB error (attempt {attempt + 1}/{tries}), "
                  f"retrying in {delay:.1f}s — {str(exc)[:140]}", flush=True)
            time.sleep(delay)
    raise last_exc  # unreachable; satisfies type checkers


def begin_run(platform: str) -> int:
    """Open a row in scrape_runs and return its id, so end_run can finalize it.

    First reconciles any of THIS platform's stubs abandoned by an earlier killed process — see
    `reconcile_orphaned_runs`, which covers the SIGKILL/OOM cases the signal handler cannot.

    Also arms a SIGTERM/SIGINT handler so a CI job killed at its `timeout-minutes` budget still
    closes this row honestly instead of leaving it dangling at ok=NULL — see
    `_finalize_open_run_on_signal` for the incident this prevents.
    """
    reconcile_orphaned_runs(platform)
    run_id = _begin_run_idempotent(platform)
    _OPEN_RUN["run_id"] = run_id
    _OPEN_RUN["platform"] = platform
    _install_run_signal_handlers()
    return run_id


def upsert_aqar_residential(row: dict[str, Any]) -> None:
    """Upsert one Aqar residential row, keyed on `ad_number`."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _unknown_must_not_overwrite_known(row)
    _redact_user_visible_text(row)
    _sanitize_ints(row)
    _ensure_capture(row)
    _reject_placeholder_location(row, table="aqar_residential_listings")
    _execute(sb().table("aqar_residential_listings").upsert(row, on_conflict="ad_number"), what="aqar_residential_listings")


def upsert_aqar_commercial(row: dict[str, Any]) -> None:
    """Upsert one Aqar commercial row, keyed on `ad_number`. Same schema/shape as residential
    (the commercial table was cloned from it), just a different destination table."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _unknown_must_not_overwrite_known(row)
    _redact_user_visible_text(row)
    _sanitize_ints(row)
    _ensure_capture(row)
    _reject_placeholder_location(row, table="aqar_commercial_listings")
    _execute(sb().table("aqar_commercial_listings").upsert(row, on_conflict="ad_number"), what="aqar_commercial_listings")


def upsert_wasalt_residential(row: dict[str, Any]) -> None:
    """Upsert one Wasalt residential row into its OWN table (separate source), keyed on `ad_number`
    (Wasalt ids are namespaced 'WST<id>' so they never collide with Aqar)."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _unknown_must_not_overwrite_known(row)
    _redact_user_visible_text(row)
    _sanitize_ints(row)
    _ensure_capture(row)
    _reject_placeholder_location(row, table="wasalt_residential_listings")
    _execute(sb().table("wasalt_residential_listings").upsert(row, on_conflict="ad_number"), what="wasalt_residential_listings")


# Numeric columns by Postgres integer width. A parse glitch that overflows one of these (e.g. a bad
# price_per_meter of 90,533,352,829) used to make the WHOLE batch upsert fail with 22003, dropping
# every row in it. We null the offending FIELD instead of losing the batch — the listing still saves.
_INT2_COLS = frozenset({"bedrooms", "bathrooms", "master_bedrooms", "halls",
                        "reception_rooms_majlis", "property_age", "street_width_m"})
_INT4_COLS = frozenset({"area_m2", "interior_space_m2", "outdoor_area_m2", "price_per_meter",
                        "rent_now_pay_later_monthly", "missing_count"})
_INT8_COLS = frozenset({"price_annual", "price_total"})


def _sanitize_ints(r: dict[str, Any]) -> None:
    """Coerce/NULL integer fields so ONE bad value can never abort the row (or its whole batch).

    Three failure modes protected:
      • overflow (22003): value doesn't fit the column width → NULL that field.
      • negative (23514, Batch 5 2026-07-16): every column here is a count/area/price, so a
        negative is impossible-by-definition garbage (sign-flip/parse artifact). The *_listings
        tables now carry `>= 0 OR NULL` CHECK constraints (20260716_batch5_integrity_checks.sql);
        NULLing the field here keeps one bad value from failing its whole upsert batch, exactly
        like the overflow path. Zero stays legal — 0 is a known faithful placeholder (price
        fidelity rule; the 2026-07-15 repair clearance kept sub-3000-SAR placeholders as-is).
      • bad cast (22P02): a NON-NUMERIC value in an integer column. Real incident 2026-07-06:
        Wasalt commercial sends property_age="New" (a string) — Postgres rejected the smallint
        cast, the WHOLE upsert failed with HTTP 400, and every listing in that batch was silently
        dropped on every 8h sweep. Numeric strings ("5", "5.0") are coerced to int; anything
        non-numeric → NULL. Only the numeric FILTER column is nulled — the raw source value stays
        preserved in additional_info / source_capture, so the card still shows exactly what the
        source published (search-engine-not-marketplace rule).
    """
    for col, _lo, hi in ((_INT2_COLS, -32768, 32767),
                         (_INT4_COLS, -2147483648, 2147483647),
                         (_INT8_COLS, -9223372036854775808, 9223372036854775807)):
        for c in col:
            v = r.get(c)
            if v is None:
                continue
            if isinstance(v, bool):
                r[c] = None          # bool is an int subclass in Python; never a real count/price
                continue
            if isinstance(v, str):
                try:
                    v = int(float(v.strip()))
                except (ValueError, OverflowError):
                    r[c] = None      # "New", "غير محدد", "" … → honest NULL, listing still saves
                    continue
                r[c] = v
            elif isinstance(v, float):
                try:
                    v = int(v)
                except (ValueError, OverflowError):  # nan / inf
                    r[c] = None
                    continue
                r[c] = v
            elif not isinstance(v, int):
                r[c] = None          # lists/dicts/other junk can't cast either
                continue
            if isinstance(v, int) and not (0 <= v <= hi):
                r[c] = None  # overflow OR negative — both impossible for a count/area/price


# Free-text columns that can carry a contact detail. PDPL: a broker's phone number, WhatsApp handle
# or e-mail must never survive into any of them, on any platform.
#
# THIS LIST WAS ONCE ("description", "title") AND THAT WAS THE BUG. A compliance audit on 2026-08-10
# found 78 live broker mobiles sitting in `street_name` — publicly readable through the anon key —
# plus 4 in `residence_type`, because advertisers type «...لتواصل: 05XXXXXXXX» into whatever box the
# source gives them. Guarding the two columns we happened to think of is not a barrier. Any free-text
# column a scraper writes belongs here; when in doubt, add it — redaction leaves non-contact text
# byte-identical, so the cost of over-listing is zero and the cost of under-listing is a live leak.
_USER_VISIBLE_TEXT_COLS = (
    "description", "title", "street_name", "residence_type", "project_name",
    "neighborhood", "address_text", "payment_terms", "tenant_category",
)


def _redact_user_visible_text(r: dict[str, Any]) -> None:
    """PDPL redaction on the columns the app actually displays — every platform, every upsert path.

    THE BUG THIS CLOSES (2026-08-09): `redact_pii()` was applied to `source_capture.source_text` and
    to NOTHING ELSE. The `description` column — the one users read — was written raw. A one-off
    UPDATE cleaned 9,785 descriptions earlier the same day and was reported as fixed; it was not,
    because ingestion kept writing new ones. Within hours aqar was back to 1,895 descriptions
    carrying Saudi mobile numbers, 684 carrying WhatsApp/Telegram links and 194 carrying e-mail
    addresses — several alongside the agent's name («حسام : 05XXXXXXXX»), which is unambiguously
    personal data. Repairing rows without closing the write path is not a fix, it is a delay.

    Placed AFTER `_unknown_must_not_overwrite_known` on purpose: if a description consists of
    nothing BUT contact details, `redact_pii` returns None and we deliberately write NULL over the
    stored value. PDPL beats preservation — that is the one case where erasing is the correct
    outcome, and it cannot be reached by a fetch that simply failed to read the field (a missing
    key never gets here, it was dropped by the no-clobber guard above).
    """
    for col in _USER_VISIBLE_TEXT_COLS:
        # is_free_text() gate, same as the capture barrier: NEVER run the contact patterns over a
        # value that is a bare number or a URL. `0?5\d{8}` means "nine digits starting with 5",
        # which a price per m2 (512345678), a postal code or a plot number can satisfy — redacting
        # those would destroy source facts to fix nothing, since nobody is reachable through them.
        if is_free_text(r.get(col)):
            r[col] = redact_pii(r[col])


def _sanitize_price(r: dict[str, Any]) -> None:
    """Extreme-price rule (owner, 2026-07-30 — extreme-price verify-then-preserve): a source-published
    price is NEVER grounds to hide a listing. Unrealistic ≠ invalid; the source displays that number
    too, so we store it EXACTLY and the row stays active. This function used to set active=False for
    total > 1B / per-meter > 300k / annual > 100M — that clause force-killed source-verified-live
    listings on every upsert path (it re-killed 9 InStock dealapp rows on 2026-08-03, 90 minutes after
    the guarded recovery job had restored them) and survived PR#277, which removed the same hide only
    from dealapp/run.py. Detection stays: the DB-side monitors (mon_buy_token_price,
    mon_detect_field_integrity, mon_detect_unverified_inactivation) watch price bands without touching
    listing state. Kept as an intentional no-op so every upsert path documents the rule."""
    return


_PRICE_COLS = ("price_annual", "price_total", "price_per_meter")

# Columns a writer must always be able to set, including to NULL/False. These are CONTROL state —
# liveness, bookkeeping, capture provenance — not values read off the source page. Excluding them is
# what keeps prune/reactivate/kill paths working while listing DATA is protected.
_CONTROL_COLS = frozenset({
    "active", "missing_count", "deactivated_at", "last_seen_at", "scraped_at", "raw_captured_at",
    "source_capture", "raw_html_key", "image_storage_keys", "fullparse_done", "id", "ad_number",
    "listing_url", "source_platform", "source_id", "degraded", "run_id",
})


def _unknown_must_not_overwrite_known(r: dict[str, Any]) -> None:
    """SOURCE IS TRUTH — a field this fetch could not read must not erase what a previous fetch did.

    Owner rule, 2026-08-09, fleet-wide and permanent: "If a page doesn't load or a field cannot be
    read, it must NOT overwrite previously verified data with false, zero, NO, annual, or another
    default… never overwrite a known source-backed value with a weaker or uncertain value."

    An upsert sends the WHOLE row, so any `field: None` in the payload writes NULL over the stored
    value. That silently converts "this fetch found no X" into "this listing has no X" — two
    different statements. It is not hypothetical: aqar renders «طلب تسويق» instead of a price on a
    large minority of live ads, withholds fields from anonymous fetches, and serves an app SHELL to
    clients it does not recognise; a single unlucky crawl could therefore blank a whole listing.

    Dropping the key instead of sending NULL is right in both directions: a NEW row still lands with
    the column NULL (absent means default), and an EXISTING row keeps what it had. A value only ever
    MOVES when the source publishes something to move it to.

    Control columns are exempt (`_CONTROL_COLS`) — liveness and bookkeeping must stay writable, or
    prune/reactivate/kill paths break.

    The cost is deliberate and was chosen with eyes open: a value the source has genuinely RETRACTED
    lingers until a later crawl reads a new one. Retracting on the strength of one silent fetch is
    the more dangerous error, and retirement is a job for corroborated evidence across fetches.
    """
    for col in [c for c, v in r.items() if v is None and c not in _CONTROL_COLS]:
        del r[col]


def _ensure_capture(r: dict[str, Any]) -> None:
    """Unified raw-capture guarantee (Half A of the raw-capture standard).

    Every stored row — from EVERY platform, via any upsert path — gets `raw_captured_at`
    stamped and a non-null `source_capture` (cleaned text + image count + url path).
    Scrapers that already build a richer PDPL-aware `source_capture` (aqar, wasalt, sanadak,
    aqargate, …) keep theirs; we only fill the standard keys if missing. Platforms that build
    nothing get a fallback derived from the row's own (already-cleaned) description/title,
    PII-redacted as a safety net. `raw_html_key` / `image_storage_keys` stay NULL here — those
    are written later by the gated object-storage mirror (Half B)."""
    r["raw_captured_at"] = datetime.now(timezone.utc).isoformat()
    cap = r.get("source_capture")
    photos = r.get("photo_urls") or []
    if not cap:
        text = r.get("description") or r.get("title")
        r["source_capture"] = {
            "schema": "auto.v1-fallback",
            "source_text": redact_pii(text) if text else None,
            "url_path": r.get("listing_url"),
            "image_count": len(photos),
        }
    elif isinstance(cap, dict):
        cap.setdefault("image_count", len(photos))
        cap.setdefault("url_path", r.get("listing_url"))
        cap.setdefault("schema", "unspecified")
    _fold_price_evidence(r)
    # PDPL capture barrier (owner rule 2026-08-09). The capture is PRIVATE (anon has no SELECT on
    # it), but "private" is not "allowed to accumulate contact details" — hidden PII is still PII,
    # and 614 sanadak rows proved it accumulates silently. redact_capture() scrubs FREE TEXT only:
    # coordinates, prices, lot sizes, ids, photo/QR URLs, and REGA/FAL licence numbers survive
    # byte-identical, because destroying regulatory data to fix a privacy bug is not a fix.
    if isinstance(r.get("source_capture"), (dict, list)):
        r["source_capture"] = redact_capture(r["source_capture"])


def _fold_price_evidence(r: dict[str, Any]) -> None:
    """PRICE = SOURCE invariant, layer 1 (owner rule 2026-08-04): preserve, at ingestion, the
    proof of WHAT THE SOURCE PUBLISHED, so a stored price can be corroborated later without
    re-fetching the page.

    A scraper declares its evidence by putting `price_evidence` on the row (build it with
    normalize.price_evidence()). This folds it into `source_capture["price_evidence"]` and drops
    the top-level key, which is NOT a column. Nothing else about the row changes — the evidence
    is a witness, never an input to the stored price.

    Why this matters, concretely: on 2026-08-04 wasalt's 7 ppm-as-total rows were provable in
    seconds because wasalt already captures `propertyInfo.salePrice`, while 48 aqar truncations
    needed 600+ live page fetches to prove because aqar captured no structured price at all.
    Evidence turns a forensic project into a SQL query — and it is what
    mon_detect_price_source_mismatch() reads.
    """
    ev = r.pop("price_evidence", None)
    cap = r.get("source_capture")
    if not isinstance(cap, dict):
        return
    if ev:
        cap.setdefault("price_evidence", ev)
        return
    # PROVENANCE GUARD (2026-08): a row that carries a price but NO evidence is a price we cannot
    # prove from the database — the exact state that turned DA545798/DA507447 into a live-page
    # forensic instead of a one-line SQL check. Record the coverage gap so the price is never
    # silently trusted; mon_price_source_corroboration / mon_price_evidence_coverage read this, and
    # the value is what tells an audit "re-scrape this through the evidence-emitting adapter".
    # NEVER hide, delete, or alter the price (owner: a source-published price stays, at any
    # magnitude) — this only labels provenance, and only when a price is actually present.
    if any(r.get(c) is not None for c in _PRICE_COLS):
        cap.setdefault("price_evidence",
                       {"found": None, "unverified": True, "reason": "adapter_emitted_no_evidence"})


# Location columns checked on EVERY upsert path (2026-07-10 architecture redesign — see
# docs/LOCATION_RESOLUTION.md). Scoped to columns actually present across platform tables; a
# missing key is just `.get()` → None, a no-op. Includes both the legacy English `city`/`region`
# columns AND the first-class Arabic `city_ar` column some platforms (wasalt, sanadak, aqargate,
# aldarim, alhoshan, hajer, aqarmonthly) carry alongside it.
_LOCATION_COLS = ("city", "region", "city_ar", "district_ar", "neighborhood")


def guard_location_update(fields: dict[str, Any], *, table: str, ref: str = "") -> dict[str, Any]:
    """PUBLIC — call this on any dict of column→value you're about to write directly via
    `sb().table(...).update(...)` OUTSIDE the upsert helpers below (2026-07-10 architecture
    redesign, see docs/LOCATION_RESOLUTION.md).

    CORRECTION (adversarial review, 2026-07-10): the upsert helpers' own `_reject_placeholder_location`
    is NOT actually "the one path every write goes through" — several scripts write location fields
    via a direct `.table().update()` that bypasses upsert entirely (confirmed: scrapers/wasalt/
    enrich_ar.py sets city_ar/district_ar/region_id this way on a DAILY schedule). Those call sites
    must call this function explicitly on their own update payload before executing it. A missing
    call site is a real gap, not a false alarm — if you add a new direct-write script that touches
    city/region/district_ar/neighborhood, call this on its update dict.

    Mutates and returns `fields` for convenient inline use: `c.table(t).update(guard_location_update(upd, table=t)).execute()`.
    """
    caught = [col for col in _LOCATION_COLS if is_placeholder(fields.get(col))]
    if not caught:
        return fields
    for col in caught:
        fields[col] = None
    try:
        _execute(
            sb().table("location_pipeline_alerts").insert({
                "alert_type": "placeholder_location_blocked",
                "metric": len(caught),
                "detail": f"{table}: blocked placeholder in {caught}" + (f" ({ref})" if ref else ""),
            }),
            what="location_pipeline_alerts.insert",
        )
    except Exception:
        pass  # monitoring must never break the actual upsert
    print(f"⚠ {table}: blocked placeholder location value in {caught} — nulled, not written", flush=True)
    return fields


def _reject_placeholder_location(r: dict[str, Any], *, table: str) -> None:
    """Backstop for the upsert helpers below (`_wasalt_batch` + the 3 dedicated `upsert_*`
    functions) — every row THOSE specific functions handle passes through here before the actual
    Postgres write. Thin wrapper around `guard_location_update` (one check, one place) for callers
    that already hold a full row dict rather than a partial update dict. See `guard_location_update`
    for direct-write scripts that bypass the upsert helpers entirely."""
    guard_location_update(r, table=table, ref=f"ad_number={r.get('ad_number')}")


def _wasalt_batch(table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    now = datetime.now(timezone.utc).isoformat()
    seen: dict[str, dict[str, Any]] = {}
    for r in rows:
        r = dict(r)
        r["last_seen_at"] = now
        # Seen on the source THIS crawl → reset the consecutive-miss counter (prune_unseen only
        # deactivates after `grace` consecutive misses), and reactivate it: a listing that
        # reappears in the source is live again, so undo any earlier prune. `setdefault` so a
        # scraper that deliberately flags a row inactive (e.g. dealapp's مباع/مؤجر "sold" badge)
        # still wins, and _sanitize_price below can still force a price-typo row inactive.
        r["missing_count"] = 0
        r.setdefault("active", True)
        _sanitize_price(r)
        _unknown_must_not_overwrite_known(r)
        _redact_user_visible_text(r)
        _sanitize_ints(r)
        _ensure_capture(r)
        _reject_placeholder_location(r, table=table)
        seen[r["ad_number"]] = r
    _execute(sb().table(table).upsert(list(seen.values()), on_conflict="ad_number"), what=table)


def upsert_wasalt_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Upsert a WHOLE PAGE of Wasalt residential rows in one request — ~32× fewer round-trips than
    row-by-row, the single biggest speedup for the Wasalt scrape."""
    _wasalt_batch("wasalt_residential_listings", rows)


def upsert_wasalt_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Same batched upsert pattern, into the separate Wasalt commercial table."""
    _wasalt_batch("wasalt_commercial_listings", rows)


def _ad_shard(ad_number: Optional[str], shards: int) -> Optional[int]:
    """THE shard key for a sharded crawl: `int(digits(ad_number)) % shards`.

    Defined once, here, because the crawl's enumeration and `prune_unseen`'s guard MUST agree — if
    they disagreed by even one id, a shard would visit a row it does not own (double work) or age
    out a row it never visited (false inactivation). `scripts/verify-dealapp-shard-partition.ts`
    pins that both sides call this function rather than re-deriving the arithmetic.

    Modulo is the whole safety argument: it is a total function on the id space, so every id maps
    to EXACTLY ONE shard, no id maps to two, and the union of shards 0..shards-1 is the complete
    id space. That is a property of the key, not of a schedule or a lock — it cannot drift.
    Range-splitting would not give this for free: aqar's original geometric split handed shard 0
    81% of the rows (bug B1, 2026-07-16), which is why ids are hashed here, not bucketed.

    Returns None for an ad_number with no digits, which is never a member of any shard — such a row
    is left alone by every shard rather than being silently swept into shard 0.
    """
    m = re.search(r"\d+", ad_number or "")
    if not m:
        return None
    return int(m.group()) % max(1, shards)


def prune_unseen(
    table: str,
    seen_ads,
    source: Optional[str] = None,
    *,
    grace: int = 3,
    max_prune_frac: float = 0.30,
    min_active_guard: int = 8,
    min_coverage: Optional[float] = None,
    shards: int = 1,
    shard: int = 0,
) -> int:
    """Age out active rows whose ad_number wasn't seen this crawl — CONSERVATIVELY.

    A listing is NEVER deactivated for being missing from a single crawl. Instead each
    consecutive miss bumps its `missing_count`; only once it has been missing `grace`
    crawls IN A ROW (default 3) do we flip `active = false`. Any crawl that sees the
    listing again resets the counter to 0 (done in the upsert), so a transient gap —
    pagination glitch, proxy hiccup, a page that 500'd — can never kill a live listing.

    THREE circuit breakers on top of that — a partial/failed crawl must NEVER cascade:
      • 0 ad_numbers seen but the table still has active rows → SKIP entirely (site down/blocked;
        this is what wiped Jazan Watan + East Abha when the old loop deactivated all on a timeout).
      • COLLAPSE guard: the set missing this crawl exceeds `max_prune_frac` (30%) of the active
        rows AND there are ≥ `min_active_guard` of them → SKIP entirely, bump nothing. A sudden
        30%+ disappearance is a broken crawl. (The old 85% guard let awal go 63%, dealapp 40%.)
      • PARTIAL-SCRAPE guard (coverage floor, default 0.80): only count misses when this run
        RE-SAW at least `min_coverage` of the active catalog. A flaky/rate-limited run that saw
        only part of it must not touch the rest — this is what caused the dealapp/sanadak flip-flop
        churn. Tune via PRUNE_MIN_COVERAGE. (Combined with the 3-strike counter, a listing now needs
        both good coverage AND three misses in a row before it can go inactive.)

    SHARDED CRAWLS (`shards` > 1, added 2026-08-11 for the dealapp shard fleet). A sharded run only
    ever visits its OWN slice of the catalog, so measuring coverage against the WHOLE active set
    would put every shard at ~1/shards coverage — permanently under the 0.80 floor, so the guard
    would trip on every shard and pruning could never happen at all. That is exactly the state
    dealapp was in before sharding (one capped run re-saw ~15% of 8,386 active rows, so
    `prune_unseen` returned -1 every night and nothing was ever aged out).

    When `shards` > 1 the active set is filtered to this shard's slice — `int(ad_number) % shards
    == shard`, the same deterministic key the crawl enumerates by — and every guard below then
    measures against that slice. The consequences are the safety properties that matter:
      • a shard can only ever affect ids that belong to it, so a failed or blocked shard cannot
        touch another shard's rows — no cross-shard false inactivation;
      • a 0-row shard still returns -1 and prunes nothing (the empty-seen guard is unchanged);
      • the collapse and coverage guards apply per slice, so a shard that is throttled part-way
        through still declines to prune rather than ageing out the rows it never reached.
    `shards == 1` (the default) is byte-for-byte the previous behaviour for every other caller.

    Returns the number of rows actually DEACTIVATED this run (0 when misses were only counted),
    or -1 when a circuit breaker tripped and nothing was changed, so the caller can flag the
    run degraded.
    """
    if min_coverage is None:
        min_coverage = float(os.environ.get("PRUNE_MIN_COVERAGE", "0.80"))
    c = sb()
    q = c.table(table).select("ad_number, missing_count").eq("active", True)
    if source:
        q = q.eq("source", source)
    existing = _execute(q, what=table + ".prune_select").data or []
    if shards > 1:
        existing = [r for r in existing if _ad_shard(r.get("ad_number"), shards) == shard]
    if not existing:
        return 0
    seen = set(seen_ads)
    if not seen:
        return -1  # nothing scraped → site almost certainly down → keep everything active
    gone = [r for r in existing if r["ad_number"] not in seen]
    if len(existing) >= min_active_guard:
        if len(gone) > max_prune_frac * len(existing):
            return -1  # collapse guard: a big fraction vanished at once → treat as a broken crawl
        if (len(existing) - len(gone)) / len(existing) < min_coverage:
            return -1  # partial-scrape guard: saw too little of the catalog to trust a prune
    if not gone:
        return 0
    # Consecutive-miss: group the missing rows by their CURRENT miss count so each distinct
    # increment is one batched UPDATE. Rows that reach `grace` misses in a row flip inactive;
    # everything else just ticks up (and resets to 0 the next time the upsert re-sees it).
    by_count: dict[int, list[str]] = defaultdict(list)
    for r in gone:
        by_count[int(r.get("missing_count") or 0)].append(r["ad_number"])
    killed = 0
    for m, ads in by_count.items():
        new_missing = m + 1
        payload: dict[str, Any] = {"missing_count": new_missing}
        if new_missing >= grace:
            payload["active"] = False
        for i in range(0, len(ads), 200):
            _execute(c.table(table).update(payload).in_("ad_number", ads[i:i + 200]),
                     what=table + ".prune_update")
        if new_missing >= grace:
            killed += len(ads)
    return killed


def end_run(
    run_id: int,
    *,
    ok: bool,
    rows_seen: int,
    rows_upserted: int,
    notes: Optional[str] = None,
    allow_empty: bool = False,
    floor: int = 0,
    degraded: bool = False,
    check_tables: Optional[list[str]] = None,
) -> bool:
    """Finalize a scrape_runs row. Returns the EFFECTIVE ok actually written.

    RC-B fail-visible finalization (hardening 2026-07-13). A blocked crawl, a served
    login/consent shell, a silently-changed API shape, or an exhausted proxy raises no
    exception, so a scraper finalizes ok=True with rows_seen=0 — a dead source that reads
    as perfectly healthy. That is exactly how alnokhba/souq24 stayed "green" for days while
    returning nothing. Every one of the ~34 scrapers funnels through this single call, so we
    demote a dishonest run to ok=False HERE rather than trusting each run.py tail to get it
    right:
      • rows_seen == 0 and not allow_empty         → dead / blocked source
      • floor > 0 and rows_seen < floor            → suspicious partial crawl (per-platform sanity floor)
      • degraded (e.g. prune_unseen returned -1)   → an integrity guard tripped mid-run
      • check_tables=[...] and a row this run touched fails a field-range sanity check
        (garbage price, a placeholder location, a blank critical field — "finished successfully"
        is not the same claim as "the rows it wrote are sane"; see mon_check_run_field_ranges)
    This only ever DEMOTES: an explicit ok=False from an except-block stays False; a healthy
    run stays True. The single legitimate empty run — gathern's commercial no-op — opts out
    with allow_empty=True. Batch-0 detector D1 (mon_detect_silent_scraper_death) alerts on the
    resulting ok=False, and the returned bool lets a caller `sys.exit(1)` to redden CI too.
    """
    effective_ok = bool(ok)
    demotions: list[str] = []
    if effective_ok:
        if allow_empty:
            pass  # caller asserts an empty/low run is legitimate (e.g. gathern commercial no-op)
        elif rows_seen == 0:
            effective_ok = False
            demotions.append("0-row run (blocked/empty source?)")
        elif floor > 0 and rows_seen < floor:
            effective_ok = False
            demotions.append(f"rows_seen {rows_seen} < floor {floor} (partial crawl?)")
        if check_tables:
            # Monitoring must never fail an already-committed run — the rows are written either
            # way, this only affects whether the run is HONESTLY reported as degraded.
            try:
                run_row = _execute(
                    sb().table("scrape_runs").select("platform, started_at").eq("id", run_id),
                    what="scrape_runs.select_for_check",
                ).data[0]
                for tbl in check_tables:
                    field_bad = _execute(
                        sb().rpc("mon_check_run_field_ranges", {
                            "p_run_id": run_id,
                            "p_platform": run_row["platform"],
                            "p_table": tbl,
                            "p_since": run_row["started_at"],
                            "p_placeholder_tokens": list(PLACEHOLDER_TOKENS),
                        }),
                        what="mon_check_run_field_ranges",
                    ).data
                    if field_bad:
                        degraded = True
            except Exception:
                pass
        if degraded:  # an integrity trip is never OK, even for an allow_empty run
            effective_ok = False
            demotions.append("integrity guard tripped (degraded)")
    final_notes = notes
    if demotions:
        tag = "RC-B demoted ok=False: " + "; ".join(demotions)
        final_notes = f"{notes} | {tag}" if notes else tag
    _execute(
        sb().table("scrape_runs").update(
            {
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "ok": effective_ok,
                "rows_seen": rows_seen,
                "rows_upserted": rows_upserted,
                "notes": final_notes,
            }
        ).eq("id", run_id),
        what="scrape_runs.end",
    )
    # This row is finalized: disarm the kill-handler for it so a SIGTERM arriving during the
    # process's normal shutdown can never re-write a run that already closed honestly.
    if _OPEN_RUN.get("run_id") == run_id:
        _OPEN_RUN["run_id"] = None
    return effective_ok


def upsert_aldarim_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aldarim residential rows into their own table (source='Aldarim')."""
    _wasalt_batch("aldarim_residential_listings", rows)


def upsert_aldarim_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aldarim commercial rows into their own table."""
    _wasalt_batch("aldarim_commercial_listings", rows)


# --- 2026-06 batch: Deal App, 24 Souq, Dwelleo, Era Pulse, Al Nowaisiry ---------------------
def upsert_dealapp_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("dealapp_residential_listings", rows)


def upsert_dealapp_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("dealapp_commercial_listings", rows)


def upsert_souq24_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("souq24_residential_listings", rows)


def upsert_souq24_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("souq24_commercial_listings", rows)


def upsert_erapulse_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("erapulse_residential_listings", rows)


def upsert_erapulse_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("erapulse_commercial_listings", rows)


def upsert_nowaisiry_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("nowaisiry_residential_listings", rows)


def upsert_nowaisiry_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("nowaisiry_commercial_listings", rows)


def upsert_october_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("october_residential_listings", rows)


def upsert_october_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("october_commercial_listings", rows)


# additional_info keys OWNED by the Tier-2 `--backfill-details` pass (detail-page fields the LIST
# crawl never produces). The crawl rebuilds additional_info from scratch, so a plain full-row upsert
# would drop these on every sighting — the same wipe as the description column (PR #210). Crawl keys
# and these are disjoint, so we carry them forward from the stored row before upserting.
_GATHERN_DETAIL_AI_KEYS = (
    "suitability", "house_rules", "check_in", "check_out",
    "guest_capacity", "booking_count", "views_count", "rate_text", "extra_sections",
)


def _carry_forward_ai(rows: list[dict[str, Any]], stored: dict[str, dict], keys) -> None:
    """PURE: copy `keys` from stored[ad_number] into each row's additional_info WITHOUT overwriting
    what the crawl produced (fresh crawl values stay authoritative). Mutates rows in place."""
    for r in rows:
        old = stored.get(r.get("ad_number"))
        if not isinstance(old, dict):
            continue
        carry = {k: old[k] for k in keys if k in old}
        if not carry:
            continue
        info = r.get("additional_info")
        info = dict(info) if isinstance(info, dict) else {}
        r["additional_info"] = {**carry, **info}  # crawl values win on any (disjoint) overlap


def _preserve_gathern_detail_ai(table: str, rows: list[dict[str, Any]]) -> None:
    """Read-modify-write: fetch the stored additional_info for these ad_numbers and carry the
    backfill-owned detail keys forward, so the crawl's fresh blob doesn't wipe them.
    ponytail: small race vs a concurrent backfill write; fine — crawl and backfill are separate
    scheduled jobs and backfill only touches desc-NULL rows. Upgrade to a Postgres `||` upsert RPC
    if they ever run together."""
    ads = [r["ad_number"] for r in rows if r.get("ad_number")]
    if not ads:
        return
    stored: dict[str, dict] = {}
    for i in range(0, len(ads), 200):
        res = _execute(sb().table(table).select("ad_number, additional_info").in_("ad_number", ads[i:i + 200]),
                       what=table + ".ai_preserve_select")
        for row in (res.data or []):
            ai = row.get("additional_info")
            if isinstance(ai, dict):
                stored[row["ad_number"]] = ai
    _carry_forward_ai(rows, stored, _GATHERN_DETAIL_AI_KEYS)


def upsert_gathern_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Gathern (gathern.co) MONTHLY furnished residential units only (source='Gathern').

    Carries the Tier-2 detail fields forward first (see _preserve_gathern_detail_ai) so the crawl's
    full-row upsert doesn't wipe additional_info — same class of bug as the description wipe (PR #210)."""
    _preserve_gathern_detail_ai("gathern_residential_listings", rows)
    _wasalt_batch("gathern_residential_listings", rows)


def upsert_gathern_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("gathern_commercial_listings", rows)


def upsert_aqarmonthly_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Aqar DailyRenting MONTHLY furnished short-stay units only (source='Aqar Monthly')."""
    _wasalt_batch("aqarmonthly_residential_listings", rows)


def upsert_deal_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Deal (dealapp.sa) residential rows into their own table (source='Deal')."""
    _wasalt_batch("deal_residential_listings", rows)


def upsert_deal_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Deal commercial rows into their own table."""
    _wasalt_batch("deal_commercial_listings", rows)


def upsert_aqargate_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqargate (aqargate.com) residential rows into their own table (source='Aqargate')."""
    _wasalt_batch("aqargate_residential_listings", rows)


def upsert_aqargate_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqargate commercial rows into their own table."""
    _wasalt_batch("aqargate_commercial_listings", rows)


def upsert_alhoshan_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Hoshan (alhoshan.sa) residential rows into their own table (source='Alhoshan')."""
    _wasalt_batch("alhoshan_residential_listings", rows)


def upsert_alhoshan_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Hoshan commercial rows into their own table."""
    _wasalt_batch("alhoshan_commercial_listings", rows)


def upsert_hajer_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Hajer Houses (hajerhouses.com) residential rows (source='Hajer')."""
    _wasalt_batch("hajer_residential_listings", rows)


def upsert_hajer_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Hajer Houses commercial rows into their own table."""
    _wasalt_batch("hajer_commercial_listings", rows)


def upsert_sanadak_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sanadak (sanadak.sa) residential rows (source='Sanadak')."""
    _wasalt_batch("sanadak_residential_listings", rows)


def upsert_sanadak_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sanadak commercial rows into their own table."""
    _wasalt_batch("sanadak_commercial_listings", rows)


def upsert_eastabha_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert East Abha (eastabha.sa) residential rows (source='Eastabha')."""
    _wasalt_batch("eastabha_residential_listings", rows)


def upsert_eastabha_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert East Abha commercial rows into their own table."""
    _wasalt_batch("eastabha_commercial_listings", rows)


def upsert_aqarcity_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqar City (aqarcity.net) residential rows (source='Aqarcity')."""
    _wasalt_batch("aqarcity_residential_listings", rows)


def upsert_aqarcity_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqar City commercial rows into their own table."""
    _wasalt_batch("aqarcity_commercial_listings", rows)


def upsert_raghdan_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Raghdan (raghdan.sa) residential rows (source='Raghdan')."""
    _wasalt_batch("raghdan_residential_listings", rows)


def upsert_raghdan_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Raghdan commercial rows into their own table."""
    _wasalt_batch("raghdan_commercial_listings", rows)


def upsert_eaqartabuk_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Eaqar Tabuk (eaqartabuk.com) residential rows (source='Eaqartabuk')."""
    _wasalt_batch("eaqartabuk_residential_listings", rows)


def upsert_eaqartabuk_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Eaqar Tabuk commercial rows into their own table."""
    _wasalt_batch("eaqartabuk_commercial_listings", rows)


def upsert_satel_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Satel (satel.sa) residential rows (source='Satel')."""
    _wasalt_batch("satel_residential_listings", rows)


def upsert_satel_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Satel commercial rows into their own table."""
    _wasalt_batch("satel_commercial_listings", rows)


def upsert_sadin_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sadin (sadin.com.sa) residential rows (source='Sadin')."""
    _wasalt_batch("sadin_residential_listings", rows)


def upsert_sadin_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sadin commercial rows into their own table."""
    _wasalt_batch("sadin_commercial_listings", rows)


def upsert_toor_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Toor (toor.ooo) residential rows (source='Toor')."""
    _wasalt_batch("toor_residential_listings", rows)


def upsert_toor_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Toor commercial rows into their own table."""
    _wasalt_batch("toor_commercial_listings", rows)


def upsert_mustqr_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mustqr (mustqr.sa) residential rows (source='Mustqr')."""
    _wasalt_batch("mustqr_residential_listings", rows)


def upsert_mustqr_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mustqr commercial rows into their own table."""
    _wasalt_batch("mustqr_commercial_listings", rows)


def upsert_ramzalqasim_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Ramz Al-Qassim (ramzalqasim.com) residential rows (source='Ramzalqasim')."""
    _wasalt_batch("ramzalqasim_residential_listings", rows)


def upsert_ramzalqasim_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Ramz Al-Qassim commercial rows into their own table."""
    _wasalt_batch("ramzalqasim_commercial_listings", rows)


def upsert_fursaghyr_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Fursa Ghyr (fursaghyr.com) residential rows (source='Fursaghyr')."""
    _wasalt_batch("fursaghyr_residential_listings", rows)


def upsert_fursaghyr_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Fursa Ghyr commercial rows into their own table."""
    _wasalt_batch("fursaghyr_commercial_listings", rows)


def upsert_jazwtn_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Jazwtn (jazwtn.sa) residential rows (source='Jazwtn')."""
    _wasalt_batch("jazwtn_residential_listings", rows)


def upsert_jazwtn_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Jazwtn commercial rows into their own table."""
    _wasalt_batch("jazwtn_commercial_listings", rows)


def upsert_mizlaj_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mizlaj (mizlaj.com.sa) residential rows (source='Mizlaj')."""
    _wasalt_batch("mizlaj_residential_listings", rows)


def upsert_mizlaj_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mizlaj commercial rows into their own table."""
    _wasalt_batch("mizlaj_commercial_listings", rows)


def upsert_muktamel_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Muktamel (muktamel.com) residential rows (source='Muktamel')."""
    _wasalt_batch("muktamel_residential_listings", rows)


def upsert_muktamel_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Muktamel commercial rows into their own table."""
    _wasalt_batch("muktamel_commercial_listings", rows)


# ── Batch 7: Semsar, Aqaratikom (Nawait), Awal, Al Khaas, Abeea, Jurash, Al Nokhba ──────────────
def upsert_aqaratikom_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqaratikom / Nawait (aqaratikom.com → nawait.sa) residential (source='Aqaratikom')."""
    _wasalt_batch("aqaratikom_residential_listings", rows)


def upsert_aqaratikom_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("aqaratikom_commercial_listings", rows)


def upsert_awal_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Awal (awaalun.com) residential rows (source='Awal')."""
    _wasalt_batch("awal_residential_listings", rows)


def upsert_awal_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("awal_commercial_listings", rows)


def upsert_alkhaas_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Khaas (alkhaas.net) residential rows (source='Al Khaas')."""
    _wasalt_batch("alkhaas_residential_listings", rows)


def upsert_alkhaas_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("alkhaas_commercial_listings", rows)


def upsert_abeea_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Abeea (abeea.com.sa) residential rows (source='Abeea')."""
    _wasalt_batch("abeea_residential_listings", rows)


def upsert_abeea_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("abeea_commercial_listings", rows)


def upsert_jurash_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Jurash (jurash.sa) residential rows (source='Jurash')."""
    _wasalt_batch("jurash_residential_listings", rows)


def upsert_jurash_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("jurash_commercial_listings", rows)


def upsert_alnokhba_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Nokhba (alnokhba-services.com) residential rows (source='Al Nokhba')."""
    _wasalt_batch("alnokhba_residential_listings", rows)


def upsert_alnokhba_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("alnokhba_commercial_listings", rows)
