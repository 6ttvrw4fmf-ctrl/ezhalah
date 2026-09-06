// THE SENTRY-SILENCE DETECTOR MUST ACTUALLY RUN, AND EVERY ROUTINE MUST HEARTBEAT UNDER A SLUG IT
// WATCHES.
//
// THE PROMISE THIS FINALLY KEEPS. Migration 20260830183604 (Layer 2, owner rule 2026-08-30) says in
// its own header: "Barrier: scripts/verify-sentry-heartbeat-detector-wired.ts (excluded from
// `npm test`, runs on .github/workflows/loader-active-platforms-check.yml)", and the detector body
// adds "the shared barrier scripts/verify-sentry-heartbeat-detector-wired.ts names the same seven,
// so the two cannot silently drift". This file did not exist. It was a KNOWN_GAPS entry in
// scripts/verify-ops-remediation-scripts-exist.ts, routed to routine-7-seam (ops_incident #50).
//
// A dangling barrier claim is worse than no claim: it tells the next reader to stop looking. The
// whole point of Layer 2 is that silence is OBSERVED, not trusted — and for six days the observer
// of the observer was a sentence in a migration header.
//
// WHAT IT CHECKS, and why each half is behavioural rather than a source read.
//
//   1. WIRED — the detector really ran. `ops_detector_timing` records every detector the twice-hourly
//      mon_run_all_detectors() sweep touches, with `crashed`/`skipped`, and
//      ops_detector_sweep_health() is its narrow anon reader (the table itself is RLS-enabled with
//      no policies). So "is it on the roster" is answered by OBSERVATION: it swept recently and did
//      not crash. Reading the roster's source text would pass just as happily while pg_cron was
//      dead, which is the exact shape AGENTS.md records as this repo's most expensive failure mode —
//      nine dark detectors reading as a clean bill of health.
//
//   2. THE WRITE PATH WORKS — executed, not assumed. ops_record_sentry_heartbeat() is the ONE way a
//      heartbeat can be recorded (the table has no INSERT policy; writes go through that
//      security-definer RPC). If it ever stops working, every routine's heartbeat silently fails
//      and the detector raises seven false P1s claiming seven routines skipped Sentry. So this
//      calls it and reads the row back, under the `barrier-probe:` prefix the table's own comment
//      reserves for exactly this.
//
//   3. NO ROUTINE HEARTBEATS UNDER A SLUG NOBODY WATCHES — the drift the migration named, in the
//      form that actually hurts. The detector iterates a FIXED roster of seven slugs. A routine
//      calling ops_record_sentry_heartbeat('systems_seam') or ('routine-7-seam') would be dutifully
//      recording compliance into a row the detector never reads: the routine looks compliant, the
//      detector still sees silence, and nobody can tell which. Every non-probe slug the heartbeat
//      table has ever recorded must therefore be one of the seven.
//
//   4. THIS BARRIER'S OWN PROBE CANNOT SILENCE A REAL ROUTINE — the probe prefix is asserted to be
//      outside the canonical set, so check 2's write can never clear a genuine routine_sentry_silent
//      alert. A barrier that suppresses the thing it guards is worse than no barrier.
//
// THE SEVEN ARE PINNED HERE ON PURPOSE. Routines #8-#11 joined the roster on 2026-09-04 and have no
// heartbeat slug yet (their live prompts are still an open owner action), so pinning eleven would
// manufacture four permanent P1s for routines that do not run. When they are enrolled, whoever adds
// their slugs must add them here too — that is the "cannot silently drift" the migration asked for.
// DO NOT delete a slug from this list to make a red run green: a slug that vanishes from the
// detector is a routine whose silence stopped being observed.
//
// AN EMPTY RESULT IS NOT A PASS. Every read below is tagged readable/unreadable, so an outage cannot
// be spelled the same way as a healthy answer ("A FAILED FETCH IS NOT AN EMPTY ANSWER", AGENTS.md).
//
// LIVE, so deliberately NOT in the hermetic `npm test` — a required status check must not go red on
// every unrelated PR because production is momentarily unreachable. Its home is
// .github/workflows/loader-active-platforms-check.yml, exactly as the migration said, recorded in
// scripts/test-exclusions.txt.
//
//   node --experimental-strip-types scripts/verify-sentry-heartbeat-detector-wired.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url, key } = resolvePublicSupabase();
const HEADERS = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const ATTEMPTS = 3;

