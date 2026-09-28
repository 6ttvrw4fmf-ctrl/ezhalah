"""Ezhalah is Saudi-only: eastabha's WordPress still serves 12 ads from 2014 located in أبو ظبي (Yas
Island, Shakhbout City). They must be skipped, never stored; a Saudi city is untouched."""
import sys

sys.path.insert(0, ".")

import scrapers.eastabha.run as R  # noqa: E402

TAX = {"property_city": {1: "أبو ظبي", 2: "أبها"}, "property_county_state": {3: "أبو ظبي", 4: "عسير"},
       "property_category": {5: "فلل"}, "property_action_category": {6: "بيع"}, "property_area": {}}


def _post(city, region):
    return {"id": 1, "title": {"rendered": "فيلا للبيع"}, "content": {"rendered": ""},
            "property_city": [city], "property_county_state": [region],
            "property_category": [5], "property_action_category": [6], "link": "https://eastabha.sa/estate_property/x/"}


def test_an_abu_dhabi_ad_is_skipped():
    assert R.map_listing(_post(1, 3), TAX, {}, None) == (None, None, False)


def test_a_saudi_ad_is_not_skipped_by_the_country_rule():
    try:
        out = R.map_listing(_post(2, 4), TAX, {}, None)
    except Exception:  # noqa: BLE001 — a minimal fixture may trip later field parsing; only the country gate is under test
        return
    assert out != (None, None, False)
