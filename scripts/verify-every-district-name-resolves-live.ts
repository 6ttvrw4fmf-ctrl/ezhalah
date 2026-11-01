// EVERY REAL DISTRICT NAME, TYPED, MUST SEARCH THAT DISTRICT — the nightly fake customer for places
// (owner 2026-10-05: «never get this issue — or anything like it»).
//
// Typing «حي الملك» told a user «ما لقينا نتائج». Typing every real district name into the real
// resolver the same night found 710 of 3,297 districts lost (23,098 listings): «حي العقيق» (Riyadh,
// 1,545) searched the TOWN العقيق, «حي العريجاء الغربية» found nothing, «الصفاء» (Jeddah) searched
// Tabuk, 4 names crashed the resolver. Fixed the same day (src/data/locations.ts «THE NAME AS TYPED
// WINS» / «THE INVENTORY OUTRANKS THE CATALOG'S FIRST GUESS») down to a long tail of 31.
//
// This runs it EVERY NIGHT on the live index, so a new district, a catalog change or a resolver edit
// that loses a place turns red the next morning instead of waiting for a user to hit it. Zero search
// load: ONE read of location_index_live (anon key), then the real resolver runs in this process.
//
// CEILINGS are a ratchet — lower them as the tail is fixed, never raise them to go green.
//   node --experimental-strip-types scripts/verify-every-district-name-resolves-live.ts
//   (.github/workflows/district-name-sweep.yml — NOT npm test: it reads production)
import { join } from 'node:path';
import { bundleResolver, type IndexRow } from './lib/bundleResolver.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { postgrestFetch } from './lib/postgrestRetry.ts';

const MAX_LOST_ROWS = 40;        // measured 31 on 2026-10-05 after the fix
const MAX_LOST_LISTINGS = 600;   // measured 469
const MIN_LISTINGS = 5;          // a district with fewer listings is noise, not a place users type

const { url, key } = resolvePublicSupabase();

const rows: IndexRow[] = [];
for (let from = 0; ; from += 1000) {
  const r = await postgrestFetch(`${url}/rest/v1/location_index_live?select=city,district,region,n`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } });
  const page = await r.json();
  if (!Array.isArray(page)) { console.error('location_index_live read failed:', page); process.exit(1); }
  rows.push(...page);
  if (page.length < 1000) break;
}
if (rows.length < 5000) { console.error(`location_index_live returned only ${rows.length} rows — refusing to call that a pass`); process.exit(1); }

const resolver = await bundleResolver(join(import.meta.dirname, '..'), rows);
const lost: { d: string; city: string; n: number; got: string }[] = [];
const crashes: string[] = [];
let townSwaps = 0, checked = 0;
for (const r of rows) {
  if (!r.district || r.n < MIN_LISTINGS || !/[؀-ۿ]/.test(r.district)) continue;
  const core = r.district.replace(/^حي\s+/, '').trim();
  if (core.length < 3 || /\d/.test(core)) continue;
  checked++;
  let res;
  try { res = resolver.resolveLocation(`حي ${core}`, 'ar'); } catch (e) { crashes.push(`${r.district} (${r.city}): ${(e as Error).message}`); continue; }
  // The search must include THIS district — or, for a district named like its own town, that town.
  const found = res.kind === 'city' ? res.city.toLowerCase() === r.city.toLowerCase() : res.districts.includes(r.district);
  if (found) continue;
  if (res.kind === 'city') townSwaps++;
  lost.push({ d: r.district, city: r.city, n: r.n, got: `${res.kind} «${res.label}» ${res.city} (${res.districts.length} districts)` });
}
lost.sort((a, b) => b.n - a.n);
const lostListings = lost.reduce((s, l) => s + l.n, 0);
console.log(`typed ${checked} real district names · lost ${lost.length} (${lostListings} listings) · sent to a town ${townSwaps} · crashes ${crashes.length}`);
for (const l of lost.slice(0, 30)) console.log(`  ${l.n}\t«${l.d}» (${l.city}) → ${l.got}`);
for (const c of crashes) console.log(`  CRASH ${c}`);

type Stats = { checked: number; crashes: number; townSwaps: number; lostRows: number; lostListings: number };
const gates = (st: Stats): [string, boolean][] => [
  [`checked a real cohort (${st.checked} ≥ 2,000 names)`, st.checked >= 2000],
  ['the resolver never crashes on a real district name', st.crashes === 0],
  ['a district is never searched as a different town', st.townSwaps === 0],
  [`lost names ≤ ${MAX_LOST_ROWS} (ratchet)`, st.lostRows <= MAX_LOST_ROWS],
  [`lost listings ≤ ${MAX_LOST_LISTINGS} (ratchet)`, st.lostListings <= MAX_LOST_LISTINGS],
];
let failed = 0;
for (const [label, ok] of gates({ checked, crashes: crashes.length, townSwaps, lostRows: lost.length, lostListings })) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}
// The gates must turn red on the world this sweep found before the 2026-10-05 fix.
const mustCatch = (what: string, st: Stats) => {
  const caught = gates(st).some(([, ok]) => !ok);
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
const healthy: Stats = { checked: 3164, crashes: 0, townSwaps: 0, lostRows: 31, lostListings: 469 };
mustCatch('the 2026-10-05 resolver (710 lost, 191 sent to a town, 4 crashes)', { checked: 3297, crashes: 4, townSwaps: 191, lostRows: 710, lostListings: 23098 });
mustCatch('a single crash', { ...healthy, crashes: 1 });
mustCatch('a single district sent to a town', { ...healthy, townSwaps: 1 });
mustCatch('an index read that came back nearly empty', { ...healthy, checked: 12 });
console.log(failed === 0 ? '\n✅ every real district name searches its district.\n' : `\n❌ ${failed} gate(s) failed — typed district names are being lost (list above). Fix the resolver; never raise a ceiling.\n`);
process.exit(failed === 0 ? 0 : 1);
