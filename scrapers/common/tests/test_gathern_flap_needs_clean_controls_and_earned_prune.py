"""Gathern flaps live units 200<->404 to our egress; a 404 counts only in a clean run, and the
crawl's prune may hide only what the ad's own page earned (2026-10-07).

2026-10-06 11:49 UTC: controls 9/10 and 6/10 passed the 60% gate and the run applied 11 strikes;
8 of 25 units hidden in that window read 200 the same day. 2026-10-07 04:50 UTC: the cross-shard
prune hid six units on ONE page 404 after a 200, because missing_count also counts feed misses.
"""
from __future__ import annotations

from scrapers.gathern import liveness as L
from scrapers.gathern import run as R


def test_any_control_404_makes_the_run_untrusted():
    assert L.controls_all_alive(10, 10, 10, 10)
    assert not L.controls_all_alive(9, 10, 6, 10), "the 2026-10-06 11:49 run"
    assert not L.controls_all_alive(10, 10, 9, 10), "the 2026-10-06 07:37 run (close 9/10)"
    assert not L.controls_all_alive(0, 0, 0, 0), "no controls is no proof"
    assert not L.controls_all_alive(5, 5, 0, 0), "an unbracketed run is no proof"


def test_prune_kill_needs_two_earlier_own_page_readings():
    assert R.prune_kill_is_earned(2)
    assert R.prune_kill_is_earned(3)
    assert not R.prune_kill_is_earned(1), "one earlier 404 + this one is two readings"
    assert not R.prune_kill_is_earned(0), "15482651: 200 at 01:59, one 404 at 07:39, hidden 04:50"
    assert not R.prune_kill_is_earned(None), "unreadable history withholds"


def test_earned_verify_gone_withholds_an_unearned_gone(monkeypatch):
    monkeypatch.setattr(R._probe, "verify_gone", lambda ad: ("gone", "HTTP 404"))
    monkeypatch.setattr(R, "_prior_direct_readings", lambda ad: 0)
    v = R.earned_verify_gone("GTH1")
    assert v[0] == "unknown" and "withheld" in v[1]
    monkeypatch.setattr(R, "_prior_direct_readings", lambda ad: 2)
    assert R.earned_verify_gone("GTH1") == ("gone", "HTTP 404")


def test_earned_verify_gone_passes_live_and_unknown_through(monkeypatch):
    monkeypatch.setattr(R, "_prior_direct_readings", lambda ad: 0)
    monkeypatch.setattr(R._probe, "verify_gone", lambda ad: ("live", "HTTP 200"))
    assert R.earned_verify_gone("GTH1") == ("live", "HTTP 200")
    monkeypatch.setattr(R._probe, "verify_gone", lambda ad: ("unknown", "timeout"))
    assert R.earned_verify_gone("GTH1") == ("unknown", "timeout")


def test_both_prune_call_sites_use_the_earned_oracle():
    src = open(R.__file__, encoding="utf-8").read()
    assert "verify_gone=_probe.verify_gone" not in src
    assert src.count("verify_gone=earned_verify_gone") == 2
