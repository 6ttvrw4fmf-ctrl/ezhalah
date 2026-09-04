// THE SCHEDULED PRODUCTION CHECKS MUST NOT PILE UP ON SEARCH — and must not lose cadence to say so.
// Offline contract barrier (§33, §19/§26 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md).
//
// WHAT THIS EXISTS FOR (owner directive, 2026-09-04). Search latency was measured degraded to a
// ~2 s mean in real traffic while cron sat at ZERO seconds — the load was automated QA traffic
// contending with itself at 2.5-3.2 searches/second against the §40.1 safe envelope of 1.5/s. The
// scheduled half of that load was stacked by accident, never by design:
//
//   79 collision pairs within 10 minutes, three of them EXACTLY simultaneous
//     (district-suggestion-parity + photo-rotation at :37; count-rpc-parity + region-scoped-city
//      at :47; audit-invariants + journey-sweep at 04:40)
//   a peak of 8 workflows starting inside one 30-minute window
//   7 firings landing inside 10:00-12:45 UTC — the window where the seven daily engineering
//     routines are themselves running, i.e. the worst possible moment
//
// THE FIX IS SPREADING, NOT SHRINKING. Nine 6-hourly checks were split across three 6-hour phases
// that avoid the routine window entirely — {1,7,13,19}, {2,8,14,20}, {3,9,15,21}, the only three
// such phases that exist — three per phase at :05/:25/:45, and the daily checks moved into the
// hours those phases leave empty. Every workflow kept its exact cadence. Result: 0 collisions,
// peak burst 2, 0 firings in the routine window.
//
// WHY THE CADENCE FLOOR IS HALF OF THIS BARRIER. "Reduce the load" has an easy wrong answer —
// run the checks less often — and that trades correctness coverage for latency, which §33 forbids
// outright. So this barrier refuses BOTH failures: it fails if the schedule re-stacks, AND it fails
// if any workflow fires less often than the baseline recorded when the stagger landed. Spreading is
// free; skipping is not, and the barrier will not let one be disguised as the other.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collisions, peakBurst, insideRoutineWindow, firingMinutes, hhmm, type Scheduled } from './lib/scheduleStagger.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const WF = join(root, '.github/workflows');

/** Minimum minutes between any two production-driving starts. */
const MIN_GAP_MINUTES = 10;
/** Most production-driving workflows allowed to start inside any rolling 30 minutes. */
const MAX_BURST_PER_30MIN = 3;

const items: Scheduled[] = [];
for (const f of readdirSync(WF).filter((x) => x.endsWith('.yml')).sort()) {
  const src = readFileSync(join(WF, f), 'utf8');
  // Only the `on:` block declares schedules; a cron string quoted anywhere else (a comment, a
  // dispatch input default) is not a firing time and must not be counted as one.
  const cut = src.indexOf('\njobs:');
  const on = cut === -1 ? src : src.slice(0, cut);
  const crons = [...on.matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]);
  if (!crons.length) continue;
  items.push({
    file: f,
    crons,
    // Anything holding production credentials or the production URL reaches the one 2-vCPU
    // instance. Deliberately broad: a new workflow is IN scope until proven otherwise, so the
    // failure mode is a loud false positive rather than a silent unmonitored load source.
    hitsProduction: /EXPO_PUBLIC_SUPABASE|ezhalah-app\.vercel\.app|BASE_URL/.test(src),
  });
}

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); } else console.log(`  ✓ ${name}`);
};

console.log('scheduled live-check stagger — contract');
check('scheduled workflows were found at all (an empty scan must never read as staggered)',
  items.length >= 10, `found ${items.length}`);

// ── 1. NOTHING STARTS ON TOP OF ANYTHING ELSE ────────────────────────────────────────────────────
const cols = collisions(items, MIN_GAP_MINUTES);
const pairs = new Map<string, { at: number; gap: number }>();
for (const c of cols) {
  const k = [c.a, c.b].sort().join(' + ');
  if (!pairs.has(k) || c.gapMinutes < pairs.get(k)!.gap) pairs.set(k, { at: c.atMinute, gap: c.gapMinutes });
}
check(`no two production checks start within ${MIN_GAP_MINUTES} min`, pairs.size === 0,
  pairs.size ? `${pairs.size} colliding pair(s)` : '');
for (const [k, v] of [...pairs].slice(0, 12)) console.error(`      ${hhmm(v.at)}  gap ${v.gap}m  ${k}`);