/**
 * The seven canonical heartbeat slugs, from 20260830183604's `canonical_slugs` roster and
 * docs/ops/SENTRY_ROUTING.md §2. See the header before changing this list.
 */
export const CANONICAL_SLUGS = [
  'junior-scraping', 'senior-production', 'data-integrity',
  'search-matching-qa', 'af-trending', 'journey-persistence', 'systems-seam',
] as const;

/** The prefix the table's own comment reserves for barrier writes, excluded by the detector. */
export const PROBE_SLUG = 'barrier-probe:verify-sentry-heartbeat-detector-wired';

/** The sweep runs at :29/:59, so three hours is six missed sweeps — dead, not merely unlucky. */
export const MAX_SWEEP_AGE_MS = 3 * 60 * 60 * 1000;

/** One row, always, from ops_detector_sweep_health() — the 24h window for one named detector. */
export type SweepHealth = {
  last_swept_at: string | null;
  sweeps: number;
  crashes: number;
  skips: number;
};
export type Beat = { routine: string };

/** Readable rows, or an error. There is deliberately no third spelling of "nothing came back". */
export type Answer<T> = { readable: true; rows: T[] } | { readable: false; error: string };

export type Verdict = { pass: boolean; reason: string };

// ── THE DECISIONS, pure and executable ──────────────────────────────────────────────────────────

/** 1. The detector is reached by the sweep: it ran recently, and the runs it made did not crash. */
export function wiredVerdict(answer: Answer<SweepHealth>, now: number): Verdict {
  if (!answer.readable) return { pass: false, reason: `UNREADABLE — ${answer.error}` };
  if (answer.rows.length !== 1) {
    return { pass: false, reason: `ops_detector_sweep_health returned ${answer.rows.length} rows, expected exactly 1` };
  }
  const h = answer.rows[0];
  if (h.last_swept_at === null || Number(h.sweeps) === 0) {
    return { pass: false, reason: 'no sweep of mon_detect_routine_sentry_silent in the last 24h — the sweep is not reaching it' };
  }
  if (Number(h.crashes) > 0) {
    return { pass: false, reason: `the detector crashed on ${h.crashes} of its ${h.sweeps} sweeps in the last 24h` };
  }
  const newest = Date.parse(h.last_swept_at);
  if (!Number.isFinite(newest)) return { pass: false, reason: `unparseable last_swept_at: ${h.last_swept_at}` };
  const ageMs = now - newest;
  if (ageMs > MAX_SWEEP_AGE_MS) {
    return { pass: false, reason: `last sweep was ${(ageMs / 3600000).toFixed(1)}h ago (limit ${MAX_SWEEP_AGE_MS / 3600000}h) — the detector has gone dark` };
  }
  return { pass: true, reason: `swept ${(ageMs / 60000).toFixed(0)} min ago, ${h.sweeps} sweeps in 24h, no crash` };
}

/** 2. The one write path works: the probe we just wrote is readable back. */
export function writePathVerdict(wrote: Answer<{ id: number }>, readBack: Answer<Beat>): Verdict {
  if (!wrote.readable) return { pass: false, reason: `ops_record_sentry_heartbeat UNREADABLE — ${wrote.error}` };
  if (!readBack.readable) return { pass: false, reason: `heartbeat read-back UNREADABLE — ${readBack.error}` };
  if (readBack.rows.length === 0) {
    return { pass: false, reason: 'the probe heartbeat was accepted but is not in ops_routine_sentry_heartbeat — the ONE write path is broken, so every routine heartbeat is silently lost' };
  }
  return { pass: true, reason: 'ops_record_sentry_heartbeat wrote a row and it reads back' };
}

