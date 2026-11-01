"""souq24 stores the ad's own map pin (backlog 1111, 2026-11-01).

Every 24.com.sa ad page prints its marker as hidden inputs and a «الحصول على الإتجاه» Maps link
(CI source-reread 41276289583). 46 active ads served 0 pins because map_listing never read it.
The map script's empty-input fallback latitude 24.7136 (Riyadh centre) is the site default, never a pin.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.souq24.run import ad_pin  # noqa: E402

PAGE_1117 = ('<p class="text-danger text-md mt-2"> ( نأمل مطابقة الموقع في أدناه مع الموقع المذكور في وصف موقع العقار المكتوب )</p>\r\n'
             '<input type="hidden" id="lat" value="18.2139" >\r\n<input type="hidden" id="lng" value="42.5001" >\r\n'
             ' <div id="map" class="map mt-5" style="width: 100%; height: 500px;" ></div>\r\n'
             '<a href="https://www.google.com/maps/search/?api=1&amp;query=18.2139,42.5001" class="btn btn-outline-platform">'
             'الحصول على الإتجاه</a>\r\n<script>const lat = parseFloat(document.getElementById("lat")?.value) || 24.7136;</script>')


def test_ad_pin_1117_abha():
    assert ad_pin(PAGE_1117) == {"latitude": 18.2139, "longitude": 42.5001}


def test_raw_ampersand_link_dammam():
    assert ad_pin('<a href="https://www.google.com/maps/search/?api=1&query=26.5559,49.8875">x</a>') == \
        {"latitude": 26.5559, "longitude": 49.8875}


def test_empty_marker_is_no_pin():
    page = PAGE_1117.replace("18.2139,42.5001", ",").replace('value="18.2139"', 'value=""').replace('value="42.5001"', 'value=""')
    assert ad_pin(page) == {}


def test_site_default_is_not_a_pin():
    assert ad_pin('<a href="https://www.google.com/maps/search/?api=1&query=24.7136,46.6753">x</a>') == {}


def test_outside_saudi_is_not_a_pin():
    assert ad_pin('<a href="https://www.google.com/maps/search/?api=1&query=0,0">x</a>') == {}
