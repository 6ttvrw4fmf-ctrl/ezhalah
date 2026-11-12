"""Each bare «دورة مياه» item in sadiqeltajer's room list is one bathroom (🆕 2026-11-12).

The 11-12 new-listings score read a bathrooms mismatch on sadiqeltajer: the room list of 26702388 is
«مجلس . مقلط . دورة مياة . مطبخ . غرفه ماستر . غرفه نوم . دورة مياة» (two bathroom items) and we stored 1,
because parse_bathrooms collected the counts into a SET, so two «1»s became one. 26702783 names one
bathroom on the ground floor and one on the second floor.
"""
import pytest

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


@pytest.mark.parametrize("count", [3, 10, 25])
def test_every_bare_item_counts_in_longer_room_lists(count):
    assert parse_bathrooms(_t(" . ".join(["دورة مياه"] * count))) == count


def test_room_list_beyond_description_limit_is_unknown_not_partially_counted():
    # desc() accepts at most 300 characters; 26 items exceed that existing limit.
    assert parse_bathrooms(_t(" . ".join(["دورة مياه"] * 26))) is None


@pytest.mark.parametrize("components", [
    "دورة مياه . دورة مياة . دورة المياه . دورة المياة",
    "دورة مياه، دورة مياة، دورة المياه، دورة المياة",
])
def test_bare_items_with_either_spelling_and_definite_article(components):
    assert parse_bathrooms(_t(components)) == 4


@pytest.mark.parametrize("item", [
    "دورتين مياه", "دورتين مياة", "دورتين المياه", "دورتين المياة",
])
def test_dual_without_a_preceding_count_at_start_of_room_list(item):
    assert parse_bathrooms(_t(item + " . مطبخ")) == 2


@pytest.mark.parametrize("components, expected", [
    ("دورتين مياه . دورتين مياة", 2),
    ("دورتين مياه . 2 دورة مياه", 2),
    ("٢ دورة مياه . دورتين مياة", 2),
    ("اثنتين دورة مياه . دورتين مياه", 2),
    ("3 دورات مياه . ٣ دورات مياة", 3),
    ("دورة مياه . 1 دورة مياة", 1),
    ("واحدة دورة مياه . دورة مياة", 1),
])
def test_explicit_counts_that_agree_are_not_summed(components, expected):
    assert parse_bathrooms(_t(components)) == expected


@pytest.mark.parametrize("components", [
    "دورتين مياه . دورة مياة",
    "دورة مياه . دورتين مياة",
    "دورتين مياه . 3 دورات مياه",
    "٣ دورات مياه . دورتين مياة",
    "دورة مياه . دورة مياة . 2 دورة مياه",
    "2 دورة مياه . دورة مياه . دورة مياة",
])
def test_mixed_counts_that_disagree_are_unknown(components):
    assert parse_bathrooms(_t(components)) is None


@pytest.mark.parametrize("text", [
    "",
    "المكونات :",
    "المكونات : مجلس . مطبخ . غرفتين",
    "دورة مياه . دورة مياة",
    "المزايا : دورتين مياه",
    "المكونات : مجلس . مطبخ المزايا : دورة مياه . دورة مياة",
])
def test_no_bathrooms_stated_in_components_is_unknown(text):
    assert parse_bathrooms(text) is None


def test_bare_item_count_stops_at_next_description_label():
    text = _t("دورة مياه . دورة مياة") + " المزايا : دورة مياه . دورة مياة"
    assert parse_bathrooms(text) == 2
