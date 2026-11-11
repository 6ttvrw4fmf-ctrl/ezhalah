"""A plot's licence figure that the ad prints as its AREA, a plot number, a share or an age is not a stated total
(owner launch audit 2026-11-11, «we can get sued»).

Haraj's REGA licence block carries «سعر الوحدة» — on land, sometimes the total and sometimes the metre price.
`land_price_basis()` lets the ad's own words decide: a figure the seller writes beside a price word is a total. It
used to count ANY appearance of the figure as such a statement, so 24 plots under their city's price floor were
served as totals of 2 to 2,800 SAR — the figure also appeared as the area («المساحة: 300 متر» on a 300 m² plot),
a plot number («قطعة رقم 341»), the ownership share («نسبة التملك: 100%»), the post's age («قبل 3 ساعات») or the 2
of «م2». Each text below is the real one (row id in the comment); the old reader answered «total» on every one.

Run: python -m pytest scrapers/common/tests/test_haraj_land_figure_printed_as_something_else_2026_11_11.py -v
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.haraj.run as R  # noqa: E402  -- the REAL module

WAS_A_TOTAL_IS_A_RATE = [
    (2, 420, "🏷 للبيع أرض سكنية 📍 حي العليا الجنوبي - مخطط 121 - ▪ رقم القطعة: 210 ▪ المساحة: 420 م2 ▪ الشارع: جنوبي 30 م"),  # 18563059
    (3, 308, "🔔فرصة للبيع🔔 أرض للبيع بجدة تحديث قبل 3 ساعات مساحة الأرض 308 م"),                                    # 18590798
    (100, 450, "قطعه | 840/2 حي | الروضة المساحه | 450 م2 شارع | 25 شمالي بصك حر بنسبة تملك 100% للموقع"),           # 18924640
    (100, 300, "📐 المساحة: 300 م2 عرض الشارع: 36 مترًا 🔐 نسبة التملك: 100% ✅ 💵 سعر البيع: 30,000 ريال صافي"),     # 23801500
    (100, 400, "📐 مساحة الأرض: 400 م2 🔐 نسبة التملك: 100% ✅ 💰 سعر البيع: 40,000 ريال فقط"),                      # 23801501
    (300, 300, "للبيع أرض في بقيق - عين دار القديمة المساحة: 300 متر المطلوب: 90,000"),                                # 24337153
    (300, 300, "✍🏻مخطط 1051 ✍🏻قطعه رقم / 555/2 🔹موقع مميز 🔹مساحة 300م ⭐واجهه شرقيه 15"),                           # 18841587
    (300, 300, "مخطط 1051 حي الروابي ارضين متلاصقه مساحة كل قطعه 300 شوارع مزفلته"),                                 # 18911848
    (341, 544, "المساحة : 543 م حدودها :- شمالا : قطعة رقم 341 وقطعة رقم 342 بطول 25 م"),                             # 23236543
    (400, 400, "⁠المساحة : 400 م2 -⁠ ⁠واجهة العقار : الشارع شمال 15 م - ⁠السعر : 160000"),                               # 18911724
    (406, 406, "📐 المساحة: 406 م2 🔢 رقم القطعة: 52 السعر المطلوب: 165,000 ريال"),                                   # 18897957
    (450, 1176, "رقم المخطط940 رقم القطعة 451 المساحة 1.176م2 شمالاً: قطعه رقم 450 و مسجد بطول: 24م"),                 # 18897948
    (750, 600, "مساحة : 5000 متر بالبوابه الصناعيه مساحة : 750 متر شارع عرض : 20 متر"),                               # 23548266
    (800, 800, "مخطط رقم 721 رقم الارض 1173 مساحة 800 م شارع 30 شمالي بطول 20 م السوم 565 الف"),                       # 18743947
    (1000, 1000, "📐 مساحة الأرض: 1000 م2 📏 الأطوال: 40 × 25 م 💰 السعر: على السوم"),                                 # 25557526
    (1481, 844, "🔹 المساحة: 843.8م2 🔹قطعة: 1481 🔹 الواجهة: جنوبية على شارع عرض 25م"),                               # 25955544
    (2000, 2000, "المساحة 2000 متر على شارعين بعرض 15 لكل منهما السعر على السوم"),                                    # 18743584
    (2800, 2800, "رقم القطعة: 2360 المساحة: 2,800 م2 المطلوب: 8,400,000 ريال"),                                       # 20464323
    (7000, 680, "المساحة : 680م المخطط : 3158 بلك : 48 القطعة : 587 البيع : 7000 المتر على شور"),                     # 18749675
]


@pytest.mark.parametrize("price,area,text", WAS_A_TOTAL_IS_A_RATE, ids=lambda x: str(x)[:24])
def test_a_figure_printed_as_area_plot_share_or_age_is_not_a_stated_total(price, area, text):
    assert R.land_price_basis(price, area, text) == "per_meter"


STAYS_A_TOTAL = [
    (750, 1008, "أرض بمساحة مناسبة وموقع واعد، عليها سوم 750 والبيع قريب"),        # 11189120675: «سوم 750» is a price
    (400000, 473.7, "السعر المطلوب: 400,000 ريال وسعر المتر التقريبي: 844.4"),        # 11190690713: a stated total
    (1600, 300, "رقم القطعة 3215 رقم مخطط 3930 مساحة 300 الواجهة جنوبية شارع 20 البيع 1600"),   # 22868665: «البيع 1600»
    (2150, 700, "📐 المساحة 700م2 💰 السعر 2,150 ريال/ فقط"),                         # 18777649: «السعر 2,150»
    (1400, 800, "▪ المساحة 800 م ▪ شارع عرض 40 💵 السعر 1,400 ▪ مع المباشر"),         # a price word wins over a near area
    (1400, 800, "أرض للبيع المساحة 800 م عرض 1400 ريال"),                            # «عرض» = an offer when riyals follow
    (1400, 800, "أرض للبيع المساحة 800 م حد 1400 ريال"),                             # (CodeRabbit on #11747)
]


def test_a_figure_in_thousands_is_neither_a_total_nor_a_metre_price():
    # «السوم 565 الف» = 565,000: storing 565 as the total, or 565 × the area, would both invent a price
    assert R.land_price_basis(565, 800, "مساحة 800 م شارع 30 السوم 565 الف") is None
    assert R.land_price_basis(565, 800, "مساحة 800 م شارع 30 المطلوب 565 ألف ريال") is None


def test_a_later_metre_price_wins_over_an_earlier_thousands_mention():
    # CodeRabbit on #11747: «السوم 565 الف؛ سعر المتر 565 ريال» states the metre price; reading stops at neither mention
    assert R.land_price_basis(565, 800, "السوم 565 الف؛ سعر المتر 565 ريال") == "per_meter"


@pytest.mark.parametrize("price,area,text", STAYS_A_TOTAL, ids=lambda x: str(x)[:24])
def test_a_figure_the_seller_writes_beside_a_price_word_stays_a_total(price, area, text):
    assert R.land_price_basis(price, area, text) == "total"


def test_the_metre_word_after_a_price_is_the_metre_price():
    assert R.land_price_basis(7000, 680, "البيع : 7000 المتر") == "per_meter"
    assert R.land_price_basis(1100, 900, "المطلوب 1100 المتر") == "per_meter"


@pytest.mark.parametrize("area", [None, 0, 40])
def test_the_metre_word_needs_no_price_word_and_no_area(area):
    # CodeRabbit on #11747: with no usable area the magnitude rule cannot decide, so the wording itself must
    assert R.land_price_basis(7000, area, "أرض للبيع في حي العارض 7000 المتر على شارعين") == "per_meter"


@pytest.mark.parametrize("text", ["بطول 30 المتر", "شارع عرض 30 المتر", "قطعة رقم 30 المتر"])
def test_a_length_or_number_before_the_metre_word_is_not_a_price(text):
    # CodeRabbit on #11747: only the AREA used to be excluded; a length or a plot number stays a measurement too
    assert R.land_price_basis(30, None, text) is None


def test_a_numbered_list_item_is_not_a_stated_total():
    # HRJ 11190023115: «1- تم استخراج كاروكي … 2-تم عمل فحص تربه 3-تم الاتفاق …» and licence «سعر الوحدة: 3»
    text = "مميزات الأرض 1- تم استخراج كاروكي للارض 2-تم عمل فحص تربه 3-تم الاتفاق مع مكتب هندسي بقيمة 11000"
    assert R.land_price_basis(3, 308, text) == "per_meter"


@pytest.mark.parametrize("text", ["السعر المطلوب (50000) ريال", "المطلوب ( 50000 )", "السعر (50000)"])
def test_a_price_in_brackets_stays_a_stated_total(text):
    # CodeRabbit on #11799: «)» closing a bracket is not a list-item marker
    assert R.land_price_basis(50000, 600, text) == "total"


def test_a_currency_word_belongs_to_the_figure_before_it():
    # «السعر 500 ريال 300 م2»: the riyal is 500's; 300 is the area, never a stated total (the ladder decides)
    assert R._printed_as_something_else("السعر 500 ريال 300 م2", list(R._NUMS.finditer("السعر 500 ريال 300 م2"))[1])
    assert R.land_price_basis(300, 300, "السعر 500 ريال 300 م2") == "per_meter"


def test_an_area_written_with_the_metre_word_is_still_an_area():
    assert R._printed_as_something_else("المساحة 1000 المتر", next(R._NUMS.finditer("المساحة 1000 المتر")))


@pytest.mark.parametrize("text", ["المساحة 300 متر", "مساحة 300م", "300 م2", "قطعة رقم 300", "نسبة 300%", "قبل 300 ساعة",
                                  "شارع عرض 300 متر", "حد 300 م"])
def test_each_non_price_shape_alone_is_not_a_mention(text):
    # alone, a 300 on 300 m² has no stated basis: the ladder's magnitude rule decides (a figure no plot sells for)
    assert R.land_price_basis(300, 300, text) == "per_meter"


def test_a_big_figure_printed_only_as_an_area_is_not_called_a_total_from_the_area():
    # 150,000 m² written as the area must not make a 150,000 licence figure a «stated» total; the magnitude rule
    # still calls a figure no metre costs a total — the point is that the AREA mention is not what decided it.
    assert R._printed_as_something_else("المساحة: 150000 م2", next(R._NUMS.finditer("المساحة: 150000 م2")))


def test_the_old_reader_would_have_said_total_on_these_texts():
    """Proof the guard bites: with the exclusion switched off, the first real case reads «total» again."""
    real = R._printed_as_something_else
    try:
        R._printed_as_something_else = lambda t, m: False
        price, area, text = WAS_A_TOTAL_IS_A_RATE[3]
        assert R.land_price_basis(price, area, text) == "total"
    finally:
        R._printed_as_something_else = real
