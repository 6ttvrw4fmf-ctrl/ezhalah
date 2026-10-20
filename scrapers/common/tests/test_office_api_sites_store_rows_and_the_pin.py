"""aldarim / abwbna / alobid / bahadhabab / alhoshan: the API item's own latitude/longitude becomes the pin
(owner 2026-10-20, «first let's investigate those ones»). Their additional_info was the LEGACY rows array,
which listing_rich_attrs cannot read a pin from; it is now {"rows": [...], "latitude", "longitude"} and
src/data/remote.ts buildAdditionalInfo() unwraps "rows" so the card panel is unchanged.
"""
from pathlib import Path

from scrapers.common.source_pin import pin_dict

ROOT = Path(__file__).resolve().parents[3]
SITES = {
    "aldarim": "{\"rows\": _additional_info(L), **pin_dict(L.get(\"latitude\"), L.get(\"longitude\"))},",
    "abwbna": "{\"rows\": _additional_info(L), **pin_dict(L.get(\"latitude\"), L.get(\"longitude\"))},",
    "alobid": "{\"rows\": _additional_info(L), **pin_dict(L.get(\"latitude\"), L.get(\"longitude\"))},",
    "bahadhabab": "{\"rows\": _additional_info(L), **pin_dict(L.get(\"latitude\"), L.get(\"longitude\"))},",
    # alhoshan: the pair lives under item.specs (measured 2026-10-20)
    "alhoshan": "{\"rows\": _additional_info(p, specs), **pin_dict(specs.get(\"latitude\"), specs.get(\"longitude\"))},",
}


def test_each_site_stores_rows_plus_the_pin():
    for site, call in SITES.items():
        src = (ROOT / "scrapers" / site / "run.py").read_text(encoding="utf-8")
        assert "from scrapers.common.source_pin import pin_dict" in src, site
        assert '"additional_info": ' + call in src, site


def test_string_and_numeric_coordinates_both_pass_the_gate():
    assert pin_dict("24.6925894", "46.5831833") == {"latitude": 24.6925894, "longitude": 46.5831833}
    assert pin_dict(24.5149529, 46.7431743) == {"latitude": 24.5149529, "longitude": 46.7431743}
    assert pin_dict(None, None) == {}                      # the API leaves it null → rows only, border on the card


def test_the_app_unwraps_rows_before_the_legacy_array_branch():
    src = (ROOT / "src" / "data" / "remote.ts").read_text(encoding="utf-8")
    i = src.index("function buildAdditionalInfo(")
    body = src[i:i + 1200]
    assert "Array.isArray(raw.rows)) raw = raw.rows;" in body
    assert body.index("raw = raw.rows") < body.index("if (Array.isArray(raw)) {")
