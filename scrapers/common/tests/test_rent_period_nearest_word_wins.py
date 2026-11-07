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


def test_reversed_order_and_single_words_unchanged():
    assert N.stated_rent_period(30000, "السعر السنوي 30000 او الشهري 2800") == "annual"
    assert N.stated_rent_period(2800, "السعر السنوي 30000 او الشهري 2800") == "monthly"
    assert N.stated_rent_period(4000, "ايجار شهري 4000 ريال") == "monthly"
    assert N.stated_rent_period(48000, "ايجار شهري 4000 ريال") == "annual"   # monthly ×12 = price
    assert N.stated_rent_period(4000, "شقة للإيجار 4000") is None
