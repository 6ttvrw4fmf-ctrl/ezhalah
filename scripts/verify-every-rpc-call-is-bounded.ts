// A CALL WITH NO TIMEOUT DOES NOT FAIL — IT HANGS, AND A HANG READS TO A USER AS A BROKEN APP.
//
// AGENTS.md ("A FAILED FETCH IS NOT AN EMPTY ANSWER") states the rule in one line: *"every RPC goes
// through the `bounded()` timeout wrapper — a call with no timeout wedges the loader forever, which
// reads to a user as a hang, not an error."* That sentence was a CLAIM, not a guarded fact. Measured
// 2026-09-14 by routine #10: of the RPC call sites in `src/`, three have no bounding mechanism at
// all, and nothing in the repo would have noticed a fourth arriving. A reader consulting AGENTS.md
// for "are our RPCs bounded?" got a confident yes from a rule nobody executed — the PART 1.11 shape
// (`docs/ops/BARRIER_ENGINEER.md`): a pointer reads as coverage.
//
// WHY A RATCHET AND NOT A BAN. The three unbounded sites are shipped code and fixing them is the
// surface owner's call, not this barrier's (routed as ops_incident on the run that found them). A
// barrier that went red on shipped code would be deleted by the next person it blocked. So this is a
// SHRINK-ONLY floor, the same shape as `scripts/production-only-object-baseline.txt` and
// `PRODUCTION_DEPENDENT_CEILING`: the known debt is frozen and named, a NEW unbounded RPC is RED,
// and the list falling is the intended direction — never a failure.
//
// THREE MECHANISMS COUNT, because the repo really uses three and all three bound the wait:
//   * `bounded(builder, ms)`      — src/data/remote.ts, the timeout wrapper AGENTS.md names;
//   * `.abortSignal(ac.signal)`   — src/data/locations.ts, an AbortController the caller times out;
//   * `withTimeout(...)`          — the AF probe path, whose timeout is the thing afProbe.ts exists
//                                   to classify (PROBE_FAILED, never a verdict).
// Accepting all three is not a weakened rule: the invariant is "this await cannot last forever",
// and naming only one implementation would fail seven correct call sites and teach people to
// silence the check. What is refused is a call with NONE of them.
//
// Run: node --experimental-strip-types scripts/verify-every-rpc-call-is-bounded.ts   (in `npm test`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');

/**
 * The RPC call sites that currently have NO bounding mechanism. SHRINK-ONLY.
 *
 * Each is `<file>:<rpc name>`. Keyed by NAME rather than line number on purpose: the one
 * line-anchored allowlist in this repo (`PROSE_ALLOWLIST` in verify-no-derived-price.ts) has been
 * re-pinned NINE times by edits above it, and every re-pin is a chance to pin the wrong call.
 *
 * Routed to the surface owners on 2026-09-14 (routine #10 apparatus sweep) — this barrier owns the
 * ratchet, not the repair. Remove an entry when its call site gains a bound; never add one.
 */
const UNBOUNDED_BASELINE: ReadonlySet<string> = new Set([
  // EMPTY, AND THAT IS THE POINT — closed 2026-09-18 (ops_incident #269, routine #6).
  //
  // The three entries that used to live here were all fixed in one change, by the surface owner
  // this barrier routed them to:
  //   · src/data/loaderActivePlatforms.ts:loader_active_platforms_ar  -> boundedRpc()
  //   · src/data/loaderScaleStats.ts:loader_scale_stats_ar            -> boundedRpc()
  //   · src/data/remote.ts:loc_rel_rank                               -> the in-file bounded()
  //
  // The first two are the search-loading reads: they already failed CLOSED on an *error*, but an
  // unbounded await never produces one, so a stalled connection left «إزهله يبحث» spinning with no
  // recovery — a hang, which reads to a user as a broken app rather than as a degraded one. They now
  // use src/data/boundedRpc.ts, which exists because those modules are deliberately import-light and
  // cannot pull remote.ts in behind them.
  //
  // LEAVE THIS EMPTY. A new name here is not a normal edit: it means someone shipped an RPC that can
  // hang, and the ceiling below makes adding one a reviewed source change rather than a quiet append.
]);

