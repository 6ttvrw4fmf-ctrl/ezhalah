"""Wasalt's dead-listing drip: the rollup sums THIS dispatch only, and commercial is never starved.

Measured 2026-09-28. 5,896 active wasalt rows were unseen by the 09-27 enumeration (4,150 already at
missing_count 3). Two defects stand between them and the confirm step, both EXECUTED here against a
stub DB (hermetic pattern as in test_wasalt_enum_strike_writes_as_it_goes.py):

1. run_enum_rollup() summed every shard row of the last 36h. Dispatches 25h apart (09-27 21:03 cron,
   09-28 22:02 manual; the cron's own `*/2` wraps 31st → 1st in 24h) meant it summed TWO
   enumerations: a slice missing from today was backfilled by yesterday's row, rows_seen doubled
   into coverage_ok()'s median, and started_at became yesterday's. The fix scopes it with --since.
2. The time budget (--max-seconds, ~800 browser confirms) stopped a table-ordered cohort — 1,446
   residential THEN 54 commercial — before commercial was ever reached.
"""
from __future__ import annotations

import re
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = object
_supabase_mod.create_client = lambda url, key: object()
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

RES, COM = liveness.TABLES


class _Resp:
    def __init__(self, data):
        self.data = data


class _Builder:
    """db.sb() chain that remembers its filters and captured update()/insert() payloads."""

    def __init__(self, log):
        self._log = log
        self.since: dict = {}

    def __getattr__(self, name):
        def _m(*a, **k):
            if name in ("update", "insert"):
                self._log.append(a[0])
            if name == "gte":
                self.since[a[0]] = a[1]
            return self
        return _m


# ── 1. The rollup publishes THIS dispatch, never this one plus the last ─────────────────────────

def _rollup(monkeypatch, *, today_ok_shards: int):
    now = datetime.now(timezone.utc)
    yesterday = now - timedelta(hours=27)          # 09-27 21:04 → rollup ~09-29 00:20
    today = now - timedelta(hours=2)               # 09-28 22:03
    rows = ([{"started_at": (yesterday + timedelta(minutes=i)).isoformat(), "rows_seen": 2922,
              "ok": True} for i in range(34)] +
            [{"started_at": (today + timedelta(minutes=i)).isoformat(), "rows_seen": 2950,
              "ok": True} for i in range(today_ok_shards)])
    log: list = []
    pub: dict = {}

    def fake_execute(builder, what=None, **kw):
        if what == "scrape_runs.enum_shards":
            since = datetime.fromisoformat(builder.since["started_at"])
            return _Resp([r for r in rows if datetime.fromisoformat(r["started_at"]) >= since])
        return _Resp([])

    def begin_run(platform):
        pub["platform"] = platform
        return 1

    def end_run(rid, **kw):
        pub.update(kw)
        return True

    monkeypatch.setattr(db, "sb", lambda: _Builder(log))
    monkeypatch.setattr(db, "_execute", fake_execute)
    monkeypatch.setattr(db, "begin_run", begin_run)
    monkeypatch.setattr(db, "end_run", end_run)

    class _Args:
        enum_window_hours = 36
        shards_expected = 34
        enum_min_rows = 40_000
        dry_run = False
        since = (today - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")  # the stamp job

    rc = liveness.run_enum_rollup(_Args())
    started = [p["started_at"] for p in log if isinstance(p, dict) and "started_at" in p]
    return rc, pub, started, today


def test_rollup_sums_only_this_dispatch(monkeypatch):
    # A slice missing TODAY must refuse — yesterday's row for that slice is not today's evidence.
    rc, pub, _, _ = _rollup(monkeypatch, today_ok_shards=33)
    assert rc == 1 and pub["platform"] == "wasalt_enum_rollup_refused", \
        "33/34 of today's shards were published because yesterday's 34 filled the count"

    rc, pub, started, today = _rollup(monkeypatch, today_ok_shards=34)
    assert rc == 0 and pub["platform"] == "wasalt"
    assert pub["rows_seen"] == 34 * 2950, \
        f"rows_seen={pub['rows_seen']} — two enumerations summed into coverage_ok()'s history"
    assert started == [today.isoformat()], "published start is the previous dispatch's"

    wf = (Path(__file__).resolve().parents[3] / ".github/workflows/wasalt-enum-liveness.yml").read_text()
    rollup = wf[wf.index("  rollup:"):wf.index("  strike:")]
    assert re.search(r"needs:\s*\[stamp, enum\]", rollup)
    assert '--since "${{ needs.stamp.outputs.at }}"' in rollup, "the fix is not wired into CI"


# ── 2. The clock-bounded confirm reaches commercial ──────────────────────────────────────────────

def test_commercial_is_confirmed_before_the_time_budget_ends_the_run(monkeypatch):
    now = datetime.now(timezone.utc).isoformat()
    cohort = {RES: [{"id": i, "listing_url": f"https://wasalt.sa/p/{i}", "missing_count": 3}
                    for i in range(1, 4097)],          # the real 09-28 backlog: 4,096 res
              COM: [{"id": 900_000 + i, "listing_url": f"https://wasalt.sa/p/c{i}",
                     "missing_count": 3} for i in range(54)]}      # … and 54 commercial
    checked: list = []

    def fake_execute(builder, what=None, **kw):
        if what == "scrape_runs.enum_candidates":
            return _Resp([{"id": 9, "started_at": now, "rows_seen": 99345},
                          {"id": 8, "started_at": now, "rows_seen": 113654}])
        for t in (RES, COM):
            if what == f"{t}.enum_confirm_cohort":
                return _Resp(cohort[t][:1500])
            if what == f"{t}.enum_control":
                return _Resp([{"id": 10**7 + i, "listing_url": "https://wasalt.sa/p/ok",
                               "missing_count": 0} for i in range(16)])
        return _Resp([])

    def fake_check(row):
        tbl, lid, _url, cur = row
        if lid < 10**7:
            checked.append(tbl)
        v = "live" if lid >= 10**7 else "dead"
        return (tbl, lid, cur, v, True, 1000, None, 200 if v == "live" else 404)

    clock = {"t": 0.0}

    def tick():                      # one browser confirm ≈ 5 s
        clock["t"] += 5.0
        return clock["t"]

    monkeypatch.setattr(db, "sb", lambda: _Builder([]))
    monkeypatch.setattr(db, "_execute", fake_execute)
    monkeypatch.setattr(liveness, "check_hybrid", fake_check)
    monkeypatch.setattr(liveness.time, "time", tick)

    class _Args:
        enum_min_rows = 40_000
        enum_window_hours = 36
        coverage_frac = 0.85
        grace = 3
        dry_run = False
        confirm_limit = 1500
        control_n = 30
        control_min_live = 0.9
        workers = 1
        max_seconds = 4000.0         # ~800 confirms, as the workflow's --max-seconds allows

    liveness.run_enum_strike(_Args())
    assert 0 < len(checked) < 1500, "the budget should have stopped this run partway"
    assert checked.count(COM) == 54, \
        f"{checked.count(COM)}/54 commercial rows confirmed — starved behind the residential backlog"
