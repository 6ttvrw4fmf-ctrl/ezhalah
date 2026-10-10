// «الحي الاول بضاحية هجر» is «ضاحية هجر الحي الاول» reordered, and must resolve to the same district.
//
// HOW THIS WAS EARNED (🔧 Quality & Repair, 2026-10-10). abralosol writes two numbered districts of ضاحية هجر
// as «الحي الاول بضاحية هجر» (15 ads) and «الحي الثاني بضاحية هجر» (11 ads). resolve_district_ar()'s generic
// « بضاحيه هجر» arm prefixed «ضاحيه ال» to «حي الاول» and asked the catalog for «ضاحيه الحي الاول», a name
// that exists nowhere, so all 26 ads had no district. Migration 20261010132311 adds an arm ABOVE the generic
// one that drops the «حي» first. A CASE takes the first arm that matches, so the ORDER is the fix.
//
// This lifts the Hofuf (city 12) dahiyah arms, in order, from the NEWEST committed resolve_district_ar (a
// later redefinition that drops the arm or moves it below the generic one goes RED), evaluates them the way
// the CASE does on normalized tokens, and plants mutants.
//
//   node --experimental-strip-types scripts/verify-district-reordered-dahiya-ordinal.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase/migrations');
const definers = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create or replace function public\.resolve_district_ar\s*\(/i.test(readFileSync(join(dir, f), 'utf8')));
const newest = definers[definers.length - 1];
const sql = readFileSync(join(dir, newest), 'utf8');

type Arm = { test: RegExp; map: (k: string) => string };

// Every `when p_city_id = 12 and k ~ '<re>' then <expr>` arm of the dahiyah CASE, in source order. The
// expression is one of the three shapes the resolver uses; anything else is reported, never guessed.
function arms(sql: string): Arm[] | string {
  const out: Arm[] = [];
  const re = /when p_city_id = 12 and k ~ '([^']+)'\s*\n\s*then ([^\n]+)/g;
  for (const m of sql.matchAll(re)) {
    const test = new RegExp(m[1], 'u');
    const e = m[2].trim();
    let map: ((k: string) => string) | null = null;
    let x: RegExpMatchArray | null;
    if ((x = e.match(/^'([^']*)' \|\| regexp_replace\(regexp_replace\(k, '([^']+)', ''\), '([^']+)', ''\)$/))) {
      const [, pre, a, b] = x; map = (k) => pre + k.replace(new RegExp(a, 'u'), '').replace(new RegExp(b, 'u'), '');
    } else if ((x = e.match(/^'([^']*)' \|\| regexp_replace\(k, '([^']+)', ''\)$/))) {
      const [, pre, a] = x; map = (k) => pre + k.replace(new RegExp(a, 'u'), '');
    }
    if (!map) return `${newest}: unrecognized dahiyah arm expression «${e}»`;
    out.push({ test, map });
  }
  return out.length ? out : `${newest}: no city-12 dahiyah arms found in the newest resolve_district_ar`;
}

function problems(sql: string): string[] {
  const a = arms(sql);
  if (typeof a === 'string') return [a];
  const resolve = (k: string): string | null => { for (const arm of a) if (arm.test.test(k)) return arm.map(k); return null; };
  const fail: string[] = [];
  // normalized token (norm_district_tok output) → the catalog norm it must ask for
  const must: Array<[string, string]> = [
    ['حي الاول بضاحيه هجر', 'ضاحيه الاول'],     // abralosol, the 10-10 defect
    ['حي الثاني بضاحيه هجر', 'ضاحيه الثاني'],   // abralosol, the 10-10 defect
    ['خامس بضاحيه هجر', 'ضاحيه الخامس'],        // the generic arm still serves its own shape
    ['ضاحيه هجر الحي الاول', 'ضاحيه الاول'],     // the original order still resolves
    ['هجر الثالث', 'ضاحيه الثالث'],
  ];
  for (const [k, want] of must) {
    const got = resolve(k);
    if (got !== want) fail.push(`«${k}» asks for «${got ?? 'nothing'}», want «${want}»`);
  }
  const newArm = a.findIndex((x) => x.test.test('حي الاول بضاحيه هجر') && !x.test.test('خامس بضاحيه هجر'));
  const generic = a.findIndex((x) => x.test.test('خامس بضاحيه هجر'));
  if (newArm < 0) fail.push('the reordered-ordinal arm is missing');
  else if (generic >= 0 && newArm > generic) fail.push('the reordered-ordinal arm sits BELOW the generic « بضاحيه هجر» arm, so it can never fire');
  return fail;
}

const bad = problems(sql);
if (bad.length) { console.error('✗ reordered dahiyah ordinal:\n  ' + bad.join('\n  ')); process.exit(1); }

const NEW_ARM = /\s*-- 2026-10-10 \(🔧\): «الحي الاول بضاحية هجر»[^\n]*\n[^\n]*\n(\s*when p_city_id = 12 and k ~ '\^حي ال[^\n]*\n[^\n]*\n)/;
const mutants: Array<[string, (s: string) => string]> = [
  ['new arm removed', (s) => s.replace(NEW_ARM, '\n')],
  ['new arm moved below the generic arm', (s) => {
    const m = s.match(NEW_ARM); if (!m) return s;
    const without = s.replace(NEW_ARM, '\n');
    return without.replace(/(\s*when p_city_id = 12 and k ~ ' بضاحيه هجر\$'\n[^\n]*\n)/, `$1${m[1]}`);
  }],
  ['«حي» not dropped', (s) => s.replace("regexp_replace(regexp_replace(k, ' بضاحيه هجر$', ''), '^حي ', '')", "regexp_replace(regexp_replace(k, ' بضاحيه هجر$', ''), '^ZZZ ', '')")],
];
for (const [name, mut] of mutants) {
  const m = mut(sql);
  if (m === sql) { console.error(`✗ mutant «${name}» did not apply — anchors drifted`); process.exit(1); }
  if (!problems(m).length) { console.error(`✗ mutant «${name}» was NOT caught`); process.exit(1); }
}
console.log(`✓ reordered dahiyah ordinal resolves in ${newest} (5 cases + arm order, 3 mutants caught)`);
