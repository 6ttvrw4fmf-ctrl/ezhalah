// TWO OR MORE CHOSEN DISTRICTS ARE SPREAD ACROSS (owner 2026-10-31: «if he selected 2 or more
// districts we also diversify»). A search naming several districts matches ads in all of them; the
// first page must alternate between those districts (after platform, deal and property type — the
// five-dimension order of verify-first-batch-diversity-order.ts), not open with whichever district
// happened to have the freshest ads. Measured before the fix: `scopeOf()` returned 'district' for
// ANY number of districts, and the 'district' hierarchy carries no district key at all, so a
// حي النرجس + حي الياسمين search could show 100 النرجس cards before the first الياسمين one.
//
// The decision lives in `scopeForDistricts()` (src/lib/platformDiversity.ts) and is EXECUTED here —
// one district keeps the 'district' scope, two or more take the 'city' hierarchy — and the whole
// pipeline (`orderByScope`) is run on a synthetic two-district set to prove the cards really
// alternate. remote.ts cannot be imported outside Metro, so its one call site is pinned by text.
// MATCH FIRST: the stage is a permutation — same ids in, same ids out, asserted below.
//
//   node --experimental-strip-types scripts/verify-multi-district-results-spread.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { orderByScope, scopeForDistricts, type RankedRow } from '../src/lib/platformDiversity.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
// A mutation proof: the barrier's own predicate, applied to the broken input, must say BROKEN.
const mustCatch = (label: string, caught: boolean) => check(`(mutation) ${label}`, caught);

type L = { cleanType?: string | null; rentPeriod?: string | null; deal?: string; photos?: string[] };
const mkRow = (id: number, district: string): RankedRow<L> => ({
  l: { cleanType: 'Apartment', rentPeriod: null, deal: 'Rent', photos: [`p${id}.jpg`] },
  platform: 'aqar', city: 'الرياض', region: 'منطقة الرياض', district, source_table: 'aqar_res', rank: id,
});
const worstStreak = (seq: string[]): number => {
  let worst = 1, cur = 1;
  for (let i = 1; i < seq.length; i++) { if (seq[i] === seq[i - 1]) cur++; else cur = 1; if (cur > worst) worst = cur; }
  return seq.length ? worst : 0;
};

console.log('\n── 1. the scope decision ──');
check('one district → district scope (nothing to spread across)', scopeForDistricts(1) === 'district');
check('two districts → city hierarchy (platform → deal → type → district → photos)', scopeForDistricts(2) === 'city');
check('five districts → city hierarchy', scopeForDistricts(5) === 'city');

console.log('\n── 2. executed: 20 fresh النرجس ads then 20 older الياسمين ads, both districts chosen ──');
{
  const rows: RankedRow<L>[] = [];
  for (let i = 1; i <= 20; i++) rows.push(mkRow(i, 'حي النرجس'));
  for (let i = 21; i <= 40; i++) rows.push(mkRow(i, 'حي الياسمين'));
  const out = orderByScope(rows, scopeForDistricts(2), false, false, { preferPhotos: true });
  const first10 = out.slice(0, 10).map((r) => r.district);
  check('the first 10 cards alternate between the two districts', worstStreak(first10) === 1, first10.join(' | '));
  check('both districts appear in the first 2 cards', new Set(out.slice(0, 2).map((r) => r.district)).size === 2);
  const ids = (xs: RankedRow<L>[]) => xs.map((r) => `${r.source_table}:${r.l.photos?.[0]}`).sort().join(',');
  check('permutation only: same ids in and out (MATCH FIRST)', ids(out) === ids(rows) && out.length === rows.length);

  // Mutation: the pre-fix scope. The 'district' hierarchy has no district key, so the fresher district
  // owns the whole front of the list — exactly what the owner saw.
  const old = orderByScope(rows, 'district', false, false, { preferPhotos: true });
  mustCatch('the old \'district\' scope shows 20 النرجس cards before the first الياسمين',
    worstStreak(old.slice(0, 20).map((r) => r.district)) === 20);
  // The scope decision itself: a rule that keeps 'district' for two districts is the pre-fix bug.
  const preFix = (n: number) => 'district';
  mustCatch('a scope rule that returns \'district\' for 2+ districts is detected',
    preFix(2) !== scopeForDistricts(2));
}

console.log('\n── 3. remote.ts asks scopeForDistricts, not its own rule ──');
{
  const src = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
  check('scopeOf() calls scopeForDistricts(q.districts.length)',
    /if \(q\.districts && q\.districts\.length\) return scopeForDistricts\(q\.districts\.length\);/.test(src));
  check('scopeForDistricts is imported from @/lib/platformDiversity',
    /import \{[^}]*\bscopeForDistricts\b[^}]*\} from '@\/lib\/platformDiversity'/.test(src));
  check('no leftover hard-coded \'district\' return for a district list',
    !/q\.districts\.length\) return 'district'/.test(src));
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ multi-district results spread across the chosen districts');
process.exit(failed ? 1 : 0);
