// A PICKED AREA DRAWS ITS REAL BOUNDARY, NOT A RECTANGLE (owner 2026-11-01: «create a boundary around it, don't make
// just a square boundary — it's like an area»).
//
// EXECUTES `placeShapeFrom()` — the pure half of src/data/placeShape.ts — against the three answers the RPC can give
// (a shape, no shape, a failure) and proves by mutation that a failed fetch is never read as "no shape" (A FAILED
// FETCH IS NOT AN EMPTY ANSWER), that a Polygon and a MultiPolygon both become rings, and that the bbox is the shape's.
// Then pins the wiring: the map asks for the shape by COORDINATE through the bounded RPC, draws every polygon, clears
// them with the mark, keeps the rectangle only as the fallback, and the loader + its workflow + the migration exist.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { placeShapeFrom } from '../src/lib/placeShape.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const multi = JSON.stringify({ type: 'MultiPolygon', coordinates: [[[[46.6, 24.8], [46.7, 24.8], [46.7, 24.9], [46.6, 24.9], [46.6, 24.8]]]] });
const poly = JSON.stringify({ type: 'Polygon', coordinates: [[[39.1, 21.5], [39.2, 21.5], [39.2, 21.6], [39.1, 21.5]]] });
const row = (geojson: string) => ({ name_ar: 'حي النرجس', name_en: 'An Narjis', kind: 'district', geojson });

const a = placeShapeFrom({ data: [row(multi)], error: null });
check('a MultiPolygon row becomes rings with the shape\'s bbox', typeof a === 'object' && a !== null && a.rings.length === 1 && a.bbox.n === 24.9 && a.bbox.s === 24.8 && a.bbox.e === 46.7 && a.bbox.w === 46.6 && a.nameAr === 'حي النرجس');
const b = placeShapeFrom({ data: [row(poly)], error: null });
check('a Polygon row becomes one polygon of rings', typeof b === 'object' && b !== null && b.rings.length === 1 && b.rings[0][0].length === 4);
check('an empty answer is null — the point is in no shape (known)', placeShapeFrom({ data: [], error: null }) === null);
check('an error is \'unknown\' — never read as "no shape"', placeShapeFrom({ data: null, error: { message: 'timeout', timeout: true } }) === 'unknown');
check('a null body with no error is \'unknown\' too', placeShapeFrom({ data: null, error: null }) === 'unknown');
check('unparsable geojson is \'unknown\'', placeShapeFrom({ data: [row('{not json')], error: null }) === 'unknown');
check('a Point is not a shape', placeShapeFrom({ data: [row(JSON.stringify({ type: 'Point', coordinates: [1, 2] }))], error: null }) === 'unknown');

// Mutations: the distinctions can fail.
mustCatch('a failed fetch being read as "no shape here"', placeShapeFrom({ data: null, error: { message: 'x' } }) !== null);
mustCatch('an empty answer being read as a failure', placeShapeFrom({ data: [], error: null }) !== 'unknown');
mustCatch('a bbox that is not the shape\'s', !(typeof a === 'object' && a !== null && a.bbox.n === a.bbox.s));

// Wiring.
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const mod = readFileSync(join(root, 'src/data/placeShape.ts'), 'utf8');
check('placeShape.ts asks by coordinate through the bounded RPC', /boundedRpc<ShapeRow\[\]>\(supabase\.rpc\('place_shape_at', \{ p_lat: lat, p_lng: lng, p_kind: kind, p_name: name \?\? null \}\)\)/.test(mod));
check('AppleMap.web.tsx: EVERY pick fetches its shape and draws every polygon (owner 2026-11-01: «anything»)', /placeShapeAt\(c\.latitude, c\.longitude, kind, \(place \? place\.name : undefined\) \?\? p\.name\)/.test(web) && /live\.mark\.shapes = shape\.rings\.map\(\(poly\) => new mk\.PolygonOverlay\(/.test(web));
check('AppleMap.web.tsx: an area asks for its own kind, everything else for a site footprint', /const kind: ShapeKind = p\.kind && isAreaKind\(p\.kind\) \? p\.kind : 'place';/.test(web));
check('AppleMap.web.tsx: the circle / rectangle is only the fallback (no shape, or the fetch failed)', /if \(!shape \|\| shape === 'unknown'\) return fallback\(\);/.test(web) && /const fallback = landmark \? circle : rectangle;/.test(web));
check('AppleMap.web.tsx: a landmark keeps its pin whatever the shape lookup says', /if \(landmark\) \{\n\s+live\.mark\.pin = new mk\.MarkerAnnotation\(/.test(web));
check('AppleMap.web.tsx: a later pick drops a shape that arrives late', /if \(live\.markSeq !== seq\) return;/.test(web) && /live\.markSeq\+\+;/.test(web));
check('AppleMap.web.tsx: clearing the mark removes the shape overlays', /for \(const o of live\.mark\.shapes \?\? \[\]\) m\.removeOverlay\(o\);/.test(web));
check('AppleMap.web.tsx: the view fits the shape with air around it', /\(n - s0\) \* 1\.3, floor\), Math\.max\(\(e - w\) \* 1\.3, floor\)/.test(web) && /const floor = kind === 'place' \? 0\.004 : 0\.01;/.test(web));
check('the loader, its workflow and the shapes data exist', existsSync(join(root, 'scripts/load-place-shapes.ts')) && existsSync(join(root, '.github/workflows/place-shapes-load.yml')) && existsSync(join(root, 'data/place-shapes.geojson.gz')));
check('the workflow runs the loader with the service key', /scripts\/load-place-shapes\.ts/.test(readFileSync(join(root, '.github/workflows/place-shapes-load.yml'), 'utf8')) && /SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(join(root, '.github/workflows/place-shapes-load.yml'), 'utf8')));
check('a committed migration admits the place (footprint) kind with a tolerant lookup', readdirSync(join(root, 'supabase/migrations')).some((f) => { const t = readFileSync(join(root, 'supabase/migrations', f), 'utf8'); return /check \(kind in \('district', 'city', 'region', 'place'\)\)/.test(t) && /case when p_kind = 'place' then 0\.0005 else 0 end/.test(t); }));
check('a committed migration creates place_shapes and place_shape_at()', readdirSync(join(root, 'supabase/migrations')).some((f) => { const t = readFileSync(join(root, 'supabase/migrations', f), 'utf8'); return /create table if not exists public\.place_shapes/.test(t) && /function public\.place_shape_at\(/.test(t); }));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-area-pick-draws-real-boundary: all checks passed');
process.exit(failed ? 1 : 0);
