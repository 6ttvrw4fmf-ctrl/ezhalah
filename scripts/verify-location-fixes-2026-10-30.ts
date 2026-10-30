// Location root fixes of 2026-10-30 — the 3-layer checker reads source truth, and homes under a retired place move.
//
//   1. Homes filed under a retired place (owner 2026-10-26 «one name, one list», backlog #894) move to their real town
//      through listing_city_correction, recomputed hourly inside refresh_listing_city_correction(). A move that changes
//      the region is allowed only between two rows of the SAME town (a G4 duplicate).
//   2. district_contradicts_source does not count SPELLING (our display of the source's word = what we show) or AQAR'S
//      OWN ADDRESS (the listing URL names the district we show); the cheap text filter runs first (MATERIALIZED), or the
//      detector times out.
//   3. source_district_dropped does not count a district the display hides on purpose (a town as its own district).
// Each rule is read from the NEWEST migration that defines the object, and each mustCatch replays a regression.
//   node --experimental-strip-types scripts/verify-location-fixes-2026-10-30.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Mig = { f: string; s: string };
const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const migs: Mig[] = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }));

const fnBody = (ms: Mig[], name: string): { f: string; b: string } | null => {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\s*\([^)]*\)[\s\S]*?as\s+(\$[a-z]*\$)([\s\S]*?)\1`, 'i');
  let out: { f: string; b: string } | null = null;
  for (const m of ms) { const x = re.exec(m.s); if (x) out = { f: m.f, b: x[2] }; }
  return out;
};
const viewBody = (ms: Mig[], name: string): { f: string; b: string } | null => {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+view\s+public\.${name}\s+as([\s\S]*?);\s*(?:\n\s*\n|$)`, 'i');
  let out: { f: string; b: string } | null = null;
  for (const m of ms) { const x = re.exec(m.s); if (x) out = { f: m.f, b: x[1] }; }
  return out;
};

export function problems(ms: Mig[]): string[] {
  const p: string[] = [];
  const refresh = fnBody(ms, 'refresh_listing_city_correction');
  if (!refresh || !/public\.refresh_retired_place_remap\(\)/.test(refresh.b)) p.push(`${refresh?.f ?? '?'}: refresh_listing_city_correction() no longer runs refresh_retired_place_remap() — new homes under a retired place stay misfiled`);
  const rows = fnBody(ms, 'retired_place_remap_rows');
  if (!rows) p.push('retired_place_remap_rows() is never defined');
  else {
    if (!/n\.region_id\s*=\s*tc2\.src_region\s+or\s+tc2\.dup/.test(rows.b)) p.push(`${rows.f}: a city move may cross a region without being the same town`);
    if (!/n\.retired_at\s+is\s+null\s+and\s+n\.region_id\s*=\s*o\.region_id/.test(rows.b)) p.push(`${rows.f}: a district→town move may go to a retired town or cross a region`);
    if (!/case\s+when\s+t\.retired_at\s+is\s+null\s+then\s+tc\.t1\s+end/.test(rows.b)) p.push(`${rows.f}: a move may land on a retired city`);
  }
  const v = viewBody(ms, 'mon_district_contradicts_source');
  if (!v) p.push('mon_district_contradicts_source is never defined');
  else {
    if (!/AS\s+MATERIALIZED/i.test(v.b)) p.push(`${v.f}: the cheap text filter is no longer fenced (MATERIALIZED) — the detector times out on ~417k rows`);
    if (!/NOT\s+COALESCE\(loc_display_district_ar\(t\.city_id,\s*t\.source_says\)\s*=\s*t\.we_display,\s*false\)/i.test(v.b)) p.push(`${v.f}: spelling variants count as contradictions again`);
    if (!/aqar_address_district\(a\.listing_url\)/.test(v.b)) p.push(`${v.f}: Aqar's own address no longer excuses the district it names`);
  }
  const dropped = fnBody(ms, 'source_district_dropped_rows');
  if (!dropped || !/public\.loc_display_district_ar\(city_id,\s*w\)\s+is\s+not\s+null/.test(dropped.b)) p.push(`${dropped?.f ?? '?'}: source_district_dropped counts a town written as its own district again`);
  return p;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const real = problems(migs);
check('retired-place homes move region-safely; the district alarms read spelling, Aqar address and own-name towns as correct', real.length === 0, real.join('; '));

const later = (s: string) => [...migs, { f: '29990101000000_x.sql', s }];
const lastWith = (needle: string) => migs.filter((m) => m.s.includes(needle)).at(-1)!;
const swap = (needle: string, from: string, to: string) => {
  const m = lastWith(needle); const s = m.s.replace(from, to);
  if (s === m.s) throw new Error(`mutation was a no-op: ${from}`);
  return migs.map((x) => (x.f === m.f ? { f: x.f, s } : x));
};
mustCatch('the hourly refresh dropping the remap', problems(swap('n := n + public.refresh_retired_place_remap()', '  n := n + public.refresh_retired_place_remap();\n', '')).length > 0);
mustCatch('a city move allowed across regions', problems(swap('create or replace function public.retired_place_remap_rows', 'n.region_id = tc2.src_region or tc2.dup', 'true')).length > 0);
mustCatch('a move landing on a retired city', problems(swap('create or replace function public.retired_place_remap_rows', 'case when t.retired_at is null then tc.t1 end', 'tc.t1')).length > 0);
mustCatch('the contradiction view losing its MATERIALIZED fence', problems(swap('text_disagrees AS MATERIALIZED', 'text_disagrees AS MATERIALIZED', 'text_disagrees AS')).length > 0);
mustCatch('a later view that drops the spelling excusal', problems(later("create or replace view public.mon_district_contradicts_source as\n select 1 from search_listings_ar s;\n\n")).length > 0);
mustCatch('the dropped count reading hidden own-name towns again', problems(swap('CREATE OR REPLACE FUNCTION public.source_district_dropped_rows', 'and public.loc_display_district_ar(city_id, w) is not null\n', '')).length > 0);

if (failed) { console.error(`\n❌ verify-location-fixes-2026-10-30: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-location-fixes-2026-10-30: retired-place homes move to their real town; the 3-layer checker reads source truth.');
