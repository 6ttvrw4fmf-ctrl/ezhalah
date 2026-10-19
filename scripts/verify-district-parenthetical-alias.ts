// «X ( Y )» names its district X with a second name Y in brackets, and must resolve to X — but only when Y
// cannot point at a different place.
//
// HOW THIS WAS EARNED (🆕 New Listings, 2026-10-11, backlog 343/378). arkaan writes «الملك فهد ( المحدود )»
// (re-read run 38121111371: arrival 17093301, the page names exactly that), abralosol «البستان (البراك)»,
// dealapp «حي بقعاء الشرقية(سهلة الفزير)». resolve_district_ar() only stripped brackets holding a plan
// NUMBER, so the whole string was looked up and 23 served ads had no district. The arm added by the
// parenthetical-alias migration strips non-numeric brackets and keeps the result only when the bracketed
// name resolves to no district or the SAME one («الصحافة (شرق المحدود)» names two catalog districts → NULL)
// and is not a town («حي الصقور ( الاحساء )» → NULL).
//
// This lifts the arm from the NEWEST committed resolve_district_ar (a later redefinition that drops it or
// either guard goes RED), runs its two regexes on real source strings, and plants mutants.
//
//   node --experimental-strip-types scripts/verify-district-parenthetical-alias.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase/migrations');
const definers = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create or replace function public\.resolve_district_ar\s*\(/i.test(readFileSync(join(dir, f), 'utf8')));
const newest = definers[definers.length - 1];
const sql = readFileSync(join(dir, newest), 'utf8');

// SQL string literal → JS regex source ('' is a quote; the resolver's patterns carry no other escapes).
const lit = (s: string) => s.replace(/''/g, "'");

function problems(sql: string): string[] {
  const arm = sql.match(/-- parenthetical alias[\s\S]*?-- end parenthetical alias/);
  if (!arm) return [`${newest}: the parenthetical-alias arm is missing from the newest resolve_district_ar`];
  const a = arm[0];
  const fail: string[] = [];
  const gate = a.match(/v ~ '([^']+)' then/);
  const base = a.match(/pa_base\s+text := btrim\(regexp_replace\(v, '([^']+)', ' ', 'g'\)\)/);
  const inner = a.match(/pa_inner text := btrim\(substring\(v from '([^']+)'\)\)/);
  if (!gate || !base || !inner) return [`${newest}: could not lift the arm's gate/base/inner patterns`];
  const g = new RegExp(lit(gate[1]), 'u');
  const strip = new RegExp(lit(base[1]), 'gu');
  const pick = new RegExp(lit(inner[1]), 'u');
  const cases: Array<[string, string | null, string | null]> = [
    // source string, base it must look up (null = arm must not fire), inner it must check
    ['الملك فهد ( المحدود )', 'الملك فهد', 'المحدود'],
    ['البستان (البراك)', 'البستان', 'البراك'],
    ['حي بقعاء الشرقية(سهلة الفزير)', 'حي بقعاء الشرقية', 'سهلة الفزير'],
    ['الصفا ١ (93/14)', null, null],          // a plan number: the suffix arm owns it, not this one
    ['المحدود (249/4) أ', null, null],
    ['حي الملك فهد', null, null],             // no brackets
  ];
  for (const [v, wantBase, wantInner] of cases) {
    const fires = g.test(v);
    if (wantBase === null) { if (fires) fail.push(`«${v}» must not enter the arm`); continue; }
    if (!fires) { fail.push(`«${v}» never enters the arm`); continue; }
    const b = v.replace(strip, ' ').trim();
    const m = v.match(pick);
    const i = m ? m[1].trim() : null;
    if (b !== wantBase) fail.push(`«${v}» looks up «${b}», want «${wantBase}»`);
    if (i !== wantInner) fail.push(`«${v}» checks inner «${i}», want «${wantInner}»`);
  }
  if (!/\(pa_ri is null or pa_ri = pa_rb\)/.test(a)) fail.push('the same-district guard is gone: «الصحافة (شرق المحدود)» would resolve to one of two districts');
  if (!/not exists \(select 1 from public\.loc_catalog_city/.test(a)) fail.push('the town guard is gone: «حي الصقور ( الاحساء )» would resolve');
  if (!/if result is null and v ~/.test(a)) fail.push('the arm no longer waits for the arms above (result is null)');
  return fail;
}

const bad = problems(sql);
if (bad.length) { console.error('✗ parenthetical district alias:\n  ' + bad.join('\n  ')); process.exit(1); }

const mutants: Array<[string, (s: string) => string]> = [
  ['arm removed', (s) => s.replace(/-- parenthetical alias[\s\S]*?-- end parenthetical alias/, '')],
  ['same-district guard dropped', (s) => s.replace('(pa_ri is null or pa_ri = pa_rb)', 'true')],
  ['town guard dropped', (s) => s.replace(/and not exists \(select 1 from public\.loc_catalog_city cc[\s\S]*?\) then/, 'then')],
  ['numeric brackets let in', (s) => s.replace("v ~ '\\([^)0-9٠-٩]+\\)' then", "v ~ '\\([^)]+\\)' then")],
];
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`✗ ${label} was NOT caught`); process.exit(1); }
};
for (const [name, mutate] of mutants) {
  const m = mutate(sql);
  if (m === sql) { console.error(`✗ mutant «${name}» did not apply — the barrier lost its grip on the arm`); process.exit(1); }
  mustCatch(`mutant «${name}»`, problems(m).length > 0);
}
console.log(`✓ parenthetical district alias: ${newest} resolves «X ( Y )» to X only when Y cannot mean elsewhere (${mutants.length} mutants caught)`);
