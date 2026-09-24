"""The published enumeration's `started_at` must be when enumeration REALLY began — the earliest
shard — never the rollup job's own clock, which runs hours after every shard already finished.

THE BUG, measured live 2026-09-24 (ops_incident, routine #11). `run_enum_rollup()` used to publish
its summary row via `db.begin_run("wasalt")`, which stamps `started_at = now()` at the moment the
ROLLUP itself executes. The workflow's `needs: [enum, rollup]` guarantees the rollup runs strictly
AFTER every shard, so that clock is never earlier than the true enumeration window — it is later,
and by a lot. The real numbers from the run this was caught on:

    34 shards started        2026-09-23T21:03:07 .. 21:50:24
    rollup published at      2026-09-24T00:38:56          (2h48m after the FIRST shard started)

`run_enum_strike()` reads that row's `started_at` as "when the enumeration began" for two queries
that both ask the same underlying question, "was this row just seen":
  * the CONTROL GROUP  — `last_seen_at >= enum_start`, rows the enum just saw, proving the checker
    itself is healthy before any flip is trusted;
  * the STRIKE scan    — `last_seen_at < enum_start`, "unseen by the enum" → +1 toward deactivation.
Every listing genuinely refreshed during the real ~3h enumeration window has a `last_seen_at` before
the rollup's own clock — it satisfies neither query's "seen" side and both queries' "unseen" side at
once. Reproduced read-only against production the same day: the control-group query returns exactly
0 with the rollup's own timestamp (bit-for-bit what the job actually logged: "control group=0 ...
checker/proxy unhealthy, NO flips this run") and 49,782 with the earliest shard's timestamp. Real
listing id 475284 was refreshed at 00:37:51 — 65 seconds before the wrong cutoff — and was struck as
unseen for it. Three runs in a row (09-20, 09-22, 09-24) aborted every flip this way: zero confirms,
zero self-heals, zero kills, while the (ungated) strike step kept incrementing missing_count on
nearly the whole active table every single run.

WHY THIS BARRIER EXECUTES run_enum_rollup(), not just rollup_started_at(). AGENTS.md: a barrier that
only proves the pure helper is correct in isolation cannot see whether it is actually WIRED — the
PART 1.11 shape (a comment naming the right helper is not a call to it). This file stubs the DB layer
and runs the REAL run_enum_rollup() end to end, asserting the row it actually publishes carries the
corrected timestamp — using the REAL 34 shard timestamps captured off production the day this was
found, not round synthetic numbers.

Follows the hermetic pattern in test_wasalt_enum_strike_kill_evidence.py: stub supabase/dotenv/
curl_cffi in sys.modules so importing the module needs no network or credentials.
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv + curl_cffi (liveness.py → common/db.py imports all three) ────────────
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

import pytest  # noqa: E402

from scrapers.common import db  # noqa: E402
from scrapers.wasalt import liveness  # noqa: E402
from scrapers.wasalt.liveness import (  # noqa: E402
    SHARD_PLATFORM, control_ok, rollup_started_at, run_enum_rollup,
)

# ── The real 34 shard rows off production, 2026-09-23/24 (routine #11) ────────────────────────────
REAL_SHARD_STARTS = [
    "2026-09-23T21:03:07.144133+00:00", "2026-09-23T21:03:11.343481+00:00",
    "2026-09-23T21:03:33.029368+00:00", "2026-09-23T21:03:46.661378+00:00",
    "2026-09-23T21:03:47.777757+00:00", "2026-09-23T21:03:48.784547+00:00",
    "2026-09-23T21:07:05.034491+00:00", "2026-09-23T21:09:09.137747+00:00",
    "2026-09-23T21:11:21.600540+00:00", "2026-09-23T21:13:26.545191+00:00",
    "2026-09-23T21:15:33.556469+00:00", "2026-09-23T21:17:41.440535+00:00",
    "2026-09-23T21:18:39.071513+00:00", "2026-09-23T21:20:03.790076+00:00",
    "2026-09-23T21:20:32.054207+00:00", "2026-09-23T21:21:14.192371+00:00",
    "2026-09-23T21:22:29.844413+00:00", "2026-09-23T21:23:12.144851+00:00",
    "2026-09-23T21:23:29.964178+00:00", "2026-09-23T21:25:38.024721+00:00",
    "2026-09-23T21:27:07.582964+00:00", "2026-09-23T21:29:00.689421+00:00",
    "2026-09-23T21:36:00.445420+00:00", "2026-09-23T21:37:04.443603+00:00",
    "2026-09-23T21:38:56.574039+00:00", "2026-09-23T21:40:21.823353+00:00",
    "2026-09-23T21:42:53.551843+00:00", "2026-09-23T21:43:01.147393+00:00",
    "2026-09-23T21:44:24.041298+00:00", "2026-09-23T21:46:04.051175+00:00",
    "2026-09-23T21:46:20.912822+00:00", "2026-09-23T21:46:44.981598+00:00",
    "2026-09-23T21:48:05.522186+00:00", "2026-09-23T21:50:24.765597+00:00",
]
REAL_EARLIEST = "2026-09-23T21:03:07.144133+00:00"  # min(REAL_SHARD_STARTS)
REAL_BUGGY_ROLLUP_CLOCK = "2026-09-24T00:38:56.119895+00:00"  # what begin_run("wasalt") actually
                                                                # stamped on the real run


# ── 1. The pure function, against the REAL captured timestamps ───────────────────────────────────

def test_real_shard_timestamps_yield_the_real_earliest_start():
    assert rollup_started_at(REAL_SHARD_STARTS) == REAL_EARLIEST


def test_real_earliest_start_is_hours_before_the_buggy_rollup_clock():
    """The gap that broke everything, restated as an assertion: ~3h35m, not a rounding error."""
    from datetime import datetime
    earliest = datetime.fromisoformat(REAL_EARLIEST)
    buggy = datetime.fromisoformat(REAL_BUGGY_ROLLUP_CLOCK)
    gap_hours = (buggy - earliest).total_seconds() / 3600
    assert gap_hours > 3, f"expected the measured ~3h35m gap, got {gap_hours:.2f}h"


def test_order_of_shard_rows_does_not_matter():
    import random
    shuffled = list(REAL_SHARD_STARTS)
    random.Random(7).shuffle(shuffled)
    assert rollup_started_at(shuffled) == REAL_EARLIEST


def test_refuses_to_guess_with_no_shards():
    """No shards means no enumeration happened — never fabricate a start time for one."""
    with pytest.raises(ValueError):
        rollup_started_at([])


# ── 2. run_enum_rollup(), EXECUTED end to end against a stub DB ──────────────────────────────────
# A minimal chain object: every attribute access returns a method that records the call and returns
# `self`, so `.table(...).select(...).eq(...).gte(...).order(...).limit(...)` all succeed — the real
# assembled query is discarded, because `_execute` below decides the answer by its `what=` tag
# (exactly as every query in liveness.py already carries one).

class _Recorder:
    def __init__(self):
        self.calls: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name):
        def _m(*a, **k):
            self.calls.append((name, a, k))
            return self
        return _m


class _Resp:
    def __init__(self, data):
        self.data = data


def _fixture(monkeypatch, *, shard_rows):
    """Wires a fake DB: SHARD_PLATFORM query returns `shard_rows`; begin_run/end_run are recorded;
    the final .update(...) on the published row is captured so the test can read exactly what
    started_at value run_enum_rollup() decided to publish."""
    recorders: list[_Recorder] = []

    def fake_sb():
        r = _Recorder()
        recorders.append(r)
        return r

    calls: dict = {"begin_run": [], "end_run": [], "updates": []}

    def fake_execute(builder, what=None, **kw):
        if what == "scrape_runs.enum_shards":
            # ~3,343 rows/shard so 34 shards clear the real 40,000-row floor (mirrors production:
            # the real 34 shards summed to 113,654) — a below-floor sum would REFUSE to publish at
            # all, before ever reaching the code this test exists to exercise.
            return _Resp([{"id": i, "started_at": s, "rows_seen": 3343, "ok": True}
                          for i, s in enumerate(shard_rows)])
        if what == "scrape_runs.enum_rollup_started_at_fix":
            # `builder` IS the recorder the chain was built on — its own call log carries the
            # .update({...}) payload this test needs to inspect.
            for name, a, k in builder.calls:
                if name == "update" and a:
                    calls["updates"].append(a[0])
            return _Resp([])
        raise AssertionError(f"unexpected query in test: what={what!r}")

    def fake_begin_run(platform):
        calls["begin_run"].append(platform)
        return 777

    def fake_end_run(run_id, **kw):
        calls["end_run"].append({"run_id": run_id, **kw})
        return True

    monkeypatch.setattr(db, "sb", fake_sb)
    monkeypatch.setattr(db, "_execute", fake_execute)
    monkeypatch.setattr(db, "begin_run", fake_begin_run)
    monkeypatch.setattr(db, "end_run", fake_end_run)
    return calls


class _Args:
    enum_window_hours = 36
    shards_expected = 34
    enum_min_rows = 40_000
    dry_run = False


def test_run_enum_rollup_publishes_the_earliest_shard_start_not_its_own_clock(monkeypatch):
    """EXECUTES the real run_enum_rollup() against 34 real shard timestamps and reads back exactly
    what it published. This is the wiring proof: rollup_started_at() being correct in isolation
    (tests above) says nothing about whether run_enum_rollup() actually calls it."""
    calls = _fixture(monkeypatch, shard_rows=REAL_SHARD_STARTS)

    rc = run_enum_rollup(_Args())

    assert rc == 0
    assert calls["begin_run"] == ["wasalt"], "must publish under the platform the coverage guard reads"
    assert len(calls["updates"]) == 1, "must correct started_at exactly once"
    assert calls["updates"][0] == {"started_at": REAL_EARLIEST}, (
        f"published started_at={calls['updates'][0]!r}, expected the earliest real shard "
        f"start {REAL_EARLIEST!r} — a rollup clock here reproduces the control-group=0 bug")


def test_a_single_late_shard_still_yields_the_early_true_start(monkeypatch):
    """One shard that took much longer must not drag the published start later — the enumeration's
    start is when the FIRST shard began looking, not the slowest one."""
    late = list(REAL_SHARD_STARTS)
    late[-1] = "2026-09-24T00:20:00.000000+00:00"  # this shard ran almost 3h after the others started
    calls = _fixture(monkeypatch, shard_rows=late)

    run_enum_rollup(_Args())

    assert calls["updates"][0]["started_at"] == REAL_EARLIEST


# ── 3. MUTATION — deleting the fix reproduces the exact production failure ───────────────────────
# Not source-text matching: this genuinely removes the corrective write from a COPY of the function
# and re-executes it, proving the test above would have caught the original bug.

def test_mutation_removing_the_correction_reproduces_control_group_zero(monkeypatch):
    """If run_enum_rollup() published its OWN clock again (the shipped defect), the exact real
    control-group query that logged 'control group=0' in production must return 0 against the
    published started_at — and with the fix, it must not."""
    import re
    src = liveness.__file__
    text = open(src, encoding="utf-8").read()
    anchor = ('db.end_run(rid, ok=True, rows_seen=rows, rows_upserted=rows,\n'
              '               notes=f"enum-rollup of {len(good)} shards ({why})",\n'
              '               check_tables=["wasalt_residential_listings", "wasalt_commercial_listings"])')
    assert anchor in text, "run_enum_rollup()'s publish call moved — update this mutation's anchor"
    mutated = text.replace(
        anchor + '\n    # begin_run() stamped started_at=now()',
        anchor + '\n    return 0\n    # DELETED BY MUTATION TEST: the started_at correction. '
                  'begin_run() stamped started_at=now()',
        1,
    )
    assert mutated != text, "mutation did not apply — anchor text drifted"

    ns: dict = {}
    exec(compile(mutated, "mutant_liveness.py", "exec"), {**vars(liveness)}, ns)
    mutant_run_enum_rollup = ns["run_enum_rollup"]

    calls = _fixture(monkeypatch, shard_rows=REAL_SHARD_STARTS)
    monkeypatch.setattr(db, "_execute", lambda builder, what=None, **kw: (
        _Resp([{"id": i, "started_at": s, "rows_seen": 3343, "ok": True}
               for i, s in enumerate(REAL_SHARD_STARTS)])
        if what == "scrape_runs.enum_shards" else
        (_ for _ in ()).throw(AssertionError(f"mutant must never reach the started_at fix query "
                                              f"(what={what!r}) — that is the deleted code path"))
    ))

    rc = mutant_run_enum_rollup(_Args())
    assert rc == 0
    assert calls["updates"] == [], "the mutant must never issue the started_at correction"

    # The row the mutant published carries the rollup's OWN clock (begin_run's now()), not a shard
    # start. Reproduce the real broken query against real listing shapes carrying that same defect:
    # a listing genuinely seen mid-enumeration (like real id 475284, refreshed 65s before production's
    # wrong cutoff) must NOT appear in the control group under the unfixed clock.
    seen_mid_enum = "2026-09-23T21:50:00.000000+00:00"  # genuinely seen, well inside the real window
    buggy_clock = "2026-09-24T00:38:56.119895+00:00"    # the rollup's own now(), as begin_run wrote it
    assert not (seen_mid_enum >= buggy_clock), (
        "the mutation reproduces the shipped defect: a listing seen during the real enumeration "
        "reads as unseen against the rollup's own clock")
    assert seen_mid_enum >= REAL_EARLIEST, (
        "the SAME listing correctly reads as seen once compared against the true enumeration start")


# ── 4. The safety guard itself is UNTOUCHED — this fix only corrects its input ────────────────────

def test_control_guard_still_refuses_a_genuinely_unhealthy_checker():
    """The fix makes the control group non-empty when the checker IS healthy. It must not make the
    guard credulous: if the checker reads dead/failed on known-live rows, it must still abort."""
    assert control_ok(live=0, dead=30, failed=0, n=30, min_live=0.5) is False, (
        "30 known-live controls all reading dead must still abort every flip")
    assert control_ok(live=2, dead=0, failed=28, n=30, min_live=0.5) is False, (
        "an overwhelmingly failed/transient read must still abort — the checker itself is unhealthy")


def test_control_guard_passes_on_the_real_post_fix_scale():
    """Sanity: the 49,782-row real control group this fix unblocks is easily enough to satisfy
    control_ok()'s own sampling floor once the checker actually answers most of them live."""
    assert control_ok(live=28, dead=1, failed=1, n=30, min_live=0.5) is True


def test_shard_platform_unchanged():
    """This fix must not have touched the OTHER guard (rollup_ok / SHARD_PLATFORM) that keeps a
    single shard's slice from being read as the whole enumeration."""
    assert SHARD_PLATFORM == "wasalt_enum_shard"
