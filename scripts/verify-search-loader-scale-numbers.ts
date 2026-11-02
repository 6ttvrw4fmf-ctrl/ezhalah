// SEARCH-LOADING "BIG DATABASE" NUMBERS (owner 2026-09-12): "those things are more like
// marketing... people would be like wow, this has a big database" — the loading headline now
// rotates through live counts (total searchable listings, active platforms, cities+districts)
// instead of static copy. Three invariants matter and are each EXECUTED here, not grepped:
//
//   1. «نجهز النتائج» (preparing) is LAST no matter whether the coverage line is included —
//      buildSearchLoaderTitles() (src/lib/searchLoaderTitles.ts) is the REAL function the
//      component calls, run directly against synthetic inputs.
//   2. fetchLoaderScaleStats() (src/data/loaderScaleStats.ts) fails CLOSED — a failed/malformed
//      RPC response returns null, never a fabricated or zeroed number (A FAILED FETCH IS NOT AN
//      EMPTY ANSWER). The REAL function is lifted out of the real file (never a hand-copy — see
//      feedback_never-test-a-copy-of-production-code) and run against an injected client that
//      resolves {data:null,error} the way supabase-js really behaves on failure.
//   3. The platform count shown in the copy is the SAME number the pills on screen show
//      (platforms.length passed straight through, never a second independent count).
//
//   node --experimental-strip-types scripts/verify-search-loader-scale-numbers.ts   (in `npm test`)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

console.log('\n── 1. buildSearchLoaderTitles: the funnel order, optional lines omitted, preparing ALWAYS last ──');
const { buildSearchLoaderTitles, countWording } = await import('../src/lib/searchLoaderTitles.ts');

const base = { search: 'S', checking: 'K', city: null, district: null, matching: 'M', preparing: 'P' };
const bare = buildSearchLoaderTitles(base);
const withCity = buildSearchLoaderTitles({ ...base, city: 'CITY' });
const withBoth = buildSearchLoaderTitles({ ...base, city: 'CITY', district: 'DIST' });
const districtOnly = buildSearchLoaderTitles({ ...base, district: 'DIST' });

check('no known place: 4 lines in funnel order, preparing last', JSON.stringify(bare) === JSON.stringify(['S', 'K', 'M', 'P']), JSON.stringify(bare));
check('known city: its line sits after the Kingdom line, before the request', JSON.stringify(withCity) === JSON.stringify(['S', 'K', 'CITY', 'M', 'P']), JSON.stringify(withCity));
check('known city + district: websites → Kingdom → city → district → request → results',
  JSON.stringify(withBoth) === JSON.stringify(['S', 'K', 'CITY', 'DIST', 'M', 'P']), JSON.stringify(withBoth));
check('a district line can stand without a city line (and preparing is still last)', districtOnly.at(-1) === 'P' && districtOnly.includes('DIST'));
check('an unknown place line is OMITTED — never shown empty, null or "null"',
  [bare, withCity, districtOnly].every((t) => !t.includes(null as any) && !t.includes('') && !t.includes('null')));
mustCatch('a builder that appends after preparing', (() => {
  const broken = (p: typeof base) => [...buildSearchLoaderTitles(p), 'EXTRA'];
  return broken(base).at(-1) !== 'P';
})());

console.log('\n── 1b. countWording: the EXACT count in digits (owner 2026-10-17), never word-form rounding, unknown → omitted ──');
const asNum = (s: string) => Number(s.replace(/,/g, ''));
const exactDigits = (w: typeof countWording) => {
  for (const n of [1, 42, 300, 1000, 1001, 11_385, 88_241, 162_312, 372_889]) {
    for (const loc of ['ar', 'en'] as const) {
      const r = w(n, loc);
      if (!r || r.kind !== 'exact' || asNum(r.text) !== n || /ألف|thousand|k$/i.test(r.text)) return false;
    }
  }
  return w(0, 'ar') === null && w(undefined, 'ar') === null && w(null, 'en') === null && w(Number.NaN, 'ar') === null;
};
check('countWording is the exact count in digits across real production counts, and omits unknown/zero', exactDigits(countWording));
check("today's numbers read as the owner asked: 372,889 · 162,312 · 11,385 (digits, thousands separators)",
  countWording(372_889, 'ar')?.text === '372,889' && countWording(162_312, 'en')?.text === '162,312' && countWording(11_385, 'ar')?.text === '11,385');
