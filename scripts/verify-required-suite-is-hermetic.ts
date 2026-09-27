// THE REQUIRED SUITE'S VERDICT MUST DEPEND ONLY ON THE DIFF.
// Routine #10, ops_incident #104, 2026-09-06.
//
// THE MEASURED DEFECT. `npm test` is the REQUIRED status check on every PR. On 2026-09-06 four
// checks inside it were observed flipping on UNCHANGED code:
//   • verify-af-attribute-views-cover-every-platform.ts — RED, then GREEN on an immediate re-run,
//     then RED again on ONE commit. Its failing assertion was literally «the coverage RPC could be
//     reached»; the RPC it calls measures 9,803 ms / 9,930 shared buffers for 40 rows, so it sits on
//     the statement-timeout boundary by construction. The privileged call returns all 40 rows — the
//     function is CORRECT, only its cost is the problem.
//   • verify-location-index-covers-every-searchable-platform.ts — same assertion, same window. The
//     RED was reproduced with the only changed file reverted to its origin/main version, so it was
//     provably independent of any diff under test.
//   • verify-image-coverage-ratchet.ts — main GREEN 03:00, PR RED 03:55 on the same tree, because
//     platform `amaall` went live in production in between.
//   • verify-card-photos-are-browser-renderable.ts — main GREEN 02:36, PR RED 02:43 on a superset of
//     that tree; main RED 02:12 on a chore(deploy) commit touching no code.
// Between them they blocked or delayed every merge attempted that day, across three PRs.
//
// WHY A RATCHET AND NOT A ONE-OFF FIX. ops_incident #81 found this mechanism, fixed the ONE check
// that raised it, and closed — and three more members of the class were still sitting in the
// required suite the next morning. Fixing the instance that raised the alert does not satisfy §G.9
// condition 2. So this barrier does not assert that any particular check is well-placed; it asserts
// that the SET of live-reaching checks in the required suite is DECLARED and can only shrink.
//
// WHAT IT IS NOT. It is emphatically NOT a rule that these checks are too strict. Every one of them
// fails CLOSED on an unreachable endpoint, which is exactly right and must stay (AGENTS.md: A FAILED
// FETCH IS NOT AN EMPTY ANSWER). The defect is PLACEMENT: a check that can only be answered by
// asking production belongs in a workflow that fires on its own, not in the gate on someone else's
// diff. Shrinking this list by weakening a check would be the prohibited act wearing this barrier's
// syntax.
//
// HOW IT DECIDES. scripts/lib/public-supabase.ts is the ONE canonical way a check obtains the live
// endpoint, so "does this check transitively import that module" is a computed property of the
// module graph — not a phrase grepped out of source text. That distinction is the whole point: the
// source-TEXT tripwire is the shape that made five barriers stay green for the entire life of the
// bugs they covered. Importing is not calling, so the graph finds CANDIDATES and
// scripts/live-reaching-required-checks.txt records each candidate's MEASURED verdict. An
// undeclared candidate fails this check, which is what stops the class growing.
//
// AND THE CANDIDATE SET ITSELF WAS A BLIND SPOT (routine #10, 2026-09-23, ops_incident #391's
// pattern turned on this file). The module-graph walk above decides WHO the predicate is applied to,
// and everything reaching production by another route was excluded before any assertion ran.
// Measured by planting the mutant: a four-line check in scripts/ doing a bare
// `await fetch('https://<project>.supabase.co/rest/v1/')` really reached production — HTTP 401 from
// the live endpoint — and this barrier exited 0, as did verify-test-registry-complete.ts and (once
// one mustCatch line was added) verify-new-barriers-are-mutation-proven.ts. So there is now a SECOND
// discovery arm, scripts/lib/liveReach.ts, asking whether a production host reaches a NETWORK CALL.
// Neither arm is exhaustive alone and neither is a grep: arm 1 is a computed property of the module
// graph, arm 2 is a quote-aware read of what is passed to fetch/execSync. Their residual gaps are
// stated in liveReach.ts rather than hidden.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { transitivelyReaches } from './lib/importGraph.ts';
import { reachersOutsideResolver, reachesProductionOutsideResolver } from './lib/liveReach.ts';

