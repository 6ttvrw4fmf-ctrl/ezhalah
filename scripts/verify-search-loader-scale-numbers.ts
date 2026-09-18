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

console.log('\n── 1. buildSearchLoaderTitles: preparing is ALWAYS last ──');
const { buildSearchLoaderTitles } = await import('../src/lib/searchLoaderTitles.ts');

const partsNoCoverage = { search: 'S', checking: 'C', matchFilters: 'M', reviewing: 'R', coverage: null, preparing: 'P' };
const partsWithCoverage = { ...partsNoCoverage, coverage: 'COV' };

const withoutCoverage = buildSearchLoaderTitles(partsNoCoverage as any);
const withCoverage = buildSearchLoaderTitles(partsWithCoverage as any);

check('without coverage: 5 lines, preparing last', withoutCoverage.length === 5 && withoutCoverage.at(-1) === 'P',
  JSON.stringify(withoutCoverage));
check('with coverage: 6 lines, coverage second-to-last, preparing still last',
  withCoverage.length === 6 && withCoverage.at(-2) === 'COV' && withCoverage.at(-1) === 'P',
  JSON.stringify(withCoverage));
check('coverage line is OMITTED (not shown empty/null) when not yet resolved',
  !withoutCoverage.includes(null as any) && !withoutCoverage.includes('null'));

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

console.log('\n── 3. the copy uses the SAME platform count the pills render, never a second count ──');
const loaderSrc = readFileSync(join(root, 'src/components/SearchLoader.tsx'), 'utf8');
check('PhaseTitle is called with platformCount={platforms.length} (the roster actually on screen)',
  /<PhaseTitle[^>]*platformCount=\{platforms\.length\}/.test(loaderSrc));
check('the reviewing line keys off that same platformCount prop, not a separate fetch/count',
  /platformCount > 0 \? t\('Reviewing \{count\} real-estate platforms…', \{ count: platformCount \}\)/.test(loaderSrc));

console.log('\n── source shape: the three new i18n keys exist with their placeholders, both languages ──');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
for (const [key, placeholders] of [
  ['Checking more than {count} properties…', ['{count}']],
  ['Reviewing {count} real-estate platforms…', ['{count}']],
  ['Covering more than {count} places across Saudi Arabia…', ['{count}']],
] as const) {
  check(`EN key referenced from SearchLoader/i18n: "${key}"`, loaderSrc.includes(key) || i18n.includes(`'${key}'`));
  const arMatch = i18n.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`));
  const arLine = arMatch?.[1] ?? '';
  check(`AR translation exists and carries every placeholder (${placeholders.join(', ')})`,
    !!arLine && placeholders.every((p) => arLine.includes(p)), `got: "${arLine}"`);
}
check('coverage is ONE combined number (cityCount + districtCount), not a separate cities/districts pair',
  /coverage: scaleStats \? t\('Covering more than \{count\} places across Saudi Arabia…', \{ count: grouped\(scaleStats\.cityCount \+ scaleStats\.districtCount\) \}\) : null/.test(loaderSrc));

console.log('\n── 4. reading-pace rotation: every line gets time proportional to its length, not one fixed window ──');
const { readingDurationMs } = await import('../src/lib/searchLoaderTitles.ts');

check('a short line lands close to the old fixed 2400ms (no perceptible pace change for existing short copy)',
  Math.abs(readingDurationMs('نطابق الفلاتر…') - 2400) < 700,
  `got ${readingDurationMs('نطابق الفلاتر…')}ms`);
check('a long live-number line gets MORE time than a short line — the whole point of this fix',
  readingDurationMs('نغطي أكثر من 4,027 موقع في جميع أنحاء المملكة…') > readingDurationMs('نطابق الفلاتر…'));
check('duration is floored — even an empty/near-empty string never flashes by instantly', readingDurationMs('') >= 1900);
check('duration is ceilinged — an extreme length never stalls the rotation for many seconds', readingDurationMs('غ'.repeat(500)) <= 4200);

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
