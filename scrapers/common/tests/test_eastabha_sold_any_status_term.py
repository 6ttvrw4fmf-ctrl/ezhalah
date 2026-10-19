"""eastabha: a sold/rented term anywhere in property_status hides the ad (2026-10-02).

Only the FIRST property_status term was read, so EA35661 and EA34780 stayed active while a later
term said تأجرت / تم البيع. listing_status() is executed against real-shaped term lists.
"""
from __future__ import annotations

import scrapers.eastabha.run as R

TAX = {"property_status": {1: "للإيجار", 2: "تأجرت", 3: "تم البيع", 4: "مزاد علني", 5: "للبيع"}}


def _p(*ids):
    return {"property_status": list(ids)}


def test_gone_term_in_second_position_hides():
    assert R.listing_status(_p(1, 2), TAX) == ("تأجرت", True)
    assert R.listing_status(_p(5, 3), TAX) == ("تم البيع", True)


def test_gone_term_first_still_hides():
    assert R.listing_status(_p(3), TAX) == ("تم البيع", True)


def test_no_gone_term_stays_active_with_first_label():
    assert R.listing_status(_p(1, 4), TAX) == ("للإيجار", False)   # auctions are not gated
    assert R.listing_status(_p(), TAX) == (None, False)
    assert R.listing_status(_p(99), TAX) == (None, False)          # unknown id: neutral
