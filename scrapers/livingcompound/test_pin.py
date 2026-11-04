"""livingcompound: the ad's own map pin (pin_coverage_below_floor, 2026-11-04).

data/pin-sources.json declares livingcompound «ad-page» and it served 0 of 17 pins. The page's own
single-property map canvas carries the pair in data-location, keyed by the post id; every RELATED
property card on the same page carries its own data-location too, and the theme script holds a Sydney
default. Shapes below are copied from live pages read 2026-11-04 (9773 Al Fayha, 9746 Ruwais card).
Mutation-proven: dropping the id check reads the related card's pin; dropping the canvas class reads
the first card on the page.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.livingcompound import run  # noqa: E402

RELATED = ('<div class="g5ere__property-item property-city-al-ruwais" data-id="9746" data-location="{&quot;id&quot;:9746,'
           '&quot;title&quot;:&quot;Luxury 1 BHK&quot;,&quot;position&quot;:{&quot;lat&quot;:&quot;21.512546564630846&quot;,'
           '&quot;lng&quot;:&quot;39.18025017725086&quot;}}"></div>')
SINGLE = ('<div id="g5ere_single_map6aeb" class="g5ere__map-canvas g5ere__single-property-map-canvas"  data-location="{&quot;id&quot;:9773,'
          '&quot;title&quot;:&quot;Luxuary 2 BHK \\u2013 Al Fayha&quot;,&quot;position&quot;:{&quot;lat&quot;:&quot;21.50973149560023&quot;,'
          '&quot;lng&quot;:&quot;39.20304176698778&quot;},&quot;url&quot;:&quot;https://livingcompound.com/x&quot;}"></div>')
SYDNEY = '<script>var g5ere_map_config = {"lat":"-33.868419","lng":"151.193245"};</script>'

# the ad's own canvas wins even when a related card comes first
pin = run.single_map_pin(RELATED + SYDNEY + SINGLE, "9773")
assert pin == {"latitude": 21.50973149560023, "longitude": 39.20304176698778}, pin

# a canvas whose id is not this page's post → no pin (never a neighbour's)
assert run.single_map_pin(SINGLE, "9746") == {}, "read another property's pin"

# no single canvas → no pin, even with related cards and the Sydney default present
assert run.single_map_pin(RELATED + SYDNEY, "9773") == {}

# no post id → no pin
assert run.single_map_pin(SINGLE, None) == {}

# outside Saudi Arabia → rejected by the one gate
assert run.single_map_pin(SINGLE.replace("21.50973149560023", "-33.868419"), "9773") == {}

print("livingcompound pin: OK")
