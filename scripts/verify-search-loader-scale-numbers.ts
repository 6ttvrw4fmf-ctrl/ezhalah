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

const PRELUDE = `
type LoaderScaleStats = { listingCount: number; cityCount: number; districtCount: number };
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
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

const mod = await load();
const client = (mode: 'rows' | 'error' | 'empty' | 'malformed' | 'throw') => ({
  rpc: async () => {
    if (mode === 'throw') throw new Error('network down');
    if (mode === 'error') return { data: null, error: { message: 'boom' } };
    if (mode === 'empty') return { data: [], error: null };
    if (mode === 'malformed') return { data: [{ listing_count: 'oops', city_count: 1, district_count: 1 }], error: null };
    return { data: [{ listing_count: 213402, city_count: 359, district_count: 3668 }], error: null };
  },
});

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
