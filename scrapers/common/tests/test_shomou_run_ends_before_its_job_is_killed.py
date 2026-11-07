"""shomou: past SOFT_DEADLINE_S the run stops reading ad pages and ends as an incomplete walk, inside its slot.

10-30, 11-04 and 11-05: a slow proxy night took the sequential ~1,039-page read past 28 min and the 30-min job killed
it before end_run() (rows 0, nothing stamped; backlog 1345, alert run_killed_by_timeout:shomou).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.shomou import run as S  # noqa: E402

INDEX = '<table><tbody><a href="/101">a</a><a href="/102">b</a><a href="/103">c</a></tbody></table>'


class _Resp:
    def __init__(self, text):
        self.status_code, self.text, self.content = 200, text, text.encode()

    def raise_for_status(self):
        pass


class _Sess:
    def __init__(self):
        self.detail_reads = 0

    def get(self, url, **kw):
        if "page=0" in url:
            return _Resp(INDEX)
        if "page=" in url:
            return _Resp("<tbody></tbody>")
        self.detail_reads += 1
        return _Resp("<html></html>")


def _run(monkeypatch, ticks):
    sess, runs, pruned = _Sess(), [], []
    it = iter(ticks)
    monkeypatch.setattr(S, "_clock", lambda: next(it))
    monkeypatch.setattr(S, "retry_smarter_session", lambda url, **kw: (sess, ["direct/chrome124:200"]))
    monkeypatch.setattr(S.db, "begin_run", lambda slug: 7)
    monkeypatch.setattr(S.db, "end_run", lambda rid, **kw: runs.append(kw) or True)
    monkeypatch.setattr(S.db, "upsert_shomou_residential_batch", lambda rows: None)
    monkeypatch.setattr(S.db, "upsert_shomou_commercial_batch", lambda rows: None)
    monkeypatch.setattr(S.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(S.db, "prune_unseen", lambda *a, **kw: pruned.append(a) or 0)
    monkeypatch.setattr(S.time, "sleep", lambda *_: None)
    monkeypatch.setattr(sys, "argv", ["shomou"])
    assert S.main() == 0
    return sess, runs, pruned


def test_the_deadline_ends_the_run_cleanly_and_prunes_nothing(monkeypatch):
    # run start, index page 1, detail 1, detail 2 (over budget)
    sess, runs, pruned = _run(monkeypatch, [0.0, 0.5, 1.0, S.SOFT_DEADLINE_S + 1.0, S.SOFT_DEADLINE_S + 2.0])
    assert sess.detail_reads == 1                      # 1 of 3 pages read, then the budget stopped the walk
    assert pruned == []                                # an incomplete walk prunes nothing
    assert len(runs) == 1 and runs[0]["ok"] is True
    assert "deadline_cut=2 of 3" in runs[0]["notes"]


def test_the_budget_starts_when_the_run_starts(monkeypatch):
    """CodeRabbit #10946: a slow session probe / index walk spends the same budget — the clock starts at main()."""
    late = S.SOFT_DEADLINE_S + 5.0
    sess, runs, pruned = _run(monkeypatch, [0.0, late, late, late, late, late])
    assert sess.detail_reads == 0 and pruned == []
    assert "index_cut=1" in runs[0]["notes"] and "deadline_cut=3 of 3" in runs[0]["notes"]
