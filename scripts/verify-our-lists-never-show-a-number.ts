#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// OUR OWN LISTS NEVER SHOW A NUMBER — owner rule 2026-09-14, stated as absolute:
//   «in our district catalog, make sure there are no numbers… We just match it with ours, and then
//    in their property card, if they kept a number, we include that number.»
//   «We cannot have those numbers displayed… especially in the district list, it would be horrible.»
//
// ROOT CAUSE this file exists to stop from recurring. src/data/sa-locations.json is, in this repo's
// own words (docs/LOCATION_SYSTEM.md §6), «the official Saudi hierarchy … the source of truth for
// what places exist» — a third-party dataset imported verbatim. Measured 2026-09-14, it and the DB's
// loc_catalog_* tables hold the SAME records (102 of 102 numbered districts and 2 of 2 numbered
// cities matching on (city_id, name), zero difference either way), and that dataset carries
// municipal planning codes as if they were place names:
//     حي ج1 … حي ج44   = "C1 Dist." … "C44 Dist."   (plot blocks on a city plan)
//     مخطط ج1          = "Subdivision Plan 1c"
//     حي رقم 1         = "No 1 Dist."
// Nothing filtered it on the way in, so every downstream list inherited them — الطائف's district
// dropdown offered 161 choices of which 42 were plot codes; بقعاء 14 of 22.
//
// The database half is guarded structurally by three CHECK constraints (migration 20260914204035),
// asserted below to still be in the committed SQL. THIS half guards the file, because the file is
// the seed: a future re-import of the upstream dataset is the way this comes back, and it would
// otherwise arrive silently, in a 3,700-row diff nobody reads line by line.
//
// ENGLISH IS PART OF THE RULE. It was WORSE than Arabic (185 vs 102): our own translation renders
// Arabic ordinal WORDS as digits — «حي الصفاه الاول» → "Al Safat 1 Dist.", «المنطقة الصناعية
// الثانية» → "2nd Industrial Area". The Arabic carries no number at all there; the digit is ours,
// and it reaches the English property card. Those 83 are spelled out as words, never deleted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('\nour own city/district lists never show a number — in Arabic or in English\n');

/** THE rule. Any digit, either script, either language. There is no "small enough" number. */
export const HAS_NUMBER = /[0-9٠-٩]/;

type Sa = { regions: [number, string, string][]; cities: [number, number, string, string][]; districts: [number, number, string, string][] };
const sa = JSON.parse(readFileSync(join(ROOT, 'src/data/sa-locations.json'), 'utf8')) as Sa;

// A failed/emptied read must never read as "clean" (AGENTS.md: a failed fetch is not an empty answer).
check('the catalog actually loaded (13 regions, thousands of cities and districts)',
  sa.regions.length === 13 && sa.cities.length > 4000 && sa.districts.length > 3000,
  `regions=${sa.regions.length} cities=${sa.cities.length} districts=${sa.districts.length}`);

for (const [label, rows] of [
  ['regions', sa.regions.map((r) => [r[1], r[2]] as const)],
  ['cities', sa.cities.map((r) => [r[2], r[3]] as const)],
  ['districts', sa.districts.map((r) => [r[2], r[3]] as const)],
] as const) {
  const badAr = rows.filter(([, ar]) => HAS_NUMBER.test(ar));
  const badEn = rows.filter(([en]) => HAS_NUMBER.test(en));
  check(`${label}: no Arabic name carries a number (${rows.length} checked)`, badAr.length === 0,
    badAr.slice(0, 6).map(([, ar]) => ar).join(', '));
  check(`${label}: no English name carries a number (${rows.length} checked)`, badEn.length === 0,
    badEn.slice(0, 6).map(([en]) => en).join(', '));
}

// ── the DATABASE half must stay structurally guarded, not just currently clean ───────────────────
const MIGRATION = 'supabase/migrations/20260914204035_district_picker_folds_the_number_away_owner_rule.sql';
const sql = readFileSync(join(ROOT, MIGRATION), 'utf8');
for (const [table, constraint] of [
  ['loc_canonical_district', 'loc_canonical_district_never_numbered'],
  ['loc_catalog_district', 'loc_catalog_district_never_numbered'],
  ['loc_catalog_city', 'loc_catalog_city_never_numbered'],
] as const) {
  check(`${table} is guarded by a CHECK constraint, not just cleaned once`,
    new RegExp(`add constraint ${constraint}\\s+check`, 'i').test(sql));
}

// ── MUTATION PROOF — the rule must actually fail on every shape that was really in the file ──────
console.log('\n  mutation proof — every shape this actually found in production data\n');
let mut = 0;
const mustCatch = (label: string, name: string) => {
  if (HAS_NUMBER.test(name)) { console.log(`  ✓ catches ${label}: ${name}`); return; }
  mut++; console.error(`  ❌ BLIND to ${label}: ${name}`);
};
mustCatch('a plot-block code', 'حي ج44');
mustCatch('a plot-block code with a space', 'حي ج 35');
mustCatch('a subdivision plan', 'مخطط ج1');
mustCatch('a "District No." code', 'حي رقم 10');
mustCatch('the malformed parenthesised form', '(حي رقم (5');
mustCatch('a real name with a glued number', 'حي أبا العبلان2');
mustCatch('a real name with a spaced number', 'المحمدية 3');
mustCatch('a numbered CITY', 'الفويلق 1');
mustCatch('Arabic-Indic digits', 'الزهراء ١');
mustCatch('an ENGLISH ordinal (the 83 the Arabic never had)', '2nd Industrial Area');
mustCatch('an ENGLISH plot code', 'C10 Dist.');
// negative control — a rule red for everything proves nothing
for (const clean of ['المحمدية', 'حي المصيف', 'Al Wurud Dist.', 'Second Industrial Area', 'الفويلق']) {
  check(`a clean name is NOT flagged: ${clean}`, !HAS_NUMBER.test(clean));
}
failed += mut;

console.log(failed === 0
  ? '\n✅ no number appears in any list we own — Arabic or English, file or database.\n'
  : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
