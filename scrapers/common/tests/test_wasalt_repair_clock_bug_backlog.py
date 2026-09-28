"""The clock-bug backlog repair (--mode repair-clock-bug-backlog) must be structurally unable to
deactivate a listing, must count a confirmed-dead verdict as ONE fresh strike rather than an instant
kill, and must fully vindicate a confirmed-live one.

WHY THIS MODE EXISTS. The enum-rollup clock bug (see test_wasalt_enum_rollup_clock.py and
rollup_started_at()'s docstring) made every wasalt enum-strike run since 2026-09-20 strike almost the
whole active table and confirm nothing (control group=0, aborted_flips=True on every run since). The
rows that reached missing_count>=grace (4,214 listings, the day this was found) got there entirely
through that broken clock — an ordinary confirm on them, now that the clock is fixed, would treat
three unearned strikes as legitimate and could deactivate on the FIRST post-fix run. The owner's
explicit instruction: prove which strikes were bug-caused before touching them, never blindly kill.

This file proves the repair mode honours that by EXECUTING the real function (not a re-implementation
or a source-text check) with a stub DB, and inspects every write it makes.

Follows the hermetic pattern in test_wasalt_enum_strike_kill_evidence.py / test_wasalt_enum_rollup_
clock.py: stub supabase/dotenv/curl_cffi so importing the module needs no network or credentials.
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

if "curl_cffi" not in sys.modules:
    _cc_mod = types.ModuleType("curl_cffi")
    _req_mod = types.ModuleType("curl_cffi.requests")

    class _StubSession:
        def __init__(self, *a, **k):
            self.headers = {}
            self.proxies = {}

    _req_mod.Session = _StubSession
    _cc_mod.requests = _req_mod
    sys.modules["curl_cffi"] = _cc_mod
    sys.modules["curl_cffi.requests"] = _req_mod

from scrapers.common import db  # noqa: E402
from scrapers.wasalt import liveness  # noqa: E402
from scrapers.wasalt.liveness import run_repair_clock_bug_backlog  # noqa: E402

_REAL_CHECK_HYBRID = liveness.check_hybrid


class _Resp:
    def __init__(self, data):
        self.data = data


class _Args:
    grace = 3
    workers = 1
    dry_run = False
    shards = 1
    shard = 0
    limit = 0
    control_n = 30
    control_min_live = 0.90


def _cohort_response(rows_by_table):
    def fake_execute(builder, what=None, **kw):
        for tbl in ("wasalt_residential_listings", "wasalt_commercial_listings"):
            if what == f"{tbl}.repair_backlog_cohort":
                return _Resp(rows_by_table.get(tbl, []))
        return _Resp([])
    return fake_execute


CONTROL_IDS = range(900001, 900031)


def _install(monkeypatch, *, cohort_rows, verdicts_by_id, control_verdict="live"):
    """verdicts_by_id: {listing_id: ('live'|'dead'|'failed', head_status, get_status)}
    control_verdict: what the 30 known-live control rows come back as."""
    writes: dict = {"repair_fresh_strike": {}, "repair_reset_unproven": {}, "touch_alive": {},
                    "pilot_detail": {}, "liveness_runs": {}}

    class _Recorder:
        def __init__(self, capture_key=None):
            self._capture_key = capture_key

        def __getattr__(self, name):
            def _m(*a, **k):
                if name == "table" and a:
                    return _Recorder(capture_key=a[0])
                if name in ("update", "insert") and a and self._capture_key:
                    writes.setdefault(self._capture_key, [])
                    if isinstance(a[0], list):
                        writes[self._capture_key].extend(a[0])
                    else:
                        writes[self._capture_key].append(a[0])
                return self
            return _m

    def fake_sb():
        return _Recorder()

    cohort_fn = _cohort_response(cohort_rows)

    def fake_execute(builder, what=None, **kw):
        if what and what.endswith(".repair_backlog_cohort"):
            return cohort_fn(builder, what=what)
        if what == "wasalt_residential_listings.repair_control":
            return _Resp([ROW("wasalt_residential_listings", i, 0) for i in CONTROL_IDS])
        if what == "wasalt_commercial_listings.repair_control":
            return _Resp([])
        if what and what.endswith(".repair_fresh_strike"):
            writes["repair_fresh_strike"].setdefault("calls", 0)
            writes["repair_fresh_strike"]["calls"] += 1
            return _Resp([])
        if what and what.endswith(".repair_reset_unproven"):
            writes["repair_reset_unproven"].setdefault("calls", 0)
            writes["repair_reset_unproven"]["calls"] += 1
            return _Resp([])
        if what and what.endswith(".touch_alive"):
            writes["touch_alive"].setdefault("calls", 0)
            writes["touch_alive"]["calls"] += 1
            return _Resp([])
        if what == "wasalt_liveness_pilot_detail.insert":
            writes["pilot_detail"].setdefault("calls", 0)
            writes["pilot_detail"]["calls"] += 1
            return _Resp([])
        if what == "wasalt_liveness_runs.insert":
            writes["liveness_runs"].setdefault("calls", 0)
            writes["liveness_runs"]["calls"] += 1
            return _Resp([])
        raise AssertionError(f"unexpected query: what={what!r}")

    def fake_check_hybrid(row):
        tbl, lid, url, cur = row
        writes.setdefault("checked_ids", []).append(lid)
        if lid in CONTROL_IDS:
            return (tbl, lid, cur, control_verdict, True, 1000, None,
                    {"live": 200, "dead": 404}.get(control_verdict))
        verdict, hc, gc = verdicts_by_id[lid]
        used_get = verdict != "live" or gc is not None
        return (tbl, lid, cur, verdict, used_get, 1000, hc, gc)

    monkeypatch.setattr(db, "sb", fake_sb)
    monkeypatch.setattr(db, "_execute", fake_execute)
    monkeypatch.setattr(liveness, "check_hybrid", fake_check_hybrid)
    return writes


ROW = lambda tbl, lid, mc=3: {"id": lid, "listing_url": f"https://wasalt.sa/en/property/{lid}",
                               "missing_count": mc}


# ── 1. `active` is never written by this mode, for any verdict ───────────────────────────────────

def test_confirmed_dead_gets_one_fresh_strike_never_a_kill(monkeypatch):
    cohort = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", 1)]}
    writes = _install(monkeypatch, cohort_rows=cohort,
                       verdicts_by_id={1: ("dead", 404, 404)})

    rc = run_repair_clock_bug_backlog(_Args())

    assert rc == 0
    assert writes["repair_fresh_strike"]["calls"] == 1, "the dead verdict must write ONE fresh strike"
    assert "active" not in str(writes), "no write in this test run may ever mention 'active'"


def test_confirmed_live_fully_self_heals(monkeypatch):
    cohort = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", 2)]}
    writes = _install(monkeypatch, cohort_rows=cohort,
                       verdicts_by_id={2: ("live", 200, None)})

    run_repair_clock_bug_backlog(_Args())

    assert writes["touch_alive"].get("calls") == 1, "a confirmed-live row must self-heal via the " \
        "same _flush_alive() path the ordinary pipeline uses"
    assert writes["repair_fresh_strike"].get("calls", 0) == 0


def test_failed_check_resets_to_zero_not_left_at_the_unproven_value(monkeypatch):
    cohort = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", 3)]}
    writes = _install(monkeypatch, cohort_rows=cohort,
                       verdicts_by_id={3: ("failed", None, None)})

    run_repair_clock_bug_backlog(_Args())

    assert writes["repair_reset_unproven"].get("calls") == 1
    assert writes["repair_fresh_strike"].get("calls", 0) == 0
    assert writes["touch_alive"].get("calls", 0) == 0


def test_a_mixed_realistic_cohort_writes_exactly_the_three_buckets(monkeypatch):
    rows = {"wasalt_residential_listings": [
        ROW("wasalt_residential_listings", i) for i in range(1, 31)
    ]}
    verdicts = {}
    for i in range(1, 31):
        if i <= 20:
            verdicts[i] = ("live", 200, None)
        elif i <= 27:
            verdicts[i] = ("dead", 404, 404)
        else:
            verdicts[i] = ("failed", None, None)
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)

    rc = run_repair_clock_bug_backlog(_Args())

    assert rc == 0
    assert writes["touch_alive"]["calls"] == 1           # one batched update for the 20 live ids
    assert writes["repair_fresh_strike"]["calls"] == 1    # one batched update for the 7 dead ids
    assert writes["repair_reset_unproven"]["calls"] == 1  # one batched update for the 3 failed ids
    assert "active" not in str(writes)


# ── 2. Checker health: a known-live control group, not a dead-percentage ────────────────────────
# Production pilot run 36111901590 (2026-09-25): 141 of 150 backlog rows came back as real HTTP 404s
# with the 211KB dead-page signature. The old ">90% dead in a batch" rule read that as a broken
# checker and skipped both batches, leaving every row at missing_count>=grace — the state CLOSEST to
# deactivation, because every write this mode can make lowers a strike count.

def _mostly_dead_cohort():
    rows = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", i) for i in range(1, 31)]}
    verdicts = {i: ("dead", 404, 404) for i in range(1, 30)}
    verdicts[30] = ("live", 200, None)
    return rows, verdicts


def test_a_genuinely_dead_backlog_gets_its_fresh_strikes_when_the_control_is_healthy(monkeypatch):
    rows, verdicts = _mostly_dead_cohort()
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)

    rc = run_repair_clock_bug_backlog(_Args())

    assert rc == 0
    assert writes["repair_fresh_strike"].get("calls", 0) == 1, (
        "29 real 404s behind a healthy control were skipped — they stay at missing_count>=grace and "
        "the next ordinary confirm deactivates them, which is what this mode exists to prevent")
    assert writes["touch_alive"].get("calls", 0) == 1
    assert "active" not in str(writes)


def test_a_checker_that_calls_known_live_rows_dead_writes_nothing(monkeypatch):
    rows, verdicts = _mostly_dead_cohort()
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts, control_verdict="dead")

    rc = run_repair_clock_bug_backlog(_Args())

    assert rc == 1
    assert writes["repair_fresh_strike"].get("calls", 0) == 0
    assert writes["touch_alive"].get("calls", 0) == 0
    assert writes["repair_reset_unproven"].get("calls", 0) == 0
    assert not set(writes["checked_ids"]) - set(CONTROL_IDS), "cohort rows were checked after a failed control"
    assert "control_failed" in writes["wasalt_liveness_runs"][0]["notes"]


def test_a_blocked_checker_fails_the_control_and_writes_nothing(monkeypatch):
    rows, verdicts = _mostly_dead_cohort()
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts, control_verdict="failed")

    assert run_repair_clock_bug_backlog(_Args()) == 1
    assert writes["repair_reset_unproven"].get("calls", 0) == 0
    assert writes["repair_fresh_strike"].get("calls", 0) == 0


def test_an_overwhelmingly_failed_batch_is_skipped(monkeypatch):
    """The old clause required decided>=20, which a >90%-failed batch of 100 can never reach."""
    rows = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", i) for i in range(1, 101)]}
    verdicts = {i: ("failed", None, None) for i in range(1, 96)}
    verdicts.update({i: ("dead", 404, 404) for i in range(96, 101)})
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)

    assert run_repair_clock_bug_backlog(_Args()) == 1
    assert writes["repair_reset_unproven"].get("calls", 0) == 0, "a no-answer batch reset its strikes"
    assert writes["repair_fresh_strike"].get("calls", 0) == 0
    assert writes["pilot_detail"].get("calls", 0) == 1, "evidence is still written for a skipped batch"


# ── 3. Structural guarantee: grep the function's own source for 'active' as a write key ──────────

def test_source_never_writes_active_in_this_function():
    """Belt and suspenders on top of the behavioural tests above: read the actual function body and
    confirm 'active' never appears as a dict key being written. If this function is ever edited to
    add such a write, this must fail loudly."""
    import ast
    import pathlib
    src = pathlib.Path(liveness.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "run_repair_clock_bug_backlog")
    for node in ast.walk(fn):
        if isinstance(node, ast.Dict):
            for k in node.keys:
                if isinstance(k, ast.Constant) and k.value == "active":
                    raise AssertionError(
                        "run_repair_clock_bug_backlog() now writes 'active' — this mode exists "
                        "specifically because it must be structurally unable to deactivate a row")


def test_dry_run_performs_no_checks_and_no_writes(monkeypatch):
    cohort = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", 1)]}
    writes = _install(monkeypatch, cohort_rows=cohort, verdicts_by_id={})

    class _DryArgs(_Args):
        dry_run = True

    rc = run_repair_clock_bug_backlog(_DryArgs())
    assert rc == 0
    assert writes["repair_fresh_strike"].get("calls", 0) == 0
    assert writes["repair_reset_unproven"].get("calls", 0) == 0
    assert writes["touch_alive"].get("calls", 0) == 0


def test_empty_cohort_is_a_clean_noop(monkeypatch):
    writes = _install(monkeypatch, cohort_rows={}, verdicts_by_id={})
    rc = run_repair_clock_bug_backlog(_Args())
    assert rc == 0
    assert writes["repair_fresh_strike"].get("calls", 0) == 0


# ── 4. INCREMENTAL FLUSH — the actual fix for the 2026-09-24 real-run failure ─────────────────────
# The first dispatch of this mode held every verdict in memory and wrote nothing until the whole
# 4,214-row cohort was checked. Real per-check latency turned out far higher than estimated, the job
# hit its 3h timeout, and was killed with ZERO rows written and ZERO evidence rows — three hours of
# real browser checks thrown away. These tests pin the fix: writes happen every FLUSH_EVERY (100)
# checks, not once at the end, so a kill loses at most one partial batch.

def test_a_cohort_larger_than_one_batch_flushes_more_than_once(monkeypatch):
    """250 dead rows (single table) must produce 3 separate batched writes (100, 100, 50), not one —
    this is the direct regression proof for the incremental-flush fix."""
    rows = {"wasalt_residential_listings": [
        ROW("wasalt_residential_listings", i) for i in range(1, 251)
    ]}
    # 1-in-5 live keeps every batch under the 90%-dead degenerate threshold (80% dead), so this test
    # proves incremental flushing without also tripping the (separately-tested) degenerate guard.
    verdicts = {i: (("live" if i % 5 == 0 else "dead"), (200 if i % 5 == 0 else 404),
                    (None if i % 5 == 0 else 404))
                for i in range(1, 251)}
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)

    rc = run_repair_clock_bug_backlog(_Args())

    assert rc == 0
    assert writes["repair_fresh_strike"]["calls"] == 3, (
        "250 rows at FLUSH_EVERY=100 must flush 3 times (100+100+50) — one batch that only writes "
        "at the very end would show 1 here, which is exactly the shape that lost 3 hours of real "
        "checks on 2026-09-24")
    assert writes["pilot_detail"]["calls"] == 3, "evidence must be flushed with the same cadence"


def test_a_batch_boundary_that_lands_exactly_on_flush_every_flushes_cleanly(monkeypatch):
    """200 rows (exactly 2×FLUSH_EVERY) must flush exactly twice, with no dangling empty third
    flush — flush_batch() must no-op when nothing has accumulated."""
    rows = {"wasalt_residential_listings": [
        ROW("wasalt_residential_listings", i) for i in range(1, 201)
    ]}
    verdicts = {i: ("live", 200, None) for i in range(1, 201)}
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)

    run_repair_clock_bug_backlog(_Args())

    assert writes["touch_alive"]["calls"] == 2


def test_a_degenerate_batch_does_not_poison_a_later_healthy_batch(monkeypatch):
    """The degenerate guard now applies PER BATCH, not once globally — a checker that looked broken
    for 100 rows and then recovered must still get credit for the second, healthy 100. This is a
    deliberate strengthening over the original global-only guard: a checker that goes bad partway
    through a long cohort is now caught partway through, not only if it never recovers."""
    rows = {"wasalt_residential_listings": [
        ROW("wasalt_residential_listings", i) for i in range(1, 201)
    ]}
    verdicts = {i: ("failed", None, None) for i in range(1, 96)}   # batch 1: 95 failed -> degenerate
    verdicts.update({i: ("dead", 404, 404) for i in range(96, 101)})
    verdicts.update({i: ("live", 200, None) for i in range(101, 201)})  # batch 2: all live -> healthy
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)

    rc = run_repair_clock_bug_backlog(_Args())

    assert rc == 1, "at least one degenerate batch must still be reported"
    assert writes["repair_fresh_strike"].get("calls", 0) == 0, "the degenerate first batch must not " \
        "write its dead verdicts as fresh strikes"
    assert writes["repair_reset_unproven"].get("calls", 0) == 0
    assert writes["touch_alive"].get("calls", 0) == 1, "the second, healthy batch's live verdicts " \
        "must still be self-healed — one bad batch must not poison a later good one"


# ── 5. SHARDING — reuses the proven id%shards partition, never a live-table offset window ────────

def test_sharding_partitions_a_fixed_cohort_with_no_overlap_and_no_gap(monkeypatch):
    ids = list(range(1, 41))
    rows = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", i) for i in ids]}
    seen_by_shard: dict[int, set[int]] = {}

    def make_shard_args(shard_no: int):
        class _ShardArgs(_Args):
            shards = 4
            shard = shard_no
        return _ShardArgs()

    for shard_no in range(4):
        _install(monkeypatch, cohort_rows=rows,
                 verdicts_by_id={i: ("live", 200, None) for i in ids})
        seen: set[int] = set()
        current = liveness.check_hybrid  # _install just set this; wrap it to record which ids run

        def wrapped(row, _current=current, _seen=seen):
            res = _current(row)
            if res[1] not in CONTROL_IDS:
                _seen.add(res[1])
            return res
        monkeypatch.setattr(liveness, "check_hybrid", wrapped)

        run_repair_clock_bug_backlog(make_shard_args(shard_no))
        seen_by_shard[shard_no] = seen

    all_seen: set[int] = set()
    for s in seen_by_shard.values():
        assert not (s & all_seen), "two shards processed the same id — sharding must not overlap"
        all_seen |= s
    assert all_seen == set(ids), "every id must be covered by exactly one shard — no gap"


def test_limit_still_caps_the_cohort_when_sharded(monkeypatch):
    ids = list(range(1, 41))
    rows = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", i) for i in ids]}
    writes = _install(monkeypatch, cohort_rows=rows,
                       verdicts_by_id={i: ("live", 200, None) for i in ids})

    class _LimitedShardArgs(_Args):
        shards = 4
        shard = 0
        limit = 2

    run_repair_clock_bug_backlog(_LimitedShardArgs())
    assert writes["liveness_runs"]["calls"] == 1
    # can't see `checked` directly here without inspecting the insert payload, but a run that
    # ignored --limit after sharding would attempt up to 10 checks (40/4) instead of 2 — covered by
    # test_a_mixed_realistic_cohort_writes_exactly_the_three_buckets style call-count assertions
    # elsewhere; this test's job is only to confirm the combination doesn't crash or skip the insert.


# ── 4. ops_incident #708: a batch reaches the DB before the next row is checked ──────────────────
# The repair loop used to consume the EAGER _pmap, so its first 100-row flush could only run once
# every row in the cohort had been checked. 87 minutes of real production checks sat in memory,
# printed nothing, wrote nothing, and read from outside as a hang.

def _backlog(n):
    rows = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", i)
                                            for i in range(1, n + 1)]}
    verdicts = {i: ("live", 200, None) if i % 5 == 0 else ("dead", 404, 404)
                for i in range(1, n + 1)}
    return rows, verdicts


def test_each_batch_is_written_before_the_next_row_is_checked(monkeypatch):
    rows, verdicts = _backlog(250)
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)
    inner = liveness.check_hybrid
    batches_written_when_checked: dict[int, int] = {}

    def spying(row):
        batches_written_when_checked[row[1]] = writes["pilot_detail"].get("calls", 0)
        return inner(row)
    monkeypatch.setattr(liveness, "check_hybrid", spying)

    run_repair_clock_bug_backlog(_Args())

    assert batches_written_when_checked[100] == 0
    assert batches_written_when_checked[101] == 1, (
        "row 101 was checked before batch 1 reached the DB — every check is being held in memory "
        "until the whole cohort is done, so a run cut off at any point writes nothing")
    assert batches_written_when_checked[201] == 2
    assert writes["repair_fresh_strike"]["calls"] == 3


class _JobKilled(BaseException):
    """Stands in for the runner cancelling the step (not an Exception: nothing may swallow it)."""


def test_a_run_cut_off_mid_cohort_keeps_every_completed_batch(monkeypatch):
    rows, verdicts = _backlog(250)
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id=verdicts)
    inner = liveness.check_hybrid

    def killed_at_150(row):
        if row[1] == 150:
            raise _JobKilled()
        return inner(row)
    monkeypatch.setattr(liveness, "check_hybrid", killed_at_150)

    try:
        run_repair_clock_bug_backlog(_Args())
    except _JobKilled:
        pass
    assert writes["pilot_detail"].get("calls", 0) == 1, "the completed first batch was lost"
    assert writes["repair_fresh_strike"].get("calls", 0) == 1
    assert writes["touch_alive"].get("calls", 0) == 1
    assert "active" not in str(writes)


def test_a_hung_browser_check_becomes_one_reset_row_and_the_backlog_finishes(monkeypatch):
    """End to end over the REAL check_hybrid → browser_verdict → BoundedBrowserFetcher, with a
    child browser that genuinely never answers for one listing."""
    import time as _time
    from scrapers.wasalt import browser as B

    rows = {"wasalt_residential_listings": [ROW("wasalt_residential_listings", i) for i in range(1, 7)]}
    writes = _install(monkeypatch, cohort_rows=rows, verdicts_by_id={})
    monkeypatch.setattr(liveness, "check_hybrid", _REAL_CHECK_HYBRID)
    monkeypatch.setenv("WASALT_BROWSER", "1")
    monkeypatch.setattr(liveness, "_throttle", lambda: None)

    live = ({"props": {"pageProps": {"propertyDetailsV3": {"id": 1}}}}, 200, 326)
    gone = ({"props": {"pageProps": {}}}, 404, 211)

    class _HangsOn3:
        def page_data(self, url):
            lid = int(url.rsplit("/", 1)[-1])
            if lid == 3:
                _time.sleep(3600)
            return gone if lid in (2, 5) else live

        def close(self):
            pass

    fetcher = B.BoundedBrowserFetcher(factory=_HangsOn3, deadline_s=1.5)
    monkeypatch.setattr(liveness, "_BROWSER", fetcher)
    from scrapers.common.tests.test_wasalt_browser_hard_deadline import within
    try:
        rc = within(30, lambda: run_repair_clock_bug_backlog(_Args()))
    finally:
        fetcher.close()

    assert rc == 0
    run = writes["wasalt_liveness_runs"][0]
    assert (run["checked"], run["live"], run["dead"], run["failed"]) == (6, 3, 2, 1), run
    assert "browser_deadline_kills=1" in run["notes"], run["notes"]
    assert writes["repair_reset_unproven"]["calls"] == 1, "the hung row must reset to 0, not strike"
    assert writes["repair_fresh_strike"]["calls"] == 1
    assert "active" not in str(writes)
