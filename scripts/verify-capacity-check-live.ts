// THE WEEKLY CAPACITY CHECK — live half (owner 2026-11-05: «we don't want the user to get the bug; catch it before,
// and focus on the root»). Run ONLY by .github/workflows/capacity-check.yml; the decisions it takes (quiet? pass?
// safe number?) live in scripts/lib/capacityRamp.ts, proven offline by scripts/verify-capacity-check.ts.
//
// WHAT ONE SIMULATED USER DOES — one Filter search, chained as the browser chains it (measured on ezhalah.com
// 2026-11-05: Riyadh, rent, 1 user — results data in by 5.3 s, guided counts to 10.0 s, first card at 11.95 s):
//   RESULTS PHASE (the first card waits for this — judged against the owner's 12 s):
//     location_search_candidates_ar (the app's exact body: e2e/qa-coverage/request.mjs + the harvested cohort catalog
//     + the app's own lifted rpcAdvancedFilterParams + a fresh rotation seed), beside it top_cities_by_deal_ar
//     (Trending) and loader_scale_stats_ar; then the cards of every candidate from their own tables, 200 ids a
//     request, ≤ 4 at once per table, all tables in parallel, with the app's own lifted select list
//     (src/data/remote.ts fetchListingsForQuery).
//   COUNTS PHASE (fired after the results and never awaited by the cards — reported, not judged):
//     5 scope count probes (location_search_candidates_ar, p_limit 1) at once, then 5 apartment_guided_counts_ar one
//     after another, each bounded at the app's 4 s, then ui_results_found_ar.
// The public key, like the browser; the service key only reads pg_stat_activity / pg_stat_statements through two
// read-only functions and writes the result rows.
//
// WHY IT DOES NOT QUEUE IN THE ROBOT LANES. robot_gate() puts every caller carrying the «ezhalah-gate» log marker (what
// gateFetch.mjs's wrapper adds) into 2 global lanes. Measured that way, 8 «users» read as 6 waiting in pg_sleep — the
// queue, not the database. So this script sends the handshake the closed back door needs (gateHeaders) on the NATIVE
// fetch, with its own user-agent «ezhalah-capacity-check/1», which robot_gate does not queue. Its own guard replaces
// the lanes: no step starts while foreign load is up, the ramp stops at the first late or failing step, never exceeds
// 8 users, and runs ≈ 6 minutes once a week at a quiet hour.
//
//   node --experimental-strip-types scripts/verify-capacity-check-live.ts
//   needs EZ_GATE_SECRET + SUPABASE_SERVICE_ROLE_KEY; exit 1 only when the robot itself broke (the alarm is the detector).
// MUTATION-PROOF-EXEMPT: this half owns no predicate of its own — every stop / pass / safe-number decision it applies
// lives in scripts/lib/capacityRamp.ts, mutation-proven by scripts/verify-capacity-check.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { buildRequest } from '../e2e/qa-coverage/request.mjs';
import {
  CAP, DATA_READY_LIMIT_MS, DATA_READY_WARN_MS, FIRST_CARD_LIMIT_S, REQUEST_TIMEOUT_MS, STEP_SECONDS, TAP_TO_FIRST_REQUEST_MS,
  WINDOW_MINUTE, dataReadyP95, databaseBusy, ended, msUntilWindow, nextConcurrency, safeConcurrency, slowestCall, stats, verdict,
  type Sample, type Step,
} from './lib/capacityRamp.ts';

const nativeFetch = globalThis.fetch; // taken BEFORE gateFetch.mjs wraps it (the wrapper adds the lane marker)
if ((nativeFetch as { __ezGate?: boolean }).__ezGate) throw new Error('fetch was already wrapped by gateFetch.mjs: this run would measure the robot lanes, not the database');
// Both loaded AFTER that capture, dynamically: public-supabase.ts imports the wrapper as a side effect.
const { resolvePublicSupabase } = await import('./lib/public-supabase.ts');
const { gateHeaders } = await import('./lib/gateFetch.mjs');

