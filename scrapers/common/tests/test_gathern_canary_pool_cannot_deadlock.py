"""The canary pool must not be able to lock the sweep shut against itself.

THE DEFECT (ops_incident #168, measured in production 2026-09-11)
----------------------------------------------------------------
`_collect_canaries()` ranked controls by `last_verified_alive_at` — a column written ONLY by this
same sweep. That makes the control set self-referential, and a self-referential control set cannot
recover from a stall:

    the sweep quarantines -> no new last_verified_alive_at is written -> the pool ages -> gathern
    is short-stay rental inventory, so a days-old "proven alive" row has very often been delisted
    -> those genuine 404s are read as "the source refused this egress" -> quarantine.

From 2026-09-07 every scheduled run reported `CANARY FAIL 0/10 statuses[404x10]` and wrote zero
strikes, while 1,431 listings whose own detail page returns 404 stayed `production_ready` and were
served to users. Proven by execution the same day — same container, same transport, same minute:

    the pool this function actually returned   10/10 -> HTTP 404
    rows the crawl had seen that morning       10/10 -> HTTP 200

The source was never blocking us. Our controls were dead.

WHAT THIS FILE PINS
-------------------
That the gate still fails CLOSED (an empty or unusable pool removes nothing), and that it can no
longer be starved by its own inactivity. The thresholds it feeds — MIN_CANARIES,
MIN_CANARY_ALIVE_RATE, the 3-strike grace, the anomaly cap, the trust floor — are NOT touched here
and must not be: this repairs a control's INPUT so the gate can function, it does not loosen the
gate. `test_a_real_block_still_quarantines` is the half that proves that.

    python -m pytest scrapers/common/tests/test_gathern_canary_pool_cannot_deadlock.py -q
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone

# Hermetic import: stub supabase + dotenv so importing the module never needs credentials.
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common.liveness_trust import canary_environment_ok  # noqa: E402
from scrapers.gathern.liveness import (  # noqa: E402
    CANARY_MAX_AGE_HOURS,
    choose_canaries,
    trust_quarantine_reason,
)

NOW = datetime(2026, 9, 11, 14, 0, tzinfo=timezone.utc)


def _row(rid, *, seen=None, verified=None, url=None):
    return {
        "id": rid,
        "ad_number": "G%d" % rid,
        "listing_url": "https://gathern.co/view/%d/unit/%d" % (rid, rid) if url is None else url,
        "last_seen_at": seen.isoformat() if isinstance(seen, datetime) else seen,
        "last_verified_alive_at": (
            verified.isoformat() if isinstance(verified, datetime) else verified
        ),
    }


def test_the_production_deadlock_is_gone():
    """The exact 2026-09-11 shape: every candidate's freshest observation is 5 days old.

    Before the fix these ten rows WERE the canary pool, they were genuinely delisted, and their
    honest 404s quarantined the run — forever, because a quarantined run writes no fresher stamp.
    """
    stale_at = datetime(2026, 9, 6, 10, 29, 47, tzinfo=timezone.utc)
    stale = [_row(i, seen=stale_at, verified=stale_at) for i in range(10)]
    assert choose_canaries(stale, 10, now=NOW) == []
    # And the gate then removes NOTHING, rather than probing corpses and blaming the network.
    assert canary_environment_ok(0, 0) is False


def test_a_freshly_crawled_row_is_a_usable_control():
    """A crawl upsert is a real source observation, and it is what breaks the self-reference."""
    fresh = [_row(100 + i, seen=NOW - timedelta(hours=9)) for i in range(10)]
    chosen = choose_canaries(fresh, 10, now=NOW)
    assert [r["id"] for r in chosen] == [100 + i for i in range(10)]


def test_fresh_controls_are_preferred_over_stale_verified_ones():
    stale_at = datetime(2026, 9, 6, 10, 29, 47, tzinfo=timezone.utc)
    stale = [_row(i, seen=stale_at, verified=stale_at) for i in range(10)]
    fresh = [_row(100 + i, seen=NOW - timedelta(hours=9)) for i in range(10)]
    chosen = choose_canaries(stale + fresh, 10, now=NOW)
    assert all(r["id"] >= 100 for r in chosen), [r["id"] for r in chosen]


def test_a_fresh_verification_stamp_still_counts():
    """The stronger signal is not discarded — a healthy sweep behaves exactly as it always did."""
    rows = [_row(200 + i, verified=NOW - timedelta(hours=2)) for i in range(10)]
    assert len(choose_canaries(rows, 10, now=NOW)) == 10


def test_ranking_is_by_the_freshest_observation_of_either_kind():
    older_seen = _row(1, seen=NOW - timedelta(hours=30), verified=NOW - timedelta(hours=1))
    newer_seen = _row(2, seen=NOW - timedelta(hours=2), verified=None)
    # Row 1's freshest observation (1h, a verification) beats row 2's (2h, a crawl).
    assert [r["id"] for r in choose_canaries([newer_seen, older_seen], 2, now=NOW)] == [1, 2]


def test_the_age_bound_is_the_documented_one():
    inside = _row(1, seen=NOW - timedelta(hours=CANARY_MAX_AGE_HOURS - 1))
    outside = _row(2, seen=NOW - timedelta(hours=CANARY_MAX_AGE_HOURS + 1))
    assert [r["id"] for r in choose_canaries([inside, outside], 10, now=NOW)] == [1]


def test_empty_and_unusable_pools_fail_closed():
    """No control is not permission; it is a refusal to remove anything."""
    assert choose_canaries([], 10, now=NOW) == []
    # A row with no probeable URL cannot be a control, however fresh it is.
    assert choose_canaries([_row(1, seen=NOW, url="   ")], 10, now=NOW) == []
    assert choose_canaries([_row(1, seen=None, verified=None)], 10, now=NOW) == []
    assert canary_environment_ok(0, 0) is False


def test_unparseable_timestamps_are_not_treated_as_fresh():
    """A value we cannot read is UNKNOWN — it must not default to 'observed just now'."""
    assert choose_canaries([_row(1, seen="not-a-timestamp")], 10, now=NOW) == []


def test_a_real_block_still_quarantines():
    """The safety direction, unchanged: fresh controls that all 404 still fail the gate.

    This is the half that proves the fix repairs the control's INPUT rather than loosening the
    gate. If the source really is refusing our egress, freshly-crawled rows 404 too.
    """
    fresh = [_row(100 + i, seen=NOW - timedelta(hours=9)) for i in range(10)]
    assert len(choose_canaries(fresh, 10, now=NOW)) == 10
    assert canary_environment_ok(0, 10) is False     # every control refused -> quarantine
    assert canary_environment_ok(5, 10) is False     # 50% < the 60% floor -> quarantine
    assert canary_environment_ok(6, 10) is True      # a healthy environment still passes
    assert canary_environment_ok(4, 4) is False      # below MIN_CANARIES -> never enough


def test_the_pool_is_capped_at_the_requested_size():
    fresh = [_row(100 + i, seen=NOW - timedelta(hours=i % 24)) for i in range(40)]
    assert len(choose_canaries(fresh, 10, now=NOW)) == 10


# ── The quarantine note must not assert a cause it has evidence against ──────────────────────────
# Observed 2026-09-11: the note read "the source is not answering this run reliably" on a run whose
# canary had just returned 10/10 alive. That is the same confident-wrong-cause that sent five days
# of readers, and one dispatch of the metered Saudi proxy, to the wrong system. The GATE is
# unchanged by these — the run is still quarantined and still writes nothing.

def test_a_passing_canary_forbids_blaming_the_source():
    reason = trust_quarantine_reason(True, 10, 10)
    assert "not answering this run reliably" not in reason
    assert "canary independently PASSED" in reason
    assert "10/10" in reason
    assert "#180" in reason           # points at the real, open owner decision


def test_a_failing_canary_still_blames_the_source():
    reason = trust_quarantine_reason(False, 0, 10)
    assert "not answering this run reliably" in reason


def test_no_canary_is_not_a_passing_canary():
    """--canaries 0 must never read downstream as 'the environment was proven healthy'."""
    assert "not answering this run reliably" in trust_quarantine_reason(False, 0, 0)
    # Even if a caller wrongly passes ok=True with nothing probed, an unprobed pool proves nothing.
    assert "not answering this run reliably" in trust_quarantine_reason(True, 0, 0)
