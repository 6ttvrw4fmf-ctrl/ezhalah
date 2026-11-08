"""new_listings_score: a bare singular «غرفه» / «دورة مياه» in a components list is ONE (🆕 2026-11-08, backlog 1350).

sadiqeltajer 25456611 (score run 42451476780): «المكونات : صاله . غرفه . دورة مياة», stored bedrooms 1 / bathrooms 1,
scored MISMATCH because the description's only figures were its area «246» and street «15».
"""
import pytest

from scrapers.common import new_listings_score as S

SADIQ = ("للبيع استراحه بحي اللسيب غرب بريدة بمساحه 246 م شارع 15 غربي بصك اكتروني / العمر جديد / "
         "المكونات : صاله . غرفه . دورة مياة . ركن بوفيه / سقف صبه")


def _score(stored, text):
    return S.compare_listing(stored, {"text_head": text})


def test_bare_singular_room_and_bathroom_are_one():
    out = _score({"bedrooms": 1, "bathrooms": 1}, SADIQ)
    assert out["bedrooms"] == S.MATCH and out["bathrooms"] == S.MATCH


def test_a_wrong_count_beside_the_bare_noun_still_mismatches():
    out = _score({"bedrooms": 2, "bathrooms": 2}, SADIQ)
    assert out["bedrooms"] == S.MISMATCH and out["bathrooms"] == S.MISMATCH


@pytest.mark.parametrize("text", [
    "فيلا 4 غرف نوم و غرفه خادمه و 3 دورات مياه",    # the figures decide, the service room is not a bedroom
    "شقه غرفه خادمه وحمام سباحه بمساحه 246",           # a maid's room and a pool are not one bedroom / bathroom
    "غرف النوم: 3 غرفه ماستر دورات المياه: 2 حمام",     # a stated figure anywhere wins over the bare noun
])
def test_service_rooms_and_stated_figures_never_vouch_for_one(text):
    out = _score({"bedrooms": 1, "bathrooms": 1}, text)
    assert out["bedrooms"] == S.MISMATCH and out["bathrooms"] == S.MISMATCH


@pytest.mark.parametrize("text", [
    "المكونات: غرفه | غرف النوم | 3 | دورات المياه | 2",   # the figure is the next line's bare value (CodeRabbit)
    "غرفه نوم ماستر و ثلاث غرف نوم و دورتين مياه وحمامين",   # a number word states the count
    "غرفه المعيشه بمساحه 40 م",                               # a living room is not a bedroom
    "غرفه للسائق بمساحه 40 م",                                # «لل» + a service room (CodeRabbit)
])
def test_a_count_stated_elsewhere_or_a_living_room_never_vouches_for_one(text):
    assert _score({"bedrooms": 1}, text)["bedrooms"] != S.MATCH


def test_alshawaf_without_its_node_block_is_not_cut():
    page = '<div><table><tr><td headers="view-changed-table-column">x</td></tr></table></div><p>المساحة 375 م²</p>'
    assert S.scope_to_its_ad("https://alshawaf.com.sa/1", page) == page


@pytest.mark.parametrize("field,text", [
    ("bedrooms", "المكونات: غرفه | غرفتين نوم بمساحه 200"),        # a dual is a count (CodeRabbit)
    ("bedrooms", "غرفه . two bedrooms . 240 sqm"),                  # an English count
    ("bedrooms", "غرفه ماستر و غرف للاطفال بمساحه 300"),            # a bare plural
    ("bathrooms", "المكونات: دورة مياه | حمامين بمساحه 200"),
    ("bathrooms", "دورة مياه . two bathrooms . 240 sqm"),
    ("bathrooms", "دورة مياه و دورات مياه للضيوف بمساحه 300"),
    ("bedrooms", "غرفه نوم: two بمساحه 200"),                       # English word beside an Arabic label
    ("bathrooms", "حمام: two بمساحه 200"),
    ("bedrooms", "غرف النوم | two | غرفه"),                        # English value on the next line
    ("bedrooms", "غرفه نوم: eleven بمساحه 200"),                   # every English word the comparator reads
    ("bathrooms", "حمام: twelve بمساحه 200"),
    ("bedrooms", "غرفه . twelve bedrooms . 240 sqm"),
    ("bedrooms", "غرفه نوم: ثماني بمساحه 200"),                   # every Arabic word the comparator reads
    ("bathrooms", "حمام: ثماني بمساحه 200"),
])
def test_a_dual_plural_or_english_count_is_never_outvoted_by_the_bare_noun(field, text):
    assert _score({field: 1}, text)[field] != S.MATCH


@pytest.mark.parametrize("field,text", [
    ("bedrooms", "غرفه نوم ماستر عددها ثلاث بمساحه 300"),         # a count a few words after the noun (CodeRabbit)
    ("bathrooms", "حمام عددها ثلاث بمساحه 200"),
    ("bedrooms", "غرفه نوم بمساحه 200 | 2 bedrooms"),             # a digit before an English room word
    ("bathrooms", "دورة مياه بمساحه 200 | 2 bathrooms"),
])
def test_a_nearby_count_other_than_one_is_never_outvoted(field, text):
    assert _score({field: 1}, text)[field] != S.MATCH


@pytest.mark.parametrize("field,text", [
    ("bedrooms", "غرفه نوم بمساحه 200 | one bedroom"),            # an agreeing count of one still matches
    ("bedrooms", "غرفه نوم، حمام: two بمساحه 200"),               # the «two» belongs to the bathroom
])
def test_an_agreeing_one_or_another_rooms_count_does_not_block(field, text):
    assert _score({field: 1}, text)[field] == S.MATCH
