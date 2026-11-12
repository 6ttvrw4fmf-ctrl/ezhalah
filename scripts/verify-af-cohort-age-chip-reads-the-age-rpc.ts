// An age rung's chip is read from the AGE count RPC in every cohort sweep of the AF live check (🔬 2026-11-10).
//
// verify-af-full-surface-differential.ts (af-live-truth-check.yml) read the age rungs of its COMBINED(Buy∪Rent) and
// Rent-BOTH(كلاهما) sweeps out of apartment_guided_counts_ar's row, which carries no cnt_new … cnt_10p: 48 chips were
// NaN in job 129595811625 (2026-11-10) and a true zero rung (Duplex «10+» @region:1: chip — total 0 oracle 0) failed
// «a zero option must be zero everywhere», holding P1 alert 11763 red on the tool, not the product.
//
// This check EXECUTES the shared selector (scripts/lib/afCohortChip.ts) on real row shapes, and pins that every chip
// the live script computes goes through it — none reads `guided[opt.col]` directly any more.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chipOf, cohortChip, type ChipOpt } from './lib/afCohortChip.ts';

let failed = 0;
const check = (ok: boolean, what: string, why = '') => {
  console.log(`${ok ? '✓' : '✗'} ${what}${ok || !why ? '' : ` — ${why}`}`);
  if (!ok) failed++;
};

// the two row shapes the RPCs really return (pg_get_function_result, 2026-11-10)
const GUIDED = { cnt_total_base: 65, cnt_furnished: 30, cnt_unfurnished: 9, kitchen: 39 };
const AGE = { cnt_new: 12, cnt_1_2: 8, cnt_3_5: 5, cnt_6_9: 2, cnt_10p: 0, cnt_unknown: 38, cnt_total: 65 };
const TEN_PLUS: ChipOpt = { col: 'cnt_10p', countRpc: 'age' };
const UPTO5: ChipOpt = { col: 'cnt_new', plus: ['cnt_1_2', 'cnt_3_5'], countRpc: 'age' };
const KITCHEN: ChipOpt = { col: 'kitchen', countRpc: 'guided' };

check(cohortChip(TEN_PLUS, GUIDED, AGE) === 0, 'a zero age rung reads 0 from the age row (Duplex «10+»)');
check(cohortChip(UPTO5, GUIDED, AGE) === 25, 'a cumulative rung is the SUM of its buckets (12 + 8 + 5)');
check(cohortChip(KITCHEN, GUIDED, AGE) === 39, 'a non-age option still reads the guided row');
check(cohortChip(TEN_PLUS, GUIDED, null) === null, 'no age row → no chip (null), never NaN');
check(Number.isFinite(chipOf(AGE, UPTO5)), 'chipOf on the age row is a number');

// every chip of the live script goes through the selector
const src = readFileSync(join(import.meta.dirname, 'verify-af-full-surface-differential.ts'), 'utf8');
const direct = src.match(/Number\(guided\[opt\.col\]\)/g)?.length ?? 0;
check(direct === 0, 'no sweep reads a chip as Number(guided[opt.col])', `${direct} site(s) still do — an age rung there is NaN`);
const uses = src.match(/cohortChip\(opt, guided, age\)/g)?.length ?? 0;
check(uses >= 2, 'the COMBINED and Rent-BOTH sweeps both use cohortChip()', `found ${uses}`);
check(/from '\.\/lib\/afCohortChip\.ts'/.test(src), 'the live script imports the SAME selector this check executes');

// ── MUTATION PROOF ── the shapes the tool had on 2026-11-10
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`, 'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');
const oldChip = (opt: ChipOpt, guided: Record<string, unknown>) => (opt.col && guided ? Number(guided[opt.col]) : null);
mustCatch('the age rung read out of the guided row (NaN)', !Number.isFinite(oldChip(TEN_PLUS, GUIDED) as number));
mustCatch('a cumulative rung that ignores `plus`', oldChip({ col: 'cnt_new', countRpc: 'age' }, AGE) !== cohortChip(UPTO5, GUIDED, AGE));
const OLD_LOOP = "const chip = opt.col && guided ? Number(guided[opt.col]) : null;";
mustCatch('a sweep loop written the old way', (OLD_LOOP.match(/Number\(guided\[opt\.col\]\)/g)?.length ?? 0) > 0);

console.log(failed === 0
  ? '\n✅ verify-af-cohort-age-chip-reads-the-age-rpc: every age chip is read from the age count RPC.'
  : `\n❌ verify-af-cohort-age-chip-reads-the-age-rpc: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
