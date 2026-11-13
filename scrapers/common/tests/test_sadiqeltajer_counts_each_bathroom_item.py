"""Each bare «دورة مياه» item in sadiqeltajer's room list is one bathroom (🆕 2026-11-12).

The 11-12 new-listings score read a bathrooms mismatch on sadiqeltajer: the room list of 26702388 is
«مجلس . مقلط . دورة مياة . مطبخ . غرفه ماستر . غرفه نوم . دورة مياة» (two bathroom items) and we stored 1,
because parse_bathrooms collected the counts into a SET, so two «1»s became one. 26702783 names one
bathroom on the ground floor and one on the second floor.
"""
from scrapers.sadiqeltajer.run import parse_bathrooms


def _t(components: str) -> str:
    return f"للبيع وحدة ارضية المساحة : 170م المكونات : {components}"


def test_two_bare_items_are_two_bathrooms():
    assert parse_bathrooms(_t("مجلس . مقلط . دورة مياة . مطبخ . غرفه ماستر . غرفه نوم . دورة مياة")) == 2


def test_bare_items_on_two_floors_are_counted():
    assert parse_bathrooms(_t("ملحق . مجلس . دورة مياه . مقلط . صالة . مطبخ . مستودع الدور الثاني: 3 غرف . "
                              "دورة مياه . 2 غرفة ماستر")) == 2


def test_one_bare_item_is_one():
    assert parse_bathrooms(_t("غرفتين . دورة مياة . دكه")) == 1


def test_counted_items_that_disagree_stay_unknown():
    assert parse_bathrooms(_t("3 دورات مياه . مطبخ . 2 دورة مياه")) is None


def test_a_dual_stays_two():
    assert parse_bathrooms(_t("مجلس . دورتين مياه . مطبخ")) == 2
