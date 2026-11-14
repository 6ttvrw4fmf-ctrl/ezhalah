"""A priceless rent's card prints «السعر عند الطلب» with no period (owner 2026-09-28): the parity robot must not
call the missing period a card defect, and must still catch a PRICED rent whose card drops its period.
hazim 13106686 (yearly, priceless) raised card_parity_card_missing:hazim:rent_period on 5 nights for this."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.card_parity import card_shows  # noqa: E402


def test_priceless_yearly_rent_has_no_period_to_look_for():
    stored = {"rent_period_ar": "سنوي", "price_annual": None, "price_total": None}
    assert card_shows("rent_period", stored, "عمارة للإيجار الخبر حي قرطبة السعر عند الطلب") is None


def test_priced_rent_without_its_period_is_still_caught():
    stored = {"rent_period_ar": "سنوي", "price_annual": 60000}
    assert card_shows("rent_period", stored, "شقة للإيجار 60,000 ريال") is False


def test_priced_rent_with_its_period_matches():
    stored = {"rent_period_ar": "سنوي", "price_annual": 60000}
    assert card_shows("rent_period", stored, "شقة للإيجار 60,000 ريال سنوياً") is True
