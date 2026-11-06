"""eaqartabuk «استثمار» (operation=investment) states neither sale nor rent; the ad's own words decide.

Backlog 1358 (2026-11-06): 24206284 «هنجر للايجار حي المصيف» (200,000, status «استثمار») was filed Buy because
the mapper read every non-rent operation as a sale. 4 live investment ads: 2 titles say rent, 0 say sale.
An investment ad whose own title/excerpt says rent (and not sale) is a Rent; anything else keeps the old reading.

Run: python -m pytest scrapers/common/tests/test_eaqartabuk_investment_offered_for_rent.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.eaqartabuk.run import investment_offered_for_rent, map_listing  # noqa: E402


def _item(title, excerpt=""):
    return {"id": 24206284, "title": title, "link": "https://eaqartabuk.com/?p=24206284", "date": "2026-11-04",
            "meta": {"price": "200000"}, "featured_image": None, "excerpt": excerpt}


def _mp(op, status):
    return {"usage": "commercial", "operation": op, "status": status, "city": "تبوك", "district": "المصيف",
            "type": "معرض / هنجر"}


def test_investment_ad_that_says_rent_is_a_rental():
    row, _ = map_listing(_item("هنجر للايجار حي المصيف"), _mp("investment", "استثمار"), None, [])
    assert row["transaction_type"] == "Rent", "the ad's own «للايجار» was filed as a sale"
    row, _ = map_listing(_item("هنجر للإيجار في حي الريان تبوك"), _mp("investment", "استثمار"), None, [])
    assert row["transaction_type"] == "Rent"


def test_investment_ad_without_rent_words_keeps_the_old_reading():
    row, _ = map_listing(_item("معارض في حي المصيف في تبوك"), _mp("investment", "استثمار"), None, [])
    assert row["transaction_type"] == "Buy"
    assert not investment_offered_for_rent("investment", "استثمار", "أرض للبيع أو الإيجار", "")


def test_a_sale_ad_never_becomes_a_rental():
    row, _ = map_listing(_item("هنجر للايجار سابقا"), _mp("sale", "بيع"), None, [])
    assert row["transaction_type"] == "Buy"


def test_natural_ventilation_is_not_a_sale_word():
    assert investment_offered_for_rent("investment", "استثمار", "هنجر للايجار بتهوية طبيعية", "")
    assert not investment_offered_for_rent("investment", "استثمار", "هنجر للايجار وللبيع", "")
    assert not investment_offered_for_rent("investment", "استثمار", "هنجر للايجار أو البيع", "")
    assert not investment_offered_for_rent("investment", "استثمار", "هنجر للإيجار أو بالبيع", "")


def test_a_rental_keeps_its_published_figure_when_the_period_is_silent():
    row, _ = map_listing(_item("هنجر للايجار حي المصيف"), _mp("investment", "استثمار"), "<p>هنجر</p>", [])
    assert row["price_annual"] == 200000, "the published figure was dropped"
    from scrapers.common import db
    assert row.get("rent_period") in (None, db.AUTHORITATIVE_NULL), "a period was invented"


def test_a_flipped_row_clears_its_stale_sale_total_even_when_the_price_is_on_request():
    from scrapers.common import db
    row, _ = map_listing(_item("هنجر للايجار حي المصيف", "السعر حسب النشاط"), _mp("investment", "استثمار"), None, [])
    assert row["transaction_type"] == "Rent"
    assert row["price_total"] is db.AUTHORITATIVE_NULL, "the stored sale figure would survive on a rental"


def test_conflicting_periods_are_ambiguous_not_silent():
    from scrapers.eaqartabuk.run import _price
    assert _price("3000", True, "شقة للايجار شهري أو سنوي") == (None, None, None), "a two-period ad was judged as silent"
    assert _price("3000", True, "شقة للايجار") == (None, 3000, None)


def test_a_re_scrape_never_pairs_a_new_figure_with_a_stale_period():
    """Two consecutive crawls through the real upsert guard: first «شهري», then the ad drops its period / states both."""
    from scrapers.common import db
    stored = {}

    def crawl(title):
        row, _ = map_listing(_item(title), _mp("rent", "إيجار"), "<p>شقة</p>", [])
        db._unknown_must_not_overwrite_known(row)
        for k in ("price_annual", "rent_period"):
            if k in row:
                stored[k] = row[k]
        return stored

    assert crawl("شقة للايجار شهري") == {"price_annual": 2400000, "rent_period": "monthly"}
    assert crawl("شقة للايجار") == {"price_annual": 200000, "rent_period": None}, "a stale «monthly» survived"
    crawl("شقة للايجار شهري")
    assert crawl("شقة للايجار شهري أو سنوي") == {"price_annual": None, "rent_period": None}, "an old price lingered"


def test_a_priced_rental_that_turns_on_request_clears_its_figure_and_period():
    from scrapers.common import db
    stored = {}
    for title, excerpt in (("شقة للايجار شهري", ""), ("شقة للايجار شهري", "السعر حسب مدة العقد")):
        row, _ = map_listing(_item(title, excerpt), _mp("rent", "إيجار"), None, [])
        db._unknown_must_not_overwrite_known(row)
        stored.update({k: row[k] for k in ("price_annual", "rent_period") if k in row})
    assert stored == {"price_annual": None, "rent_period": None}, stored


def test_a_failed_detail_fetch_never_clears_a_stored_period():
    from scrapers.common import db
    row, _ = map_listing(_item("شقة للايجار"), _mp("rent", "إيجار"), None, [])
    db._unknown_must_not_overwrite_known(row)
    assert "rent_period" not in row and "price_annual" not in row, "an unread detail page split the stored pair"
    row, _ = map_listing(_item("شقة للايجار"), _mp("rent", "إيجار"), "<p>الإيجار شهري</p>", [])
    assert row["rent_period"] == "monthly", "the detail text's own period was ignored"


def test_a_failed_detail_fetch_keeps_the_stored_price_and_period_together():
    from scrapers.common import db
    stored = {}
    for desc in ("<p>الإيجار شهري</p>", None):            # crawl 1 reads «شهري»; crawl 2's detail fetch fails
        row, _ = map_listing(_item("شقة للايجار"), _mp("rent", "إيجار"), desc, [])
        db._unknown_must_not_overwrite_known(row)
        stored.update({k: row[k] for k in ("price_annual", "rent_period") if k in row})
    assert stored == {"price_annual": 2400000, "rent_period": "monthly"}, stored
