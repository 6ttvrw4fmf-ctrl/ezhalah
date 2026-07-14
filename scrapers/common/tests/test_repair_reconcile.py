"""Regression test for review-list reconciliation (2026-07-14).

Guards the exact bookkeeping bug caught mid-repair on 2026-07-13/14: 27 dealapp listings were
price-corrected but their stale review-list entries were never removed, only caught by a manual
total-count sanity check. See scrapers/common/repair_reconcile.py for the invariant this encodes.

Run: python -m pytest scrapers/common/tests/test_repair_reconcile.py -v
"""
from scrapers.common.repair_reconcile import reconcile_review_after_repair, unresolved_review_after_repair


def test_repaired_rows_are_removed_from_review():
    review = {("dealapp_residential_listings", 1), ("dealapp_residential_listings", 2), ("dealapp_residential_listings", 3)}
    repaired = {("dealapp_residential_listings", 1), ("dealapp_residential_listings", 2)}
    to_remove = reconcile_review_after_repair(repaired, review)
    assert to_remove == {("dealapp_residential_listings", 1), ("dealapp_residential_listings", 2)}


def test_unrepaired_rows_are_never_removed():
    # This is the exact regression: a listing that was NOT part of this batch's repaired set
    # must never be silently dropped from review just because some OTHER row was fixed.
    review = {("dealapp_residential_listings", 99)}
    repaired = {("dealapp_residential_listings", 1)}
    to_remove = reconcile_review_after_repair(repaired, review)
    assert to_remove == set()


def test_repairing_a_row_not_in_review_is_a_no_op():
    review = {("dealapp_residential_listings", 5)}
    repaired = {("dealapp_residential_listings", 999)}  # repaired but was never flagged
    assert reconcile_review_after_repair(repaired, review) == set()


def test_unresolved_after_repair_excludes_fixed_rows():
    review = {("dealapp_residential_listings", 1), ("dealapp_residential_listings", 2), ("aqarcity_residential_listings", 7)}
    repaired = {("dealapp_residential_listings", 1)}
    still_open = unresolved_review_after_repair(repaired, review)
    assert still_open == {("dealapp_residential_listings", 2), ("aqarcity_residential_listings", 7)}


def test_the_2026_07_14_incident_reproduced_and_fixed():
    # 27 dealapp listings had stale review entries left behind after their price was corrected —
    # this is the ACTUAL count from that incident, reconstructed as a regression fixture.
    review = {("dealapp_residential_listings", i) for i in range(1, 40)}       # 39 total on review
    repaired = {("dealapp_residential_listings", i) for i in range(1, 28)}     # 27 got fixed
    to_remove = reconcile_review_after_repair(repaired, review)
    assert len(to_remove) == 27
    still_open = unresolved_review_after_repair(repaired, review)
    assert len(still_open) == 12  # 39 - 27, matches the real incident's residual review count


if __name__ == "__main__":
    test_repaired_rows_are_removed_from_review()
    test_unrepaired_rows_are_never_removed()
    test_repairing_a_row_not_in_review_is_a_no_op()
    test_unresolved_after_repair_excludes_fixed_rows()
    test_the_2026_07_14_incident_reproduced_and_fixed()
    print("OK — review-list reconciliation regression tests pass")