// ── 2. NO BURST ──────────────────────────────────────────────────────────────────────────────────
const burst = peakBurst(items, 30);
check(`at most ${MAX_BURST_PER_30MIN} production checks start in any 30 min`,
  burst.peak <= MAX_BURST_PER_30MIN, `peak ${burst.peak} at ${hhmm(burst.atMinute)}: ${burst.files.join(', ')}`);

// ── 3. THE ROUTINE WINDOW STAYS CLEAR ────────────────────────────────────────────────────────────
// 10:00-12:45 UTC is when the seven daily engineering routines run their own harnesses against the
// same instance. A scheduled check firing there lands on top of the heaviest interactive load of
// the day — which is exactly where 7 of them were before this barrier existed.
const inWindow = insideRoutineWindow(items);
check('no production check fires inside the 10:00-12:45 UTC routine window',
  inWindow.length === 0, inWindow.map((x) => `${hhmm(x.atMinute)} ${x.file}`).join('; '));

// ── 4. CADENCE FLOOR — SPREADING MAY NEVER BECOME SKIPPING ───────────────────────────────────────
const baseline = new Map<string, number>();
for (const line of readFileSync(join(root, 'scripts/live-check-cadence-baseline.txt'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const [file, n] = t.split(/\s+/);
  baseline.set(file, Number(n));
}
check('the cadence baseline is readable and non-empty', baseline.size >= 10, `${baseline.size} entries`);

for (const [file, want] of baseline) {
  const it = items.find((i) => i.file === file);
  if (!it) { check(`${file}: still scheduled`, false, 'the workflow lost its schedule entirely'); continue; }
  const got = it.crons.reduce((n, c) => n + firingMinutes(c).length, 0);
  check(`${file}: fires >= ${want}/day`, got >= want, `now ${got}/day`);
}

// A workflow may be ADDED without editing the baseline, but it still has to obey the spacing rules
// above — so new load cannot appear unnoticed, while adding coverage stays frictionless.
for (const it of items) {
  if (!it.hitsProduction || baseline.has(it.file)) continue;
  console.log(`  · new scheduled production workflow (not in baseline, spacing still enforced): ${it.file}`);
}

// ── 5. THE INTERACTIVE HALF ─────────────────────────────────────────────────────────────────────
// Staggering only governs load that has a cron line. The load that actually degraded Search had
// none: seven routines running harnesses interactively. That half is paced by the SHARED pacer
// (scripts/lib/searchPacer.mjs) and is owned by scripts/verify-search-pacing-shared.ts, which
// proves every paced-RPC caller has joined it. Kept in a separate barrier deliberately: this file
// is about WHEN checks start, that one is about HOW FAST they run once started, and collapsing the
// two would make either failure read as the other.

check('this barrier is discovered by npm test', npmTestRuns(root, 'verify-live-check-schedule-stagger'));

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────
// Each mutation is a realistic way the 2026-09-04 pile-up comes back. Every one must be caught.
console.log('  mutation proof:');
const mutate = (file: string, cron: string): Scheduled[] =>
  items.map((i) => (i.file === file ? { ...i, crons: [cron] } : i));

const restacked = mutate('photo-rotation-live-check.yml', '25 3-21/6 * * *'); // back onto district-suggestion
check('    caught: a check moved back on top of another',
  collisions(restacked, MIN_GAP_MINUTES).length > 0);

const intoWindow = mutate('selector-e2e.yml', '5 0-18/6 * * *');              // hour 12 is in the window
check('    caught: a check moved back into the routine window',
  insideRoutineWindow(intoWindow).length > 0);

const bursty = [
  mutate('diversity-live-check.yml', '7 1-19/6 * * *'),
  mutate('loader-active-platforms-check.yml', '9 1-19/6 * * *'),
].map((m) => peakBurst(m, 30).peak);
check('    caught: several checks crowded into one 30-minute window',
  bursty.some((p) => p > MAX_BURST_PER_30MIN) || collisions(mutate('diversity-live-check.yml', '7 1-19/6 * * *'), MIN_GAP_MINUTES).length > 0);

// The cadence limb is what stops "spread the load" from quietly becoming "run it less".
const halved = firingMinutes('5 1-13/12 * * *').length;             // 2/day instead of 4/day
check('    caught: cadence halved while the spacing still looks fine',
  halved < (baseline.get('frontend-bundle-source-parity-live-check.yml') ?? 4));

if (failures) {
  console.error(`\n✗ scheduled live-check stagger: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`✓ ${items.filter((i) => i.hitsProduction).length} production checks staggered; peak ${burst.peak}/30min; routine window clear; no cadence lost`);
