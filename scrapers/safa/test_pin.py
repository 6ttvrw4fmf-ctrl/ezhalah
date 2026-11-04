"""safa map pin (⚡ 2026-11-03, backlog 1197: 44 served ads, 0 pins, while the page carries a Maps link).

The unit's own sheet wins, else its project's page; a short link is resolved once per distinct link; a
pair that three or more projects share is the office/footer map and is dropped; a page with no Maps
evidence at all is the source's silence (pin_absent); a failed hop is no verdict ({}), never pin_absent.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.safa.run import _pin_text, unit_pins  # noqa: E402

# _pin_text keeps only the Maps evidence, never the markup.
assert _pin_text('<a href="https://maps.app.goo.gl/AbC123xyz">الموقع</a> 920001912') == "https://maps.app.goo.gl/AbC123xyz"
assert _pin_text('<iframe src="https://maps.google.com/maps?q=24.7136,46.6753&output=embed">') \
    == "https://maps.google.com/maps?q=24.7136,46.6753"
assert _pin_text("<div>لا خريطة</div>") is None and _pin_text(None) is None

calls: list[str] = []
PINS = {"https://maps.app.goo.gl/u1": {"latitude": 24.81, "longitude": 46.61},
        "https://maps.app.goo.gl/p2": {"latitude": 21.55, "longitude": 39.17},
        "https://maps.app.goo.gl/office": {"latitude": 24.70, "longitude": 46.68}}


def resolve(t):
    calls.append(t)
    return PINS.get(t, {})


units = [
    {"pid": "1", "pin_text": "https://maps.app.goo.gl/u1", "project_pin_text": "https://maps.app.goo.gl/office"},
    {"pid": "1", "pin_text": "https://maps.app.goo.gl/u1", "project_pin_text": None},
    {"pid": "2", "pin_text": None, "project_pin_text": "https://maps.app.goo.gl/p2"},   # project page
    {"pid": "3", "pin_text": None, "project_pin_text": None},                           # nothing anywhere
    {"pid": "4", "pin_text": "https://maps.app.goo.gl/dead", "project_pin_text": None}, # hop failed
    {"pid": "5", "pin_text": None, "project_pin_text": "https://maps.app.goo.gl/office"},
    {"pid": "6", "pin_text": None, "project_pin_text": "https://maps.app.goo.gl/office"},
    {"pid": "7", "pin_text": None, "project_pin_text": "https://maps.app.goo.gl/office"},
]
pins = unit_pins(units, resolve)
assert pins[0] == {"latitude": 24.81, "longitude": 46.61}, "the unit's own sheet wins over its project"
assert pins[1] == pins[0]
assert pins[2] == {"latitude": 21.55, "longitude": 39.17}, "a unit with no sheet pin takes its project's"
assert pins[3] == {"pin_absent": True}, "no Maps evidence on either page = the source's silence"
assert pins[4] == {}, "a failed hop is no verdict: the stored pin is kept, never pin_absent"
for i in (5, 6, 7):
    assert pins[i] == {"pin_absent": True}, "a pair three projects share is the office map"
assert calls.count("https://maps.app.goo.gl/u1") == 1 and calls.count("https://maps.app.goo.gl/office") == 1, \
    "each distinct short link is resolved once"
print("ok: safa pins come from the unit sheet or its project page, once per link, never the shared office map")
