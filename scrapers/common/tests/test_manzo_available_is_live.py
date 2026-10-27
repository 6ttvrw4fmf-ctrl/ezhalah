"""Manzo «available» is a live status (2026-10-27): the source renamed «active» → «available» ~10-13 and the
crawl skipped every record since. Owner: take them if live and within our rules. Other statuses stay out."""
from scrapers.manzo import run as R


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
