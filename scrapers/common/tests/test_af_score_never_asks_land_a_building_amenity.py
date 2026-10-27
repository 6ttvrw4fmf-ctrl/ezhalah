"""af_score asks only what the Advanced Filter really offers: a land is never asked a building amenity (🔬, 2026-10-27).

Every land cohort in src/lib/afCohorts.ts (Residential/Commercial/Industrial/Raw/Other Land) asks street width and
facade only, and COHORT_CHIPS gives no land a building chip. The 10-27 08:00 score asked «kitchen» of six lands
(abaad_residential_listings:13214743, 15465685, 13214688; jurash 11236926, 15706513; opensooq 15832208) and
counted 6 of its 29 findability misses on a question no customer can give.

Run: python -m pytest scrapers/common/tests/test_af_score_never_asks_land_a_building_amenity.py -v
"""
from __future__ import annotations

import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import af_score as S  # noqa: E402


@pytest.mark.parametrize("t", ["أرض سكنية", "أرض تجارية", "أرض صناعية", "أرض خام", "أرض"])
def test_land_is_never_asked_an_amenity(t):
    assert S.offered(["kitchen", "elevator"], {"type_ar": t, "deal_ar": "بيع"}) == []
    assert S.offered(["furnished"], {"type_ar": t, "deal_ar": "إيجار", "rent_period_ar": "سنوي"}) == []


def test_a_flat_is_still_asked():
    assert S.offered(["kitchen", "elevator"], {"type_ar": "شقة", "deal_ar": "بيع"}) == ["kitchen", "elevator"]


def test_monthly_still_drops_furnished_only():
    st = {"type_ar": "شقة", "deal_ar": "إيجار", "rent_period_ar": "شهري"}
    assert S.offered(["furnished", "kitchen"], st) == ["kitchen"]
