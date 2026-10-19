"""aqar liveness: known-live controls gate the hide (2026-10-05).

The sweep hid ads inline with no control at all. Now the freshest crawled ads (24 h, no strike)
are read first through the same get()/looks_dead(); if they do not come back live the shard is
report-only: no strike, no hide. Drives the real main() against the fake PostgREST.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

import scrapers.aqar.liveness as L
from scrapers.common.tests.test_aqar_liveness_sweeps_aqarmonthly import _Client, _Resp, _row

TABLE = "aqar_residential_listings"
NOW = datetime.now(timezone.utc).isoformat()


def _ctl(i):
    return dict(_row(i, f"https://sa.aqar.fm/ctl-{i}"), last_seen_at=NOW)


def _sweep(monkeypatch, controls_answer):
    rows = [_row(1, "https://sa.aqar.fm/gone-1", mc=2), _row(2, "https://sa.aqar.fm/gone-2")]
    rows += [_ctl(i) for i in range(10, 15)]
    client = _Client({TABLE: rows})
    notes = {}
    monkeypatch.setattr(L, "sb", lambda: client)
    monkeypatch.setattr(L, "begin_run", lambda name: 1)
    monkeypatch.setattr(L, "end_run", lambda *a, **k: notes.update(k))
    monkeypatch.setattr(L, "reconcile_orphaned_stubs", lambda *a, **k: 0)
    monkeypatch.setattr(L.time, "sleep", lambda *_: None)

    def get(url, **k):
        name = url.rsplit("/", 1)[1]
        r = controls_answer if name.startswith("ctl-") else _Resp(404)
        if r is None or r.status_code == 200 or r.status_code in k.get("keep", ()):
            return r
        return None
    monkeypatch.setattr(L, "get", get)
    monkeypatch.setattr(sys, "argv", ["liveness", "--table", TABLE, "--shards", "1", "--shard", "0"])
    L.main()
    return {r["id"]: r for r in client.rows[TABLE]}, notes.get("notes", "")


def test_controls_that_read_gone_stop_every_strike_and_hide(monkeypatch):
    rows, notes = _sweep(monkeypatch, _Resp(404))
    assert rows[1]["active"] is True and rows[1]["missing_count"] == 2, "a hide landed on a failed control"
    assert rows[2]["missing_count"] == 0, "a strike landed on a failed control"
    assert "CONTROLS-QUARANTINED" in notes


def test_controls_that_read_live_let_the_third_404_hide(monkeypatch):
    rows, notes = _sweep(monkeypatch, _Resp(200, "<html><h1>شقة للإيجار</h1></html>"))
    assert rows[1]["active"] is False and rows[1]["missing_count"] == 3
    assert rows[2]["missing_count"] == 1
    assert "controls=5/5" in notes


def test_a_blocked_control_is_not_live(monkeypatch):
    rows, notes = _sweep(monkeypatch, None)
    assert rows[1]["active"] is True and "CONTROLS-QUARANTINED" in notes
