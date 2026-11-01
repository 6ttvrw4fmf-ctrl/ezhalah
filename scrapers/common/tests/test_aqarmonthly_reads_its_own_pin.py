"""aqarmonthly: Aqar's own pin for the unit (Listing.location {lat, lng}) is read (owner 2026-10-20 night).

The unit page draws a Leaflet map with Aqar's pin; its data carries Listing.location (ad 5993983 →
24.887617, 46.60416). 0 of 3,693 Monthly units were served with a pin because the GraphQL query never
asked for it.
"""
import scrapers.aqarmonthly.run as R


def test_the_query_asks_for_the_location():
    assert "location { lat lng }" in R.detail_query(R.AMENITY_GQL_FIELDS)
    assert R.detail_query() == R.DETAIL_Q                     # () is still exactly the old query


def test_a_schema_that_rejects_location_drops_only_it():
    def answer(q: str):
        if "location { lat lng }" in q:
            return {"errors": [{"message": 'Cannot query field "location" on type "Listing".'}]}
        return {"data": {"Listing": {"get": {"id": 1}}}}
    got = R.settle_amenity_fields(answer)
    assert "location { lat lng }" not in got and "lift" in got and "wc" in got


def test_aqar_pin_reads_location_through_the_ksa_gate():
    assert R.aqar_pin({"location": {"lat": 24.887617, "lng": 46.60416}}) == {"latitude": 24.887617, "longitude": 46.60416}
    assert R.aqar_pin({"location": None}) == {}
    assert R.aqar_pin({"location": {"lat": 0, "lng": 0}}) == {}
    assert R.aqar_pin({"location": {"lat": 46.60416, "lng": 24.887617}}) == {}   # swapped pair is rejected, not guessed


def test_a_crawl_that_never_asked_for_the_location_keeps_the_stored_pin():
    """2026-10-21: a shard whose settle fell back to the old query has no `location` key at all. That
    is not knowing, so the row must carry None (the upsert drops it and the stored pin stays), never {}
    (which overwrote ~690 real pins with nothing and put those ads on the district border)."""
    assert R.aqar_pin({"id": 6182428, "uri": "x"}) is None
    assert R.aqar_pin({}) is None
    assert R.aqar_pin(None) is None
    # Asked and answered «no pin» is still a real answer: {} (the district border).
    assert R.aqar_pin({"location": None}) == {}


def test_the_row_drops_additional_info_when_the_pin_was_not_asked():
    import scrapers.common.db as db
    row = {"listing_url": "u", "additional_info": R.aqar_pin({"id": 1})}
    db._unknown_must_not_overwrite_known(row)
    assert "additional_info" not in row          # the stored pin is left exactly as it was
    asked = {"listing_url": "u", "additional_info": R.aqar_pin({"location": None})}
    db._unknown_must_not_overwrite_known(asked)
    assert asked["additional_info"] == {}        # Aqar answered «no pin»: that is still written
