"""A monthly rent's ÷12 is compared as the card prints it (🆕 2026-11-10, superoffice cap 80 %).

superoffice_commercial_listings:25881144 (score job 129653650048): the page prints the monthly price «1,225» (its
data says 1225.12), price_annual is the bigint 14701, so the served ÷12 is 1225.083. The card prints
Math.round(14701 / 12) = «1,225» (src/lib/listingDisplay.ts monthlyLineText) — the page's own figure."""
from scrapers.common.new_listings_score import MATCH, compare_listing
from scrapers.common.source_reread import page_evidence

BODY = ('<html><body><h1>M9 — مكاتب خاصة, السويدي</h1>'
        '<div class="price">السعر 1,225 ريال / شهري</div></body></html>')


def _price(annual):
    return compare_listing({"price_annual": annual, "rent_period_ar": "شهري"}, page_evidence(BODY))["price"]


def test_the_figure_the_card_prints_matches_the_page():
    assert _price(14701) == MATCH            # 1225.083 → card «1,225»


def test_an_exact_monthly_still_matches():
    assert _price(14700) == MATCH            # 1225 exactly


def test_a_different_monthly_is_still_wrong():
    assert _price(15600) != MATCH            # 1300 → card «1,300», page «1,225»


def test_one_riyal_off_on_the_card_is_still_wrong():
    assert _price(14713) != MATCH            # 1226.08 → card «1,226»
