"""Guards for the Gathern liveness decision logic (the state machine that flips active=false).

The risk here is a false kill (striking a live unit) or a missed kill (never aging out a dead one),
so the pure classify()/looks_dead() core is worth locking down.

    python -m pytest scrapers/common/tests/test_gathern_liveness.py -q
"""
from __future__ import annotations

import sys
import types

# Hermetic import: stub supabase + dotenv so importing the module never needs credentials.
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.gathern.liveness import classify, is_anomaly, looks_dead, resolve_kill_cap  # noqa: E402


def test_looks_dead_only_on_404_410():
    assert looks_dead(404) and looks_dead(410)
    for s in (200, 403, 429, 500, 502, 0, 301):
        assert not looks_dead(s), s


def test_404_bumps_but_grace_protects_until_third_strike():
    # A single (or second) 404 only strikes — never kills — with the default grace of 3.
    assert classify(404, 0, 3) == ("strike", 1)
    assert classify(404, 1, 3) == ("strike", 2)
    assert classify(404, 2, 3) == ("kill", 3)   # third consecutive miss → kill, pinned at 3
    assert classify(410, 5, 3) == ("kill", 6)   # already past grace stays a kill


def test_alive_resets_and_transient_never_touches():
    assert classify(200, 2, 3) == ("alive", 0)          # a live page wipes accumulated strikes
    for s in (429, 500, 503, 0, 403):
        assert classify(s, 2, 3) == ("transient", 2)    # missing_count preserved, nothing flipped


def test_none_missing_count_treated_as_zero():
    assert classify(404, None, 3) == ("strike", 1)
    assert classify(200, None, 3) == ("alive", 0)


def test_kill_cap_floor_and_two_percent():
    assert resolve_kill_cap(1000) == 150          # 2% = 20, floored at 150
    assert resolve_kill_cap(50000) == 1000        # 2% = 1000 > floor
    assert resolve_kill_cap(29948) == 598         # ~current gathern active (2% = 598)
    assert resolve_kill_cap(50000, override=5) == 5  # explicit owner override wins


def test_anomaly_quarantines_oversized_batch_partial_crawl_cannot_wipe():
    # THE partial-crawl / site-wide-404 backstop: a kill batch above the cap must inactivate NOTHING.
    assert is_anomaly(776, 150) is True    # the 2026-07-27 scare shape → quarantined now, 0 killed
    assert is_anomaly(5000, 598) is True   # a site-wide-404 event over the whole stale set → quarantined
    assert is_anomaly(20, 150) is False    # a normal small delisting batch proceeds
    assert is_anomaly(150, 150) is False   # exactly at the cap is allowed (strictly-greater triggers)
    assert is_anomaly(0, 150) is False     # nothing to kill


if __name__ == "__main__":
    test_looks_dead_only_on_404_410()
    test_404_bumps_but_grace_protects_until_third_strike()
    test_alive_resets_and_transient_never_touches()
    test_none_missing_count_treated_as_zero()
    test_kill_cap_floor_and_two_percent()
    test_anomaly_quarantines_oversized_batch_partial_crawl_cannot_wipe()
    print("ok")
