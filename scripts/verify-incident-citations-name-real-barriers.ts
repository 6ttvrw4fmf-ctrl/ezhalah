// AN INCIDENT'S BARRIER CITATION MUST NAME SOMETHING THAT EXISTS — HERMETIC HALF.
//
// The rule, the measurement that produced it and the four phantom citations found on 2026-09-13 are
// written once, in scripts/lib/barrierCitations.ts. In one line: `ops_incident` refuses to close a
// finding without naming a permanent barrier, a CHECK constraint enforces it, and nothing ever
// checked that the named barrier was written — so four incidents in a state that CLAIMS cover cite
// files that appear in no commit on any branch, each with a confident count of checks and mutation
// proofs beside it.
//
// THIS half runs in the required `npm test` and reaches nothing. It owns three things:
//
//   1. citedArtifacts() — the extractor — really finds all three shapes production uses, and cannot
//      double-count a qualified path as a bare filename or mistake a path segment for a function;
//   2. citationProblems() — the SAME function the live half runs against production — is proven by
//      MUTATION, including the two cases that decide this check's honesty: an unreadable table and
//      an RLS-emptied 200 must each read as UNKNOWN, never as "no phantom citations found";
//   3. the live half is provably still executed somewhere — asked of the workflow file by
//      liveHalfProblems(), never by string-matching a name into a comment.
//
// WHY THE VERDICT ITSELF IS NOT HERE. Whether a citation is phantom is a fact about PRODUCTION's
// incident table, which moves whenever any of the eleven routines writes a row. Inside the required
// per-PR suite that would fail unrelated pull requests on someone else's incident — the placement
// defect AGENTS.md records for four checks on 2026-09-06 ("The required suite is HERMETIC"). The
// live half is homed in .github/workflows/incident-citation-guard.yml, and the schedule is the
// load-bearing trigger: a phantom citation is introduced by an UPDATE in the database, long after
// any pull request is gone, so a push-triggered check alone would never see it.
//
//   node --experimental-strip-types scripts/verify-incident-citations-name-real-barriers.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import {
  citedArtifacts, citationProblems, CLAIMED_STATES,
  type Artifact, type IncidentRow,
} from './lib/barrierCitations.ts';

const ROOT = join(import.meta.dirname, '..');
const LIVE = 'verify-incident-citations-name-real-barriers-live.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nAn incident\'s barrier citation names something that exists (hermetic half)\n');

// ── 1. THE LIVE HALF IS STILL HOMED AND STILL INVOKED ───────────────────────────────────────────
// Without this, "moved out of npm test" and "silently deleted" look identical from inside the suite.
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── 2. THE EXTRACTOR SEES ALL THREE SHAPES PRODUCTION ACTUALLY USES ─────────────────────────────
// Each fixture below is a VERBATIM citation from production, not a string this barrier invented.
// BARRIER_ENGINEER.md PART 3, R1.4: a proof that supplies its own input proves nothing.
const shapes = (s: string) => citedArtifacts(s).map((a) => `${a.kind}:${a.name}`);

// #5, the plain qualified-path shape.
check('a qualified path is extracted (incident #5)',
  shapes('scripts/verify-chat-persistence.ts').join() === 'path:scripts/verify-chat-persistence.ts');

// #179 (this routine's own) lists twelve barriers by BARE name. A path-only reader sees none of
// them — twelve real barriers would have been invisible, and twelve phantoms equally so.
check('bare filenames are extracted (incident #179\'s shape)',
  shapes('the 12 barriers converted in PR #2268 (verify-advanced-filter-count-honesty.ts, '
    + 'verify-af-option-count-equals-listings.ts)').join() ===
    'bare:verify-advanced-filter-count-honesty.ts,bare:verify-af-option-count-equals-listings.ts');

// #143: a database function is a perfectly good permanent barrier and must be checked too.
check('a database function is extracted (incident #143)',
  shapes('mon_detect_propagation_order_inverted (migrations 20260911141305 + 20260911141433)')
    .join() === 'fn:mon_detect_propagation_order_inverted');

// #177's real citation mixes a path with prose — and the path is one of the four phantoms.
check('a path inside prose is extracted (incident #177)',
  shapes('scrapers/common/tests/test_jurash_sold_pin_evidence.py -- 4 tests, mutation-proven '
    + '(evidence write removed -> 3/4 tests correctly go red, restored -> green)').join() ===
    'path:scrapers/common/tests/test_jurash_sold_pin_evidence.py');

// The de-duplication rule, stated as a test: a qualified path must NOT also surface as a bare name,
// or every real citation would be counted twice and one existence test would be asked of a name the
// resolver cannot resolve.
check('a qualified path is NOT double-counted as a bare filename',
  shapes('scripts/verify-x.ts').length === 1);

// #38 cites both a function and a migration path; neither may swallow the other. Asserted as a SET,
// because extraction order is not part of the contract — pinning it would make this check invert on
// a harmless refactor, which is the source-text-tripwire failure this routine exists to remove.
const mixed = shapes('mon_detect_unannualised_rent_cohort (migration 20260905071148) and '
  + 'supabase/migrations/20260905072446_x.sql');
check('a path segment is never mistaken for a database function (incident #38)',
  mixed.length === 2
  && mixed.includes('fn:mon_detect_unannualised_rent_cohort')
  && mixed.includes('path:supabase/migrations/20260905072446_x.sql'));

