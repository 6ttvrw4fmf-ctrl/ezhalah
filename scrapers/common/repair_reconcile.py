"""Review-list reconciliation for manual data-repair batches (2026-07-14).

Formalizes an invariant broken during the 2026-07-13/14 price-fidelity repair: 27 dealapp
listings had their price_total corrected, but the stale "unfetchable" entries left over from an
earlier failed attempt were never removed from the review/skip list — caught only by a manual
total-count sanity check, not by process. A repair batch must ALWAYS reconcile the review list
against what it just fixed, or the review list silently drifts from reality (repaired rows keep
showing up as "still needs owner review" forever).

A listing key is (source_table, listing_id).
"""
from __future__ import annotations

from typing import Iterable


def reconcile_review_after_repair(
    repaired_keys: Iterable[tuple[str, int]],
    review_keys: Iterable[tuple[str, int]],
) -> set[tuple[str, int]]:
    """Given the keys successfully repaired this batch and the keys currently sitting in the
    review/skip list, return exactly the review-list keys that must now be REMOVED (repaired ⊆
    review-list intersection). Never touches a review-list key that was NOT repaired — the review
    list is otherwise append-only and must not be pruned on any other basis.
    """
    return set(repaired_keys) & set(review_keys)


def unresolved_review_after_repair(
    repaired_keys: Iterable[tuple[str, int]],
    review_keys: Iterable[tuple[str, int]],
) -> set[tuple[str, int]]:
    """The review-list keys that remain genuinely unresolved after removing whatever this batch
    just repaired — i.e. what should still be flagged for owner attention."""
    return set(review_keys) - set(repaired_keys)