/** 3. Nobody heartbeats under a slug the detector's fixed roster does not iterate. */
export function slugVerdict(answer: Answer<Beat>, canonical: readonly string[]): Verdict {
  if (!answer.readable) return { pass: false, reason: `UNREADABLE — ${answer.error}` };
  const known = new Set(canonical);
  const stray = [...new Set(
    answer.rows.map((r) => r.routine).filter((s) => !s.startsWith('barrier-probe:') && !known.has(s)),
  )].sort();
  if (stray.length > 0) {
    return {
      pass: false,
      reason: `${stray.length} routine slug(s) heartbeat into a roster nobody watches: ${stray.join(', ')}`
        + ' — the routine reads as compliant while the detector still sees silence',
    };
  }
  return { pass: true, reason: `every recorded slug is one of the ${canonical.length} the detector iterates` };
}

/** 4. The probe prefix is outside the canonical set, so this barrier cannot silence a real routine. */
export function probeIsInertVerdict(probe: string, canonical: readonly string[]): Verdict {
  const inert = probe.startsWith('barrier-probe:') && !canonical.includes(probe);
  return inert
    ? { pass: true, reason: `probe slug "${probe}" is outside the watched roster` }
    : { pass: false, reason: `probe slug "${probe}" would be read by the detector and could clear a genuine silence alert` };
}

// ── MUTATION PROOFS — executed, not described ───────────────────────────────────────────────────
let failures = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) console.log(`  PASS  MUTATION — ${label}`);
  else { failures++; console.error(`  FAIL  MUTATION NOT CAUGHT — ${label}`); }
};

const NOW = Date.parse('2026-09-06T02:36:00Z');
const fresh: SweepHealth = { last_swept_at: '2026-09-06T02:29:00Z', sweeps: 47, crashes: 0, skips: 0 };

mustCatch('a detector that stopped being swept is DETECTED (the dark-detector shape)',
  wiredVerdict({ readable: true, rows: [{ ...fresh, last_swept_at: '2026-09-05T02:29:00Z' }] }, NOW).pass === false);
mustCatch('a detector the sweep has never reached is DETECTED',
  wiredVerdict({ readable: true, rows: [{ last_swept_at: null, sweeps: 0, crashes: 0, skips: 0 }] }, NOW).pass === false);
mustCatch('a crashing detector is DETECTED (it ran, so freshness alone would pass it)',
  wiredVerdict({ readable: true, rows: [{ ...fresh, crashes: 3 }] }, NOW).pass === false);
mustCatch('an HTTP failure is a FAILURE, never a fresh sweep',
  wiredVerdict({ readable: false, error: 'HTTP 503' }, NOW).pass === false);
mustCatch('a routine heartbeating under an unwatched slug is DETECTED',
  slugVerdict({ readable: true, rows: [{ routine: 'systems_seam' }] }, CANONICAL_SLUGS).pass === false);
mustCatch('a slug REMOVED from the detector roster is DETECTED (drift the other way)',
  slugVerdict({ readable: true, rows: [{ routine: 'systems-seam' }] },
    CANONICAL_SLUGS.filter((s) => s !== 'systems-seam')).pass === false);
mustCatch('an accepted write that did not land is DETECTED, not read as success',
  writePathVerdict({ readable: true, rows: [{ id: 1 }] }, { readable: true, rows: [] }).pass === false);
mustCatch('an unreadable heartbeat table is a FAILURE, not an empty roster',
  slugVerdict({ readable: false, error: 'HTTP 500' }, CANONICAL_SLUGS).pass === false);
mustCatch('a probe slug inside the watched roster is DETECTED (it could silence a real routine)',
  probeIsInertVerdict('systems-seam', CANONICAL_SLUGS).pass === false);

// NEGATIVE CONTROLS. Without these, a predicate that simply always failed would satisfy every proof
// above — the checks would be green and the barrier would be worthless.
mustCatch('a live, crash-free, recently-swept detector still PASSES',
  wiredVerdict({ readable: true, rows: [fresh] }, NOW).pass === true);
