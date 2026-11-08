"""«عدد الغرف» on tuba / aqarcity / haraj is the TOTAL room count, never bedrooms (👑 owner 2026-11-08, backlog 1519/1520).

The nightly score read that label as a bedroom statement through the bedrooms keyword «غرف»: a NULL bedrooms beside
«عدد الغرف: 4» scored WE_MISS (a push to copy the total into bedrooms) and a stored 4 copied from it scored MATCH (blind
to the very bug the owner ruled out). Pages are shaped like haraj's REGA licence block and aqarcity's spec list."""
import pytest

from scrapers.common.new_listings_score import MATCH, MISMATCH, PAGE_SILENT, WE_MISS, compare_listing


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


@pytest.mark.parametrize("platform", ["tuba", "aqarcity", "haraj"])
@pytest.mark.parametrize("lines", [
    ("عدد الغرف: 4",),
    ("عدد غرف：٤",),
    ("عددالغرف 4",),
    ("عدد الغرف", "4"),
    ("عدد الغرف:", "٤ غرف"),
    ("عدد الغرف", "4 غرفة"),
])
@pytest.mark.parametrize("stored, expected", [(None, PAGE_SILENT), (4, MISMATCH)])
def test_total_room_formats_are_excluded_on_every_affected_platform(platform, lines, stored, expected):
    assert _beds(platform, stored, *lines) == expected


@pytest.mark.parametrize("platform", ["tuba", "aqarcity", "haraj"])
@pytest.mark.parametrize("stored, expected", [(None, WE_MISS), (3, MATCH), (4, MISMATCH)])
def test_distinct_bedroom_statement_survives_total_removal(platform, stored, expected):
    assert _beds(platform, stored, "عدد الغرف: 4", "3 غرف نوم") == expected


@pytest.mark.parametrize("lines", [
    ("عدد الغرف", "3 غرف نوم"),  # Not a bare total value: keep the bedroom statement.
    ("عدد الغرف: 4 ، 3 غرف نوم",),  # Both labels on one line.
    ("3 غرف نوم", "عدد الغرف", "4"),  # Total comes after the bedroom statement.
    ("عدد الغرف", "4", "غرف النوم", "3"),  # Keep neighbouring label/value alignment.
])
def test_removing_total_preserves_independent_bedroom_evidence(lines):
    assert _beds("haraj", 3, *lines) == MATCH


@pytest.mark.parametrize("label", ["عدد غرف النوم: 3", "عدد الغرف النوم: 3"])
def test_total_label_exclusion_does_not_remove_explicit_bedroom_labels(label):
    assert _beds("tuba", 3, label) == MATCH
    assert _beds("tuba", None, label) == WE_MISS


@pytest.mark.parametrize("stored", [None, 3])
def test_missing_total_value_does_not_consume_following_unrelated_field(stored):
    result = compare_listing(
        {"platform": "haraj", "bedrooms": stored, "bathrooms": 2},
        _page("عدد الغرف", "الحمامات: 2"), skip_price=True,
    )
    assert result["bedrooms"] == PAGE_SILENT
    assert result["bathrooms"] == MATCH


@pytest.mark.parametrize("stored", [4, 6])
def test_multiple_total_labels_are_all_excluded(stored):
    assert _beds("aqarcity", stored, "عدد الغرف: 4", "عدد الغرف", "6") == MISMATCH


def test_stored_count_unsupported_by_any_statement_is_page_silent():
    assert _beds("haraj", 2, "عدد الغرف: 4") == PAGE_SILENT


@pytest.mark.parametrize("platform", ["aqaralriyadh", "muhaysini", None])
def test_total_room_filter_is_limited_to_the_named_platforms(platform):
    assert _beds(platform, None, "عدد الغرف: 4 غرف") == WE_MISS
    assert _beds(platform, 4, "عدد الغرف: 4 غرف") == MATCH
