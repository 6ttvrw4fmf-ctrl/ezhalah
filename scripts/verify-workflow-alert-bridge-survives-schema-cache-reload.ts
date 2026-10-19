// THE LAST-RESORT NOTIFIER MUST WORK IN THE WINDOW WHERE REDS ARE MOST LIKELY (ops_incident #658).
//
// WHAT WAS BROKEN, measured 2026-09-23 23:31:56Z on p0-fast-lane-coverage.yml:
//
//     raise-workflow-alert: mon_raise returned HTTP 503 {"code":"PGRST002"}
//
// scripts/ops/raise-workflow-alert.mjs is the failure→alert_event bridge that all 32 unattended
// workflows end with. It is the ONLY thing that turns a red scheduled run into something a human
// sees. It sent one bare fetch and exited 1 on any non-2xx — so a PostgREST schema-cache reload,
// which is what ANY migration creating or replacing a function triggers, silently cost the run its
// only notification. The bug fires exactly when it hurts most: the same migration that opens the
// reload window is what breaks live checks.
//
// WHY THIS BARRIER EXISTS ALONGSIDE verify-scheduled-checks-alert-on-failure.ts, WHICH ALREADY
// COVERS THIS FILE. That one proves every scheduled workflow is WIRED to the bridge and that each
// invocation is well-formed and routed. Nothing proved the bridge DELIVERS. A pointer read as
// coverage — AGENTS.md PART 1.11, and the reason all five defects of 2026-09-04 had a green
// source-TEXT tripwire over the exact defective line for as long as they were live.
//
// SO THIS BARRIER EXECUTES THE BRIDGE AGAINST A STUB POSTGREST. It never greps. The assertions live
// in problems(send), a pure-ish suite applied to a SENDER, so the same suite that judges the real
// sendRpc() is applied in-file to three deliberately broken ones — the actual 2026-09-23 defect
// restored, a disabled retry budget, and a widened classifier. Both directions are proven: the
// transient recovers, and every OTHER failure still fails on the first attempt, because the repair
// for a fail-closed check must not widen what it forgives (BARRIER_ENGINEER.md Prohibition 1).
//
// Offline, deterministic, no network: the stub replaces globalThis.fetch and sleeps are injected.
// Belongs in `npm test` by existing (AGENTS.md §"How `npm test` finds its checks").

import { DEFAULT_RETRY, SCHEMA_CACHE_RELOAD, type Probe } from './lib/postgrestRetry.ts';
import { buildRpcCall, sendRpc } from './ops/raise-workflow-alert.mjs';

const URL_BASE = 'https://example.supabase.co';
const KEY = 'test-service-role-key';

type Reply = { status: number; body: string };
const RELOAD: Reply = { status: 503, body: JSON.stringify({ code: SCHEMA_CACHE_RELOAD, message: 'Could not query the database for the schema cache. Retrying.' }) };
/** The OTHER failure that took a workflow red the same morning: a mon_detect_* statement timeout. */
const TIMEOUT: Reply = { status: 500, body: JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }) };
/** The fail-OPEN near-miss: a real error whose prose quotes the code. Must NOT be retried. */
const MENTIONS: Reply = { status: 503, body: JSON.stringify({ code: 'PGRST001', message: 'unrelated failure, see PGRST002 docs' }) };
const OK: Reply = { status: 200, body: '1' };

/** Replace global fetch with a scripted PostgREST. Records every request it really received. */
function stub(replies: Reply[], { repeatLast = false } = {}) {
  const seen: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    const r = replies[i] ?? (repeatLast ? replies[replies.length - 1] : OK);
    if (!repeatLast) i++;
    else if (i < replies.length - 1) i++;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.body, headers: new Headers() };
  }) as unknown as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const call = buildRpcCall({ kind: 'seam_check_failed', workflow: 'p0-fast-lane-coverage.yml', status: 'failure', runUrl: 'https://github.com/x/y/actions/runs/1' });
/** Instant, bounded opts so the proofs cost no wall-clock. Attempt budget matches production. */
const FAST = { attempts: DEFAULT_RETRY.attempts, delayMs: () => 0, sleep: async () => {} };

type Sender = (args: { url: string; key: string; call: typeof call }, opts?: typeof FAST) => Promise<Probe>;

/**
 * THE PREDICATE. Every property the bridge must hold, as failure labels — empty means healthy.
 * Taking the SENDER as an argument is what makes the mutation proofs below executable rather than
 * narrated: the identical suite judges production and each mutant.
 */
