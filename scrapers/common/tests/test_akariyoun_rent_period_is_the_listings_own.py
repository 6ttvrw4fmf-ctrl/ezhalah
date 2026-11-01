"""akariyoun: a rental's period is read from the listing's own «طريقة الدفع» field (2026-10-13, backlog 493).

All 191 searchable akariyoun rentals stored rent_period NULL, so no rent search found one, while every
rental page prints «طريقة الدفع : سنوي» (CI source-reread runs 38351216475 / 38351715817, markup below is
verbatim from https://akariyoun.sa/properties/shk-llaygar-fy-hy-ashbyly-8). The fleet rule decides
(normalize.rent_period_from_ad): the ad's own text tying a period to THIS price wins, then <= 10,000 is
monthly, then the title, then the site's field.
"""
from scrapers.akariyoun import run as AK

AK.find_district_in_text = lambda text, city_id: text
AK.to_catalog = lambda city: (1, 1)  # hermetic: the catalog lookup is a DB read, not what this file tests

PAY = """<h6 class="prt-price-fix text-warning"><span
        class="badge badge-warning">طريقة الدفع</span>
    : {v}
</h6>"""

RENT = """<html><head><title>شقة للإيجار في حي إشبيلية - Akariyoun</title></head><body>
<h5 class="prt-price-fix"><span class="badge badge-success">السعر</span>
        : 87,000 </h5>
{pay}
<span>الرياض - إشبيلية</span> <p>المساحة: 132 m²</p><p>عدد الغرف: 3 غرفة</p>
<p>رقم الاعلان : 1201</p><p>نوع العقار: شقة</p><p>للإيجار</p>
<h4 class="property_block_title">الوصف</h4><div class="block-body"><p>{desc}</p></div>
</body></html>"""


def _row(pay_value=None, desc="للإيجار شقة دور أرضي<br>السعر : 87,000"):
    page = RENT.format(pay=PAY.format(v=pay_value) if pay_value else "", desc=desc)
    row, _cat, _raw = AK.map_listing("shk-x", page)
    return row


def test_the_field_is_read():
    assert AK.parse_payment_period(PAY.format(v="سنوي")) == "annual"
    assert AK.parse_payment_period(PAY.format(v="شهري")) == "monthly"


# Verbatim live markup (CI source-reread 38515266387, 2026-10-14): the closing tag sits on its own line,
# indented ~52 spaces. The 10-13 pattern needed «</h6>» within 30 characters of the value and read
# nothing on every live page.
LIVE = ('<h6 class="prt-price-fix text-warning"><span\n'
        + ' ' * 60 + 'class="badge badge-warning">طريقة الدفع</span>\n'
        + ' ' * 56 + ': {v}\n' + ' ' * 52 + '</h6>')


def test_the_live_indented_markup_is_read():
    assert AK.parse_payment_period(LIVE.format(v="سنوي")) == "annual"
    assert AK.parse_payment_period(LIVE.format(v="شهري")) == "monthly"
    assert AK.parse_payment_period(LIVE.format(v="نصف سنوي")) is None
    page = RENT.format(pay=LIVE.format(v="سنوي"), desc="للإيجار شقة دور أرضي")
    row, _cat, _raw = AK.map_listing("shk-llaygar-fy-hy-ashbyly-8", page)
    assert row["rent_period"] == "annual" and row["price_annual"] == 87000


def test_a_value_with_no_bucket_is_unknown():
    for v in ("نصف سنوي", "ربع سنوي", "دفعات", "-"):
        assert AK.parse_payment_period(PAY.format(v=v)) is None, v
    assert AK.parse_payment_period("<h5>السعر : 1</h5>") is None


def test_an_annual_rental_is_annual_and_its_price_unchanged():
    row = _row("سنوي")
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 87000


def test_no_field_keeps_the_period_unknown():
    row = _row(None)
    assert "rent_period" not in row
    assert row["price_annual"] == 87000


def test_the_ads_own_text_beats_the_field():
    """«7,250 شهري» ×12 = 87,000: the ad says the stored figure is a year of monthly payments."""
    row = _row("شهري", desc="الإيجار 7,250 شهري")
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 87000
