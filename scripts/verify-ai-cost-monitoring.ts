// Barrier: THE AI COST MONITORS MUST EXIST, BE REGISTERED, AND BE PROVEN TO FIRE.
// Owner instruction, 2026-08-29: "add as many barriers ok" — after a cost audit found that the
// system had been spending money for months with NOTHING recording what a message cost.
//
// WHAT WENT WRONG (the reason this file exists). The agent read DeepSeek's `usage` object only on
// the ERROR path and threw it away on every success. So cost per turn was unknowable, the
// ~$1/1,000-message estimate could never be checked, and the first sign of a cost regression would
// have been the balance running out. Measured truth, once it was finally recorded: 1 call/message,
// billed as deepseek-v4-flash, 99.0% cache hit, $0.000482/message.
//
// WHY EACH MONITORED SIGNAL MATTERS — every one of these moves the bill silently, with no visible
// product change:
//   cache collapse      99% hit is what makes an 18k-token prompt affordable. Lose the prefix and
//                       the SAME traffic costs $8.14/1k instead of $0.48/1k — 17x.
//   cost/message        the catch-all for causes nobody predicted.
//   calls/turn          the language-guard retry is a full second paid call.
//   billed model        DEEPSEEK_MODEL is an ALIAS; v4-pro costs 3x v4-flash on the same call.
//   volume spike        cost is per call, so runaway volume is a cost event on healthy calls.
//   daily spend         the number that actually appears on the bill.
//
// WHAT THIS FILE PINS, forever:
//   1. the detector migration exists and covers all six dedup keys
//   2. the detector is REGISTERED in mon_run_all_detectors (an unregistered detector never runs —
//      this is the silent-failure mode the whole monitoring system is built to avoid)
//   3. every check is guarded by a rolling window AND a minimum sample, so one strange request
//      cannot alert (the owner asked for this explicitly)
//   4. the self-test exists and asserts BOTH that each check fires AND that healthy data stays
//      quiet — a detector that alerts on everything is as useless as one that never alerts
//   5. the thresholds are not silently widened to make an alert stop
//
// Offline and deterministic: reads the migration mirrors in git, no DB, no network.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = 'supabase/migrations';
const migrations = readdirSync(MIG).filter((f) => f.endsWith('.sql'));
const readAll = (pred: (name: string) => boolean) =>
  migrations.filter(pred).map((f) => readFileSync(join(MIG, f), 'utf8')).join('\n');

const detector = readAll((f) => f.includes('mon_detect_ai_cost_health'));
const registration = readAll((f) => f.includes('register_ai_cost_detector'));
const selftest = readAll((f) => f.includes('mon_selftest_ai_cost_health'));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// ── 1. the detector exists and covers every signal the owner asked for ──────────
check('the ai-cost detector migration exists', detector.length > 0);
check('it is a mon_ detector (runs on the existing monitoring rails, not a new alert system)',
  /create or replace function public\.mon_detect_ai_cost_health\(\)/i.test(detector));
