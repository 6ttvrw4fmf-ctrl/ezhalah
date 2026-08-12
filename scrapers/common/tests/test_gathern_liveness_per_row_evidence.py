"""Regression test: every gathern liveness decision must leave queryable per-row evidence.

WHY (owner-directed audit 2026-08-12). The owner asked for the 1,107-row gathern backlog to be
split into evidence-backed cohorts and each one proven from source before any bulk inactivation.
For wasalt that was one query — `wasalt_liveness_pilot_detail` stores a row per decision, so all
1,216 inactivations resolved immediately as head=404 AND get=404. gathern could not answer the same
question: it persisted only the aggregate line (`scanned=1500 dead=1131 alive=369 …`) in
`scrape_runs.notes`, so WHICH row returned WHICH status on WHICH day existed only in a GitHub
Actions log that expires. Three separate audits had to re-derive gathern liveness state by hand.

The contract locked here is narrow and structural:

  1. EVERY decision produces one evidence row carrying the RAW http status and the verdict derived
     from it — including `transient`, because "we could not reach it" is the single most important
     thing to be able to prove afterwards. A 429/5xx/timeout must never be reconstructable as a 404.
  2. Evidence is written on a DRY-RUN too. A dry-run's whole purpose is evidence, and the run that
     prompted this test was a dry-run.
  3. `applied` tells the truth about what happened to the row. A quarantined (anomaly-capped) batch
     is REAL 404 evidence with applied=false — exactly the 2026-08-12 state, which nothing in our
     data could express. A transient verdict is never applied.
  4. A failing audit-log write must never break or roll back the sweep.

This test does NOT assert anything about the kill cap, the 3-strike grace, or any other safety
gate — none of them are changed by the evidence log, and the log never drives inactivation.

Run: python -m pytest scrapers/common/tests/test_gathern_liveness_per_row_evidence.py -v
"""
from __future__ import annotations

import pytest

from scrapers.gathern import liveness


class _FakeQuery:
    """Records every mutation the sweep attempts, so a test can assert what was (not) written."""

    def __init__(self, table: str, sink: dict):
        self._table = table
        self._sink = sink

    # -- writes ---------------------------------------------------------------------------------
    def insert(self, rows):
        self._sink.setdefault("insert", []).append((self._table, rows))
        if self._table in self._sink.get("insert_raises", ()):
            raise RuntimeError("simulated audit-log outage")
        return self

    def update(self, payload):
        self._sink.setdefault("update", []).append((self._table, payload))
        return self

    # -- read/filter chain (all no-ops that return self) ----------------------------------------
    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def in_(self, *a, **k):
        return self

    def execute(self):
        return self

    # `.count` is read straight off the response by the cap resolver.
    count = 0
    data: list = []


class _FakeClient:
    def __init__(self, sink: dict):
        self._sink = sink

    def table(self, name: str):
        return _FakeQuery(name, self._sink)


def _drive(monkeypatch, *, argv, rows, statuses, insert_raises=()):
    """Run the sweep against fakes and return the recorded writes."""
    sink: dict = {"insert_raises": tuple(insert_raises)}

    monkeypatch.setattr(liveness, "sb", lambda: _FakeClient(sink))
    monkeypatch.setattr(liveness, "begin_run", lambda *a, **k: 1)
    monkeypatch.setattr(liveness, "end_run", lambda *a, **k: None)
    monkeypatch.setattr(liveness, "detail_session", lambda: object())
    monkeypatch.setattr(liveness, "_collect_stale", lambda *a, **k: list(rows))
    # One status per row, in order.
    seq = iter(statuses)
    monkeypatch.setattr(liveness, "probe", lambda _s, _url: next(seq))
    monkeypatch.setattr(liveness, "_throttle", lambda: None)
    # --apply paths take a lock; grant it and make release a no-op.
    monkeypatch.setattr(liveness, "_acquire_apply_lock", lambda *a, **k: True, raising=False)
    monkeypatch.setattr(liveness, "_release_apply_lock", lambda *a, **k: None, raising=False)
    monkeypatch.setattr("sys.argv", argv)

    liveness.main()
    return sink


def _evidence(sink) -> list[dict]:
    out: list[dict] = []
    for tbl, rows in sink.get("insert", []):
        if tbl == "gathern_liveness_detail":
            out.extend(rows)
    return out


def _row(i, mc=0):
    return {"id": i, "listing_url": f"https://gathern.co/u/{i}", "missing_count": mc}


