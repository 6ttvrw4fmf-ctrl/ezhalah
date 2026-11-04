"""aqaralsaudia: the ad's own map pin (backlog 1197, 2026-11-04).

RealHomes stores the pin the page's Leaflet map draws in property_meta.REAL_HOMES_property_location
{"zoom","latitude","longitude"}. It has been captured into source_capture since 10-30 and never read into
a pin, so pin_coverage_by_platform() read aqaralsaudia 0/16 («declared page-json but serves 0 pins»).
Values below are the live rows' own pairs (2026-11-04).
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))
import scrapers.common.arabic_location as _al  # noqa: E402
_al.to_catalog = lambda city_ar: (None, None)

from scrapers.aqaralsaudia import run  # noqa: E402

run.deal_from_page = lambda url: None


def _post(loc):
    pm = {
        "REAL_HOMES_property_price": "700000",
        "REAL_HOMES_property_size": "150",
        "REAL_HOMES_property_bedrooms": "4",
        "REAL_HOMES_property_bathrooms": "3",
        "REAL_HOMES_property_address": "لبن, ظهرة لبن, بلدية العريجاء, محافظة الرياض, منطقة الرياض, 13874, السعودية",
    }
    if loc is not None:
        pm["REAL_HOMES_property_location"] = loc
    return {
        "id": 1, "link": "https://aqaralsaudia.com/property/x-1/",
        "title": {"rendered": "شقة فاخرة للبيع بحي لبن رقم 1"}, "content": {"rendered": ""},
        "property_meta": pm,
        "_embedded": {"wp:term": [[{"taxonomy": "property-type", "name": "شقة"},
                                   {"taxonomy": "property-status", "name": "للبيع"}]]},
    }


def test_the_ads_own_pair_becomes_the_pin():
    row, _ = run.map_listing(_post({"zoom": "", "latitude": "24.636784", "longitude": "46.5966777"}))
    assert row["additional_info"] == {"latitude": 24.636784, "longitude": 46.5966777}


def test_no_location_field_leaves_no_key_so_a_stored_pin_is_never_blanked():
    row, _ = run.map_listing(_post(None))
    assert "additional_info" not in row


def test_a_pair_outside_saudi_arabia_or_empty_is_refused():
    for loc in ({"latitude": "0", "longitude": "0"}, {"latitude": "", "longitude": ""},
                {"latitude": "51.5", "longitude": "-0.12"}, "24.6,46.5"):
        row, _ = run.map_listing(_post(loc))
        assert "additional_info" not in row, loc