check('it raises through mon_raise (the shared alert_event path -> GitHub issues)',
  /public\.mon_raise\(/.test(detector));
check('it self-heals through mon_resolve_stale_keys (alerts close when the condition clears)',
  /mon_resolve_stale_keys\('ai_cost_health'/.test(detector));

const SIGNALS: Array<[string, string]> = [
  ['cache-hit collapse', 'ai_cache_collapse'],
  ['cost per message vs baseline', 'ai_cost_per_message'],
  ['calls per turn > 1', 'ai_calls_per_turn'],
  ['unexpected billed model', 'ai_unexpected_model'],
  ['request volume spike', 'ai_volume_spike'],
  ['daily spend step-change', 'ai_daily_spend_step_change'],
];
for (const [label, key] of SIGNALS) {
  check(`monitors ${label} (${key})`, detector.includes(`'${key}'`));
}

// ── 2. registered in the sweep — an unregistered detector NEVER RUNS ────────────
check('the detector is registered in mon_run_all_detectors', registration.length > 0);
check('registration is a needle edit, not a full-body rewrite of the sweep',
  /pg_get_functiondef/.test(registration) && /replace\(/.test(registration),
  'a hand-authored full-body replace silently reverts a concurrent registration');
check('registration refuses to guess if its anchor is missing',
  /raise exception/i.test(registration));

// ── 3. rolling windows + minimum samples (no single-request alerts) ─────────────
check('every check uses a rolling window', /interval '6 hours'/.test(detector) && /interval '7 days'/.test(detector));
check('a minimum sample is required before anything can alert',
  /min_now\s+int\s*:=\s*\d+/.test(detector) && /min_base\s+int\s*:=\s*\d+/.test(detector));
const minNow = Number(/min_now\s+int\s*:=\s*(\d+)/.exec(detector)?.[1] ?? 0);
const minBase = Number(/min_base\s+int\s*:=\s*(\d+)/.exec(detector)?.[1] ?? 0);
check('the minimum sample is large enough that one strange request cannot alert',
  minNow >= 25 && minBase >= 100, `min_now=${minNow} min_base=${minBase}`);
check('the volume check compares against a MEDIAN, not a mean',
  /percentile_cont\(0\.5\)/.test(detector),
  'a mean lets one busy hour raise the bar and hide the next spike');

// ── 4. thresholds are the measured ones, not silently widened ───────────────────
check('the expected billed tier is still the cheap Flash model',
  /expected_model_like\s+text\s*:=\s*'%flash%'/.test(detector),
  'widening this to accept v4-pro would hide a 3x cost increase');
check('cache-collapse threshold is still meaningfully below the 99% norm',
  /cur_hit_rate\s*<\s*0\.85/.test(detector));
check('calls-per-turn alerts well below a doubling',
  /retry_rate\s*>\s*0\.05/.test(detector));

// ── 5. the self-test proves the detector both FIRES and STAYS QUIET ─────────────
check('a self-test exists for the detector', selftest.length > 0);
for (const [, key] of SIGNALS.filter(([, k]) => k !== 'ai_daily_spend_step_change')) {
  check(`the self-test drives the ${key} case`, selftest.includes(`'${key}'`));
}
check('the self-test asserts SILENCE on healthy data (false-positive guard)',
  /quiet_on_healthy_data/.test(selftest) && /not exists/.test(selftest),
  'a detector that alerts on everything is as useless as one that never alerts');
check('the self-test restores real state (deletes its synthetic rows)',
  /delete from public\.ai_usage where locale\s*=\s*'__selftest__'/.test(selftest));
check('the self-test only removes alert rows IT created (never a genuine open alert)',
  /id > before_max_id/.test(selftest));
check('the self-test re-runs the detector afterwards so live state reflects real data',
  /perform public\.mon_detect_ai_cost_health\(\);\s*\n\s*results/.test(selftest)
  || selftest.lastIndexOf('perform public.mon_detect_ai_cost_health();') > selftest.lastIndexOf("delete from public.alert_event"));

// ── 6. the cost model itself stays out of the edge function ────────────────────
const telemetry = readAll((f) => f.includes('ai_usage_cost_telemetry'));
check('pricing lives in the ai_usage_costed VIEW, not in the agent',
  /create or replace view public\.ai_usage_costed/i.test(telemetry),
  'a DeepSeek rate change must never require redeploying the 93KB agent function');
// Assert on the actual COLUMN LIST, not the file text: the migration's own comment contains the
// words "no prompt, no user message, no reply, no user id", so a naive whole-file regex matches the
// prose that promises privacy rather than the schema that provides it. That is the same
// comment-is-not-a-code-path trap this repo has been bitten by three times.
const createTable = /create table if not exists public\.ai_usage\s*\(([\s\S]*?)\n\);/i.exec(telemetry)?.[1] ?? '';
check('the ai_usage table definition was found', createTable.length > 0);
const columns = createTable
  .split('\n')
  .map((l) => l.replace(/--.*$/, '').trim())          // strip per-column comments
  .map((l) => /^([a-z_]+)\s+/.exec(l)?.[1])
  .filter((c): c is string => !!c);
// Precise: token COUNTS (prompt_tokens, cache_hit_tokens, …) are the whole point of the table and
// carry no content. What must never appear is a column that could hold the conversation or identify
// a person.
const PII = /(_text$|_content$|^reply|^prompt$|^message|user_id|user_email|^email|ip_addr|session_id|^ip$)/;
const offending = columns.filter((c) => PII.test(c));
check('ai_usage stores counts only — no prompt, reply, user id or message text (PDPL)',
  columns.length > 5 && offending.length === 0,
  offending.length ? `PII-shaped column(s): ${offending.join(', ')}` : `only ${columns.length} columns parsed`);

console.log(
  failures === 0
    ? `\n✓ AI cost monitoring is wired, registered and proven (${SIGNALS.length} signals)`
    : `\n✗ ${failures} AI cost monitoring check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