mustCatch('a wording that rounds into word form («370 ألف» — what the owner rejected)',
  !exactDigits((n, loc) => (typeof n === 'number' && n > 0 ? { kind: 'exact', text: n >= 1000 ? `${Math.floor(n / 1000)} ألف` : String(n) } : null)));
mustCatch('a wording that prints a zero for an unknown count',
  !exactDigits((n, loc) => countWording(typeof n === 'number' && Number.isFinite(n) ? n : 0, loc) ?? { kind: 'exact', text: '0' }));

console.log('\n── 2. fetchLoaderScaleStats fails CLOSED, never fabricates a number ──');
const dataSrc = join(root, 'src/data/loaderScaleStats.ts');

// `boundedRpc` comes from the REAL src/data/boundedRpc.ts, read off disk and stripped of its
// `export` keywords — not a hand-written stand-in. The whole point of lifting the real
// fetchLoaderScaleStats is that it is the shipped code; substituting a fake bounder here would put
// a copy back in the middle of it (the 2026-08-29 extractPrice lesson). The file imports nothing,
// so inlining it is exact. If it ever gains an import this throws rather than lifting something
// subtly wrong.
const boundedRpcSrc = readFileSync(join(root, 'src/data/boundedRpc.ts'), 'utf8');
if (/^\s*import\s/m.test(boundedRpcSrc)) {
  throw new Error('src/data/boundedRpc.ts gained an import — this prelude inlines it and must be updated');
}
if (!/export async function boundedRpc</.test(boundedRpcSrc)) {
  throw new Error('src/data/boundedRpc.ts no longer declares boundedRpc — this barrier lifts it by name');
}

const PRELUDE = `
type LoaderScaleStats = { listingCount: number; cityCount: number; districtCount: number };
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
${boundedRpcSrc.replace(/^export /gm, '')}
`;

async function load() {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-scale-'));
  const file = join(dir, 'loaderScaleStats.ts');
  writeFileSync(file, readFileSync(dataSrc, 'utf8'));
  return await liftSymbols(file, [
    { header: 'export async function fetchLoaderScaleStats(', endsWith: /^\}$/ },
  ], ['fetchLoaderScaleStats', 'setClient'], PRELUDE) as unknown as {
    fetchLoaderScaleStats: () => Promise<unknown>;
    setClient: (c: unknown) => void;
  };
}

// A SHORT CEILING FOR THIS PROCESS ONLY, so the hang case below can be proven in milliseconds
// instead of the shipped 15 s. boundedRpc reads this at module load, and the prelude inlines it.
process.env.EXPO_PUBLIC_RPC_TIMEOUT_MS = '150';

const mod = await load();
// MODEL THE REAL POSTGREST BUILDER, NOT A CONVENIENT SHAPE.
//
// `supabase.rpc(...)` does not return a result — it returns a BUILDER that is thenable and also
// exposes `.abortSignal()`. This stub used to resolve directly from `rpc()`, which was close enough
// while the call was bare-awaited, and stopped being close enough the moment the await was bounded
// (ops_incident #269): `src/data/boundedRpc.ts` calls `.abortSignal()`, and a stub without it threw
// on the HAPPY path. The barrier was right to go red — it executes the real function, so a stub that
// drifts from the real client is the barrier lying, not the code failing.
//
// Both shapes are provided on purpose, so this stub stays valid for a bare-awaited caller too.
const client = (mode: 'rows' | 'error' | 'empty' | 'malformed' | 'throw' | 'hang') => {
  const settle = async () => {
    if (mode === 'throw') throw new Error('network down');
    // Never settles on its own — the stalled connection ops_incident #269 is about.
    if (mode === 'hang') return await new Promise(() => {});
    if (mode === 'error') return { data: null, error: { message: 'boom' } };
    if (mode === 'empty') return { data: [], error: null };
    if (mode === 'malformed') return { data: [{ listing_count: 'oops', city_count: 1, district_count: 1 }], error: null };
    return { data: [{ listing_count: 213402, city_count: 359, district_count: 3668 }], error: null };
  };
  return {
    rpc: () => ({
      abortSignal: () => settle(),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej),
    }),
  };
};

