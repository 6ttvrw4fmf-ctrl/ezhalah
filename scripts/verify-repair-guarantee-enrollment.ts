// EVERY DATA REPAIR MUST BE IN THE REGISTRY THAT RE-VERIFIES IT — HERMETIC HALF.
//
// The rule, and the measurement that produced it, are written once in the live half's header
// (scripts/verify-repair-guarantee-enrollment-live.ts) and in scripts/lib/repairClassifier.ts. In
// one line: the orphaned-guarantee registry rotates forever over the repairs it KNOWS ABOUT, and
// until 2026-09-12 nothing checked that a repair ever got into it — 9 of 28 strict-era listing
// repairs had not.
//
// THIS half runs in the required `npm test` and reaches nothing. It owns three things:
//
//   1. the committed waiver file is well-formed and every waiver still names a real in-era repair
//      (so scripts/repair-enrollment-waivers.txt cannot rot into a graveyard of dead exemptions);
//   2. enrollmentVerdict() — the SAME function the live half runs against production — is proven by
//      MUTATION, including the case that matters most: an unreadable or RLS-emptied registry must
//      FAIL, never read as "nothing is enrolled" and never as "all clear";
//   3. the live half is provably still executed somewhere — asked of the workflow file by
//      liveHalfProblems(), never by string-matching a name into a comment.
//
//   node --experimental-strip-types scripts/verify-repair-guarantee-enrollment.ts   (in `npm test`)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import { COMMITTED_NOT_APPLIED_BASELINE } from './lib/migrationDrift.ts';
import {
  repairsData, migrationVersion, enrollmentVerdict, parseWaivers, MIN_WAIVER_REASON,
  registryVersionsFromResponse,
} from './lib/repairClassifier.ts';

const ROOT = join(import.meta.dirname, '..');
const LIVE = 'verify-repair-guarantee-enrollment-live.ts';
const WAIVERS = join(ROOT, 'scripts', 'repair-enrollment-waivers.txt');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nEvery data repair is enrolled in the registry that re-verifies it (hermetic half)\n');

// ── 1. THE LIVE HALF IS STILL HOMED AND STILL INVOKED ───────────────────────────────────────────
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── 2. THE COMMITTED WAIVER FILE IS HONEST ──────────────────────────────────────────────────────
check('scripts/repair-enrollment-waivers.txt exists (an absent file would silently waive nothing '
  + 'and is indistinguishable from a deleted one)', existsSync(WAIVERS));

const waived = existsSync(WAIVERS) ? parseWaivers(readFileSync(WAIVERS, 'utf8')) : new Map<string, string>();

const repairs: string[] = [];
for (const f of readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  const v = migrationVersion(f);
  if (v < COMMITTED_NOT_APPLIED_BASELINE) continue;
  if (repairsData(readFileSync(join(ROOT, 'supabase', 'migrations', f), 'utf8'))) repairs.push(v);
}
check(`the classifier still finds in-era repairs to weigh (${repairs.length})`, repairs.length > 0,
  'zero repairs means the classifier or the era filter broke, not that the repo stopped repairing data');

// The enrollment half of this cannot run here — the registry lives in production — so pass the
// repairs through with an `enrolled` set that accepts everything, isolating the WAIVER rules.
const waiverOnly = enrollmentVerdict({ repairs, enrolled: repairs, waived });
check(`every waiver carries a real reason (>= ${MIN_WAIVER_REASON} chars) and still matches an in-era repair`,
  waiverOnly.problems.length === 0, waiverOnly.problems.join('\n      '));

