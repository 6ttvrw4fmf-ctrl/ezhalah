"""Hermetic tests for scrapers/aqar/liveness.py's shard split (2026-07-16, two fixes in one day).

Morning fix: the geometric ID-range split was re-anchored at min_id so high-start tables
(aqar_commercial ids begin at ~292k) stopped handing shard 0 a permanently row-less window.

Bug B1 (this file's current contract): geometric splitting is wrong even when anchored, because
aqar ids CLUSTER at the low end — shard 0's [1, ~193k) window held 70,427 of 86,464 active
aqar_residential rows (81%), a ~16h sweep against the workflow's timeout-minutes: 120. It was
SIGKILLed daily (live proof 2026-07-16: run 13176, started 01:00, finished_at NULL, rows_seen 0),
so ~70k rows were never liveness-checked — the 44.6% stale-active backlog. The split is now
balanced by ROW COUNT: shard_row_window() cuts the active rowset (ordered by id) into windows of
floor/ceil(N/S) rows, and shard_id_window() maps those row offsets to a keyset id window via two
single-row probes. These tests lock the contract: windows contiguous, disjoint, jointly covering
every active row, sizes within 1 row of each other — for ANY id distribution.

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

from scrapers.aqar.liveness import shard_id_window, shard_row_window  # noqa: E402


def _row_windows(total: int, shards: int) -> list[tuple[int, int]]:
    return [shard_row_window(total, shards, s) for s in range(shards)]


def _sweep(ids: list[int], shards: int) -> list[list[int]]:
    """Simulate the production path over a synthetic ACTIVE id set: per shard, map the row window
    to an id window exactly as main() does (id_at = the offset-th id, ordered ascending), then
    collect the ids the keyset loop would visit (lo <= id, and id < hi unless hi is None)."""
    ids = sorted(ids)

    def id_at(off: int):
        return ids[off] if off < len(ids) else None

    out: list[list[int]] = []
    for s in range(shards):
        w = shard_id_window(id_at, len(ids), shards, s)
        if w is None:
            out.append([])
            continue
        lo, hi = w
        out.append([i for i in ids if i >= lo and (hi is None or i < hi)])
    return out


# ── THE bug: dense-low-end id distribution must yield balanced shards ───────────────────────────

def test_regression_dense_low_end_ids_are_balanced_not_geometric():
    """Mirror of the live 2026-07-16 shape: ~70.4k ids packed densely at the bottom, ~16k spread
    thinly up to ~3.1M. The geometric split gave shard 0 81% of the rows; the balanced split must
    give every one of the 16 shards floor/ceil(N/16) rows."""
    dense = list(range(1, 70_401))                      # 70,400 ids at the low end
    sparse = list(range(200_000, 3_101_530, 190))       # ~15.3k ids thinly spread above
    ids = dense + sparse
    shards = 16
    per_shard = _sweep(ids, shards)
    n = len(ids)
    lo_size, hi_size = n // shards, -(-n // shards)     # floor / ceil
    for s, rows in enumerate(per_shard):
        assert len(rows) in (lo_size, hi_size), (
            f"shard {s} owns {len(rows)} rows — not balanced (expected {lo_size} or {hi_size})")
    assert max(len(r) for r in per_shard) < n / 2, "no shard may carry the majority of the table"


def test_sweep_partition_every_id_exactly_once():
    """The union of what the 16 keyset loops visit must be EXACTLY the active id set — no row
    checked twice, no row never checked (the 70k-never-checked backlog is the bug)."""
    ids = list(range(1, 5_001)) + list(range(1_000_000, 1_003_000, 7))
    per_shard = _sweep(ids, 16)
    flat = [i for rows in per_shard for i in rows]
    assert len(flat) == len(ids)
    assert sorted(flat) == sorted(ids)


def test_high_start_table_shard0_starts_at_first_real_id():
    """Carried over from the morning fix: a table whose ids START high (aqar_commercial ~292k)
    must give shard 0 a window that begins at the first real row, not at id 0."""
    ids = list(range(292_492, 480_000, 23))
    per_shard = _sweep(ids, 8)
    assert per_shard[0][0] == ids[0]
    assert all(rows for rows in per_shard), "every shard must own rows on a high-start table"


# ── Row-window geometry (pure arithmetic) ───────────────────────────────────────────────────────

def test_row_windows_contiguous_disjoint_and_cover_the_full_range():
    for total, shards in ((86_464, 16), (78_000, 8), (157, 7), (5, 5), (1, 1)):
        ws = _row_windows(total, shards)
        assert ws[0][0] == 0
        assert ws[-1][1] == total
        for (lo_a, hi_a), (lo_b, _) in zip(ws, ws[1:]):
            assert hi_a == lo_b  # contiguous + disjoint: shard i's end is shard i+1's start


def test_row_window_sizes_differ_by_at_most_one():
    for total, shards in ((86_464, 16), (100, 7), (3_101_530, 16), (17, 16)):
        sizes = [hi - lo for lo, hi in _row_windows(total, shards)]
        assert max(sizes) - min(sizes) <= 1, f"unbalanced split for total={total} shards={shards}"


def test_every_row_offset_lands_in_exactly_one_shard():
    total, shards = 157, 7
    ws = _row_windows(total, shards)
    for off in range(total):
        owners = [s for s, (lo, hi) in enumerate(ws) if lo <= off < hi]
        assert len(owners) == 1, f"row offset {off} owned by shards {owners}"


def test_tail_shard_id_window_is_unbounded():
    """The last shard's hi must be None (sweep to the top of the table) so a row inserted between
    the count and the sweep can never fall above every window."""
    ids = list(range(10, 1_000, 3))

    def id_at(off: int):
        return ids[off] if off < len(ids) else None

    w = shard_id_window(id_at, len(ids), 4, 3)
    assert w is not None and w[1] is None


# ── Degenerate inputs stay well-formed ──────────────────────────────────────────────────────────

def test_degenerate_empty_small_and_zero_shards():
    # Empty table → every shard owns nothing.
    assert all(w == (0, 0) for w in _row_windows(0, 8))
    assert shard_id_window(lambda off: None, 0, 8, 0) is None
    # Fewer rows than shards → exactly `total` shards own 1 row each, the rest own none.
    per_shard = _sweep([11, 22, 33], 8)
    assert sorted(len(r) for r in per_shard) == [0, 0, 0, 0, 0, 1, 1, 1]
    assert sorted(i for rows in per_shard for i in rows) == [11, 22, 33]
    # shards=0 must not divide by zero (guarded by max(1, shards)) — one shard owns everything.
    assert shard_row_window(10, 0, 0) == (0, 10)
    # Single row: shard 0 covers it, unbounded tail.
    assert _sweep([5000], 1) == [[5000]]


def test_shrunken_active_set_between_count_and_probe_is_tolerated():
    """Concurrent shards deactivate rows while we probe. If the active set shrank below our
    window's START, the shard honestly owns nothing; if it shrank below the window's END, the
    window becomes unbounded (slight over-coverage — double-checking a row is idempotent)."""
    ids = list(range(1, 101))

    def id_at_shrunk(off: int):  # pretend only 50 rows remain
        return ids[off] if off < 50 else None

    # Shard 3/4 of a 100-row count starts at offset 75 — beyond the 50 remaining rows.
    assert shard_id_window(id_at_shrunk, 100, 4, 3) is None
    # Shard 1/4 starts at offset 25 (still present) but its end probe (offset 50) is gone →
    # unbounded tail instead of a gap.
    w = shard_id_window(id_at_shrunk, 100, 4, 1)
    assert w is not None and w[0] == ids[25] and w[1] is None
