// Monitoring-meta barrier (2026-11-04). Four alarms about the alarms, one shape underneath: a monitor
// that judges against the wrong evidence, or never reaches its own resolve call.
//
//   1. cron_scheduler_frozen flapped 5× in one night (alert_flapping). mon_cron_frozen_jobs() measured
//      a job's period as the 7-day median of its runs. When the cron rebalance moved jobid 105 from
//      every 4 min to "13,41,49,57 * * * *", the honest 28-minute gap read as "6.8 periods missed".
//      RULE: the cadence is read only from runs since ops_cron_job_first_seen.schedule_changed_at,
//      and the overdue line is never shorter than the CURRENT schedule's longest gap + 3 periods.
//   2. mon_detect_rent_tiny_gate_reverted could raise and never resolve (unresolvable_detector).
//   3. duplicate_card_surface_routed had no resolver at all (unresolvable_alert_kind); the
//      url-collision sweep is now its resolver.
//   4. stuck_open_alert: mark_stale_listings_inactive() `continue`d past its circuit breaker before
//      it reached stale_listings_detected / stale_coverage_gate, so keys sat open, unaffirmed, for
//      up to 15 days. RULE: both keys are raised-or-resolved before the first `continue`.
//
// Hermetic: reads only committed migrations. Each rule is checked on the LATEST committed definition
// and must FAIL on the previous one (the mutation proof). Rule 1 additionally EXECUTES a TS
// transcription of the overdue predicate and of mon_cron_max_gap_s on the real 2026-11-04 scenario.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
/** A mutation proof: `caught` runs the guard's predicate against the PREVIOUS (defective) definition. */
const mutation = (name: string, caught: () => boolean) => check(`(mutation) ${name}`, caught());

/** Body of the definition of `fn` inside one migration file (from CREATE to the closing $function$). */
function bodyIn(file: string, fn: string): string | null {
  const sql = readFileSync(join(MIG, file), 'utf8');
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'ig');
  const hits = [...sql.matchAll(re)];
  if (!hits.length) return null;
  const start = hits.at(-1)!.index!;
  const rest = sql.slice(start);
  const tag = rest.match(/as\s+(\$[a-z_]*\$)/i);
  if (!tag) return null;
  const open = rest.indexOf(tag[1]);
  const close = rest.indexOf(tag[1], open + tag[1].length);
  return close < 0 ? null : rest.slice(0, close + tag[1].length);
}
/** [latest, previous] committed definitions of `fn`. */
function defs(fn: string): { file: string; body: string }[] {
  const out: { file: string; body: string }[] = [];
  for (const f of files) {
    const b = bodyIn(f, fn);
    if (b) out.push({ file: f, body: b });
  }
  return out.reverse();
}

// ── 1. cron frozen ────────────────────────────────────────────────────────────────────────────────
console.log('1. cron_scheduler_frozen judges a job by its CURRENT schedule');

/** TS transcription of public.mon_cron_max_gap_s — minutes field of "<m> * * * *" only. */
export function maxGapS(schedule: string): number | null {
  const p = schedule.trim().split(/\s+/);
  if (p.length !== 5 || p.slice(1).some((x) => x !== '*')) return null;
  if (!/^(\*|[0-9]+)(-[0-9]+)?(\/[0-9]+)?(,(\*|[0-9]+)(-[0-9]+)?(\/[0-9]+)?)*$/.test(p[0])) return null;
  const hits: number[] = [];
  for (let m = 0; m < 60; m++) {
    for (const item of p[0].split(',')) {
      const [base, stepS] = item.split('/');
      const step = stepS === undefined ? 1 : Number(stepS);
      if (!(step >= 1)) return null;
      let s: number, e: number;
      if (base === '*') { s = 0; e = 59; }
      else if (base.includes('-')) { [s, e] = base.split('-').map(Number); }
      else { s = Number(base); e = stepS === undefined ? s : 59; }
      if (s >= 0 && e <= 59 && s <= e && m >= s && m <= e && (m - s) % step === 0) { hits.push(m); break; }
    }
  }
  if (!hits.length) return null;
  let gap = hits[0] + 60 - hits[hits.length - 1];
  for (let i = 1; i < hits.length; i++) gap = Math.max(gap, hits[i] - hits[i - 1]);
  return gap * 60;
}

