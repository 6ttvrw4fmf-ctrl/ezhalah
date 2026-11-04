// The AF customer journey may only target a chip the Advanced Filter really SHOWS for the listing's type × deal.
//
// HOW THIS WAS EARNED (🔬 backlog 1268, 2026-11-04). Since 2026-11-01 the AF asks amenities through the themed cards of
// src/lib/afCohorts.ts COHORT_CARDS — a Villa Buy shows no kitchen / AC / parking chip. e2e/engineers/journey-lib.mjs
// afTargetsFor() still picked from the generic AMENITY_TOKEN_COLUMN list, so journeys hunted chips that never render and
// ended UNKNOWN «interview never offered a question» (customer-journey run 41714162229: 3 of 8), which hid real misses.
// This EXECUTES the real picker against the real card table for every type the journey can tap and every deal leg,
// then plants the old (card-blind) rule in a copy and requires it to be caught.
//
//   node --experimental-strip-types scripts/verify-af-journey-targets-only-offered-chips.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COHORT_CARDS } from '../src/lib/afCohorts.ts';

const ROOT = join(import.meta.dirname, '..');
const LIB = join(ROOT, 'e2e/engineers/journey-lib.mjs');
type Row = Record<string, unknown>;
type Target = { kind: string; token?: string };
type Lib = { afTargetsFor: (r: Row, max?: number, cards?: unknown) => Target[]; TYPE_UI: Record<string, unknown>;
  offeredChips: (r: Row, cards: unknown) => Set<string> | null };

const ALL_TRUE = Object.fromEntries(['elevator', 'kitchen', 'parking', 'air_conditioner', 'private_entrance', 'maid_room',
  'driver_room', 'balcony', 'pool', 'garden', 'gym', 'laundry_room', 'optical_fibers', 'car_entrance', 'sanitation',
  'electricity', 'water_supply', 'furnished'].map((c) => [c, true]));
const LEGS: Row[] = [{ deal_ar: 'بيع' }, { deal_ar: 'إيجار', rent_period_ar: 'سنوي' }, { deal_ar: 'إيجار', rent_period_ar: 'شهري' }];

function problems(lib: Lib): string[] {
  const out: string[] = [];
  let covered = 0;
  for (const type_ar of Object.keys(lib.TYPE_UI)) {
    for (const leg of LEGS) {
      const row = { type_ar, ...leg, ...ALL_TRUE };
      const offered = lib.offeredChips(row, COHORT_CARDS);
      if (!offered) continue;
      covered++;
      for (const t of lib.afTargetsFor(row, 99, COHORT_CARDS)) {
        const key = t.kind === 'amenity' ? t.token! : 'furnished(question)';
        if (!offered.has(key)) out.push(`${type_ar} × ${leg.rent_period_ar ?? leg.deal_ar}: targets «${key}», a chip the cards never show`);
      }
    }
  }
  if (covered < 20) out.push(`only ${covered} type × deal legs resolved to a card list — the type map broke`);
  // not over-corrected: a Villa Buy with a maid's room is still a target (the cards show maid_room there)
  const villa = lib.afTargetsFor({ type_ar: 'فيلا', deal_ar: 'بيع', maid_room: true }, 2, COHORT_CARDS);
  if (!villa.some((t) => t.token === 'maid_room')) out.push('a Villa Buy maid_room yes is no longer a target');
  return out;
}

const real = (await import(LIB)) as Lib;
const bad = problems(real);
if (bad.length) { console.error('✗ AF journey targets:\n  ' + bad.slice(0, 15).join('\n  ')); process.exit(1); }

const src = readFileSync(LIB, 'utf8');
const guarded = '.filter((token) => offered.has(token) && row[CARD_TOKEN_COLUMN[token]] === true)';
if (!src.includes(guarded)) { console.error('✗ the guarded line moved — re-point this barrier'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'af-journey-cards-'));
const mutant = join(dir, 'journey-lib.mjs');
writeFileSync(mutant, src.replace(guarded, '.filter((token) => row[CARD_TOKEN_COLUMN[token]] === true)'));
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`✗ mutation proof: ${label} was NOT caught`); process.exit(1); }
};
// an import error fails the run, never counts as caught
mustCatch('the card-blind picker', problems((await import(mutant)) as Lib).length > 0);

console.log('✓ AF journeys target only chips the AF cards show for the type × deal (mutation caught)');
