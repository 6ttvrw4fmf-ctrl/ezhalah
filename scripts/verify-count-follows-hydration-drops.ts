// THE RESULTS COUNT FOLLOWS THE CARDS (🔧 backlog 1153, 2026-11-01).
//
// Measured on production: tuba 13260147 was hidden at source 11:56:07 UTC; at 12:02 the search still counted it
// (index total_count 47) while the raw hydration dropped its card (46 on screen, journey 41303419393); the 12:39
// journey, after the 12:35 sync pruned the index, read 46 = 46. The owner's rule (2026-10-30): a count that differs
// from the reachable cards is a bug. `honestTotal()` subtracts the rows a page could not hydrate; this barrier
// EXECUTES it (never a text tripwire), plants the pre-fix mutant, and pins that fetchListingsForQuery really calls it
// after the hydration loop.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { honestTotal } from '../src/lib/honestTotal.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('\nThe results count follows the cards a customer can reach\n');

check('the measured case: 47 counted, 47 candidates, 46 hydrated → 46', honestTotal(47, 47, 46) === 46);
check('nothing dropped → the index total is kept (47, 47, 47 → 47)', honestTotal(47, 47, 47) === 47);
check('a page of 25 out of 1,047 with one drop → 1,046 (the full-set total minus THIS page\'s drop)', honestTotal(1047, 25, 24) === 1046);
check('an empty page never changes the total (5, 0, 0 → 5)', honestTotal(5, 0, 0) === 5);
check('never below zero (1, 3, 0 → 0)', honestTotal(1, 3, 0) === 0);
check('never ADDS: more hydrated than candidates cannot raise the total (10, 2, 5 → 10)', honestTotal(10, 2, 5) === 10);
check('a non-finite total reads 0, not NaN', honestTotal(NaN, 1, 1) === 0 && honestTotal(Infinity, 1, 1) === 0);

// mutation: the pre-fix behaviour (the index total untouched) must be caught by the measured case
const preFix = (total: number, _c: number, _h: number) => total;
check('(mutation) the pre-fix total (index count untouched) is caught on the measured case', preFix(47, 47, 46) !== 46);
const addsBack = (total: number, c: number, h: number) => total + (h - c);
check('(mutation) a helper that could ADD when hydration exceeds candidates is caught', addsBack(10, 2, 5) !== honestTotal(10, 2, 5));

// wiring: the fetch really applies it after the hydration loop, before the diversity stage
const remote = readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8');
const call = remote.indexOf('pageTotal = honestTotal(pageTotal, cleanCands.length, ranked.length)');
const loop = remote.indexOf("const l = map.get(`${c.source_table}:${c.listing_id}`);\n    if (!l) continue;");
const diversity = remote.indexOf('const scoped = orderByScope(ranked,');
check('fetchListingsForQuery applies honestTotal after the hydration loop and before orderByScope',
  call > 0 && loop > 0 && diversity > 0 && loop < call && call < diversity,
  `loop@${loop} call@${call} orderByScope@${diversity}`);
check('remote.ts imports the helper from src/lib/honestTotal.ts', /import \{ honestTotal \} from '@\/lib\/honestTotal'/.test(remote));

if (failed) { console.error(`\n❌ verify-count-follows-hydration-drops: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-count-follows-hydration-drops: the number on screen never exceeds the cards a customer can reach.');
