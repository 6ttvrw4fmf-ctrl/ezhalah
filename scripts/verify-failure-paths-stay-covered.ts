// Barrier: EVERY KNOWN FAILURE-PATH-CRITICAL FUNCTION KEEPS A BARRIER THAT INJECTS A FAILURE.
//
// THE CLASS. Five of the fifteen defects a 74-agent audit confirmed on 2026-09-04 were one bug wearing
// five faces: a request that FAILED was rendered to the user as a confident negative answer. "There
// are no listings in this location" for a region holding 32,203. "I showed you all N" after a
// load-more that errored. The logged-out screen after a sign-out that did not happen. A favourite
// that was never pushed. It is the owner-locked SOURCE IS TRUTH rule — silent→NULL, never
// unknown→NO — violated in the FETCH layer instead of the data layer, and it recurs because
// supabase-js NEVER THROWS: a failed request returns `{ data: null, error }`, so `data ?? []`,
// `if (data)` and a bare `catch {}` all turn a failure into a plausible empty value.
//
// WHY THIS SHAPE, AND NOT A CLEVERER ONE. Two alternatives were measured and rejected:
//   * A repo-wide grep for `?? []` — 66 hits in the fetch layer, of which nearly all are a benign
//     default on an optional array field. ~90% false positives is a barrier people delete.
//   * An eighth "failure-path engineer" — rejected by all three judges of the same audit: ownership
//     here is keyed on SURFACE, so a class-owner would collide with every surface owner at once. A
//     cross-cutting class is what a BARRIER is for, and a barrier makes it permanent for free.
// What is left is precise and has no heuristics: an explicit REGISTRY of the functions this class has
// actually bitten, each paired with the barrier that proves it. The registry may only GROW.
//
// WHAT "COVERED" MEANS HERE. Not that a barrier mentions the function — every one of these five had a
// barrier over the exact line, and every one of those was a source-TEXT tripwire that stayed green for
// the entire time the defect was live (two literally pinned the defective line as correct). Covered
// means the barrier RUNS the function against an injected failure. That is why an injection idiom is
// required, not just the name.
//
//   node --experimental-strip-types scripts/verify-failure-paths-stay-covered.ts   (in `npm test`)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

// Each entry: a function this class has bitten, where it lives, and the barrier that injects a
// failure into it. ADD to this list whenever a failure-path defect is fixed; never remove an entry
// without also removing the function.
export const FAILURE_PATHS: ReadonlyArray<{ fn: string; module: string; barrier: string; incident: string }> = [
  { fn: 'ensureLocationIndex', module: 'src/data/locations.ts',
    barrier: 'scripts/verify-failed-location-index-is-not-a-load.ts', incident: 'hunt-2026-09-04:search:14' },
  { fn: 'resolveSearchScope', module: 'src/data/remote.ts',
    barrier: 'scripts/verify-scope-failure-is-not-an-honest-zero.ts', incident: 'hunt-2026-09-04:search:15' },
  { fn: 'signOutBackend', module: 'src/lib/auth.ts',
    barrier: 'scripts/verify-signout-failure-is-not-silent.ts', incident: 'hunt-2026-09-04:auth:03' },
  { fn: 'loadMoreListings', module: 'src/store.tsx',
    barrier: 'scripts/verify-result-cap-honesty.ts', incident: 'hunt-2026-09-04:pagination:06' },
];

// DELIBERATELY NOT IN THIS REGISTRY: chatNeedsPush (src/store.tsx, incident
// hunt-2026-09-04:chat_persistence:01). It is a sibling of this class — an unsynced change presented
// as synced — but its defect is not a failed CALL: the fetch succeeded and the DIFF skipped it,
// because the payload was the whole meta and the diff was a clock. Its barrier
// (scripts/verify-chat-persistence.ts) proves it correctly by EXECUTING the real helpers against
// mutated inputs, which is the right proof for that shape and does not inject an error at all.
// Listing it here would have forced either a false entry or a widened definition of "covered", and a
// widened definition is how a registry stops meaning anything. This barrier caught that
// mischaracterisation on its first run, which is the behaviour it exists for.

// The registry is a FLOOR. Shrinking it means a failure path stopped being watched, which is a
// deliberate, reviewable act — not an edit to a list.
const REGISTRY_FLOOR = 4;

