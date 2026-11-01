"""aqar recheck (--min-strikes): only struck rows, readings >= 6 h apart, own run label (2026-10-06).

aqar-liveness.yml reads every ad once a day (01:00 UTC), so an ad aqar removed stayed visible about
two days after its first "gone" reading (backlog #87). aqar-liveness-recheck.yml re-reads ONLY the
struck rows at 13:00 UTC through the same reader and the same known-live controls, so the second and
third readings land ~12 h apart. Drives the real main() against the fake PostgREST.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

import scrapers.aqar.liveness as L
from scrapers.common.tests import test_aqar_liveness_sweeps_aqarmonthly as F

TABLE = "aqar_residential_listings"
NOW = datetime.now(timezone.utc)


class _Q(F._Q):
    def or_(self, spec):
        # "last_liveness_probe_at.is.null,last_liveness_probe_at.lt.<iso>"
        cut = spec.rsplit(".lt.", 1)[1]
        cutd = datetime.fromisoformat(cut.replace("Z", "+00:00"))
        self.f.append(lambda r: r.get("last_liveness_probe_at") is None
                      or datetime.fromisoformat(r["last_liveness_probe_at"]) < cutd)
        return self


class _Client(F._Client):
    def table(self, t):
        return _Q(self, t)


def _iso(h):
    return (NOW - timedelta(hours=h)).isoformat()


def _run(monkeypatch, argv):
    rows = [
        dict(F._row(1, "https://sa.aqar.fm/gone-1", mc=2), last_liveness_probe_at=_iso(12)),  # due
        dict(F._row(2, "https://sa.aqar.fm/gone-2", mc=1), last_liveness_probe_at=_iso(1)),   # too soon
        dict(F._row(3, "https://sa.aqar.fm/gone-3", mc=0), last_liveness_probe_at=_iso(30)),  # unstruck
    ] + [dict(F._row(i, f"https://sa.aqar.fm/ctl-{i}"), last_seen_at=NOW.isoformat()) for i in range(10, 15)]
    client = _Client({TABLE: rows})
    labels, notes, read = [], {}, []
    monkeypatch.setattr(L, "sb", lambda: client)
    monkeypatch.setattr(L, "begin_run", lambda name: labels.append(name) or 1)
    monkeypatch.setattr(L, "end_run", lambda *a, **k: notes.update(k))
    monkeypatch.setattr(L, "reconcile_orphaned_stubs", lambda *a, **k: 0)
    monkeypatch.setattr(L.time, "sleep", lambda *_: None)

    def get(url, **k):
        read.append(url.rsplit("/", 1)[1])
        if url.rsplit("/", 1)[1].startswith("ctl-"):
            return F._Resp(200, "<html><h1>شقة للإيجار</h1></html>")
        return F._Resp(404) if 404 in k.get("keep", (404,)) else None
    monkeypatch.setattr(L, "get", get)
    monkeypatch.setattr(sys, "argv", ["liveness", "--table", TABLE, "--shards", "1", "--shard", "0", *argv])
    L.main()
    return {r["id"]: r for r in client.rows[TABLE]}, labels, notes.get("notes", ""), read


def test_recheck_reads_only_due_struck_rows_and_hides_the_third(monkeypatch):
    rows, labels, notes, read = _run(monkeypatch, ["--min-strikes", "1"])
    assert "gone-1" in read and "gone-2" not in read and "gone-3" not in read, read
    assert rows[1]["active"] is False and rows[1]["missing_count"] == 3
    assert rows[2]["missing_count"] == 1 and rows[3]["missing_count"] == 0
    assert labels == [f"aqar_liveness_recheck:{TABLE}:0/1"]
    assert "controls=5/5" in notes


def test_a_strike_stamps_when_it_looked(monkeypatch):
    rows, *_ = _run(monkeypatch, [])
    assert rows[2]["missing_count"] == 2
    assert datetime.fromisoformat(rows[2]["last_liveness_probe_at"]) > NOW - timedelta(minutes=5)


def test_the_daily_sweep_keeps_its_label_and_reads_everything(monkeypatch):
    _rows, labels, _notes, read = _run(monkeypatch, [])
    assert labels == [f"aqar_liveness:{TABLE}:0/1"]
    assert {"gone-1", "gone-2", "gone-3"} <= set(read)
