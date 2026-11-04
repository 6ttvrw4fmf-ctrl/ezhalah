"""flow: the property's own map pin (pin_coverage_below_floor, 2026-11-04).

data/pin-sources.json declares flow «ad-page» and it served 0 of 20 pins. The available-homes page of
riyadh-narjis prints the property's Google Maps place link; the strings below are copied from the live
pages read 2026-11-04 (narjis with a pair, granada without one).
Mutation-proven: reading the `/@` camera gives 46.6366008 (fails); dropping the name check lets the
Narjis link pin riyadh-granada (fails).
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.flow import run  # noqa: E402

NARJIS = ('<a class="PWht2" href="https://www.google.com/maps/place/Flow+Narjis/@24.9005434,46.6366008,17z/'
          'data=!3m1!4b1!4m6!3m5!1s0x3e2eef00718672f9:0x37c176b2c6df3fd1!8m2!3d24.9005434!4d46.6391757!16s%2Fg%2F11ldxsjggs'
          '?entry=ttu&amp;g_ep=EgoyMDI1MDYwNC4wIKXMDSoASAFQAw%3D%3D">Directions</a>')
GRANADA = ('"additionalHref":"https://www.google.com/maps/place/Flow+Granada/data=!4m2!3m1!1s0x0:0x49291e29dd23bd9f'
           '?sa=X\\u0026ved=1t:2428\\u0026ictx=111"')

# the place marker, never the camera
assert run.property_pin(NARJIS, "riyadh-narjis") == {"latitude": 24.9005434, "longitude": 46.6391757}, \
    run.property_pin(NARJIS, "riyadh-narjis")

# a place link with no pair → no pin
assert run.property_pin(GRANADA, "riyadh-granada") == {}

# another property's link never pins this one
assert run.property_pin(NARJIS + GRANADA, "riyadh-granada") == {}
assert run.property_pin(NARJIS, "riyadh-olaya") == {}

# no link at all → no pin
assert run.property_pin("<html></html>", "riyadh-narjis") == {}

print("flow pin: OK")
