// THE MAP FILTER ASKS LIKE THE FILTER (owner 2026-11-10: «this filter is like the one we have but it shows the result
// in the map»). Measured that day on ezhalah.com: «تجاري» → «الأراضي» → «أرض خام» on the map read «عرض 0 إعلان» over
// 300,339 for-sale listings, while the Filter home finds raw land. The map sent a stored-type list and a table-name
// category test; the Filter sends table sets, two type lists, the raw-land tag and a category gate.
//
// This EXECUTES the real code (bundled, supabase/i18n stubbed): the map card's request for a choice must carry the
// Filter's own scope for the same choice, and the two server functions must apply the Filter's rule.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleMapScope } from './lib/bundleMapScope.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };

const m = await bundleMapScope(ROOT);
const base = { beds: ['2'], furnished: null, areaMin: '', areaMax: '', priceMin: '', priceMax: '' };
const ask = (f: Record<string, unknown>, withScope = true) => {
  const pf = m.pinFilterOf({ ...base, ...f }, m.typeArForTypes, m.groupMembers, ['sale'], withScope ? m.mapTypeScope : undefined);
  return { pf: pf as Record<string, any>, args: m.rpcArgs({ s: 16, w: 34, n: 33, e: 56 }, 0.5, { deals: ['sale'], ...pf }) as Record<string, any> };
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// The barrier's predicate: the map's request carries exactly the Filter's scope for the same choice.
const asksLikeFilter = (args: Record<string, any>, F: Record<string, any>) =>
  same(args.p_types, F.types) && same(args.p_tables, F.tables) && same(args.p_tables2, F.tables2) && same(args.p_types2, F.types2) && args.p_macro === F.macro;
// mustCatch: the predicate, applied to a deliberately broken request, must say NO.
const mustCatch = (what: string, brokenPasses: boolean) => check(`MUTATION caught: ${what}`, !brokenPasses);

// 1. The owner's photo: «تجاري» → «الأراضي» → «أرض خام».
const raw = ask({ category: 'Commercial', groups: ['Commercial & Industrial Plots'], types: ['Raw Land'] });
const rawF = m.mapTypeScope('Commercial', ['Raw Land']);
check('raw land under «تجاري»: the map sends the Filter\'s own types, tables and category gate', asksLikeFilter(raw.args, rawF));
check('raw land is asked for by its tag «أرض خام», over residential AND commercial tables', (raw.args.p_types ?? []).includes('أرض خام') && raw.args.p_tables.some((t: string) => /_residential_listings$/.test(t)) && raw.args.p_tables.some((t: string) => /_commercial_listings$/.test(t)));
check('with the Filter\'s scope sent, the old table-name category test is not', raw.args.p_category === null);

// 2. The whole land group under «تجاري» crosses into residential land: the Filter drops the category gate.
const land = ask({ category: 'Commercial', groups: ['Commercial & Industrial Plots'], types: [] });
const landF = m.mapTypeScope('Commercial', m.groupMembers('Commercial & Industrial Plots'));
check('a whole group is sent as its member types, exactly as the Filter expands it', same(land.args.p_types, landF.types) && same(land.args.p_tables, landF.tables) && land.args.p_macro === landF.macro);
check('land under «تجاري» includes residential land, with no category gate (the Filter\'s cross-category rule)', (land.args.p_types ?? []).includes('أرض سكنية') && land.args.p_macro === null);

// 3. A category alone, and one group, match the Filter's request for the same.
for (const cat of ['Residential', 'Commercial'] as const) {
  const a = ask({ category: cat, groups: [], types: [] });
  const f = m.mapTypeScope(cat, []);
  check(`«${cat}» alone: the map's request is the Filter's`, same([a.args.p_types, a.args.p_tables, a.args.p_tables2, a.args.p_types2, a.args.p_macro], [f.types, f.tables, f.tables2, f.types2, f.macro]) && a.args.p_macro === cat);
}
const villas = ask({ category: 'Residential', groups: ['Villas & Houses'], types: [] });
check('«فلل وبيوت»: villa labels over the Filter\'s tables, residential gate', (villas.args.p_types ?? []).includes('فيلا') && villas.args.p_macro === 'Residential' && villas.args.p_tables.length > 100);

// 4. Nothing picked narrows nothing — no scope, every pin.
const none = ask({ category: null, groups: [], types: [], beds: [] });
check('no category picked: no scope is sent and nothing is narrowed', !('p_tables' in none.args) && !('p_macro' in none.args) && none.args.p_types === null && none.args.p_category === null);

// 5. Bedrooms follow the Filter home: never under «تجاري», never with residential land.
check('bedrooms are offered for homes only', m.bedsOffered({ category: 'Residential', groups: ['Villas & Houses'] }) && m.bedsOffered({ category: null, groups: [] }) && !m.bedsOffered({ category: 'Commercial', groups: [] }) && !m.bedsOffered({ category: 'Residential', groups: ['Residential Plots'] }));
check('a bedrooms choice left over from before is not sent where bedrooms are not offered', raw.pf.beds === null && ask({ category: 'Residential', groups: ['Residential Plots'], types: [] }).pf.beds === null && same(villas.pf.beds, [2]));
const card = readFileSync(join(ROOT, 'src/components/MapFilterCard.tsx'), 'utf8');
check('the card hides the bedrooms row by the same rule and builds its request with mapTypeScope', /\{bedsOffered\(f\) \? \(\s*<>\s*<FieldLabel>\{t\('Bedrooms'\)\}<\/FieldLabel>/.test(card) && /pinFilterOfWith\(f, typeArForTypes, groupMembers, deals, mapTypeScope\)/.test(card));

// 6. MUTATION: without the Filter's scope the request is the defect — a stored-type list and a table-name category.
const old = ask({ category: 'Commercial', groups: ['Commercial & Industrial Plots'], types: ['Raw Land'] }, false);
mustCatch('the old request (no Filter scope, table-name category) is not the Filter\'s', asksLikeFilter(old.args, rawF));
mustCatch('a request with the category gate dropped is not the Filter\'s', asksLikeFilter({ ...raw.args, p_macro: null }, rawF));
mustCatch('a request with the raw-land tag replaced by stored land types is not the Filter\'s', asksLikeFilter({ ...raw.args, p_types: ['أرض'] }, rawF));

// 7. The server applies the Filter's rule: the newest migration defining each function carries it.
const dir = join(ROOT, 'supabase/migrations');
const newest = (needle: string) => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse().map((f) => readFileSync(join(dir, f), 'utf8')).find((sql) => sql.includes(needle)) ?? '';
const sql = newest('p_macro text DEFAULT NULL::text');
check('map_pins_ar and map_nopin_markers_ar take the Filter\'s scope (p_tables, p_tables2, p_types2, p_macro)', /p_tables text\[\] DEFAULT NULL::text\[\], p_tables2 text\[\] DEFAULT NULL::text\[\], p_types2 text\[\] DEFAULT NULL::text\[\], p_macro text DEFAULT NULL::text/.test(sql) && /map_pins_ar/.test(sql) && /map_nopin_markers_ar/.test(sql));
check('…with the raw-land tag and the known_type_ar category gate, as af_eligibility_clause has them', /s\.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any \(p_types\)/.test(sql) && /from public\.known_type_ar k where k\.macro = p_macro/.test(sql) && /k\.macro = 'both'/.test(sql));
check('…and the pins\' view and the district-marker table carry unit_subtype_ar', /s\.unit_subtype_ar/.test(sql) && /alter table public\.map_nopin_ar add column if not exists unit_subtype_ar/.test(sql));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nthe map filter asks exactly like the Filter');
