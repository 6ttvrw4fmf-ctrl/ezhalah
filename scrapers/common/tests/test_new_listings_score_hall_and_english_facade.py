"""new_listings_score: «وصالة» is ONE living room, and the REGA block's English facade is the Arabic one
(🆕, 2026-11-01, backlog 1090).

Score run 41009231494 (2026-10-30) put haraj at 81% AF precision on four ads whose stored values are right:
- 21839188 «غرفة وصالة مؤثثه» and 21839193 «4 غرف وصالة كبيره» store living_rooms 1; the room line's «4» read as
  the hall count (or the line had no digit at all), so a single «صالة» never matched 1;
- 21831096 prints «واجهة العقار: Eastern» (haraj's REGA licence block) and we store direction_ar «شرق»; the scorer
  looked for the Arabic word only.
"""
from scrapers.common import new_listings_score as S


def _cmp(stored: dict, body: str, field: str) -> str:
    return S.compare_listing(stored, S.page_evidence(body))[field]


def test_a_single_hall_is_one_living_room():
    body = "<p>شقة 4 غرف الايجار في الشرائع</p><p>الدور الأول 4 غرف وصالة كبيره ومطبخ</p>"
    assert _cmp({"living_rooms": 1}, body, "living_rooms") == S.MATCH
    body2 = "<p>غرفة وصالة مؤثثه للإيجار – حي الياسمين</p>"
    assert _cmp({"living_rooms": 1}, body2, "living_rooms") == S.MATCH


def test_a_single_hall_does_not_vouch_for_two():
    body = "<p>الدور الأول 4 غرف وصالة كبيره ومطبخ</p>"
    assert _cmp({"living_rooms": 2}, body, "living_rooms") == S.MISMATCH


def test_plural_or_dual_halls_are_not_one():
    assert _cmp({"living_rooms": 1}, "<p>3 صالات واسعة</p>", "living_rooms") == S.MISMATCH
    assert _cmp({"living_rooms": 1}, "<p>غرفتين وصالتين</p>", "living_rooms") != S.MATCH
    assert _cmp({"living_rooms": 1}, "<p>2 صالة</p>", "living_rooms") != S.MATCH


def test_english_facade_is_the_arabic_direction():
    body = "<p>معلومات العقار حسب الرخصة</p><p>واجهة العقار: Eastern</p>"
    assert _cmp({"direction_ar": "شرق"}, body, "direction_ar") == S.MATCH
    assert _cmp({"direction_ar": "غرب"}, body, "direction_ar") == S.MISMATCH
    assert _cmp({"direction_ar": "شمال"}, "<p>واجهة العقار: Northern</p>", "direction_ar") == S.MATCH


def test_english_number_word_on_the_age_line():
    body = "<p>نوع العقار: Apartment عمر العقار: Nine Year مساحة العقار: 494</p>"
    assert _cmp({"property_age": 9}, body, "property_age") == S.MATCH
    assert _cmp({"property_age": 4}, body, "property_age") == S.MISMATCH
    assert S.EN_NUMBER.search("Someone") is None
