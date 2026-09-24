"""Hermetic tests for the liveness shard partition (scrapers/common/shard_partition.py).

THIS FILE USED TO CERTIFY THE DEFECT. Its previous contract was the row-offset window split
(`shard_row_window` / `shard_id_window`, 2026-07-16): "windows contiguous, disjoint, jointly
covering every active row, sizes within 1 row of each other — for ANY id distribution." Every
assertion was true and every test was green, because `_sweep()` built all S windows from ONE
shared `id_at` closure and ONE shared row count. It modelled a world in which the shards agree.

Production is sixteen separate GitHub runners, each calling `count` and `id_at` at its own minute
against its own snapshot of a table the other fifteen are deactivating rows in. Shard k's `lo` and
shard k-1's `hi` are then two different answers to the same question, and whenever
`lo_k > hi_(k-1)` every active row in between is swept by nobody. Measured 2026-09-24: 920 active
aqar_residential rows, oldest `last_seen_at` 2026-08-04, had never been probed in fifty-one days —
and each frozen cohort sat exactly at the bottom of a shard's id window.

So the tests below take DIVERGENT SNAPSHOTS as their primary input. A partition that only works
when the shards agree is not a partition; it is an assumption.
"""
from __future__ import annotations

import random

from scrapers.common.shard_partition import partition_coverage, shard_owns, shard_worklist


# ── Ownership is a property of the row ──────────────────────────────────────────────────────────

def test_every_id_is_owned_by_exactly_one_shard():
    for shards in (1, 3, 7, 16, 64):
        for listing_id in range(0, 2_000):
            owners = [s for s in range(shards) if shard_owns(listing_id, shards, s)]
            assert owners == [listing_id % shards], (listing_id, shards, owners)


def test_ownership_reads_nothing_but_the_id():
    """The whole point: no count, no offset, no snapshot, no neighbours."""
    assert shard_owns(1_552_008, 16, 1_552_008 % 16)
    assert not shard_owns(1_552_008, 16, (1_552_008 + 1) % 16)


def test_degenerate_shard_arguments_never_drop_rows():
    # shards <= 0 collapses to one shard owning everything rather than dividing by zero.
    assert shard_owns(7, 0, 0) and shard_owns(8, 0, 0)
    assert shard_owns(7, -4, 0)
    # An out-of-range shard index wraps instead of owning nothing.
    assert shard_owns(5, 4, 5) == shard_owns(5, 4, 1)


def test_worklist_is_sorted_deduplicated_and_typed():
    assert shard_worklist([40, 8, 8, 24, 41], 8, 0) == [8, 24, 40]
    assert shard_worklist(["16", 17], 16, 0) == [16]
    assert shard_worklist([], 16, 3) == []


# ── The invariant the old scheme could not satisfy: DIVERGENT snapshots ─────────────────────────

def _divergent_snapshots(ids: list[int], shards: int, rng: random.Random) -> list[list[int]]:
    """Each shard reads the table at its own moment: some rows are already gone for one shard and
    still present for another, and each shard sees a different, arbitrarily skewed slice."""
    snaps = []
    for _ in range(shards):
        drop = set(rng.sample(ids, k=len(ids) // 10))
        snaps.append([i for i in ids if i not in drop])
    return snaps


def test_divergent_snapshots_still_partition_exactly():
    rng = random.Random(20260924)
    ids = sorted(rng.sample(range(1, 4_000_000), 5_000))
    for shards in (4, 16):
        snaps = _divergent_snapshots(ids, shards, rng)
        cov = partition_coverage(snaps, shards)
        # Rows every shard could see are swept by exactly one shard. No gaps, no double work.
        assert cov["missed"] == [], cov["missed"][:10]
        assert cov["duplicated"] == [], cov["duplicated"][:10]


def test_the_2026_09_24_gap_shape_is_gone():
    """The measured shape: adjacent shards computed a shared boundary from different row counts.

    Reproduced as the worst case the old scheme faced — shard k reads a table 2% larger than
    shard k-1 did, with the extra rows clustered exactly where the boundary fell. Under a modulo
    partition the skew is irrelevant, because no boundary is being agreed on.
    """
    ids = list(range(1, 90_001))
    shards = 16
    snaps = []
    for k in range(shards):
        # Shard k sees the table as it was `k` "kill waves" ago: a contiguous block near each old
        # boundary is present for some shards and absent for others.
        gone = {i for i in ids if (i % 90_000) < k * 120}
        snaps.append([i for i in ids if i not in gone])
    cov = partition_coverage(snaps, shards)
    assert cov["missed"] == [], cov["missed"][:10]
    assert cov["duplicated"] == []


def test_a_row_missing_from_its_own_owners_snapshot_is_reported_not_hidden():
    """The one honest miss the scheme still allows, and it lasts one run, not fifty-one days.

    A row absent from its OWN shard's read is unprobed that run. It must be REPORTED as missed —
    `partition_coverage` is the instrument, so it may not quietly excuse the case it exists to
    measure. (`truth` is given explicitly here: the default intersection would exclude the row.)
    """
    shards = 4
    ids = list(range(1, 41))
    snaps = [list(ids) for _ in range(shards)]
    snaps[0] = [i for i in ids if i != 8]  # id 8 is shard 0's (8 % 4 == 0) and shard 0 missed it
    cov = partition_coverage(snaps, shards, truth=ids)
    assert cov["missed"] == [8]
    assert cov["duplicated"] == []


def test_balance_stays_inside_the_tolerance_the_sweep_already_absorbs():
    """±2% measured on the live table (93,056 active rows → 5,664-5,901 per shard)."""
    rng = random.Random(7)
    ids = sorted(rng.sample(range(1, 12_000_000), 93_056))
    sizes = [len(shard_worklist(ids, 16, s)) for s in range(16)]
    assert sum(sizes) == len(ids)
    assert max(sizes) - min(sizes) < 0.06 * (len(ids) / 16), sizes


def test_empty_and_single_row_tables():
    assert partition_coverage([[], [], []], 3) == {
        "shards": 3, "swept": 0, "missed": [], "duplicated": [],
    }
    cov = partition_coverage([[5_000]] * 8, 8)
    assert cov["swept"] == 1 and cov["missed"] == [] and cov["duplicated"] == []
