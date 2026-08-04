"""Regression tests for scrapers/abeea/run.py:_district_from() / DISTRICT_SLUG_RE (2026-08-04).

The bug: DISTRICT_SLUG_RE lazily captured from the FIRST "for sale"/"for rent"/"in" occurrence
through to the sole "district" token. Two real title shapes broke this:
  (a) "Villa For Rent OR Sale In Al Saif District" — the first alternative matches at "for rent",
      so the lazy capture grabs "Or Sale In Al Saif" instead of "Al Saif".
  (b) "Apartment For Sale In Al Majediyah Compound In Al Bahar District" — the first "in" (right
      after "for sale") anchors the capture, grabbing the whole compound name instead of the
      district that follows the SECOND "in".
  (c) "Land For Sale In Al Khobar, Al Bahar District" — a city name is glued onto the district
      by a comma; neither anchor position removes it.

Live-verified 2026-08-04 against abeea.com.sa (see the case titles below, fetched from the live
JSON-LD `name` field / <title> of each URL) — the site's own visible address widget confirms the
true district for each ("Al Saif, Dammam, ...", "Al Bahar, Al Khobar, ...", etc.).

Fix: DISTRICT_SLUG_RE gets a greedy leading ".*" so backtracking anchors it on the LAST "for
sale/rent[-in]"/"-in-" before "-district" (fixes shapes a+b) — and _district_from() now takes
only the last comma-separated segment of the captured text (fixes shape c, and the comma variant
of a/b: "Villa For Sale In Durrat Al Nakheel Plan, Al Bahar District").

This regex is shared by EVERY abeea listing, so this file also pins ~10 real, currently-working
title shapes (sampled fresh from the live abeea_residential/commercial_listings tables via
Supabase, 2026-08-04) to prove the anchor change does not alter their extraction.

Run: python -m pytest scrapers/common/tests/test_abeea_district_parser.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.abeea.run import _district_from  # noqa: E402


# ── previously broken (live-verified 2026-08-04) ────────────────────────────────────────────────

def test_or_sale_glue_is_dropped():
    # https://abeea.com.sa/en/property/villa-for-rent-in-al-saif-district/
    # live title: "Villa For Rent or Sale In Al Saif District" — page address: "Al Saif, Dammam, ..."
    assert _district_from("villa-for-rent-in-al-saif-district",
                           "Villa For Rent or Sale In Al Saif District") == "Al Saif"


def test_compound_name_before_second_in_is_dropped():
    # https://abeea.com.sa/.../apartment-for-ren-in-al-majediyah-compound-in-al-bahar-district-2/
    # live title: "Apartment For Sale In Al Majediyah Compound In Al Bahar District"
    # page address: "Al Bahar, Al Khobar, ..."
    assert _district_from(
        "apartment-for-ren-in-al-majediyah-compound-in-al-bahar-district-2",
        "Apartment For Sale In Al Majediyah Compound In Al Bahar District",
    ) == "Al Bahar"


def test_sea_view_phrase_before_in_is_dropped():
    # https://abeea.com.sa/.../apartment-for-rent-with-a-sea-view-in-al-bahar-district/
    assert _district_from(
        "apartment-for-rent-with-a-sea-view-in-al-bahar-district",
        "Apartment For Rent With A Sea View In Al Bahar District",
    ) == "Al Bahar"


def test_comma_glued_city_prefix_is_dropped():
    # https://abeea.com.sa/.../land-for-sale-in-al-khobar-al-bahar-district/
    # live title: "Land For Sale In Al Khobar, Al Bahar District" — address: "Al Bahar, Al Khobar, ..."
    assert _district_from("land-for-sale-in-al-khobar-al-bahar-district",
                           "Land For Sale In Al Khobar, Al Bahar District") == "Al Bahar"


def test_comma_glued_project_name_is_dropped():
    # https://abeea.com.sa/.../villa-for-sale-in-durrat-al-nakheel-plan-al-bahar-district/
    # live title: "Villa For Sale In Durrat Al Nakheel Plan, Al Bahar District"
    assert _district_from(
        "villa-for-sale-in-durrat-al-nakheel-plan-al-bahar-district",
        "Villa For Sale In Durrat Al Nakheel Plan, Al Bahar District",
    ) == "Al Bahar"


def test_comma_glued_plan_name_resolves_to_trailing_district():
    # https://abeea.com.sa/.../residential-land-for-sale-in-adel-plan-dammam-district/
    # live title: "Residential Land For Sale In Adel Plan, Al Matar District"
    assert _district_from(
        "residential-land-for-sale-in-adel-plan-dammam-district",
        "Residential Land For Sale In Adel Plan, Al Matar District",
    ) == "Al Matar"


def test_comma_glued_city_before_saif_is_dropped():
    # https://abeea.com.sa/.../land-for-sale-in-dammam-al-saif-district/
    # live title: "Land For Sale In Dammam, AL Saif District" — address: "Saif, Dammam, ..."
    assert _district_from("land-for-sale-in-dammam-al-saif-district",
                           "Land For Sale In Dammam, AL Saif District") == "Al Saif"


# ── still out of reach after this fix (documents the known limit, not a regression) ─────────────

def test_district_missing_from_title_falls_to_slug_unchanged():
    # https://abeea.com.sa/.../apartment-for-rent-in-al-khobar-al-hizam-al-thahabi-district/
    # live JSON-LD `name` is "Apartment For Sale In Al Khobar" — no "district" token at all, so
    # extraction falls through to the slug, which has no comma to split the city off. Extraction
    # stays imperfect ("Al Khobar Al Hizam Al Thahabi") — same as before this fix, not a
    # regression. Resolving this needs a smarter multi-word-city strip, out of scope here.
    assert _district_from(
        "apartment-for-rent-in-al-khobar-al-hizam-al-thahabi-district",
        "Apartment For Sale In Al Khobar",
    ) == "Al Khobar Al Hizam Al Thahabi"


# ── currently-working shapes, sampled fresh from live abeea_residential/commercial_listings via
#    Supabase + re-verified against the live JSON-LD `name` 2026-08-04 — must NOT change ─────────

def test_working_in_before_district_unchanged():
    assert _district_from(
        "skeleton-villa-for-sale-in-al-sadafah-district-al-khobar-city",
        "Skeleton Villa For Sale In Al Sadafah District, Al Khobar City",
    ) == "Al Sadafah"


def test_working_multiword_district_unchanged():
    assert _district_from(
        "furnished-villa-for-rent-in-al-hizam-al-thahabi-district-al-khobar-city",
        "Furnished Villa For Rent In Al Hizam Al Thahabi District, Al Khobar City",
    ) == "Al Hizam Al Thahabi"


def test_working_plain_for_sale_in_unchanged():
    assert _district_from(
        "appartment-for-sale-in-ash-shulah-district-dammam-city",
        "Appartment For Sale In Ash Shulah District, Dammam City",
    ) == "Ash Shulah"


def test_working_no_in_comma_after_sale_falls_to_slug_unchanged():
    # title has "For Sale," (no "-in-"), which doesn't satisfy the regex's required space/hyphen
    # boundary right after "sale" — falls to the slug, same as before this fix.
    assert _district_from(
        "villa-for-sale-al-sheraa-district-al-khobar-city",
        "Villa For Sale, Al Sheraa District, Al Khobar City",
    ) == "Al Sheraa"


def test_working_land_for_sale_in_unchanged():
    assert _district_from(
        "residential-land-for-sale-in-al-wisam-district-dammam-city",
        "Residential Land For Sale In Al Wisam District, Dammam City",
    ) == "Al Wisam"


def test_working_no_in_slug_fallback_unchanged():
    assert _district_from(
        "resedential-land-for-sale-al-saif-district-al-dammam-city",
        "Resedential Land For Sale, Al Saif District, Al Dammam City",
    ) == "Al Saif"


def test_working_short_for_rent_in_unchanged():
    assert _district_from("villa-for-rent-in-al-bahar-district",
                           "Villa For Rent In Al Bahar District") == "Al Bahar"


def test_working_single_word_district_unchanged():
    assert _district_from("two-villas-for-sale-in-uhud-district",
                           "Two Villas For Sale In Uhud District") == "Uhud"


def test_working_two_word_district_unchanged():
    assert _district_from("villa-for-sale-in-qasr-al-khaleej-district",
                           "Villa For Sale In Qasr Al Khaleej District") == "Qasr Al Khaleej"


def test_working_commercial_land_unchanged():
    assert _district_from(
        "commercial-land-for-sale-in-al-faisaliyah-district-dammam-city",
        "Commercial Land For Sale In Al Faisaliyah District, Dammam City",
    ) == "Al Faisaliyah"


if __name__ == "__main__":
    test_or_sale_glue_is_dropped()
    test_compound_name_before_second_in_is_dropped()
    test_sea_view_phrase_before_in_is_dropped()
    test_comma_glued_city_prefix_is_dropped()
    test_comma_glued_project_name_is_dropped()
    test_comma_glued_plan_name_resolves_to_trailing_district()
    test_comma_glued_city_before_saif_is_dropped()
    test_district_missing_from_title_falls_to_slug_unchanged()
    test_working_in_before_district_unchanged()
    test_working_multiword_district_unchanged()
    test_working_plain_for_sale_in_unchanged()
    test_working_no_in_comma_after_sale_falls_to_slug_unchanged()
    test_working_land_for_sale_in_unchanged()
    test_working_no_in_slug_fallback_unchanged()
    test_working_short_for_rent_in_unchanged()
    test_working_single_word_district_unchanged()
    test_working_two_word_district_unchanged()
    test_working_commercial_land_unchanged()
    print("OK — abeea district parser regression tests pass")