// ── 3. MUTATION PROOF — the REAL shared predicate, fed a broken world ───────────────────────────
// enrollmentVerdict() is imported from scripts/lib/repairClassifier.ts: the same function the live
// half runs against production. A private copy here would prove nothing about the code that decides
// production's verdict — the drift class AGENTS.md records for five source-TEXT tripwires that
// stayed green for as long as their defects were live.
console.log('\n  mutation proof — the enrollment rule must not be fooled\n');
let mut = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  ${label}`); return; }
  mut++;
  console.error(`  FAIL  BLIND: ${label}`);
};

const ok = (v: ReturnType<typeof enrollmentVerdict>) => v.ok;
const noReason = new Map([['20260901000000', 'because']]);
const realWaiver = new Map([['20260901000000',
  'not a repair — the UPDATE is a self-assignment that only fires a trigger']]);

mustCatch('a repair that is registered passes',
  ok(enrollmentVerdict({ repairs: ['20260901000000'], enrolled: ['20260901000000'], waived: new Map() })));

mustCatch('a repair that is NEITHER registered nor waived FAILS, and is named',
  (() => {
    const v = enrollmentVerdict({ repairs: ['20260901000000'], enrolled: ['20260902000000'], waived: new Map() });
    return !v.ok && v.unenrolled.length === 1 && v.unenrolled[0] === '20260901000000';
  })());

mustCatch('a repair covered by a reasoned waiver passes without a registry row',
  ok(enrollmentVerdict({ repairs: ['20260901000000'], enrolled: ['20260902000000'], waived: realWaiver })));

mustCatch('a waiver with no real reason FAILS (a waiver is a reason, never a mute button)',
  !ok(enrollmentVerdict({ repairs: ['20260901000000'], enrolled: [], waived: noReason })));

mustCatch('a waiver that matches no in-era repair FAILS (the file cannot become a graveyard)',
  (() => {
    const v = enrollmentVerdict({
      repairs: ['20260901000000'],
      enrolled: ['20260901000000'],
      waived: new Map([['20260101000000', 'a long-dead exemption nobody removed when the file changed']]),
    });
    return !v.ok && v.problems.some((p) => p.includes('20260101000000'));
  })());

// THE ONE THAT MATTERS MOST. ops_repair_guarantee_registry is RLS-protected and an anon read of it
// returns HTTP 200 with []. Both of these must be FAILURES and neither may be reported as a gap
// computed from an empty universe — a failed fetch is not an empty answer, and a check that sends
// someone to enrol 28 already-enrolled repairs has manufactured its own incident.
mustCatch('an UNREADABLE registry FAILS and reports zero unenrolled (never 28 false positives)',
  (() => {
    const v = enrollmentVerdict({ repairs: ['20260901000000', '20260902000000'], enrolled: null, waived: new Map() });
    return !v.ok && v.unenrolled.length === 0 && v.problems.some((p) => p.includes('UNKNOWN'));
  })());

mustCatch('a registry that reads ZERO rows while repairs exist FAILS as unreadable, not as empty',
  (() => {
    const v = enrollmentVerdict({ repairs: ['20260901000000'], enrolled: [], waived: new Map() });
    return !v.ok && v.unenrolled.length === 0 && v.problems.some((p) => p.includes('ZERO rows'));
  })());

mustCatch('an empty registry with NO repairs is not an error (the honest vacuous case)',
  ok(enrollmentVerdict({ repairs: [], enrolled: [], waived: new Map() })));

mustCatch('a duplicated repair version cannot inflate or hide the gap',
  (() => {
    const v = enrollmentVerdict({
      repairs: ['20260901000000', '20260901000000'], enrolled: ['20260902000000'], waived: new Map(),
    });
    return !v.ok && v.unenrolled.length === 1;
  })());

// registryVersionsFromResponse() is the other half of the same honesty, one layer earlier: it is
// what the live half calls on the raw HTTP answer, and an RLS-filtered read of this table really
// does come back as 200 with []. If this function ever "helpfully" returned [] for a failure, every
// mutant above would still pass and the check would report all 28 repairs unenrolled.
mustCatch('a non-2xx registry response is UNKNOWN, never an empty registry',
  registryVersionsFromResponse(false, []) === null
  && registryVersionsFromResponse(false, [{ repair_version: '20260901000000' }]) === null);

mustCatch('a 200 whose body is not an array is UNKNOWN (an error object is not data)',
  registryVersionsFromResponse(true, { message: 'permission denied' }) === null
  && registryVersionsFromResponse(true, null) === null);

mustCatch('a real 200 array IS data, and an RLS-emptied 200 is passed on as [] for the rule to refuse',
  (() => {
    const rows = registryVersionsFromResponse(true, [{ repair_version: '20260901000000' }]);
    const empty = registryVersionsFromResponse(true, []);
    return rows?.length === 1 && rows[0] === '20260901000000'
      && Array.isArray(empty) && empty.length === 0;
  })());

if (mut) { console.error(`\n✗ ${mut} enrollment-rule case(s) wrong\n`); process.exit(1); }
if (failed) { console.error(`\n✗ ${failed} check(s) FAILED\n`); process.exit(1); }
console.log(`\n✓ ${repairs.length} in-era repairs weighed; waiver file honest; live half homed\n`);
