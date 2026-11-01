// PERMANENT BARRIER — the raw-card chunks of ONE table are fetched CONCURRENTLY, at most 4 in flight.
//
// THE BUG THIS PINS (measured 2026-10-10, local web build vs production, 390px phone). An Advanced
// Filter round on الرياض / إيجار / شقة (RNPL, جديد, دورات المياه +١, المطبخ) waited ~8.3 s for its
// cards, past the owner's 7 s ceiling for a whole round. The browser showed EIGHT back-to-back
// `aqar_residential_listings?select=id,ad_number,…` requests, ~0.9 s each, each starting only when
// the previous one finished. Cause: src/data/remote.ts fetchRawByIds() walked the table's ids in
// 200-id chunks with `await` inside a `for` loop — a 1,500-row page (QUERY_LIMIT) that is mostly aqar
// is 8 chunks, i.e. 8 serial round trips. The chunks are independent (each is `.in('id', slice)` over
// ids the RPC already returned; nothing comes from the previous response), so they now run through a
// bounded pool: same 8 requests, two waves of ≤ 4.
//
// EXECUTED, NOT GREPPED: the REAL fetchRawByIds and the REAL bounded() are lifted out of remote.ts
// and driven against a fake PostgREST builder that counts requests in flight. What it holds:
//   A. the request budget is unchanged — one request per 200-id chunk, every id asked for once;
//   B. chunks overlap (peak in flight ≥ 2) — the serial loop's peak is exactly 1;
//   C. ≤ 4 in flight — a pool, not a burst of one request per chunk;
//   D. result ORDER is the id order even when later chunks answer first;
//   E. A FAILED FETCH IS NOT «NO RESULTS»: a failing chunk rejects the table (caller → null → retry
//      UI), never a short list, and no NEW chunk starts after the failure;
//   F. Stop: an already-aborted signal starts no request; an abort mid-flight rejects.
//
// MUTATION-PROVEN below (each re-breaks a COPY of remote.ts written to a temp dir):
//   M1 the pre-2026-10-10 serial loop        → B fails
//   M2 one worker per chunk (unbounded)      → C fails
//   M3 pages appended in completion order    → D fails
//   M4 a chunk error swallowed (`continue`)  → E fails (resolves a short list)
//   M5 the pool keeps starting after an error → E fails
//
//   node --experimental-strip-types scripts/verify-raw-card-chunks-run-concurrently.ts   (in `npm test`)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const REMOTE = new URL('../src/data/remote.ts', import.meta.url).pathname;
const remote = readFileSync(REMOTE, 'utf8');
const FN = windowBetween(remote, 'async function fetchRawByIds(', '\n}\n', 'src/data/remote.ts');

// The fake network. Every builder.abortSignal() call is one HTTP request. `delay(n)` decides how long
// chunk n takes; `fail` is the chunk index that answers with a PostgREST error.
type Net = { inFlight: number; peak: number; requests: number[][]; afterFailure: number; failedYet: boolean;
  delay: (n: number) => number; fail: number };
const net = (globalThis as any).__net = {} as Net;
const reset = (delay: (n: number) => number, fail = -1) =>
  Object.assign(net, { inFlight: 0, peak: 0, requests: [], afterFailure: 0, failedYet: false, delay, fail });

const PRELUDE = `
type SearchQuery = any; type Listing = any; type SourceKind = 'res' | 'com';
const RPC_TIMEOUT_MS = 5000;
const finalize = (rows: any[], kind: SourceKind) => rows.map((r) => ({ id: r.id, kind }));
const keptFiltersReq = (_q: any, _tbl: string) => ({ in: (_c: string, ids: number[]) => ({ limit: (_n: number) => ({
  abortSignal: (sig: AbortSignal) => {
    const net = (globalThis as any).__net;
    const n = Math.floor((ids[0] - 1) / 200);
    if (net.failedYet) net.afterFailure++;
    net.requests.push(ids); net.inFlight++; net.peak = Math.max(net.peak, net.inFlight);
    return new Promise((resolve, reject) => {
      let settled = false;
      const end = () => { if (settled) return false; settled = true; net.inFlight--; return true; };
      const t = setTimeout(() => {
        if (!end()) return;
        if (n === net.fail) { net.failedYet = true; resolve({ data: null, error: { message: 'HTTP 500' } }); }
        else resolve({ data: ids.map((id) => ({ id })), error: null });
      }, net.delay(n));
      const onAbort = () => { clearTimeout(t); if (end()) reject(new DOMException('aborted', 'AbortError')); };
      if (sig.aborted) onAbort(); else sig.addEventListener('abort', onAbort);
    });
  },
}) }) });
`;

type Fetch = (q: unknown, tbl: string, ids: number[], signal?: AbortSignal) => Promise<Array<{ id: number }>>;
async function load(src: string): Promise<Fetch> {
  const file = join(mkdtempSync(join(tmpdir(), 'ezhalah-rawchunks-')), 'remote.ts');
  writeFileSync(file, src);
  const mod = await liftSymbols(file, [
    { header: 'const ID_CHUNK = ', endsWith: /;/ },
    { header: 'async function bounded<', endsWith: /^\}$/ },
    { header: 'const RAW_CHUNK_CONCURRENCY = ', endsWith: /;/ },
    { header: 'async function fetchRawByIds(', endsWith: /^\}$/ },
  ], ['fetchRawByIds'], PRELUDE);
  return mod.fetchRawByIds as Fetch;
}

const IDS = Array.from({ length: 1500 }, (_, i) => i + 1);   // one QUERY_LIMIT page, all on one table
const CHUNKS = Math.ceil(IDS.length / 200);                   // 8 — the 8 requests measured live

