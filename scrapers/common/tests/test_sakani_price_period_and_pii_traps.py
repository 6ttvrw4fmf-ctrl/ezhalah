"""سكني (sakani.sa) barrier: the card's annual figure stays the card's figure, a person never reaches
a stored row, a sale record never becomes a rental, and a Cloudflare challenge never becomes a kill.

WHAT THIS GUARDS, each measured live on 2026-09-23 over the 282-unit rent catalogue:
  1. PRICE / PERIOD. `annual_unit_price` is what the card prints as «SAR 32,400 / كل سنة». The row
     stores it unchanged with rent_period 'annual' from that label. Five land units publish a
     fractional figure (23577: 1555.56005859375); it is passed through and copied exactly to
     additional_info.price_exact — never rounded, never hidden, never rebuilt from an area.
  2. PDPL. The detail record carries owner_name / broker_name / advertiser_name / advertiser_mobile
     / cellphone_number / published_by / owner_id / requester_id / beneficiary_national_id_number
     / responsible_employee_* / company_name (a person's name on most rows). None may survive into
     any column, additional_info or source_capture; a phone typed into the description is redacted.
  3. PURPOSE. market_unit ids are shared with the SALE marketplace (24798 is a live 700,000 SAR
     sale). A record whose licence says advertisement_type "sale" skips, and the liveness signal
     reads it as the RENTAL being gone.
  4. TRI-STATE AMENITIES. The amenities dict is a checkbox form: true → True, false → the key is
     left out. A row can never carry elevator=False from an unticked box.
  5. TRANSPORT. A «Just a moment…» challenge page is no answer: fetch_json returns None, the
     enumeration raises (the run is not ok, nothing is pruned), and verify_gone answers UNKNOWN.
  6. main() tallies every skip by reason into end_run(notes=…) with the two check_tables inline,
     writes through db._wasalt_batch, calls retire_superseded_siblings, and prunes only after the
     in-run positive control passes — and that control (_controls_live) runs the real oracle:
     fewer than three ids, or any non-live verdict, withholds the prune.
  7. ONE WARMED SESSION for the oracle. A cold handshake to the detail route drew a Cloudflare
     challenge on 2 of 3 live controls (2026-09-23); the walk's session answered 5/5. So every probe
     goes through _oracle_session(): main() hands it the walk's session, a standalone caller gets one
     session primed by a single catalogue call, and no probe ever mints a fresh session.

PROVENANCE. RICH_24858 / DETAIL_24858 / RICH_23577 / RICH_21125 / DETAIL_24798_SALE are copied
from the live JSON answers of 2026-09-23 (search/v2/location rich rows and marketUnitsApi/v6/
market_units/<id>), trimmed to the keys the code reads; RICH/DETAIL_24852 (apartment, bathrooms 0
= a blank box) and RICH/DETAIL_24829 (area 147.6699981689453 / "147.67") were captured the same
day for the count-0 and area-fraction traps; the amenities dict keeps only the ticked
boxes (every omitted key was false). DETAIL_WITH_PII is DETAIL_24858 plus the record's REAL PII
key names filled with SYNTHETIC values — the live values are exactly what must never be written
down, including here. Everything runs the SHIPPING functions (`run.map_listing`, `run._signal`,
`run._verify_gone`, `run.fetch_json`, `run.enumerate_rent`, `run.main`); only the two DB-backed
location helpers are stubbed, plus db/session/time for the offline main() run.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import http_liveness  # noqa: E402
from scrapers.sakani import run as R  # noqa: E402

# --- offline stand-ins for the only two DB-backed helpers -------------------------------------
_CATALOG = {"الدمام": (32, 4), "الرياض": (1, 1), "خميس مشيط": (53, 6)}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: (text or "").strip() or None


# ============================ REAL PAYLOAD FRAGMENTS (2026-09-23) =============================
IDX_24858 = {"auction_status": "", "resource_id": 24858, "resource_type": "market_units",
             "unit_types": ["apartment"], "marketplace_price": 32400, "version": "1790212673"}
RICH_24858 = {
    "resource_id": 24858, "status": "published", "publish": True,
    "tags": {"promoted": False, "registering_interest": False, "registering_waiting_list": False,
             "availability": False, "units_available_soon": False, "fully_booked": False,
             "sold_out": False, "direct_from_owner": False, "from_broker": True,
             "from_real_estate_company": False, "price_is_negotiable": False},
    "unit_type": "apartment", "city_text": "الدمام", "region_text": "الشرقية", "city_id": 32,
    "annual_unit_price": 32400, "area": 197.10000610351562, "bedrooms": 1, "bathrooms": 1,
    "main_building_face": [""], "main_street_width": "",
    "location": {"lat": 26.33142290541203, "lon": 50.04455978270359},
    "media_images": [{"image_url": "https://ruh-s3.bluvalt.com/sakani-media-assets/"
                                   "sakani-market-units-service/QNEFnN8P2r92hB45PNyXVia1",
                      "tags": ["banner"]}],
    "price_is_negotiable": False, "publish_date": "",
}
_BANNER = RICH_24858["media_images"][0]["image_url"]
_INTERIOR = ("https://ruh-s3.bluvalt.com/sakani-media-assets/sakani-market-units-service/"
             "XYdSkKpVQLVxRZdhfgkX8gme")
DETAIL_24858 = {
    "status": "published", "publish": True, "publish_date": "2026-09-23", "ad_number": 8948,
    "unit_type": "apartment", "unit_area": "197.1", "unit_price": "32400.0",
    "description": "للايجار غرف وصاله مؤثثة في  حي الشعله ",
    "district_id": 500001063, "city_id": 32,
    "number_of_bedrooms": None, "number_of_rooms": 1, "number_of_bathrooms": 1,
    "number_of_living_rooms": 1, "number_of_reception_rooms": None, "floor_number": None,
    "number_of_floors": None, "building_year": None, "unit_age": None,
    "main_street_width": None, "main_building_face": None, "land_type": "residential",
    "plan_number": "ش د 1411", "unit_number": None, "published_actor": "broker",
    "amenities": {"air_conditioning": True, "kitchen": True, "furnished": True,
                  "independent_electricity": True, "gypsum_board_decoration": True,
                  "porcelain_flooring": True},
    "rega_ad_license": {
        "ad_license_number": "7201147133",
        "ad_license_url": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/"
                          "0139de9d-b9af-4df2-809c-17a6777962a7",
        "advertisement_type": "rent", "end_date": "2027-07-28", "land_number": "89",
        "property_age": None,
        "property_utilities": ["ELECTRICITY", "TELEPHONE", "WATER", "FLOOD_DRAINAGE", "SANITATION"],
        "obligations_on_the_property": "لا"},
    "interior_photos": [{"file_url": _INTERIOR + "?response-content-disposition=inline%3B%20"
                                     "filename%3D%22IMG_4732.jpeg%22&response-content-type=image%2Fjpeg"}],
    "exterior_photos": [{"file_url": _BANNER + "?response-content-disposition=inline%3B%20"
                                     "filename%3D%22IMG_4724.jpeg%22&response-content-type=image%2Fjpeg"}],
}
# 24798 — the SALE apartment in Jeddah that sits in a gap of the rent catalogue.
DETAIL_24798_SALE = {
    "status": "published", "publish": True, "unit_type": "apartment", "unit_area": "157.39",
    "unit_price": "700000.0", "district_id": 844, "city_id": 57, "number_of_rooms": 5,
    "number_of_bathrooms": 3, "main_street_width": "15.0", "land_type": "residential",
    "rega_ad_license": {"ad_license_number": "7201142577", "advertisement_type": "sale",
                        "property_utilities": ["WATER"]},
}
# 23577 — land in Riyadh with the fractional annual figure.
RICH_23577 = {
    "resource_id": 23577, "status": "published", "publish": True, "unit_type": "land",
    "city_text": "الرياض", "region_text": "الرياض", "city_id": 14,
    "annual_unit_price": 1555.56005859375, "area": 450, "bedrooms": 0, "bathrooms": 0,
    "main_building_face": ["northern"],
    "location": {"lat": 24.77218784270536, "lon": 46.629819987169846},
    "media_images": [{"image_url": "https://ruh-s3.bluvalt.com/sakani-media-assets/"
                                   "sakani-market-units-service/seCtfEt7iqgBn5QvmqQt6Mg5"}],
    "tags": {"from_broker": True},
}
# 21125 — the source's hyphenated twin-town label.
RICH_21125 = {
    "resource_id": 21125, "status": "published", "publish": True, "unit_type": "apartment",
    "city_text": "الجموم - بحرة", "region_text": "مكة المكرمة", "city_id": 14392,
    "annual_unit_price": 27600, "area": 961, "bedrooms": 4, "bathrooms": 3,
    "main_building_face": ["western"],
    "location": {"lat": 21.422246774494546, "lon": 39.48113669596612},
    "media_images": [{"image_url": "https://jed-s3.bluvalt.com/sakani-media-assets/"
                                   "sakani-market-units-service/cbATWNwH9YzxsHRo37QeinTM"}],
    "tags": {"from_broker": True},
}
# 24852 — an apartment in خميس مشيط whose bathrooms box was left blank (0) beside bedrooms 4.
RICH_24852 = {
    "resource_id": 24852, "status": "published", "publish": True, "unit_type": "apartment",
    "city_text": "خميس مشيط", "region_text": "عسير", "city_id": 53,
    "annual_unit_price": 26000, "area": 727, "bedrooms": 4, "bathrooms": 0,
    "main_building_face": [""], "media_images": [], "tags": {"from_broker": True},
}
DETAIL_24852 = {
    "status": "published", "publish": True, "unit_type": "apartment", "unit_area": "727.0",
    "unit_price": "26000.0", "district_id": 601001067, "city_id": 53,
    "number_of_bathrooms": None, "number_of_rooms": 4, "number_of_living_rooms": None,
    "land_type": "residential", "amenities": {},
    "rega_ad_license": {"ad_license_number": "7201146597", "advertisement_type": "rent",
                        "property_age": None},
}
# 24829 — an apartment in Riyadh whose area carries a >= .5 fraction (147.67 → 147, never 148).
RICH_24829 = {
    "resource_id": 24829, "status": "published", "publish": True, "unit_type": "apartment",
    "city_text": "الرياض", "region_text": "الرياض", "city_id": 14,
    "annual_unit_price": 100000, "area": 147.6699981689453, "bedrooms": 3, "bathrooms": 3,
    "main_building_face": [""], "media_images": [], "tags": {"from_broker": True},
}
DETAIL_24829 = {
    "status": "published", "publish": True, "unit_type": "apartment", "unit_area": "147.67",
    "unit_price": "100000.0", "district_id": 316, "city_id": 14,
    "number_of_bathrooms": 3, "number_of_rooms": 3, "number_of_living_rooms": 1,
    "land_type": "residential",
    "amenities": {"air_conditioning": True, "furnished": True, "independent_electricity": True,
                  "kitchen": True},
    "rega_ad_license": {"ad_license_number": "7201144808", "advertisement_type": "rent",
                        "property_age": None},
}
# SYNTHETIC values under the record's REAL PII key names (see PROVENANCE).
_PII_VALUES = ("فلان بن فلان الفلاني", "+966500000001", "0500000002", "9900000003",
               "1000000004", "ABCDEF0123456789")
DETAIL_WITH_PII = {
    **DETAIL_24858,
    "description": "للايجار غرف وصاله مؤثثة في حي الشعله للتواصل 0500000002",
    "owner_name": _PII_VALUES[0], "broker_name": _PII_VALUES[0], "advertiser_name": _PII_VALUES[0],
    "advertiser_mobile": _PII_VALUES[1], "cellphone_number": _PII_VALUES[1],
    "published_by": _PII_VALUES[0], "company_name": _PII_VALUES[0],
    "owner_id": _PII_VALUES[4], "requester_id": _PII_VALUES[3],
    "beneficiary_national_id_number": _PII_VALUES[5],
    "preferred_communication_type": {"whatsapp": True, "mobile_number": True},
    "rega_ad_license": {**DETAIL_24858["rega_ad_license"],
                        "responsible_employee_name": _PII_VALUES[0],
                        "responsible_employee_phone_number": _PII_VALUES[1]},
    "interior_photos": [{"file_url": DETAIL_24858["interior_photos"][0]["file_url"],
                         "filename": "5fab2571-interior-IMG_4732.jpeg"}],
}


def _idx(uid: int) -> dict:
    return {**IDX_24858, "resource_id": uid}


# ==================================== 1. PRICE / PERIOD ========================================
def test_the_cards_annual_figure_is_stored_unchanged_with_its_own_period():
    row, cat, why = R.map_listing(IDX_24858, RICH_24858, DETAIL_24858, "الشعلة")
    assert row and not why and cat == "residential"
    assert row["price_annual"] == 32400 and row["rent_period"] == "annual"
    assert "price_total" not in row and "price_per_meter" not in row
    ev = row["price_evidence"]
    assert ev["kind"] == "annual" and ev["unit"] == "total" and ev["raw"] == "32400.0"
    assert ev["field"] == "marketing_rentals.annual_unit_price" and ev["origin"] == "api"
    assert row["additional_info"]["price_exact"] == "32400.0"
    assert row["transaction_type"] == "Rent"


def test_a_fractional_land_price_is_passed_through_and_copied_exactly():
    row, cat, why = R.map_listing(_idx(23577), RICH_23577, None)
    assert row and not why
    assert row["price_annual"] == 1555.56005859375           # never rounded, never NULLed
    assert row["additional_info"]["price_exact"] == 1555.56005859375
    assert row["rent_period"] == "annual"
    assert row["property_type"] == "Residential Land" and cat == "residential"
    assert row["bedrooms"] is None and row["bathrooms"] is None      # land: a 0 is a blank box
    assert row["direction"] == "شمال"
    assert row["area_m2"] == 450 and row["additional_info"]["area_exact"] == 450


def test_no_price_means_no_period_and_a_foreign_price_key_is_never_annual():
    row, _, why = R.map_listing(IDX_24858, {**RICH_24858, "annual_unit_price": 0}, DETAIL_24858)
    assert row and not why
    assert row["price_annual"] is None and row["rent_period"] is None
    # The period is READ from the source's key. A figure published under any other key is unknown.
    rich = {k: v for k, v in RICH_24858.items() if k != "annual_unit_price"}
    row, _, why = R.map_listing(IDX_24858, {**rich, "monthly_unit_price": 2700}, DETAIL_24858)
    assert row and not why
    assert row["price_annual"] is None and row["rent_period"] is None
    assert R._annual_price({"monthly_unit_price": 2700}) == (None, None)
    assert R._annual_price({"annual_unit_price": 32400.0}) == ("annual", 32400)


# ==================================== 2. THE ROW'S FACTS =======================================
def test_facts_land_in_real_columns_and_the_page_url_is_the_unit_page():
    row, _, _ = R.map_listing(IDX_24858, RICH_24858, DETAIL_24858, "الشعلة")
    assert row["ad_number"] == "SKI24858"
    assert row["listing_url"] == "https://sakani.sa/app/market-unit/24858"
    assert row["source"] == "سكني"
    assert row["property_type"] == "Apartment"
    assert row["city_ar"] == "الدمام" and row["city_id"] == 32 and row["region_id"] == 4
    assert row["district_ar"] == "الشعلة" and row["neighborhood"] == "الشعلة"
    assert row["title"] == "شقة - الدمام - الشعلة"
    assert row["description"] == "للايجار غرف وصاله مؤثثة في حي الشعله"   # whitespace collapsed
    assert row["area_m2"] == 197 and row["additional_info"]["area_exact"] == "197.1"
    assert row["bedrooms"] == 1 and row["bathrooms"] == 1 and row["halls"] == 1
    assert row["reception_rooms_majlis"] is None and row["floor_number"] is None
    assert row["license_number"] == "7201147133"          # the AD licence, never a FAL number
    assert row["property_age"] is None                    # unit_age / building_year both silent
    assert row["direction"] is None                       # main_building_face [""] is silence
    assert row["street_width_m"] is None
    assert row["photo_urls"] == [_BANNER, _INTERIOR]      # exterior == banner, deduped; query stripped
    assert row["additional_info"]["lat"] == 26.33142290541203
    assert row["additional_info"]["src_district_id"] == 500001063
    assert row["additional_info"]["detail_captured"] is True


def test_amenities_are_tri_state_true_or_absent_never_false():
    row, _, _ = R.map_listing(IDX_24858, RICH_24858, DETAIL_24858)
    for col in ("furnished", "kitchen", "air_conditioner", "electricity", "water_supply", "sanitation"):
        assert row[col] is True, col
    for col in ("elevator", "parking", "maid_room", "driver_room"):
        assert col not in row, f"{col} must be absent (unticked box), not False"
    assert row["additional_info"]["amenities_named"] == sorted(DETAIL_24858["amenities"])


def test_an_index_only_row_carries_no_detail_facts_but_is_still_a_listing():
    row, _, why = R.map_listing(IDX_24858, RICH_24858, None)
    assert row and not why
    assert row["description"] is None and row["district_ar"] is None and row["neighborhood"] is None
    assert row["license_number"] is None and row["halls"] is None
    assert "furnished" not in row and "electricity" not in row
    assert row["photo_urls"] == [_BANNER]
    assert row["price_annual"] == 32400 and row["additional_info"]["detail_captured"] is False
    assert row["source_capture"]["detail"] is None


def test_a_blank_count_box_is_null_not_a_stated_zero():
    row, _, why = R.map_listing(_idx(24852), RICH_24852, DETAIL_24852)
    assert row and not why
    assert row["bedrooms"] == 4 and row["bathrooms"] is None      # 0 on a dwelling = blank box
    assert row["halls"] is None
    for v in (0, 0.0, "0", -1, 1.5, None, ""):
        assert R._pos(v) is None, v
    assert R._pos(4) == 4 and R._pos("3.0") == 3



def test_a_fractional_area_keeps_its_whole_metres_and_its_exact_string():
    row, _, why = R.map_listing(_idx(24829), RICH_24829, DETAIL_24829)
    assert row and not why
    assert row["area_m2"] == 147                                 # 147.67 is never rounded up
    assert row["additional_info"]["area_exact"] == "147.67"
    row, _, _ = R.map_listing(_idx(24829), RICH_24829, None)     # index-only: the float itself
    assert row["area_m2"] == 147 and row["additional_info"]["area_exact"] == 147.6699981689453


def test_direction_vocabulary_and_commercial_land():
    row, _, _ = R.map_listing(_idx(1), {**RICH_24858, "main_building_face": ["eastern"]}, None)
    assert row["direction"] == "شرق"
    row, _, _ = R.map_listing(_idx(1), {**RICH_24858, "main_building_face": ["south_east"]}, None)
    assert row["direction"] == "جنوب شرق"
    row, _, _ = R.map_listing(_idx(1), {**RICH_24858, "main_building_face": ["three_streets"]}, None)
    assert row["direction"] is None and row["additional_info"]["main_building_face"] == "three_streets"
    row, cat, _ = R.map_listing(_idx(2), {**RICH_23577, "unit_type": "land"},
                                {**DETAIL_24858, "land_type": "commercial"})
    assert row["property_type"] == "Commercial Land" and cat == "commercial"


# ==================================== 3. PDPL ===================================================
def test_nothing_personal_survives_into_the_row():
    row, _, why = R.map_listing(IDX_24858, RICH_24858, DETAIL_WITH_PII, "الشعلة")
    assert row and not why
    blob = json.dumps(row, ensure_ascii=False)
    for v in _PII_VALUES:
        assert v not in blob, v
    for key in ("owner_name", "broker_name", "advertiser", "cellphone", "published_by", "owner_id",
                "requester_id", "national_id", "company_name", "responsible_employee",
                "preferred_communication", "filename"):
        assert key not in blob, key
    assert row["description"] == "للايجار غرف وصاله مؤثثة في حي الشعله للتواصل [redacted]"
    assert row["source_capture"]["detail"]["description"] == row["description"]
    assert row["license_number"] == "7201147133"          # regulatory data is NOT PII
    assert row["source_capture"]["detail"]["rega_ad_license"]["ad_license_number"] == "7201147133"


# ==================================== 4. SKIPS ==================================================
def test_a_sale_record_is_not_a_rental():
    assert R.map_listing(_idx(24798), {**RICH_24858, "resource_id": 24798},
                         DETAIL_24798_SALE)[2] == "purpose_sale"


def test_status_and_marker_skips_are_named_never_guessed():
    assert R.map_listing(IDX_24858, {**RICH_24858, "status": "unpublished"}, None)[2] == "status_unpublished"
    assert R.map_listing(IDX_24858, {**RICH_24858, "publish": False}, None)[2] == "status_published"
    assert R.map_listing({**IDX_24858, "auction_status": "live"}, RICH_24858, None)[2] == "auction"
    assert R.map_listing(IDX_24858, {**RICH_24858, "tags": {"sold_out": True}}, None)[2] == "sold_out"
    assert R.map_listing(IDX_24858, {**RICH_24858, "tags": {"units_available_soon": True}}, None)[2] == "coming_soon"
    assert R.map_listing(IDX_24858, RICH_24858, {**DETAIL_24858, "status": "rejected"})[2] == "detail_status_rejected"


def test_unmappable_type_unplaceable_city_and_missing_id_skip():
    assert R.map_listing(IDX_24858, {**RICH_24858, "unit_type": "chalet_x"}, None)[2] == "type_unmapped"
    assert R.map_listing(_idx(21125), RICH_21125, None)[2] == "city_not_in_catalog"
    assert R.map_listing(IDX_24858, {**RICH_24858, "city_text": ""}, None)[2] == "no_city"
    assert R.map_listing({"auction_status": ""}, {**RICH_24858, "resource_id": None}, None)[2] == "no_id"


# ==================================== 5. LIVENESS ===============================================
def _detail_body(attrs: dict) -> str:
    return json.dumps({"data": {"id": "24858", "type": "market_units", "attributes": attrs}})


def test_signal_reads_only_the_measured_shapes():
    assert R._signal(404, '{"message":"not found"}', False) == "gone"
    assert R._signal(404, '{"message":"something else"}', False) is None
    assert R._signal(200, _detail_body(DETAIL_24858), False) == "live"
    assert R._signal(200, _detail_body(DETAIL_24798_SALE), False) == "gone"
    assert R._signal(200, _detail_body({**DETAIL_24858, "status": "unpublished"}), False) == "gone"
    assert R._signal(200, _detail_body({**DETAIL_24858, "publish": False}), False) == "gone"
    assert R._signal(200, _detail_body({}), False) is None
    assert R._signal(403, "<html>Just a moment...</html>", False) is None
    assert R._signal(500, "<html>403 Forbidden</html>", False) is None
    assert R._signal(200, "not json", False) is None


class _Resp:
    def __init__(self, status: int, text: str, ct: str, url: str = ""):
        self.status_code, self.text, self.url = status, text, url
        self.headers = {"content-type": ct}

    def json(self):
        return json.loads(self.text)


class _Session:
    """A curl_cffi stand-in that answers a scripted sequence."""
    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def get(self, url, params=None, timeout=None, allow_redirects=True):
        self.calls.append((url, params))
        a = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(a, Exception):
            raise a
        return a


_CHALLENGE = _Resp(403, "<html><title>Just a moment...</title></html>", "text/html; charset=UTF-8")


def test_verify_gone_kills_on_the_sources_404_and_never_on_a_challenge(monkeypatch):
    monkeypatch.setattr(http_liveness.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "_oracle_sess", _Session([_Resp(404, '{"message":"not found"}', "application/json")]))
    assert R._verify_gone("SKI1000")[0] == "gone"
    monkeypatch.setattr(R, "_oracle_sess", _Session([_Resp(200, _detail_body(DETAIL_24858), "application/json")]))
    assert R._verify_gone("SKI24858")[0] == "live"
    monkeypatch.setattr(R, "_oracle_sess", _Session([_CHALLENGE]))
    verdict, why = R._verify_gone("SKI24858")
    assert verdict == "unknown" and "403" in why
    # The hidden-unit shape (20250): HTTP 403 even with a JSON body is about OUR access — the shared
    # law withholds the kill whatever the signal would have said.
    monkeypatch.setattr(R, "_oracle_sess", _Session([_Resp(403, '{"message":"not found"}', "application/json")]))
    assert R._verify_gone("SKI20250")[0] == "unknown"
    assert R._verify_gone("NOTSAKANI")[0] == "unknown"


def test_every_probe_goes_through_one_warmed_session_never_a_cold_one(monkeypatch):
    """Measured 2026-09-23: a fresh session per probe → 2 of 3 live controls answered 'unknown
    HTTP 403' (Cloudflare challenges the cold handshake); the walk's session → 5/5. The oracle must
    therefore (a) mint ONE session, (b) warm it with a catalogue call, (c) reuse it for every
    probe, and (d) take the walk's session when main() has one."""
    monkeypatch.setattr(http_liveness.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "_oracle_sess", None)
    minted: list = []
    live = _Resp(200, _detail_body(DETAIL_24858), "application/json")

    def mint():
        minted.append(_Session([_Resp(200, '{"data": []}', "application/json"), live]))
        return minted[-1]
    monkeypatch.setattr(R, "session", mint)
    assert R._verify_gone("SKI24858")[0] == "live"
    assert R._verify_gone("SKI24855")[0] == "live"
    assert R._verify_gone("SKI24852")[0] == "live"
    assert len(minted) == 1, "one session for the whole oracle, never one per probe"
    assert R._oracle_session() is minted[0]
    urls = [u for u, _ in minted[0].calls]
    assert urls[0] == R.SEARCH, "the session is warmed by a catalogue call before any probe"
    assert urls[1:] == [R.DETAIL + "24858", R.DETAIL + "24855", R.DETAIL + "24852"]
    # the walk's own session is the oracle's session once main() has built one
    walk = _Session([live])
    monkeypatch.setattr(R, "_oracle_sess", walk)
    assert R._verify_gone("SKI24858")[0] == "live" and walk.calls and len(minted) == 1


