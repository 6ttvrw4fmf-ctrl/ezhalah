// The customer-journey robot must budget the way a customer reading the card budgets.
//
// HOW THIS WAS EARNED (🔧 Quality & Repair, 2026-10-08). e2e/engineers/journey-lib.mjs priceOf() typed
// price_annual into the MONTHLY price box whenever a monthly rent had no price_total. muktamel 16138529
// (a 75,000/month showroom, price_annual 900,000) was searched as «675,000–1,125,000 a month», got 0
// cards, and was reported as a customer-facing «can't find» bug by ♻️ and again by 🔧's gate sample. The
// search was right (a 56k–94k monthly budget finds it, 1 of 19). A test tool that invents failures sends
// engineers after bugs that do not exist and makes the launch-gate number lie.
//
// This imports the REAL module (no copy) and runs it, then plants the old expression and requires it
// to be caught.
//
//   node --experimental-strip-types scripts/verify-journey-budget-is-the-card-budget.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIB = join(import.meta.dirname, '..', 'e2e/engineers/journey-lib.mjs');
type Row = Record<string, unknown>;
type PriceOf = (r: Row) => number | null;

function problems(priceOf: PriceOf): string[] {
  const out: string[] = [];
  const expect = (row: Row, want: number | null, why: string) => {
    const got = priceOf(row);
    if (got !== want) out.push(`${why}: got ${got}, want ${want}`);
  };
  expect({ platform: 'muktamel', deal_ar: 'إيجار', rent_period_ar: 'شهري', price_total: null, price_annual: 900000 }, 75000, 'monthly rent with no price_total budgets price_annual ÷ 12');
  expect({ platform: 'x', deal_ar: 'إيجار', rent_period_ar: 'سنوي', price_total: null, price_annual: 60000 }, 60000, 'annual rent budgets price_annual');
  expect({ platform: 'x', deal_ar: 'بيع', price_total: 1200000, price_annual: null }, 1200000, 'a sale budgets price_total');
  expect({ platform: 'gathern', deal_ar: 'إيجار', rent_period_ar: 'شهري', price_annual: 36000 }, null, 'stay-length platforms set no budget');
  return out;
}

const real = (await import(LIB)).priceOf as PriceOf;
const bad = problems(real);
if (bad.length) { console.error('✗ journey budget:\n  ' + bad.join('\n  ')); process.exit(1); }

const src = readFileSync(LIB, 'utf8');
const start = src.indexOf('  const annual = Number(row.price_annual);');
const end = src.indexOf('    : row.price_total ?? row.price_total_effective;');
if (start < 0 || end < 0) { console.error('✗ anchors drifted in journey-lib.mjs'); process.exit(1); }
const OLD = "  const p = row.deal_ar === 'إيجار'\n    ? (row.rent_period_ar === 'شهري' ? row.price_total ?? row.price_annual : row.price_annual ?? row.price_total)\n";
const dir = mkdtempSync(join(tmpdir(), 'ezhalah-journey-'));
const mutFile = join(dir, 'journey-lib.mjs');
writeFileSync(mutFile, src.slice(0, start) + OLD + src.slice(end));
const mutant = (await import(mutFile)).priceOf as PriceOf;
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`✗ ${label} was NOT caught`); process.exit(1); }
};
mustCatch('the 2026-10-08 priceOf (annual typed into the monthly box)', problems(mutant).length > 0);
console.log('✓ the journey robot budgets the card’s own figure (4 cases; old priceOf caught)');
