"""Aqar liveness sweep — detect dead listings and mark them inactive.

For every row in `aqar_residential_listings` where active=true, this fetches the listing
URL on Aqar.sa and decides what to do:

  - Confirmed dead (404, 410, or HTML body says "ad removed / not available") →
    increment `missing_count`. Once it hits the grace threshold (default 3 consecutive
    sweeps), flip `active = false`. The row stays in the DB (we keep historical
    listings) — the app filter (`active=true`) just hides it.
  - Alive (200 OK with content) → reset `missing_count` to 0 and refresh
    `last_seen_at`.
  - Transient failure (timeout, 5xx, no response) → leave the row untouched. We
    NEVER kill a listing because of a single network hiccup.

The grace period is what keeps us correct even when Aqar's site has a brief outage,
their pagination glitches, or a single curl request randomly times out: a real removed
listing fails THREE runs in a row; a temporary blip recovers on the next run.

Designed to be cron-driven from the VPS — once a day at 04:00 KSA time.

Run it locally for testing:
  python -m scrapers.aqar.liveness --limit 50

On the server:
  0 1 * * *  cd /srv/ezhalah && .venv/bin/python -m scrapers.aqar.liveness
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from scrapers.common.db import begin_run, end_run, sb
from scrapers.common.http import get
from scrapers.common.liveness_contract import direct_alive_patch


# Phrases Aqar puts on a removed/expired listing page (both languages).
DEAD_MARKERS = (
    "تم حذف الإعلان",
    "الإعلان غير متوفر",
    "الإعلان غير نشط",
    "الإعلان منتهي",
    "Ad has been removed",
    "Ad not available",
    "Listing not available",
    "Listing has been removed",
)


def _run_with_retry(fn, tries: int = 5):
    """Run a DB call, retrying on Postgres statement-timeout (57014) — these come from transient
    lock contention when the 4h sweep is mid-upsert on the same table. Back off and try again."""
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if "57014" in str(e) and i < tries - 1:
                time.sleep(2.0 * (i + 1))
                continue
            raise


def shard_row_window(total_rows: int, shards: int, shard: int) -> tuple[int, int]:
    """This shard's window [start, end) of ROW OFFSETS into the active rows ordered by id — a
    COUNT-balanced split (fix 2026-07-16, bug B1).

    History: the split used to be geometric over the ID RANGE (bucket = (max_id-min_id)//shards+1,
    anchored at min_id since the morning fix for high-start tables). But aqar ids are dense at the
    low end and sparse above: on 2026-07-16 shard 0's geometric window [1, ~193k) held 70,427 of
    the 86,464 active aqar_residential rows (81%) — a ~16h sweep against the workflow's
    timeout-minutes: 120, so shard 0 was SIGKILLed every day (live proof: run 13176 started 01:00,
    finished_at NULL, rows_seen 0) and those ~70k rows were never liveness-checked — the 44.6%
    stale-active backlog. Splitting by ROW COUNT instead gives every shard ~total/shards rows
    (~5.4k at 16 shards, ~60-80 min at the observed 1.2-3 rows/s) regardless of how ids cluster.

    floor(shard*N/S) arithmetic ⇒ windows are contiguous, disjoint, jointly cover [0, N), and any
    two shards' row counts differ by at most 1. A shard's window is empty only when N < S (fewer
    active rows than shards) — for these tables that means the source is effectively dead, and the
    empty shard's 0-row run is honestly demoted by end_run's RC-B rule, same as before.
    """
    shards = max(1, shards)
    total_rows = max(0, total_rows)
    start = (shard * total_rows) // shards
    end = ((shard + 1) * total_rows) // shards
    return start, end


def shard_id_window(
    id_at: Callable[[int], Optional[int]],
    total_rows: int,
    shards: int,
    shard: int,
) -> Optional[tuple[int, Optional[int]]]:
    """Translate this shard's row-offset window into a keyset ID window [lo, hi).

    `id_at(offset)` returns the id of the offset-th active row ordered by id ascending (None if
    the active set shrank below that offset since `total_rows` was counted — concurrent shards
    deactivate rows while we compute). Returns None when this shard owns no rows; hi is None for
    the tail shard = sweep unbounded to the top of the table.

    Boundary tolerance (documented, deliberate): each parallel shard counts + probes at its OWN
    start time, so if rows are deactivated in between, adjacent windows can gap/overlap by a few
    rows. An overlap double-checks a row (idempotent — same alive/dead verdict); a gap skips a row
    for ONE daily run, and the grace=3 consecutive-miss rule means a skip can never kill or revive
    anything by itself. Exact partition of a moving set isn't achievable without a lock and isn't
    needed here.
    """
    start, end = shard_row_window(total_rows, shards, shard)
    if start >= end:
        return None
    lo = id_at(start)
    if lo is None:  # active set shrank below our window's start — nothing left for this shard
        return None
    hi = id_at(end) if end < total_rows else None  # None ⇒ unbounded tail
    return lo, hi


# A begin_run() stub whose process was SIGKILLed (the exact fate of shard 0 above: GitHub Actions
# timeout-minutes kills the job, end_run never runs) sits finished_at=NULL/ok=NULL forever —
# invisible to the failure detectors, which key on ok=false. Must comfortably exceed the workflow
# timeout (120 min) so a live concurrent run can never be finalized out from under itself.
ORPHAN_STUB_HOURS = 6


def reconcile_orphaned_stubs(client, platform: str, *, older_than_hours: int = ORPHAN_STUB_HOURS) -> int:
    """Finalize THIS platform-string's abandoned scrape_runs stubs as ok=false (fix 2026-07-16).

    Scoped to our exact platform string ('aqar_liveness:<table>:<shard>/<shards>') so parallel
    shards never race each other, and to stubs older than `older_than_hours` so a legitimately
    running sweep (bounded by the 120-min workflow timeout) is never touched. rows_seen is left
    as-is — the killed process's true progress is unknown, and inventing a number would be worse
    than the honest stub value.
    """
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=older_than_hours)).isoformat()
    res = _run_with_retry(
        lambda: client.table("scrape_runs")
        .update({
            "finished_at": now.isoformat(),
            "ok": False,
            "notes": "orphaned — presumed timeout-killed; finalized by the next run's "
                     "startup reconciliation",
        })
        .eq("platform", platform)
        .is_("finished_at", "null")
        .lt("started_at", cutoff)
        .execute()
    )
    n = len(res.data or [])
    if n:
        print(f"reconciled {n} orphaned run stub(s) for {platform} → ok=false", flush=True)
    return n


def looks_closed(body: str) -> bool:
    """True iff this 200-OK page is aqar's SOFT-CLOSED state (2026-08-04).

    Aqar does not 404 a closed ad. It serves HTTP 200 with the price slot replaced by a red
    «مغلق» badge, and strips the `offers` node out of the RealEstateListing JSON-LD. None of the
    DEAD_MARKERS phrases appear, so looks_dead() fell through to the alive branch — which refreshes
    last_seen_at AND resets missing_count, so these rows could never reach the 3-strike threshold.
    A 115-page live sample (2026-08-04) found 17 closed / 21 unpublished / 77 live, i.e. ~14.8% of
    the active population was being reported as healthy forever.

    TWO-FACTOR ON PURPOSE. The bare word «مغلق» also appears in LIVE listings' own descriptions
    («مطبخ مغلق» = closed kitchen, «مجمع سكني مغلق» = gated compound) — 7 of the 77 live pages in
    that sample. Requiring BOTH the badge markup AND the missing offers node means a false kill
    needs two independent signals to drift at once. Badge-alone was 0/77 live and 17/17 closed.

    «طلب تسويق» (marketing-request) pages are deliberately NOT treated as closed: the ad exists,
    the owner simply publishes no price. Those stay active with an honest «السعر عند الطلب».
    """
    if "مغلق" not in body:
        return False
    # Factor 1: the badge, not the word — the description text never carries this markup.
    badge = re.search(r"(?:badge|chip|tag|status)[^<>]{0,80}مغلق|مغلق[^<>]{0,40}</(?:span|div|p)>", body)
    if not badge:
        return False
    # Factor 2: a live ad always publishes an offers node; a closed one has none.
    has_offer = '"offers"' in body or '"price"' in body
    return not has_offer


_LD_PRICE_RE = re.compile(r'"price"\s*:\s*"?(\d+(?:\.\d+)?)"?')

# Cap price writes per sweep. The first run after this lands could touch tens of thousands of
# rows (43,112 aqar rows had never been re-read since capture); a bounded trickle keeps a sweep
# from turning into a mass-write, and the remainder is simply picked up by the next day's run.
PRICE_REFRESH_CAP = int(os.environ.get("AQAR_LIVENESS_PRICE_CAP", "500"))


def price_from_body(body: str) -> Optional[int]:
    """The listing's CURRENTLY PUBLISHED price, read from its JSON-LD offer.

    PRICE = SOURCE (owner invariant 2026-08-04): this is a COPY of what the source publishes —
    never a computation. The JSON-LD `offers.price` was verified against the visible price badge
    on 150+ live aqar pages during the 2026-08-04 repair (they agreed on every page where both
    were present), which is why it is trusted as the refresh signal here.

    Returns None when the page publishes no price (closed ad, «طلب تسويق», or a render we don't
    recognise) — and the caller then leaves the stored value ALONE rather than nulling it, so a
    single odd render can never wipe a good price.

    CAVEAT (2026-08-11, still open): `_LD_PRICE_RE` is a bare `"price":N` search over the whole
    body, not scoped to the JSON-LD `<script type="application/ld+json">` block or a specific
    Offer — so it returns whichever `"price"` key appears FIRST in the page, same failure shape
    as the SQL-side `aqar_parse()` "first currency-marked number wins" bug this refresh was meant
    to help fix. `is_price_refresh_artifact()` below is a stopgap that catches the two classes
    already proven live (see its docstring); it does not prove the regex itself is correctly
    scoped, which needs a live page fetch this environment could not make (aqar returned 403 to a
    direct fetch attempt) to confirm.
    """
    m = _LD_PRICE_RE.search(body)
    if not m:
        return None
    try:
        v = int(round(float(m.group(1))))
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def is_price_refresh_artifact(new_price: int, area_m2, price_per_meter) -> bool:
    """True when `new_price` matches the two proven-live price-refresh artifact classes and
    should be REJECTED rather than written.

    Evidence (P1 alerts `aqar_ppm_as_total` + `price_eq_area_or_ppm`, 2026-08-11): the liveness
    price refresh (owner-approved 2026-08-04, above) re-corrupted 5 already-repaired rows
    (7026223, 7032586, 1015536, 1017694, 1019212) during the 01:00 UTC sweep on 2026-08-11 —
    `scrape_runs` shows `price_updated` writes from exactly that sweep window landing on ids the
    SQL-side `aqar_parse()` guard (migrations 20260810122200 / 20260810202219) had already fixed.
    Root cause: `price_from_body()` takes the first `"price":N` in the page regardless of what it
    labels (a per-meter rate chip or a financing-teaser figure can precede the real total), the
    exact same "first number wins" shape as the already-documented SQL bug.

    This mirrors `mon_detect_price_eq_area_or_ppm()`'s exact predicate (price == area or price ==
    price_per_meter) applied to the value THIS refresh is about to write, so a corrupt refresh is
    rejected before it reaches the table instead of being caught by the detector after the fact.
    Not a full fix (see the CAVEAT on `price_from_body`) — a source-real coincidence (e.g. id
    132677, allowlisted in `ops_price_eq_area_verified`) would also be skipped here, which only
    means that one row's refresh is deferred to the next sweep after a human/detector clears it,
    never that a wrong price gets written.
    """
    if area_m2 is not None and new_price == area_m2:
        return True
    if price_per_meter is not None and new_price == price_per_meter:
        return True
    return False


def looks_dead(status: int, body: str) -> bool:
    """True iff the response confirms this listing is gone (vs a transient hiccup)."""
    if status in (404, 410):
        return True
    if status != 200:
        # Anything else (timeouts, 5xx, redirects we didn't follow) is treated as transient.
        return False
    for marker in DEAD_MARKERS:
        if marker in body:
            return True
    return looks_closed(body)


def main() -> None:
    ap = argparse.ArgumentParser(description="Aqar liveness sweep")
    ap.add_argument("--limit", type=int, default=0,
                    help="Stop after checking N rows (0 = all active rows). Useful for testing.")
    ap.add_argument("--grace", type=int, default=3,
                    help="Consecutive sweeps a listing must be missing before we kill it.")
    ap.add_argument("--table", default="aqar_residential_listings",
                    choices=["aqar_residential_listings", "aqar_commercial_listings",
                             "wasalt_residential_listings", "wasalt_commercial_listings"],
                    help="Which listings table to sweep. Run once per table to cover both verticals.")
    ap.add_argument("--shards", type=int, default=1,
                    help="Split the active rows into this many ROW-COUNT-balanced buckets so the "
                         "sweep can run as N parallel jobs (each its own IP + throttle). Balanced "
                         "by count — not by id range — because ids cluster: a geometric split gave "
                         "shard 0 81%% of aqar_residential and it was timeout-killed daily.")
    ap.add_argument("--shard", type=int, default=0,
                    help="Which 0-indexed bucket THIS job handles (0 .. shards-1).")
    args = ap.parse_args()

    table = args.table
    platform = f"aqar_liveness:{table}:{args.shard}/{args.shards}"
    client = sb()
    # Before opening our own run row: finalize any stub WE left behind on a previous day —
    # a timeout-killed job never reaches end_run, so its ok=NULL stub would sit silent forever.
    reconcile_orphaned_stubs(client, platform)
    run_id = begin_run(platform)
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Row-count-balanced shard window (fix 2026-07-16, bug B1 — see shard_row_window) ─────────
    # One count + at most two single-row offset probes. The probes run on the same
    # (active, id) access path the keyset loop below uses — live-verified as an Index Only Scan
    # on idx_aqar_active_id, ~40 ms at the worst-case mid-table offset.
    count_res = _run_with_retry(
        lambda: client.table(table).select("id", count="exact").eq("active", True).limit(1).execute())
    total_rows = int(count_res.count or 0)

    def _id_at(offset: int) -> Optional[int]:
        res = _run_with_retry(
            lambda: client.table(table).select("id").eq("active", True)
            .order("id", desc=False).range(offset, offset).execute())
        return int(res.data[0]["id"]) if res.data else None

    window = shard_id_window(_id_at, total_rows, args.shards, args.shard)
    if window is None:
        lo, hi = 0, 0  # empty shard (total_rows < shards): sweep nothing, finalize honestly below
    else:
        lo, hi = window
    row_lo, row_hi = shard_row_window(total_rows, args.shards, args.shard)
    print(f"shard {args.shard}/{args.shards} → rows [{row_lo}, {row_hi}) of {total_rows} active "
          f"→ id window [{lo}, {'∞' if hi is None else hi})", flush=True)

    seen = 0
    killed = 0
    refreshed = 0
    transient = 0
    pending_kill = 0  # missing this run but not yet past grace
    alive_ids: list[int] = []  # batched "still alive" ids → one UPDATE per 200 (see flush below)

    # PER-ROW AUDIT TRAIL (2026-08-31). Buffered like alive_ids: one insert per 200 readings rather
    # than a round-trip per probe. Failure to log must never abort a sweep or change a verdict —
    # the audit is a record OF the decision, never part of making it.
    detail_buf: list[dict] = []

    def _flush_detail() -> None:
        if not detail_buf:
            return
        batch, detail_buf[:] = list(detail_buf), []
        try:
            client.table("aqar_liveness_detail").insert(batch).execute()
        except Exception as exc:  # noqa: BLE001
            print(f"⚠ liveness detail insert failed (non-fatal, {len(batch)} rows): "
                  f"{str(exc)[:160]}", flush=True)

    def _detail(listing_id: int, http_status, verdict: str, mc_before: int, mc_after: int) -> None:
        detail_buf.append({
            "source_table": table, "listing_id": listing_id, "http_status": http_status,
            "verdict": verdict, "missing_count_before": mc_before,
            # This runner has no dry-run mode — it always writes — so the reading recorded here is
            # always the reading that was acted on. The column exists to match gathern's log shape,
            # where a dry run is possible.
            "missing_count_after": mc_after, "applied": True,
        })
        if len(detail_buf) >= 200:
            _flush_detail()
    price_updated = 0   # prices re-read from the page we already fetched (owner-approved 2026-08-04)
    price_capped = 0    # changes seen past PRICE_REFRESH_CAP — next sweep picks them up
    price_artifact_rejected = 0  # refresh matched a proven artifact class (P1 2026-08-11) — skipped
    # aqar only: aqar's JSON-LD offers.price is the published sale price. wasalt rows are swept by
    # this same script but their price comes from the wasalt API payload, so JSON-LD is not their
    # source of truth and must not overwrite it.
    price_refresh_on = table.startswith("aqar_")
    started = time.time()

    try:
        # Pull active rows in pages of 1000 via KEYSET pagination (walk forward by id) — NOT offset.
        # Offset pagination on a 77k+ row table re-scans and skips `offset` rows every page, getting
        # slower the deeper it goes until it hits the DB statement timeout (error 57014). Keyset is
        # O(page_size) per page regardless of depth, AND it's more correct here: the sweep flips rows
        # to active=false as it runs, which would shift an offset window and skip rows — a forward id
        # cursor never does. (fix: liveness statement-timeout failure as the table grew.)
        page_size = 1000
        last_id = lo - 1  # start the cursor at the bottom of this shard's ID window
        while window is not None:
            q = (
                client.table(table)
                .select("id, ad_number, listing_url, missing_count, transaction_type, price_total,"
                        " area_m2, price_per_meter")
                .eq("active", True)
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(page_size)
            )
            if hi is not None:
                q = q.lt("id", hi)  # stay within this shard's window (tail shard is unbounded)
            res = q.execute()
            rows = res.data or []
            if not rows:
                break

            for row in rows:
                last_id = row["id"]  # advance the cursor (rows are id-ascending)
                seen += 1
                url = (row.get("listing_url") or "").strip()
                if not url:
                    continue  # no URL → can't check, skip

                r = get(url, max_retries=2)
                status = r.status_code if r is not None else 0
                body = r.text if r is not None else ""

                if r is not None and looks_dead(status, body):
                    mc_before = row.get("missing_count") or 0
                    new_missing = mc_before + 1
                    upd: dict = {"missing_count": new_missing}
                    if new_missing >= args.grace:
                        upd["active"] = False
                        killed += 1
                    else:
                        pending_kill += 1
                    _run_with_retry(lambda u=upd, i=row["id"]:
                                    client.table(table).update(u).eq("id", i).execute())
                    # AUDIT. On 2026-08-30 aqar deactivated 13,139 rows and nothing recorded which
                    # ones, or what the source returned for each. Aggregate counts in the run notes
                    # cannot answer "why was THIS listing removed" -- so record it here, per row.
                    _detail(row["id"], status, "kill" if new_missing >= args.grace else "strike",
                            mc_before, new_missing)
                elif r is not None and status == 200:
                    # Alive — BATCH the refresh. Every alive row gets the same values, so collect ids
                    # and flush one `UPDATE … WHERE id IN (…)` per 200 rows instead of 84k single-row
                    # writes. Far fewer statements ⇒ far less lock-contention exposure (the per-row
                    # writes were timing out mid-sweep, error 57014). (fix: liveness 57014 failure.)
                    alive_ids.append(row["id"])
                    refreshed += 1

                    # PRICE REFRESH (owner-approved 2026-08-04). We already hold the current page
                    # — discarding it was why 43,112 aqar rows (54.5%) still carried prices from
                    # the 2026-07-01 backfill while last_seen_at reported them fresh. Re-read the
                    # published price here so freshness and price stop disagreeing.
                    # Scope is deliberately narrow: aqar BUY rows only. aqar's JSON-LD offers.price
                    # is the sale price (verified against the visible badge on 150+ pages during the
                    # 2026-08-04 repair); for rentals the same field's period is ambiguous, so those
                    # are left to the enricher, which knows سنوي/شهري. Never writes NULL over an
                    # existing price, and never writes when unchanged.
                    if price_refresh_on and (row.get("transaction_type") == "Buy"):
                        new_price = price_from_body(body)
                        old_price = row.get("price_total")
                        if (new_price is not None
                                and is_price_refresh_artifact(new_price, row.get("area_m2"),
                                                               row.get("price_per_meter"))):
                            # Proven-live artifact class (P1 2026-08-11, see is_price_refresh_
                            # artifact docstring) — reject the write, keep the old value, count it
                            # so a spike is visible in scrape_runs.notes.
                            price_artifact_rejected += 1
                            new_price = None
                        if new_price and old_price is not None and int(old_price) != new_price:
                            if price_updated < PRICE_REFRESH_CAP:
                                _run_with_retry(lambda i=row["id"], p=new_price:
                                                client.table(table)
                                                .update({"price_total": p}).eq("id", i).execute())
                                price_updated += 1
                            else:
                                price_capped += 1

                    if len(alive_ids) >= 200:
                        batch = list(alive_ids)
                        _run_with_retry(lambda ids=batch: client.table(table)
                                        .update({"last_seen_at": now_iso, "missing_count": 0,
                                                 **direct_alive_patch(now_iso=now_iso)})
                                        .in_("id", ids).execute())
                        alive_ids.clear()
                else:
                    transient += 1
                    # A read we could not believe is the one thing that must NEVER be mistaken for
                    # a death later. Recording it makes that auditable rather than assumed.
                    _detail(row["id"], status or None, "transient",
                            row.get("missing_count") or 0, row.get("missing_count") or 0)

                if seen % 50 == 0:
                    elapsed = time.time() - started
                    rate = seen / elapsed if elapsed > 0 else 0
                    print(
                        f"  [{seen}] refreshed={refreshed} killed={killed} "
                        f"pending_kill={pending_kill} transient={transient} "
                        f"({rate:.1f}/s)",
                        flush=True,
                    )

                if args.limit and seen >= args.limit:
                    raise StopIteration

    except StopIteration:
        pass
    except KeyboardInterrupt:
        print("\nInterrupted — finalizing run row.")

    _flush_detail()   # the audit must survive the run, including an interrupted one

    # Flush any remaining batched "alive" refreshes.
    if alive_ids:
        _run_with_retry(lambda ids=list(alive_ids): client.table(table)
                        .update({"last_seen_at": now_iso, "missing_count": 0,
                                 **direct_alive_patch(now_iso=now_iso)})
                        .in_("id", ids).execute())

    notes = (
        f"refreshed={refreshed} killed={killed} "
        f"pending_kill={pending_kill} transient={transient} "
        f"price_updated={price_updated} price_capped={price_capped} "
        f"price_artifact_rejected={price_artifact_rejected}"
    )
    print(f"\n✓ Liveness sweep done. scanned={seen} {notes}")
    end_run(run_id, ok=True, rows_seen=seen, rows_upserted=killed, notes=notes)


if __name__ == "__main__":
    sys.exit(main())
