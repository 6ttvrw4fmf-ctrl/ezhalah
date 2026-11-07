"""The period word NEAREST the price decides it (2026-11-07, haraj 24760182).

«الإيجار الشهري 2500ريال الإيجار السنوي 28000ريال»: 28,000 is the YEARLY rent. The old reader took the first
period word with the price anywhere in its ±40-char window («الشهري» reaches 28000 too), called it monthly and
stored 336,000 a year — twelve times the ad's own figure.
"""
from scrapers.common import normalize as N

HARAJ_24760182 = ("للإيجار شقة مكونه من مجلس وصاله، و غرفتين و2دورات مياه الإيجار الشهري 2500ريال "
                  "الإيجار السنوي 28000ريال تاريخ انتهاء رخصة الإعلان : 2027-05-31")


def test_yearly_figure_next_to_a_monthly_one_stays_yearly():
    assert N.stated_rent_period(28000, HARAJ_24760182) == "annual"
    period, annual = N.rent_period_from_ad(28000, HARAJ_24760182, None, "شقة للإيجار في حي بدر النموذجي الرياض")
    assert period == "annual" and annual == 28000


def test_the_monthly_figure_of_the_same_ad_is_still_monthly():
    assert N.stated_rent_period(2500, HARAJ_24760182) == "monthly"


def test_reversed_order_and_single_words():
    assert N.stated_rent_period(30000, "السعر السنوي 30000 او الشهري 2800") == "annual"
    assert N.stated_rent_period(2800, "السعر السنوي 30000 او الشهري 2800") == "monthly"
    assert N.stated_rent_period(4000, "ايجار شهري 4000 ريال") == "monthly"
    assert N.stated_rent_period(48000, "ايجار شهري 4000 ريال") == "annual"   # monthly ×12 = price
    assert N.stated_rent_period(4000, "شقة للإيجار 4000") is None


def test_a_label_pairs_with_its_own_figure_coderabbit_11030():
    # «شهري السعر: 2500 ريال سنوي 28000»: 2500 has «شهري» before it and «سنوي» after it → it is the monthly one;
    # 28000 has «سنوي» right before it and «شهري» is cut off by 2500 → yearly.
    t = "شهري السعر: 2500 ريال سنوي 28000"
    assert N.stated_rent_period(2500, t) == "monthly"
    assert N.stated_rent_period(28000, t) == "annual"
    period, annual = N.rent_period_from_ad(2500, t, None)
    assert period == "monthly" and annual == 30000


def test_a_room_count_does_not_separate_a_label_from_its_price():
    assert N.stated_rent_period(60000, "إيجار سنوي فيلا 5 غرف 60000 ريال") == "annual"
    assert N.stated_rent_period(4000, "ايجار شهري شقة 3 غرف بسعر 4000") == "monthly"


def test_figure_then_label_style():
    t = "2500 شهري، 28000 سنوي"
    assert N.stated_rent_period(2500, t) == "monthly"


def test_figure_then_label_style_both_figures():
    t = "2500 شهري، 28000 سنوي"
    assert N.stated_rent_period(28000, t) == "annual"


def test_real_haraj_shapes_2026_11_07():
    # contract types «عقد سنوي او شهري» after the figure state no period for it
    assert N.stated_rent_period(1500, "الايجار 1500 ﷼ عقد سنوي او شهري الماء والكهرباء على المؤجر") is None
    assert N.stated_rent_period(1950, "• السعر: 1950 ريال • نوع العقد: سنوي أو شهري •") is None
    # the label before the figure wins over a payment note after it
    assert N.stated_rent_period(40000, "الايجار السنوي 40,000 - (دفعتين او اول ست اشهر دفعه وبعدها شهري )") == "annual"
    assert N.stated_rent_period(20000, "💰 الإيجار السنوي: 20,000 ريال 📅 يقبل الدفع الشهري 📍") == "annual"
    assert N.stated_rent_period(39000, "قيمة الإيجار السنوي: 39,000 ريال 💳 طريقة الدفع: شهريًا 3,250 ريال شهريًا") == "annual"
    # a label followed by prose and an instalment figure still belongs to the figure before it
    assert N.stated_rent_period(36000, "الايجار 36000 سنوي ع دفعتين 18000 الدفعه الاولى") == "annual"


def test_more_haraj_shapes_2026_11_07():
    assert N.stated_rent_period(60000, "الاستراحتين ب 60000ريال سنوي 6000ريال شهري الاستراحة الوحدة 30000ريال") == "annual"
    assert N.stated_rent_period(6000, "الاستراحتين ب 60000ريال سنوي 6000ريال شهري") == "monthly"
    assert N.stated_rent_period(50000, "💰 الإيجار: [5000]شهري و السعر سنوي (50000) ( رقم") == "annual"
    assert N.stated_rent_period(45000, "💰 رسوم الاشتراك: 150 ريال شهري 💰 الإيجار السنوي: 45,000 ريال") == "annual"


def test_a_deposit_after_the_label_does_not_steal_it_coderabbit_11030():
    assert N.stated_rent_period(40000, "الإيجار 40000 ريال سنوي، التأمين 2000 ريال") == "annual"
    assert N.stated_rent_period(28000, "2500 ريال الإيجار السنوي للفيلا 28000") == "annual"
