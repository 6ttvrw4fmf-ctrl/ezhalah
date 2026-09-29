"""Wasalt's DIRECT_REVISIT (--mode enforce, 2026-09-29): aqar's mechanism, so live ads get a real
ALIVE answer. Before this, only enum-absent candidates and 30 controls were ever read directly:
62,170 live ads, 3 verified in their window, 61,928 never.

These run the real run_enforce() against a stub DB that records every write."""
from __future__ import annotations

import sys
import types

for _name, _attrs in (("supabase", {"Client": object, "create_client": lambda u, k: object()}),
                      ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    _m = types.ModuleType(_name)
    for _k, _v in _attrs.items():
        setattr(_m, _k, _v)
    sys.modules.setdefault(_name, _m)

import pytest  # noqa: E402

from scrapers.common import db  # noqa: E402
from scrapers.wasalt import liveness as L  # noqa: E402

RES, COM = L.TABLES


class _Q:
    def __init__(self, log, table):
        self.log, self.table, self.op, self.payload, self.ids = log, table, "select", None, None

    def __getattr__(self, name):
        def _m(*a, **k):
            if name in ("update", "insert"):
                self.op, self.payload = name, a[0]
            if name == "in_":
                self.ids = list(a[1])
            if name == "eq" and a[0] == "id":
                self.ids = [a[1]]
            return self
        return _m


class _Args:
    shards, shard, limit, workers, max_seconds = 1, 0, 0, 1, 0.0
    control_n, control_min_live, max_dead_frac, report_only = 10, 0.9, 0.30, False


def _run(monkeypatch, cohort, verdict, *, control_verdict=lambda phase: "live", **args):
    writes, reads = [], []
    ctl = [{"id": 900 + i, "listing_url": f"https://wasalt.sa/ar/property/c{i}", "missing_count": 0}
           for i in range(10)]
    phase = {"n": 0}

    def execute(q, what=None, **k):
        if q.op != "select":
            writes.append((what, q.table, q.op, q.payload, q.ids))
            return types.SimpleNamespace(data=[])
        if what.endswith(".revisit_control"):
            return types.SimpleNamespace(data=ctl if q.table == RES else [])
        if what.endswith(".revisit"):
            return types.SimpleNamespace(data=[r for r in cohort if r.get("_t", RES) == q.table])
        return types.SimpleNamespace(data=[{"id": 10_000}])

    def check(row):
        tbl, lid, url, cur = row
        if lid >= 900:
            phase["n"] += 1
            v = control_verdict("opening" if phase["n"] <= 10 else "closing")
        else:
            reads.append(lid)
            v = verdict(lid)
        return (tbl, lid, cur, v, True, 1000, None, {"live": 200, "dead": 404}.get(v, 0))

    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda t: _Q(writes, t)))
    monkeypatch.setattr(db, "_execute", execute)
    monkeypatch.setattr(L, "check_hybrid", check)
    monkeypatch.setattr(L, "_mirror_probe_evidence", lambda rows: None)
    a = _Args()
    for k, v in args.items():
        setattr(a, k, v)
    assert L.run_enforce(a) == 0
    return writes, reads


def _row(i, mc=0, verified=None, t=RES):
    return {"id": i, "listing_url": f"https://wasalt.sa/ar/property/{i}", "missing_count": mc,
            "last_verified_alive_at": verified, "_t": t}


def _to(writes, lid, what_suffix):
    return [w for w in writes if w[4] and lid in w[4] and w[0].endswith(what_suffix)]


def test_live_is_verified_dead_strikes_once_unknown_only_looked(monkeypatch):
    cohort = [_row(1), _row(2), _row(3)]
    w, _ = _run(monkeypatch, cohort, {1: "live", 2: "dead", 3: "failed"}.get)
    (alive,) = _to(w, 1, ".touch_alive")
    assert alive[3]["missing_count"] == 0 and alive[3]["last_verified_alive_at"]
    (strike,) = _to(w, 2, ".revisit_strike")
    assert strike[3]["missing_count"] == 1 and "active" not in strike[3]
    (looked,) = _to(w, 3, ".revisit_looked")
    assert set(looked[3]) == {"last_liveness_probe_at"}, "UNKNOWN is never a strike or a stamp"
    assert not [x for x in w if isinstance(x[3], dict) and x[3].get("active") is False]


