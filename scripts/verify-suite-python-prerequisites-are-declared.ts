// THE SUITE'S PYTHON PREREQUISITE IS MEASURED HERE, NOT COUNTED BY HAND IN A COMMENT.
//
// THE DEFECT, MEASURED 2026-09-25 (routine #10). `.github/workflows/full-verification-ci.yml`
// installs scrapers/requirements.txt before `npm test`, and its own comment justified the step with
// a hand-typed census: "Three guards in `npm test` shell out to the real scraper modules —
// verify-sanadak-rsc-object-match, verify-no-derived-price and verify-scraper-type-tokens-mapped".
// Measured against the run set the same day: **30** checks shell out to python, and two of the three
// it named are not even among the ones that fail without the install. The count had been stale for
// long enough that nobody could say when it stopped being true, because nothing measured it.
//
// WHY A STALE COUNT IN A COMMENT IS A BARRIER DEFECT AND NOT A TYPO. It is the PART 1.11 shape from
// docs/ops/BARRIER_ENGINEER.md — a pointer reads as coverage — and it produced a real
// misattribution the same day. A container missing the requirements ran the suite and got 16 reds;
// they were written up, in a PR body merged to main, as "all 16 in scrapers and liveness scripts the
// agent egress cannot reach (403 at the proxy)". They were nothing of the kind. Re-measured on the
// same commit after a single `pip install -r scrapers/requirements.txt`, **all 16 exit 0**. AGENTS.md
// already states the general rule — *an "EGRESS BLOCKED" note is a fact about the container that
// wrote it* — and here the note was weaker still: a fact about a missing pip install, reported as a
// fact about the network. The next session to read that line would have believed sixteen barriers
// cannot run in an agent container and stopped looking.
//
// THE REPAIR IS TO DELETE THE NUMBER, NOT TO CORRECT IT. Writing "sixteen" or "thirty" into the
// workflow only resets the clock on the same defect. So this check MEASURES the set, PRINTS it, and
// forbids any suite-running workflow from claiming a census of its own in prose. The workflow points
// here instead.
//
//   node --experimental-strip-types scripts/verify-suite-python-prerequisites-are-declared.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const REQUIREMENTS = 'scrapers/requirements.txt';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, problems: string[]) =>
  check(`(mutation) catches ${label}`, problems.length > 0, 'the audit passed deliberately broken input');

// ── 1. WHICH CHECKS NEED THE SCRAPERS' PYTHON ENVIRONMENT ───────────────────────────────────────
// Three spellings, because the tree uses three: a `python3` child, a `scrapers.<pkg>` module path
// handed to `-c`, and a `scrapers/**/*.py` file path.
//
// READ ON RAW SOURCE, DELIBERATELY, AND THE RESULT IS AN UPPER BOUND. The obvious move is to strip
// comments first so a check that merely DISCUSSES the scrapers is not counted. Measured here, that
// is the wrong way round: scripts/lib/stripComments.ts is string-unaware and says so, and on
// verify-every-platform-is-liveness-checked.ts a `/*` inside a glob it prints swallowed the two
// lines carrying `scrapers.common.db` and `scrapers/common/db.py` — so the one check MEASURED to
// need the install disappeared from discovery. Over-stripping is fail-CLOSED for an assertion about
// product source and fail-OPEN here, where losing a line loses a requirement.
//
// So this counts anything that NAMES the environment. The cost is an inflated number; the benefit is
// that the number can only ever be too high, and being too high makes this barrier insist on an
// install step that is already there. The number that is exact is the MEASURED floor below.
const NEEDS_PYTHON = /\bpython3?\b|\bscrapers\.[a-z_]+|scrapers\/[\w/-]+\.py/;

export function pythonDependentChecks(runSet: string[], read: (p: string) => string): string[] {
  return runSet.filter((f) => {
    try { return NEEDS_PYTHON.test(read(`scripts/${f}`)); } catch { return true; } // unreadable ⇒ assume it needs it
  }).sort();
}

