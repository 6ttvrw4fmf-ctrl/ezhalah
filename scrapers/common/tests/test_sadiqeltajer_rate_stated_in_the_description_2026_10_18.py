"""sadiqeltajer: a figure the ad's own description states «للمتر» is a rate, not a total (2026-10-18).

SDQ5562 prints «550 ريال» in its header and «الحد ( 550 ريال للمتر )» in its description; it was stored as a
550 SAR total for a 481 m² plot. The marker must follow the SAME figure on THAT ad: no marker keeps the total
exactly as printed (PRICE = SOURCE). TEXT is the ad's own section, recorded verbatim (2026-10-18).

Run: python -m pytest scrapers/common/tests/test_sadiqeltajer_rate_stated_in_the_description_2026_10_18.py -v
"""
import pytest

import scrapers.sadiqeltajer.run as S

TEXT = ("--> ارضين بحي الفيصلية ( مخطط قمة الشرق ) شرق بريدة --> بيع ارض كود الاعلان : 5562 | رقم اللوحة : 2353 (حد) "
        "ارضين بحي الفيصلية ( مخطط قمة الشرق ) شرق بريدة 550 ريال 481 م² اللوكيشن واجهة الشارع: شارع شرقي 19متر "
        "تفاصيل الإعلان للبيع ارضين بحي الفيصلية ( مخطط قمة الشرق )شرق بريدة الحد ( 550 ريال للمتر ) المساحة : قطعه "
        "486م و الثانيه 481م رقم الارض : 6 / 7 رقم المخطط : 1773 / ق/ب الاطــوال لكل قطعة : 13م * 36م شارع : شرقي 19 م "
        "× الموقع حسب الصك من وزارة العدل القصيم - بريدة - الفيصلية")


def test_5562_is_550_per_metre_and_no_total():
    assert S.parse_price(TEXT) == (None, 550)


@pytest.mark.parametrize("desc, expected", [
    ("الحد ( 550 ريال )", (550, None)),                    # the description restates it with no marker: a total
    ("الحد ( 600 ريال للمتر )", (550, None)),              # a per-metre phrase about ANOTHER figure
    ("الحد ( 1550 ريال للمتر )", (550, None)),             # 550 inside a bigger number is not 550
])
def test_mutation_no_marker_on_this_figure_keeps_the_total(desc, expected):
    assert S.parse_price(TEXT.replace("الحد ( 550 ريال للمتر )", desc)) == expected


def test_arabic_digits_and_thousands_separators_are_the_same_figure():
    text = TEXT.replace("550 ريال 481", "1,100 ريال 481").replace("الحد ( 550 ريال للمتر )", "السوم ١١٠٠ للمتر")
    assert S.parse_price(text) == (None, 1100)


def test_the_row_clears_a_stored_total_when_the_source_states_a_rate(monkeypatch):
    from scrapers.common import db
    monkeypatch.setattr(S, "to_catalog", lambda city_ar, region_ar=None: (1, 1))
    monkeypatch.setattr(S, "resolve_district_words", lambda text, city_id: (None, None))
    monkeypatch.setattr(S, "own_section", lambda html: TEXT)
    row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/llbyaa-ardyn-bhy-alfysly-mkhtt-km-alshrk-shrk-bryd", "<html/>")
    assert row is not None, why
    assert row["price_per_meter"] == 550
    assert row["price_total"] is db.AUTHORITATIVE_NULL        # a plain None would leave the stored 550 total


# 2026-10-18, the other sadiqeltajer rows under the city floor (recorded description lines, verbatim):
# tatweel inside «ريـــال» hid the marker after the figure, and a marker BEFORE the figure was never read.
@pytest.mark.parametrize("line, n", [
    ("للبيع ارض بحي الرحاب شمال بريدة الســــوم ( 1060 ريـــال للمتر ) المساحة : 1000م", 1060),   # SDQ6107
    ("شارعين شمالي 20 وغربي 15 الاطوال 22*20 البيع للمتر 460 قريبه من طريق عائشه", 460),         # SDQ6985
    ("المساحة لكل قطعه 375 على السوم مقابل اسواق سبت وقريبه من طريق البيارق السوم للمتر 700", 700), # SDQ7097
])
def test_tatweel_and_a_marker_before_the_figure_still_state_the_rate(line, n):
    text = TEXT.replace("550 ريال 481", f"{n} ريال 481").replace("الحد ( 550 ريال للمتر )", line)
    assert S.parse_price(text) == (None, n)


def test_mutation_a_bare_figure_with_parenthesised_currency_stays_a_total():
    # SDQ8769 «800 ريال ( ريال )»: the bracket repeats the currency, no rate
    text = TEXT.replace("550 ريال 481", "800 ريال ( ريال ) 481").replace("الحد ( 550 ريال للمتر )", "الحد ( 800 ريال )")
    assert S.parse_price(text) == (800, None)
