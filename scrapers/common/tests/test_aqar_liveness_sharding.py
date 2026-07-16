"""Hermetic tests for scrapers/aqar/liveness.py's shard_bounds() (fix 2026-07-16).

The old split anchored buckets at id 0 (bucket = max_id//shards + 1; lo = shard*bucket), but
aqar_commercial_listings ids START at ~292k — so shard 0 owned an id window with no rows at all
and reported ok=true/rows_seen=0 on 27/27 consecutive runs. Post-RC-B (end_run demoting 0-row
runs, PR #72) that dead geometry would flip to permanent FALSE-RED noise instead. These tests
lock the fixed contract: windows anchored at min_id, disjoint, contiguous, and jointly covering
every id in [min_id, max_id] — so every shard's window overlaps the range where rows actually live.

Follows the hermetic pattern in test_end_run_honesty.py: stub supabase/dotenv in sys.modules so
importing the module needs no network or credentials.
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv (liveness.py → common/db.py imports both at module load) ──────────────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.aqar.liveness import shard_bounds  # noqa: E402


def _windows(min_id: int, max_id: int, shards: int) -> list[tuple[int, int]]:
    return [shard_bounds(min_id, max_id, shards, s) for s in range(shards)]


def test_regression_high_start_table_shard0_is_not_empty():
    """THE bug: aqar_commercial_listings ids live in ~[292492, 480000]. The 0-anchored split gave
    shard 0 the permanently row-less [0, 192688). Anchored at min_id, shard 0 must start exactly
    where the rows do."""
    min_id, max_id, shards = 292492, 480000, 8
    lo, hi = shard_bounds(min_id, max_id, shards, 0)
    assert lo == min_id  # the window begins at the first real id, not at 0
    assert hi > lo
    # ... and EVERY shard's window intersects the real id range.
    for s in range(shards):
        lo, hi = shard_bounds(min_id, max_id, shards, s)
        assert lo <= max_id and hi > min_id, f"shard {s} window [{lo}, {hi}) misses [{min_id}, {max_id}]"


def test_windows_are_contiguous_disjoint_and_cover_the_full_range():
    min_id, max_id, shards = 292492, 480001, 27
    ws = _windows(min_id, max_id, shards)
    assert ws[0][0] == min_id
    for (lo_a, hi_a), (lo_b, _) in zip(ws, ws[1:]):
        assert hi_a == lo_b  # contiguous + disjoint: shard i's hi is shard i+1's lo
        assert hi_a > lo_a
    assert ws[-1][1] > max_id  # the union covers max_id itself ([lo, hi) is exclusive)


def test_every_id_lands_in_exactly_one_shard():
    min_id, max_id, shards = 100, 157, 7
    ws = _windows(min_id, max_id, shards)
    for i in range(min_id, max_id + 1):
        owners = [s for s, (lo, hi) in enumerate(ws) if lo <= i < hi]
        assert len(owners) == 1, f"id {i} owned by shards {owners}"


def test_zero_anchored_table_unchanged_semantics():
    """A table whose ids start at 0 splits exactly like the old formula did — the fix is a no-op
    for the tables that were never broken."""
    max_id, shards = 77999, 8
    for s in range(shards):
        lo, hi = shard_bounds(0, max_id, shards, s)
        bucket = (max_id // shards) + 1
        assert (lo, hi) == (s * bucket, (s + 1) * bucket)


def test_degenerate_single_row_and_empty_table():
    # One active row: every window is valid and shard 0 covers the row.
    lo, hi = shard_bounds(5000, 5000, 8, 0)
    assert lo == 5000 and hi == 5001
    # Empty table (min=max=0 fallbacks): windows stay well-formed; the sweep just finds no rows.
    lo, hi = shard_bounds(0, 0, 8, 0)
    assert (lo, hi) == (0, 1)
    # shards=0 must not divide by zero (guarded by max(1, shards)).
    assert shard_bounds(10, 20, 0, 0) == (10, 21)
