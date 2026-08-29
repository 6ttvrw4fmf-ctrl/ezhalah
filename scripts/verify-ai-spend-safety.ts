// Barrier: AI SPEND MUST FAIL CLOSED.
// Owner ruling, 2026-08-29: "A bug may degrade the AI temporarily, but no bug should ever be allowed
// to silently bankrupt us. Quality can fail soft; spending must fail closed."
//
// WHAT WENT WRONG BEFORE. For months nothing recorded what a message cost, so the ~$1/1,000-message
// estimate could never be checked and the first sign of a cost regression would have been the
// balance running out. Then an audit found most agent traffic was not users at all — CI journeys
// were driving the paid model on every pull request.
//
// WHAT THIS FILE PINS — the layers that make a runaway structurally impossible, not merely noticed:
//   1. a circuit breaker on the ONLY choke point, checked BEFORE every paid call
//   2. that gate failing CLOSED (an unreachable ceiling is an unbounded one)
//   3. a model allowlist refusing an expensive tier BEFORE spending, not after
//   4. the DeepSeek prefix-cache invariant (losing it is 17x on identical traffic)
//   5. every paid call writing cost telemetry
//   6. CI paid calls bounded, labelled, and off by default
//   7. caller attribution, so "is this spend real users?" is answerable
//
// Offline and deterministic: reads source + migrations, no DB, no network.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const AGENT = 'supabase/functions/agent/index.ts';
const agent = readFileSync(AGENT, 'utf8');
const MIG = 'supabase/migrations';
const migrations = readdirSync(MIG).filter((f) => f.endsWith('.sql'));
const sqlOf = (pred: (n: string) => boolean) =>
  migrations.filter(pred).map((f) => readFileSync(join(MIG, f), 'utf8')).join('\n');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// ── 1. THE CHOKE POINT: the gate is checked before the paid fetch ───────────────
// Order matters absolutely. If the gate check sits AFTER the fetch, the money is already spent.
const runModelIdx = agent.indexOf('const runModel = async');
const fetchIdx = agent.indexOf('fetch(DEEPSEEK_URL', runModelIdx);
const gateIdx = agent.indexOf('await spendGate(', runModelIdx);
check('the agent has a spend gate', gateIdx > -1);
check('the gate is checked BEFORE the paid DeepSeek fetch',
  gateIdx > -1 && fetchIdx > -1 && gateIdx < fetchIdx,
  'a gate after the request cannot prevent the spend');
