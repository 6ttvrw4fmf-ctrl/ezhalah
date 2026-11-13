# Builds public/ksa-outline.json — Saudi Arabia's outer border for the map's «outside the Kingdom is faded» layer
# (owner 2026-11-11: «just Saudi Arabia focus»). Merges the 13 region shapes of public/ksa-regions.json, grows the
# result ~4 km outwards, simplifies, and keeps land pieces bigger than 0.02 square degrees.
#   python3 scripts/build-ksa-outline.py public/ksa-regions.json > public/ksa-outline.json
# Needs shapely. scripts/verify-saudi-only-map.ts checks the output against the regions and 15 cities.
import json, sys
from shapely.geometry import Polygon
from shapely.ops import unary_union
GROW = float(sys.argv[2]) if len(sys.argv) > 2 else 0.04   # degrees outwards (~4 km): never fade a Saudi coast or border town
d = json.load(open(sys.argv[1]))
polys = [Polygon(r).buffer(0) for x in d for r in x['rings']]
u = unary_union([p.buffer(0.03) for p in polys]).buffer(-0.03 + GROW)
parts = sorted(getattr(u, 'geoms', [u]), key=lambda g: -g.area)
out = []
for g in parts:
    if g.area < 0.02: continue
    s = g.simplify(0.006, preserve_topology=True)
    out.append([[round(x, 3), round(y, 3)] for x, y in s.exterior.coords])
print(json.dumps(out, separators=(',', ':')))
