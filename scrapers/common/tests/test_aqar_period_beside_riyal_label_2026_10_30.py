"""aqar: the rent period survives the «ريال» label aqar added between the figure and «/سنوي» (2026-10-30).

Since ~2026-10-18 aqar's price slot renders `<span>3,700<span aria-hidden> §</span><span> ريال </span></span>/سنوي`
(live markup of ad 6942821, captured 2026-10-30) and its payload sends `rent_period: null`. The old one-character
currency slot missed it, so new aqar rentals went 95% → ~55% with a period and fell out of the «سنوي» filter.
"""
import pytest

from scrapers.aqar.enrich_residential import _html_to_text, _period_beside

LIVE_6942821 = ('<h2>مكتب تجاري للإيجار</h2><div><h3><span>3,700<span aria-hidden="true"> <!-- -->§</span>'
                '<span><span> ريال </span></span></span>/<!-- -->سنوي</h3></div>')
LIVE_6942589_RNPL = ('<h3><span>50,000<span aria-hidden="true"> §</span><span><span> ريال </span></span></span>/سنوي</h3>'
                     '<p>استأجر الآن وأدفع لاحقًا ابتداءً من4,459 <span>§</span><span> ريال </span> شهريا</p>')


def test_live_markup_with_riyal_label_reads_annual():
    assert _period_beside(3700, _html_to_text(LIVE_6942821)) == "annual"


def test_rnpl_page_still_reads_the_rent_not_the_instalment():
    text = _html_to_text(LIVE_6942589_RNPL)
    assert _period_beside(50000, text, is_rnpl_page=True) == "annual"
    assert _period_beside(4459, text, is_rnpl_page=True) is None   # an instalment is never the period


@pytest.mark.parametrize("text, want", [
    ("69,000 §/سنوي", "annual"),            # the pre-10-18 shape keeps working
    ("5,000 § ريال /شهري", "monthly"),
    ("5,000 ر.س شهري", "monthly"),
    ("٤٠٬٠٠٠ ريال سنوي", None),               # a different figure (40,000) — anchored, so no answer for 3,700
])
def test_currency_tokens_between_figure_and_period(text, want):
    price = 5000 if "5,000" in text else (69000 if "69,000" in text else 3700)
    assert _period_beside(price, text) == want


def test_a_different_figure_never_supplies_the_period():
    assert _period_beside(3700, _html_to_text("<span>2,500</span> § ريال /سنوي")) is None
