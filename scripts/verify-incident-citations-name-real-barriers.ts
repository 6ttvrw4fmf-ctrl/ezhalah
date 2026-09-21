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
  citedArtifacts, citationProblems, CLAIMED_STATES, treeMentionTest,
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

// ── THE EXTRACTOR MUST NOT INVENT A PHANTOM (repaired 2026-09-20, routine #10) ───────────────────
// A guard that cries wolf is not a stricter guard. Two extractor bugs reported CORRECT citations as
// phantoms, kept incident-citation-guard.yml red, and left a P1 `barrier_check_failed` alert open
// and unacknowledged from 2026-09-14 to 2026-09-20 — six days in which the workflow's red said
// nothing a reader could act on, and during which two GENUINE phantoms (#140, #55) sat in the same
// list unnoticed. Both directions are proven: the false positives are gone AND the real shapes are
// still found. Fed the verbatim production citations, not strings invented for the test.
const ARTEFACTS = (s: string) => citedArtifacts(s).map((a) => `${a.kind}:${a.name}`);

check('a .tsx citation survives intact — ordered alternation put `ts` first and truncated it, '
  + 'inventing src/app/agent.ts (incident #260, whose citation was right all along)',
  ARTEFACTS("render conditions in src/app/agent.tsx (load-more iff hasMore)")
    .join() === 'path:src/app/agent.tsx');
check('…and a real .ts citation is still extracted (the repair is not a silencer)',
  ARTEFACTS('scripts/verify-x.ts and src/data/remote.ts').join()
    === 'path:scripts/verify-x.ts,path:src/data/remote.ts');
check('a `mon_detect_*` GLOB is prose, not a claim that a function named `mon_detect_` exists '
  + '(incident #335, likewise correct all along)',
  ARTEFACTS('the standing migration-drift-guard.yml + mon_detect_* continue watching this class')
    .length === 0);
check('…nor is a bare trailing-underscore prefix',
  ARTEFACTS('covered by mon_detect_ and friends').length === 0);
check('…while a fully spelled detector is still extracted (the direction that must keep working)',
  ARTEFACTS('covered by mon_detect_price_fidelity() on the twice-hourly roster').join()
    === 'fn:mon_detect_price_fidelity');

mustCatch('a phantom .tsx file — the repair widened the alphabet, never the verdict',
  citationProblems([row(1, 'resolved', 'src/app/nope.tsx')], nonePresent).length === 1);
mustCatch('the two GENUINE phantoms this repair must keep catching (#140 stale rename, #55 never '
  + 'landed on main)',
  citationProblems([row(140, 'resolved', 'scripts/verify-af-terminal-at-50-no-load-more.ts'),
                    row(55, 'resolved', 'scripts/verify-search-index-single-writer.ts')],
                   nonePresent).length === 2);

// ── THE FOURTH SHAPE: A BARRIER CITED AS SOMETHING OTHER THAN `mon_*` (incident #364) ───────────
// Until 2026-09-21 `DBFN` recognised `mon_*` and nothing else, so a barrier cited as any other
// database object yielded NO artefact and was neither verified nor flagged — the check read as
// covering citations it had never looked at. The previous version of this file asserted that gap as
// a passing check (`…length === 0`), which is BARRIER_ENGINEER.md PART 1.2 in miniature: a
// predicate that would pass on a version of the code that has the bug, because it WAS the bug.
//
// The rejected repair — "any identifier followed by ()" — manufactures phantoms out of camelCase
// prose. Snake_case is the shape that distinguishes, and the widening was MEASURED against the real
// queue before it was written: 85 distinct tokens over the 193 claimed-state citations live on
// 2026-09-21, all 85 resolving. Every fixture below is a VERBATIM production citation.

// #324 — a constraint function and a table, the two shapes that were completely invisible.
check('a non-mon database object IS extracted now (incident #324, verbatim)',
  ARTEFACTS('enforce_price_size_sanity() + ops_price_source_verified (existing barrier); '
    + 'verified against production').join()
    === 'symbol:enforce_price_size_sanity,symbol:ops_price_source_verified');

// #134 — a TRIGGER cited as the barrier, plus the table it writes to.
check('a trigger citation IS extracted now (incident #134, verbatim)',
  ARTEFACTS('tg_archive_hard_deleted_listing propagates to listings_arabic_locations '
    + '(migration 20260911141903)').join()
    === 'symbol:tg_archive_hard_deleted_listing,symbol:listings_arabic_locations');

// #233 — a pytest FUNCTION inside a file: the file is the path, the function is the symbol, and
// neither swallows the other. Asserted as a set; extraction order is not part of the contract.
const py = ARTEFACTS('scrapers/common/tests/test_retire_superseded_siblings.py (shape discovery) '
  + 'and mon_detect_res_com_collision_repair_regression() (reads retired_side)');
