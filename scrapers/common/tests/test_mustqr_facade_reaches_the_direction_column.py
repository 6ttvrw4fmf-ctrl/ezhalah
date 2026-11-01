"""mustqr: the structured facade cell reaches the direction column (🔬 AF engineer, 2026-10-11).

mustqr's API publishes `direction` as a facade cell («شمالي», «جنوبي غربي», «3 شوارع», «شمالي جنوبي»). It was
filed only in additional_info: on 2026-10-11, 103 active ads had a single bearing and the direction column was
NULL on all of them, so the Advanced Filter's direction question never found one. One bearing is stored; a pair
or «N شوارع» stays NULL (the same cell offers «شمالي جنوبي», so a pair can be two streets, not a diagonal).
"""
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.mustqr.run import map_listing  # noqa: E402


def _p(direction):
    return {"id": 4311, "type": "أرض", "category": "بيع", "usage_type": "سكني", "price": 500000,
            "area_sqm": 600, "neighborhood": "جوهرة السويفلة", "direction": direction}


@pytest.mark.parametrize("cell,stored", [("شمالي", "شمال"), ("جنوبي", "جنوب"), ("غربي", "غرب"), ("شرقي", "شرق")])
def test_a_single_bearing_is_stored(cell, stored):
    row, _ = map_listing(_p(cell), {})
    assert row["direction"] == stored
    assert row["additional_info"]["direction_ar"] == cell      # the raw cell is kept


@pytest.mark.parametrize("cell", ["شمالي شرقي", "شمالي جنوبي", "3 شوارع", None])
def test_anything_else_is_unknown(cell):
    row, _ = map_listing(_p(cell), {})
    assert row["direction"] is None
