// THE COMPOSITE PER-PROPERTY_TYPE NULL-PRICE BASELINE MUST STAY, AND MUST STAY SENSITIVE.
//
// THE PROMISE THIS KEEPS. Migration 20260821031350 ends its header with: "Regression coverage
// (proven red-on-old / green-on-new against synthetic data mirroring the real per-type baselines
// above, matching alert 466's exact slice_n=321/slice_frac=0.318 shape):
// scripts/verify-run-field-range-composite-baseline-live.ts". This file did not exist. It was a
// KNOWN_GAPS entry in scripts/verify-ops-remediation-scripts-exist.ts, routed to
// routine-3-data-integrity (ops_incident #50) — a protection that reads as present and is absent,
// which is worse than no claim because it tells the next reader to stop looking.
//
// THE DEFECT IT GUARDS. mon_check_run_field_ranges() check (a) compares a run's touched-row
// null-price fraction against a baseline. Until 2026-08-21 that baseline was ONE flat table-wide
// number, and per-property_type null rates on a multi-type table are structurally miles apart
// (measured on aqar_residential_listings: Rent 4.28% Apartment to 90.57% Chalet — all faithfully
// captured; those sources genuinely publish no price). So a city sweep whose touched slice happened
// to be Room/Chalet/Rest-House-heavy looked anomalous with zero regression: alert 466, run 32382,
// slice_frac 31.8% against a table baseline of 6.6%. The fix weights each present type's OWN
// baseline by its share of the touched slice. Reverting it — a CREATE OR REPLACE that re-emits the
// pre-fix body, the full-body-replace hazard this repo has been bitten by before — brings the false
// P1s straight back, and nothing would have noticed.
//
// WHY IT IS BEHAVIOURAL AND LIVE. A source read would pass just as happily on a body that no longer
// computes what its comments say. public.ops_probe_field_range_composite() (migration
// 20260906040717) seeds the fixture table 20260821031441 created for exactly this, calls the REAL
// function on two scenarios, and rolls every write back — so the must-trip direction can reach
// mon_raise() without a fabricated alert_event ever being committed, dispatched as a GitHub issue,
// or stranded open forever under a kind that has no resolver.
//
// WHAT IS ASSERTED, and why each one is not redundant:
//   1. THE FIXTURE IS STILL ALERT 466'S SHAPE. 321 touched rows, slice_frac ~0.32, and — the
//      load-bearing part — the PRE-FIX predicate (slice >= flat_table_baseline + 0.25) still trips
//      on it. That arithmetic is not a copy of production code: the old predicate exists nowhere
//      any more. It is what makes check 2 mean something. Without it, someone could soften the
//      probe's seed until nothing could ever trip and every check below would go green on a
//      scenario that proves nothing.
//   2. THE COMPOSITE BASELINE HOLDS. On that same slice the REAL function must NOT trip. This is
//      the regression assertion: watched RED on 2026-09-06 by replacing the rent arm's composite
//      branch with `composite_frac := base_frac` inside a transaction that was aborted — the same
//      321 rows flipped to tripped=true, reason rent_price_null_regression, alert 466 all over
//      again.
//   3. THE CHECK IS NOT BLIND. 300 touched Apartment rows, every price_annual null, against an
//      Apartment baseline of ~11.8%: a real parse regression must still trip, and the reason
//      mon_raise() recorded must be rent_price_null_regression specifically. A fix that bought
//      quiet by disabling the check would pass 1 and 2 and fail here.
//   4. THE PROBE LEFT NO TRACE. Fixture rows and alert rows re-counted after the unwind, both zero.
//      A barrier that fabricates production state is not allowed to be the price of this coverage.
//
// AN UNREADABLE ANSWER IS A FAILURE, never a pass — "a failed fetch is not an empty answer"
// (AGENTS.md). Retried 3x: a transient 5xx clears on attempt 2, a reverted baseline is
// deterministic and fails all three.
//
// LIVE, so deliberately OUT of the hermetic `npm test`: that suite is a required status check on
// every PR and must not go red because production was momentarily unreachable. Its home is
// .github/workflows/p0-fast-lane-coverage.yml, recorded in scripts/test-exclusions.txt — the same
// triggers for the same reason as that workflow's own check: this invariant breaks when a migration
// is APPLIED, so the schedule and the push-on-migrations path are load-bearing, not the PR one.
//
//   node --experimental-strip-types scripts/verify-run-field-range-composite-baseline-live.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url, key } = resolvePublicSupabase();
const HEADERS = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const ATTEMPTS = 3;

