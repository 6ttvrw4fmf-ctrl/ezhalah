"""Haraj: a value ends where the next REGA label begins, even on the same line (2026-10-19).

HRJ11188292238 / HRJ11187750970 printed «وصف موقع العقار: منطقة المدينة المنورة, المدينة المنورة, الملك فهد صاحب
الترخيص : <office> تاريخ انتهاء رخصة الإعلان : 2026-12-31» on ONE line, so the served district carried the licence
holder's line and the expiry; HRJ11189101593's deed «الحي: شمال التضامن عمولة نقل الملكية: لا يوجد» did the same.
The licence holder is never stored (PDPL). Shapes are verbatim; the office name is replaced by a placeholder.

Run: python -m pytest scrapers/common/tests/test_haraj_glued_label_ends_the_value_2026_10_19.py -v
"""
from scrapers.haraj import parse as P

LIC = ("معلومات العقار حسب الرخصة\nغرض الإعلان: بيع\nوصف موقع العقار: منطقة المدينة المنورة, المدينة المنورة, الملك فهد "
       "صاحب الترخيص : مكتب مثال للعقار تاريخ انتهاء رخصة الإعلان : 2026-12-31\n")
DEED = "-----\nوصف موقع العقار حسب الصك\nالمدينة: خميس مشيط\nالحي: شمال التضامن عمولة نقل الملكية: لا يوجد\n"


def test_the_licence_location_stops_at_the_licence_holder_line():
    lic, _ = P.sections(LIC)
    assert lic["وصف موقع العقار"] == "منطقة المدينة المنورة, المدينة المنورة, الملك فهد"
    assert "صاحب الترخيص" not in lic and not any("مكتب مثال" in v for v in lic.values())
    assert lic["تاريخ انتهاء رخصة الإعلان"] == "2026-12-31"
    assert P.licence_location_ar(lic["وصف موقع العقار"])[2] == "الملك فهد"


def test_the_deed_district_stops_at_the_next_label():
    _, deed = P.sections(LIC + DEED)
    assert (deed["المدينة"], deed["الحي"], deed["عمولة نقل الملكية"]) == ("خميس مشيط", "شمال التضامن", "لا يوجد")


def test_a_label_word_inside_a_value_without_a_colon_is_not_a_break():
    lic, _ = P.sections("معلومات العقار حسب الرخصة\nوصف موقع العقار: منطقة المدينة المنورة, المدينة المنورة, الحيلة\n")
    assert lic["وصف موقع العقار"] == "منطقة المدينة المنورة, المدينة المنورة, الحيلة"
