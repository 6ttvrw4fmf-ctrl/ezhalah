// EVERY SEARCHABLE PLATFORM MUST APPEAR IN **BOTH** ADVANCED-FILTER ATTRIBUTE VIEWS — LIVE HALF.
//
// This is the production-reading half of verify-af-attribute-views-cover-every-platform.ts, split
// out on 2026-09-06 (routine #10, ops_incident #104). The hermetic predicate and its mutation proofs
// stay in the required `npm test`; this file, which can only answer by asking production, runs in
// .github/workflows/loader-active-platforms-check.yml with the other per-platform coverage reads.
//
// WHY IT MOVED — and it is NOT because it was too strict. Measured 2026-09-06:
//   • EXPLAIN ANALYZE ops_af_attribute_coverage(): 9,803 ms execution, 9,930 shared buffers, 40 rows.
//   • Three consecutive anon PostgREST calls: HTTP 200 at 8,971 / 10,076 / 11,283 ms.
//   • The same call from CI at 05:05 UTC: HTTP 500 — a statement timeout, reported by the barrier
//     verbatim as «FAIL the coverage RPC could be reached — HTTP 500 — fails CLOSED».
//   • The privileged call returns all 40 rows, so the FUNCTION IS CORRECT; only its cost is a
//     problem. On a single unchanged commit, `npm test` went RED, GREEN on immediate re-run, RED
//     again.
// A ~10-second production RPC sitting on the statement-timeout boundary cannot decide the required
// status check on an unrelated diff. `npm test`'s verdict must depend only on the diff.
//
// THE FAIL-CLOSED BEHAVIOUR BELOW IS DELIBERATE AND MUST NOT BE WEAKENED. A check that cannot reach
// its subject reports UNKNOWN-as-FAILURE, never a clean bill of health (AGENTS.md: A FAILED FETCH IS
// NOT AN EMPTY ANSWER). Moving it to a home where an unreachable production fails the RIGHT job is
// the repair; making it tolerate unreachability would not be.
//
// The RPC's cost is a real, separate defect and is not this file's to fix: routed as a DB-side
// finding (ops_incident #104 root cause, option (b)) — 9,930 shared buffers for 40 output rows says
// it scans far more than it needs to.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { rpcProbeOutcome, outcomeIsUsable } from './lib/liveHalf.ts';
import {
  attributeViewGaps,
  describeAttributeGaps,
  type AttrCoverageRow,
} from './lib/coverageGaps.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nEvery searchable platform appears in BOTH Advanced Filter attribute views (LIVE)\n');

const { url, key } = resolvePublicSupabase();
const rpc = async (fn: string, body: unknown) => {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const res = await rpc('ops_af_attribute_coverage', {});
// The branch below IS rpcProbeOutcome() — the same function mutation-proven at the foot of this file.
// Branching on raw status codes here would mean the proof exercised a copy of the rule, not the rule.
const outcome = rpcProbeOutcome(res.status);

if (outcome === 'not-shipped') {
  check('ops_af_attribute_coverage exists in production', false,
    'HTTP 404 (PGRST202) — the coverage RPC has not shipped yet. Apply its migration; a check that ' +
    'cannot run must not report success.');
} else if (!outcomeIsUsable(outcome)) {
  check('the coverage RPC could be reached', false, `HTTP ${res.status} — fails CLOSED`);
} else {
  // The predicate is the SHARED one the offline half mutation-proves — never a copy that can drift.
  const rows = (res.json as AttrCoverageRow[]) ?? [];
  const gaps = attributeViewGaps(rows);

  check('every searchable platform is in BOTH listing_rich_attrs and listing_extra_attrs',
    gaps.length === 0, gaps.length ? describeAttributeGaps(gaps) : '');

  // A coverage check that sees zero platforms would pass forever — the "barrier that supplies its
  // own input" failure. Prove the comparison is evaluating the real fleet.
  check('the coverage RPC is evaluating the real fleet (sanity: it still sees platforms)',
    rows.length >= 30, `saw ${rows.length} searchable platforms`);
}

// ── MUTATION PROOF — the fail-closed rule, which is what a LIVE half can actually get wrong ─────
// The coverage predicate itself is mutation-proven in the offline half (it is the SAME imported
// function, not a copy). What only this half can get wrong is the thing AGENTS.md names as the
// repo's largest defect class: a request that FAILED being rendered as a confident negative. So
// that is what is proven here, against the real status codes production returns.
console.log('\n  mutation proof — an unreachable RPC must never read as "no gaps found"\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};
mustCatch('THE MEASURED CASE: HTTP 500 (statement timeout) treated as a clean bill of health',
  outcomeIsUsable(rpcProbeOutcome(500)) === false);
mustCatch('HTTP 404 / PGRST202 — the RPC has not shipped yet — treated as "no gaps"',
  outcomeIsUsable(rpcProbeOutcome(404)) === false);
mustCatch('...and 404 is still DISTINGUISHED from a generic failure (a different repair)',
  rpcProbeOutcome(404) === 'not-shipped');
mustCatch('HTTP 401 (a rotated anon key) treated as a clean bill of health',
  outcomeIsUsable(rpcProbeOutcome(401)) === false);
mustCatch('HTTP 000 — the shape a network-layer failure lands on — treated as usable',
  outcomeIsUsable(rpcProbeOutcome(0)) === false);
mustCatch('a 200 IS usable (the negative control — a rule red for everything guards nothing)',
  outcomeIsUsable(rpcProbeOutcome(200)) === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ every searchable platform reaches the Advanced Filter through both attribute views.\n'
    : `\n❌ ${failed} check(s) failed — a searchable platform is half-wired to the Advanced Filter.\n`,
);
process.exit(failed === 0 ? 0 : 1);