/**
 * A ceiling, so adding a name is a reviewed source change and not a quiet append.
 *
 * Now 0: the debt is cleared, so the honest ceiling is "none". Raising this is the reviewable act —
 * it is the number that stops the baseline being grown instead of the call site being fixed.
 */
const UNBOUNDED_CEILING = 0;

const BOUNDING = /\bbounded\s*<?[^(]*\(|\.abortSignal\s*\(|\bwithTimeout\s*\(/;

export type Site = { file: string; rpc: string; line: number; bounded: boolean };

/**
 * Net parenthesis/bracket depth of one line, ignoring strings and line comments.
 *
 * Deliberately NOT a general parser: it exists only to find where a call's own statement ends. A
 * regex literal full of `(` is why `scripts/lib/liftSymbols.ts` refuses to walk braces, and the same
 * caution applies — so an unresolvable statement is reported UNKNOWN below rather than guessed at.
 */
function depth(line: string): number {
  let d = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') d--;
  }
  return d;
}

// THE CAPS EXIST SO AN UNPARSEABLE FILE CANNOT MAKE THIS LOOP FOREVER — they are not the rule.
// Sized from the tree, not guessed: the two `withTimeout(supabase.rpc('…', { … }), MS)` calls in
// src/data/remote.ts carry argument objects with long explanatory comments inside them, so their
// own statements run well past a dozen lines. A first cut at 12 reported BOTH of them as
// unresolvable — which fails closed, correctly, but on two calls that are properly bounded, and a
// guard that cries wolf on shipped code is one somebody deletes. Going UP is the direction that
// could pull in an unrelated bounder, and it only ever walks while an enclosing paren is open, so
// it stays tight; going DOWN can only ever stay inside the call's own argument list.
const SPAN_UP_CAP = 40;
const SPAN_DOWN_CAP = 200;

/**
 * The STATEMENT the call on line `i` belongs to — upwards while an enclosing paren is still open (a
 * call passed as an argument to its bounder), downwards while its own parens are open, plus any
 * chained continuation lines (`.abortSignal(...)` on the next line).
 *
 * Returns `null` when the statement cannot be resolved inside the caps. That is UNKNOWN, and
 * the caller treats it as NOT bounded — never as bounded, which is the direction this whole file is
 * about.
 */
export function statementAround(lines: ReadonlyArray<string>, i: number): string | null {
  let start = i;
  for (let up = 0; start > 0 && up <= SPAN_UP_CAP; up++) {
    const head = lines[start].trimStart();
    if (depth(lines[start - 1]) > 0 || head.startsWith('.') || head.startsWith(')')) start--;
    else break;
  }
  if (i - start > SPAN_UP_CAP) return null;
  let end = i;
  let run = depth(lines.slice(start, i + 1).join('\n'));
  while (run > 0 && end + 1 < lines.length && end - i < SPAN_DOWN_CAP) { end++; run += depth(lines[end]); }
  if (run > 0) return null;                       // never closed inside the cap → UNKNOWN
  while (end + 1 < lines.length && lines[end + 1].trimStart().startsWith('.') && end - i < SPAN_DOWN_CAP) end++;
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Find every `.rpc('name', …)` call site and say whether its await is bounded.
 *
 * SCOPED TO THE CALL'S OWN STATEMENT (repaired 2026-09-21, routine #10 — a mutant survived a green
 * suite). It used to be an 18-line NEIGHBOURHOOD, `lines.slice(i - 6, i + 13)`, and a neighbourhood
 * is a proximity heuristic standing in for a per-call fact: any `bounded(` / `.abortSignal(` /
 * `withTimeout(` within six lines above or twelve below satisfied it, wherever it belonged.
 *
 * MEASURED, by planting the mutant and running the check: deleting `.abortSignal(_ac.signal)` from
 * `src/data/locations.ts:908` — a real, shipped RPC await — left this barrier fully GREEN, because
 * the RETRY of the same RPC seven lines below still carried its own `.abortSignal(...)`. One call
 * lost its bound and its sibling's bound answered for it. AGENTS.md cites this file as the reason
 * "every RPC is bounded" is a *measured fact rather than an aspiration*; under the neighbourhood it
 * was measured only where no bounded sibling happened to be nearby.
 *
 * THE OLD HEADER'S OWN JUSTIFICATION IS WHY THIS WENT UNNOTICED, and it is worth quoting because
 * the reasoning is the defect: *"A heuristic window is acceptable here only because the verdict is
 * compared against an exact, named baseline: if the window ever misreads a site, the SET changes and
 * this check goes red."* That holds for a misread in the CRYING-WOLF direction. A misread in the
 * other direction — a genuinely unbounded call read as bounded — leaves the set empty, equal to the
 * baseline, and green. The argument covered the harmless half of the failure and was written as
 * though it covered both.
 *
 * Both reasons the window was generous still hold and are still honoured, by the STATEMENT rather
 * than by proximity: a call may be an ARGUMENT to its bounder (`bounded(supabase.rpc(…))`), which
 * puts the mechanism on an earlier line of the same statement, or CHAINED after it
 * (`.rpc(…)\n  .abortSignal(…)`), which puts it on a later one. Both are inside the statement span.
 * Measured on the tree as it ships: 18 of 18 sites bounded under the statement rule, identical to
 * the neighbourhood's verdict — so this is strictly a narrowing, with no shipped call newly flagged.
 *
 * Pure (takes its files as an argument) so the proofs at the bottom can hand it a broken tree.
 */
export function rpcSites(files: ReadonlyArray<{ path: string; src: string }>): Site[] {
  const out: Site[] = [];
  for (const { path, src } of files) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/\.rpc[<(]/) ? line.match(/\.rpc\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/) : null;
      if (!m) return;
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      const stmt = statementAround(lines, i);
      // An unresolvable statement is UNKNOWN, and UNKNOWN is NOT bounded (AGENTS.md: a failed read
      // is never an answer). On the tree as it ships this never fires — measured, 18 of 18 resolve.
      out.push({ file: path, rpc: m[1], line: i + 1, bounded: stmt !== null && BOUNDING.test(stmt) });
    });
  }
  return out;
}

