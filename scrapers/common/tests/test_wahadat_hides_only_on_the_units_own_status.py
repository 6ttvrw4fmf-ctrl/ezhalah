"""wahadat: a unit is hidden only when its own record says sold/reserved, never on absence (2026-10-07).

prune_unseen ran without verify_gone, so a unit missing from three crawls was hidden on absence alone
(P1 unknown_treated_as_dead). The source states each unit's status in its project's record.
"""
from __future__ import annotations

from scrapers.wahadat import run as R


def test_sold_or_reserved_read_this_run_is_gone():
    vg = R.off_market_oracle({"WHD1": "sold", "WHD2": "reserved"})
    assert vg("WHD1")[0] == "gone" and vg("WHD2")[0] == "gone"


def test_a_unit_that_merely_vanished_is_unknown():
    assert R.off_market_oracle({"WHD1": "sold"})("WHD9")[0] == "unknown"


def test_the_prune_is_handed_the_oracle_and_collects_only_off_market_statuses():
    src = open(R.__file__, encoding="utf-8").read()
    assert "verify_gone=off_market_oracle(off_market))" in src
    assert 'OFF_MARKET_STATUSES = ("sold", "reserved")' in src
    assert 'if st in OFF_MARKET_STATUSES and proj.get("is_active") is True' in src


def test_the_ad_number_matches_the_one_the_upsert_writes():
    assert R.unit_uid({"id": "ab-cd-ef-0123456789"}) == "abcdef012345"
