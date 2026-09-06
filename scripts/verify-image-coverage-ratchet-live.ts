// IMAGE COVERAGE IS A RATCHET, AND ONBOARDING AN IMAGELESS PLATFORM IS A RED BUILD — LIVE HALF.
//
// This is the production-reading half of verify-image-coverage-ratchet.ts, split out on 2026-09-06
// (routine #10, ops_incident #104). The predicate — evaluateImageCoverage() in
// scripts/lib/coverageGaps.ts — and its mutation proofs stay in the required `npm test`; this file
// can only answer by reading production's newest snapshot, so it runs in
// .github/workflows/loader-active-platforms-check.yml with the other per-platform coverage reads.
//
// WHY IT MOVED — and it is NOT a weakening. Measured 2026-09-06: main GREEN at 03:00, the PR RED at
// 03:55, on the same tree — because platform `amaall` went live in production in between and was not
// yet in the baseline. That is the ONBOARDING GATE doing exactly its job, but firing at the wrong
// target: it failed an unrelated PR rather than the platform activation that caused it. A gate whose
// verdict is a fact about production's roster cannot decide the required status check on a diff.
//
// THIS HOME IS STRICTLY BETTER FOR THIS RULE, not merely quieter. loader-active-platforms-check.yml
// runs every 6h AND carries a failure→alert_event bridge, so an undeclared platform now reaches a
// human within 6 hours of going live. In `npm test` it reached only whoever happened to open the
// next unrelated PR, who had no context and every incentive to re-run until green.
//
// THE THREE RULES ARE UNCHANGED and still fail closed: freshness (a snapshot >48h old is a FAILURE,
// never a skip — a guard whose input stops arriving is a guard that always passes), the per-platform
// ratchet against scripts/image-coverage-baseline.json, and the onboarding gate. Floors are raised
// when a fix lands and NEVER lowered to clear a red.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { rpcProbeOutcome, outcomeIsUsable } from './lib/liveHalf.ts';
import {
  evaluateImageCoverage,
  type ImageBaseline,
  type ImageCoverageRow,
} from './lib/coverageGaps.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nImage coverage (LIVE): fresh snapshot, every platform at-or-above its floor, no undeclared platform\n');

const baseline: { platforms: Record<string, ImageBaseline> } =
  JSON.parse(readFileSync(join(import.meta.dirname, 'image-coverage-baseline.json'), 'utf8'));

const { url, key } = resolvePublicSupabase();
const r = await fetch(`${url}/rest/v1/rpc/ops_image_coverage_latest`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: '{}',
});

// The branch below IS rpcProbeOutcome() — the same function mutation-proven at the foot of this
// file. Branching on a raw status code here would mean the proof exercised a copy of the rule.
const outcome = rpcProbeOutcome(r.status);
const rows: ImageCoverageRow[] = outcomeIsUsable(outcome) ? await r.json() : [];

if (!outcomeIsUsable(outcome)) {
  check('ops_image_coverage_latest reachable', false, `HTTP ${r.status} — fails CLOSED`);
} else {
  const problems = evaluateImageCoverage(rows, baseline.platforms);
  check('snapshot fresh + every platform at-or-above its committed floor + none undeclared',
    problems.length === 0, problems.join('\n      '));
  check('the snapshot is evaluating the real fleet (sanity: sees >= 30 platforms)',
    rows.length >= 30, `saw ${rows.length}`);
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
    ? '\n✅ image coverage holds its floors; no platform is live undeclared.\n'
    : `\n❌ ${failed} check(s) failed — image coverage regressed, or a platform launched undeclared.\n`,
);
process.exit(failed === 0 ? 0 : 1);