/** Violations of the ratchet: a NEW unbounded call site, or the baseline growing past its ceiling. */
export function boundingProblems(sites: ReadonlyArray<Site>, baseline: ReadonlySet<string>): string[] {
  const out: string[] = [];

  // FAIL CLOSED: no call sites at all means this barrier is no longer reading the code it protects
  // (a moved directory, a changed client API), which must read as MISSING, never as "all bounded".
  if (sites.length === 0) {
    out.push('no .rpc() call sites were found in src/ at all — this guard is no longer reading the ' +
      'code it was written to protect, so a green result here means nothing');
    return out;
  }

  const unbounded = sites.filter((s) => !s.bounded).map((s) => `${s.file}:${s.rpc}`);
  for (const key of new Set(unbounded)) {
    if (!baseline.has(key)) {
      out.push(`${key} calls an RPC with no timeout, no AbortSignal and no withTimeout — a stalled ` +
        `connection leaves this await pending forever, which reaches the user as a hang rather than ` +
        `an error. Wrap it in bounded(), or give it an AbortSignal the caller times out.`);
    }
  }

  if (baseline.size > UNBOUNDED_CEILING) {
    out.push(`the unbounded baseline holds ${baseline.size} entries, above its ceiling of ` +
      `${UNBOUNDED_CEILING}. This list may only SHRINK — raising the ceiling is a reviewed change, ` +
      `not a side effect of adding a call site.`);
  }

  // A baseline entry whose call site is now bounded (or gone) is STALE — the ratchet would read
  // better than reality, exactly the failure verify-required-suite-is-hermetic.ts guards against in
  // its own list. Stale entries are reported so they get deleted, and deleting them is progress.
  const live = new Set(sites.filter((s) => !s.bounded).map((s) => `${s.file}:${s.rpc}`));
  for (const key of baseline) {
    if (!live.has(key)) {
      out.push(`STALE BASELINE: ${key} is no longer an unbounded call site — delete it from ` +
        `UNBOUNDED_BASELINE (and lower UNBOUNDED_CEILING) so the ratchet reports reality.`);
    }
  }

  return out;
}

