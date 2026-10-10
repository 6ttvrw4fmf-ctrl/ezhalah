// Build the deep-search picker's Saudi regions map from the geoBoundaries ADM1 file (OpenStreetMap-derived,
// ODbL — the map carries «© OpenStreetMap contributors»). Output: src/data/saRegionPaths.json — one SVG
// path per catalogue region (ids 1..13 of src/data/sa-locations.json), simplified to a few KB.
//   node --experimental-strip-types scripts/generate-sa-region-paths.ts <geoBoundaries-SAU-ADM1_simplified.geojson>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input] = process.argv;
if (!input) throw new Error('usage: generate-sa-region-paths.ts <geojson>');
const geo = JSON.parse(readFileSync(input, 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../src/data/sa-locations.json', import.meta.url), 'utf8'));

// geoBoundaries shapeName → catalogue region id.
const NAMES: Record<string, number> = {
  'Riyadh Region': 1, 'Makkah Region': 2, 'Al Madinah Region': 3, 'Al-Qassim Region': 4, 'Eastern Region': 5,
  "'Asir Region": 6, 'Tabuk Region': 7, 'Hayel Region': 8, 'Northern Borders Region': 9, 'Jazan Region': 10,
  'Najran Region': 11, 'Al Bahah Region': 12, 'Al Jawf Region': 13,
};

type Pt = [number, number];
// Hand nudges: Eastern Province's centroid is deep in the Empty Quarter (label nearer the populated
// north); الحدود الشمالية and الجوف centroids sit on one line and would collide.
const LABEL_NUDGE: Record<number, [number, number]> = { 5: [300, 170], 9: [160, 50], 13: [92, 45] };
// Douglas–Peucker, tolerance in projected units.
function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const d = Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...simplify(points.slice(0, idx + 1), tol).slice(0, -1), ...simplify(points.slice(idx), tol)];
}

// Equirectangular projection scaled by cos(mean latitude); fitted to a 400-wide viewBox.
const LON = [34.4, 55.8], LAT = [16.2, 32.3];
const k = Math.cos(((LAT[0] + LAT[1]) / 2) * Math.PI / 180);
const W = 400;
const scale = W / ((LON[1] - LON[0]) * k);
const H = Math.round((LAT[1] - LAT[0]) * scale);
const project = ([lon, lat]: Pt): Pt => [+(((lon - LON[0]) * k) * scale).toFixed(1), +((LAT[1] - lat) * scale).toFixed(1)];

const regions: Record<number, { id: number; name: string; en: string; d: string; cx: number; cy: number }> = {};
for (const f of geo.features) {
  const id = NAMES[f.properties.shapeName];
  if (!id) throw new Error(`unmapped region: ${f.properties.shapeName}`);
  const polys: Pt[][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p: Pt[][]) => p[0]);
  const parts: string[] = [];
  // Label anchor = the area centroid of the largest ring (a vertex average drifts toward wiggly coasts),
  // nudged by hand where the centroid sits in empty desert or collides with a neighbour's name.
  let best: { area: number; cx: number; cy: number } = { area: 0, cx: 0, cy: 0 };
  for (const ring of polys) {
    // Small islands (Red Sea / Gulf) are dropped: they add bytes, not meaning, at picker size.
    const projected = ring.map(project);
    const area = Math.abs(projected.reduce((s, [x, y], i) => { const [nx, ny] = projected[(i + 1) % projected.length]; return s + x * ny - nx * y; }, 0)) / 2;
    if (area < 6) continue;
    // A closed ring starts and ends on the same point, which collapses Douglas–Peucker to a 2-point
    // line; open it, split at the point farthest from the start, and simplify the two halves.
    const open = projected[0][0] === projected[projected.length - 1][0] && projected[0][1] === projected[projected.length - 1][1] ? projected.slice(0, -1) : projected;
    let far = 0, farD = -1;
    for (let i = 1; i < open.length; i++) { const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]); if (d > farD) { farD = d; far = i; } }
    const pts = [...simplify(open.slice(0, far + 1), 0.9).slice(0, -1), ...simplify([...open.slice(far), open[0]], 0.9).slice(0, -1)];
    parts.push('M' + pts.map(([x, y]) => `${x} ${y}`).join('L') + 'Z');
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < projected.length; i++) {
      const [x0, y0] = projected[i], [x1, y1] = projected[(i + 1) % projected.length];
      const cross = x0 * y1 - x1 * y0;
      a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
    }
    if (Math.abs(a / 2) > best.area) best = { area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) };
  }
  const nudge = LABEL_NUDGE[id];
  const row = catalog.regions.find((r: [number, string, string]) => r[0] === id);
  regions[id] = { id, name: row[2], en: row[1], d: parts.join(''), cx: nudge?.[0] ?? +best.cx.toFixed(0), cy: nudge?.[1] ?? +best.cy.toFixed(0) };
}
const out = { viewBox: `0 0 ${W} ${H}`, attribution: '© OpenStreetMap contributors', regions: Object.values(regions).sort((a, b) => a.id - b.id) };
writeFileSync(new URL('../src/data/saRegionPaths.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${out.regions.length} regions, ${JSON.stringify(out).length} bytes, viewBox ${out.viewBox}`);
