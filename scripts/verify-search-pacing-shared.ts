// EVERY HARNESS THAT CAN LOAD PRODUCTION SEARCH SHARES ONE PACER — and pacing never becomes skipping.
// Offline contract barrier (§33, §19/§26 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md).
//
// WHAT THIS CLOSES (owner directive, 2026-09-04). User-facing Search averaged ~2 s in real traffic
// while cron sat at ZERO seconds. The load was the engineering routines' own harnesses: seven of
// them, each individually inside the §40.1 envelope of 1.5 searches/second, collectively at
// 2.5-3.2/s on a 2-vCPU instance. Every run's rate constant was correct in isolation and blind to
// the SUM. Staggering fixed the load that has a cron line; this covers the load that does not.
//
// TWO FAILURES, NOT ONE. The owner's constraint was explicit: control WHEN and HOW FAST checks run,
// never WHETHER they run. So this barrier refuses both directions:
//
//   (a) a harness that can load Search but does NOT share the pacer — the load goes unbounded again,
//       and the next investigation re-measures the same 3 searches/second by hand;
//   (b) pacing quietly turned into shrinking — a budget cut, a skipped cohort, a dropped assertion
//       or a request the pacer refuses. Coverage must be byte-for-byte identical paced or not.
//
// THE CALLER LIST IS COMPUTED, NEVER HARDCODED. A file is in scope if it performs a real fetch AND
// names one of the paced search RPCs. That is the same predicate used to wire them in the first
// place, so a NEW harness is in scope the moment it is written — which is the failure a hardcoded
// list always eventually has (one forgotten file, indistinguishable from a deliberate exemption).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const pacerPath = join(root, 'scripts/lib/searchPacer.mjs');
const pacer = readFileSync(pacerPath, 'utf8');

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); } else console.log(`  ✓ ${name}`);
};

console.log('shared search pacing — contract');

