"""Manzo: a ticked feature box answers the Advanced Filter; an unticked one stays unknown (2026-10-30).

apartment.features was kept in additional_info and never mapped, so all 708 manzo ads answered no amenity. The
checklist sends every key as true/false, and false sits on ads whose own description says furnished, so an unticked
box is not the source saying «no»: it must stay NULL, never false."""
import pytest

import scrapers.manzo.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))


FEATURES = {"balcony": False, "elevator": True, "landline": False, "maid_room": False, "central_ac": True,
            "shared_gym": True, "study_room": False, "shared_pool": False, "laundry_room": False,
            "storage_room": False, "security_24_7": False, "kids_play_area": False, "covered_parking": True,
            "concierge_service": False, "built_in_wardrobes": False}


def _row(features):
    d = {"display_status": "active", "property_type": "long_term_rent", "property_category": "Apartment",
         "slug": "long_term_rent-85m2-AW2qvy65", "property_id": 2271, "price": "3600.00", "area": "85.00",
         "pricing_options": [{"price": 3600.0, "period": "monthly", "primary": True}], "city": "الرياض",
         "title_ar": "شقة للإيجار في الرياض", "apartment": {"bedrooms": 1, "bathrooms": 1, "features": features}}
    (row, _), why = R.map_property(d)
    assert why == ""
    return row


def test_a_ticked_box_is_a_yes():
    row = _row(FEATURES)
    assert (row.get("elevator"), row.get("air_conditioner"), row.get("parking")) == (True, True, True)


def test_an_unticked_box_is_unknown_never_no():
    row = _row(FEATURES)
    for col in ("maid_room", "laundry_room", "balcony_terrace"):
        assert col not in row, (col, row.get(col))
    assert not any(row.get(c) is False for c in R._FEATURE_COLUMNS.values())
    assert all(c not in _row({k: False for k in FEATURES}) for c in R._FEATURE_COLUMNS.values())


# information_schema, 2026-10-30: both manzo tables carry exactly these (an unknown key fails the whole upsert, PGRST204)
MANZO_COLUMNS = {"air_conditioner", "balcony_terrace", "elevator", "laundry_room", "maid_room", "parking"}


def test_every_mapped_column_exists_on_the_table():
    assert set(R._FEATURE_COLUMNS.values()) <= MANZO_COLUMNS


def test_details_are_read_in_parallel_in_order_and_a_failure_is_unreadable():
    """10-30: 856 details read one by one outgrew the 10-minute job, so no crawl finished after 10-28."""
    import threading
    import time

    from curl_cffi import requests as cc

    live, peak, lock = [0], [0], threading.Lock()

    def fetch(sess, url):
        with lock:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
        time.sleep(0.02)
        with lock:
            live[0] -= 1
        if url.endswith("/bad/"):
            raise RuntimeError("timeout")
        return {"data": {"slug": url.rstrip("/").rsplit("/", 1)[-1]}}

    listing = [{"slug": f"s{i}"} for i in range(20)] + [{"slug": "bad"}]
    got = R.read_details(cc.Session(impersonate="chrome124"), listing, fetch=fetch)
    assert [g and g["slug"] for g in got] == [f"s{i}" for i in range(20)] + [None]
    assert 1 < peak[0] <= R.DETAIL_WORKERS