// ── 2. A WORKFLOW THAT RUNS THE WHOLE SUITE MUST INSTALL THE REQUIREMENTS ───────────────────────
const RUNS_WHOLE_SUITE = /^\s+run:\s*(?:npm test|npm run test(?::all)?)\s*$|^\s+run:.*run-tests\.mjs/m;
const INSTALLS = /pip\s+install\s+(?:[^\n]*\s)?-r\s+scrapers\/requirements\.txt/;

/** A prose census of the python-dependent guards. A number here is the defect: it is maintained by
 *  hand, it goes stale silently, and a reader trusts it. Both word and digit forms, because the one
 *  that actually went stale was spelled "Three". */
const CENSUS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,3})\s+(?:guards?|checks?|barriers?|scripts?)\b\s+in\s+`?npm test`?/i;

export function workflowProblems(name: string, yaml: string): string[] {
  const bad: string[] = [];
  if (!RUNS_WHOLE_SUITE.test(yaml)) return bad;
  if (!INSTALLS.test(yaml))
    bad.push(`${name} runs the WHOLE suite but never installs ${REQUIREMENTS} — the python-dependent checks will die on import, and a red with no reason gets attributed to the network`);
  const census = CENSUS.exec(yaml);
  if (census)
    bad.push(`${name} claims a hand-typed census «${census[0].trim()}» of the python-dependent checks. Delete the number: it is measured by scripts/verify-suite-python-prerequisites-are-declared.ts, which prints it on every run, and a count in prose is the PART 1.11 defect that made 16 reds read as an egress block on 2026-09-25`);
  return bad;
}

// ── 3. THE MEASURED FLOOR ───────────────────────────────────────────────────────────────────────
// Every file here was WATCHED to flip from exit 1 to exit 0 on 2026-09-25 by nothing other than
// `pip install -r scrapers/requirements.txt` in this container, on commit 070b9fd. Discovery must
// keep finding all of them: a regex that narrows tomorrow and silently stops covering a check is the
// failure mode this floor exists for. It is a FLOOR and not a list — new python-dependent checks
// need no edit here.
export const MEASURED_NEEDS_PYTHON = [
  'verify-abeea-identity-supersession.ts',
  'verify-absence-oracles-are-measured.ts',
  'verify-aqarcity-daily-rate-is-not-a-monthly-rent.ts',
  'verify-aqargate-absence-cannot-deactivate.ts',
  'verify-aqarmonthly-coverage-beats-row-floor.ts',
  'verify-cleanup-run-death-leaves-a-record.ts',
  'verify-eastabha-per-metre-rate-is-not-the-total.ts',
  'verify-every-platform-is-liveness-checked.ts',
  'verify-ialqarawi-index-failure-names-its-cause.ts',
  'verify-raghdan-absence-cannot-deactivate.ts',
  'verify-sanadak-absence-cannot-deactivate.ts',
  'verify-sanadak-building-age-mapped.ts',
  'verify-sold-pin-evidence-law.ts',
  'verify-supersession-kill-leaves-evidence.ts',
  'verify-wasalt-kills-are-auditable-fleet-wide.ts',
  'verify-wasalt-placeholder-is-not-a-published-price.ts',
];

