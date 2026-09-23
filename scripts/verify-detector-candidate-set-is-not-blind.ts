// THE HERMETIC HALF: the candidate-set judgement, mutation-proven on every PR (ops_incident #391).
//
// WHY THIS SHAPE. The guard this file belongs to has to ask production which detectors have left the
// raise candidate set — an answer only production holds. A check whose verdict is decided by
// production's state must not sit in the required per-PR suite (AGENTS.md, "The required suite is
// HERMETIC"), so the pair is split: the live call lives in
// scripts/verify-detector-candidate-set-is-not-blind-live.ts, homed in a workflow, and THIS file
// keeps the part that belongs on a diff — the judgement, proven in both directions, plus the
// assertion that the live half provably still executes somewhere.
//
// Both halves import candidateSetBlindness() from scripts/lib/candidateSetBlindness.ts. That is the
// point of the split rather than a detail of it: a copy of the judgement here would prove something
// about a copy, and the copy-drift class is exactly what made verify-extract-price pass while
// production broke on 2026-08-29.
//
// Run: node --experimental-strip-types scripts/verify-detector-candidate-set-is-not-blind.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import {
  candidateSetBlindness,
  DIRECT_RAISER,
  WRAPPER_RAISER,
} from './lib/candidateSetBlindness.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nA detector that leaves the raise candidate set is reported, not skipped\n');

// ── THE LIVE HALF MUST STILL RUN SOMEWHERE ──────────────────────────────────────────────────────
// Asked with liveHalfProblems(), which uses workflowInvokes() — never a bare src.includes(name). A
// split that decays into a deletion looks identical from inside this suite, and that is the failure
// this assertion exists to make impossible.
const LIVE = 'verify-detector-candidate-set-is-not-blind-live.ts';
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

// ── THE MIGRATION MUST STILL SHIP THE ONE DEFINITION OF THE FILTER ──────────────────────────────
// The guard's whole claim is that it cannot hold a drifting COPY of the membership filter: the
// filter exists once, as mon_detector_raises(text), and mon_detect_unresolvable_detector() CALLS it.
// If someone re-inlines `prosrc ~* 'mon_raise'` back into the detector, the guard and the detector
// can once again disagree about who is in the population, silently.
// Read the LATEST committed migration that redefines the detector, not every migration that ever
// mentioned it: an older file still carrying the re-inlined regex is history, and judging the union
// of all of them would read the repaired tree as broken forever.
const MIG = join(ROOT, 'supabase/migrations');
const allMigrations = readdirSync(MIG)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIG, f), 'utf8'));
const shipped = (() => {
  const touching = readdirSync(MIG)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) =>
      readFileSync(join(MIG, f), 'utf8').includes(
        'create or replace function public.mon_detect_unresolvable_detector',
      ),
    );
  const latest = touching.at(-1);
  return latest ? readFileSync(join(MIG, latest), 'utf8') : '';
})();
check(
  'mon_detector_raises(text) — the ONE definition of the candidate filter — is committed',
  allMigrations.some((s) => s.includes('function public.mon_detector_raises(p_src text)')),
  'no committed migration creates it, so the guard and the detector each carry their own filter',
);
check(
  'mon_detect_unresolvable_detector() CALLS that definition instead of re-inlining the regex',
  shipped.includes('public.mon_detector_raises(p.prosrc)'),
  'the latest committed body does not call the shared filter — a re-inlined predicate can drift ' +
    'away from what the guard measures, which is this bug class one layer up',
);

// ── MUTATION PROOF — the REAL judgement, against the answers a broken guard would return ────────
console.log('\n  mutation proof — candidateSetBlindness(), the function both halves run\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) {
    console.log(`  PASS  catches: ${label}`);
    return;
  }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

mustCatch(
  'the filter ignores p_extra_sources (the "simplify the union away" edit) — injection is a no-op',
  candidateSetBlindness({ bare: [], withWrapperRaiser: [], withDirectRaiser: [] }).length > 0,
);
mustCatch(
  'the filter reports EVERY candidate (an inverted or dropped membership test)',
  candidateSetBlindness({
    bare: ['mon_detect_a', 'mon_detect_b'],
    withWrapperRaiser: [WRAPPER_RAISER.name],
    withDirectRaiser: [DIRECT_RAISER.name],
  }).length > 0,
);
mustCatch(
  'a real detector has left the population — the #391 defect itself, arriving for the first time',
  candidateSetBlindness({
    bare: ['mon_detect_search_writer_starved'],
    withWrapperRaiser: [WRAPPER_RAISER.name, 'mon_detect_search_writer_starved'],
    withDirectRaiser: ['mon_detect_search_writer_starved'],
  }).length > 0,
);
mustCatch(
  'mon_detector_raises() stops matching the real raise call, so a healthy detector reads as departed',
  candidateSetBlindness({
    bare: [],
    withWrapperRaiser: [WRAPPER_RAISER.name, DIRECT_RAISER.name],
    withDirectRaiser: [DIRECT_RAISER.name],
  }).length > 0,
);
mustCatch(
  '…while the healthy shape is NOT reported as blind (the judgement is not vacuously red)',
  candidateSetBlindness({
    bare: [],
    withWrapperRaiser: [WRAPPER_RAISER.name],
    withDirectRaiser: [],
  }).length === 0,
);

const ok = failed === 0 && mutFail === 0;
console.log(
  ok
    ? '\n✓ the candidate-set judgement distinguishes a departed detector from a healthy fleet, and ' +
        'the live half is homed'
    : `\n✗ ${failed} failure(s), ${mutFail} mutation(s) survived`,
);
process.exit(ok ? 0 : 1);
