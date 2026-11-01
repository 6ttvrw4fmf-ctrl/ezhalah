// 🦅 Falcon 2026-10-09 — the three heaviest hourly-sweep detectors stay behind the ~20 h gate.
//
// Measured over 48 sweeps (ops_detector_timing, 2026-10-07 → 10-09): mon_detect_price_source_mismatch
// p50 68 s / max 307 s, mon_detect_qa_oracle_combined_scope p50 33 s / max 164 s,
// mon_detect_af_tri_state_violations p50 31 s / max 185 s — ~2.5 minutes of a ~10-minute sweep that
// runs at :59 on a 2-vCPU database, during which the user-facing search RPC ran 3–5× slower
// (ops_search_latency_sample). Migration 20261009202418 inserted the sanctioned
// mon_claim_daily_slot() gate as each function's FIRST statement, by a fail-closed needle edit.
//
// This guard pins the committed migration's shape so a later "cleanup" cannot quietly turn the gate
// off for one of the three, disarm the anchor count that makes the rewrite refuse on an unexpected
// body, or drop the post-check. It is offline and hermetic; the live half is the production robot
// mon_detect_ungated_expensive_detector (p90 ceiling 45 s per detector), which re-measures the cost
// every sweep and raised the two alerts (8480, 8863) this migration answers.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = 'supabase/migrations/20261009202418_gate_three_heaviest_sweep_detectors.sql';
const DETECTORS = [
  'mon_detect_price_source_mismatch',
  'mon_detect_qa_oracle_combined_scope',
  'mon_detect_af_tri_state_violations',
];

/** Pure: every way the committed migration could stop gating all three detectors safely. */
export function problems(sql: string): string[] {
  const out: string[] = [];
  for (const d of DETECTORS) {
    if (!sql.includes(`('${d}',`)) out.push(`${d} is no longer in the migration's (fn, anchor) list`);
  }
  const gateCalls = sql.split('mon_claim_daily_slot(%L)').length - 1;   // the rewrite + the post-check
  if (gateCalls < 2) out.push(`the gate call mon_claim_daily_slot(%L) appears ${gateCalls}× (needs the rewrite AND the post-check)`);
  if (!/if not public\.mon_claim_daily_slot\(%L\) then\\n\s+return 0;/.test(sql) && !sql.includes('then\\n    return 0;'))
    out.push('the gate no longer returns 0 when the slot is not claimed');
  if (!sql.includes("position('mon_claim_daily_slot' in src) > 0")) out.push('the "already gated" refusal is gone (would gate twice)');
  if (!/if n <> 1 then\s*\n\s*raise exception/.test(sql)) out.push('the anchor-count assertion (exactly 1 match, else refuse) is disarmed');
  if (!sql.includes("raise exception 'post-check:")) out.push('the post-check that every function is gated after the rewrite is gone');
  for (const d of DETECTORS) {
    if (!sql.includes(`'${d}'`) ) out.push(`${d} missing from the post-check list`);
  }
  return out;
}

const sql = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const live = problems(sql);
if (live.length) {
  console.error(`✗ ${FILE}:\n  - ${live.join('\n  - ')}`);
  process.exit(1);
}

let failures = 0;
const mustCatch = (what: string, mutated: string) => {
  const p = problems(mutated);
  if (p.length === 0) { console.error(`✗ mutation NOT caught: ${what}`); failures++; }
  else console.log(`  ✓ caught: ${what} → ${p[0]}`);
};
mustCatch('one detector dropped from the gate list',
  sql.replace("('mon_detect_price_source_mismatch',", "('mon_detect_price_source_mismatch_x',"));
mustCatch('gate call removed from the rewrite', sql.replace('mon_claim_daily_slot(%L)', 'mon_claim_daily_slot_disabled(%L)'));
mustCatch('gate call removed everywhere', sql.replaceAll('mon_claim_daily_slot(%L)', 'mon_claim_daily_slot_disabled(%L)'));
mustCatch('gate returns nothing (detector keeps running)', sql.replace('then\\n    return 0;', 'then\\n    null;'));
mustCatch('already-gated refusal removed', sql.replace("position('mon_claim_daily_slot' in src) > 0", 'false'));
mustCatch('anchor-count assertion disarmed', sql.replace('if n <> 1 then', 'if n < 0 then'));
mustCatch('post-check removed', sql.replace("raise exception 'post-check:", "raise notice 'post-check:"));
if (failures) process.exit(1);
console.log(`✓ verify-heaviest-sweep-detectors-stay-gated: ${DETECTORS.length} detectors gated in ${FILE}, 7 mutations caught`);