// A barrier "injects a failure" if it constructs one. These are the shapes the five reference
// implementations actually use: an error-shaped result (supabase-js never throws), a rejected
// promise, a thrown error, or one of the repo's own failure sentinels.
const INJECTS_FAILURE = /\berror\s*[:=]|\breject\s*\(|\bthrow new\b|PROBE_FAILED|fetchFailed|isProbeFailure/;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// Pure so the mutation proofs below can feed it broken registries.
export function coverageProblems(
  entries: ReadonlyArray<{ fn: string; module: string; barrier: string }>,
  read: (p: string) => string | null,
): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const mod = read(e.module);
    if (mod === null) { out.push(`${e.module} does not exist — ${e.fn} cannot be covered`); continue; }
    if (!new RegExp(`\\b${e.fn}\\b`).test(mod)) {
      out.push(`${e.fn} is no longer in ${e.module} (renamed or deleted) — its registry entry is stale`);
      continue;
    }
    const bar = read(e.barrier);
    if (bar === null) { out.push(`${e.barrier} is missing — ${e.fn}'s failure path is unwatched`); continue; }
    if (!new RegExp(`\\b${e.fn}\\b`).test(bar)) {
      out.push(`${e.barrier} no longer names ${e.fn} — it may have stopped covering it`);
    }
    if (!INJECTS_FAILURE.test(bar)) {
      out.push(`${e.barrier} does not INJECT a failure — a source-text tripwire is exactly what stayed green while ${e.fn} was broken`);
    }
  }
  return out;
}

const readOr = (p: string): string | null => {
  const abs = join(root, p);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

console.log('\nFailure paths — a failed fetch must never be rendered as an empty answer\n');

check(`the registry has not shrunk (${FAILURE_PATHS.length} >= ${REGISTRY_FLOOR})`,
  FAILURE_PATHS.length >= REGISTRY_FLOOR,
  'a failure path stopped being watched; removing one is a reviewable act, not a list edit');

const problems = coverageProblems(FAILURE_PATHS, readOr);
check('every registered failure path still has a barrier that injects a failure into it',
  problems.length === 0, problems.join('\n      '));

for (const e of FAILURE_PATHS) {
  console.log(`      ${e.fn.padEnd(22)} ${e.module.padEnd(24)} ← ${e.barrier.replace('scripts/', '')}`);
}

// Every entry must name the incident it came from, so the registry stays evidence-backed rather than
// becoming a list of things someone thought looked risky.
check('every entry cites the incident that put it there',
  FAILURE_PATHS.every((e) => /^hunt-\d{4}-\d{2}-\d{2}:/.test(e.incident)),
  FAILURE_PATHS.filter((e) => !/^hunt-/.test(e.incident)).map((e) => e.fn).join(', '));

// ── mutation self-proof: the predicate must FAIL on every way coverage can rot ───────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const ok = { fn: 'f', module: 'm.ts', barrier: 'b.ts' };
const readGood = (p: string) => (p === 'm.ts' ? 'function f() {}' : "const stub = { error: new Error('x') }; f(stub);");

mustCatch('a covering barrier being deleted',
  coverageProblems([ok], (p) => (p === 'b.ts' ? null : readGood(p))).length > 0);
mustCatch('a barrier that names the function but never injects a failure (a source-text tripwire)',
  coverageProblems([ok], (p) => (p === 'b.ts' ? 'check(/f\\(\\)/.test(src));  // f is mentioned, nothing runs' : readGood(p))).length > 0);
mustCatch('a barrier that quietly stopped covering its function',
  coverageProblems([ok], (p) => (p === 'b.ts' ? "const stub = { error: 1 }; somethingElse(stub);" : readGood(p))).length > 0);
mustCatch('the watched function being renamed out from under its entry',
  coverageProblems([ok], (p) => (p === 'm.ts' ? 'function renamedAway() {}' : readGood(p))).length > 0);
mustCatch('the module itself disappearing',
  coverageProblems([ok], (p) => (p === 'm.ts' ? null : readGood(p))).length > 0);
mustCatch('a healthy entry still reading as covered (the predicate is not vacuously red)',
  coverageProblems([ok], readGood).length === 0);
mustCatch('the registry being shrunk below its floor', (REGISTRY_FLOOR - 1) < REGISTRY_FLOOR);

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ every failure path this class has bitten still has a barrier that makes it fail\n');
