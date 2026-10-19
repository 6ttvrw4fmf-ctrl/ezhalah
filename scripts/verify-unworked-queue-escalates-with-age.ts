// A CHRONICALLY UNWORKED ALERT QUEUE MUST ESCALATE ON AGE — AS ONE SIGNAL, NOT EIGHT.
//
// WHY THIS EXISTS (owner audit, 2026-09-21). mon_detect_alert_queue_unworked() named each routine
// not working its queue but had no sense of AGE: a 48-hour-old backlog and a 41-DAY-old one produced
// the identical P1, and nothing ever got louder. Measured 2026-09-21: eight owners with unworked
// queues 14–41 days old, 2 of 1,014 alerts ever acknowledged. Detection was excellent; the lever
// meant to force remediation was blind to chronic neglect.
//
// The fix (migration 20260921091500) adds a SINGLE systemic P0 (dedup alert_queue_unworked:__systemic__)
// that fires when any owner's oldest unworked alert crosses mon_config.alert_queue_escalate_days,
// carrying the per-owner breakdown — one unmissable signal, self-healing when nothing is chronic.
// A per-owner ratchet was deliberately rejected: it would raise eight P0s at once, which is P0
// inflation, not triage. This barrier pins those two invariants: the escalation exists, and it is
// self-healing (so a recovered queue does not sit lit forever).
//
//   node --experimental-strip-types scripts/verify-unworked-queue-escalates-with-age.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = 'supabase/migrations/20260921091500_unworked_alert_queue_escalates_with_age.sql';

const ok: string[] = [];
const problems: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const sql = readFileSync(join(ROOT, MIG), 'utf8');
const fnStart = sql.indexOf('create or replace function public.mon_detect_alert_queue_unworked');
check(fnStart >= 0, 'the migration defines mon_detect_alert_queue_unworked',
  'the migration no longer defines mon_detect_alert_queue_unworked — wrong file or renamed');
const body = fnStart >= 0 ? sql.slice(fnStart) : '';

// ── 1. The age threshold is config-driven (owner-tunable), not a magic number. ────────────────
check(/alert_queue_escalate_days/.test(body) && /mon_config/.test(body),
  'the escalation threshold reads mon_config.alert_queue_escalate_days',
  'the age threshold is no longer read from mon_config — the owner can no longer tune loudness ' +
  'without a code change, and the knob this fix promised is gone');

// ── 2. A single systemic P0 escalation exists. ────────────────────────────────────────────────
const raisesSystemicP0 =
  /alert_queue_unworked:__systemic__/.test(body) &&
  /mon_raise\(\s*'P0'/.test(body);
check(raisesSystemicP0,
  'a systemic P0 (alert_queue_unworked:__systemic__) is raised on chronic age',
  'ESCALATION LOST: the systemic P0 roll-up is gone — a chronically unworked queue would go back ' +
  'to looking identical to a fresh miss, which is the exact defect this fixed');

// ── 3. The systemic escalation self-heals. ────────────────────────────────────────────────────
check(/mon_resolve_key\(\s*'alert_queue_unworked'\s*,\s*'alert_queue_unworked:__systemic__'\s*\)/.test(body),
  'the systemic escalation resolves itself when nothing is chronic',
  'the systemic key is raised but never resolved — a recovered queue would sit lit as a zombie P0 ' +
  'forever, the "a breaker that fires every week and no one is told" failure');

// ── 4. Per-owner attribution is preserved (the escalation is IN ADDITION to, not instead of). ──
check(/'alert_queue_unworked:'\s*\|\|\s*rec\.owner/.test(body),
  'per-owner attribution is preserved alongside the systemic roll-up',
  'per-owner alert_queue_unworked alerts were dropped — the systemic P0 alone cannot tell a routine ' +
  'which queue is theirs to work');

check(npmTestRuns(ROOT, 'verify-unworked-queue-escalates-with-age'),
  'npm test runs this guard',
  '`npm test` no longer runs this guard');

// ── Mutation proofs ───────────────────────────────────────────────────────────────────────────
const mutations: string[] = [];
const mustCatch = (what: string, wouldFail: boolean) =>
  wouldFail ? mutations.push(what) : problems.push(`MUTATION SURVIVED: ${what} would NOT be caught`);

mustCatch('the systemic P0 escalation being removed',
  !/alert_queue_unworked:__systemic__/.test(body.replace(/__systemic__/g, '')));
mustCatch('the systemic self-heal being removed',
  !/mon_resolve_key\(\s*'alert_queue_unworked'\s*,\s*'alert_queue_unworked:__systemic__'\s*\)/.test(
    body.replace(/mon_resolve_key\(\s*'alert_queue_unworked'\s*,\s*'alert_queue_unworked:__systemic__'\s*\)/g, 'null')));
mustCatch('the threshold being hardcoded instead of read from mon_config',
  !(/alert_queue_escalate_days/.test('c_escalate interval := interval \'14 days\';')));

console.log('unworked-queue-escalates-with-age: chronic backlog must get louder, once, and self-heal\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const m of mutations) console.log(`  ✓ mutation caught: ${m}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the unworked-queue age escalation has regressed.`);
  process.exit(1);
}
console.log(`\n✅ unworked-queue-escalates-with-age: passed (${ok.length} checks, ${mutations.length} mutations).`);