// The app's own key (src/lib/supabase.ts reads EXPO_PUBLIC_SUPABASE_KEY; the workflow sets it), else the committed anon.
const { url: URL_, key: ANON } = resolvePublicSupabase();
const GATE = process.env.EZ_GATE_SECRET || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RUN_URL = process.env.RUN_URL || null;
if (!GATE || !SERVICE) { console.error('::error::EZ_GATE_SECRET and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(1); }

const ID_CHUNK = 200;            // src/data/remote.ts ID_CHUNK
const CHUNKS_AT_ONCE = 4;        // src/data/remote.ts RAW_CHUNK_CONCURRENCY
const COUNT_TIMEOUT_MS = 4_000;  // src/data/remote.ts AGE_COUNT_TIMEOUT_MS (scope probes + guided counts)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const anonHeaders = (url: string) => ({
  apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json',
  'user-agent': 'ezhalah-capacity-check/1', 'x-client-info': 'ezhalah-capacity-check', ...gateHeaders(url, GATE),
});
const serviceHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json',
  'user-agent': 'ezhalah-capacity-check/1' };

type Answer = { ok: boolean; ms: number; data: unknown; status: number };
/** One request, bounded; ok only on 2xx with the body fully read (the browser waits for the body too). */
async function call(path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Answer> {
  const url = `${URL_}/rest/v1/${path}`;
  const t0 = performance.now();
  try {
    const r = await nativeFetch(url, { method: body === undefined ? 'GET' : 'POST', headers: anonHeaders(url),
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    return { ok: r.ok, ms: performance.now() - t0, data: r.ok && text ? JSON.parse(text) : text.slice(0, 200), status: r.status };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, data: String((e as Error)?.message ?? e), status: 0 };
  }
}
async function service(fn: string, body: unknown): Promise<any> {
  const r = await nativeFetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: serviceHeaders,
    body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ── the four searches, built by the app's own rules ─────────────────────────────────────────────────────────────────
const lifted = await liftSymbols(join(import.meta.dirname, '../src/data/remote.ts'), [  // read only
  { header: 'const LIST_SELECT = [', endsWith: /^\]\.join\(', '\);$/ },
  { header: 'const DISCOUNT_COLUMN_TABLES', endsWith: /;$/ },
  { header: 'const DISCOUNT_COLUMNS', endsWith: /;$/ },
  { header: 'function listSelectFor(' },
  { header: 'export function rpcAdvancedFilterParams' },
], ['listSelectFor', 'rpcAdvancedFilterParams']);
const listSelectFor = lifted.listSelectFor as (t: string) => string;
const afParams = lifted.rpcAdvancedFilterParams as (q: Record<string, unknown>) => Record<string, unknown>;

const cat = await call('rpc/ops_qa_cohort_catalog', {});
if (!cat.ok || !Array.isArray(cat.data)) { console.error(`::error::ops_qa_cohort_catalog unreadable (${cat.status} ${cat.data})`); process.exit(1); }
const catalog = cat.data as any[];
const cohort = (t: string) => catalog.find((c) => c.ui_type === t) ?? (() => { throw new Error(`no cohort ${t}`); })();
// ponytail: the scope probes price five residential cohorts and the guided counts vary one answer each; the app's exact
// candidates depend on the interview state. Same RPCs, same scope, same count(*) cost — refine if a phase looks off.
const PROBE_TYPES = catalog.filter((c) => c.macro === 'Residential').slice(0, 5).map((c) => c.types_ar);
const GUIDED_VARIANTS = [{}, { p_bath_min: 1 }, { p_bath_min: 2 }, { p_bath_min: 3 }, { p_amenities: ['elevator'] }];
const RIYADH = { city: 'الرياض', regionId: 1 }, JEDDAH = { city: 'جدة', regionId: 2 };
const SEARCHES: { name: string; body: Record<string, unknown> }[] = [
  { name: 'riyadh apartment rent yearly', body: buildRequest(cohort('شقة'), { deal: 'إيجار', period: 'سنوي', ...RIYADH }) },
  { name: 'jeddah villa sale', body: buildRequest(cohort('فيلا'), { deal: 'بيع', ...JEDDAH }) },
  { name: 'riyadh النرجس apartment rent', body: buildRequest(cohort('شقة'), { deal: 'إيجار', period: 'سنوي', ...RIYADH, districts: ['حي النرجس'] }) },
  { name: 'riyadh apartment rent + AF elevator, 2 baths', body: { ...buildRequest(cohort('شقة'), { deal: 'إيجار', period: 'سنوي', ...RIYADH }),
    ...afParams({ amenities: ['elevator'], bathMin: 2 }) } },
];

/** One Filter search as the user waits for it. Records every call into `calls`; returns the results phase. */
async function oneSearch(body: Record<string, unknown>, calls: Record<string, Sample[]>): Promise<Sample> {
  const rec = (k: string, s: Sample) => { (calls[k] ??= []).push({ ms: s.ms, ok: s.ok }); return s; }; // never the body
  const countBody = omit(body, ['p_limit', 'p_offset', 'p_per_platform', 'p_sort_by', 'p_rotation_seed']);
  const t0 = performance.now();

  // RESULTS PHASE — Trending and the scale stats start with the results RPC; the cards wait only for the RPC.
  const side = Promise.all([
    call('rpc/top_cities_by_deal_ar', omit(countBody, ['p_cities', 'p_districts', 'p_region_ids'])).then((a) => rec('top_cities_by_deal_ar', a)),
    call('rpc/loader_scale_stats_ar', {}).then((a) => rec('loader_scale_stats_ar', a)),
  ]);
  const rpc = rec('results_rpc', await call('rpc/location_search_candidates_ar', { ...body, p_rotation_seed: randomBytes(8).toString('hex') }));
  let ok = rpc.ok && Array.isArray(rpc.data);
  if (ok) {
    const byTable = new Map<string, number[]>();
    for (const c of rpc.data as { source_table: string; listing_id: number }[]) {
      (byTable.get(c.source_table) ?? byTable.set(c.source_table, []).get(c.source_table)!).push(Number(c.listing_id));
    }
    const tc = performance.now();
    await Promise.all([...byTable].map(async ([tbl, ids]) => {
      let next = 0;
      const select = encodeURIComponent(listSelectFor(tbl).replace(/\s/g, ''));
      await Promise.all(Array.from({ length: Math.min(CHUNKS_AT_ONCE, Math.ceil(ids.length / ID_CHUNK)) }, async () => {
        while (ok && next * ID_CHUNK < ids.length) {
          const slice = ids.slice(next * ID_CHUNK, ++next * ID_CHUNK);
          // ponytail: the app also sends transaction_type / property_type / period filters here; next to id=in.(…) they
          // cost nothing, so only active + id + limit are replayed. Add them if a plan ever stops using the primary key.
          const r = rec('card_chunk', await call(`${tbl}?select=${select}&active=eq.true&id=in.(${slice.join(',')})&limit=${ID_CHUNK}`));
          if (!r.ok) ok = false;   // the app fails the whole search on one bad chunk (retry screen)
        }
      }));
    }));
    if (byTable.size) rec('cards', { ms: performance.now() - tc, ok });
  }
  const results = rec('results_phase', { ms: performance.now() - t0, ok });
  await side;
  if (!ok) return results;   // a failed search shows the retry screen; nothing follows it

  // COUNTS PHASE — what the browser fires next; the first card does not wait for it, but the database serves it.
  const tq = performance.now();
  await Promise.all(PROBE_TYPES.map((types) => call('rpc/location_search_candidates_ar',
    { ...countBody, p_types: types, p_limit: 1, p_offset: 0 }, COUNT_TIMEOUT_MS).then((a) => rec('scope_count_probe', a))));
  for (const v of GUIDED_VARIANTS) rec('apartment_guided_counts_ar', await call('rpc/apartment_guided_counts_ar', { ...countBody, ...v }, COUNT_TIMEOUT_MS));
  rec('ui_results_found_ar', await call('rpc/ui_results_found_ar', {}));
  rec('counts_phase', { ms: performance.now() - tq, ok: true });
  return results;
}

async function runStep(concurrency: number): Promise<Step> {
  const until = Date.now() + STEP_SECONDS * 1000;
  const results: Sample[] = [];
  const calls: Record<string, Sample[]> = {};
  let i = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, CAP) }, async () => {
    while (Date.now() < until) results.push(await oneSearch(SEARCHES[i++ % SEARCHES.length].body, calls));
  }));
  return { concurrency, seconds: (Date.now() - t0) / 1000, results: stats(results),
    calls: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, stats(v)])) };
}