// ── 3. MUTATION PROOFS — the predicate is fed a broken world and watched to FAIL ────────────────
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  mutation caught: ${label}`);
  if (!caught) failed++;
};

const row = (id: number, state: string, citation: string | null, owner = 'routine-3-data-integrity'):
  IncidentRow => ({ id, state, owner_routine: owner, citation });

/** A world where everything cited exists. */
const allPresent: (a: Artifact) => boolean = () => true;
/** A world where nothing cited exists. */
const nonePresent: (a: Artifact) => boolean = () => false;

// M1 — the defect exactly as it stands in production today. All four phantoms, verbatim, in the
// states they actually carry. This is the replay: production's own rows, not a fixture.
const PRODUCTION_PHANTOMS: IncidentRow[] = [
  row(37, 'fixed', 'scripts/verify-search-sync-pass-is-evidenced.ts (hermetic, in npm test, 10 checks + 10 in-file mutation proofs)'),
  row(55, 'fixed', 'scripts/verify-search-index-single-writer.ts (in npm test). Discovers writers by REPLAYING the migration history'),
  row(74, 'verifying', 'scripts/verify-gh-dispatch-fails-loud.ts (in npm test run list; 373 checks)', 'routine-7-seam'),
  row(177, 'verifying', 'scrapers/common/tests/test_jurash_sold_pin_evidence.py -- 4 tests, mutation-proven', 'routine-11-lifecycle'),
];
const m1 = citationProblems(PRODUCTION_PHANTOMS, nonePresent);
mustCatch('the four phantom citations measured in production on 2026-09-13 (#37, #55, #74, #177)',
  m1.length === 4 && [37, 55, 74, 177].every((id) => m1.some((p) => p.includes(`#${id}`))));

// M2 — the single-incident form: a RESOLVED finding citing a barrier nobody wrote.
mustCatch('a resolved incident citing a barrier file that does not exist',
  citationProblems([row(1, 'resolved', 'scripts/verify-nothing-wrote-this.ts')], nonePresent).length === 1);

// M3 — the FAILED-FETCH rule. An unreadable table must be UNKNOWN, never a clean bill of health.
mustCatch('an UNREADABLE incident table reported as "no phantom citations found"',
  citationProblems(null, allPresent).length > 0);

// M4 — the friendly-looking failure: RLS answers 200 with []. Indistinguishable from a clean queue.
mustCatch('an RLS-emptied 200 ([] rows) read as a clean queue',
  citationProblems([], allPresent).length > 0);

// M5 — an existence test that cannot answer must be UNKNOWN, not silently absent and not present.
mustCatch('an existence question that could not be ANSWERED being resolved to true or false',
  citationProblems([row(1, 'resolved', 'scripts/verify-x.ts')], () => null)
    .some((p) => p.includes('COULD NOT BE DETERMINED')));

// M6 — the database-function limb, which a file-only reader would miss entirely.
mustCatch('a resolved incident citing a mon_detect_* function that is not in the catalog',
  citationProblems([row(1, 'resolved', 'mon_detect_a_thing_nobody_defined')], nonePresent).length === 1);

// M7 — the bare-name limb (#179's shape). Without it, twelve citations were unreadable.
mustCatch('a bare-named phantom barrier (incident #179\'s citation shape)',
  citationProblems([row(1, 'resolved', 'the barriers converted in PR #1 (verify-a-phantom.ts)')],
    nonePresent).length === 1);

// ── 4. NEGATIVE CONTROLS — the predicate is not vacuously red, and it DISTINGUISHES the cases ───
// A barrier that is red for everything is as useless as one that is green for everything.
check('a healthy world is NOT flagged (the predicate is not vacuous)',
  citationProblems(PRODUCTION_PHANTOMS, allPresent).length === 0);

// The distinguish-the-cases control. An 'open' or 'investigating' row's citation is a PLAN — the
// normal way an incident is worked — and flagging it would be crying wolf, which is how a check
// gets weakened later to shut it up (BARRIER_ENGINEER.md PART 6, Prohibition 1).
check('an OPEN incident citing a not-yet-written barrier is NOT flagged (a plan is not a claim)',
  citationProblems([row(1, 'open', 'scripts/verify-i-am-about-to-write-this.ts')], nonePresent).length === 0);
check('an INVESTIGATING incident citing a not-yet-written barrier is NOT flagged',
  citationProblems([row(1, 'investigating', 'scripts/verify-planned.ts')], nonePresent).length === 0);

// ...but every state that CLAIMS cover is judged. If a future migration adds a claimed state and
// nobody adds it here, that state's citations go unchecked silently — so pin the set itself.
check('every claimed state is judged (fixed, verifying, resolved)',
  CLAIMED_STATES.length === 3 && CLAIMED_STATES.every((s) =>
    citationProblems([row(1, s, 'scripts/verify-phantom.ts')], nonePresent).length === 1));

check('a row citing nothing at all is not invented into a problem',
  citationProblems([row(1, 'resolved', null)], nonePresent).length === 0);

console.log(failed === 0
  ? '\n✅ citation predicate proven in both directions\n'
  : `\n❌ ${failed} failure(s)\n`);
process.exit(failed === 0 ? 0 : 1);
