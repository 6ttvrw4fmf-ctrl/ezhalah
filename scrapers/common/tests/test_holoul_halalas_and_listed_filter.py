"""Holoul: money is in HALALAS; the feed ignores every filter, so listed + licensed + Sale is applied here."""
import pytest

import scrapers.holoul.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي الرمال" if t else None)


def _u(**kw):
    u = {"id": "u1", "status": "listed", "nhc_ad_license_number": "7201234567", "price": 78500000,
         "price_per_meter": 487577, "nhc_advertisement_type": {"name": "بيع"}, "nhc_property_type": {"name": "شقة"},
         "design": {"total_area": 161}, "nhc_advertiser_phone": "0501234567", "nhc_advertiser_name": "مكتب س",
         "project": {"status": "listed", "title": "مشروع", "nhc_city": {"name": "الرياض"}, "nhc_district": {"name": "الرمال"}}}
    u.update(kw)
    return u


def test_halalas_become_riyals_exactly_as_the_page_prints():
    (row, _), why = R.map_unit(_u())
    assert why == "" and row["price_total"] == 785000 and row["price_per_meter"] == 4875 and row["area_m2"] == 161.0
    assert row["listing_url"] == "https://app.holoul.io/units/u1"      # /ar/units/ is a 404 on the live site


def test_an_unlisted_project_or_unit_is_not_a_listing():
    assert R.map_unit(_u(status="reserved"))[0] is None
    assert R.map_unit(_u(project={"status": "draft"}))[0] is None


def test_no_licence_is_a_demo_row_and_no_ad_type_is_not_assumed_a_sale():
    assert R.map_unit(_u(nhc_ad_license_number=None)) == (None, "no_rega_licence_demo_row")
    assert R.map_unit(_u(nhc_advertisement_type=None))[0] is None


def test_the_advertiser_is_never_stored():
    (row, _), _ = R.map_unit(_u())
    assert "0501234567" not in str(row) and "مكتب س" not in str(row)


def test_the_units_own_api_location_is_its_pin():
    # audit 2026-10-21: «أدوار بدر» units carry location {latitude, longitude} = the building's address point;
    # the scraper ignored it, so 30 units showed a border over a published pin.
    (row, _), _ = R.map_unit(_u(location={"latitude": 24.500621, "longitude": 46.735823}))
    assert row["additional_info"]["latitude"] == 24.500621 and row["additional_info"]["longitude"] == 46.735823


def test_no_location_means_no_pin_not_a_guess():
    (row, _), _ = R.map_unit(_u())
    assert "latitude" not in row["additional_info"]


def test_a_source_that_fails_every_route_still_writes_a_failed_run_naming_the_error(monkeypatch):
    """10-22/10-23: every route answered 504 and the crawl died before begin_run, leaving no row."""
    calls = []
    monkeypatch.setattr(R.db, "begin_run", lambda slug: calls.append(("begin", slug)) or 42)
    monkeypatch.setattr(R.db, "end_run", lambda rid, **kw: calls.append(("end", rid, kw)) or True)

    def boom(*a, **k):
        raise RuntimeError("HTTP Error 504: ")
    monkeypatch.setattr(R, "retry_smarter_session", boom)
    monkeypatch.setattr("sys.argv", ["holoul", "--type", "all"])
    with pytest.raises(RuntimeError):
        R.main()
    assert calls[0] == ("begin", "holoul")
    end = calls[-1]
    assert end[0] == "end" and end[1] == 42 and end[2]["ok"] is False and "504" in end[2]["notes"]