mustCatch('canonical slugs plus a barrier probe still PASS',
  slugVerdict({ readable: true, rows: [{ routine: 'systems-seam' }, { routine: PROBE_SLUG }] }, CANONICAL_SLUGS).pass === true);
mustCatch('a landed write still PASSES',
  writePathVerdict({ readable: true, rows: [{ id: 1 }] }, { readable: true, rows: [{ routine: PROBE_SLUG }] }).pass === true);
mustCatch('the real probe slug is inert',
  probeIsInertVerdict(PROBE_SLUG, CANONICAL_SLUGS).pass === true);

if (failures > 0) {
  console.error(`✗ ${failures} mutation proof(s) failed — the predicates do not discriminate.`);
  process.exit(1);
}

// ── THE LIVE READS ──────────────────────────────────────────────────────────────────────────────
function interpret<T>(status: number, bodyText: string): Answer<T> {
  if (status !== 200 && status !== 201 && status !== 206) {
    return { readable: false, error: `HTTP ${status}: ${bodyText.slice(0, 200)}` };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return { readable: false, error: `body was not JSON: ${bodyText.slice(0, 200)}` }; }
  if (Array.isArray(parsed)) return { readable: true, rows: parsed as T[] };
  // ops_record_sentry_heartbeat returns a scalar bigint, not an array.
  if (typeof parsed === 'number') return { readable: true, rows: [{ id: parsed } as T] };
  return { readable: false, error: `expected a JSON array, got ${typeof parsed}` };
}

async function read<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  let last: Answer<T> = { readable: false, error: 'never attempted' };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${url}${path}`, { headers: HEADERS, ...init });
      last = interpret<T>(res.status, await res.text());
      if (last.readable) return last;
    } catch (e) {
      last = { readable: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  return last;
}

const sweeps = await read<SweepHealth>('/rest/v1/rpc/ops_detector_sweep_health', {
  method: 'POST',
  body: JSON.stringify({ p_detector: 'mon_detect_routine_sentry_silent' }),
});

const wrote = await read<{ id: number }>('/rest/v1/rpc/ops_record_sentry_heartbeat', {
  method: 'POST',
  body: JSON.stringify({
    p_routine: PROBE_SLUG,
    p_note: 'barrier probe: the ONE heartbeat write path must work, or every routine heartbeat is silently lost',
  }),
});

const probeBack = await read<Beat>(
  `/rest/v1/ops_routine_sentry_heartbeat?select=routine&routine=eq.${encodeURIComponent(PROBE_SLUG)}&limit=1`,
);

// Every slug the table has ever recorded — the population check 3 judges.
const allBeats = await read<Beat>('/rest/v1/ops_routine_sentry_heartbeat?select=routine&limit=10000');

const results: [string, Verdict][] = [
  ['the silence detector is reached by the sweep and does not crash', wiredVerdict(sweeps, Date.now())],
  ['the ONE heartbeat write path works end to end', writePathVerdict(wrote, probeBack)],
  ['no routine heartbeats under a slug the detector never reads', slugVerdict(allBeats, CANONICAL_SLUGS)],
  ['this barrier\'s own probe cannot silence a real routine', probeIsInertVerdict(PROBE_SLUG, CANONICAL_SLUGS)],
];

let bad = 0;
for (const [label, v] of results) {
  if (v.pass) console.log(`  PASS  ${label} (${v.reason})`);
  else { bad++; console.error(`  FAIL  ${label}: ${v.reason}`); }
}

if (bad > 0) {
  console.error(`\n✗ ${bad} check(s) failed — Layer 2's "silence is observed, not trusted" guarantee is not holding.`);
  console.error('  A dark detector, a broken write path or an unwatched slug all read to a human as');
  console.error('  "every routine is doing its Sentry check". FIX the wiring — never delete a slug');
  console.error('  from CANONICAL_SLUGS to make this green, and never hand-insert a heartbeat: the');
  console.error('  detector\'s own payload says that hides the actual silence.');
  process.exit(1);
}

console.log('\n✓ the routine-sentry-silence detector runs, its write path works, and every slug is watched');
