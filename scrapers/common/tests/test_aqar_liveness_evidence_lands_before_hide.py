"""aqar liveness: a hide never outlives its evidence (2026-10-02).

At 01:07 UTC aqar_residential shard 7 hid 66 rows, then died on a dropped connection with those 66
kill rows still sitting in the in-memory evidence buffer: the flush ran only at the end of a run
that ended normally. `mon_unverified_inactivation_counts` now grades a hide by its ledger row, so
those 66 are correctly reported as unevidenced — and LIFECYCLE_ENGINEER.md calls a hide without
evidence a bug. Drives the real main() against the fake PostgREST and kills the shard mid-sweep.
"""
from __future__ import annotations

import sys

import pytest

import scrapers.aqar.liveness as L
from scrapers.common.tests.test_aqar_liveness_sweeps_aqarmonthly import _Client, _Resp, _row

TABLE = "aqar_residential_listings"
LEDGER = "aqar_liveness_detail"


class _DiesOnSecondHide(_Client):
    """Hide #1 lands; hide #2 raises a non-transient error, like a shard losing its connection."""

    def __init__(self, rows):
        super().__init__(rows)
        self.log: list[tuple] = []   # ("ledger", n_rows) / ("hide", id) in the order they reached the DB
        self.hides = 0

    def table(self, t):
        q = super().table(t)
        real = q.execute

        def execute():
            if q.op and q.op[0] == "insert" and t == LEDGER:
                self.log.append(("ledger", len(q.op[1])))
            if q.op and q.op[0] == "update" and q.op[1].get("active") is False:
                self.hides += 1
                if self.hides == 2:
                    raise RuntimeError("simulated shard death after the first hide")
                self.log.append(("hide", self.hides))
            return real()
        q.execute = execute
        return q


@pytest.fixture
def crashed(monkeypatch):
    client = _DiesOnSecondHide({TABLE: [
        _row(1, "https://sa.aqar.fm/gone-1", mc=2),   # third 404 → hidden, then the shard dies
        _row(2, "https://sa.aqar.fm/gone-2", mc=2),   # its hide is the statement that fails
    ]})
    monkeypatch.setattr(L, "sb", lambda: client)
    monkeypatch.setattr(L, "begin_run", lambda name: 1)
    monkeypatch.setattr(L, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(L, "reconcile_orphaned_stubs", lambda *a, **k: 0)
    monkeypatch.setattr(L.time, "sleep", lambda *_: None)
    monkeypatch.setattr(L, "get", lambda url, **k: _Resp(404) if 404 in k.get("keep", ()) else None)
    monkeypatch.setattr(sys, "argv", ["liveness", "--table", TABLE, "--shards", "1", "--shard", "0"])
    with pytest.raises(RuntimeError):
        L.main()
    return {r["id"]: r for r in client.rows[TABLE]}, client


def test_a_hide_that_survived_the_crash_has_its_kill_row(crashed):
    rows, client = crashed
    assert rows[1]["active"] is False, "the first hide landed before the shard died"
    kills = [e for e in client.inserted.get(LEDGER, [])
             if e["listing_id"] == 1 and e["verdict"] == "kill" and e["applied"]]
    assert kills, "the hide reached the DB but its evidence never did — the 66-row bug of 2026-10-02"


def test_the_evidence_reaches_the_db_before_the_hide(crashed):
    _, client = crashed
    assert client.log.index(("ledger", 1)) < client.log.index(("hide", 1)), (
        "evidence must land BEFORE the row changes; a finally alone cannot survive a dead connection"
    )
