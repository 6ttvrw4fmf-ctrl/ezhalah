"""muhaysini: «اليومية» in lifestyle prose is not the ad's period; a period word attached to OUR figure is
(🆕 2026-10-16, backlog #585: 205 of 406 period-less arrivals carried one)."""
import scrapers.muhaysini.run as M


def test_everyday_prose_does_not_hide_the_ads_own_period():
    t = "إمدادات ماء موثوقة لتلبية الاحتياجات اليومية. بسعر تنافسي قدره 30,000 ريال سعودي سنويًا"
    assert M._rent_fields(30000, t) == ("annual", 30000)
    assert M._rent_fields(42000, "الرياض - السعر: 42,000 ريال سعودي في السنة - مفروش: لا") == ("annual", 42000)
    assert M._rent_fields(3200, "للحياة اليومية. الإيجار البالغ 3200 ريال سعودي شهريًا") == ("monthly", 38400)


def test_a_period_attached_to_another_figure_stays_unknown():
    # MHS2403: 35,000 is paid in two instalments; «الشهري» is attached to 3,300 → never ×12 our 35,000.
    assert M._rent_fields(35000, "الايجار دفعتين : 35,000 الايجار الشهري : 3,300") == (None, 35000)
    # MHS1834: «السنوي» IS attached to the stored 65,000.
    assert M._rent_fields(65000, "اجار شهري 5500 السنوي 65000") == ("annual", 65000)
    assert M._rent_fields(35000, "للاستخدام اليومي. شقة جميلة") == (None, 35000)
    assert M._rent_fields(25000, "خيارات تأجير : شهري - سنوي … شهريا 3000 ألف ريال سنويا 36 ألف ريال") == (None, 25000)