/** The touched-slice size alert 466 carried. The probe's seed is pinned to it. */
export const ALERT_466_SLICE_N = 321;
/** Alert 466's slice_frac was 0.318; the seeded reproduction lands at 0.3396. */
export const ALERT_466_FRAC_RANGE = [0.30, 0.36] as const;
/** The margin check (a) has always used, pre-fix and post-fix alike. */
export const REGRESSION_MARGIN = 0.25;

export type Scenario = {
  tripped: boolean;
  slice_n: number;
  slice_null: number;
  slice_frac: number;
  flat_baseline_frac: number;
  checks: string[];
};
export type Probe = {
  faithful_skew: Scenario;
  genuine_regression: Scenario;
  residue: { fixture_rows: number; probe_alerts: number };
};

/** Readable, or an error. There is deliberately no third spelling of "nothing came back". */
export type Answer<T> = { readable: true; value: T } | { readable: false; error: string };
export type Verdict = { pass: boolean; reason: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Shape-validating parse: a payload missing a field is UNREADABLE, never a quietly passing zero. */
export function parseProbe(body: unknown): Answer<Probe> {
  if (typeof body !== 'object' || body === null) return { readable: false, error: `expected an object, got ${typeof body}` };
  const root = body as Record<string, unknown>;
  const scenarios: Record<string, Scenario> = {};
  for (const name of ['faithful_skew', 'genuine_regression']) {
    const s = root[name];
    if (typeof s !== 'object' || s === null) return { readable: false, error: `missing scenario "${name}"` };
    const r = s as Record<string, unknown>;
    const nums = { slice_n: num(r.slice_n), slice_null: num(r.slice_null), slice_frac: num(r.slice_frac), flat_baseline_frac: num(r.flat_baseline_frac) };
    for (const [f, v] of Object.entries(nums)) if (v === null) return { readable: false, error: `"${name}.${f}" is not a number` };
    if (typeof r.tripped !== 'boolean') return { readable: false, error: `"${name}.tripped" is not a boolean` };
    if (!Array.isArray(r.checks) || r.checks.some((c) => typeof c !== 'string')) return { readable: false, error: `"${name}.checks" is not a string[]` };
    scenarios[name] = { tripped: r.tripped, checks: r.checks as string[], ...(nums as Required<typeof nums>) };
  }
  const res = root.residue as Record<string, unknown> | undefined;
  const rows = num(res?.fixture_rows);
  const alerts = num(res?.probe_alerts);
  if (rows === null || alerts === null) return { readable: false, error: 'missing residue counts' };
  return {
    readable: true,
    value: {
      faithful_skew: scenarios.faithful_skew,
      genuine_regression: scenarios.genuine_regression,
      residue: { fixture_rows: rows, probe_alerts: alerts },
    },
  };
}

// ── THE DECISIONS, pure and executable ──────────────────────────────────────────────────────────

/**
 * 1. The scenario is still the false positive it claims to reproduce — alert 466's size, its
 *    fraction, and a flat table-wide baseline far enough below it that the PRE-FIX predicate trips.
 */
export function shapeVerdict(a: Answer<Probe>): Verdict {
  if (!a.readable) return { pass: false, reason: `UNREADABLE — ${a.error}` };
  const s = a.value.faithful_skew;
  if (s.slice_n !== ALERT_466_SLICE_N) {
    return { pass: false, reason: `touched slice is ${s.slice_n} rows, not alert 466's ${ALERT_466_SLICE_N} — the probe's seed drifted` };
  }
  if (s.slice_frac < ALERT_466_FRAC_RANGE[0] || s.slice_frac > ALERT_466_FRAC_RANGE[1]) {
    return { pass: false, reason: `slice_frac ${s.slice_frac} is outside alert 466's band ${ALERT_466_FRAC_RANGE.join('–')}` };
  }
  if (s.slice_frac < s.flat_baseline_frac + REGRESSION_MARGIN) {
    return {
      pass: false,
      reason: `the PRE-FIX predicate would NOT trip on this fixture (slice ${s.slice_frac} < flat ${s.flat_baseline_frac} + ${REGRESSION_MARGIN}) — `
        + 'the scenario has been softened into one that proves nothing',
    };
  }
  return { pass: true, reason: `slice_n=${s.slice_n} slice_frac=${s.slice_frac} vs flat ${s.flat_baseline_frac} — the pre-fix predicate trips, as it did on run 32382` };
}

/** 2. THE REGRESSION ASSERTION: the composite baseline absorbs that skew and the check stays quiet. */
export function compositeVerdict(a: Answer<Probe>): Verdict {
  if (!a.readable) return { pass: false, reason: `UNREADABLE — ${a.error}` };
  const s = a.value.faithful_skew;
  if (s.tripped) {
    return {
      pass: false,
      reason: `a faithful type-composition skew TRIPPED (${s.checks.join(', ') || 'no reason recorded'}) — the composite per-property_type `
        + 'baseline is gone from mon_check_run_field_ranges and alert 466 is back',
    };
  }
  if (s.checks.length) return { pass: false, reason: `it returned false but still recorded ${s.checks.join(', ')}` };
  return { pass: true, reason: 'no trip and no reason recorded on a slice the flat baseline would have failed' };
}

/** 3. The check is still sensitive to a REAL regression, and trips for the right reason. */
export function sensitivityVerdict(a: Answer<Probe>): Verdict {
  if (!a.readable) return { pass: false, reason: `UNREADABLE — ${a.error}` };
  const s = a.value.genuine_regression;
  if (!s.tripped) {
    return { pass: false, reason: 'an all-null touched slice did NOT trip — the composite baseline has made check (a) blind' };
  }
  if (!s.checks.includes('rent_price_null_regression')) {
    return { pass: false, reason: `it tripped, but on ${s.checks.join(', ') || 'nothing recorded'} — not the null-price regression this scenario builds` };
  }
  return { pass: true, reason: `slice_frac=${s.slice_frac} vs baseline ${s.flat_baseline_frac} raised ${s.checks.join(', ')}` };
}

/** 4. The probe committed nothing: no fixture rows, no fabricated alert anybody would be paged for. */
export function residueVerdict(a: Answer<Probe>): Verdict {
  if (!a.readable) return { pass: false, reason: `UNREADABLE — ${a.error}` };
  const r = a.value.residue;
  if (r.fixture_rows !== 0) return { pass: false, reason: `${r.fixture_rows} synthetic row(s) survived the probe — the rollback is not rolling back` };
  if (r.probe_alerts !== 0) {
    return { pass: false, reason: `${r.probe_alerts} fabricated alert_event row(s) were committed — run_field_range has no resolver, so each one is permanent` };
  }
  return { pass: true, reason: 'no fixture rows and no alert rows left behind' };
}

// ── MUTATION PROOFS — executed against fabricated payloads, not described ───────────────────────
let failures = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) console.log(`  PASS  MUTATION — ${label}`);
  else { failures++; console.error(`  FAIL  MUTATION NOT CAUGHT — ${label}`); }
};

