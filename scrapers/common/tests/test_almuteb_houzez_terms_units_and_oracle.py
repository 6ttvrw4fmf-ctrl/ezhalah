"""almuteb's traps: project names inside the TYPE taxonomy, a Houzez multi-unit with its own
price, floor numbers that live only in a one-line body, and a per-id REST oracle.

Every fixture is a VERBATIM /wp-json/wp/v2/properties record captured 2026-09-24 (trimmed to the
keys the code reads) and the taxonomy names as /wp/v2/<tax> returned them; every assertion runs the
SHIPPING functions (run.map_listing, run.unit_rows, run.multi_units, run.rent_fields,
run.fetch_photos, run._signal_for, run.main). Offline: only to_catalog/find_district_in_text and
db are stubbed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.almuteb import run as R  # noqa: E402

TAX = {
    "property_type": {81: "أدوار", 103: "تاون هاووس", 44: "تجاري", 104: "دور أرضي", 105: "دور أول",
                      106: "دور ثاني", 79: "فيلا", 110: "لافنير آل متعب 46",
                      109: "لافنير آل متعب 70", 107: "لافنير آل متعب 72", 108: "لافنير آل متعب 79"},
    "property_status": {61: "للإيجار", 62: "للبيع", 900: "تم البيع"},   # 900: the sold shape, for the oracle
    "property_city": {83: "الرياض"},
    "property_area": {96: "حي البيان", 98: "حي الصفا", 95: "حي العارض", 100: "حي المصيف"},
    "property_feature": {85: "بلكونة", 87: "تراس", 88: "غرفة خادمة", 89: "غرفة غسيل", 91: "مجلس",
                         90: "مدخل خاصِ", 86: "مدخل سيارة", 93: "مساحة خضراء", 94: "مصعد", 92: "مقلط"},
}
POST_19999 = {'id': 19999, 'link': 'https://almuteb.sa/property/%d9%84%d8%a7%d9%81%d9%86%d9%8a%d8%b1-%d8%a2%d9%84-%d9%85%d8%aa%d8%b9%d8%a8-72/', 'status': 'publish', 'date_gmt': '2025-11-15T17:34:03', 'modified_gmt': '2026-03-28T11:01:57', 'featured_media': 0, 'title': {'rendered': 'لافنير آل متعب 72'}, 'content': {'rendered': '\n<p>فلل بحي الصفا</p>\n'}, 'property_type': [79, 107], 'property_status': [62], 'property_city': [83], 'property_area': [98], 'property_feature': [87, 88, 89, 91, 90, 93, 94, 92], 'property_meta': {'fave_property_price': ['2090000'], 'fave_property_land': ['275'], 'fave_property_bedrooms': ['4'], 'fave_property_bathrooms': ['5'], 'fave_property_images': ['20000', '20001', '20351', '20352', '20353', '20354', '20357']}}   # villa, 7 gallery ids, area term حي الصفا
POST_19957 = {'id': 19957, 'link': 'https://almuteb.sa/property/%d9%84%d8%a7%d9%81%d9%86%d9%8a%d8%b1-%d8%a2%d9%84-%d9%85%d8%aa%d8%b9%d8%a8-70/', 'status': 'publish', 'date_gmt': '2025-11-15T15:54:55', 'modified_gmt': '2026-03-26T10:44:06', 'featured_media': 0, 'title': {'rendered': 'لافنير آل متعب 70'}, 'content': {'rendered': '\n<p>أدوار بحي البيان</p>\n\n\n\n<p></p>\n'}, 'property_type': [81, 109], 'property_status': [62], 'property_city': [83], 'property_area': [96], 'property_feature': [85, 88, 89, 91, 90, 86, 93, 94], 'property_meta': {'fave_property_price': ['1190000'], 'fave_property_size': ['300'], 'fave_property_land': ['300'], 'fave_property_bedrooms': ['4'], 'fave_property_bathrooms': ['4'], 'fave_multi_units': ['a:1:{i:0;a:5:{s:13:"fave_mu_title";s:15:"دور أرضي";s:13:"fave_mu_price";s:6:"992000";s:12:"fave_mu_beds";s:1:"3";s:13:"fave_mu_baths";s:1:"3";s:12:"fave_mu_size";s:3:"150";}}'], 'fave_property_images': ['19960', '20322', '20323', '20324', '20325']}}   # «أدوار» + ONE multi-unit «دور أرضي» 992000
POST_19997 = {'id': 19997, 'link': 'https://almuteb.sa/property/%d9%84%d8%a7%d9%81%d9%86%d9%8a%d8%b1-%d8%a2%d9%84-%d9%85%d8%aa%d8%b9%d8%a8-79-3/', 'status': 'publish', 'date_gmt': '2025-11-15T17:30:40', 'modified_gmt': '2026-03-26T10:40:16', 'featured_media': 0, 'title': {'rendered': 'لافنير آل متعب 79'}, 'content': {'rendered': '\n<p>دور ثاني بحي المصيف</p>\n'}, 'property_type': [81, 108], 'property_status': [62], 'property_city': [83], 'property_area': [], 'property_feature': [91, 90, 94], 'property_meta': {'fave_property_price': ['1200000'], 'fave_property_land': ['120'], 'fave_property_bedrooms': ['2'], 'fave_property_bathrooms': ['3'], 'fave_property_images': ['19993', '20317', '20318', '20321']}}   # «دور ثاني بحي المصيف», no area term


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c == "الرياض" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((d for d in ("حي الصفا", "حي المصيف", "حي البيان") if t and d[3:] in t), None))


def _post(base, **over):
    p = json.loads(json.dumps(base))
    p.update(over)
    return p


def test_type_is_the_first_term_that_maps_never_index_zero():
    row, cat, why = R.map_listing(POST_19999, TAX, [])
    assert why == "" and cat == "residential" and row["property_type"] == "Villa"
    assert row["additional_info"]["type_ar"] == "فيلا"
    swapped = _post(POST_19999, property_type=[107, 79])          # project name first
    assert R.map_listing(swapped, TAX, [])[0]["property_type"] == "Villa"
    only_project = _post(POST_19999, property_type=[107])
    assert R.map_listing(only_project, TAX, [])[2] == "type_unmapped"


def test_floor_number_comes_from_the_body_and_only_for_floors():
    row, _, why = R.map_listing(POST_19997, TAX, [])
    assert why == "" and row["property_type"] == "Floor" and row["floor_number"] == 2
    assert R.map_listing(POST_19999, TAX, [])[0]["floor_number"] is None    # a villa has no floor number
    # A post typed by the floor term itself (live terms 104-106) whose body says only «أدوار …».
    typed = _post(POST_19957, property_type=[106, 109])
    assert R.map_listing(typed, TAX, [])[0]["floor_number"] == 2


def test_price_is_the_stored_figure_exactly_and_a_sale_carries_no_rent_fields():
    row = R.map_listing(POST_19999, TAX, [])[0]
    assert row["transaction_type"] == "Buy" and row["price_total"] == 2_090_000
    assert "price_annual" not in row and "rent_period" not in row
    assert row["additional_info"]["price_raw"] == "2090000"
    odd = _post(POST_19999, property_meta={**POST_19999["property_meta"], "fave_property_price": ["1234567"]})
    assert R.map_listing(odd, TAX, [])[0]["price_total"] == 1_234_567       # never floored or rounded


def test_area_prefers_the_size_field_then_the_land_field_and_keeps_both_raw():
    row = R.map_listing(POST_19999, TAX, [])[0]
    assert row["area_m2"] == 275 and row["additional_info"]["land_area_m2"] == 275
    assert "size_m2" not in row["additional_info"]
    row = R.map_listing(POST_19957, TAX, [])[0]
    assert row["area_m2"] == 300 and row["additional_info"]["size_m2"] == 300


def test_district_from_the_area_term_else_from_the_ads_own_words():
    row = R.map_listing(POST_19999, TAX, [])[0]
    assert (row["district_ar"], row["neighborhood"]) == ("حي الصفا", "حي الصفا")
    row = R.map_listing(POST_19997, TAX, [])[0]
    assert (row["district_ar"], row["neighborhood"]) == ("حي المصيف", "حي المصيف")   # «بحي» loses its preposition


def test_features_are_true_only_and_silence_stays_absent():
    row = R.map_listing(POST_19999, TAX, [])[0]
    assert row["elevator"] is True and row["maid_room"] is True and row["private_entrance"] is True
    assert row["laundry_room"] is True and row["balcony_terrace"] is True
    assert "car_entrance" not in row and "furnished" not in row     # not named → NULL, never False
    assert "مجلس" in row["additional_info"]["features_ar"]


def test_multi_unit_is_its_own_listing_with_its_own_price():
    units = R.multi_units(POST_19957["property_meta"]["fave_multi_units"][0])
    assert units == [{"title": "دور أرضي", "price": "992000", "beds": "3", "baths": "3", "size": "150"}]
    row = R.map_listing(POST_19957, TAX, ["https://almuteb.sa/x.png"])[0]
    assert row["price_total"] == 1_190_000
    (u,) = R.unit_rows(row, POST_19957)
    assert u["ad_number"] == "MTB19957-U0" and u["listing_url"] == row["listing_url"]
    assert u["price_total"] == 992_000 and (u["bedrooms"], u["bathrooms"], u["area_m2"]) == (3, 3, 150)
    assert u["property_type"] == "Floor" and u["floor_number"] == 0
    assert u["additional_info"]["unit_of"] == "MTB19957"
    assert R.unit_rows(R.map_listing(POST_19999, TAX, [])[0], POST_19999) == []
    unpriced = _post(POST_19957, property_meta={**POST_19957["property_meta"], "fave_multi_units": [
        'a:1:{i:0;a:4:{s:13:"fave_mu_title";s:15:"دور أرضي";s:12:"fave_mu_beds";s:1:"3";s:13:"fave_mu_baths";s:1:"3";s:12:"fave_mu_size";s:3:"150";}}']})
    (u,) = R.unit_rows(R.map_listing(unpriced, TAX, [])[0], unpriced)
    assert u["price_total"] is None                       # no fave_mu_price → NULL, never the parent's 1,190,000


def test_a_rent_multi_unit_carries_its_own_figure_through_the_period_reader():
    rent = _post(POST_19957, property_status=[61])
    row = R.map_listing(rent, TAX, [])[0]
    (u,) = R.unit_rows(row, rent)
    assert (row["rent_period"], row["price_annual"]) == (None, 1_190_000)
    assert (u["rent_period"], u["price_annual"]) == (None, 992_000) and "price_total" not in u
    monthly = _post(rent, property_meta={**rent["property_meta"], "fave_property_price_postfix": ["شهري"]})
    (u,) = R.unit_rows(R.map_listing(monthly, TAX, [])[0], monthly)
    assert (u["rent_period"], u["price_annual"]) == ("monthly", 992_000 * 12)


def test_sold_status_auction_and_draft_are_skipped():
    assert R.map_listing(_post(POST_19999, property_status=[900]), TAX, [])[2] == "sold_or_rented"
    assert R.map_listing(_post(POST_19999, content={"rendered": "مزاد علني"}), TAX, [])[2] == "auction"
    assert R.map_listing(_post(POST_19999, status="draft"), TAX, [])[2] == "status_draft"
    assert R.map_listing(_post(POST_19999, property_status=[]), TAX, [])[2] == "no_deal_stated"


def test_rent_period_is_the_sources_word_or_null():
    assert R.rent_fields(100_000, "شقة للإيجار مساحة 181") == (None, 100_000)      # silent → NULL, unscaled
    assert R.rent_fields(5_000, "5000 شهري") == ("monthly", 60_000)
    assert R.rent_fields(5_000, "5000 شهري او سنوي") == (None, 5_000)             # both named → NULL
    assert R.rent_fields(500, "500 يومي") == (None, None)                          # daily → never annual
    rent = _post(POST_19999, property_status=[61])
    row = R.map_listing(rent, TAX, [])[0]
    assert row["transaction_type"] == "Rent" and row["rent_period"] is None
    assert row["price_annual"] == 2_090_000 and "price_total" not in row


def test_an_unplaceable_city_is_skipped_not_defaulted():
    assert R.map_listing(_post(POST_19999, property_city=[]), TAX, [])[2] == "city_not_stated"
    tax = {**TAX, "property_city": {83: "قرية لا وجود لها"}}
    assert R.map_listing(POST_19999, tax, [])[2] == "city_not_in_catalog"


def test_gallery_photo_urls_are_percent_encoded():
    media = [{"id": 20000, "media_type": "image",
              "source_url": "https://almuteb.sa/wp-content/uploads/2025/11/72-الدور-الثاني-03-scaled.png"},
             {"id": 20001, "media_type": "video", "source_url": "https://almuteb.sa/v.mp4"}]
    s = SimpleNamespace(get=lambda url, params=None, timeout=0: SimpleNamespace(
        status_code=200, headers={}, json=lambda: media if "include=" in url or (params and "include" in params) else []))
    got = R.fetch_photos(s, [_post(POST_19999, property_meta={"fave_property_images": ["20000", "20001"]})])
    assert got == {19999: ["https://almuteb.sa/wp-content/uploads/2025/11/72-%D8%A7%D9%84%D8%AF%D9%88%D8%B1-"
                           "%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A-03-scaled.png"]}


def test_liveness_signal_reads_only_what_was_measured():
    sig = R._signal_for(19999, TAX)
    assert sig(404, '{"code":"rest_post_invalid_id","message":"Invalid post ID.","data":{"status":404}}', False) == "gone"
    assert sig(200, '{"id":19999,"status":"publish","property_status":[62]}', False) == "live"
    assert sig(200, '{"id":19999,"status":"publish","property_status":[900]}', False) == "gone"
    assert sig(200, '{"id":19999,"status":"draft","property_status":[62]}', False) == "gone"
    assert sig(200, '{"id":19997,"status":"publish","property_status":[62]}', False) is None   # another id
    assert sig(403, "blocked", False) is None and sig(200, "<html>", False) is None
    assert R._verify_gone_with(TAX)("XYZ")[0] == "unknown"
    assert R._verify_gone_with(TAX)("MTB19957-Ux")[0] == "unknown"


def test_a_unit_row_dies_when_its_parent_no_longer_lists_the_unit():
    live = json.dumps({"id": 19957, "status": "publish", "property_status": [62],
                       "property_meta": {"fave_multi_units": POST_19957["property_meta"]["fave_multi_units"]}})
    assert R._signal_for(19957, TAX, 0)(200, live, False) == "live"
    assert R._signal_for(19957, TAX, 1)(200, live, False) == "gone"          # index 1 never existed
    assert R._signal_for(19957, TAX, None)(200, live, False) == "live"       # the parent row itself
    unit_removed = json.dumps({"id": 19957, "status": "publish", "property_status": [62],
                               "property_meta": {"fave_multi_units": [""]}})
    assert R._signal_for(19957, TAX, 0)(200, unit_removed, False) == "gone"  # parent publish, unit gone
    assert R._signal_for(19957, TAX, None)(200, unit_removed, False) == "live"
    no_meta = json.dumps({"id": 19957, "status": "publish", "property_status": [62]})
    assert R._signal_for(19957, TAX, 0)(200, no_meta, False) == "gone"


def test_main_tallies_every_skip_into_end_run_notes(monkeypatch):
    calls: dict = {"batches": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_taxonomies", lambda s: TAX)
    monkeypatch.setattr(R, "fetch_listings", lambda s, limit=0: (
        [POST_19957, _post(POST_19999, property_status=[900]), _post(POST_19997, content={"rendered": "مزاد"})], 3))
    monkeypatch.setattr(R, "fetch_photos", lambda s, posts: {})
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: calls.setdefault("pruned", []).append((tbl, sorted(seen))) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"][0] == ("almuteb_residential_listings", ["MTB19957", "MTB19957-U0"])
    assert calls["end"]["rows_seen"] == 3 and calls["end"]["rows_upserted"] == 2
    assert "sold_or_rentedx1" in calls["end"]["notes"] and "auctionx1" in calls["end"]["notes"]
    assert calls["end"]["check_tables"] == ["almuteb_residential_listings", "almuteb_commercial_listings"]
    assert calls["pruned"][0] == ("almuteb_residential_listings", ["MTB19957", "MTB19957-U0"])


def test_main_never_prunes_an_incomplete_enumeration(monkeypatch):
    calls: dict = {}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_taxonomies", lambda s: TAX)
    monkeypatch.setattr(R, "fetch_listings", lambda s, limit=0: ([POST_19999], 10))   # x-wp-total says 10
    monkeypatch.setattr(R, "fetch_photos", lambda s, posts: {})
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **kw: pytest.fail("pruned on an incomplete enumeration"))
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert "complete=False" in calls["end"]["notes"]
