// THE AGE QUESTION IS A NESTED LADDER, AND THE LIVE MATRIX MUST COUNT IT AS ONE (🔬 AF engineer, 2026-10-12).
//
// Since the owner's 2026-10-05 rule the age options are «جديد ⊂ حتى سنتين ⊂ حتى ٥ ⊂ حتى ٩» (AGE_LADDER in
// src/data/advancedFilters.ts). scripts/lib/afMatrix.ts still declared the field a disjoint PARTITION, so
// verify-af-matrix-truth-live.ts summed the rungs: «70441 + 3318 vs 23048» on Riyadh apartments/Buy, red on
// every age cohort of af-live-truth-check run 38215288912 while the RPC's own buckets summed exactly.
//
// This EXECUTES the real AGE_LADDER (lifted from the app) on a synthetic count row and proves the two facts the
// live check now relies on: the rungs are nested, and widest rung + rows past the top rung + unknown == scope.
// Both directions: a ladder declared as a plain partition must be caught.
//
//   node --experimental-strip-types scripts/verify-af-age-ladder-is-checked-as-nested.ts   (in `npm test`)
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { fieldMeaning } from './lib/afMatrix.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0, blind = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? '  ok' : '  FAIL'}  mutation caught: ${label}`);
  if (!caught) blind++;
};

const { AGE_LADDER } = await liftSymbols(join(ROOT, 'src/data/advancedFilters.ts'),
  [{ header: 'const AGE_LADDER:' }], ['AGE_LADDER'],
  'type AgeOptionCounts = Record<string, number>;') as {
    AGE_LADDER: Array<{ key: string; buckets: string[] | null; count: (c: Record<string, number>) => number }> };

// Riyadh apartments/Buy, measured 2026-10-12 from property_age_option_counts_ar
const row = { cnt_new: 16043, cnt_1_2: 1072, cnt_3_5: 1256, cnt_6_9: 541, cnt_10p: 818, cnt_unknown: 3317 };
const scope = 23047;
const counts = AGE_LADDER.map((r) => r.count(row));

check('the ladder is nested: every rung is at least the one before it',
  counts.every((c, i) => i === 0 || c >= counts[i - 1]), counts.join(' ≤ '));
const fm = fieldMeaning('property_age');
check('the matrix declares property_age a nested ladder', !!fm?.nested);
const widest = Math.max(...counts);
check('widest rung + beyond the ladder + unknown == scope', widest + row.cnt_10p + row.cnt_unknown === scope,
  `${widest} + ${row.cnt_10p} + ${row.cnt_unknown} vs ${scope}`);
const partitionSum = counts.reduce((a, b) => a + b, 0) + row.cnt_unknown;
mustCatch('summing a nested ladder as a partition', partitionSum !== scope);

if (blind) { console.error(`\n✗ ${blind} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the age ladder is counted as nested, never as a partition\n');
