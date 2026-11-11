"""shomou: a deadline-cut page walk over a COMPLETE index still re-checks ads that left the index (2026-11-09).

The 22-min deadline cut 68 of 1,046 ad pages on 11-09, so no prune ran and SHQ8303 stayed served after its own
page went 404 (dead-visible score: shomou over the line). The ads on the index that were not reached are
protected (counted as seen); only ads absent from the index go to prune_unseen's direct read.
"""
from __future__ import annotations

import sys

from scrapers.common.tests import test_shomou_run_ends_before_its_job_is_killed as T
from scrapers.shomou import run as S

DETAIL = {"101": "ok"}


def _run(monkeypatch, ticks, detail_ok=True):
    sess, runs, pruned = T._Sess(), [], []
    it = iter(ticks)
    monkeypatch.setattr(S, "_clock", lambda: next(it))
    monkeypatch.setattr(S, "retry_smarter_session", lambda url, **kw: (sess, ["direct/chrome124:200"]))
    monkeypatch.setattr(S, "parse_detail", lambda nid, page: {"nid": nid} if detail_ok else None)
    monkeypatch.setattr(S, "map_detail", lambda d: ({"ad_number": f"SHQ{d['nid']}"}, "residential", None))
    monkeypatch.setattr(S.db, "begin_run", lambda slug: 7)
    monkeypatch.setattr(S.db, "end_run", lambda rid, **kw: runs.append(kw) or True)
    monkeypatch.setattr(S.db, "upsert_shomou_residential_batch", lambda rows: None)
    monkeypatch.setattr(S.db, "upsert_shomou_commercial_batch", lambda rows: None)
    monkeypatch.setattr(S.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(S.db, "prune_unseen", lambda tbl, seen, **kw: pruned.append((tbl, set(seen))) or 0)
    monkeypatch.setattr(S.time, "sleep", lambda *_: None)
    monkeypatch.setattr(sys, "argv", ["shomou"])
    assert S.main() == 0
    return runs, pruned


def test_a_deadline_cut_over_a_whole_index_prunes_with_the_unread_ads_protected(monkeypatch):
    # index: /101 /102 /103; read 101, then the deadline stops the walk (102, 103 unread)
    runs, pruned = _run(monkeypatch, [0.0, 0.5, 1.0, S.SOFT_DEADLINE_S + 1.0, S.SOFT_DEADLINE_S + 2.0])
    assert pruned, "a complete index with only a deadline cut must still prune"
    by = dict(pruned)
    assert by[S.RES_TABLE] == {"SHQ101", "SHQ102", "SHQ103"}   # every ad ON the index is protected
    assert by[S.COM_TABLE] == {"SHQ102", "SHQ103"}             # unread ads are protected in both tables
    assert "deadline_cut=2 of 3" in runs[0]["notes"]


def test_an_unreadable_page_still_blocks_the_prune(monkeypatch):
    runs, pruned = _run(monkeypatch, [0.0, 0.5, 1.0, S.SOFT_DEADLINE_S + 1.0, S.SOFT_DEADLINE_S + 2.0],
                        detail_ok=False)
    assert pruned == []


def test_a_cut_index_still_blocks_the_prune(monkeypatch):
    late = S.SOFT_DEADLINE_S + 5.0
    runs, pruned = _run(monkeypatch, [0.0, late, late, late, late, late])
    assert pruned == []


def test_the_oracle_controls_are_only_ads_this_run_read(monkeypatch):
    # CodeRabbit on #11484: unread ads (SHQ102, SHQ103) sort before nothing here, but in general they could
    # fill all three control slots. The oracle must be built over the READ set, never the protected one.
    built, kws = [], []
    monkeypatch.setattr(S.db, "sb", lambda: "client")
    monkeypatch.setattr(S.db, "own_page_status_oracle",
                        lambda c, tbl, seen, **kw: built.append((tbl, set(seen))) or (lambda ad: ("unknown", "stub")))
    sess, runs, pruned = T._Sess(), [], []
    it = iter([0.0, 0.5, 1.0, S.SOFT_DEADLINE_S + 1.0, S.SOFT_DEADLINE_S + 2.0])
    monkeypatch.setattr(S, "_clock", lambda: next(it))
    monkeypatch.setattr(S, "retry_smarter_session", lambda url, **kw: (sess, ["direct/chrome124:200"]))
    monkeypatch.setattr(S, "parse_detail", lambda nid, page: {"nid": nid})
    monkeypatch.setattr(S, "map_detail", lambda d: ({"ad_number": f"SHQ{d['nid']}"}, "residential", None))
    for name, fn in (("begin_run", lambda slug: 7), ("end_run", lambda rid, **kw: runs.append(kw) or True),
                     ("upsert_shomou_residential_batch", lambda rows: None),
                     ("upsert_shomou_commercial_batch", lambda rows: None),
                     ("retire_superseded_siblings", lambda **kw: 0)):
        monkeypatch.setattr(S.db, name, fn)

    def prune(tbl, seen, **kw):
        kw["verify_gone"]("SHQ999")      # one at-grace read builds the oracle
        pruned.append((tbl, set(seen)))
        return 0

    monkeypatch.setattr(S.db, "prune_unseen", prune)
    monkeypatch.setattr(S.time, "sleep", lambda *_: None)
    monkeypatch.setattr(sys, "argv", ["shomou"])
    assert S.main() == 0
    assert dict(pruned)[S.RES_TABLE] == {"SHQ101", "SHQ102", "SHQ103"}   # unread ads still protected
    assert dict(built)[S.RES_TABLE] == {"SHQ101"}                       # controls: read ads only
    assert dict(built)[S.COM_TABLE] == set()                            # nothing read there: no control


class _FailingLaterIndexPage(T._Sess):
    def get(self, url, **kw):
        if "page=1" in url:
            raise ConnectionError("reset by peer")
        return super().get(url, **kw)


def test_a_failed_later_index_page_is_not_the_end_of_the_list(monkeypatch):
    # CodeRabbit on #11484: index page 1 raised on every retry; that must read as an incomplete index, so a
    # deadline cut afterwards can never prune ads that sat on the unread index pages.
    sess, runs, pruned = _FailingLaterIndexPage(), [], []
    it = iter([0.0, 0.5, 1.0, S.SOFT_DEADLINE_S + 1.0, S.SOFT_DEADLINE_S + 2.0, S.SOFT_DEADLINE_S + 3.0])
    monkeypatch.setattr(S, "_clock", lambda: next(it))
    monkeypatch.setattr(S, "retry_smarter_session", lambda url, **kw: (sess, ["direct/chrome124:200"]))
    monkeypatch.setattr(S, "parse_detail", lambda nid, page: {"nid": nid})
    monkeypatch.setattr(S, "map_detail", lambda d: ({"ad_number": f"SHQ{d['nid']}"}, "residential", None))
    for name, fn in (("begin_run", lambda slug: 7), ("end_run", lambda rid, **kw: runs.append(kw) or True),
                     ("upsert_shomou_residential_batch", lambda rows: None),
                     ("upsert_shomou_commercial_batch", lambda rows: None),
                     ("retire_superseded_siblings", lambda **kw: 0),
                     ("prune_unseen", lambda tbl, seen, **kw: pruned.append(tbl) or 0)):
        monkeypatch.setattr(S.db, name, fn)
    monkeypatch.setattr(S.time, "sleep", lambda *_: None)
    monkeypatch.setattr(sys, "argv", ["shomou"])
    assert S.main() == 0
    assert pruned == []
    assert "index_cut=1" in runs[0]["notes"]
