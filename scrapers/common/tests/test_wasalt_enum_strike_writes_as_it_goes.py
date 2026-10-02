"""The enum-strike confirm must write as it goes and end on its own clock (2026-09-28).

Run 36350303259: the strike step confirmed through the browser at ~5 s/row, the 1,500-row cohort
needed ~2 h, the job's timeout is 90 min, and the loop held every verdict in memory until the end.
The runner cancelled it at 90:00 and ~1,000 paid-for direct reads were lost: no kill, no self-heal,
no evidence row, no run row. The repair mode had already been fixed for this (ops_incident #708);
enum-strike had not.

These tests EXECUTE the real run_enum_strike() against a stub DB. Hermetic pattern as in
test_wasalt_repair_clock_bug_backlog.py.
"""
from __future__ import annotations

import re
import sys
import types
from datetime import datetime, timezone
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

RES = "wasalt_residential_listings"


class _Resp:
    def __init__(self, data):
        self.data = data


class _Args:
    enum_min_rows = 40000
    enum_window_hours = 36
    coverage_frac = 0.85
    grace = 3
    dry_run = False
    confirm_limit = 1500
    control_n = 30
    control_min_live = 0.9
    workers = 1
    max_seconds = 0.0


class _Builder:
    """db.sb().table(x)... chain; update()/insert() payloads are captured for the assertion."""

    def __init__(self, log):
        self._log = log

    def __getattr__(self, name):
        def _m(*a, **k):
            if name in ("update", "insert"):
                self._log.append(a[0])
            return self
        return _m


def _install(monkeypatch, *, cohort_n, verdict_for):
    calls: dict[str, int] = {}
    payloads: list = []
    now = datetime.now(timezone.utc).isoformat()
    cohort = [{"id": i, "listing_url": f"https://wasalt.sa/ar/property/{i}", "missing_count": 3}
              for i in range(1, cohort_n + 1)]
    control = [{"id": 10_000 + i, "listing_url": f"https://wasalt.sa/ar/property/c{i}",
                "missing_count": 0} for i in range(30)]

    def fake_execute(builder, what=None, **kw):
        calls[what] = calls.get(what, 0) + 1
        if what == "scrape_runs.enum_candidates":
            return _Resp([{"id": 9, "started_at": now, "rows_seen": 99000},
                          {"id": 8, "started_at": now, "rows_seen": 100000},
                          {"id": 7, "started_at": now, "rows_seen": 100000}])
        if what == f"{RES}.enum_confirm_cohort":
            return _Resp(cohort)
        if what == f"{RES}.enum_control":
            return _Resp(control)
        return _Resp([])

    def fake_check_hybrid(row):
        tbl, lid, url, cur = row
        v = "live" if lid >= 10_000 else verdict_for(lid)
        return (tbl, lid, cur, v, True, 1000, None, 200 if v == "live" else 404)

    monkeypatch.setattr(db, "sb", lambda: _Builder(payloads))
    monkeypatch.setattr(db, "_execute", fake_execute)
    monkeypatch.setattr(liveness, "check_hybrid", fake_check_hybrid)
    return calls, payloads


class _JobKilled(BaseException):
    """The runner cancelling the step — not an Exception, so nothing may swallow it."""


def test_a_run_cancelled_mid_cohort_keeps_every_completed_batch(monkeypatch):
    calls, payloads = _install(monkeypatch, cohort_n=250,
                               verdict_for=lambda i: "live" if i % 5 == 0 else "dead")
    inner = liveness.check_hybrid

    def cancelled_at_150(row):
        if row[1] == 150:
            raise _JobKilled()
        return inner(row)
    monkeypatch.setattr(liveness, "check_hybrid", cancelled_at_150)

    try:
        liveness.run_enum_strike(_Args())
    except _JobKilled:
        pass
    assert calls.get("wasalt_liveness_pilot_detail.insert", 0) >= 1, \
        "the first 100 confirms were held in memory and lost with the job"
    assert calls.get(f"{RES}.enum_kill", 0) >= 1, "batch 1's confirmed-dead rows were never flipped"
    killed = [p for p in payloads if isinstance(p, dict) and p.get("active") is False]
    assert killed, "no kill reached the DB before the cancel"


def test_the_time_budget_ends_the_run_and_records_it(monkeypatch):
    calls, payloads = _install(monkeypatch, cohort_n=1500, verdict_for=lambda i: "dead")
    clock = {"t": 1_000_000.0}

    def tick():
        clock["t"] += 5.0        # one browser confirm ≈ 5 s
        return clock["t"]
    monkeypatch.setattr(liveness.time, "time", tick)

    class _Budgeted(_Args):
        max_seconds = 600.0

    liveness.run_enum_strike(_Budgeted())
    runs = [p for p in payloads if isinstance(p, dict) and p.get("mode") == "enum-strike"]
    assert len(runs) == 1, "a budget-stopped run must still write its run row"
    assert 0 < runs[0]["checked"] < 1500
    assert "budget_stopped=True" in runs[0]["notes"]


def test_live_controls_are_stamped_as_verified(monkeypatch):
    """A control read is a direct read of that listing's own page."""
    calls, payloads = _install(monkeypatch, cohort_n=5, verdict_for=lambda i: "dead")
    liveness.run_enum_strike(_Args())
    stamped = [p for p in payloads if isinstance(p, dict) and "last_verified_alive_at" in p]
    assert stamped, "30 known-live control reads were paid for and thrown away"


def test_the_workflow_budget_sits_under_the_job_timeout():
    wf = (Path(__file__).resolve().parents[3] / ".github/workflows/wasalt-enum-liveness.yml").read_text()
    strike = wf[wf.index("  strike:"):wf.index("  repair:")]
    timeout_min = int(re.search(r"timeout-minutes:\s*(\d+)", strike).group(1))
    budget_s = float(re.search(r"--max-seconds\s+(\d+)", strike).group(1))
    assert 0 < budget_s <= timeout_min * 60 - 15 * 60, \
        "the confirm budget must leave room for setup plus one stuck browser check"


def test_one_run_can_confirm_a_backlog_of_thousands():
    """70 min confirmed ~570 rows per run while ~4,000 unseen rows waited (2026-10-02); the budget and
    the row cap must both allow a multi-thousand-row drain in one run."""
    wf = (Path(__file__).resolve().parents[3] / ".github/workflows/wasalt-enum-liveness.yml").read_text()
    strike = wf[wf.index("  strike:"):wf.index("  repair:")]
    budget_s = float(re.search(r"--max-seconds\s+(\d+)", strike).group(1))
    limit = int(re.search(r"inputs\.confirm_limit \|\| '(\d+)'", strike).group(1))
    assert budget_s / 7.3 >= 2500 and limit >= 2500
