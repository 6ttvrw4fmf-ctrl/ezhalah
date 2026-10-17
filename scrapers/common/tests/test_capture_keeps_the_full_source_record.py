"""Every site keeps its COMPLETE source record (owner 2026-10-13: «store every extra info possible for new listings»).

scrapers/common/capture.py rebinds a site's mapper so the dict it was handed rides along, PDPL-clean and size-capped,
under source_capture["source_item"]. These tests EXECUTE it against real shapes: what is kept, what is dropped, that the
mapper's own return shape never changes, and that a failure in the capture can never cost the listing.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

from scrapers.common import capture as C  # noqa: E402
from scrapers.common import db  # noqa: E402

ITEM = {
    "id": 77, "title": "شقة للإيجار", "price": 45000, "old_price": 52000, "discount_label": "خصم ١٣٪",
    "views_count": 312, "negotiable": True, "facade": "شمالية", "rega_ad_license_number": "7100306688",
    "advertiser_name": "مكتب الفلاني", "owner_phone": "0501234567", "mobile": "0559876543",
    "note": "للتواصل 0501234567 أو واتساب 0559876543", "lat": 24.7136523, "lng": 46.6752957,
}


def test_snapshot_keeps_every_source_fact_and_drops_every_contact():
    s = C.snapshot(ITEM)
    for k in ("price", "old_price", "discount_label", "views_count", "negotiable", "facade", "lat", "lng"):
        assert s[k] == ITEM[k], k                              # the extras we never had a column for, byte-identical
    assert "rega_ad_license_number" in s["unkept_keys"]     # licence numbers have their own vetted columns; listed for review, not copied
    flat = json.dumps(s, ensure_ascii=False)
    for gone in ("advertiser_name", "owner_phone", "mobile", "مكتب الفلاني", "0501234567", "0559876543"):
        assert gone not in flat.replace('"unkept_keys"', "") or gone in s["unkept_keys"], gone     # a NAME may be listed as unkept, never a value
    assert "0501234567" not in flat and "0559876543" not in flat and "مكتب الفلاني" not in flat


def test_only_facts_are_kept_and_everything_else_is_listed_by_NAME_never_by_value():
    item = {"price": 100, "title": "فيلا", "description": "نص", "badge": "مميز", "users": {"name": "أحمد", "national_id": "1018344034"},
            "createdById": 55, "adCreator": "فلان", "governmentData": [{"key": "phone", "value": "wa.me/966500000000"}],
            "photoUrl": "https://x/y.webp", "unknownThing": "who knows", "specs": {"area": 300, "agentName": "س", "bedrooms": 3}}
    s = C.snapshot(item)
    assert s["price"] == 100 and s["specs"] == {"area": 300, "bedrooms": 3}
    assert set(s) == {"price", "specs", "unkept_keys"}
    assert s["unkept_keys"] == ["unknownThing"]      # only a field the vocabulary has never seen is listed for review; a person/credential/media/text field is never kept AND never named
    flat = json.dumps(s, ensure_ascii=False)
    for secret in ("أحمد", "1018344034", "wa.me", "فلان", "https://x", "who knows", "مميز"):
        assert secret not in flat, secret


def test_free_text_lists_are_never_read_generically_because_a_site_can_put_a_person_in_one():
    """ibaax's «features» list carries the advertiser's full name, ID number and company beside «مصعد». A vocabulary cannot
    tell a name from a feature, so a list of words is kept only for a site whose real payload a human has read (keep=)."""
    item = {"price": 1, "features": ["مصعد", "عثمان عبدالعزيز بن عثمان الضحوك", "7041580627", "تداول عقارك للعقارات"],
            "amenities": [{"id": 1, "name": "مسبح"}, {"id": 2, "name": "فلان الفلاني"}], "tags": ["a", "b"]}
    s = C.snapshot(item)
    assert "features" not in s and "amenities" not in s and "tags" not in s
    assert set(s["unkept_keys"]) == {"features", "amenities", "tags"}
    flat = json.dumps(s, ensure_ascii=False)
    for secret in ("الضحوك", "7041580627", "تداول", "فلان", "مسبح", "مصعد"):
        assert secret not in flat, secret
    assert C.snapshot({"price": 1, "features": ["مصعد", "7041580627"]}, keep=("features",))["features"] == ["مصعد"]   # opted in: ids still never


def test_a_city_or_type_object_is_read_for_its_label_only():
    s = C.snapshot({"city": {"id": 3, "name": "الرياض", "slug": "riyadh"}, "property_type": {"id": 9, "name": "فيلا"}, "agent": {"name": "س"}})
    assert s["city"] == "الرياض" and s["property_type"] == "فيلا" and "agent" not in s


def test_a_field_a_human_reviewed_for_this_site_can_be_kept_by_name():
    s = C.snapshot({"price": 1, "badge": "جديد"}, keep=("badge",))
    assert s["badge"] == "جديد" and "badge" not in s.get("unkept_keys", [])
    assert "badge" not in C.snapshot({"price": 1, "badge": "جديد"})


def test_snapshot_is_none_for_nothing_and_never_invents():
    assert C.snapshot(None) is None and C.snapshot({}) is None and C.snapshot("html") is None and C.snapshot([1]) is None
    assert C.snapshot({"advertiser": "x", "phone": "0500000000"}) is None            # nothing to keep and nothing worth naming
    assert C.snapshot({"price": None})["price"] is None                              # a silent source stays silent (null, not 0/False)


def test_snapshot_is_json_safe_and_bounded():
    from datetime import date, datetime
    s = C.snapshot({"published_at": datetime(2026, 10, 13, 8, 0), "posted_date": date(2026, 10, 13), "unit_node": object(),
                    "price_ratio": float("nan"), "feature_flags": (1, 0, True), "total_floors": 3})
    assert s["published_at"] == "2026-10-13T08:00:00" and s["posted_date"] == "2026-10-13" and s["feature_flags"] == [1, 0, True]
    assert s["total_floors"] == 3 and "unit_node" in s["unkept_keys"] and s["price_ratio"] is None
    assert C.snapshot({"extra_field": 1, "548412122122": 1, "a@b.sa": 1})["unkept_keys"] == ["extra_field"]   # a key that could itself be data is not listed
    big = {f"price_{i}": "x" * 1500 for i in range(40)}
    big["price_tiny"] = "keep me"
    s = C.snapshot(big)
    assert C._size(s) <= C.MAX_BYTES and s["price_tiny"] == "keep me" and s["_cut"], "the largest keys go first, and are named"
    assert len(C.snapshot({"price_label": "y" * 5000})["price_label"]) <= C.MAX_STR + 1


ROW = {"listing_url": "https://x.sa/1", "ad_number": "1", "property_type": "Apartment", "description": "وصف 0501234567", "photo_urls": ["a", "b"]}


def _mapper(item, *a, **k):
    return dict(ROW)


@pytest.mark.parametrize("shape", ["row", "tuple", "triple", "rows_why_skips", "list"])
def test_the_mappers_return_shape_never_changes(shape):
    out = {
        "row": lambda i: dict(ROW), "tuple": lambda i: (dict(ROW), "residential"), "triple": lambda i: (dict(ROW), None, {"x": 1}),
        "rows_why_skips": lambda i: ([dict(ROW), dict(ROW)], "", {}), "list": lambda i: [dict(ROW)],
    }[shape]
    res = C.with_item_capture(out)(ITEM)
    rows = C._rows_in(res)
    assert rows and all(r["source_capture"]["source_item"]["views_count"] == 312 for r in rows)
    assert type(res) is type(out(ITEM)) and (not isinstance(res, tuple) or len(res) == len(out(ITEM)))


def test_a_row_without_a_capture_gets_the_same_fallback_the_database_layer_would_build():
    row = C.with_item_capture(_mapper)(ITEM)
    cap = row["source_capture"]
    assert cap["schema"] == "auto.v1-fallback" and cap["image_count"] == 2 and cap["url_path"] == ROW["listing_url"]
    assert "0501234567" not in cap["source_text"] and cap["item_schema"] == C.ITEM_SCHEMA
    # …and the database layer accepts it unchanged (the same row goes on to PDPL redaction once more)
    db._ensure_capture(row)
    assert row["source_capture"]["source_item"]["views_count"] == 312 and "0501234567" not in json.dumps(row["source_capture"], ensure_ascii=False)


def test_a_richer_capture_a_site_already_builds_is_kept_and_extended_not_replaced():
    def mapper(item):
        r = dict(ROW)
        r["source_capture"] = {"schema": "sanadak.v2", "source_text": "نص", "extra": 1}
        return r
    cap = C.with_item_capture(mapper)(ITEM)["source_capture"]
    assert cap["schema"] == "sanadak.v2" and cap["extra"] == 1 and cap["source_item"]["old_price"] == 52000


def test_first_dict_is_the_record_later_lookup_tables_are_not():
    def mapper(card, detail, tax):
        return dict(ROW)
    row = C.with_item_capture(mapper)({"price": 5, "views": 1}, {"facade": "detail"}, {1: "a", 2: "b"})
    cap = row["source_capture"]
    assert cap["source_item"]["price"] == 5 and cap["source_item_more"] == [{"facade": "detail"}]
    assert "tax" not in json.dumps(cap) and "'a'" not in json.dumps(cap)


def test_a_mapper_handed_html_text_is_left_exactly_alone():
    row = C.with_item_capture(lambda url, html: dict(ROW))("https://x", "<html>0501234567</html>")
    assert "source_capture" not in row


def test_a_capture_failure_never_costs_the_listing(monkeypatch):
    monkeypatch.setattr(C, "keep_item_on_rows", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    row = C.with_item_capture(_mapper)(ITEM)
    assert row["ad_number"] == "1"


def test_a_mapper_that_raises_still_raises_and_wrapping_twice_is_one_wrap():
    def bad(item):
        raise ValueError("source changed")
    with pytest.raises(ValueError):
        C.with_item_capture(bad)(ITEM)
    w = C.with_item_capture(_mapper)
    assert C.with_item_capture(w) is w
    ns = {"map_listing": _mapper, "other": _mapper}
    C.capture_source_items(ns)
    assert ns["map_listing"]._keeps_source_item and ns["other"] is _mapper


def test_a_real_site_keeps_its_whole_record_end_to_end():
    from scrapers.alhoshan import run as R
    item = {"publicId": 1041, "purpose": "sale", "currentPrice": 630000, "title": "تاون هاوس أرضي للبيع حي بدر الرياض",
            "advertiserName": "مكتب", "contactPhone": "0501112233", "negotiationNote": "تواصل 0501112233",
            "specs": {"city": "الرياض", "district": None, "area": 300, "bedrooms": 3, "bathrooms": 3, "floors": 1,
                      "propertyType": "townhouse", "hoaFee": 120}}
    assert getattr(R.map_listing, "_keeps_source_item", False), "alhoshan must call capture_source_items(globals())"
    orig = R.to_catalog
    R.to_catalog = lambda city, region_hint=None: (1, 1)
    try:
        row, _category = R.map_listing(item, [])
    finally:
        R.to_catalog = orig
    kept = row["source_capture"]["source_item"]
    assert kept["specs"]["hoaFee"] == 120 and kept["currentPrice"] == 630000        # a field the mapper has no column for
    assert "advertiserName" not in kept and "contactPhone" not in kept and "0501112233" not in json.dumps(kept, ensure_ascii=False)