/** The payload production returns today (2026-09-06), used as the negative control. */
const HEALTHY: Probe = {
  faithful_skew: { tripped: false, slice_n: 321, slice_null: 109, slice_frac: 0.339564, flat_baseline_frac: 0.068868, checks: [] },
  genuine_regression: { tripped: true, slice_n: 300, slice_null: 300, slice_frac: 1, flat_baseline_frac: 0.139623, checks: ['rent_price_null_regression'] },
  residue: { fixture_rows: 0, probe_alerts: 0 },
};
const ok = (p: Probe): Answer<Probe> => ({ readable: true, value: p });
const withSkew = (o: Partial<Scenario>): Answer<Probe> => ok({ ...HEALTHY, faithful_skew: { ...HEALTHY.faithful_skew, ...o } });
const withRegression = (o: Partial<Scenario>): Answer<Probe> => ok({ ...HEALTHY, genuine_regression: { ...HEALTHY.genuine_regression, ...o } });
const UNREADABLE: Answer<Probe> = { readable: false, error: 'HTTP 503' };

mustCatch('the composite baseline reverted to flat — alert 466 returning — is DETECTED',
  compositeVerdict(withSkew({ tripped: true, checks: ['rent_price_null_regression'] })).pass === false);
mustCatch('a check gone blind to a real all-null regression is DETECTED',
  sensitivityVerdict(withRegression({ tripped: false, checks: [] })).pass === false);
mustCatch('a trip for the WRONG reason is DETECTED, not read as sensitivity',
  sensitivityVerdict(withRegression({ checks: ['missing_critical_field'] })).pass === false);
mustCatch('a probe seed softened until the pre-fix predicate could not trip is DETECTED',
  shapeVerdict(withSkew({ flat_baseline_frac: 0.30 })).pass === false);