async function problems(send: Sender, log = false): Promise<string[]> {
  const bad: string[] = [];
  const check = (ok: boolean, label: string, detail = '') => {
    if (log) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
    if (!ok) bad.push(label);
  };

  // A. the real 2026-09-23 world: two schema-cache reloads, then the cache is back.
  {
    const s = stub([RELOAD, RELOAD, OK]);
    const p = await send({ url: URL_BASE, key: KEY, call }, FAST);
    s.restore();
    check(p.ok === true, 'a transient reload no longer costs the run its only alert', `ok=${p.ok} status=${p.status}`);
    check(s.seen.length === 3, 'it retried until the reload cleared (3 attempts)', `attempts=${s.seen.length}`);
  }

  // B. bounded: a cache that never loads stays RED — nothing synthesises a success.
  {
    const s = stub([RELOAD], { repeatLast: true });
    const p = await send({ url: URL_BASE, key: KEY, call }, FAST);
    s.restore();
    check(p.ok === false, 'the caller still fails — nothing turns a not-ok into an ok', `ok=${p.ok}`);
    check(p.status === 503, 'and it hands back the LAST probe really taken', `status=${p.status}`);
    check(s.seen.length === DEFAULT_RETRY.attempts, `the budget is bounded at ${DEFAULT_RETRY.attempts} attempts`, `attempts=${s.seen.length}`);
  }

  // C. no widening: every OTHER failure still fails on the FIRST attempt.
  for (const [label, reply] of [['HTTP 500 / 57014 statement timeout', TIMEOUT], ['503 whose prose merely mentions the code', MENTIONS]] as const) {
    const s = stub([reply], { repeatLast: true });
    const p = await send({ url: URL_BASE, key: KEY, call }, FAST);
    s.restore();
    check(p.ok === false && s.seen.length === 1, `${label} is unretried`, `ok=${p.ok} attempts=${s.seen.length}`);
  }

  // D. the PRODUCTION default retries — not merely the injected one.
  {
    const s = stub([RELOAD, OK]);
    const p = await send({ url: URL_BASE, key: KEY, call }, { ...DEFAULT_RETRY, delayMs: () => 0 });
    s.restore();
    check(DEFAULT_RETRY.attempts > 1, 'the shared driver default is not attempts:1', `attempts=${DEFAULT_RETRY.attempts}`);
    check(p.ok === true && s.seen.length === 2, 'the sender defaults to the shared driver policy', `ok=${p.ok} attempts=${s.seen.length}`);
  }

  // E. retrying did not corrupt the request the bridge sends.
  {
    const s = stub([RELOAD, OK]);
    await send({ url: `${URL_BASE}/`, key: KEY, call }, FAST);
    s.restore();
    const last = s.seen[s.seen.length - 1];
    check(last.url === `${URL_BASE}/rest/v1/rpc/mon_raise`, 'the URL names the right RPC and the trailing slash is still trimmed', last.url);
    check(last.init.method === 'POST', 'still a POST', String(last.init.method));
    const h = last.init.headers as Record<string, string>;
    check(h.apikey === KEY && h.Authorization === `Bearer ${KEY}`, 'credentials survive a retry');
    const sent = JSON.parse(String(last.init.body));
    check(sent.p_dedup === 'workflow_failed:p0-fast-lane-coverage.yml' && sent.p_kind === 'seam_check_failed',
      'the dedup key and kind are unchanged by the retry', `${sent.p_kind} / ${sent.p_dedup}`);
  }
  return bad;
}

console.log('The failure→alert bridge, executed against a stub PostgREST');
const real = await problems(sendRpc as Sender, true);

// ── MUTATION PROOFS. Each applies the SAME predicate to a deliberately broken sender. ──────────
const drain = async (r: Response): Promise<Probe> => ({ status: r.status, ok: r.ok, body: await r.text(), headers: r.headers });

/** MUTANT 1 — the actual 2026-09-23 defect: one bare fetch, no retry at all. */
const bareFetch: Sender = async ({ url, key, call: c }) =>
  drain(await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${c.fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(c.body),
  }));

/** MUTANT 2 — the retry present but its budget disabled, so it can never reach a second attempt. */
const attemptsOne: Sender = (args) => (sendRpc as Sender)(args, { ...FAST, attempts: 1 });

/** MUTANT 3 — widened to retry EVERY failure, the fail-open repair this rule forbids. */
const retriesEverything: Sender = async (args, opts = FAST) => {
  let p = await bareFetch(args);
  for (let n = 1; n < opts.attempts && !p.ok; n++) p = await bareFetch(args);
  return p;
};

const mustCatch = (label: string, caught: boolean) => {
  console.log(`  ${caught ? 'ok  ' : 'FAIL'} (mutation) catches ${label}`);
  return caught;
};

console.log('\nMutation proofs — the same predicate applied to broken senders');
const missed: string[] = [];
for (const [label, mutant] of [
  ['the ACTUAL defect: a bare unretried fetch, so a reload eats the only alert', bareFetch],
  ['a retry whose budget is disabled (attempts:1)', attemptsOne],
  ['a classifier widened to retry EVERY failure, not just the reload', retriesEverything],
] as const) {
  if (!mustCatch(label, (await problems(mutant)).length > 0)) missed.push(label);
}

if (real.length || missed.length) {
  if (real.length) console.error(`\n✗ ${real.length} assertion(s) failed against the real bridge: ${real.join('; ')}`);
  if (missed.length) console.error(`\n✗ ${missed.length} mutant(s) went UNDETECTED: ${missed.join('; ')}`);
  process.exit(1);
}
console.log('\n✓ the failure→alert bridge survives a PostgREST schema-cache reload, widens nothing else, and 3/3 mutants are caught');
