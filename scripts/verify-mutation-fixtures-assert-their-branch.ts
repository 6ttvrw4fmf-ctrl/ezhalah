// A MUTATION THAT ASSERTS ONLY «SOMETHING WAS SAID» CANNOT SEE WHAT IT CLAIMS TO COVER.
//
// Earned by ops_incident #314 (routed here by routine #9, 2026-09-18) and by the defect it was
// extracted from, ops_incident #299.
//
// THE SHAPE. A barrier's mutation block builds a fixture by spreading a HEALTHY/BASE fixture and
// overriding one field, then asserts only `problems.length > 0`. That proves the predicate is not
// SILENT. It does not — and cannot — prove the predicate said the thing the mutation's own label
// claims, because the non-emptiness may be produced by a completely different branch, or inherited
// from the base fixture. So it passes for the entire life of a defect on the branch it names, and it
// is indistinguishable from real cover when you read the check's output.
//
// THE WORKED INSTANCE (#299, PR #3087). verify-undeployed-user-visible-drift.ts covered the
// UNDETERMINED corroboration case with two mutations, both `{ ...HEALTHY, lastDeploySha: null }` /
// `baselineIsBehindLastDeploy: null` asserting `.length > 0`. HEALTHY has NO user-visible drift, so
// the accusation branch never ran, so neither mutation could observe that `null` was being collapsed
// into `false` and producing a flat «MERGED AND NOT SHIPPED». Measured live: 11 commits named, 10 of
// them provably served. Its SIBLING branch — the `=== true` case — did carry a content assertion,
// and that asymmetry between two branches of one guard is the cheap tell.
//
// THE RULE THIS ENFORCES, therefore, is the asymmetry and not the bare count. A bare count is
// perfectly correct where the CONDITION itself is what is being detected (a refusal list becoming
// non-empty, a fail-closed UNKNOWN raising anything at all). It is only suspicious when a SIBLING
// assertion over the SAME predicate already demonstrates that this guard's output carries nameable
// content — because then the weak sibling could have said what it meant and did not.
//
// Runs offline and hermetically: it reads the repo's own barriers and executes its own predicate.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nMutation fixtures must assert the branch they name\n');

// ── THE PREDICATE, pure, so the proofs below can feed it synthetic barriers. ─────────────────────

type Assertion = {
  label: string;
  /** the predicate function this assertion invokes, e.g. `undeployedDriftProblems` */
  predicate: string;
  /** asserts only that the result is non-empty */
  bareCount: boolean;
  /** asserts something about the CONTENT of the result */
  content: boolean;
  /** the fixture is a spread of an ALL-CAPS base with fields overridden */
  spreadsABase: boolean;
};

