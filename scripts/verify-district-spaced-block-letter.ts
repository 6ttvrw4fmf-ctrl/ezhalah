// The resolver may strip a lone trailing BLOCK LETTER, never a number.
//
// HOW THIS WAS EARNED (🔧 Quality & Repair, 2026-10-08). bossbih prints the plan block after the
// district with a space («الجابرية د», «منسوب التعليم ب»), so 53 searchable ads had no district. The
// first draft of the fix also stripped a number before the letter, and the dry run showed what that
// costs: «الصفا 2 أ» became «الصفا», a DIFFERENT district (the 2 is the district's own name). Migration
// 20261008133717 strips the letter only; the digit guard then keeps «الصفا 2» unresolved.
//
// This lifts the strip and the digit guard from the NEWEST committed resolve_district_ar (a later
// redefinition that drops or widens it goes RED), runs them in both directions, and plants mutants.
//
//   node --experimental-strip-types scripts/verify-district-spaced-block-letter.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase/migrations');
const definers = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create or replace function public\.resolve_district_ar\s*\(/i.test(readFileSync(join(dir, f), 'utf8')));
const newest = definers[definers.length - 1];
const sql = readFileSync(join(dir, newest), 'utf8');

function problems(sql: string): string[] {
  const fail: string[] = [];
  const strip = sql.match(/-- 2026-10-08: a lone trailing block letter[^\n]*\n[^\n]*\n\s*v2 := regexp_replace\(v2, '([^']+)', ''\);/)?.[1];
  if (!strip) return [`${newest}: the spaced block-letter strip is missing from the newest resolve_district_ar`];
  const digit = sql.match(/if v2 <> v and v2 <> '' and v2 !~ '([^']+)'/)?.[1];
  if (!digit) return [`${newest}: the digit guard on the retry is missing`];
  // Postgres ARE → JS: these classes mean the same.
  const retry = (v: string): string | null => {
    const v2 = v.replace(new RegExp(strip, 'u'), '').trim();
    return v2 !== v && v2 !== '' && !new RegExp(digit, 'u').test(v2) ? v2 : null;
  };
  const must: Array<[string, string]> = [
    ['الجابرية د', 'الجابرية'], ['منسوب التعليم ب', 'منسوب التعليم'], ['شرق شرق الحديقة أ', 'شرق شرق الحديقة'],
    ['الضاحية الحي التاسع ج', 'الضاحية الحي التاسع'], ['الراجحي هـ', 'الراجحي'],
  ];
  const mustNot: Array<[string, string]> = [
    ['الصفا 2 أ', 'the number is part of the district name'],
    ['شرق المحدود 176 أ', 'a number stays; the digit guard blocks it'],
    ['الملقا', 'nothing to strip'],
    ['أبو عريش', 'a leading letter-word is not a block'],
  ];
  for (const [v, want] of must) { const got = retry(v); if (got !== want) fail.push(`«${v}»: retry ${got ?? 'none'}, want «${want}»`); }
  for (const [v, why] of mustNot) { const got = retry(v); if (got !== null) fail.push(`«${v}» must NOT retry (${why}), got «${got}»`); }
  return fail;
}

const bad = problems(sql);
if (bad.length) { console.error('✗ spaced block-letter strip:\n  ' + bad.join('\n  ')); process.exit(1); }
const mutants: Array<[string, (s: string) => string]> = [
  ['number stripped too', (s) => s.replace("v2 := regexp_replace(v2, '\\s+([أابجده]|هـ)$', '');", "v2 := regexp_replace(v2, '\\s+([0-9٠-٩]+\\s*)?([أابجده]|هـ)$', '');")],
  ['digit guard dropped', (s) => s.replace("if v2 <> v and v2 <> '' and v2 !~ '[0-9٠-٩]'", "if v2 <> v and v2 <> '' and v2 !~ 'ZZZ'")],
  ['strip removed', (s) => s.replace(/-- 2026-10-08: a lone trailing block letter[^\n]*\n[^\n]*\n\s*v2 := regexp_replace\(v2, '[^']+', ''\);\n/, '')],
];
for (const [name, mut] of mutants) {
  const m = mut(sql);
  if (m === sql) { console.error(`✗ mutant «${name}» did not apply — anchors drifted`); process.exit(1); }
  if (problems(m).length === 0) { console.error(`✗ mutant «${name}» was NOT caught`); process.exit(1); }
}
console.log(`✓ spaced block-letter strip intact in ${newest} (9 cases, 3 mutants caught)`);