check('a path, a mon_ function and a bare symbol coexist without swallowing each other (#233)',
  py.length === 3
  && py.includes('path:scrapers/common/tests/test_retire_superseded_siblings.py')
  && py.includes('fn:mon_detect_res_com_collision_repair_regression')
  && py.includes('symbol:retired_side'));

// THE CRYING-WOLF CONTROLS. A guard people learn to scroll past is a guard that gets deleted; these
// are the shapes the rejected "any identifier" repair would have invented phantoms out of.
check('camelCase prose written with parens is NOT a claim (the rejected repair\'s false positive)',
  ARTEFACTS('citedArtifacts() returns the artefacts and probeVerdict() reads them').length === 0);
check('ordinary English prose yields no symbol',
  ARTEFACTS('verified against production; the fix is green and nothing was loosened').length === 0);
check('a `mon_detect_*` glob is STILL prose under the widened reader (incident #335 stays fixed)',
  ARTEFACTS('the standing migration-drift-guard.yml + mon_detect_* continue watching').length === 0);
check('`mon_` names stay in DBFN\'s lane and are NOT downgraded to the weaker symbol test',
  ARTEFACTS('mon_unverified_inactivation_counts(interval) + mon_detect_unverified_inactivation()')
    .every((a) => a.startsWith('fn:')));
check('a bare filename is not ALSO read as a symbol (test_x.py yields one artefact, not two)',
  ARTEFACTS('mutation-proven in test_sold_pin_records_evidence.py').join()
    === 'bare:test_sold_pin_records_evidence.py');

// M8 — the defect itself: a closed incident whose cited barrier is a database object nobody built.
mustCatch('a resolved incident citing a TRIGGER that does not exist (the #364 hole)',
  citationProblems([row(1, 'resolved', 'tg_nobody_ever_created_this')], nonePresent).length === 1);
mustCatch('…and a constraint-function citation that names nothing',
  citationProblems([row(1, 'resolved', 'enforce_a_rule_nobody_wrote()')], nonePresent).length === 1);

// M9 — the symbol limb obeys the same UNKNOWN rule as every other limb. An unlistable tree must
// never resolve to "absent" (a false phantom) OR to "present" (the hole re-opened).
mustCatch('a symbol whose existence could not be DETERMINED being resolved either way',
  citationProblems([row(1, 'resolved', 'tg_some_trigger')], () => null)
    .some((p) => p.includes('COULD NOT BE DETERMINED')));

// NEGATIVE CONTROL, on the REAL tree rather than a stub: every symbol the production queue actually
// cites resolves. This is the measurement that authorised the widening, executed rather than quoted
// — if the reader ever starts inventing names out of these citations, this line goes red first.
const REAL_CITATIONS = [
  'enforce_price_size_sanity() + ops_price_source_verified (existing barrier)',
  'tg_archive_hard_deleted_listing propagates to listings_arabic_locations; snapshotted to '
    + 'ops_orphan_location_repair; requires a cleanup_deletion_log row',
  'mon_detect_res_com_collision_repair_regression() (reads retired_side, every platform)',
  'a new P2 deduplicated_copy_flood fires if de-duplication ever dominates a day',
  'reads evidence_fetched_at and row_captured_at; alert kind barrier_check_failed on alert_event',
];
const mention = treeMentionTest(ROOT);
const unresolved = REAL_CITATIONS.flatMap((c) => citedArtifacts(c))
  .filter((a) => a.kind === 'symbol' && mention(a.name) !== true)
  .map((a) => a.name);
check(`every symbol in the real production citations resolves against this checkout `
  + `(${REAL_CITATIONS.flatMap((c) => citedArtifacts(c)).filter((a) => a.kind === 'symbol').length} symbols)`,
  unresolved.length === 0, `unresolved: ${unresolved.join(', ')}`);

// …and the same test says NO to a name nothing mentions, so the control above is not vacuous.
// ASSEMBLED AT RUNTIME, and that is load-bearing rather than cute: `git grep` reads the WORKING
// TREE, so a literal spelled out here would be found in this very file and the control would pass
// by describing itself. It did, on the first run of this check — the self-reference is the same
// shape as a barrier asserting the bug, caught by its own negative control.
const INVENTED = ['tg', 'no', 'such', 'object', 'exists', 'anywhere', '404'].join('_');
check('treeMentionTest is not vacuously true — an invented name resolves to false',
  mention(INVENTED) === false);

console.log(failed === 0
  ? '\n✅ citation predicate proven in both directions\n'
  : `\n❌ ${failed} failure(s)\n`);
process.exit(failed === 0 ? 0 : 1);
