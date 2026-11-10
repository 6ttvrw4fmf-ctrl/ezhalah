"""A detail route that walls LATE keeps every row already read (2026-11-10).

small-sources job 129630208235: the walk read 2,620 units' own detail records over 1 h 40 m, the route
walled at unit 2,623 of 2,840, and the walled breaker raised — «nothing written, nothing pruned» — so a
whole night's real rows were thrown away and sakani raised silent_scraper_death. A late wall now ends
the walk the way the run budget does: what was read is written, the run is partial, nothing is pruned.
A route walled from the FIRST detail still writes nothing (test_night_failures_2026_10_05.py).

Run: python -m pytest scrapers/common/tests/test_sakani_late_wall_keeps_what_was_read_2026_11_10.py -v
"""
from __future__ import annotations

import scrapers.sakani.run as SKN
from scrapers.common.tests.test_night_failures_2026_10_05 import _sakani_stubs

N, SERVED = 40, 30          # 30 details served, then the route walls for good


def _late_wall(asked: list[str]):
    def detail(s, uid):
        asked.append(uid)
        return ("ok", {"id": uid}) if len(asked) <= SERVED else ("miss", None)
    return detail


def test_a_late_wall_writes_what_was_read_and_never_prunes(monkeypatch):
    asked: list[str] = []
    calls = _sakani_stubs(monkeypatch, N, _late_wall(asked))
    monkeypatch.setattr(SKN, "_controls_live",
                        lambda ads: (_ for _ in ()).throw(AssertionError("a partial run must not prune")))
    assert SKN.main() == 0
    assert calls["batch"] == ["sakani_residential_listings", "sakani_commercial_listings"], calls["batch"]
    kw = calls["end_run"][0]
    assert kw["ok"] is True, kw
    assert "detail_walled_cut" in kw["notes"], kw["notes"]
    # it still stops in minutes: no more than the breaker's handful of reads after the wall
    assert len(asked) <= SERVED + (SKN.MAX_RENEGOTIATIONS + 1) * (SKN.DETAIL_WALL_AFTER + 1), len(asked)


def test_mutant_that_raises_on_a_late_wall_throws_the_night_away(monkeypatch):
    """Mutation proof: with the old breaker (raise whatever was read) the same night writes nothing."""
    asked: list[str] = []
    calls = _sakani_stubs(monkeypatch, N, _late_wall(asked))
    real_fetch = SKN.fetch_detail

    def no_ok_counted(s, uid):              # hides every served detail from the breaker's counter
        st, d = real_fetch(s, uid)
        return ("served_but_uncounted" if st == "ok" else st), d
    monkeypatch.setattr(SKN, "fetch_detail", no_ok_counted)
    assert SKN.main() == 1
    assert calls["batch"] == [], "the pre-fix breaker wrote nothing"
