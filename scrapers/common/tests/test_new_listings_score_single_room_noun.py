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
