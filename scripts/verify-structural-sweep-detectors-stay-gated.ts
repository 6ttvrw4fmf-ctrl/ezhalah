// 🦅 Falcon 2026-10-23 (backlog 327) — the seven heavy STRUCTURAL sweep detectors stay behind the ~20 h gate, and
// every sweep-gate migration is pinned by some barrier.
//
// Migration 20261023204034 moved buy_rent_combined_exactness, shared_default_pin, wasalt_street_width_misread,
// age_resolver_platform_gap, phasea_offregion_pick, city_identity_contract and city_resolution_ignores_region (about
// 112 s of a ~350 s hourly sweep on a 2-vCPU database, measured over 24 sweeps) behind mon_claim_daily_slot(), the
// same fail-closed needle edit verify-heaviest-sweep-detectors-stay-gated.ts pins for the 2026-10-09 three. This
// guard pins the new migration's shape, and DISCOVERS every `*_sweep_detectors.sql` gate migration so a third one
// cannot land without a barrier naming it. Offline and hermetic; the live half is
// mon_detect_ungated_expensive_detector (re-measures cost every sweep) and mon_detect_stalled_daily_detector.
//   node --experimental-strip-types scripts/verify-structural-sweep-detectors-stay-gated.ts   (discovered by `npm test`)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = 'supabase/migrations/20261023204034_gate_seven_heavy_structural_sweep_detectors.sql';
const DETECTORS = [
  'mon_detect_buy_rent_combined_exactness', 'mon_detect_shared_default_pin', 'mon_detect_wasalt_street_width_misread',
  'mon_detect_age_resolver_platform_gap', 'mon_detect_phasea_offregion_pick', 'mon_detect_city_identity_contract',
  'mon_detect_city_resolution_ignores_region',
];
// Liveness detectors must NEVER be gated: a stale index or a dead cron has to page within the hour.
const NEVER_GATE = ['mon_detect_search_index_freshness', 'mon_detect_cron_health'];

export function problems(sql: string): string[] {
  const out: string[] = [];
  for (const d of DETECTORS) {
    const n = sql.split(`'${d}'`).length - 1;
    if (n < 2) out.push(`${d} appears ${n}× (needs the rewrite list AND the post-check list)`);
  }
  for (const d of NEVER_GATE) if (sql.includes(`'${d}'`)) out.push(`${d} is liveness and must stay hourly`);
  if ((sql.split('mon_claim_daily_slot(%L)').length - 1) < 2) out.push('the gate call needs the rewrite AND the post-check');
  if (!sql.includes('then\\n    return 0;')) out.push('the gate no longer returns 0 when the slot is not claimed');
  if (!sql.includes("position('mon_claim_daily_slot' in src) > 0")) out.push('the "already gated" refusal is gone');
  if (!/if n <> 1 then\s*\n\s*raise exception/.test(sql)) out.push('the anchor-count assertion is disarmed');
  if (!/<> 1 then\s*\n\s*raise exception '% is missing or overloaded/.test(sql)) out.push('the overload refusal is gone');
  if (!sql.includes("raise exception 'post-check:")) out.push('the post-check is gone');
  return out;
}

let failures = 0;
const sql = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const live = problems(sql);
if (live.length) { console.error(`✗ ${FILE}:\n  - ${live.join('\n  - ')}`); failures++; }
else console.log(`  ✓ ${FILE}: ${DETECTORS.length} detectors gated, fail-closed`);

const mustCatch = (what: string, mutated: string) => {
  const p = problems(mutated);
  if (p.length === 0) { console.error(`✗ mutation NOT caught: ${what}`); failures++; }
  else console.log(`  ✓ caught: ${what} → ${p[0]}`);
};
mustCatch('one detector dropped', sql.replaceAll("'mon_detect_shared_default_pin'", "'mon_detect_shared_default_pin_x'"));
mustCatch('a liveness detector gated', sql.replace("'mon_detect_city_identity_contract',", "'mon_detect_city_identity_contract', 'mon_detect_cron_health',"));
mustCatch('gate returns nothing', sql.replace('then\\n    return 0;', 'then\\n    null;'));
mustCatch('already-gated refusal removed', sql.replace("position('mon_claim_daily_slot' in src) > 0", 'false'));
mustCatch('anchor-count assertion disarmed', sql.replace('if n <> 1 then', 'if n < 0 then'));
mustCatch('post-check removed', sql.replace("raise exception 'post-check:", "raise notice 'post-check:"));

// Discovery: every sweep-gate migration must be named by some barrier under scripts/.
const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_gate_.*sweep_detectors\.sql$/.test(f));
const scripts = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => /^verify-.*\.ts$/.test(f))
  .map((f) => fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')).join('\n');
const unpinned = (names: string[], corpus: string) => names.filter((m) => !corpus.includes(m));
const orphan = unpinned(migs, scripts);
if (migs.length < 2 || orphan.length) { console.error(`✗ sweep-gate migrations without a barrier: ${orphan.join(', ') || '(discovery found < 2 files)'}`); failures++; }
else console.log(`  ✓ all ${migs.length} sweep-gate migrations are pinned by a barrier`);
// Built at runtime so the probe name never appears literally in the corpus this file is part of.
const probe = ['20991231000000', 'gate', 'one', 'more', 'sweep', 'detectors.sql'].join('_');
if (unpinned([...migs, probe], scripts).length === 0) {
  console.error('✗ mutation NOT caught: a new unpinned sweep-gate migration'); failures++;
} else console.log('  ✓ caught: a new unpinned sweep-gate migration');

if (failures) process.exit(1);
console.log(`✓ verify-structural-sweep-detectors-stay-gated: ${DETECTORS.length} detectors gated, 7 mutations caught`);