// The ratchet. Pinned in SOURCE so a name cannot be appended quietly — the same device
// GRANDFATHERED_CEILING uses in verify-new-barriers-are-mutation-proven.ts. Lower it as splits land;
// never raise it without saying why in the PR body.
// 2026-09-06: installed at 5. The class had SIX members when this barrier first ran — its own
// module-graph walk found verify-ui-controls-have-predicates.ts, which reaches the endpoint through a
// DYNAMIC `await import()` and so was invisible to the hand-written query that preceded it. Rather
// than install the ratchet at whatever number happened to exist, verify-guided-counts-carry-monthly-af.ts
// was split the same day (its own header already declared a hermetic A half and a live B half), taking
// the set 6 → 5. Lower it as further splits land; raising it needs a stated reason in the PR body.
// 2026-09-12 (routine #10, ops_incident #126): 5 → 4. verify-ui-controls-have-predicates.ts was split.
// It was not only in the wrong job: measured by execution with the endpoint blackholed, 14 of its
// assertions that read ONLY committed source never ran, because they sat inside the live registry
// fetch's `if` block — including the TEETH of the owner's 2026-08-11 boundary rule over
// src/lib/afPlan.ts. A production blip therefore took that guard dark while reporting itself as
// `TypeError: fetch failed`. The live read moved to verify-ui-controls-have-predicates-live.ts and
// both halves now share one mutation-proven predicate (scripts/lib/uiControlPredicates.ts).
const PRODUCTION_DEPENDENT_CEILING = 4;

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nThe required suite reaches production only where it is declared to, and that set can only shrink\n');

