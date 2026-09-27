// AN ORACLE THAT HAS NEVER ONCE ANSWERED IS NOT A COVERED PLATFORM — the hermetic half.
//
// Measured 2026-09-26 (routine #3): muktamel's prune_unseen.verify_gone had been asked 1,132 times
// and answered UNKNOWN 1,132 times — zero GONE, zero LIVE — with 443 rows under strike and every
// monitor green. Full account in scripts/lib/oracleRetirement.ts and migration
// 20260926*_oracle_never_retires_detector.sql.
//
// This file stays in the required `npm test` and EXECUTES oracleNeverRetires() against injected
// worlds, including the exact production shape that was invisible. It never touches production: its
// verdict is decided by the diff alone (AGENTS.md, "The required suite is HERMETIC").
//
// The live half — which asks PRODUCTION whether the real SQL agrees with this judgement — is
// verify-oracle-never-retires-live.ts, and its continued existence is asserted below by EXECUTION
// via liveHalfProblems(), never by a bare src.includes().
//
// Run: node --experimental-strip-types scripts/verify-oracle-never-retires.ts
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import {
  oracleNeverRetires,
  neverRetiringPlatforms,
  MIN_ASKS_FOR_JUDGEMENT,
  type PlatformOracleFacts,
} from './lib/oracleRetirement.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

// The real 2026-09-26 reading, as production reported it.
const MUKTAMEL: PlatformOracleFacts = {
  platform: 'muktamel', strategy: 'CANDIDATE_PLUS_DIRECT', active: 3864, asks: 1132, affirmative: 0,
};
// Healthy comparators measured the same hour: their oracles CAN answer.
const SAKAN: PlatformOracleFacts = {
  platform: 'sakan', strategy: 'CANDIDATE_PLUS_DIRECT', active: 1200, asks: 232, affirmative: 232,
};
const MUSTQR: PlatformOracleFacts = {
  platform: 'mustqr', strategy: 'CANDIDATE_PLUS_DIRECT', active: 1254, asks: 34, affirmative: 34,
};

// ── 1. THE DEFECT ITSELF ────────────────────────────────────────────────────────────────────────
check('the production shape that was invisible is caught', oracleNeverRetires(MUKTAMEL));

// ── 2. IT DOES NOT FLAG EVERYTHING ──────────────────────────────────────────────────────────────
// A rule that fired on healthy platforms too would satisfy (1) and be just as useless.
check('a platform whose oracle returns LIVE is not flagged', !oracleNeverRetires(SAKAN));
check('a platform whose oracle returns GONE is not flagged', !oracleNeverRetires(MUSTQR));

// ── 3. MUTANTS — every clause must be load-bearing ──────────────────────────────────────────────
// Each mutant is the real rule applied to a world with ONE clause's premise broken. The rule must
// come back with the OPPOSITE answer, or that clause is decoration. Every boolean below is computed
// by executing oracleNeverRetires() — none is asserted true by hand.
const mustCatch = (what: string, caught: boolean) =>
  check(`mutant killed: ${what}`, caught);

const mutants: Array<[string, boolean]> = [
  // The clause the OLD detector was missing: counting UNKNOWN as an answer.
  ['ONE affirmative verdict flips it clean (the affirmative clause is load-bearing)',
    !oracleNeverRetires({ ...MUKTAMEL, affirmative: 1 })],
  ['1,131 UNKNOWN + 1 LIVE is still clean — an oracle that can answer is not broken',
    !oracleNeverRetires({ ...MUKTAMEL, asks: 1132, affirmative: 1 })],
  // The asks floor.
  ['below the ask floor it abstains (24 UNKNOWNs is a bad afternoon, not a broken oracle)',
    !oracleNeverRetires({ ...MUKTAMEL, asks: MIN_ASKS_FOR_JUDGEMENT - 1 })],
  ['exactly at the ask floor it judges',
    oracleNeverRetires({ ...MUKTAMEL, asks: MIN_ASKS_FOR_JUDGEMENT })],
  ['a platform never asked at all is not this detector\'s finding',
    !oracleNeverRetires({ ...MUKTAMEL, asks: 0 })],
  // The strategy clause: CRAWL_PRESENCE_ONLY makes no oracle claim to falsify.
  ['CRAWL_PRESENCE_ONLY is out of scope (mon_detect_unknown_treated_as_dead owns it)',
    !oracleNeverRetires({ ...MUKTAMEL, strategy: 'CRAWL_PRESENCE_ONLY' })],
  ['DIRECT_REVISIT is in scope',
    oracleNeverRetires({ ...MUKTAMEL, strategy: 'DIRECT_REVISIT' })],
  ['an unregistered strategy is out of scope',
    !oracleNeverRetires({ ...MUKTAMEL, strategy: '(unregistered)' })],
  // The inventory clause.
  ['a platform holding no active listings strands nothing',
    !oracleNeverRetires({ ...MUKTAMEL, active: 0 })],
];
for (const [label, caught] of mutants) mustCatch(label, caught);

// ── 4. THE SET FORM, which the live half compares against the real SQL ──────────────────────────
check(
  'the flagged set over a mixed fleet is exactly the broken one',
  neverRetiringPlatforms([SAKAN, MUKTAMEL, MUSTQR]).join(',') === 'muktamel',
  `got: ${neverRetiringPlatforms([SAKAN, MUKTAMEL, MUSTQR]).join(',')}`,
);
check('an empty fleet yields an empty set, not a crash', neverRetiringPlatforms([]).length === 0);

// ── 5. THE SPLIT MUST NOT DECAY INTO A DELETION ─────────────────────────────────────────────────
// "Moved out of npm test" and "silently deleted" look identical from inside this suite.
const LIVE = 'verify-oracle-never-retires-live.ts';
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(
  `the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0,
  homing.join('\n      '),
);

console.log(failed === 0 ? '\nOK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