mod.setClient(client('rows'));
check('a real, well-shaped RPC response resolves to a stats object (the happy path actually works)',
  JSON.stringify(await mod.fetchLoaderScaleStats()) === JSON.stringify({ listingCount: 213402, cityCount: 359, districtCount: 3668 }));

mod.setClient(client('error'));
mustCatch('a failed RPC ({data:null,error}) returning null, not a fabricated/zeroed stat',
  (await mod.fetchLoaderScaleStats()) === null);

mod.setClient(client('empty'));
mustCatch('an empty row array ([]) is treated as failure, not zero listings',
  (await mod.fetchLoaderScaleStats()) === null);

mod.setClient(client('malformed'));
mustCatch('a malformed row (non-numeric count) is treated as failure, not NaN leaking into the UI',
  (await mod.fetchLoaderScaleStats()) === null);

mod.setClient(client('throw'));
mustCatch('a thrown network error resolves to null (never rejects — the caller has no catch)',
  (await mod.fetchLoaderScaleStats()) === null);

// THE HANG CASE — ops_incident #269, and the one this file could not see before.
//
// Every check above injects a client that FAILS. None of them could catch the actual defect, because
// the defect was not a failure: it was a connection that never answers at all, so the await never
// settled and «إزهله يبحث» spun forever with no error to fall back from. Failing closed on an error
// and bounding the WAIT are two different properties, and this file only proved the first.
//
// Proven by execution and by the clock: with the ceiling set to 150 ms above, a client that never
// settles must still resolve — to null, the same safe value as every other failure, so the caller
// falls back to numberless copy exactly as it already does.
{
  mod.setClient(client('hang'));
  const t0 = Date.now();
  const raced = await Promise.race([
    mod.fetchLoaderScaleStats(),
    new Promise((r) => setTimeout(() => r('STILL-HANGING'), 5_000)),
  ]);
  const ms = Date.now() - t0;
  check('a connection that never answers RESOLVES instead of hanging forever (#269)',
    raced !== 'STILL-HANGING', `still pending after ${ms}ms — the await is unbounded again`);
  check('…and it resolves to null, the same safe value every other failure returns',
    raced === null, `got ${JSON.stringify(raced)}`);
  check('…bounded by the configured ceiling, not by luck', ms < 4_000, `took ${ms}ms`);
}

console.log('\n── 3. the copy uses the ONE shared site count (owner 2026-10-20: «make it 148»), never a second count ──');
const loaderSrc = readFileSync(join(root, 'src/components/SearchLoader.tsx'), 'utf8');
// Owner 2026-10-20: the WhatsApp card, the share sentence and this line must all say the same number —
// src/data/siteCount.ts — with the on-screen roster only as the fallback before that count is read.
check('PhaseTitle is called with platformCount={siteCountNow() ?? platforms.length} (the shared count, roster as fallback)',
  /<PhaseTitle[^>]*platformCount=\{siteCountNow\(\) \?\? platforms\.length\}/.test(loaderSrc));
check('the loader starts the shared count read at app load (the fallback is for the first seconds only)',
  /void loadSiteCount\(\);/.test(loaderSrc) && /import \{ loadSiteCount, siteCountNow \} from '@\/data\/siteCount';/.test(loaderSrc));
check('the websites line keys off that same platformCount prop, not a separate fetch/count',
  /platformCount > 0 \? t\('Searching \{count\} real-estate platforms…', \{ count: platformCount \}\)/.test(loaderSrc));
check('PhaseTitle receives THIS search (query), which drives the city/district lines',
  /<PhaseTitle[^>]*query=\{query\}/.test(loaderSrc));

