"""jurash: kitchen from the ad's own words; an empty garage field is silence, never «no» (🔬, 2026-10-14).

Live 15321317 (re-read 10-14): «مكونات العقار: … صالة 3 غرف نوم مطبخ 4 دورات مياه مدخل خلفي …» stored kitchen
NULL (jurash 0 of 4 findable that night). And `parking = bool(pt_garages)` stored False on all 5 active ads
whose page prints no garage field. jurash has no structured kitchen field, so its prose is the statement.
"""
import scrapers.jurash.run as R

PROSE = "مكونات العقار: دور وملحق كراج سيارة مشب خارجي مجلس رجال صالة 3 غرف نوم مطبخ 4 دورات مياه مدخل خلفي"


def test_kitchen_comes_from_the_ad_words_and_parking_never_from_prose():
    out = R.prose_answers(PROSE)
    assert out == {"kitchen": True}


def test_prose_says_yes_an_explicit_no_or_nothing():
    assert R.prose_answers("لا يوجد مطبخ") == {"kitchen": False}
    assert R.prose_answers(None) == {}


def test_an_empty_garage_field_is_unknown_not_no():
    assert R.parking_answer("") is None
    assert R.parking_answer("-") is None
    assert R.parking_answer("0") is False
    assert R.parking_answer("يتوفر جراج سيارة") is True
