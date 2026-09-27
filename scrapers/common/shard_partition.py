"""Which shard owns a listing — and why that must be a property of the ROW, never of a snapshot.

WHY THIS FILE EXISTS (measured 2026-09-24, routine #11, ops_incident for
`liveness_rotation_stranded`).

`scrapers/aqar/liveness.py` used to cut its work into 16 shards by ROW OFFSET: shard k swept the
id window `[id_at(k*N/16), id_at((k+1)*N/16))`, where `N` was the active row count and `id_at` a
single-row offset probe. The windows are provably contiguous, disjoint and jointly covering — for
ONE caller reading ONE snapshot. In production the 16 shards are 16 separate GitHub runners that
each start at their own minute and each call `count` and `id_at` against their OWN snapshot of a
table the other fifteen are concurrently deactivating rows in. So shard k's `lo` and shard k-1's
`hi` are two different answers to the same question, and whenever `lo_k > hi_(k-1)` every active
row in between is swept by NOBODY.

That is not a rounding detail. Measured on aqar_residential_listings that day: **920 active rows —
oldest `last_seen_at` 2026-08-04, fifty-one days — had never been probed since.** They carry
`missing_count = 0`, so they can never reach the strike grace either, which makes
`served_after_source_gone` and `prune_unseen` structurally blind to them while every platform-level
coverage percentage reads healthy. The gap is stable rather than random because a row nothing
sweeps never changes state, so it keeps its place in the ordering and falls into the same gap the
next day. Each frozen cohort sat exactly at the bottom of a shard's id window, which is the
signature.

The old scheme's hermetic test (`test_aqar_liveness_sharding.py`) asserted "contiguous, disjoint,
jointly covering... for ANY id distribution" and was green for every one of those fifty-one days,
because it built all sixteen windows from ONE shared `id_at` and ONE shared `N`. It modelled a
world in which the shards agree. AGENTS.md's rule in its exact form: a barrier can pass for the
entire time the defect is live when it tests a model instead of the mechanism.

THE LAW. Ownership is `listing_id % shards == shard`. It reads nothing but the row's own id, so
two shards may disagree about how many rows exist, may read the table minutes apart, and may see
completely different sets — and the partition is still exact. There is no boundary to negotiate,
so there is nothing to negotiate wrongly. What remains is honest and bounded: a shard can only
miss a row its OWN read did not return, which is one run, not fifty-one days.

Balance is not traded away for that. Measured on the live table the same day, `id % 16` over 93,056
active rows gave 5,664-5,901 per shard (±2%), against the offset split's exact-by-construction
5,816 — the difference is far inside the daily variation the sweep already absorbs.
"""
from __future__ import annotations

from typing import Iterable, Optional, Sequence


def shard_owns(listing_id: int, shards: int, shard: int) -> bool:
    """True iff `shard` (of `shards`) is responsible for this listing id.

    Depends on the id alone — deliberately. `shards <= 0` collapses to a single shard owning
    everything rather than dividing by zero, and `shard` is taken modulo `shards` so an
    out-of-range index can never own nothing (which would silently drop 1/S of the table).
    """
    s = max(1, int(shards))
    return int(listing_id) % s == int(shard) % s


def shard_worklist(ids: Iterable[int], shards: int, shard: int) -> list[int]:
    """This shard's ids, ascending and de-duplicated, out of whatever slice of the table it read."""
    return sorted({int(i) for i in ids if shard_owns(int(i), shards, shard)})


def partition_coverage(
    snapshots: Sequence[Iterable[int]],
    shards: Optional[int] = None,
    *,
    truth: Optional[Iterable[int]] = None,
) -> dict:
    """Execute the whole fleet's selection and report what it actually covers.

    `snapshots[k]` is the active id set shard k really read — they are allowed to DIFFER, which is
    the only interesting case and the one the old test could not express. `truth` defaults to the
    ids present in every snapshot, i.e. rows that were active for the entire sweep window and that
    nothing therefore has an excuse for missing.

    Returns `missed` (active throughout, swept by no shard) and `duplicated` (swept by more than
    one). Both must be empty. `missed` is the data-loss direction: a row nothing looks at is
    UNKNOWN forever while still being served (docs/ops/LISTING_LIVENESS.md).
    """
    snaps = [{int(i) for i in s} for s in snapshots]
    n_shards = len(snaps) if shards is None else int(shards)
    if truth is None:
        truth_set = set.intersection(*snaps) if snaps else set()
    else:
        truth_set = {int(i) for i in truth}

    owners: dict[int, list[int]] = {}
    for k, snap in enumerate(snaps):
        for i in shard_worklist(snap, n_shards, k):
            owners.setdefault(i, []).append(k)

    return {
        "shards": n_shards,
        "swept": len(owners),
        "missed": sorted(i for i in truth_set if i not in owners),
        "duplicated": sorted(i for i, ks in owners.items() if len(ks) > 1),
    }