/** Quiet before every step: three looks 10 s apart, else stop. */
async function quiet(): Promise<{ busy: string | null; activity: Record<string, unknown> }> {
  let a: any = null, busy: string | null = null;
  for (let k = 0; k < 3; k++) {
    a = await service('ops_capacity_db_activity', {});
    busy = databaseBusy({ active: Number(a.active), slow: Number(a.slow) });
    if (!busy) break;
    if (k < 2) await sleep(10_000);
  }
  return { busy, activity: a };
}

// ── the ramp ────────────────────────────────────────────────────────────────────────────────────────────────────────
const wait = process.env.CAPACITY_START_NOW === 'true' ? 0 : msUntilWindow(new Date());
if (wait) { console.log(`waiting ${(wait / 60_000).toFixed(1)} min for :${WINDOW_MINUTE} UTC, the hour's quiet gap`); await sleep(wait); }
const runId = randomUUID();
const runAt = new Date().toISOString();
const before = await service('ops_capacity_statements', { p_before: null });
const done: Step[] = [];
const activity: unknown[] = [];
let abortedForLoad: string | null = null;
for (let c = nextConcurrency(done); c !== null; c = nextConcurrency(done)) {
  const q = await quiet();
  activity.push({ before_users: c, ...q.activity });
  if (q.busy) { abortedForLoad = q.busy; console.log(`stop before ${c} users: ${q.busy}`); break; }
  const s = await runStep(c);
  done.push(s);
  console.log(`${c} users: ${s.results.n} searches, data ready p95 ${dataReadyP95(s)?.toFixed(0)} ms, `
    + `errors ${(100 * s.results.error_rate).toFixed(1)} % → ${verdict(s)}`);
}
const top = await service('ops_capacity_statements', { p_before: before });
const safe = safeConcurrency(done);
const comfortable = safeConcurrency(done, DATA_READY_WARN_MS);
const how = ended(done, abortedForLoad !== null);
const slowest = slowestCall(done, ['results_rpc', 'cards', 'top_cities_by_deal_ar', 'loader_scale_stats_ar']);

