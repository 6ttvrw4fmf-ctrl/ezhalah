"""sodasyat: the ad's own map pin (pin_coverage_below_floor, 2026-11-04).

data/pin-sources.json declares sodasyat «ad-page» and it served 0 of 13 pins. The detail page draws ONE
live `new google.maps.Marker({position: {lat, lng}})` and keeps several commented-out markers/circles.
The script below is the live shape of https://sodasyat.sa/single/2722 (read 2026-11-04); the commented
marker is given a DIFFERENT pair here so the test proves the comment is never read.
Mutation-proven: removing the comment strip reads the commented marker; dropping the reader leaves no pin.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.sodasyat import run  # noqa: E402

SCRIPT = """<script>
        $(document).ready(function() {
            // var old = new google.maps.Marker({ position: { lat: 24.71, lng: 46.67 }, map: map });
            // var marker = new google.maps.Marker({
            //     position: {lat: 24.71, lng: 46.67},
            //     map: map,
            // });
            var map = new google.maps.Map(document.getElementById('map'), {
                center: {
                    lat: 21.59393104984951,
                    lng: 39.21531566742226
                },
                zoom: 17,
            });
            var marker = new google.maps.Marker({
                position: {
                    lat: 21.59393104984951,
                    lng: 39.21531566742226
                },
                map: map,
                // label: 'موقع العقار' ,
                icon: customIcon
            });
        });
    </script>"""

assert run.marker_pin(SCRIPT) == {"latitude": 21.59393104984951, "longitude": 39.21531566742226}, run.marker_pin(SCRIPT)

# only a commented-out marker → no pin
only_commented = "\n".join(ln for ln in SCRIPT.splitlines() if "21.5939" not in ln)
assert run.marker_pin(only_commented) == {}, run.marker_pin(only_commented)

# a map centre alone is not a pin
assert run.marker_pin("var map = new google.maps.Map(el, { center: { lat: 21.59, lng: 39.21 } });") == {}

# outside Saudi Arabia → rejected by the one gate
assert run.marker_pin(SCRIPT.replace("21.59393104984951", "-33.8")) == {}

# it reaches additional_info through parse_detail → map_listing (the index reads latitude/longitude there)
d = run.parse_detail(SCRIPT)
assert d["pin"] == {"latitude": 21.59393104984951, "longitude": 39.21531566742226}, d["pin"]

print("sodasyat pin: OK")
