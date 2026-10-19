"""RE/MAX Saudi's traps: an "Off Plan" market status that must come from a structured field never a
title word, a "Parking Area (m²)" field that looks like a slot count but is a SIZE, an area figure
that lives in a different column for a villa/land row than for a unit, a rent-period field
(`RentalPriceGranularityUID`) with buckets this schema cannot hold, and a record that ships an
agent id, office id, QR-code broker-verification URL and (on other rows) a guarantor/legal free-text
field in the SAME payload a scraper must never store.

Fixtures are VERBATIM `POST /search/listing-search/docs/search` `content` objects captured live
2026-09-25 (MLSIDs 113033001-7, 113033009-16, 113033009-23, plus four real HISTORICAL Saudi rent
rows — 113033017-5, 113028031-3, 113033011-5, 113028031-2 — the only Rent rows this tenant/region
currently has, all inactive), trimmed to the keys the code reads — plus, on purpose, the id/QR/legal
fields the code must never store. Assertions execute the SHIPPING functions (run.map_listing,
run._signal, run._make_verify_gone, run.fetch_catalogue). Offline: only to_catalog /
find_district_in_text are stubbed (network calls to the real listing-catalog DB).

MUTATION-VERIFIED 2026-09-25. Four guards were re-broken one at a time, the named test watched FAIL,
then restored and watched pass (59 passed clean):

  1 dropping the off_plan skip entirely → 2 FAILED, led by test_off_plan_market_status_is_excluded.
  2 adding "AgentId" to `_CAPTURE_KEYS` → 1 FAILED:
    test_the_index_this_scraper_reads_carries_no_agent_contact_info_at_all.
  3 the no-bucket rent period (Daily/Weekly/Semi-Annually) storing the raw figure instead of
    AUTHORITATIVE_NULL → 1 FAILED:
    test_a_period_this_schema_has_no_bucket_for_blanks_the_price_rather_than_misstating_it.
  4 `_make_verify_gone`'s canary gate removed (verify_gone became a bare `probe`) → 2 FAILED, led by
    test_verify_gone_fails_closed_when_the_canary_itself_reads_dead.

Run: python -m pytest scrapers/common/tests/test_remaxsa_price_period_and_pdpl.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.remaxsa import run as R  # noqa: E402

_AUTHORITATIVE_NULL = type(db.AUTHORITATIVE_NULL)

# ── VERBATIM CAPTURES (2026-09-25) ───────────────────────────────────────────────────────────────
# OFF PLAN (MLSID 113033001-7). Verified rendered: opening this exact listing's detail page shows a
# blue "Off Plan" badge and "Date Available: 20/08/2027". MarketStatusUID 5524 AND
# PropertyCategoryUID 5531 both independently say so — a title/description containing neither word
# "off"/"plan" at all, which is the point: nothing here is guessed from prose.
OFF_PLAN_APARTMENT = {
    "MLSID": "113033001-7", "RegionId": 113, "AgentId": 113033001, "OfficeId": 113033, "TeamID": None,
    "RepresentingAgentID": None, "TransactionTypeUID": 261, "PropertyTypeUID": 194,
    "MacroPropertyTypeUID": 17584, "MarketStatusUID": 5524, "PropertyCategoryUID": 5531,
    "ContractTypeUID": 29, "ListingClass": 2, "ListingStatusUID": 160,
    "IsViewable": True, "OnHoldListing": False, "IsRegionalOffice": False,
    "NumberOfBedrooms": 1, "NumberOfBathrooms": 2, "TotalNumOfRooms": 2,
    "TotalArea": 103.56, "BuiltArea": 118.96, "LotSize2": None, "LotSize": None,
    "ParkingSpaces": 15, "City": "الرياض", "Province": "الرياض", "LocalZone": None,
    "ListingPrice": 1662361, "ListingCurrency": "SAR", "HidePricePublic": False,
    "RentalPriceGranularityUID": None, "ExpiryDate": 1818849600, "FirstUpdatedToWeb": 1786952760,
    "DevelopmentName": "LA VIE YARD", "DevelopmentID": 9127, "ListingReference": "7201113920",
    "ShowAddressPublic": False, "FloorNumber": None,
    "ListingDescriptions": [
        {"Description": "شقة عصرية للبيع في الرياض بتصميم أنيق", "DescriptionTypeUID": "1113",
         "LanguageCode": "ar-SA", "ISOLanguageCode": "ar"},
        {"Description": "شقة عصرية بتشطيبات فاخرة في مشروع لافي يارد بالرياض، تتميز بغرفة نوم "
                        "واسعة وحمامين وموقف سيارات خاص، ضمن مجتمع سكني متكامل.",
         "DescriptionTypeUID": "629", "LanguageCode": "ar-SA", "ISOLanguageCode": "ar"},
    ],
    "ListingFeatures": [
        {"GroupingName": "PropertyFeatures_Exterior Features", "FeatureName": "PropertyFeatures_Parking"},
        {"GroupingName": "PropertyFeatures_Interior Features", "FeatureName": "PropertyFeatures_Security System"},
    ],
    "ListingImages": [{"FileName": "L_offplan1.jpg", "Order": "1", "HasLargeImage": "1", "IsWatermarked": "1"}],
    "ShortLinks": [{"LanguageCode": "en-SY", "ShortLink": "en/listings/apartment/for-sale/الرياض/113033001-7"}],
}
# NEW BUILD, ACTIVE (MLSID 113033009-16). MarketStatusUID 2433 "New Build" — NOT off-plan (verified:
# its own detail page shows a "New Build" badge, no "Off Plan" badge). The fullest real fixture:
# used for the happy path, the parking-area trap and the licence/date epoch conversions.
NEW_BUILD_APARTMENT = {
    "MLSID": "113033009-16", "RegionId": 113, "AgentId": 113033009, "OfficeId": 113033, "TeamID": None,
    "RepresentingAgentID": None, "IntegratorSalesAssociateID": None, "MacroOfficeId": None,
    "TransactionTypeUID": 261, "PropertyTypeUID": 194, "MacroPropertyTypeUID": 17584,
    "MarketStatusUID": 2433, "PropertyCategoryUID": None, "ContractTypeUID": 29,
    "ListingClass": 2, "ListingStatusUID": 160, "IsViewable": True, "OnHoldListing": False,
    "IsRegionalOffice": False,
    "NumberOfBedrooms": 3, "NumberOfBathrooms": 3, "TotalNumOfRooms": 4,
    "TotalArea": 185, "BuiltArea": 134, "LivingArea": None, "LotSize2": None, "LotSize": None,
    "ParkingSpaces": 19,          # the page's own "Parking Area (m²)" row reads 19 — a SIZE
    "City": "الرياض", "Province": "الرياض", "LocalZone": "اشبيلية", "District": None,
    "StreetName": None, "StreetNumber": None, "AddressLine2": None, "PostalCode": None,
    "FullAddress": "الرياض الرياض ",
    "ListingPrice": 1320000, "ListingCurrency": "SAR", "HidePricePublic": False,
    "RentalPriceGranularityUID": None,
    "ExpiryDate": 1806408000,             # → 2027-03-30, matches the page's own "License Expiry Date"
    "FirstUpdatedToWeb": 1788424260,      # → 2026-09-03, matches the page's own "Listing Date"
    "LastUpdatedOnWeb": 1788528921, "OrigListingDate": 1788426000, "YearBuilt": None,
    "DevelopmentName": "BDA37", "DevelopmentID": 9146,
    "ListingReference": "7201116130",     # matches the page's own "Advertising License Number"
    "ShowAddressPublic": False, "FloorNumber": None,
    "ListingDescriptions": [
        {"Description": "شقة بمدخل خاص للبيع في إشبيليا، الرياض", "DescriptionTypeUID": "1113",
         "LanguageCode": "ar-SA", "ISOLanguageCode": "ar"},
        {"Description": "شقة جديدة للبيع في منطقة إشبيليا الواعدة بالرياض. تمتد الشقة على مساحة "
                        "إجمالية 185 مترًا مربعًا وتضم 3 غرف نوم واسعة و3 حمامات. موقف سيارات "
                        "مخصص بمساحة 19 مترًا مربعًا.",
         "DescriptionTypeUID": "629", "LanguageCode": "ar-SA", "ISOLanguageCode": "ar"},
        {"Description": "Luxury 3-Bed Apartment in Prime Riyadh Location", "DescriptionTypeUID": "1113",
         "LanguageCode": "en-SY", "ISOLanguageCode": "en"},
    ],
    "ListingFeatures": [
        {"GroupingName": "PropertyFeatures_Interior Features", "FeatureName": "PropertyFeatures_Furnished"},
        {"GroupingName": "PropertyFeatures_Exterior Features", "FeatureName": "PropertyFeatures_Parking"},
        {"GroupingName": "PropertyFeatures_Interior Features", "FeatureName": "PropertyFeatures_Security System"},
        {"GroupingName": "PropertyFeatures_Architectual Style", "FeatureName": "PropertyFeatures_New Building"},
        {"GroupingName": "PropertyFeatures_Location", "FeatureName": "PropertyFeatures_Near Schools"},
    ],
    "ListingImages": [
        {"FileName": "L_57913fb7-1dec-4b00-b05d-f51ff761dfbd.jpg", "Order": "1",
         "HasLargeImage": "1", "IsWatermarked": "1"},
        {"FileName": "L_929510e8-f464-4138-b193-dc94cae9a71f.jpg", "Order": "2",
         "HasLargeImage": "1", "IsWatermarked": "1"},
        {"FileName": "L_small_no_wm.jpg", "Order": "3", "HasLargeImage": "0", "IsWatermarked": "0"},
    ],
    "ShortLinks": [{"LanguageCode": "en-SY", "ShortLink": "en/listings/apartment/for-sale/الرياض/113033009-16"}],
}
# THE VILLA / LAND-SHAPED ROW (MLSID 113033009-23). TotalArea 0 — the real size is LotSize2. Also
# carries the QR-code broker-verification fields and every agent/office id this scraper must not
# store, all genuinely present on this exact captured row (not a hypothetical).
VILLA = {
    "MLSID": "113033009-23", "RegionId": 113, "AgentId": 113033009, "OfficeId": 113033, "TeamID": None,
    "RepresentingAgentID": None, "IntegratorSalesAssociateID": None,
    "TransactionTypeUID": 261, "PropertyTypeUID": 231, "MacroPropertyTypeUID": 17598,
    "MarketStatusUID": None, "PropertyCategoryUID": None, "ContractTypeUID": 29,
    "ListingClass": 2, "ListingStatusUID": 160, "IsViewable": True, "OnHoldListing": False,
    "IsRegionalOffice": False,
    "NumberOfBedrooms": 4, "NumberOfBathrooms": 6, "TotalNumOfRooms": 5,
    "TotalArea": 0, "BuiltArea": None, "LotSize2": 500, "LotSize": "20x25",
    "ParkingSpaces": None, "City": "الدرعية", "Province": "الرياض", "LocalZone": None,
    "District": None, "StreetName": "عقرباء - الجبيلة", "StreetNumber": "1166",
    "AddressLine2": "3808", "PostalCode": "13953",
    "FullAddress": "الرياض الدرعية 13953  1166 عقرباء - الجبيلة  - 3808 - ",
    "ListingPrice": 1900000, "ListingCurrency": "SAR", "HidePricePublic": False,
    "RentalPriceGranularityUID": None,
    "ExpiryDate": 1795694400, "FirstUpdatedToWeb": 1789297200, "YearBuilt": None,
    "DevelopmentName": None, "DevelopmentID": 0, "ListingReference": "7100319715",
    "ShowAddressPublic": True, "FloorNumber": "Ground floor",
    "QRCode": "113/L/56149403-fde7-4997-8df4-df44c3d61171.jpg",
    "QRCodeUrl": "https://eservicesredp.rega.gov.sa/public/IndividualBroker/ElanDetails/08df0e25",
    "PixelTrackingCode": None, "RentGuarantorInformation": None, "LegalRequirementText": None,
    "ListingDescriptions": [
        {"Description": "فيلا فاخرة للبيع في الدرعية بالرياض", "DescriptionTypeUID": "1113",
         "LanguageCode": "ar-SA", "ISOLanguageCode": "ar"},
        {"Description": "فيلا فاخرة جديدة للبيع في قلب الدرعية. يمتد العقار على مساحة 500 متر "
                        "مربع وتبلغ أبعاد القطعة 20 مترًا في 25 مترًا.",
         "DescriptionTypeUID": "629", "LanguageCode": "ar-SA", "ISOLanguageCode": "ar"},
    ],
    "ListingFeatures": [
        {"GroupingName": "PropertyFeatures_Exterior Features", "FeatureName": "PropertyFeatures_Garage"},
    ],
    "ListingImages": [
        {"FileName": "L_c860370f-6e2c-4a71-b6ae-541db82ad492.jpg", "Order": "1",
         "HasLargeImage": "1", "IsWatermarked": "1"},
    ],
    "ShortLinks": [{"LanguageCode": "en-SY",
                    "ShortLink": "en/listings/villa/for-sale/الدرعية/13953-1166-عقرباء-الجبيلة-3808/113033009-23"}],
}


def _real_rent(mlsid, agent_id, office_id, ptype_uid, macroptype_uid, city, province, price,
               granularity, listing_ref, expiry, first_web, bedrooms, bathrooms) -> dict:
    """The shared shape of the 4 REAL historical Saudi Rent rows (this tenant/region's only ones,
    all currently Cancelled/Prospective/Rented, none active) — `RentalPriceGranularityUID` is the
    period field under test, and every value passed in is verbatim from that exact MLSID."""
    return {
        "MLSID": mlsid, "RegionId": 113, "AgentId": agent_id, "OfficeId": office_id, "TeamID": None,
        "RepresentingAgentID": None,
        "TransactionTypeUID": 260, "PropertyTypeUID": ptype_uid, "MacroPropertyTypeUID": macroptype_uid,
        "MarketStatusUID": None, "PropertyCategoryUID": None, "ContractTypeUID": 29,
        "ListingClass": 2, "ListingStatusUID": 166, "IsViewable": False, "OnHoldListing": True,
        "IsRegionalOffice": False,
        "NumberOfBedrooms": bedrooms, "NumberOfBathrooms": bathrooms, "TotalNumOfRooms": bedrooms + 1,
        "TotalArea": 140, "BuiltArea": 120, "LotSize2": None, "LotSize": None, "ParkingSpaces": None,
        "City": city, "Province": province, "LocalZone": None,
        "ListingPrice": price, "ListingCurrency": "SAR", "HidePricePublic": False,
        "RentalPriceGranularityUID": granularity,
        "ExpiryDate": expiry, "FirstUpdatedToWeb": first_web, "DevelopmentName": None,
        "ListingReference": listing_ref, "ShowAddressPublic": False, "FloorNumber": None,
        "ListingDescriptions": [
            {"Description": "شقة للإيجار", "DescriptionTypeUID": "1113", "LanguageCode": "ar-SA",
             "ISOLanguageCode": "ar"},
        ],
        "ListingFeatures": [], "ListingImages": [],
        # Real fact: an inactive/unpublished row carries NO public ShortLink — a synthetic one is
        # added here purely so this test can isolate the price/period behaviour under study, which
        # does not depend on ShortLinks. test_an_inactive_rows_own_empty_shortlinks_skips_safely below
        # proves the unmodified (real, empty) shape is handled correctly instead of guessed.
        "ShortLinks": [{"LanguageCode": "en-SY", "ShortLink": f"en/listings/x/for-rent/x/{mlsid}"}],
    }


# RentalPriceGranularityUID 596 "Annually" — Apartment, Jeddah. Real MLSID 113033017-5.
RENT_ANNUAL = _real_rent("113033017-5", 113033017, 113033, 194, 17584, "جدة", "مكة المكرمة",
                        53800, 596, "test00", 1821009600, 1789469400, 2, 1)
# RentalPriceGranularityUID 601 "Daily" — Chalet. Real MLSID 113028031-3.
RENT_DAILY_NO_BUCKET = _real_rent("113028031-3", 113028031, 113028, 3412, 17600, "الرياض",
                                  "الرياض", 350, 601, "7200000001", 1800000000, 1789000000, 1, 1)
# RentalPriceGranularityUID 596 "Annually" — Office. Real MLSID 113033011-5.
RENT_ANNUAL_OFFICE = _real_rent("113033011-5", 113033011, 113033, 20, 17590, "الرياض", "الرياض",
                                1500, 596, "7200000002", 1800000000, 1789000000, 0, 1)
# HidePricePublic — no live/historical Saudi row publishes it True (measured), so this is a
# documented, deliberate flip of one real field on an otherwise-real captured row.
RENT_HIDDEN_PRICE = {**RENT_ANNUAL, "HidePricePublic": True}


_CITIES = {"الرياض": (3, 1), "الدرعية": (4, 1), "جدة": (5, 2)}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog / find_district_in_text would otherwise read loc_catalog_* from the database."""
    monkeypatch.setattr(R, "to_catalog",
                        lambda c, region_hint=None: _CITIES.get((c or "").strip(), (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: "اشبيلية" if t and "اشبيلية" in t else None)


def _row(rec: dict) -> tuple[dict, str]:
    row, cat, why = R.map_listing(rec)
    assert row, f"fixture {rec['MLSID']} unexpectedly skipped: {why}"
    return row, cat


# ── 1. OFF-PLAN: a structured field, never a title word ──────────────────────────────────────────

def test_off_plan_market_status_is_excluded():
    row, _cat, why = R.map_listing(OFF_PLAN_APARTMENT)
    assert row is None and why == "off_plan"


def test_off_plan_category_alone_is_also_caught():
    """The second, independent structured field (measured as a strict subset of the first, on live
    data) is checked too, belt-and-suspenders."""
    rec = {**OFF_PLAN_APARTMENT, "MarketStatusUID": None, "PropertyCategoryUID": 5531}
    assert R.map_listing(rec)[2] == "off_plan"


def test_a_title_word_alone_never_triggers_the_off_plan_skip():
    """Proof this is NOT a text guess: a "new build"/"off plan"-ish description on an ordinary
    MarketStatusUID must map normally."""
    rec = {**NEW_BUILD_APARTMENT,
          "ListingDescriptions": [{"Description": "شقة تحت الإنشاء ستسلم مستقبلاً على الخارطة",
                                    "DescriptionTypeUID": "629", "LanguageCode": "ar-SA",
                                    "ISOLanguageCode": "ar"}]}
    row, _cat, why = R.map_listing(rec)
    assert row is not None and why == ""


def test_a_new_build_status_is_not_off_plan():
    """MarketStatusUID 2433 "New Build" renders no Off Plan badge (verified live) and must map."""
    row, _ = _row(NEW_BUILD_APARTMENT)
    assert row["property_type"] == "Apartment"


# ── 2. PRICE = SOURCE ─────────────────────────────────────────────────────────────────────────────

def test_price_is_stored_verbatim_never_rounded_or_derived():
    row, _ = _row(NEW_BUILD_APARTMENT)
    assert row["price_total"] == 1320000
    ev = row["price_evidence"]
    assert (ev["field"], ev["raw"], ev["stored"]) == ("ListingPrice", 1320000, 1320000)
    assert (ev["kind"], ev["unit"], ev["origin"]) == ("total", "total", "api")
    assert ev["authoritative_absent"] is False


def test_hide_price_public_is_the_sources_own_statement_of_absence():
    """A plain None would mean "we failed to read a price"; HidePricePublic=True means the AGENT
    chose not to publish one — the AUTHORITATIVE_NULL case."""
    row, _ = _row({**NEW_BUILD_APARTMENT, "HidePricePublic": True})
    assert isinstance(row["price_total"], _AUTHORITATIVE_NULL)
    assert row["price_evidence"]["authoritative_absent"] is True
    assert row["price_evidence"]["stored"] is None
    # the RAW figure is legitimate evidence (an audit trail — "found=True" says the source DID
    # publish a number), it is only the STORED price column that must never carry it
    assert row["price_evidence"]["raw"] == 1320000 and row["price_evidence"]["found"] is True
    assert not any(isinstance(row.get(c), (int, float)) and not isinstance(row.get(c), bool)
                  for c in ("price_total", "price_annual", "price_per_meter"))


def test_no_per_metre_rate_field_exists_on_this_platform():
    """No structured rate field exists anywhere in the schema (measured over all 21 live rows) — the
    scraper never invents one."""
    assert "price_per_meter" not in _row(NEW_BUILD_APARTMENT)[0]
    assert "price_per_meter" not in _row(VILLA)[0]


# ── 3. AREA: TotalArea for a unit, LotSize2 for a villa/land row whose TotalArea is 0 ─────────────

def test_area_reads_total_area_for_a_unit():
    """Verified verbatim: the page's own "Total SqF 185" row and its body text "185 square meters"."""
    assert _row(NEW_BUILD_APARTMENT)[0]["area_m2"] == 185


def test_area_falls_back_to_lot_size_for_a_zero_total_area_row():
    """TotalArea is 0 on this villa; LotSize2 (500) is verified against the listing's own
    description, "500 متر مربع" / "500 square meters"."""
    row, _ = _row(VILLA)
    assert row["area_m2"] == 500
    assert row["additional_info"]["lot_size_dims"] == "20x25"


# ── 4. THE "PARKING AREA (m²)" TRAP ───────────────────────────────────────────────────────────────

def test_parking_spaces_is_a_size_not_a_slot_count():
    """The page's own table row is literally "Parking Area (m²) 19" — verified verbatim. It becomes
    the boolean `parking` (a positive size → has parking) via the shared count_flag, with the raw
    figure preserved rather than stored as a fabricated "19 parking spots"."""
    row, _ = _row(NEW_BUILD_APARTMENT)
    assert row["parking"] is True
    assert row["additional_info"]["parking_area_m2"] == 19
    assert "parking" not in str(row.get("additional_info", {}).get("total_rooms", ""))


def test_parking_feature_word_alone_still_sets_the_flag():
    rec = {**VILLA, "ListingFeatures": [{"GroupingName": "x", "FeatureName": "PropertyFeatures_Parking"}]}
    assert _row(rec)[0]["parking"] is True


def test_a_silent_parking_field_is_unknown_never_false():
    rec = {**VILLA, "ListingFeatures": []}          # ParkingSpaces None, no Parking/Garage feature word
    row, _ = _row(rec)
    assert "parking" not in row or row["parking"] is None


def test_a_published_zero_parking_area_is_a_negative_not_silence():
    row, _ = _row({**VILLA, "ListingFeatures": [], "ParkingSpaces": 0})
    assert row["parking"] is False


# ── 5. PERIOD = SOURCE: RentalPriceGranularityUID, a DIRECT structured field, no prose parsing ────

def test_annually_is_honoured_price_stored_unconverted():
    row, cat = _row(RENT_ANNUAL)
    assert (row["transaction_type"], row["rent_period"], row["price_annual"]) == ("Rent", "annual", 53800)
    assert cat == "residential" and row["property_type"] == "Apartment"


def test_annually_on_an_office_is_the_same_bucket():
    row, cat = _row(RENT_ANNUAL_OFFICE)
    assert (row["rent_period"], row["price_annual"]) == ("annual", 1500)
    assert cat == "commercial" and row["property_type"] == "Office"


def test_a_period_this_schema_has_no_bucket_for_blanks_the_price_rather_than_misstating_it():
    """RentalPriceGranularityUID 601 "Daily" on a real 350 SAR/day chalet. Storing 350 unconverted
    under a blank rent_period would let a daily rate be read as if it might be annual — far worse
    than storing nothing, because 601 IS a structured statement of what 350 means, not silence."""
    row, _ = _row(RENT_DAILY_NO_BUCKET)
    assert "rent_period" not in row
    assert isinstance(row["price_annual"], _AUTHORITATIVE_NULL)
    ev = row["price_evidence"]
    assert ev["authoritative_absent"] is True and ev["stored"] is None
    assert ev["raw"] == 350, "the source's own published figure is still the evidence"


def test_period_silence_stays_null_and_the_price_is_stored_unconverted():
    """No RentalPriceGranularityUID at all (the field absent/None) states no period — nothing
    defaults to annual."""
    rec = {**RENT_ANNUAL, "RentalPriceGranularityUID": None}
    row, _ = _row(rec)
    assert "rent_period" not in row
    assert row["price_annual"] == 53800


def test_holiday_short_term_rental_is_excluded_not_silently_annualised():
    """TransactionTypeUID 262 has no home in an annual/monthly rent_period."""
    rec = {**RENT_ANNUAL, "TransactionTypeUID": 262}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == "transaction_unknown_262"


def test_hidden_price_on_a_rent_row_is_also_authoritative_null():
    row, _ = _row(RENT_HIDDEN_PRICE)
    assert isinstance(row["price_annual"], _AUTHORITATIVE_NULL)
    assert row["price_evidence"]["authoritative_absent"] is True


@pytest.mark.parametrize("gran", [597, 2620, 3476, 3618])
def test_the_full_measured_granularity_vocabulary(gran):
    row, _ = _row({**RENT_ANNUAL, "RentalPriceGranularityUID": gran})
    if gran in (597, 2620):
        assert (row["rent_period"], row["price_annual"]) == ("monthly", 53800 * 12)
    else:                                            # 3476 "Per Year + Fees", 3618 "Per Month + Fees"
        expected_period = "annual" if gran == 3476 else "monthly"
        expected_price = 53800 if gran == 3476 else 53800 * 12
        assert (row["rent_period"], row["price_annual"]) == (expected_period, expected_price)


# ── 6. NO AUCTIONS, and off-plan/deal skip reasons are counted not guessed ────────────────────────

def test_an_unrecognised_deal_is_skipped_with_a_counted_reason():
    rec = {**NEW_BUILD_APARTMENT, "TransactionTypeUID": 999}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == "transaction_unknown_999"


def test_an_unmapped_property_type_is_skipped_never_guessed():
    rec = {**NEW_BUILD_APARTMENT, "PropertyTypeUID": 88888}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == "type_unmapped_88888"


@pytest.mark.parametrize("uid,expected,cat", [
    (194, "Apartment", "residential"), (231, "Villa", "residential"),
    (203, "Duplex", "commercial"),        # category_for_type files Duplex as commercial fleet-wide
    (20, "Office", "commercial"), (3412, "Chalet", "residential"),
])
def test_every_onboarded_property_type_uid_maps(uid, expected, cat):
    row, c = _row({**NEW_BUILD_APARTMENT, "PropertyTypeUID": uid})
    assert (row["property_type"], c) == (expected, cat)


# ── 7. DATES: epoch seconds, verified against the rendered page ──────────────────────────────────

def test_licence_expiry_and_listing_date_convert_from_epoch_seconds():
    """Verified verbatim against MLSID 113033009-16's own detail page: "License Expiry Date:
    30/03/2027" and "Listing Date: 03/09/2026"."""
    row, _ = _row(NEW_BUILD_APARTMENT)
    assert row["license_expiry"] == "2027-03-30"
    assert row["date_added"] == "2026-09-03"
    assert row["license_number"] == "7201116130"


def test_an_absent_epoch_is_none_not_1970():
    assert R._epoch_date(None) is None and R._epoch_date(0) is None


# ── 8. PDPL: an ALLOWLIST, never a blocklist ──────────────────────────────────────────────────────

_FORBIDDEN_KEYS = ("AgentId", "OfficeId", "TeamID", "RepresentingAgentID", "MacroOfficeId",
                  "IntegratorSalesAssociateID", "QRCode", "QRCodeUrl", "PixelTrackingCode",
                  "RentGuarantorInformation", "LegalRequirementText")


@pytest.mark.parametrize("rec", [OFF_PLAN_APARTMENT, NEW_BUILD_APARTMENT, VILLA, RENT_ANNUAL])
def test_no_agent_office_or_qr_field_reaches_any_stored_field(rec):
    """These id/QR fields are genuinely present (even if null on some fixtures) on every real
    payload this source ships. None may reach a column, additional_info or source_capture — checked
    generically via the field NAMES the allowlist must never carry, not their (often-null) values."""
    row, _ = _row(rec if rec["MLSID"] != OFF_PLAN_APARTMENT["MLSID"] else NEW_BUILD_APARTMENT)
    for key in _FORBIDDEN_KEYS:
        assert key not in row["additional_info"]
        assert key not in row["source_capture"]


def test_a_poisoned_record_leaks_nothing_even_when_the_source_adds_new_pii():
    """The allowlist's real job: keys nobody has seen yet, and real ones the platform DOES publish
    on some rows (RentGuarantorInformation, LegalRequirementText, an agent object), must not arrive
    by DEFAULT even when populated with realistic contact-shaped values."""
    poisoned = {
        **VILLA,
        "RentGuarantorInformation": "الضامن: سعد بن محمد 0555111222",
        "LegalRequirementText": "يتطلب موافقة الوكيل عبدالله الشهري جوال 0501234567",
        "PixelTrackingCode": "px-966501234567",
        "Agent": {"Name": "عبدالله الشهري", "Phone": "0501234567", "Email": "agent@example.com"},
        "ListingDescriptions": [
            {"Description": "فيلا للبيع، للتواصل واتساب 0555754441 أو agent@example.com",
             "DescriptionTypeUID": "629", "LanguageCode": "ar-SA", "ISOLanguageCode": "ar"},
        ],
    }
    row, _ = _row(poisoned)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for leak in ("0555111222", "0501234567", "سعد بن محمد", "عبدالله الشهري", "agent@example.com",
                "px-966501234567", "0555754441", "Agent", "RentGuarantorInformation",
                "LegalRequirementText", "PixelTrackingCode"):
        assert leak not in blob, f"{leak!r} leaked into a stored payload"
    assert "[redacted]" in row["description"], "the prose redaction must still run"


def test_the_index_this_scraper_reads_carries_no_agent_contact_info_at_all():
    """Structural PDPL: unlike the rendered detail page (which shows agent name/phone/WhatsApp via a
    SEPARATE endpoint this scraper never calls), the search-index payload has none — every allowlist
    key is a plain id/measurement/regulatory field, never a name, phone or email shape."""
    assert not any(k in R._CAPTURE_KEYS for k in _FORBIDDEN_KEYS)


# ── 9. THE REMOVAL ORACLE — a search-index re-query, not an HTML page (a 200 proves nothing here) ─

@pytest.mark.parametrize("rec,expected", [
    (None, "gone"),                                                       # count 0 — fabricated MLSID
    ({"IsViewable": True, "OnHoldListing": False, "ListingStatusUID": 160}, "live"),
    ({"IsViewable": False, "OnHoldListing": True, "ListingStatusUID": 161}, "gone"),   # Cancelled
    ({"IsViewable": False, "OnHoldListing": True, "ListingStatusUID": 162}, "gone"),   # Expired
    ({"IsViewable": False, "OnHoldListing": True, "ListingStatusUID": 167}, "gone"),   # Rented
    ({"IsViewable": False, "OnHoldListing": True, "ListingStatusUID": 1616}, "gone"),  # Proposal
    # measured real anomaly: Active status but IsViewable/OnHoldListing say hidden — inconsistent,
    # so no opinion rather than a guess either way.
    ({"IsViewable": False, "OnHoldListing": True, "ListingStatusUID": 160}, None),
    ({"IsViewable": True, "OnHoldListing": True, "ListingStatusUID": 160}, None),
    ({"IsViewable": None, "OnHoldListing": None, "ListingStatusUID": None}, None),
])
def test_the_signal_states_only_what_the_index_affirms(rec, expected):
    assert R._signal(rec) == expected


def test_verify_gone_withholds_a_kill_without_a_positive_control(monkeypatch):
    monkeypatch.setattr(R, "_index_lookup", lambda s, mlsid: None)   # count 0 -> "gone" signal
    verify_gone = R._make_verify_gone(None)
    verdict, why = verify_gone("RMX113033009-9")
    assert verdict == "unknown" and "positive control" in why


def test_verify_gone_confirms_a_kill_when_the_canary_is_alive(monkeypatch):
    def fake_lookup(s, mlsid):
        if mlsid == "113033009-9":
            return None                                              # the row under test: gone
        return {"IsViewable": True, "OnHoldListing": False, "ListingStatusUID": 160}   # the control

    monkeypatch.setattr(R, "_index_lookup", fake_lookup)
    verify_gone = R._make_verify_gone({"ad_number": "RMX113033009-20"})
    verdict, _why = verify_gone("RMX113033009-9")
    assert verdict == "gone"


def test_verify_gone_fails_closed_when_the_canary_itself_reads_dead(monkeypatch):
    """A source that has stopped answering for a KNOWN-live row cannot testify that any particular
    row is gone — the same fail-closed law abaad/tuba's canary applies."""
    monkeypatch.setattr(R, "_index_lookup", lambda s, mlsid: None)   # EVERYTHING reads gone, incl. control
    verify_gone = R._make_verify_gone({"ad_number": "RMX113033009-20"})
    verdict, why = verify_gone("RMX113033009-9")
    assert verdict == "unknown" and "removal withheld" in why


def test_verify_gone_rejects_an_ad_number_from_another_platform():
    verify_gone = R._make_verify_gone(None)
    verdict, why = verify_gone("ABD12345")
    assert verdict == "unknown" and "not a" in why


def test_an_oracle_exception_is_unknown_never_gone(monkeypatch):
    def boom(s, mlsid):
        raise RuntimeError("network is down")

    monkeypatch.setattr(R, "_index_lookup", boom)
    verify_gone = R._make_verify_gone(None)
    verdict, why = verify_gone("RMX113033009-9")
    assert verdict == "unknown" and "RuntimeError" in why


# ── 10. THE ROW ITSELF: listing_url, photos, no guessed slugs ────────────────────────────────────

def test_listing_url_is_the_records_own_shortlink_never_a_guessed_slug():
    row, _ = _row(VILLA)
    assert row["listing_url"] == ("https://www.remax.sa/en/listings/villa/for-sale/الدرعية/"
                                  "13953-1166-عقرباء-الجبيلة-3808/113033009-23")
    assert row["ad_number"] == "RMX113033009-23"


def test_an_inactive_rows_own_empty_shortlinks_skips_safely_rather_than_guessing_a_url():
    """Real fact: a hidden/historical row publishes ShortLinks: [] — proven with the unmodified
    shape (not the synthetic one _real_rent() adds for the other tests)."""
    rec = {**RENT_ANNUAL, "ShortLinks": []}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == "no_listing_url"


def test_photo_urls_pick_the_quality_folder_from_the_sources_own_two_flags():
    """Verified live: HasLargeImage=1/IsWatermarked=1 → LargeWM (true on all 140 images across all 21
    live listings measured); the fixture also carries an unwatermarked-small image to prove the
    OTHER three folder names are actually derived, not hardcoded."""
    row, _ = _row(NEW_BUILD_APARTMENT)
    assert row["photo_urls"][0] == ("https://cdn.gryphtech.com/userimages/113/LargeWM/"
                                    "L_57913fb7-1dec-4b00-b05d-f51ff761dfbd.jpg")
    assert row["photo_urls"][2] == "https://cdn.gryphtech.com/userimages/113/Small/L_small_no_wm.jpg"
    assert row["images_evidence"]["count"] == 3


def test_no_photos_is_none_not_an_empty_list():
    assert _row({**VILLA, "ListingImages": []})[0]["photo_urls"] is None


# ── 11. THE CRAWL: @odata.count-driven pagination and completeness ───────────────────────────────

class _FakeSession:
    """21 rows, one page (below PAGE_SIZE) — the measured shape."""

    def __init__(self, total: int, page_size: int = 500):
        self.total = total
        self.page_size = page_size
        self.skips: list[int] = []

    def post(self, url, json=None, timeout=0):
        skip = json["skip"]
        self.skips.append(skip)
        batch = [{"content": {"MLSID": str(i)}} for i in range(skip, min(skip + self.page_size, self.total))]

        class _Resp:
            status_code = 200

            def json(_self):
                return {"@odata.count": self.total, "value": batch}

        return _Resp()


def test_the_crawl_declares_itself_complete_when_the_count_matches():
    s = _FakeSession(21)
    items, complete = R.fetch_catalogue(s)
    assert len(items) == 21 and complete is True
    assert len({i["MLSID"] for i in items}) == 21


def test_a_declared_count_larger_than_what_was_served_is_never_complete():
    """complete=False is what keeps db.prune_unseen from retiring rows the source still lists."""
    s = _FakeSession(21)
    s.total = 999               # the SECOND read (used for `declared`) disagrees with what was served
    items, complete = R.fetch_catalogue(_FakeSession(21))
    assert complete is True     # sanity: an honest source-of-truth run is unaffected

    class _Mismatch(_FakeSession):
        def post(self, url, json=None, timeout=0):
            r = super().post(url, json=json, timeout=timeout)
            body = r.json()
            body["@odata.count"] = 999
            r.json = lambda: body
            return r

    items, complete = R.fetch_catalogue(_Mismatch(21))
    assert len(items) == 21 and complete is False


def test_pagination_walks_by_page_size_and_stops_on_a_short_page():
    s = _FakeSession(total=1200, page_size=500)
    items, complete = R.fetch_catalogue(s)
    assert len(items) == 1200 and complete is True
    assert s.skips == [0, 500, 1000]
