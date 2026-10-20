"""af_score: aldarim's structured COUNTS are its statement; description prose never scores a kitchen miss (backlog 555).

Read 2026-10-20: aldarim 49170 (576274) prints «مطبخ داخلي ألماني جديد بالكامل» in its description while its own
payload says «\\"kitchens\\":0»; the scraper stores 0 as silence, and the score asked kitchen from the prose, a
false miss (0 of 1 findable). 54641 says «\\"kitchens\\":1» and «\\"parking_spots\\":1»: a real yes. The same key
also sits in the label dictionary with a string value, which is never a count.
"""
from scrapers.common import af_score as A

_DICT = r'\"kitchens\":\"Kitchen\",\"elevators\":\"Elevator\",\"parkingBay\":\"Car parking\"'
AD_49170 = (r'\"maid_rooms\":0,\"driver_rooms\":0,\"mulhaq_rooms\":0,\"kitchens\":0,\"elevators\":0,'
            r'\"parking_spots\":0' + _DICT + "<p>مطبخ داخلي ألماني جديد بالكامل</p>")
AD_54641 = r'\"maid_rooms\":0,\"kitchens\":1,\"elevators\":0,\"parking_spots\":1' + _DICT


def _page(body):
    return {"jsonld": [{"additionalProperty": A.nuzul_props(body)}]}


def test_a_count_of_one_is_yes_and_zero_is_silence():
    page = _page(AD_54641)
    assert A.structured_says(page, "kitchen") is True
    assert A.structured_says(page, "parking") is True
    for f in ("elevator", "maid_room", "driver_room", "air_conditioner"):
        assert A.structured_says(page, f) is None, f


def test_prose_kitchen_on_a_zero_count_ad_is_silent_not_a_miss():
    out = A.structured_only("aldarim", {"kitchen": A.WE_MISS}, {"kitchen": None}, _page(AD_49170))
    assert out["kitchen"] == A.PAGE_SILENT
    assert not A.says_yes(["مطبخ داخلي ألماني جديد بالكامل"], "kitchen", "aldarim", _page(AD_49170))


def test_a_stated_count_we_failed_to_store_is_still_a_miss():
    out = A.structured_only("aldarim", {"kitchen": A.WE_MISS}, {"kitchen": None}, _page(AD_54641))
    assert out["kitchen"] == A.WE_MISS


def test_two_different_counts_cannot_be_attributed():
    assert A.nuzul_props(r'\"kitchens\":1 \"kitchens\":0'.replace(' ', ',')) == []


def test_mutation_without_the_entry_the_prose_would_have_asked():
    assert A.page_says_yes(["مطبخ داخلي ألماني جديد بالكامل"], "kitchen")
    assert A.is_nuzul("https://www.aldarim.sa/en/properties/49170")


def test_furnished_prose_on_an_aldarim_ad_is_silent():
    """576300 (10-20 branch dry run) was asked furnished from prose; aldarim states is_furnished structurally."""
    out = A.structured_only("aldarim", {"furnished": A.WE_MISS}, {"furnished": None}, _page(AD_49170))
    assert out["furnished"] == A.PAGE_SILENT
    assert A.structured_says(_page(r'\"is_furnished\":1'), "furnished") is True
