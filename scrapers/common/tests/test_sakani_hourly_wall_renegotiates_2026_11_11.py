"""A fresh session that WORKS earns its renegotiation back (2026-11-11).

small-sources job 129630208235 (11-10): the detail route walled at 06:29, the fresh session then served ~1,000
details until 07:28, the second fresh one walled again by 07:38, and the 2-renegotiation cap stopped the walk at
unit 2,623 of 2,840 — a partial walk, so nothing could be pruned and sakani stayed in silent_scraper_death. The
wall is per session and periodic, so only UNPRODUCTIVE renegotiations count now. A route walled from the start
still stops after MAX_RENEGOTIATIONS fresh sessions (test_night_failures_2026_10_05.py) and a late permanent wall
still keeps what was read (test_sakani_late_wall_keeps_what_was_read_2026_11_10.py).
"""
from __future__ import annotations

import scrapers.sakani.run as SKN
from scrapers.common.tests.test_night_failures_2026_10_05 import _sakani_stubs

BURST = 25                    # details a session serves before its wall (≥ SESSION_PRODUCTIVE)
WALLS = 5                     # more walls than MAX_RENEGOTIATIONS
N = BURST * (WALLS + 1)


def _hourly_wall():
    """Each session serves BURST details, then answers 'miss' until a fresh session is made."""
    state = {"session": None, "served": 0}

    def detail(s, uid):
        if s is not state["session"]:
            state["session"], state["served"] = s, 0
        if state["served"] < BURST:
            state["served"] += 1
            return "ok", {"id": uid}
        return "miss", None
    return detail


def _run(monkeypatch):
    calls = _sakani_stubs(monkeypatch, N, _hourly_wall())
    monkeypatch.setattr(SKN, "session", lambda: object())     # every renegotiation is a distinct session
    assert SKN.main() == 0
    return calls


def test_periodic_walls_do_not_cut_the_walk(monkeypatch):
    assert BURST >= SKN.SESSION_PRODUCTIVE and WALLS > SKN.MAX_RENEGOTIATIONS
    calls = _run(monkeypatch)
    kw = calls["end_run"][0]
    assert kw["ok"] is True, kw
    assert "detail_walled_cut" not in kw["notes"], kw["notes"]
    assert kw["rows_seen"] == N + 1, kw          # every unit visited (+ the stub's off-plan project)


def test_mutant_that_counts_every_renegotiation_cuts_the_walk(monkeypatch):
    """Mutation proof: with the old rule (every renegotiation counts) the same night is cut short."""
    monkeypatch.setattr(SKN, "SESSION_PRODUCTIVE", 10 ** 9)
    calls = _run(monkeypatch)
    assert "detail_walled_cut" in calls["end_run"][0]["notes"], calls["end_run"][0]["notes"]


def test_a_failed_handshake_after_real_reads_keeps_them(monkeypatch):            # CodeRabbit #11800
    calls = _sakani_stubs(monkeypatch, N, _hourly_wall())
    made = {"n": 0}

    def flaky_session():
        made["n"] += 1
        if made["n"] > 1:
            raise RuntimeError("handshake refused")
        return object()
    monkeypatch.setattr(SKN, "session", flaky_session)
    monkeypatch.setattr(SKN, "_controls_live",
                        lambda ads: (_ for _ in ()).throw(AssertionError("a partial run must not prune")))
    assert SKN.main() == 0
    assert calls["batch"] == ["sakani_residential_listings", "sakani_commercial_listings"], calls["batch"]
    assert "detail_walled_cut" in calls["end_run"][0]["notes"]