type FrozenRule = { historySinceChange: boolean; usesScheduleGap: boolean };
function frozenRuleFrom(body: string): FrozenRule {
  return {
    historySinceChange: /schedule_changed_at/.test(body) && /start_time\s*>\s*s\.t0/.test(body),
    usesScheduleGap: /mon_cron_max_gap_s\s*\(\s*j\.schedule\s*\)/.test(body) && /greatest\(\s*iv\.med_s\s*\*\s*4\s*,/.test(body),
  };
}
/** Executes the predicate. runs = start times (s, relative to now=0, negative), changedAt = s or null. */
function frozen(rule: FrozenRule, schedule: string, runs: number[], changedAt: number | null): boolean {
  const t0 = rule.historySinceChange && changedAt !== null ? changedAt : -7 * 86400;
  const hist = runs.filter((t) => t > t0).sort((a, b) => a - b);
  const iv = hist.slice(1).map((t, i) => t - hist[i]).sort((a, b) => a - b);
  if (iv.length < 10) return false;
  const med = iv.length % 2 ? iv[(iv.length - 1) / 2] : (iv[iv.length / 2 - 1] + iv[iv.length / 2]) / 2;
  if (med > 5400) return false;
  const gap = rule.usesScheduleGap ? maxGapS(schedule) : null;
  const line = Math.max(med * 4, gap === null ? 0 : gap + med * 3);
  return Math.max(...runs) < -line;
}
/** Start times (s, negative) a schedule fires at in [from, to). Minute field only, hour '*'. */
function fires(minutes: number[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(from / 60) * 60; t < to; t += 60) {
    const m = (((t / 60) % 60) + 60) % 60;
    if (minutes.includes(m)) out.push(t);
  }
  return out;
}
// The 2026-11-04 scenario, aligned so that now = :40 of the hour (the P1 was affirmed at 04:40).
const NOW_MIN = 40;
const shift = (ms: number[]) => ms.map((m) => (m - NOW_MIN + 60) % 60);
const every4 = Array.from({ length: 15 }, (_, i) => i * 4);
const newSched = [13, 41, 49, 57];
const changedAt = -3.7 * 3600; // schedule changed 00:59, judged at 04:40
const job105 = [
  ...fires(shift(every4), -7 * 86400, changedAt),
  ...fires(shift(newSched), changedAt, -27 * 60 + 1), // last run :13, i.e. 27 min ago
];

check('maxGapS("13,41,49,57 * * * *") = 1680 s (the 28-minute :13 -> :41 gap)', maxGapS('13,41,49,57 * * * *') === 1680);
check('maxGapS("*/15 * * * *") = 900 s', maxGapS('*/15 * * * *') === 900);
check('maxGapS("2-59/15 * * * *") = 900 s', maxGapS('2-59/15 * * * *') === 900);
check('maxGapS("59 * * * *") = 3600 s', maxGapS('59 * * * *') === 3600);
check('maxGapS on a non-hourly-cycle schedule is NULL (no guess)', maxGapS('20 4 * * *') === null);

const all = defs('mon_cron_frozen_jobs');
check('mon_cron_frozen_jobs has a committed definition', all.length >= 2, `${all.length} found`);
if (all.length >= 2) {
  const now = frozenRuleFrom(all[0].body);
  const old = frozenRuleFrom(all[1].body);
  check(`${all[0].file}: cadence is read only since the schedule changed`, now.historySinceChange);
  check(`${all[0].file}: overdue line honours the current schedule's longest gap`, now.usesScheduleGap);
  check('jobid 105 after the rebalance (honest 27-min gap) is NOT frozen', !frozen(now, '13,41,49,57 * * * *', job105, changedAt));
  // direction 2: a job that really stopped still raises
  const dead15 = fires(shift([0, 15, 30, 45]),-2 * 86400, -3 * 3600);
  check('a */15 job silent for 3 h IS frozen', frozen(now, '*/15 * * * *', dead15, null));
  const dead105 = fires(shift(newSched), changedAt - 86400, -3 * 3600);
  check('jobid 105 silent for 3 h under its new schedule IS frozen', frozen(now, '13,41,49,57 * * * *', dead105, changedAt - 86400));
  // mutation proof: the previous definition raised the false P1
  mutation(`${all[1].file} flags jobid 105 — the 2026-11-04 false P1`, () => frozen(old, '13,41,49,57 * * * *', job105, changedAt));
}

// ── 2. rent tiny gate resolves on the PASS path ──────────────────────────────────────────────────
console.log('2. mon_detect_rent_tiny_gate_reverted can close what it opens');
const resolvesTiny = (b: string) => /else[\s\S]*mon_resolve_key\(\s*'monitor_integrity'\s*,\s*'rent_tiny_gate_reverted'\s*\)/.test(b);
const tiny = defs('mon_detect_rent_tiny_gate_reverted');
check('latest definition resolves monitor_integrity:rent_tiny_gate_reverted on PASS', !!tiny[0] && resolvesTiny(tiny[0].body), tiny[0]?.file);
mutation(`the previous definition (${tiny[1]?.file}) does not`, () => !!tiny[1] && !resolvesTiny(tiny[1].body));

// ── 3. the routed duplicate-card copy has a resolver ─────────────────────────────────────────────
console.log('3. duplicate_card_surface_routed is closed by the sweep that re-measures it');
const resolvesRouted = (b: string) =>
  /mon_resolve_key\(\s*'duplicate_card_surface_routed'/.test(b) && /v_colliding\s*:=\s*v_colliding\s*\|\|/.test(b);
const coll = defs('mon_detect_url_collisions_res_vs_com');
check('latest url-collision sweep resolves a routed copy, holding it while a named platform collides', !!coll[0] && resolvesRouted(coll[0].body), coll[0]?.file);
mutation(`the previous sweep (${coll[1]?.file}) does not`, () => !!coll[1] && !resolvesRouted(coll[1].body));

// ── 4. the stale sweep judges both keys before any `continue` ────────────────────────────────────
console.log('4. mark_stale_listings_inactive judges its keys on every path');
function keysBeforeContinue(b: string): { ok: boolean; why: string } {
  const firstContinue = b.search(/\bcontinue\s*;/i);
  if (firstContinue < 0) return { ok: false, why: 'no continue found' };
  const need: [string, RegExp][] = [
    ['raise stale_listings_detected', /mon_raise\([^;]*'stale_listings_detected'/],
    ['resolve stale_listings_detected', /mon_resolve_key\(\s*'stale_listings_detected'/],
    ['raise stale_coverage_gate', /mon_raise\([^;]*'stale_coverage_gate'/],
    ['resolve stale_coverage_gate', /mon_resolve_key\(\s*'stale_coverage_gate'/],
  ];
  for (const [what, re] of need) {
    const at = b.search(re);
    if (at < 0 || at > firstContinue) return { ok: false, why: `${what} is ${at < 0 ? 'missing' : 'after the first continue'}` };
  }
  return { ok: true, why: '' };
}
const stale = defs('mark_stale_listings_inactive');
const sNow = stale[0] ? keysBeforeContinue(stale[0].body) : { ok: false, why: 'no definition' };
check(`latest definition (${stale[0]?.file}) raises-or-resolves both keys before the first continue`, sNow.ok, sNow.why);
const sOld = stale[1] ? keysBeforeContinue(stale[1].body) : { ok: true, why: 'no previous definition' };
mutation(`the previous definition (${stale[1]?.file}) is caught`, () => !sOld.ok);
check('the stale sweep still deactivates nothing', !!stale[0] && !/set\s+active\s*=\s*false/i.test(stale[0].body));

if (failures) {
  console.log(`\n❌ verify-monitors-judge-every-path: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✅ verify-monitors-judge-every-path: all checks passed.');
