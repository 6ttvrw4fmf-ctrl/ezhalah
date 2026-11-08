"""«عدد الغرف» on tuba / aqarcity / haraj is the TOTAL room count, never bedrooms (👑 owner 2026-11-08, backlog 1519/1520).

The nightly score read that label as a bedroom statement through the bedrooms keyword «غرف»: a NULL bedrooms beside
«عدد الغرف: 4» scored WE_MISS (a push to copy the total into bedrooms) and a stored 4 copied from it scored MATCH (blind
to the very bug the owner ruled out). Pages are shaped like haraj's REGA licence block and aqarcity's spec list."""
from scrapers.common.new_listings_score import MATCH, MISMATCH, PAGE_SILENT, compare_listing


def _page(*lines):
    """A page whose evidence lines are exactly `lines`."""
    return {"title": "", "meta": {}, "evidence_lines": list(lines), "text_head": ""}


def _beds(platform, stored, *lines):
    """The score's bedrooms verdict for a stored count on that page."""
    return compare_listing({"platform": platform, "bedrooms": stored}, _page(*lines), skip_price=True)["bedrooms"]


LICENCE = "نوع العقار: شقة عدد الغرف: 4 عمر العقار: 5"


def test_a_null_bedrooms_beside_the_total_is_silence_not_a_miss():
    assert _beds("haraj", None, LICENCE) == PAGE_SILENT


def test_the_total_copied_into_bedrooms_is_a_mismatch():
    assert _beds("haraj", 4, LICENCE) == MISMATCH


def test_the_ads_own_room_phrase_still_states_bedrooms():
    # haraj 25134776 (2026-11-08): licence «عدد الغرف: 4» and the ad's own «4غرف وصاله ومطبخ».
    assert _beds("haraj", 4, LICENCE, "شقة نظيفة جداً 4 غرف وصاله ومطبخ") == MATCH


def test_label_value_lines_are_the_total_too():
    assert _beds("aqarcity", 3, "عدد الغرف", "3") == MISMATCH
    assert _beds("aqarcity", None, "عدد الغرف", "3") == PAGE_SILENT


def test_a_bedroom_label_is_still_bedrooms():
    assert _beds("tuba", 3, "عدد غرف النوم: 3") == MATCH


def test_other_platforms_keep_their_reading():
    # aqaralriyadh prints «عدد الغرف: 4 غرف» for bedrooms; the owner's ruling names the REGA total-rooms sites only.
    assert _beds("aqaralriyadh", 4, "عدد الغرف: 4 غرف") == MATCH