def test_the_in_run_control_needs_three_live_verdicts_and_stops_at_the_first_miss(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    asked: list = []

    def scripted(verdicts):
        script = list(verdicts)
        def verify(ad):
            asked.append(ad)
            return script.pop(0), "scripted"
        return verify
    monkeypatch.setattr(R, "_verify_gone", scripted(["live", "live", "live"]))
    assert R._controls_live(["SKI1", "SKI2"]) is False and asked == []   # < 3 ids: nothing to test
    assert R._controls_live(["SKI1", "SKI2", "SKI3", "SKI4"]) is True
    assert asked == ["SKI1", "SKI2", "SKI3"]                              # exactly three, not four
    asked.clear()
    monkeypatch.setattr(R, "_verify_gone", scripted(["live", "unknown", "live"]))
    assert R._controls_live(["SKI1", "SKI2", "SKI3"]) is False
    assert asked == ["SKI1", "SKI2"]                                      # stops at the first miss
    asked.clear()
    monkeypatch.setattr(R, "_verify_gone", scripted(["gone", "live", "live"]))
    assert R._controls_live(["SKI1", "SKI2", "SKI3"]) is False and asked == ["SKI1"]


def test_fetch_json_treats_a_challenge_as_no_answer_and_enumeration_fails_closed(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    s = _Session([_CHALLENGE])
    assert R.fetch_json(s, R.SEARCH, tries=3) is None
    assert len(s.calls) == 3
    import pytest
    with pytest.raises(RuntimeError):
        R.enumerate_rent(_Session([_CHALLENGE]))
    # a real answer after one challenge is read normally
    s = _Session([_CHALLENGE, _Resp(200, '{"data": []}', "application/json")])
    assert R.fetch_json(s, R.SEARCH) == (200, {"data": []})


def _page(rows: list[dict], with_rich: bool = True) -> _Resp:
    data = [{"id": f"market_unit_{r['resource_id']}", "type": "searches",
             "attributes": {"resource_id": r["resource_id"], "auction_status": ""}} for r in rows]
    rich = [{"id": f"market_unit_{r['resource_id']}", "type": "marketing_rentals", "attributes": r}
            for r in rows] if with_rich else []
    return _Resp(200, json.dumps({"data": data, "meta": {"first_page": {"data": rich}}}), "application/json")


def test_enumeration_walks_pages_and_demands_the_rich_row(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    first = [{**RICH_24858, "resource_id": 30000 + i} for i in range(R.PAGE_SIZE)]
    second = [RICH_23577, RICH_21125]
    s = _Session([_page(first), _page(second), _Resp(500, "", "text/html")])
    units = R.enumerate_rent(s)
    assert [u[1]["resource_id"] for u in units] == [30000 + i for i in range(R.PAGE_SIZE)] + [23577, 21125]
    assert len(s.calls) == 2 and s.calls[1][1]["page[number]"] == 2
    import pytest
    with pytest.raises(RuntimeError):
        R.enumerate_rent(_Session([_page([RICH_24858], with_rich=False)]))


# ==================================== 6. main() =================================================
def _stub_db(monkeypatch):
    calls = {"batch": [], "end_run": [], "prune": [], "retire": []}
    db = types.SimpleNamespace(
        begin_run=lambda platform: 77,
        _wasalt_batch=lambda table, rows: calls["batch"].append((table, [r["ad_number"] for r in rows])),
        retire_superseded_siblings=lambda **kw: calls["retire"].append(kw) or 0,
        prune_unseen=lambda table, seen, source=None, **kw: calls["prune"].append((table, sorted(seen), kw)) or 0,
        end_run=lambda run_id, **kw: calls["end_run"].append((run_id, kw)) or True,
    )
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "_oracle_sess", None)
    return calls


_UNITS = [
    (_idx(24858), RICH_24858),                              # full row
    (_idx(24798), {**RICH_24858, "resource_id": 24798}),    # detail says sale → skip
    (_idx(21125), RICH_21125),                              # detail miss + city not in catalog
    (_idx(23577), RICH_23577),                              # detail miss → index-only row
    (_idx(22222), {**RICH_24858, "resource_id": 22222}),    # the source's own 404 → skip
]
_DETAILS = {"24858": ("ok", DETAIL_24858), "24798": ("ok", DETAIL_24798_SALE),
            "21125": ("miss", None), "23577": ("miss", None), "22222": ("not_found", None)}


def test_main_tallies_every_skip_into_end_run_and_prunes_only_behind_the_control(monkeypatch):
    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "enumerate_rent", lambda s: list(_UNITS))
    monkeypatch.setattr(R, "fetch_detail", lambda s, uid: _DETAILS[uid])
    monkeypatch.setattr(R, "district_names", lambda s, cid, cache: {"500001063": "الشعلة"})
    monkeypatch.setattr(R, "_controls_live", lambda ads: False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 0
    assert calls["batch"] == [("sakani_residential_listings", ["SKI24858", "SKI23577"]),
                              ("sakani_commercial_listings", [])]
    assert calls["retire"] and calls["retire"][0]["res_table"] == "sakani_residential_listings"
    assert calls["prune"] == []                              # control failed → nothing pruned
    run_id, kw = calls["end_run"][0]
    assert run_id == 77 and kw["ok"] is True
    assert kw["rows_seen"] == 5 and kw["rows_upserted"] == 2
    assert kw["degraded"] is True                            # 2 of 5 rows index-only (> 20 %)
    for tally in ("purpose_salex1", "city_not_in_catalogx1", "detail_missx2", "detail_not_foundx1", "pruned=0"):
        assert tally in kw["notes"], (tally, kw["notes"])
    assert kw["check_tables"] == ["sakani_residential_listings", "sakani_commercial_listings"]

    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "_controls_live", lambda ads: ads[:1] == ["SKI24858"])
    assert R.main() == 0
    assert [p[0] for p in calls["prune"]] == ["sakani_residential_listings", "sakani_commercial_listings"]
    assert calls["prune"][0][1] == ["SKI23577", "SKI24858"]
    assert calls["prune"][0][2]["verify_gone"] is R._verify_gone


def test_main_hands_the_walks_session_to_the_oracle_and_a_type_run_never_prunes(monkeypatch):
    calls = _stub_db(monkeypatch)
    walk = object()
    monkeypatch.setattr(R, "session", lambda: walk)
    monkeypatch.setattr(R, "enumerate_rent", lambda s: list(_UNITS))
    monkeypatch.setattr(R, "fetch_detail", lambda s, uid: _DETAILS[uid])
    monkeypatch.setattr(R, "district_names", lambda s, cid, cache: {"500001063": "الشعلة"})
    monkeypatch.setattr(R, "_controls_live", lambda ads: True)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 0
    assert R._oracle_sess is walk, "the oracle probes through the walk's warmed session"
    assert [p[0] for p in calls["prune"]] == ["sakani_residential_listings", "sakani_commercial_listings"]

    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "residential"])
    assert R.main() == 0
    assert calls["batch"] == [("sakani_residential_listings", ["SKI24858", "SKI23577"]),
                              ("sakani_commercial_listings", [])]
    assert calls["prune"] == [], "a --type run leaves the other table's seen-set empty: never prune"
    assert calls["end_run"][0][1]["ok"] is True


def test_a_blocked_walk_is_a_failed_run_that_writes_nothing(monkeypatch):
    calls = _stub_db(monkeypatch)

    def blocked(s):
        raise RuntimeError("catalogue page 1 unreadable (challenge/transport) — walk aborted")
    monkeypatch.setattr(R, "enumerate_rent", blocked)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 1
    assert calls["batch"] == [] and calls["prune"] == []
    assert calls["end_run"][0][1]["ok"] is False and "walk aborted" in calls["end_run"][0][1]["notes"]


def test_session_asks_for_arabic_json_and_never_sets_a_user_agent():
    s = R.session()
    assert s.headers["Accept-Language"] == "ar" and s.headers["Accept"] == "application/json"
    assert "User-Agent" not in s.headers and "user-agent" not in s.headers