// ── the real tree ────────────────────────────────────────────────────────────────────────────────
const srcFiles: { path: string; src: string }[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e)) srcFiles.push({ path: p.slice(ROOT.length + 1), src: readFileSync(p, 'utf8') });
  }
})(join(ROOT, 'src'));

const sites = rpcSites(srcFiles);
const problems = boundingProblems(sites, UNBOUNDED_BASELINE);

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

console.log('\nEvery RPC await must be bounded — a hang is not an error the user can act on\n');
console.log(`  ${sites.length} call site(s) · ${sites.filter((s) => s.bounded).length} bounded · ` +
  `${sites.filter((s) => !s.bounded).length} unbounded (baseline ${UNBOUNDED_BASELINE.size}, ceiling ${UNBOUNDED_CEILING})`);
for (const s of sites.filter((x) => !x.bounded)) console.log(`      unbounded: ${s.file}:${s.line}  ${s.rpc}`);

check('no RPC call site is unbounded outside the declared, shrink-only baseline',
  problems.length === 0, problems.join('\n      '));
check('npm test runs this guard', npmTestRuns(ROOT, 'verify-every-rpc-call-is-bounded'));

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PROOFS — the predicate is applied to a deliberately broken tree and watched to go red,
// and to the real one to prove it is not vacuously red.
// ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

const fake = (path: string, src: string) => [{ path, src }];

mustCatch('a BRAND NEW unbounded RPC call site (the case this barrier exists for)',
  boundingProblems(rpcSites(fake('src/data/newThing.ts',
    "const { data, error } = await supabase.rpc('brand_new_count_ar', { p_deal: deal });")),
    UNBOUNDED_BASELINE).length > 0);

// The real regression: an ALREADY-BOUNDED site losing its bound.
const remote = srcFiles.find((f) => f.path === 'src/data/remote.ts')!;
mustCatch('an existing bounded() call site having its wrapper removed',
  boundingProblems(rpcSites([{ path: remote.path, src: remote.src.replace(/\bbounded\s*</g, 'unwrapped<').replace(/\bawait bounded\(/g, 'await (') }]),
    UNBOUNDED_BASELINE).length > 0);

const locations = srcFiles.find((f) => f.path === 'src/data/locations.ts')!;
mustCatch('an AbortSignal being dropped from the city/district RPCs (an unbounded await wearing a familiar shape)',
  boundingProblems(rpcSites([{ path: locations.path, src: locations.src.replace(/\.abortSignal\([^)]*\)/g, '') }]),
    UNBOUNDED_BASELINE).length > 0);

// THE MUTANT THAT SURVIVED A GREEN SUITE (2026-09-21, routine #10 — the repair above).
//
// Note the shape of the proof directly above: it strips EVERY `.abortSignal(...)` in the file at
// once. Under the old 18-line neighbourhood that was the only version of this mutation that could
// be caught, and it passed for years — while the version that actually happens, ONE call losing its
// bound in an edit, walked straight through. `top_cities_by_deal_ar` is awaited twice, seven lines
// apart (the second is a retry without types); deleting the bound from the FIRST left this barrier
// fully green, because the retry's own `.abortSignal(...)` sat inside the window and answered for
// it. Executed against the REAL file, mutated in memory — nothing is written to the tree.
const ONE_BOUND = locations.src.replace(
  "let res = await supabase.rpc('top_cities_by_deal_ar', args).abortSignal(_ac.signal);",
  "let res = await supabase.rpc('top_cities_by_deal_ar', args);");
