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


def test_english_compound_facade_is_the_arabic_direction():
    # haraj 22820527 (2026-11-02): «واجهة العقار: South west», stored «جنوب غرب» / served «جنوب غربي».
    body = "<p>واجهة العقار: South west عدد الغرف: لا يوجد</p>"
    assert _cmp({"direction_ar": "جنوب غرب"}, body, "direction_ar") == S.MATCH
    assert _cmp({"direction_ar": "جنوب غربي"}, body, "direction_ar") == S.MATCH
    assert _cmp({"direction_ar": "شمال شرقي"}, body, "direction_ar") == S.MISMATCH
    assert _cmp({"direction_ar": "جنوب شرق"}, "<p>واجهة العقار: Southeast</p>", "direction_ar") == S.MATCH


def test_english_number_word_on_the_age_line():
    body = "<p>نوع العقار: Apartment عمر العقار: Nine Year مساحة العقار: 494</p>"
    assert _cmp({"property_age": 9}, body, "property_age") == S.MATCH
    assert _cmp({"property_age": 4}, body, "property_age") == S.MISMATCH
    assert S.EN_NUMBER.search("Someone") is None


def test_arabic_adjective_facade_is_the_stored_direction():
    # raghdan 23296394 (re-score 41595594386, 2026-11-03): page «الواجهة : جنوبية - شرقية», stored «جنوب شرقي».
    body = "<p>الواجهة : جنوبية - شرقية</p>"
    assert _cmp({"direction_ar": "جنوب شرقي"}, body, "direction_ar") == S.MATCH
    assert _cmp({"direction_ar": "جنوب"}, "<p>الواجهة : جنوبية</p>", "direction_ar") == S.MATCH
    # a different facade is still wrong
    assert _cmp({"direction_ar": "جنوب شرقي"}, "<p>الواجهة : شمالية - غربية</p>", "direction_ar") == S.MISMATCH
    assert _cmp({"direction_ar": "شمال شرقي"}, body, "direction_ar") == S.MISMATCH


def test_haraj_new_building_words_are_age_zero():
    # haraj 23236720 «عمر العقار: New», 23215277 «عمر العقار: اقل من سنة» (2026-11-03 score), both stored 0.
    assert _cmp({"property_age": 0}, "<p>نوع العقار: Floor عمر العقار: New مساحة العقار: 326.48</p>", "property_age") == S.MATCH
    assert _cmp({"property_age": 0}, "<p>نوع العقار: عمارة عمر العقار: اقل من سنة مساحة العقار: 350</p>", "property_age") == S.MATCH
    # a stated new building never vouches for an old one
    assert _cmp({"property_age": 7}, "<p>عمر العقار: New</p>", "property_age") == S.MISMATCH


def test_a_big_decimal_area_rounds_to_the_stored_whole_number():
    # jurash 23304862 (2026-11-03 score): «مساحة الأرض: 1247.5 م²», stored 1248 (integer column, backlog 123).
    body = "<p>▪️ مساحة الأرض: 1247.5 م²</p>"
    assert _cmp({"area_m2": 1248}, body, "area") == S.MATCH
    assert _cmp({"area_m2": 1300}, body, "area") == S.MISMATCH