/** Every `mustCatch(...)` / `check(...)` call in a barrier, with its shape. */
export function assertionsIn(src: string): Assertion[] {
  const out: Assertion[] = [];
  const calls = src.matchAll(/\b(?:mustCatch|check)\(\s*('[^']*'|"[^"]*"|`[^`]*`)([\s\S]{0,500}?)\);\n/g);
  for (const c of calls) {
    const body = c[2];
    // The first call inside the assertion body is the predicate under test.
    const predicate = (/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(body) ?? [])[1];
    if (!predicate) continue;
    out.push({
      label: c[1].slice(1, -1),
      predicate,
      bareCount: /\.length\s*>\s*0|\.length\s*>=\s*1|\.some\(Boolean\)/.test(body),
      // `.some(p => p.includes(…))`, `.some(p => /…/.test(p))`, `.join(' ').includes(…)`,
      // or a direct equality against an expected message.
      content: /\.some\(\s*\(?[\w$]+\)?\s*=>\s*[\w$]+\.includes\(/.test(body)
        || /\.some\(\s*\(?[\w$]+\)?\s*=>\s*\/[^/]+\/[gimsuy]*\.test\(/.test(body)
        || /\.join\([^)]*\)\.includes\(/.test(body)
        || /\.some\(\s*\(?[\w$]+\)?\s*=>\s*\/[^/]+\/[gimsuy]*\.test\([\w$.]+\)\s*\)/.test(body),
      spreadsABase: /\.\.\.\s*[A-Z][A-Z0-9_]*\b/.test(body),
    });
  }
  return out;
}

/**
 * The finding: an assertion that proves only NON-SILENCE, over a fixture spread from a base, for a
 * predicate whose output a SIBLING assertion already reads by content.
 *
 * Returns `"<predicate> :: <label>"` per weak sibling, so a report names the exact line to repair.
 */
export function weakSiblings(src: string): string[] {
  const byPredicate = new Map<string, Assertion[]>();
  for (const a of assertionsIn(src)) {
    if (!byPredicate.has(a.predicate)) byPredicate.set(a.predicate, []);
    byPredicate.get(a.predicate)!.push(a);
  }
  const out: string[] = [];
  for (const [predicate, list] of byPredicate) {
    if (!list.some((a) => a.content)) continue;      // no sibling reads content — nothing to compare
    for (const a of list) {
      if (a.bareCount && !a.content && a.spreadsABase) out.push(`${predicate} :: ${a.label}`);
    }
  }
  return out.sort();
}

// ── THE SWEEP, executed over every barrier in the tree. ──────────────────────────────────────────

/**
 * ACCEPTED WEAK SIBLINGS — a SHRINK-ONLY baseline, exactly as `mutation-proof-grandfathered.txt` is.
 *
 * Each entry is a bare-count mutation that sits beside a content-asserting sibling and has been
 * READ. They are parked, not blessed: every one is a FAIL-CLOSED branch where the condition being
 * detected really is "this unreadable/absent input must raise SOMETHING", which is the case
 * ops_incident #314 explicitly exempts. `verify-undeployed-user-visible-drift.ts` is #299's own
 * file, and its accusation branch now carries the positive assertion the incident added.
 *
 * Do not add to this list to make a red run green — that is PART 6, Prohibition 1 wearing a
 * ratchet's syntax. Repair the assertion to name what it means instead.
 */
const ACCEPTED = new Set<string>([
  'verify-undeployed-user-visible-drift.ts',
]);
const ACCEPTED_CEILING = 1;   // shrink-only: lower it as files leave, never raise it.

const barriers = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => /^verify-.*\.(ts|mjs)$/.test(f) && f !== 'verify-mutation-fixtures-assert-their-branch.ts')
  .sort();

const offenders: string[] = [];
let scanned = 0;
let accountedFor = 0;
for (const f of barriers) {
  const weak = weakSiblings(stripComments(readFileSync(join(ROOT, 'scripts', f), 'utf8')));
  scanned++;
  if (!weak.length) continue;
  if (ACCEPTED.has(f)) { accountedFor++; continue; }
  offenders.push(`${f}\n        ${weak.join('\n        ')}`);
}

check(`no barrier proves only non-silence where a sibling proves content (${scanned} barriers scanned)`,
  offenders.length === 0,
  `these assert «something was said» over a spread fixture, beside a sibling that reads the message:\n      `
  + `${offenders.join('\n      ')}\n      `
  + 'Assert what the branch SAYS, not that the list is non-empty — otherwise the check passes for the '
  + 'whole life of a defect on that branch (ops_incident #299 / #314).');

// The sweep must actually find the population; an empty scan would make the check above vacuous.
check(`the sweep really read the barrier population (${scanned} files)`,
  scanned >= 300, `only ${scanned} barrier(s) scanned — the discovery has narrowed`);

// A baseline entry that no longer applies is STALE, and a stale ratchet reads better than reality.
check(`every accepted entry still has a weak sibling (${accountedFor} of ${ACCEPTED.size} in use)`,
  accountedFor === ACCEPTED.size,
  'an ACCEPTED file no longer carries the shape — delete its entry and lower ACCEPTED_CEILING');
check('the accepted list has not grown', ACCEPTED.size <= ACCEPTED_CEILING,
  `${ACCEPTED.size} accepted vs ceiling ${ACCEPTED_CEILING}`);

// ── MUTATION PROOFS — the predicate executed against synthetic barriers, both directions. ────────
console.log('\n  mutation proofs:');
let run = 0; let killed = 0;
const mustCatch = (label: string, caught: boolean) => {
  run++;
  if (caught) { killed++; console.log(`    ✓ killed: ${label}`); return; }
  failed++; console.log(`    ✗ SURVIVED: ${label}`);
};

// THE DEFECT AS IT SHIPPED (#299): the `=== true` branch reads content, the `null` branch does not.
const THE_INCIDENT = `
check('…and the failure NAMES the unserved commits', p(REAL).some((x) => x.includes('NOT SHIPPED')));
mustCatch('an UNDETERMINED corroboration read as «current»', p({ ...HEALTHY, behind: null }).length > 0);
`;
mustCatch('#299 as it shipped: a null-branch bare count beside a content-asserting sibling',
  weakSiblings(THE_INCIDENT).length === 1);
mustCatch('…and it names the predicate AND the label, so the report points at a line',
  weakSiblings(THE_INCIDENT)[0] === 'p :: an UNDETERMINED corroboration read as «current»');

// NEGATIVE CONTROLS. A rule that flags these would be switched off inside a week.
mustCatch('a bare count with NO content-asserting sibling is NOT flagged (the condition IS the detection)',
  weakSiblings(`
mustCatch('a refused translation', q({ ...BASE, p_deal: undefined }).unhandled.length > 0);
mustCatch('another refused translation', q({ ...BASE, p_beds: 2 }).unhandled.length > 0);
`).length === 0);
mustCatch('the REPAIRED form — the same mutation asserting the message — is NOT flagged',
  weakSiblings(`
check('…names the commits', p(REAL).some((x) => x.includes('NOT SHIPPED')));
mustCatch('an UNDETERMINED corroboration', p({ ...HEALTHY, behind: null }).some((x) => x.includes('UNKNOWN')));
`).length === 0);
mustCatch('a bare count over a fixture that is NOT a spread of a base is NOT flagged',
  weakSiblings(`
check('names it', p(REAL).some((x) => x.includes('NOT SHIPPED')));
mustCatch('a literal fixture', p({ behind: null }).length > 0);
`).length === 0);
mustCatch('two DIFFERENT predicates are not treated as siblings of one guard',
  weakSiblings(`
check('names it', alpha(REAL).some((x) => x.includes('NOT SHIPPED')));
mustCatch('a bare count on a different guard', beta({ ...HEALTHY, behind: null }).length > 0);
`).length === 0);
// The reader must strip comments: a weak assertion quoted in prose is documentation, not a check.
mustCatch('a weak assertion quoted inside a comment is NOT counted as one',
  weakSiblings(stripComments(`
check('names it', p(REAL).some((x) => x.includes('NOT SHIPPED')));
// mustCatch('an UNDETERMINED corroboration', p({ ...HEALTHY, behind: null }).length > 0);
`)).length === 0);
// …and the sweep is not vacuously green: the real tree DOES still contain the shape, parked.
mustCatch('the real tree still carries the shape somewhere (the sweep is not vacuously clean)',
  accountedFor > 0);

console.log(failed === 0
  ? `\n✅ every mutation fixture asserts its own branch — ${scanned} barriers, ${killed}/${run} mutants killed.\n`
  : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