check('a denied gate returns without calling DeepSeek',
  /if \(!g(?:ate)?\.allow\)[\s\S]{0,400}return \{ __err/.test(agent));
// The gate must be re-checked PER ATTEMPT: the retry re-sends the identical ~18k prompt at full
// price, and a ceiling can be crossed between attempt 0 and attempt 1.
const loopStart = agent.indexOf('for (let attempt = 0;', runModelIdx);
check('the gate is re-checked inside the retry loop, not once per turn',
  loopStart > -1 && agent.indexOf('await spendGate(', loopStart) > loopStart
    && agent.indexOf('await spendGate(', loopStart) < agent.indexOf('fetch(DEEPSEEK_URL', loopStart));
check('a FAILED attempt is still cost-logged (ai_usage must not undercount when calls fail)',
  /http_status: r\.status/.test(agent),
  'without this, a 402/5xx call is transmitted, possibly billed, and invisible to the breaker');

// There must be exactly ONE place that pays. More than one means the gate can be bypassed.
const paidFetches = (agent.match(/fetch\(DEEPSEEK_URL/g) ?? []).length;
check('there is exactly ONE paid DeepSeek fetch site (nothing can route around the gate)',
  paidFetches === 1, `found ${paidFetches}`);

// ── 2. FAIL CLOSED ─────────────────────────────────────────────────────────────
const gateFn = agent.slice(agent.indexOf('async function spendGate'), agent.indexOf('// ── DETERMINISTIC CATALOG'));
check('the gate client exists', gateFn.length > 0);
check('gate: missing credentials => DENY', /!SUPABASE_URL \|\| !SERVICE_KEY[\s\S]{0,200}allow: false/.test(gateFn));
check('gate: non-OK HTTP => DENY', /!r\.ok[\s\S]{0,120}allow: false/.test(gateFn));
check('gate: a thrown error => DENY', /catch[\s\S]{0,200}allow: false/.test(gateFn));
check('gate: an unrecognised response shape => DENY',
  /typeof g\.allow !== "boolean"[\s\S]{0,120}allow: false/.test(gateFn));
check('gate: has a timeout so a hung RPC cannot hang the turn open',
  /AbortController|GATE_TIMEOUT_MS/.test(gateFn));
check('gate: NOT cached (a cached allow is how a runaway keeps running)',
  !/_gateCache|cacheAt|cached/i.test(gateFn));

// ── 3. EXPENSIVE MODEL FAIL-CLOSED ─────────────────────────────────────────────
check('an allowlist of payable models exists', /const ALLOWED_MODELS\s*=/.test(agent));
check('the allowlist is checked BEFORE the paid fetch',
  agent.indexOf('ALLOWED_MODELS.includes') > -1 && agent.indexOf('ALLOWED_MODELS.includes') < fetchIdx);
check('a non-allowlisted model is REFUSED, not merely reported',
  /!ALLOWED_MODELS\.includes\(DEEPSEEK_MODEL\)[\s\S]{0,300}return \{ __err/.test(agent));
check('the allowlist does not contain an expensive tier',
  !/ALLOWED_MODELS\s*=\s*\[[^\]]*pro[^\]]*\]/i.test(agent),
  'v4-pro is 3x v4-flash on the identical call');

// ── 4. PROMPT-CACHE INVARIANT ──────────────────────────────────────────────────
// 99% cache hit is what makes an 18k-token prompt cost $0.00025/message. Anything dynamic ahead of
// SYSTEM breaks every cache entry and the same traffic costs 17x.
check('the system message is SYSTEM first, then per-turn text',
  /\{ role: "system", content: SYSTEM \+ sysExtra \+ JSON_SHAPE_HINT \}/.test(agent),
  'per-turn content must come AFTER SYSTEM, never before or inside it');
const sysMsgIdx = agent.indexOf('{ role: "system", content: SYSTEM');
const messagesIdx = agent.indexOf('const messages = [', runModelIdx);
check('the system message is the FIRST message in the array',
  messagesIdx > -1 && sysMsgIdx > messagesIdx && sysMsgIdx - messagesIdx < 700);
check('the cache-prefix invariant is documented where it can be broken',
  /CACHE PREFIX INVARIANT/.test(agent));

// ── 5. EVERY PAID CALL IS COST-LOGGED ──────────────────────────────────────────
check('usage telemetry is written', /logUsage\(\{/.test(agent));
check('telemetry records the model DeepSeek actually billed', /model: data\?\.model/.test(agent));
check('telemetry records the cache split', /cache_hit_tokens|prompt_cache_hit_tokens/.test(agent));
check('telemetry records caller attribution', /source: clientSource/.test(agent));
check('telemetry is fire-and-forget (it can never fail a user turn)',
  /function logUsage[\s\S]{0,900}catch/.test(agent));

// ── 6. RETRY LOOPS CANNOT MULTIPLY PAID CALLS WITHOUT BOUND ────────────────────
const retryLoop = /for \(let attempt = 0; attempt < (\d+); attempt\+\+\)/.exec(agent);
check('the HTTP retry loop is bounded', !!retryLoop, 'unbounded retries multiply spend');
check('the HTTP retry bound is small (<= 2 attempts)',
  !!retryLoop && Number(retryLoop[1]) <= 2, retryLoop ? `attempts=${retryLoop[1]}` : '');
const langRetries = (agent.match(/await runModel\(/g) ?? []).length;
check('at most 2 runModel call sites (one turn + one language guard)',
  langRetries <= 2, `found ${langRetries}`);

// ── 7. CI PAID CALLS: bounded, labelled, off by default ────────────────────────
const audit = readFileSync('scripts/check_audit_invariants.py', 'utf8');
check('the nightly live-agent check has a per-run paid-call budget',
  /MAX_PAID_AGENT_CALLS_PER_RUN\s*=\s*\d+/.test(audit));
check('that budget actually refuses when exhausted',
  /_paid_agent_calls >= MAX_PAID_AGENT_CALLS_PER_RUN[\s\S]{0,300}raise RuntimeError/.test(audit));
check('the nightly live-agent check labels itself as CI traffic',
  /"x-ezhalah-client":\s*"ci"/.test(audit));

const smoke = readFileSync('scripts/verify-web-runtime-smoke.mjs', 'utf8');
check('the PER-PULL-REQUEST smoke makes ZERO paid AI calls (the agent call is stubbed)',
  /page\.route\('\*\*\/functions\/v1\/agent'/.test(smoke),
  'this ran a real billed classification on every PR');

const afLive = readFileSync('scripts/verify-af-agent-cta-live.ts', 'utf8');
check('the AF live check has a per-run paid-call budget',
  /MAX_PAID_CALLS_PER_RUN/.test(afLive));
check('that budget is enforced on every billed send, including retries',
  /budgetedPaidCall\(\);\s*\n\s*await page\.keyboard\.press\('Enter'\)/.test(afLive));
check('the AF live check runs a reduced journey set by default',
  /AF_LIVE_FULL[\s\S]{0,400}ALL_JOURNEYS\.slice\(0, 1\)/.test(afLive));

const parity = readFileSync('e2e/ui-parity.spec.ts', 'utf8');
const paidTests = (parity.match(/test\.skip\(!ALLOW_PAID_AI/g) ?? []).length;
check('every paid live-model e2e test is skipped unless explicitly enabled',
  paidTests >= 2, `${paidTests} gated`);
check('paid e2e tests are OFF by default (opt-in via EZHALAH_ALLOW_PAID_AI)',
  /const ALLOW_PAID_AI = process\.env\.EZHALAH_ALLOW_PAID_AI === '1'/.test(parity));

// ── 8. THE BREAKER ITSELF: config, state, gate, reset, self-test ───────────────
const guardSql = sqlOf((f) => f.includes('ai_spend'));
check('spend ceilings live in ONE documented config table', /create table if not exists public\.ai_spend_config/.test(guardSql));
check('ceilings are data, not hardcoded in the edge function',
  !/max_calls_per_hour\s*[:=]\s*\d+/.test(agent),
  'a limit baked into the 93KB function cannot be tuned without a redeploy');
check('breaker state is persisted separately from config', /create table if not exists public\.ai_spend_state/.test(guardSql));
check('the gate trips on a rolling window, not a single call', /interval '1 hour'|interval '24 hours'/.test(guardSql));
check('the gate refuses to trip below a minimum sample',
  /min_calls_before_trip/.test(guardSql), 'one spike must not shut off legitimate usage');
check('a trip raises a P0 through the EXISTING monitoring system',
  /mon_raise\('P0', 'ai_spend_guard'/.test(guardSql));
check('an open breaker STAYS open (no silent self-heal back into spending)',
  /if s\.state = 'open' then[\s\S]{0,260}allow', false/.test(guardSql));
check('resuming paid calls requires a controlled reset', /create or replace function public\.ai_spend_reset/.test(guardSql));
check('reset REFUSES while the breach is still live',
  /not p_force and \(h_calls > c\.max_calls_per_hour/.test(guardSql));
check('a self-test proves the breaker actually trips',
  sqlOf((f) => f.includes('selftest_ai_spend_guard')).length > 0);

// ── 9. TELEMETRY FAILURE IS ITSELF ALERTED ─────────────────────────────────────
const telem = sqlOf((f) => f.includes('ai_telemetry_silent') || f.includes('telemetry'));
check('a detector alerts when cost telemetry stops recording',
  /mon_detect_ai_telemetry_health/.test(telem),
  'every guard here reads ai_usage; if it goes silent they all read healthy while blind');
check('it uses an INDEPENDENT witness (agent_health_event) to know the agent is live',
  /agent_health_event/.test(telem));

// ── 10. THE DASHBOARD ──────────────────────────────────────────────────────────
const dash = sqlOf((f) => f.includes('dashboard') || f.includes('telemetry'));
check('an operational dashboard answers spend/calls/cache/model/breaker in one call',
  /create or replace function public\.ai_cost_dashboard/.test(dash));
for (const field of ['usd_last_1h', 'usd_today_utc', 'by_source_24h', 'calls_per_user_turn_24h',
                     'cache_hit_pct_24h', 'models_billed_24h', 'circuit_breaker', 'open_ai_cost_alerts']) {
  check(`the dashboard reports ${field}`, dash.includes(field));
}

console.log(
  failures === 0
    ? '\n✓ AI spend fails closed: gated, allowlisted, cache-pinned, logged, CI-bounded'
    : `\n✗ ${failures} AI spend safety check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
