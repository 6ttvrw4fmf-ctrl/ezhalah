"""Aqar Monthly bathrooms (🔬 AF, 2026-10-10): the Listing's `wc` is the unit page's «دورات المياه».

The Monthly apartment interview asks «كم دورة مياه», and 0 of 3,073 searchable Monthly apartments carried a
bathroom count, because the detail query never asked for `wc` (ops_af_score 2026-10-10: aqarmonthly
bathrooms we_miss 4/4). It is asked through the same schema-settled field list as the amenity flags, so a
schema that does not know `wc` drops it and the crawl runs exactly as before.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.tests.test_aqarmonthly_amenities_are_read import PRICE, _listing, fake_catalog  # noqa: E402,F401
from scrapers.aqarmonthly import run as R  # noqa: E402


def test_wc_is_the_bathroom_count():
    assert R.map_listing(_listing(wc=2), PRICE)["bathrooms"] == 2


def test_zero_and_absence_are_silence_never_a_count():
    assert R.map_listing(_listing(wc=0), PRICE).get("bathrooms") is None
    assert R.map_listing(_listing(), PRICE).get("bathrooms") is None
    assert R.map_listing(_listing(wc=99), PRICE).get("bathrooms") is None


def test_the_detail_query_asks_for_wc_once_settled():
    assert " wc" in R.detail_query(R.AMENITY_GQL_FIELDS)


def test_a_schema_that_rejects_wc_drops_only_wc():
    def answer(q: str):
        if " wc" in q:
            return {"errors": [{"message": 'Cannot query field "wc" on type "Listing".'}]}
        return {"data": {"Listing": {"get": {"id": 1}}}}
    got = R.settle_amenity_fields(answer)
    assert "wc" not in got and "lift" in got