export function floorProblems(discovered: string[]): string[] {
  const have = new Set(discovered);
  return MEASURED_NEEDS_PYTHON
    .filter((f) => !have.has(f))
    .map((f) => `${f} was MEASURED to need ${REQUIREMENTS} (it flipped exit 1 → exit 0 on that install alone, 2026-09-25) and discovery no longer finds it — the reader has narrowed`);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
const readRepo = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const { run } = loadRegistry(ROOT);
const discovered = pythonDependentChecks(run, readRepo);

console.log(`\n  checks in the run set: ${run.length} · naming the scrapers' python environment: ${discovered.length}`
  + ` (an UPPER BOUND — see the header) · MEASURED to need it: ${MEASURED_NEEDS_PYTHON.length}`);
console.log('  (read the numbers this line PRINTS — never one written into a comment, which is the defect this file exists for)');

check('the discovered set is not empty (a reader that finds nothing is not a measurement)',
  discovered.length > 0);
const floor = floorProblems(discovered);
check('every check MEASURED to need the requirements is still discovered', floor.length === 0,
  `\n      ${floor.join('\n      ')}`);

const yamls = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();
const suiteRunners = yamls.filter((f) => RUNS_WHOLE_SUITE.test(readRepo(`.github/workflows/${f}`)));
check('exactly one workflow runs the whole required suite, and it is found',
  suiteRunners.length >= 1, `found ${suiteRunners.length}`);
console.log(`  suite-running workflow(s): ${suiteRunners.join(', ') || '(none)'}`);

const live = yamls.flatMap((f) => workflowProblems(f, readRepo(`.github/workflows/${f}`)));
check('every workflow that runs the whole suite installs the requirements, and none claims a census',
  live.length === 0, `\n      ${live.join('\n      ')}`);

check('npm test discovers and runs this check',
  npmTestRuns(ROOT, 'verify-suite-python-prerequisites-are-declared'), 'not in the resolved run set');

// ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proofs (each must turn the rule RED):');
const CI = 'full-verification-ci.yml';
const ciYaml = readRepo(`.github/workflows/${CI}`);

{
  const stripped = ciYaml.replace(/^\s*run: pip install .*scrapers\/requirements\.txt\s*$/m, '        run: echo skip');
  check('M1 applied', stripped !== ciYaml, 'pattern drifted — fix the mutant, not the rule');
  mustCatch('the suite workflow dropping the requirements install — the 16 reds nobody could explain',
    workflowProblems(CI, stripped));
}
{
  // THE DEFECT ITSELF, restored verbatim from the comment that was live this morning.
  const withCensus = ciYaml.replace('      - name: Install scraper Python deps\n',
    '      - name: Install scraper Python deps\n'
    + '        # Three guards in `npm test` shell out to the real scraper modules.\n');
  check('M2 applied', withCensus !== ciYaml, 'pattern drifted — fix the mutant, not the rule');
  mustCatch('a hand-typed census of the python-dependent guards reappearing in the workflow',
    workflowProblems(CI, withCensus));
  mustCatch('the same census written in digits rather than words',
    workflowProblems(CI, ciYaml.replace('      - name: Install scraper Python deps\n',
      '      - name: Install scraper Python deps\n        # 3 checks in npm test shell out to python.\n')));
}
{
  // Discovery blinded: a reader that finds nothing must fail on the floor, never read as "no check
  // needs python, so the install step is unnecessary".
  mustCatch('discovery blinded so it finds nothing (fail CLOSED, never "nothing needs it")',
    floorProblems([]));
  mustCatch('discovery narrowed so it loses one MEASURED check',
    floorProblems(discovered.filter((f) => f !== MEASURED_NEEDS_PYTHON[0])));
}
{
  // An unreadable check is UNKNOWN, and UNKNOWN here means "assume it needs python" — the safe
  // direction, because the consequence of a wrong guess is an install step that was already there.
  const reader = (p: string) => { if (p.endsWith(MEASURED_NEEDS_PYTHON[0])) throw new Error('ENOENT'); return readRepo(p); };
  check('an unreadable check is still counted as needing python (UNKNOWN never removes a requirement)',
    pythonDependentChecks(run, reader).includes(MEASURED_NEEDS_PYTHON[0]));
}

// ── NEGATIVE CONTROLS ───────────────────────────────────────────────────────────────────────────
console.log('\n  negative controls (the shipped tree must NOT be flagged):');
check('the CI workflow as it stands is clean', workflowProblems(CI, ciYaml).length === 0,
  workflowProblems(CI, ciYaml).join(' | '));
check('a workflow that does NOT run the whole suite is not asked to install anything',
  workflowProblems('some-live-check.yml', 'jobs:\n  x:\n    steps:\n      - run: node scripts/verify-one-thing.ts\n').length === 0);
check('the floor as it actually stands is satisfied (not vacuously red)', floorProblems(discovered).length === 0);

console.log(failures === 0
  ? `\n✅ the suite's python prerequisite is installed where the suite runs, and its size is measured (${discovered.length}) rather than typed\n`
  : `\n❌ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
