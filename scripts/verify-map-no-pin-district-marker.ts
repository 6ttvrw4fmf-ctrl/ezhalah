// A LISTING WITH NO EXACT LOCATION SHOWS AS ITS DISTRICT'S MARKER, NEVER AS A HOUSE'S SPOT (owner 2026-11-09: «include
// the ones with no pins … «موقع غير محدد» / «No exact location» … when the user clicks he sees them»; «make sure it's
// live for all the ones with no pins»). docs/ARCHITECTURE.md, Map tab.
//
// EXECUTES src/lib/mapNoPin.ts under plain Node — when the marker shows, the RPC arguments, the failed-fetch answer,
// the pin row the sheet gets, the tag in both languages — each with a mutation that must be caught. Then the wiring:
// the data module asks map_nopin_markers_ar through the bounded RPC; the map reads the markers beside the pins, keeps
// them on a failed read and opens the sheet on a tap; the sheet titles a marker by district with the note; the i18n
// table carries the words; and the committed migrations hold the server rules in place (only no-pin listings, never a
// borrowed one, the district centre from the pinned listings, the city centre as the fallback, the hourly job).
//
//   node --experimental-strip-types scripts/verify-map-no-pin-district-marker.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { showNoPin, noPinArgs, noPinFrom, noPinPinRow, noPinTag, noPinHead, noPinKey, isNoPinKey, NO_PIN_COLOR, NO_PIN_IDS_MAX } from '../src/lib/mapNoPin.ts';