type Verdict = { budget: boolean; overlap: boolean; bounded: boolean; order: boolean; failClosed: boolean; noNewAfterFail: boolean; stop: boolean };
async function judge(fetchRawByIds: Fetch): Promise<Verdict & { detail: string }> {
  // Later chunks answer FIRST, so an order kept by completion time is visibly wrong.
  reset((n) => 5 + (CHUNKS - n) * 4);
  const rows = await fetchRawByIds({}, 'aqar_residential_listings', IDS);
  const asked = net.requests.flat();
  const budget = net.requests.length === CHUNKS && net.requests.every((r) => r.length <= 200)
    && asked.length === IDS.length && new Set(asked).size === IDS.length;
  const overlap = net.peak >= 2;
  const bounded = net.peak <= 4;
  const order = rows.map((r) => r.id).join(',') === IDS.join(',');
  const detail = `requests=${net.requests.length} peak=${net.peak} rows=${rows.length}`;

  // Chunk 1 fails fast while the others are slow; the table must REJECT, and nothing new may start.
  reset((n) => (n === 1 ? 2 : 30), 1);
  let failClosed = false;
  try { await fetchRawByIds({}, 'aqar_residential_listings', IDS); } catch { failClosed = true; }
  await new Promise((r) => setTimeout(r, 300));   // let any straggling worker show itself
  const noNewAfterFail = net.afterFailure === 0;

  // Stop before the call starts no request; Stop mid-flight rejects.
  reset(() => 30);
  const pre = new AbortController(); pre.abort();
  let preRejected = false;
  try { await fetchRawByIds({}, 'aqar_residential_listings', IDS, pre.signal); } catch { preRejected = true; }
  const preRequests = net.requests.length;
  reset(() => 30);
  const mid = new AbortController();
  setTimeout(() => mid.abort(), 10);
  let midRejected = false;
  try { await fetchRawByIds({}, 'aqar_residential_listings', IDS, mid.signal); } catch { midRejected = true; }
  const stop = preRejected && preRequests === 0 && midRejected;

  return { budget, overlap, bounded, order, failClosed, noNewAfterFail, stop, detail };
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const shipped = await judge(await load(remote));
check(`A. budget: ${CHUNKS} requests for ${IDS.length} ids, each ≤ 200, every id asked once`, shipped.budget, shipped.detail);
check('B. chunks overlap (peak in flight ≥ 2) — not one serial round trip after another', shipped.overlap, shipped.detail);
check('C. at most 4 chunk requests in flight per table', shipped.bounded, shipped.detail);
check('D. rows come back in id order even when later chunks answer first', shipped.order, shipped.detail);
check('E. a failing chunk rejects the table (retry UI), never a short list', shipped.failClosed);
check('E. no new chunk request starts after a chunk has failed', shipped.noNewAfterFail);
check('F. Stop: pre-aborted → no request; aborted mid-flight → rejects', shipped.stop);

// ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
// Rewrites fetchRawByIds only; a replacement that no longer applies is a loud error, never a no-op mutant.
const mutant = (from: string, to: string) => {
  if (!FN.includes(from)) throw new Error(`mutant anchor missing from fetchRawByIds: ${JSON.stringify(from.slice(0, 60))}`);
  return remote.replace(FN, FN.replace(from, to));
};

const SERIAL = `async function fetchRawByIds(q: SearchQuery, tbl: string, ids: number[], signal?: AbortSignal): Promise<Listing[]> {
  const kind: SourceKind = tbl.includes('_commercial') ? 'com' : 'res';
  const out: Listing[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const { data, error } = await bounded(keptFiltersReq(q, tbl).in('id', ids.slice(i, i + ID_CHUNK)).limit(ID_CHUNK), RPC_TIMEOUT_MS, signal);
    if (error) throw new Error(\`fetchRawByIds(\${tbl}): \${error.message}\`);
    if (data) out.push(...finalize(data, kind));
  }
  return out;`;
const m1 = await judge(await load(remote.replace(FN, SERIAL)));
mustCatch('M1 the pre-2026-10-10 serial chunk loop (8 back-to-back round trips)', !m1.overlap);

const m2 = await judge(await load(mutant('Math.min(RAW_CHUNK_CONCURRENCY, Math.ceil(ids.length / ID_CHUNK))', 'Math.ceil(ids.length / ID_CHUNK)')));
mustCatch('M2 one worker per chunk — every chunk in flight at once', !m2.bounded);

const m3 = await judge(await load(mutant('pages[n] = data ? finalize(data, kind) : [];', 'pages.push(data ? finalize(data, kind) : []);')));
mustCatch('M3 pages kept in completion order instead of chunk order', !m3.order);

const m4 = await judge(await load(mutant('if (error) { failed = true; throw new Error(`fetchRawByIds(${tbl}): ${error.message}`); }', 'if (error) continue;')));
mustCatch('M4 a chunk error swallowed — a short grid instead of the retry UI', !m4.failClosed);

const m5 = await judge(await load(mutant('if (error) { failed = true; throw', 'if (error) { throw')));
mustCatch('M5 the pool keeps starting chunks after one has failed', !m5.noNewAfterFail);

if (failed || mutFail) {
  if (failed) console.error(`\n❌ ${failed} check(s) failed.`);
  if (mutFail) console.error(`❌ ${mutFail} mutation(s) went UNCAUGHT — this guard cannot see the defects it exists for.`);
  process.exit(1);
}
console.log('\n✅ raw-card chunks run concurrently (≤ 4 in flight), in order, fail-closed — and the guard is proven to fail on each defect.');
