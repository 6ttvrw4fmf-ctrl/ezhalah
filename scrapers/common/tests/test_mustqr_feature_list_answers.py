"""mustqr: the advertiser's own `features` list answers amenities, yes or nothing (🔬 AF engineer, 2026-10-14).

On 10-14, 104 of the 251 active mustqr feature lists named a kitchen, AC, garage, maid or driver room
(«مطبخ راكب، 6 مكيفات شباك، 8 ستائر», «باب كراج، … مطبخ، عداد ماء») and the columns were NULL on every one:
the list was filed only in additional_info.
"""
import scrapers.mustqr.run as R


def test_named_items_answer_yes():
    assert R.feature_answers("مطبخ راكب، 6 مكيفات شباك، 8 ستائر") == {"kitchen": True, "air_conditioner": True}
    assert R.feature_answers("باب كراج، بيت شعر قزاز، مجلسين، مطبخ") == {"parking": True, "kitchen": True}


def test_silence_and_a_prepared_shaft_say_nothing():
    assert R.feature_answers("تأسيس مصعد، يوجد صور") == {}
    assert R.feature_answers("زاوية، مسورة") == {}
    assert R.feature_answers(None) == {}