const prev = await nativeFetch(`${URL_}/rest/v1/ops_capacity_run?select=run_at,safe_concurrency&ended=in.(limit,cap)`
  + '&order=run_at.desc&limit=1', { headers: serviceHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  .then((r) => r.json()).catch(() => []);  // only for the report line; the detector reads the table itself

const rows = (done.length ? done : [null]).map((s, k) => ({
  run_id: runId, run_at: runAt, step: s ? k + 1 : 0, concurrency: s?.concurrency ?? 0, seconds: s?.seconds ?? 0,
  searches: s?.results.n ?? 0, p50_ms: s?.results.p50 == null ? null : Math.round(TAP_TO_FIRST_REQUEST_MS + s.results.p50),
  p95_ms: s ? (dataReadyP95(s) == null ? null : Math.round(dataReadyP95(s)!)) : null, error_rate: s?.results.error_rate ?? null,
  verdict: s ? verdict(s) : null, calls: s?.calls ?? {}, p95_limit_ms: DATA_READY_LIMIT_MS, p95_warn_ms: DATA_READY_WARN_MS,
  safe_concurrency: how === 'foreign_load' ? null : safe, comfortable_concurrency: how === 'foreign_load' ? null : comfortable,
  ended: how, slowest_call: slowest, slowest_sql: k === done.length - 1 || !s ? top : null,
  notes: { searches: SEARCHES.map((x) => x.name), tap_to_first_request_ms: TAP_TO_FIRST_REQUEST_MS, activity,
    stopped_for_load: abortedForLoad, run_url: RUN_URL },
}));
const ins = await nativeFetch(`${URL_}/rest/v1/ops_capacity_run`, { method: 'POST',
  headers: { ...serviceHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(rows), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
if (!ins.ok) { console.error(`::error::writing ops_capacity_run → ${ins.status} ${(await ins.text()).slice(0, 300)}`); process.exit(1); }

// ── the report ──────────────────────────────────────────────────────────────────────────────────────────────────────
const sec = (x: number | null | undefined) => (x == null ? '—' : `${(x / 1000).toFixed(2)} s`);
const p95 = (s: Step, k: string) => sec(s.calls[k]?.p95);
const flag = (s: Step) => { const d = dataReadyP95(s); return verdict(s) !== 'pass' ? `**${verdict(s)}**` : d != null && d > DATA_READY_WARN_MS ? 'pass (warning)' : 'pass'; };
const lines = [
  `## Search capacity — ${runAt.slice(0, 16)} UTC`,
  `Owner rule: the first card by ${FIRST_CARD_LIMIT_S} s after «بحث». Data ready (tap → results + cards in, p95; `
    + `${TAP_TO_FIRST_REQUEST_MS / 1000} s of client time added) must be ≤ ${DATA_READY_LIMIT_MS / 1000} s; warning over ${DATA_READY_WARN_MS / 1000} s.`,
  '',
  '| users at once | searches | searches/s | data ready p50 | data ready p95 | errors | results_rpc p95 | cards p95 | card_chunk p95 | Trending p95 | counts phase p95 | guided count p95 | verdict |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...done.map((s) => `| ${s.concurrency} | ${s.results.n} | ${(s.results.n / s.seconds).toFixed(2)} | `
    + `${sec(s.results.p50 == null ? null : TAP_TO_FIRST_REQUEST_MS + s.results.p50)} | ${sec(dataReadyP95(s))} | `
    + `${(100 * s.results.error_rate).toFixed(1)} % | ${p95(s, 'results_rpc')} | ${p95(s, 'cards')} | ${p95(s, 'card_chunk')} | `
    + `${p95(s, 'top_cities_by_deal_ar')} | ${p95(s, 'counts_phase')} | ${p95(s, 'apartment_guided_counts_ar')} | ${flag(s)} |`),
  '',
  `**Simultaneous searches with the first card by ${FIRST_CARD_LIMIT_S} s: ${how === 'foreign_load' ? 'not measured (stopped for foreign load)' : safe}`
    + `${how === 'cap' ? ` (≥ — every step up to the cap of ${CAP} passed)` : ''}.** With data by ${DATA_READY_WARN_MS / 1000} s (margin): ${comfortable}.`
    + ` Last measured run: ${prev?.[0] ? `${prev[0].safe_concurrency} (${String(prev[0].run_at).slice(0, 10)})` : 'none'}.`,
  `Slowest call the first card waits for: ${slowest ?? '—'}.${abortedForLoad ? ` Stopped early: ${abortedForLoad}.` : ''}`,
  '',
  'Top SQL during the run (anon + authenticated, pg_stat_statements delta):',
  ...((top as any[]) ?? []).slice(0, 6).map((t) => `- ${t.calls} calls, ${(t.ms / 1000).toFixed(1)} s total, ${(t.ms / Math.max(1, t.calls)).toFixed(0)} ms each — \`${String(t.query).slice(0, 140)}\``),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
