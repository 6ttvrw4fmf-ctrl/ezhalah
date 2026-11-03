// The AF customer journey must only target a question the Advanced Filter really asks in that scope.
//
// HOW THIS WAS EARNED (🦅 Falcon backlog 811, fixed 2026-11-03). e2e/engineers/journey-lib.mjs afTargetsFor()
// picked «furnished = yes» for every furnished rent row, Monthly included. The AF never asks furnished on a
// Monthly («إقامات قصيرة») search — src/lib/afCohorts.ts COHORT_QUESTIONS has no `furnished` under RentMonthly —
// so each such journey ended UNKNOWN «interview never offered a question for: furnished» and the UNKNOWN count
// stopped meaning anything. This runs the REAL module, checks the product's own question list still agrees,
// then plants the old line and requires it to be caught.
//
//   node --experimental-strip-types scripts/verify-af-journey-never-targets-monthly-furnished.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const LIB = join(ROOT, 'e2e/engineers/journey-lib.mjs');
type Row = Record<string, unknown>;
type Target = { kind: string; token?: string };
type Fn = (r: Row) => Target[];

function problems(afTargetsFor: Fn): string[] {
  const out: string[] = [];
  const has = (row: Row) => afTargetsFor(row).some((t) => t.kind === 'furnished');
  if (has({ deal_ar: 'إيجار', rent_period_ar: 'شهري', type_ar: 'شقة', furnished: true }))
    out.push('a Monthly rent targets furnished, a question the AF never asks there');
  if (!has({ deal_ar: 'إيجار', rent_period_ar: 'سنوي', type_ar: 'شقة', furnished: true }))
    out.push('an Annual rent no longer targets furnished (over-correction)');
  if (has({ deal_ar: 'بيع', type_ar: 'شقة', furnished: true }))
    out.push('a sale targets furnished');
  return out;
}

// The product half: the premise must still hold, or this barrier would be pinning a stale rule.
const cohorts = readFileSync(join(ROOT, 'src/lib/afCohorts.ts'), 'utf8');
const monthly = cohorts.match(/RentMonthly:\s*\[([^\]]*)\]/g) ?? [];
if (!monthly.length) { console.error('✗ could not find any RentMonthly question list in src/lib/afCohorts.ts'); process.exit(1); }
if (monthly.some((m) => /'furnished'/.test(m))) {
  console.error('✗ src/lib/afCohorts.ts now ASKS furnished on a Monthly cohort — update afTargetsFor to target it there');
  process.exit(1);
}

const real = (await import(LIB)).afTargetsFor as Fn;
const bad = problems(real);
if (bad.length) { console.error('✗ AF journey targets:\n  ' + bad.join('\n  ')); process.exit(1); }

// mustCatch: the pre-fix line, planted into a copy of the real module, must be caught.
const src = readFileSync(LIB, 'utf8');
const fixed = "row.deal_ar === 'إيجار' && row.rent_period_ar !== 'شهري' && row.furnished === true";
if (!src.includes(fixed)) { console.error('✗ the guarded line moved — re-point this barrier'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'af-journey-'));
const mutant = join(dir, 'journey-lib.mjs');
writeFileSync(mutant, src.replace(fixed, "row.deal_ar === 'إيجار' && row.furnished === true"));
const caught = problems((await import(mutant)).afTargetsFor as Fn).length > 0;   // an import error fails the run, never counts as caught
if (!caught) { console.error('✗ mutation proof: the old furnished-on-Monthly line was NOT caught'); process.exit(1); }

console.log('✓ AF journeys target furnished on Annual rent only, as the product asks it (mutation caught)');
