"""daryusuf: a sale filed under a «…-for-rent» category is a sale when its own title AND URL say so (2026-10-31).

13109421 «Villa for sale in Al Matar district, Al Madinah», /villa-for-sale-on-al-jundalah-street-…/, heading
«1,480,000 SAR», sits in `villas-for-rent`: the category won and it was stored as a 1.48 M yearly rent, so no sale
search found it (customer-journey run 41171569517). 13109370 (building, «2,100,000 SAR») is the same. 13109379 is
the mirror case — title «Villa for sale», URL /building-for-rent-…/, «220,000 SAR per year» — and IS a rent.
Rule: category and title disagree → the post's own URL slug decides; no tie-breaker → skipped, never guessed.
"""
from __future__ import annotations

from scrapers.common.tests.test_daryusuf_bilingual_twins_price_heading_and_facts import (  # noqa: F401
    DYS_9355, TERMS, R, _no_catalog_network)

SALE_HEADING = DYS_9355["content"]["rendered"].replace("<h2>30,000 SAR/ Year</h2>", "<h2>1,480,000 SAR</h2>")


def _post(title, link, content=SALE_HEADING):
    return dict(DYS_9355, title={"rendered": title}, link=link, content={"rendered": content})


def test_title_and_url_say_sale_under_a_rent_category_is_a_sale():
    row, _, why = R.map_listing(_post("Apartment for sale, Al Iskan District, Madinah",
                                      "https://daryusuf.com/en/portfolio/apartment-for-sale-al-iskan-district-madinah/"),
                                TERMS)
    assert why == "" and row["transaction_type"] == "Buy"
    assert row.get("price_total") == 1480000 and not row.get("price_annual")


def test_url_says_rent_keeps_the_rent_13109379_shape():
    row, _, why = R.map_listing(_post("Apartment for sale, Al Iskan District, Madinah",
                                      "https://daryusuf.com/en/portfolio/apartment-for-rent-al-iskan-district-madinah/",
                                      DYS_9355["content"]["rendered"]), TERMS)
    assert why == "" and row["transaction_type"] == "Rent"


def test_no_tie_breaker_is_skipped_never_guessed():
    assert R.map_listing(_post("Apartment for sale, Al Iskan District, Madinah",
                               "https://daryusuf.com/en/portfolio/apartment-al-iskan-district-madinah/"),
                         TERMS)[2] == "deal_conflict"


def test_agreeing_category_and_title_are_untouched():
    row, _, why = R.map_listing(DYS_9355, TERMS)
    assert why == "" and row["transaction_type"] == "Rent"


def test_url_slug_deal():
    assert R.url_slug_deal("https://daryusuf.com/en/portfolio/villa-for-sale-on-al-jundalah-street-x/") == "Buy"
    assert R.url_slug_deal("https://daryusuf.com/en/portfolio/building-for-rent-on-x/") == "Rent"
    assert R.url_slug_deal("https://daryusuf.com/portfolio/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-x/") == "Buy"
    assert R.url_slug_deal("https://daryusuf.com/en/portfolio/villa-x/") is None