// ── 1. THE PACER ITSELF KEEPS ITS PROMISES ───────────────────────────────────────────────────────
check('it only ever delays — never drops, refuses or rewrites a request',
  /return baseFetch\(input, init\);/.test(pacer)
  && !/return (new Response|undefined|null)/.test(pacer)
  && !/\.slice\(0,|budget|limit\s*=/.test(pacer));
check('it captures the real fetch before patching, so re-import cannot wrap the wrapper',
  /const baseFetch = globalThis\.fetch\.bind\(globalThis\);/.test(pacer));
check('installing is idempotent', /if \(installed \|\| process\.env\.QA_PACE_OFF === '1'\) return;/.test(pacer));
check('an unreadable load signal keeps the NORMAL pace, never a permanent back-off',
  /catch \{[\s\S]{0,400}?gap = NORMAL_GAP_MS;/.test(pacer));
check('the load probe is rate-limited so it cannot become load itself', /LOAD_RECHECK_MS/.test(pacer));
check('the probe uses baseFetch, so it can never pace itself into recursion',
  /const r = await baseFetch\(`\$\{SUPA\}\/rest\/v1\/rpc\/ops_search_load_now`/.test(pacer));
check('a single wait is capped, so pacing can never look like a hang', /MAX_WAIT_MS/.test(pacer));
// The property that makes this bound the COMBINED load rather than each run's own: a fixed busy gap
// is still a per-process constant, and N runners at a fixed gap still offer N x (1/gap) searches
// per second. Escalation converges on what the instance can take, for any N.
check('back-off ESCALATES while degraded rather than stepping to a fixed gap',
  /Math\.min\(Math\.round\(gap \* UP\), MAX_GAP_MS\)/.test(pacer));
check('it recovers gently, so one quiet sample cannot undo a real back-off',
  /Math\.max\(Math\.round\(gap \/ DOWN\), NORMAL_GAP_MS\)/.test(pacer));
check('the wait cap sits ABOVE the gap cap, so it cannot silently truncate the escalation',
  /MAX_WAIT_MS = MAX_GAP_MS \+ 500/.test(pacer));
// The sampler is a pg_cron job and gets starved by the very load this relieves — two firings were
// skipped outright during the 2026-09-04 four-way concurrency run. An empty window must therefore
// HOLD the gap; resetting it to normal would disengage pacing hardest exactly when load is worst.
check('a readable-but-EMPTY load window holds the gap instead of resetting to normal',
  /if \(!load \|\| load\.samples === 0 \|\| load\.recent_mean_ms == null\) return gap;/.test(pacer));
check('waits are serialised, so CONCURRENT callers space against each other',
  /chain = mine\.catch\(\(\) => \{\}\);/.test(pacer));
check('only production SEARCH reads are paced (bookkeeping and the probe are not)',
  /PACED_RPCS = \[/.test(pacer) && /location_search_candidates_ar/.test(pacer)
  && !/ops_qa_record_coverage'/.test(pacer.split('PACED_RPCS')[1]?.split(']')[0] ?? ''));

// ── 2. EVERY PACED-RPC CALLER HAS JOINED ─────────────────────────────────────────────────────────
const PACED_RPCS = ['location_search_candidates_ar', 'top_cities_by_deal_ar', 'district_options_ar'];
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|ts)$/.test(e)) out.push(p);
  }
  return out;
};
const candidates: string[] = [];
for (const p of [...walk(join(root, 'e2e')), ...walk(join(root, 'scripts'))]) {
  if (p === pacerPath) continue;
  const src = readFileSync(p, 'utf8');
  const namesAnRpc = PACED_RPCS.some((r) => src.includes(r));
  const reallyFetches = /\bfetch\s*\(/.test(src);
  // The barrier itself names the RPCs in order to look for them; so does the pacer. Neither issues
  // a search, and a file that only lists the names for analysis must not be dragged into scope.
  const isAnalyser = /verify-search-pacing-shared/.test(p);
  if (namesAnRpc && reallyFetches && !isAnalyser) candidates.push(p);
}
check('paced-RPC callers were discovered at all (an empty scan must never read as compliant)',
  candidates.length >= 15, `found ${candidates.length}`);

const missing = candidates.filter((p) => !readFileSync(p, 'utf8').includes('searchPacer.mjs'));
check(`all ${candidates.length} paced-RPC callers import the shared pacer`, missing.length === 0,
  missing.map((p) => relative(root, p)).join(', '));

// ── 3. NOBODY REIMPLEMENTED IT LOCALLY ───────────────────────────────────────────────────────────
// Six private rate limiters is the outcome this was built to avoid: each individually plausible,
// collectively unbounded, and impossible to change in one place.
const localLimiters = candidates.filter((p) => {
  const s = readFileSync(p, 'utf8');
  return /MIN_GAP_MS\s*=|BUSY_GAP_MS\s*=|RATE_LIMIT_MS\s*=/.test(s) && /await sleep\(gap/.test(s);
});
check('no harness reimplements pacing locally', localLimiters.length === 0,
  localLimiters.map((p) => relative(root, p)).join(', '));

// ── 4. PACING NEVER BECAME SHRINKING ─────────────────────────────────────────────────────────────
// The coverage run is the highest-volume caller and therefore the one most tempting to shrink.
const runner = readFileSync(join(root, 'e2e/qa-coverage/run.mjs'), 'utf8');
// Order-agnostic on purpose: `BUDGET = degraded ? …` and `if (degraded) BUDGET = …` are the same
// defect written two ways, and a regex that only caught one would pass the other straight through.
const budgetCutOnLoad = (s: string) =>
  /(BUDGET|budget)\s*=\s*[^;\n]*degraded/.test(s) || /degraded[\s\S]{0,200}(BUDGET|budget)\s*=/.test(s);
check('the coverage budget is not reduced when the instance is loaded',
  !budgetCutOnLoad(runner) && !/searches\.length\s*=/.test(runner));
check('no cohort or search is skipped on load',
  !/if \(.*degraded.*\)\s*(continue|return|break)/.test(runner));
check('back-off is reported, so pacing is visible rather than silent',
  /PACED BACK FOR OTHER LOAD/.test(runner));

check('this barrier is discovered by npm test', npmTestRuns(root, 'verify-search-pacing-shared'));

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────
console.log('  mutation proof:');
const pacerMutations: [string, string, string, (s: string) => boolean][] = [
  ['the pacer starts refusing requests instead of delaying them',
    'return baseFetch(input, init);', 'return new Response(null, { status: 429 });',
    (s) => /return baseFetch\(input, init\);/.test(s) && !/return (new Response|undefined|null)/.test(s)],
  ['an unreadable signal now backs off permanently instead of resuming normal pace',
    'gap = NORMAL_GAP_MS;\n  }\n  return gap;', 'gap = BUSY_GAP_MS;\n  }\n  return gap;',
    (s) => /catch \{[\s\S]{0,400}?gap = NORMAL_GAP_MS;/.test(s)],
  ['the probe stops using baseFetch and can recurse into its own pacing',
    'const r = await baseFetch(`${SUPA}/rest/v1/rpc/ops_search_load_now`',
    'const r = await fetch(`${SUPA}/rest/v1/rpc/ops_search_load_now`',
    (s) => /const r = await baseFetch\(`\$\{SUPA\}\/rest\/v1\/rpc\/ops_search_load_now`/.test(s)],
  ['the wait cap is removed, so pacing can hang a run',
    'MAX_WAIT_MS', 'NO_CAP', (s) => /MAX_WAIT_MS/.test(s)],
  ['escalation replaced by a fixed gap — N runners then sum over the envelope again',
    'Math.min(Math.round(gap * UP), MAX_GAP_MS)', 'BUSY_GAP_MS',
    (s) => /Math\.min\(Math\.round\(gap \* UP\), MAX_GAP_MS\)/.test(s)],
  ['an empty sample window resets the gap, disengaging pacing when the sampler is starved',
    'if (!load || load.samples === 0 || load.recent_mean_ms == null) return gap;', '',
    (s) => /if \(!load \|\| load\.samples === 0 \|\| load\.recent_mean_ms == null\) return gap;/.test(s)],
  ['recovery made instant, so a single quiet sample undoes a real back-off',
    'Math.max(Math.round(gap / DOWN), NORMAL_GAP_MS)', 'NORMAL_GAP_MS',
    (s) => /Math\.max\(Math\.round\(gap \/ DOWN\), NORMAL_GAP_MS\)/.test(s)],
  ['waits stop being serialised, so concurrent callers no longer space against each other',
    'chain = mine.catch(() => {});', 'void mine;',
    (s) => /chain = mine\.catch\(\(\) => \{\}\);/.test(s)],
];
for (const [label, from, to, stillHolds] of pacerMutations) {
  if (!pacer.includes(from)) { failures++; console.error(`  ✗ mutation anchor missing: ${label}`); continue; }
  check(`    caught: ${label}`, !stillHolds(pacer.replaceAll(from, to)));
}

// A harness dropping the import is the single most likely regression: it is one line, and removing
// it looks like tidying. Proven against a real caller rather than a synthetic string.
// `/gm`, not `/m`: a caller may mention the pacer on more than one line (the side-effecting import
// plus a named import of pacingStats), and removing only the first would leave the file still
// matching — a mutation that does not mutate, which reads as "caught" while proving nothing.
const sample = candidates.find((p) => p.endsWith('run.mjs')) ?? candidates[0];
const withoutImport = readFileSync(sample, 'utf8').replace(/^.*searchPacer\.mjs.*$/gm, '');
check('    caught: a harness quietly drops the shared import', !withoutImport.includes('searchPacer.mjs'));

// And the shrink direction, which is the one the owner named explicitly.
check('    caught: the budget is cut on load instead of pacing',
  budgetCutOnLoad(runner.replace('const BUDGET = Number(process.env.QA_BUDGET) || DAILY_BUDGET;',
    'const BUDGET = degraded ? 50 : Number(process.env.QA_BUDGET) || DAILY_BUDGET;')));

if (failures) {
  console.error(`\n✗ shared search pacing: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`✓ ${candidates.length} paced-RPC callers share one pacer; delays only, no coverage reduced`);