const root = join(import.meta.dirname ?? '.', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

// ── the pure rules, executed ─────────────────────────────────────────────────────────────────────────────────────────
const all: ('buy' | 'rent' | 'short')[] = ['buy', 'rent', 'short'];
check('the marker shows from district zoom inward (cell 0) and never among zoomed-out dots or labels', showNoPin(0, { poly: null }) && !showNoPin(0.01, { poly: null }) && !showNoPin(0.6, { poly: null }));
check('…and never while a drawn boundary is applied (a listing with no spot cannot be inside a shape)', !showNoPin(0, { poly: { type: 'Polygon', coordinates: [[[46, 24], [47, 24], [47, 25], [46, 24]]] } }));
mustCatch('the marker drawn inside a drawn boundary', showNoPin(0, { poly: null }) !== showNoPin(0, { poly: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }));

const box = { s: 24.8, w: 46.58, n: 24.93, e: 46.75 };
const args = noPinArgs(box, { deals: ['buy'], beds: [3, 4], priceMax: 2_000_000 });
check('the RPC takes the pins\' own narrowing: deals, bedrooms, price… (unset = null, all three deals = null)', args.p_deals?.length === 1 && args.p_beds?.length === 2 && args.p_price_max === 2_000_000 && args.p_types === null && args.p_area_min === null && noPinArgs(box, { deals: all }).p_deals === null);
check('…no cell and no polygon are ever sent (the server has no counterpart for them)', !('p_cell' in args) && !('p_poly' in args));
check('…with the view box and a bounded limit', args.p_s === 24.8 && args.p_e === 46.75 && args.p_limit === 200);

const row = { city: 'الرياض', district: 'حي النرجس', lat: 24.8644, lng: 46.6574, n: 88, deal: 'buy' as const, ids: [{ t: 'wasalt_residential_listings', i: 5 }, { t: 'aqar_residential_listings', i: 9 }] };
check('a failed fetch is UNKNOWN, never an empty list (a vanished marker would read as «no such listings here»)', noPinFrom({ data: null, error: { message: 'timeout' } }) === 'unknown' && noPinFrom({ data: null, error: null }) === 'unknown');
check('an answered fetch is its rows; a malformed or empty row is dropped, never thrown on', (() => { const r = noPinFrom({ data: [row, { ...row, n: 0 }, { lat: 'x' }], error: null }); return r !== 'unknown' && r.length === 1 && r[0].n === 88; })());
mustCatch('a failed fetch rendered as zero markers', noPinFrom({ data: null, error: {} }) !== 'unknown' ? false : true);
const pin = noPinPinRow(row);
check('the sheet gets the count, the ids and the district — no price, no platform (it is many listings)', pin.n === 88 && pin.ids?.length === 2 && pin.noPin?.district === 'حي النرجس' && pin.noPin.city === 'الرياض' && pin.price === null && pin.platform === null && pin.lat === row.lat);
check('the tag is short and in the UI language: «موقع غير محدد» / «No exact location»', noPinTag('ar') === 'موقع غير محدد' && noPinTag('en') === 'No exact location');
check('the pill shows plain grouped digits (1204 → 1,204), the same digits the blue pins use', noPinHead(1204) === '1,204' && noPinHead(88) === '88');
check('the annotation key names the district and the count (a pan keeps it, a new count replaces it) and is recognisable', noPinKey(row) === 'NP|الرياض|حي النرجس|88' && isNoPinKey(noPinKey(row)) && !isNoPinKey('0|24.8|46.6|1|buy|'));
check('the marker is the app\'s dark purple, not a deal colour; ids are capped high enough for the biggest district (~220)', NO_PIN_COLOR === '#4B3F6B' && NO_PIN_IDS_MAX >= 300);

// ── wiring ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const data = read('src/data/mapNoPin.ts');
check('the data module asks map_nopin_markers_ar through the bounded RPC (never an unbounded await)', /boundedRpc<NoPinRow\[\]>\(supabase\.rpc\('map_nopin_markers_ar', args\)\)/.test(data) && /return 'unknown'/.test(data));
const map = read('src/components/AppleMap.web.tsx');
check('the map reads the markers beside the pins, only when showNoPin() says so', /showNoPin\(cell, pins\) \? fetchMapNoPin\(paddedBox\(center, span\), pins\)/.test(map));
check('the markers join the pins\' own diff under their own key, built by noPinPinRow()', /next\.set\(noPinKey\(r\), noPinPinRow\(r\)\)/.test(map));
check('a FAILED marker read keeps the markers already on the map', /else for \(const \[k, a\] of keyed\) if \(isNoPinKey\(k\)\) next\.set\(k, /.test(map));
check('a marker draws noPinElement(): the purple pill with the crossed-out pin, the count and the tag', /row\.noPin\s*\? new mk\.Annotation\([^\n]*\(\) => noPinElement\(row\), \{ data: \{ pin: row, cell: 0 \}/.test(map) && /data-testid', 'map-no-pin'/.test(map) && /noPinHead\(row\.n\)/.test(map) && /noPinTag\(loc\)/.test(map) && /M4 4l16 16/.test(map));
check('a tap on a marker opens the card sheet (pick with cell 0), like a pin', /pick\(row, 0\); \}\n\s+\}\);\n\s+return el;\n\s+\};\n\s+const clear/.test(map));
const sheet = read('src/components/MapPinSheet.tsx');
check('the sheet titles a marker by its district (or city) and never by a head price', /const place = row\.noPin \? \(row\.noPin\.district \|\| row\.noPin\.city\) : '';/.test(sheet) && /row\.noPin\s*\? t\('\{n\} listings in \{district\}', \{ n: row\.n, district: /.test(sheet));
check('…in English the place name is in English letters (translitPlace), in Arabic it stays as the source wrote it', /district: isRTL \? place : translitPlace\(place\) \}\)/.test(sheet) && /import \{ translitPlace \} from '@\/lib\/translitPlace';/.test(sheet));
check('…and says, before the first card, that the source gave no exact location', /map-pin-sheet-no-pin-note/.test(sheet) && /The source site gives no exact location for these listings/.test(sheet));
const i18n = read('src/i18n.tsx');
for (const k of ['{n} listings in {district}', 'No exact location', 'The source site gives no exact location for these listings; they are shown at the centre of the district.', 'Showing the first {k} of {n}']) check(`i18n carries «${k.slice(0, 40)}…» in Arabic`, new RegExp(`'${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': '[^']*[؀-ۿ][^']*'`).test(i18n));

// ── the server rules, in the committed migrations ─────────────────────────────────────────────────────────────────────
const dir = join(root, 'supabase/migrations');
const migs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse();
const latest = (re: RegExp) => { const f = migs.find((x) => re.test(readFileSync(join(dir, x), 'utf8'))); return f ? readFileSync(join(dir, f), 'utf8') : ''; };
const refresh = latest(/create or replace function public\.map_nopin_refresh_ar\(/);
const RULES: Array<[string, RegExp]> = [
  ['only listings with no pin of their own are placed', /where \(s\.latitude is null or s\.longitude is null\)/],
  ['a listing that borrowed its sure twin\'s pin is never placed twice', /not exists \(select 1 from public\.map_pin_borrow b where b\.source_table = s\.source_table and b\.listing_id = s\.listing_id\)/],
  ['the district centre is its PINNED listings\' centre (map_area_ar, level district)', /from public\.map_area_ar a\s+where a\.level = 'district'/],
  ['no district centre → the city centre (loc_city_center), never nowhere', /left join public\.loc_city_center cc on cc\.city_id = s\.city_id/],
  ['a listing with no city at all stays search-only (no made-up spot)', /coalesce\(c\.lat, cc\.lat::double precision\) is not null/],
];
check('a committed migration defines map_nopin_refresh_ar()', refresh.length > 0);
for (const [l, re] of RULES) check(l, re.test(refresh));
// Every placing read (pin-less listings, and since the final pin rule the stray pins) needs a real centre — counted, so
// a second read cannot place a listing nowhere.
const n = (sql: string, re: RegExp) => (sql.match(re) ?? []).length;
const everyReadHasACentre = (sql: string) => n(sql, /from public\.search_listings_ar s\b/g) > 0
  && n(sql, /coalesce\(c\.lat, cc\.lat::double precision\) is not null/g) === n(sql, /from public\.search_listings_ar s\b/g);
check('every read that places a listing requires a centre', everyReadHasACentre(refresh));
const problems = (sql: string) => [...RULES.filter(([, re]) => !re.test(sql)).map(([l]) => l), ...(everyReadHasACentre(sql) ? [] : ['a read with no centre check'])];
for (const [label, from, to] of [
  ['pinned listings placed under a district marker too', 'where (s.latitude is null or s.longitude is null)', 'where true'],
  ['a borrowed listing drawn twice', "and not exists (select 1 from public.map_pin_borrow b where b.source_table = s.source_table and b.listing_id = s.listing_id)\n", ''],
  ['a listing with no centre at all given a spot', 'and coalesce(c.lat, cc.lat::double precision) is not null\n', ''],
] as const) { const m = refresh.replace(from, to); mustCatch(label, m !== refresh && problems(m).length > 0); }
const markers = latest(/create or replace function public\.map_nopin_markers_ar\(/);
check('map_nopin_markers_ar() groups one row per district with the true count and the newest ids, under the pins\' filter', /group by m\.city, m\.district, m\.lat, m\.lng/.test(markers) && /order by m\.listing_id desc\)\)\[1:500\]/.test(markers) && /p_beds is null or m\.beds = any \(p_beds\)/.test(markers) && /grant execute on function public\.map_nopin_markers_ar/.test(markers));
const cron = latest(/cron\.alter_job\([\s\S]*map_nopin_refresh_ar\(\)/);
check('the hourly map job rebuilds the markers right after the grid (which refreshes the centres)', /select public\.map_grid_refresh_ar\(\); select public\.map_nopin_refresh_ar\(\);/.test(cron));

if (failed) { console.error(`\n❌ verify-map-no-pin-district-marker: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-no-pin-district-marker: a listing with no exact location shows as its district\'s marker, never as a house\'s spot');
