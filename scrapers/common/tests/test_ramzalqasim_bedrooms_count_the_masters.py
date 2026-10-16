"""ramzalqasim: the API splits bedrooms into `bedrooms` (non-master) + `master_room`; bathroom 0 is the form's
blank (🆕 2026-10-16, backlog #582; /x/268 «غرفة نوم ماستر … غرفة نوم إضافية», stored 1 bedroom / 0 bathrooms)."""
import scrapers.ramzalqasim.run as R


def test_bedrooms_are_the_plain_ones_plus_the_masters():
    assert R.rooms({"bedrooms": "1", "master_room": "1", "bathroom": "0"}, "residential", "Chalet") == (2, None, 1)
    assert R.rooms({"bedrooms": 1, "master_room": 2, "bathroom": 4}, "residential", "Apartment") == (3, 4, 2)
    assert R.rooms({"bedrooms": 0, "master_room": 5, "bathroom": 5}, "residential", "Villa") == (5, 5, 5)
    assert R.rooms({"bedrooms": 4, "master_room": 0, "bathroom": 5}, "residential", "Villa") == (4, 5, 0)


def test_silence_stays_unknown_never_zero():
    assert R.rooms({"bedrooms": 0, "master_room": 0, "bathroom": 0}, "residential", "Villa") == (None, None, 0)
    assert R.rooms({}, "residential", "Villa") == (None, None, None)
    assert R.rooms({"bedrooms": 0, "master_room": 0, "bathroom": 0}, "residential", "Residential Land") == (None, None, 0)
    assert R.rooms({"bedrooms": 3, "master_room": 1}, "commercial", "Shop")[0] is None
    assert R.rooms({"bedrooms": 99, "master_room": 1}, "residential", "Villa") == (1, None, 1)  # junk 99 dropped