def test_third_direct_dead_hides_after_its_evidence(monkeypatch):
    w, _ = _run(monkeypatch, [_row(1, mc=2)] + [_row(i) for i in range(2, 8)],
                lambda i: "dead" if i == 1 else "live")
    whats = [x[0] for x in w]
    hide = whats.index(f"{RES}.revisit_kill")
    assert w[hide][3] == {"active": False, "missing_count": 3, "last_liveness_probe_at": w[hide][3]["last_liveness_probe_at"]}
    assert "wasalt_liveness_pilot_detail.insert" in whats[:hide], "evidence is written before the hide"


def test_report_only_writes_only_its_run_row(monkeypatch):
    w, reads = _run(monkeypatch, [_row(1, mc=2), _row(2), _row(3)], {1: "dead", 2: "live", 3: "failed"}.get,
                    report_only=True)
    assert reads == [1, 2, 3]
    assert [x[0] for x in w] == ["wasalt_liveness_runs.insert"]


def test_failed_opening_controls_read_nothing(monkeypatch):
    w, reads = _run(monkeypatch, [_row(1, mc=2)], lambda i: "dead", control_verdict=lambda p: "failed")
    assert reads == [] and [x[0] for x in w] == ["wasalt_liveness_runs.insert"]


def test_failed_closing_controls_hide_nothing_but_keep_stamps_and_strikes(monkeypatch):
    w, _ = _run(monkeypatch, [_row(1, mc=2), _row(2), _row(3)] + [_row(i) for i in range(4, 10)],
                lambda i: "dead" if i in (1, 2) else "live",
                control_verdict=lambda p: "live" if p == "opening" else "failed")
    assert not _to(w, 1, ".revisit_kill")
    assert _to(w, 2, ".revisit_strike") and _to(w, 3, ".touch_alive")


def test_collapse_guard_stops_the_run_and_hides_nothing(monkeypatch):
    cohort = [_row(i, mc=2) for i in range(1, 60)]
    w, reads = _run(monkeypatch, cohort, lambda i: "dead")
    assert len(reads) < len(cohort), "a collapsed run stops reading"
    assert not [x for x in w if x[0].endswith(".revisit_kill")]


def test_a_stale_dead_read_is_not_hidden(monkeypatch):
    monkeypatch.setattr(L, "KILL_EVIDENCE_MAX_AGE_S", -1)
    w, _ = _run(monkeypatch, [_row(1, mc=2)] + [_row(i) for i in range(2, 8)], lambda i: "dead" if i == 1 else "live")
    assert not _to(w, 1, ".revisit_kill")


def test_worklist_is_never_verified_first_across_both_tables(monkeypatch):
    cohort = [_row(1, verified="2026-09-28T00:00:00+00:00"), _row(2, t=COM),
              _row(3, verified="2026-09-01T00:00:00+00:00", t=COM), _row(4)]
    _, reads = _run(monkeypatch, cohort, lambda i: "live")
    assert reads == [2, 4, 3, 1]


def test_workflow_budget_keeps_every_hide_within_its_evidence_hour():
    import re
    from pathlib import Path
    wf = (Path(__file__).resolve().parents[3] / ".github/workflows/wasalt-liveness.yml").read_text()
    assert "--mode enforce" in wf and "WASALT_BROWSER" in wf
    (secs,) = re.findall(r"--max-seconds (\d+)", wf)
    assert int(secs) <= L.KILL_EVIDENCE_MAX_AGE_S
    assert "schedule:" not in wf, "a full daily revisit is a proxy-cost decision for the owner"