mustCatch('ONE call losing its bound while a bounded SIBLING sits seven lines below '
  + '(the mutant that survived the whole suite under the old 18-line neighbourhood)',
  ONE_BOUND !== locations.src                       // a moved anchor is a failed proof, not a pass
  && boundingProblems(rpcSites([{ path: locations.path, src: ONE_BOUND }]), UNBOUNDED_BASELINE).length > 0);

// …and the same file UNMUTATED is not flagged, so the proof above is differential rather than a
// predicate that refuses everything.
mustCatch('…while the real locations.ts is NOT flagged (this narrowing flags no shipped call)',
  boundingProblems(rpcSites([locations].map((f) => ({ path: f.path, src: f.src }))), UNBOUNDED_BASELINE).length === 0);

// AN UNRESOLVABLE STATEMENT IS UNKNOWN, AND UNKNOWN IS NOT BOUNDED. The caps exist so a pathological
// file cannot hang this scan; a call whose statement never closes inside them must read as MISSING,
// never as "bounded" — AGENTS.md's rule about failed reads, applied to the barrier's own reader.
mustCatch('a statement that never closes reads as UNBOUNDED, not as bounded',
  rpcSites(fake('src/data/x.ts',
    `const r = await bounded(supabase.rpc('never_closes_ar', {\n${'  // ...\n'.repeat(250)}`))
    .every((s) => !s.bounded));

mustCatch('the baseline being GROWN past its ceiling instead of the call site being fixed',
  boundingProblems(sites, new Set([...UNBOUNDED_BASELINE, 'src/data/x.ts:a', 'src/data/y.ts:b'])).length > 0);

mustCatch('a STALE baseline entry — the ratchet reading better than reality after a site was fixed',
  boundingProblems(rpcSites(fake('src/data/loaderScaleStats.ts',
    "const { data, error } = await bounded(supabase.rpc('loader_scale_stats_ar'));")),
    new Set(['src/data/loaderScaleStats.ts:loader_scale_stats_ar'])).length > 0);

mustCatch('the scan finding NOTHING — an unreadable subject reads as MISSING, never as "all bounded"',
  boundingProblems([], UNBOUNDED_BASELINE).length > 0);

// NEGATIVE CONTROLS. A check red for everything protects nothing.
mustCatch('…while the tree as it actually ships is NOT flagged (the predicate is not vacuously red)',
  boundingProblems(sites, UNBOUNDED_BASELINE).length === 0);

mustCatch('…and a SHRINKING baseline is not a failure — the direction this ratchet exists to encourage',
  boundingProblems(
    rpcSites(fake('src/data/loaderScaleStats.ts', "await bounded(supabase.rpc('loader_scale_stats_ar'));")),
    new Set<string>()).length === 0);

mustCatch('…and each of the three bounding mechanisms really counts as bounded, on its own',
  boundingProblems(rpcSites(fake('src/data/m.ts',
    "await bounded(supabase.rpc('a_ar'));\nawait supabase.rpc('b_ar').abortSignal(s);\nawait withTimeout(supabase.rpc('c_ar'), 4000);")),
    new Set<string>()).length === 0);

if (failed || mutFail) {
  if (failed) console.error(`\n❌ ${failed} check(s) failed — an RPC can now hang with nothing watching.`);
  if (mutFail) console.error(`❌ ${mutFail} mutation(s) went UNCAUGHT — this guard cannot see the defect it exists for.`);
  process.exit(1);
}
console.log('\n✅ every RPC await is bounded outside the declared shrink-only baseline, and the guard is proven to fail without it.');