def test_dry_run_still_records_evidence_and_flips_nothing(monkeypatch):
    """A dry-run's entire purpose is evidence. It must record every status and write no flips."""
    sink = _drive(
        monkeypatch,
        argv=["liveness", "--limit", "3"],
        rows=[_row(1), _row(2), _row(3)],
        statuses=[404, 200, 503],
    )
    ev = _evidence(sink)
    assert len(ev) == 3, "every scanned row must leave an evidence row, dry-run included"
    assert {e["http_status"] for e in ev} == {404, 200, 503}
    assert all(e["applied"] is False for e in ev), "a dry-run never applies anything"
    # No listing row may be mutated on a dry-run.
    assert not [t for t, _ in sink.get("update", []) if t == liveness.TABLE]


def test_transient_is_recorded_as_transient_and_never_applied(monkeypatch):
    """429/5xx/timeout must stay reconstructable as 'we could not reach it', never as removal."""
    sink = _drive(
        monkeypatch,
        argv=["liveness", "--limit", "4", "--apply"],
        rows=[_row(1), _row(2), _row(3), _row(4)],
        statuses=[429, 500, 0, 403],
    )
    ev = _evidence(sink)
    assert len(ev) == 4
    assert all(e["verdict"] == "transient" for e in ev), ev
    assert all(e["applied"] is False for e in ev)
    assert all(e["http_status"] in (429, 500, 0, 403) for e in ev)


def test_quarantined_kill_batch_is_real_evidence_with_applied_false(monkeypatch):
    """The 2026-08-12 state: genuine 404s, anomaly cap refused the batch, nothing flipped.

    Our data must be able to say exactly that — 404 recorded, applied=false — instead of leaving
    the backlog indistinguishable from 'never probed'.
    """
    n = 12
    rows = [_row(i, mc=2) for i in range(1, n + 1)]  # one strike short of grace=3
    sink = _drive(
        monkeypatch,
        argv=["liveness", "--limit", str(n), "--apply", "--grace", "3", "--kill-cap", "5"],
        rows=rows,
        statuses=[404] * n,
    )
    ev = _evidence(sink)
    assert len(ev) == n
    assert all(e["verdict"] == "kill" for e in ev), "grace reached ⇒ kill verdict"
    assert all(e["http_status"] == 404 for e in ev), "the 404 evidence is real and must be kept"
    assert all(e["applied"] is False for e in ev), (
        "12 kills against a cap of 5 is quarantined — the rows stay active, so applied must be false"
    )
    # And the quarantine must not have flipped `active` on any row.
    assert not [p for t, p in sink.get("update", []) if t == liveness.TABLE and "active" in p]


def test_applied_true_only_when_a_kill_actually_lands(monkeypatch):
    """Under the cap, an --apply run really does flip — and the evidence says so."""
    rows = [_row(i, mc=2) for i in range(1, 4)]
    sink = _drive(
        monkeypatch,
        argv=["liveness", "--limit", "3", "--apply", "--grace", "3", "--kill-cap", "50"],
        rows=rows,
        statuses=[404, 404, 404],
    )
    ev = _evidence(sink)
    # Assert the count FIRST: `all(...)` over an empty list is vacuously true, so without this the
    # test would pass against a build that records no evidence at all.
    assert len(ev) == 3, "every decision must leave evidence"
    assert all(e["verdict"] == "kill" and e["applied"] is True for e in ev)
    flips = [p for t, p in sink.get("update", []) if t == liveness.TABLE and p.get("active") is False]
    assert len(flips) == 3


def test_audit_log_outage_never_breaks_the_sweep(monkeypatch):
    """Evidence is best-effort: a logging failure must not fail or roll back a liveness run."""
    sink = _drive(
        monkeypatch,
        argv=["liveness", "--limit", "2"],
        rows=[_row(1), _row(2)],
        statuses=[404, 200],
        insert_raises=("gathern_liveness_detail",),
    )
    # The run completed (we got here at all) and still attempted the write.
    assert [t for t, _ in sink.get("insert", []) if t == "gathern_liveness_detail"]


def test_classify_never_turns_a_non_404_into_removal():
    """The invariant the evidence log exists to make auditable, asserted directly."""
    for status in (0, 403, 429, 500, 502, 503, 301, 302):
        action, _ = liveness.classify(status, 2, 3)
        assert action == "transient", f"status {status} must never be evidence of removal"
    assert liveness.classify(200, 2, 3)[0] == "alive"
    assert liveness.classify(404, 2, 3)[0] == "kill"     # grace reached
    assert liveness.classify(410, 0, 3)[0] == "strike"   # grace not yet reached