// ── parse the declaration file ──────────────────────────────────────────────────────────────────
type Verdict = 'production-dependent' | 'offline-safe';
const declared = new Map<string, Verdict>();
for (const raw of readFileSync(join(ROOT, 'scripts/live-reaching-required-checks.txt'), 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [name, verdict] = line.split('|').map((s) => s.trim());
  if (name && (verdict === 'production-dependent' || verdict === 'offline-safe')) {
    declared.set(name, verdict);
  }
}
check('the declaration file parsed to a non-empty set (a file nobody can read would pass forever)',
  declared.size > 0);

// ── find the candidates by module graph ─────────────────────────────────────────────────────────
const readFile = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const resolveFrom = (from: string, spec: string) => resolve(dirname(from), spec);
const isEndpointModule = (f: string) => /[\\/]lib[\\/]public-supabase\.ts$/.test(f);

const runSet = loadRegistry(ROOT).run;
const candidates = runSet.filter((name) =>
  transitivelyReaches(join(ROOT, 'scripts', name), isEndpointModule, readFile, resolveFrom));

check('the module-graph walk is not vacuous (it still finds the known live-reaching checks)',
  candidates.length > 0,
  'zero candidates found — if scripts/lib/public-supabase.ts moved or the import syntax changed, '
  + 'this barrier is reading an empty set and would pass forever');

// ── 1. NOTHING UNDECLARED. This is what stops the class growing. ────────────────────────────────
const undeclared = candidates.filter((c) => !declared.has(c));
check('every live-reaching check in the required suite is DECLARED with a measured verdict',
  undeclared.length === 0,
  undeclared.map((c) => `${c} — reaches scripts/lib/public-supabase.ts but is not in `
    + 'scripts/live-reaching-required-checks.txt. Measure it (the file gives the one command) and '
    + 'declare it — or better, SPLIT it: hermetic predicate stays here, live assertion moves to a '
    + 'workflow home. Do NOT weaken it to make this green.').join('\n      '));

// ── 2. THE RATCHET. production-dependent may only shrink. ───────────────────────────────────────
const productionDependent = [...declared].filter(([, v]) => v === 'production-dependent').map(([n]) => n);
const exceedsCeiling = (n: number) => n > PRODUCTION_DEPENDENT_CEILING;
check(`the production-dependent set has not grown (${productionDependent.length} <= ${PRODUCTION_DEPENDENT_CEILING})`,
  !exceedsCeiling(productionDependent.length),
  'a check whose verdict is decided by production is gating unrelated diffs. Split it rather than '
  + 'raising this ceiling; if the raise is genuinely intended, change PRODUCTION_DEPENDENT_CEILING '
  + 'in this file so the decision is reviewable.');

// ── 3. NO STALE DECLARATIONS. A name that no longer reaches must leave, or the list stops meaning
// what it says and the ratchet reads better than reality. ───────────────────────────────────────
const stale = [...declared.keys()].filter((n) => !candidates.includes(n));
check('no declared name has stopped being a candidate (stale rows must be deleted, not kept)',
  stale.length === 0,
  stale.map((n) => `${n} no longer reaches the live endpoint from the required suite — delete its `
    + 'row; a list that over-reports makes the ratchet look worse than it is and hides real growth').join('\n      '));

// ── 4. THE SECOND ARM. A check that reaches production WITHOUT the resolver is invisible to the
// module graph, and that exclusion is decided before any assertion above runs. Measured 2026-09-23:
// zero real offenders, and a planted one really reached the live endpoint while this file exited 0.
// This is deliberately NOT a declarable class: the repair is to route through the resolver (which
// makes it arm 1's business, declarable and ratcheted) or to move the check to a workflow. There is
// no row you can add to make a hardcoded production endpoint acceptable inside the required suite.
// ───────────────────────────────────────────────────────────────────────────────────────────────
const offResolver = reachersOutsideResolver(runSet, (name) => readFile(join(ROOT, 'scripts', name)));
check('no required check reaches a production host OUTSIDE the canonical resolver',
  offResolver.length === 0,
  offResolver.map((o) => `${o.name} — ${o.why}. A hardcoded endpoint is invisible to the module-graph `
    + 'walk above AND to the blackhole measurement scripts/live-reaching-required-checks.txt '
    + 'documents, so it can gate every unrelated PR on production\'s state with nothing watching. '
    + 'Route it through scripts/lib/public-supabase.ts, or move it to a workflow home declared in '
    + 'scripts/test-exclusions.txt. Do NOT add a row to make this green.').join('\n      '));

console.log(`\n  required run set: ${runSet.length} · live-reaching candidates: ${candidates.length} `
  + `· production-dependent: ${productionDependent.length} (ceiling ${PRODUCTION_DEPENDENT_CEILING}) `
  + `· off-resolver reachers: ${offResolver.length}\n`);

// ── MUTATION PROOF — every predicate above, against a world that must be caught ─────────────────
console.log('  mutation proof — the same predicates, against a suite that reaches production\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};

// A synthetic module graph, so the walk is exercised rather than described.
const GRAPH: Record<string, string> = {
  '/r/scripts/direct.ts': "import { resolvePublicSupabase } from './lib/public-supabase.ts';",
  '/r/scripts/indirect.ts': "import { helper } from './lib/helper.ts';",
  '/r/scripts/lib/helper.ts': "import { PUBLIC_SUPABASE_URL } from './public-supabase.ts';",
  '/r/scripts/deep.ts': "import { a } from './lib/a.ts';",
  '/r/scripts/lib/a.ts': "import { b } from './b.ts';",
  '/r/scripts/lib/b.ts': "import { helper } from './helper.ts';",
  '/r/scripts/clean.ts': "import { readFileSync } from 'node:fs';",
  '/r/scripts/dynamic.ts': "const m = await import('./lib/public-supabase.ts');",
  '/r/scripts/cycle.ts': "import { x } from './lib/c1.ts';",
  '/r/scripts/lib/c1.ts': "import { y } from './c2.ts';",
  '/r/scripts/lib/c2.ts': "import { x } from './c1.ts';",
  '/r/scripts/lib/public-supabase.ts': 'export const PUBLIC_SUPABASE_URL = "x";',
};
const gRead = (p: string) => GRAPH[p] ?? null;
const reaches = (entry: string) => transitivelyReaches(entry, isEndpointModule, gRead, resolveFrom);

mustCatch('a check that imports the live endpoint DIRECTLY', reaches('/r/scripts/direct.ts') === true);
mustCatch('a check that reaches it through ONE hop (the shape a grep for the import line misses)',
  reaches('/r/scripts/indirect.ts') === true);
mustCatch('a check that reaches it three modules deep', reaches('/r/scripts/deep.ts') === true);
mustCatch('a check that reaches it via a DYNAMIC import()', reaches('/r/scripts/dynamic.ts') === true);
// The negative controls — a rule red for everything is as useless as one green for everything.
mustCatch('a genuinely hermetic check is NOT flagged', reaches('/r/scripts/clean.ts') === false);
mustCatch('an import CYCLE terminates and is not flagged (no false positive, no hang)',
  reaches('/r/scripts/cycle.ts') === false);

// The three list predicates, against the states each exists to catch.
const declaredOf = (rows: [string, Verdict][]) => new Map(rows);
const undeclaredIn = (cands: string[], d: Map<string, Verdict>) => cands.filter((c) => !d.has(c));
const staleIn = (cands: string[], d: Map<string, Verdict>) => [...d.keys()].filter((n) => !cands.includes(n));

mustCatch('a NEW live-reaching check added to the required suite without declaring it',
  undeclaredIn(['brand-new.ts'], declaredOf([['old.ts', 'production-dependent']])).length > 0);
mustCatch('...and a fully declared set is NOT flagged',
  undeclaredIn(['old.ts'], declaredOf([['old.ts', 'production-dependent']])).length === 0);
mustCatch('the production-dependent set GROWING past its ceiling',
  exceedsCeiling(PRODUCTION_DEPENDENT_CEILING + 1));
mustCatch('...and the set SHRINKING is NOT a failure (this ratchet must welcome its own progress)',
  !exceedsCeiling(PRODUCTION_DEPENDENT_CEILING - 1));
mustCatch('a STALE row left behind after a check was split (the ratchet reading better than reality)',
  staleIn(['still-here.ts'], declaredOf([['still-here.ts', 'production-dependent'], ['already-split.ts', 'production-dependent']])).length > 0);
mustCatch('...and a list with no stale rows is NOT flagged',
  staleIn(['still-here.ts'], declaredOf([['still-here.ts', 'production-dependent']])).length === 0);

// ── ARM 2's proofs. The EXACT mutant that survived this barrier on 2026-09-23, plus the four real
// files in the tree that name a production host innocently. Both directions, and the negatives are
// read off DISK rather than invented here — a predicate proved only against strings its own author
// wrote proves something about the author's imagination. ─────────────────────────────────────────
const THE_SURVIVING_MUTANT = `
const r = await fetch('https://aannarbkwcymrotzwdbo.supabase.co/rest/v1/', { signal: AbortSignal.timeout(5000) });
console.log('reached production:', r.status);
`;
mustCatch('THE MUTANT THAT SURVIVED: a bare fetch() of a production host in the required suite',
  reachesProductionOutsideResolver(THE_SURVIVING_MUTANT) !== null);
mustCatch('the same endpoint hidden behind a const, then handed to fetch',
  reachesProductionOutsideResolver(
    "const ENDPOINT = 'https://x.supabase.co/rest/v1/';\nawait fetch(ENDPOINT);") !== null);
mustCatch('a shell-out — execSync(`curl https://…supabase.co…`) reaches production exactly as fetch does',
  reachesProductionOutsideResolver(
    "execSync('curl -s https://x.supabase.co/rest/v1/ > /tmp/o');") !== null);
mustCatch('the production FRONTEND host, not just the database one',
  reachesProductionOutsideResolver("await fetch('https://ezhalah-app.vercel.app/');") !== null);
mustCatch('a host inside a COMMENT is not a reach (the reader strips comments first)',
  reachesProductionOutsideResolver(
    "// await fetch('https://x.supabase.co/');\nconsole.log('hi');") === null);
mustCatch('a hermetic check naming no host at all is NOT flagged',
  reachesProductionOutsideResolver("const x = 1;\nconsole.log(x);") === null);
mustCatch('an UNREADABLE file in the run set is reported as UNKNOWN, never assumed clean',
  reachersOutsideResolver(['gone.ts'], () => null).length > 0);

// The four measured negative controls, read from the real tree. Each names a production host and
// none of them reaches it: a fixture env object, an error-message fixture, and two assertions about
// a shell script's source. If this barrier ever starts flagging one of them it has become a grep.
for (const name of [
  'verify-account-deletion.ts',
  'verify-deploy-bundle-check-pipeline.ts',
  'verify-journey-page-error-discriminator.ts',
  'verify-safe-deploy-postcheck-hardened.ts',
]) {
  const src = readFile(join(ROOT, 'scripts', name));
  mustCatch(`the real ${name} names a production host but does NOT reach it (negative control)`,
    src !== null && reachesProductionOutsideResolver(src) === null);
}

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the required suite reaches production only where declared, and that set can only shrink.\n'
    : `\n❌ ${failed} check(s) failed — the required suite's verdict can be decided by something other than the diff.\n`,
);
process.exit(failed === 0 ? 0 : 1);
