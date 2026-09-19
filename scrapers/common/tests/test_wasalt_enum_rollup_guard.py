"""A partial sharded enumeration must NEVER be published as a complete one.

WHY THIS IS THE DANGEROUS SEAM. run_enum_strike() strikes every active row whose last_seen_at
predates the enumeration — "unseen by the enum" — and deactivates at grace. That is correct ONLY if
the enumeration really looked at the whole catalogue. Its coverage guard enforces that by reading
the single newest `platform='wasalt'` run with rows_seen >= enum_min_rows.

The enum had to be sharded (2026-09-19): one job walking ~3,300 pages is 10-16h through the browser
against a 6h runner ceiling, and run 35416642741 died at the 330-minute wall. Twenty ~3k-row shards
would each look like a catastrophically partial crawl to that guard.

The guard was NOT loosened — it is the one thing between a partial crawl and mass-deactivating live
inventory. Instead shards publish under `wasalt_enum_shard` and rollup_ok() decides whether they add
up to one enumeration. THIS FILE PINS THAT DECISION. If it is wrong in the permissive direction, a
crawl that missed a whole slice publishes a clean-looking row, the guard blesses it, and every live
listing in the missing slice is struck and eventually deactivated.

Run: python -m pytest scrapers/common/tests/test_wasalt_enum_rollup_guard.py -v
"""
from __future__ import annotations

import pytest

from scrapers.wasalt.liveness import SHARD_PLATFORM, rollup_ok, coverage_ok

FLOOR = 40_000
N = 20


def test_the_happy_path_publishes():
    ok, why = rollup_ok(shards_seen=N, shards_expected=N, rows=105_000, min_rows=FLOOR)
    assert ok is True, why
    assert "20/20" in why


@pytest.mark.parametrize("missing", [1, 2, 5, 19])
def test_a_single_missing_shard_refuses(missing):
    """THE headline case: fail-fast:false means siblings still finish, so the row would otherwise
    look almost complete. One missing slice is an entire category nobody enumerated."""
    seen = N - missing
    ok, why = rollup_ok(shards_seen=seen, shards_expected=N, rows=105_000, min_rows=FLOOR)
    assert ok is False, f"{seen}/{N} shards published as a complete enumeration"
    assert f"{seen}/{N}" in why


def test_rows_alone_cannot_buy_a_missing_shard():
    """A huge row count must not compensate for an absent slice — they measure different things."""
    ok, _ = rollup_ok(shards_seen=N - 1, shards_expected=N, rows=10_000_000, min_rows=FLOOR)
    assert ok is False


def test_all_shards_present_but_thin_refuses():
    """Every shard ran and returned almost nothing — e.g. every slice blocked. Complete by count,
    empty in substance; the floor is what catches it."""
    ok, why = rollup_ok(shards_seen=N, shards_expected=N, rows=96, min_rows=FLOOR)
    assert ok is False and "floor" in why


def test_zero_shards_refuses():
    assert rollup_ok(0, N, 0, FLOOR)[0] is False


def test_an_unbounded_expectation_refuses():
    """shards_expected=0 would make `seen >= expected` vacuously true and publish anything."""
    for seen, rows in ((0, 0), (1, 10**9)):
        ok, why = rollup_ok(seen, 0, rows, FLOOR)
        assert ok is False, f"published with shards_expected=0 ({seen} shards, {rows} rows)"
        assert "positive" in why


def test_extra_shards_do_not_refuse():
    """A retried shard writes a second run row. More than expected is not a deficiency."""
    assert rollup_ok(N + 3, N, 105_000, FLOOR)[0] is True


def test_rollup_does_not_reimplement_the_coverage_guard():
    """rollup_ok only asks 'do these add up to ONE enumeration'. Whether that enumeration is
    trustworthy against history stays coverage_ok()'s job, and it is unchanged — so a complete-but-
    collapsed crawl is still caught downstream, not here."""
    assert rollup_ok(N, N, 50_000, FLOOR)[0] is True          # adds up...
    assert coverage_ok(50_000, [105_000, 106_000, 104_000], 0.85) is False  # ...but not trustworthy


def test_shards_publish_under_a_separate_platform():
    """If shards wrote 'wasalt', the guard would read one ~3k slice as the whole enumeration."""
    assert SHARD_PLATFORM == "wasalt_enum_shard" and SHARD_PLATFORM != "wasalt"
