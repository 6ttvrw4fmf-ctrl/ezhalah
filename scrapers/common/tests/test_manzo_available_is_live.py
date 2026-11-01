"""Manzo «available» is a live status (2026-10-27): the source renamed «active» → «available» ~10-13 and the
crawl skipped every record since. Owner: take them if live and within our rules. Other statuses stay out."""
import pytest

from scrapers.manzo import run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (1, 1) if c else (None, None))


def _d(**kw):
    d = {"display_status": "available", "property_type": "long_term_rent", "property_category": "Apartment",
         "property_id": 9001, "slug": "long_term_rent-60m2-x", "price": "24000.00", "rent_duration": "annual",
         "pricing_options": [{"price": 24000, "period": "annual", "primary": True}], "city": "الرياض",
         "title_ar": "شقة للإيجار في الرياض"}
    d.update(kw)
    return d


def test_available_maps():
    got, why = R.map_property(_d())
    assert got is not None, why


def test_active_still_maps():
    assert R.map_property(_d(display_status="active"))[0] is not None


def test_other_statuses_are_skipped():
    for st in ("rented", "paused", "sold", None, ""):
        got, why = R.map_property(_d(display_status=st))
        assert got is None and why.startswith("status_")


def test_the_published_district_is_stored(monkeypatch):
    monkeypatch.setattr(R, "find_district_in_text", lambda raw, cid: "حي " + raw if raw else None)
    (row, _), why = R.map_property(_d(district={"id": "4137", "name_ar": "البوادي"}))
    assert row["neighborhood"] == "البوادي" and row["district_ar"] == "حي البوادي"


def test_no_district_stays_empty():
    (row, _), _ = R.map_property(_d())
    assert row["neighborhood"] is None and row["district_ar"] is None


def test_the_no_photos_placeholder_is_never_a_photo():
    ph = "https://media.manzo.com.sa/property_media/placeholders/no_photos.jpg"
    (row, _), _ = R.map_property(_d(property_images=[ph]))
    assert row["photo_urls"] == []
    real = "https://media.manzo.com.sa/property_media/x/1.jpg"
    (row, _), _ = R.map_property(_d(property_images=[ph, real]))
    assert row["photo_urls"] == [real]
