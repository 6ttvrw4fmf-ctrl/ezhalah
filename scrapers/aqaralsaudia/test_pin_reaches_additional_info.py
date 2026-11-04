"""aqaralsaudia: the ad's own RealHomes pin must reach additional_info (alert 11049, 2026-11-04).

The index reads a pin ONLY from additional_info.latitude/longitude (listing_rich_attrs' generic
arm). The scraper kept REAL_HOMES_property_location inside source_capture alone, so all 16 live
ads were served with no pin although each stored record held one (captured_pin_not_served).
A pin outside Saudi Arabia must still be refused, never stored.
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
    pm = {"REAL_HOMES_property_price": "700000", "REAL_HOMES_property_size": "150",
          "REAL_HOMES_property_bedrooms": "4", "REAL_HOMES_property_bathrooms": "3",
          "REAL_HOMES_property_address": "لبن, ظهرة لبن, بلدية العريجاء, محافظة الرياض, منطقة الرياض, 13874, السعودية"}
    if loc is not None:
        pm["REAL_HOMES_property_location"] = loc
    return {"id": 7, "link": "https://aqaralsaudia.com/property/x-7/", "title": {"rendered": "شقة فاخرة بحي لبن"},
            "content": {"rendered": ""}, "property_meta": pm,
            "_embedded": {"wp:term": [[{"taxonomy": "property-type", "name": "شقة"},
                                       {"taxonomy": "property-status", "name": "للبيع"}]]}}


# the live shape (listing 11678442): a dict with string halves
row, _ = run.map_listing(_post({"zoom": "", "latitude": "24.636784", "longitude": "46.5966777"}))
assert row is not None
ai = row.get("additional_info") or {}
assert ai.get("latitude") == 24.636784 and ai.get("longitude") == 46.5966777, \
    f"the source pin must reach additional_info, got {ai!r}"

# the older "lat,lng" string shape
row, _ = run.map_listing(_post("24.878950681367,46.89724445343"))
assert (row.get("additional_info") or {}).get("latitude") == 24.878950681367

# a theme default outside Saudi Arabia is refused, never stored
row, _ = run.map_listing(_post({"latitude": "25.68654", "longitude": "-80.431345"}))
assert not row.get("additional_info"), "a pin outside Saudi Arabia must never be stored"

# no pin published -> no pin stored (silence stays silence)
row, _ = run.map_listing(_post(None))
assert not row.get("additional_info")

print("aqaralsaudia pin -> additional_info: OK")
