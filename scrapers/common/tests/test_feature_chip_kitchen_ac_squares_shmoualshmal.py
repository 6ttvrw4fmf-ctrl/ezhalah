"""squares and shmoualshmal publish a STRUCTURED feature list; every chip that names a column answers it.

Measured 2026-10-13 (AF backlog 461): squares' active ads carry «مطبخ كامل» (2) and «مكيف إسبليت» (2),
which its exact-word map did not know (it only had «مطبخ»), so kitchen and AC stayed NULL; all 6 active
shmoualshmal ads carry the tag «مطبخ», which its map did not name at all. A customer asking the
Advanced Filter for a kitchen or AC never found them. Absence stays NULL: a list that omits a chip
does not say the property lacks it.
"""
import scrapers.shmoualshmal.run as SH
import scrapers.squares.run as SQ


def _squares_row(features, monkeypatch):
    monkeypatch.setattr(SQ, "place", lambda a: ("بريدة", 1, 1, None, None))
    monkeypatch.setattr(SQ, "find_district_in_text", lambda t, c: None)
    rec = {"id": 1, "link": "https://squares.com.sa/x/", "title": {"rendered": "للبيع فيلا"}, "content": {"rendered": ""}}
    detail = {"address": "بريدة, القصيم, السعودية", "price_text": "ريال840,000", "facts": {}, "features": features}
    return SQ.map_listing(rec, "فيلا", "Buy", detail)[0]


def test_squares_full_kitchen_and_split_ac_chips_answer_their_columns(monkeypatch):
    row = _squares_row(["مطبخ كامل", "مكيف إسبليت", "مجلس رجال"], monkeypatch)
    assert row.get("kitchen") is True
    assert row.get("air_conditioner") is True


def test_squares_silence_stays_null(monkeypatch):
    row = _squares_row(["مجلس رجال"], monkeypatch)
    assert row.get("kitchen") is None and row.get("air_conditioner") is None


def _sh_row(features):
    tax = {"property_status": {1: "للبيع"}, "property_type": {1: "فيلا"}, "property_city": {1: "تبوك"},
           "property_area": {1: "حي الصفا"}, "property_feature": {i: f for i, f in enumerate(features, start=1)}}
    p = {"id": 7, "slug": "x", "link": "https://shmoualshmal.com/x/", "property_status": [1], "property_type": [1],
         "property_city": [1], "property_area": [1], "property_feature": list(range(1, len(features) + 1)),
         "title": {"rendered": "فيلا"}, "content": {"rendered": ""}, "property_meta": {}}
    return SH.map_listing(p, tax)[0]


def test_shmoualshmal_kitchen_tag_answers_kitchen():
    assert _sh_row(["مطبخ", "سطح"]).get("kitchen") is True


def test_shmoualshmal_silence_stays_null():
    assert _sh_row(["سطح"]).get("kitchen") is None


def test_squares_street_width_comes_from_the_ad_words(monkeypatch):
    # No structured width/facade field on squares; 13602726 says «عرض الشارع : 15 متر» (re-read 38384423613).
    monkeypatch.setattr(SQ, "place", lambda a: ("الرياض", 3, 1, None, None))
    monkeypatch.setattr(SQ, "find_district_in_text", lambda t, c: None)
    rec = {"id": 2, "link": "https://squares.com.sa/y/", "title": {"rendered": "فيلا بحي القدس للبيع"},
           "content": {"rendered": "المساحة : 360 متر مربع\nعرض الشارع : 15 متر\nعمر العقار : سنتين"}}
    detail = {"address": "حي القدس, الرياض, السعودية", "price_text": "ريال4,500,000", "facts": {}, "features": []}
    row = SQ.map_listing(rec, "فيلا", "Buy", detail)[0]
    assert row.get("street_width_m") == 15
    assert row.get("direction") is None
    rec["content"]["rendered"] = "المساحة : 360 متر مربع"
    assert SQ.map_listing(rec, "فيلا", "Buy", detail)[0].get("street_width_m") is None