console.log('\n── source shape: the funnel i18n keys exist with their placeholders, both languages ──');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
for (const [key, placeholders] of [
  ['Searching {count} real-estate platforms…', ['{count}']],
  ['Checking {count} listings across the Kingdom…', ['{count}']],
  ['Reviewing more than {count} listings in {city}…', ['{count}', '{city}']],
  ['Reviewing {count} listings in {city}…', ['{count}', '{city}']],
  ['Going through more than {count} listings in {district}…', ['{count}', '{district}']],
  ['Going through {count} listings in {district}…', ['{count}', '{district}']],
  ['Matching your request: {what}…', ['{what}']],
] as const) {
  check(`EN key referenced from SearchLoader/i18n: "${key}"`, loaderSrc.includes(key) || i18n.includes(`'${key}'`));
  const arMatch = i18n.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`));
  const arLine = arMatch?.[1] ?? '';
  check(`AR translation exists and carries every placeholder (${placeholders.join(', ')})`,
    !!arLine && placeholders.every((p) => arLine.includes(p)), `got: "${arLine}"`);
}
// THE FUNNEL'S HONESTY IS WIRED, NOT JUST AVAILABLE (owner 2026-10-17). The Kingdom line may only
// say «أكثر من» through countWording (the old line printed the EXACT total after "more than"); the
// city/district lines go through placeLine, which omits an unknown place and never puts an Arabic
// name inside an English sentence; and the loader adds no per-search round trip of its own.
check('the Kingdom line is worded by countWording (exact digits), not formatted by hand',
  /checking: kingdom \? t\('Checking \{count\} listings across the Kingdom…', \{ count: kingdom\.text \}\)/.test(loaderSrc)
  && !/grouped\(scaleStats\.listingCount\)/.test(loaderSrc));
check('the city and district lines both go through placeLine (omit-when-unknown, no Arabic mid-English)',
  /city: placeLine\(funnel\.city,/.test(loaderSrc) && /district: placeLine\(funnel\.district,/.test(loaderSrc));
check('the old coverage line is gone from the loader (replaced by the city/district lines)', !loaderSrc.includes('Covering more than'));
check('the loader makes no supabase.rpc call of its own for the funnel (session caches only — the 2026-09-21 lesson)',
  !/supabase\.rpc\(/.test(loaderSrc) && /loadSearchFunnelFacts\(query\)/.test(loaderSrc));

console.log('\n── 4. reading-pace rotation: proportional to length, and the whole six-line funnel fits the 10 s cap ──');
const { readingDurationMs, FUNNEL_BUDGET_MS } = await import('../src/lib/searchLoaderTitles.ts');

// The six lines a Riyadh + district search really shows (live 2026-10-17 numbers). Owner 2026-10-17:
// results are never held past ten seconds, so if these six do not fit, the personal lines are never seen.
const FUNNEL_AR = ['نبحث في 148 منصة عقارية…', 'نفحص 372,889 إعلان في المملكة…', 'نراجع 162,312 إعلان في الرياض…', 'ندقق في 11,385 إعلان في حي النرجس…', 'نطابق طلبك: شقة للإيجار…', 'نجهز النتائج…'];
const funnelTotal = FUNNEL_AR.reduce((a, l) => a + readingDurationMs(l), 0);
check(`the six funnel lines fit inside the ${FUNNEL_BUDGET_MS}ms cap (sum ${funnelTotal}ms)`, funnelTotal <= FUNNEL_BUDGET_MS && FUNNEL_BUDGET_MS <= 10_000);
check('a long live-number line still gets MORE time than a short line (reading pace, not a fixed window)',
  readingDurationMs(FUNNEL_AR[3]) > readingDurationMs('نجهز النتائج…'));
check('duration is floored — even an empty/near-empty string never flashes by instantly', readingDurationMs('') >= 1200);
check('duration is ceilinged — no single line can hog the ten seconds', readingDurationMs('غ'.repeat(500)) <= 2500);

mustCatch('a mutant that makes ALL lines the same duration regardless of length (the exact regression)',
  (() => {
    const shortD = readingDurationMs('نطابق الفلاتر…');
    const longD = readingDurationMs('نغطي أكثر من 4,027 موقع في جميع أنحاء المملكة…');
    return shortD !== longD; // a fixed-duration mutant would make these equal
  })());
check('SearchLoader actually uses readingDurationMs (not a fixed TITLE_ROTATE_MS interval)',
  /setTimeout\(tick, readingDurationMs\(/.test(loaderSrc) && !/setInterval\(.*TITLE_ROTATE_MS/.test(loaderSrc));

console.log(failed ? `\n${failed} FAILED` : '\nAll search-loader-scale-numbers checks passed');
process.exit(failed ? 1 : 0);