mustCatch('a probe seed that stopped being alert 466\'s size is DETECTED',
  shapeVerdict(withSkew({ slice_n: 40 })).pass === false);
mustCatch('a probe seed whose skew fell out of alert 466\'s band is DETECTED',
  shapeVerdict(withSkew({ slice_frac: 0.10, flat_baseline_frac: 0.0 })).pass === false);
mustCatch('synthetic rows surviving the probe are DETECTED',
  residueVerdict(ok({ ...HEALTHY, residue: { fixture_rows: 4240, probe_alerts: 0 } })).pass === false);
mustCatch('a fabricated alert_event that was actually committed is DETECTED',
  residueVerdict(ok({ ...HEALTHY, residue: { fixture_rows: 0, probe_alerts: 1 } })).pass === false);
mustCatch('a quiet check that still recorded a reason is DETECTED (a contradiction, not a pass)',
  compositeVerdict(withSkew({ checks: ['rent_price_null_regression'] })).pass === false);
mustCatch('an HTTP failure fails EVERY verdict — an outage can never spell "healthy"',
  [shapeVerdict, compositeVerdict, sensitivityVerdict, residueVerdict].every((v) => v(UNREADABLE).pass === false));
mustCatch('a payload missing a scenario is UNREADABLE, not an empty pass',
  parseProbe({ faithful_skew: HEALTHY.faithful_skew, residue: HEALTHY.residue }).readable === false);
mustCatch('a scenario missing its residue counts is UNREADABLE',
  parseProbe({ faithful_skew: HEALTHY.faithful_skew, genuine_regression: HEALTHY.genuine_regression }).readable === false);
mustCatch('a non-boolean tripped is UNREADABLE, never coerced',
  parseProbe({ ...HEALTHY, faithful_skew: { ...HEALTHY.faithful_skew, tripped: 'false' } }).readable === false);

// NEGATIVE CONTROLS. Without these a predicate that simply always failed would satisfy every proof
// above, and the barrier would be worthless in the other direction.
mustCatch('the real production payload PASSES all four verdicts',
  [shapeVerdict, compositeVerdict, sensitivityVerdict, residueVerdict].every((v) => v(ok(HEALTHY)).pass === true));
mustCatch('the real production payload parses',
  parseProbe(HEALTHY as unknown).readable === true);

if (failures > 0) {
  console.error(`✗ ${failures} mutation proof(s) failed — the predicates do not discriminate.`);
  process.exit(1);
}

// ── THE LIVE READ ───────────────────────────────────────────────────────────────────────────────
async function readProbe(): Promise<Answer<Probe>> {
  let last: Answer<Probe> = { readable: false, error: 'never attempted' };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/ops_probe_field_range_composite`, {
        method: 'POST',
        headers: HEADERS,
        body: '{}',
      });
      const text = await res.text();
      if (res.status !== 200) {
        last = { readable: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      } else {
        try { last = parseProbe(JSON.parse(text)); } catch { last = { readable: false, error: `body was not JSON: ${text.slice(0, 200)}` }; }
        if (last.readable) return last;
      }
    } catch (e) {
      last = { readable: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  return last;
}

const probe = await readProbe();

const results: [string, Verdict][] = [
  ['the fixture still reproduces alert 466 (the pre-fix predicate trips on it)', shapeVerdict(probe)],
  ['a faithful per-type skew does NOT trip mon_check_run_field_ranges', compositeVerdict(probe)],
  ['a genuine all-null regression still DOES trip it, as rent_price_null_regression', sensitivityVerdict(probe)],
  ['the probe committed no synthetic rows and no fabricated alert', residueVerdict(probe)],
];

let bad = 0;
for (const [label, v] of results) {
  if (v.pass) console.log(`  PASS  ${label} (${v.reason})`);
  else { bad++; console.error(`  FAIL  ${label}: ${v.reason}`); }
}

if (bad > 0) {
  console.error(`\n✗ ${bad} check(s) failed — mon_check_run_field_ranges' composite null-price baseline is not behaving`);
  console.error('  as 20260821031350 left it. A REVERTED composite means every type-skewed city sweep raises a');
  console.error('  false run_field_range alert again (alert 466, run 32382) — and run_field_range has no');
  console.error('  resolver, so each one stays open forever. A BLIND check means a real parse regression ships');
  console.error('  unseen. Fix the function; never soften the probe\'s seed to make this green.');
  process.exit(1);
}

console.log('\n✓ the composite per-property_type null-price baseline holds, and check (a) is still sensitive');
