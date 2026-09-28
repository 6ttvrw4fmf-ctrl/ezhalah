// A WEBSITE DOWN ON ITS SIDE LEAVES THE LOADING STRIP (owner rule 2026-09-26, found still broken by
// the Scraping Engineer 2026-09-27).
//
//   "a website that is down on its side → hide its listings AND its logo, and the platform count
//    drops; it comes back automatically when the site works again"
//
// The SQL half (loader_strip_platforms_ar) shipped, but SearchLoader never read it, so awal, sadin and
// aqaralsaudia kept their logos and were counted in «نراجع N منصة عقارية». This EXECUTES the shipped
// roster code — PLATFORM_META, normalizeSource, hiddenLoaderNames, pickLoaderPlatforms, imported, not
// copied — against registry rows shaped like production's on 2026-09-27, and checks SearchLoader and
// loaderActivePlatforms.ts are wired to it. Hermetic: nothing here reaches production.
//
//   node --experimental-strip-types scripts/verify-loader-hides-down-sites.ts   (npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';

// loaderPlatforms.ts calls Metro's require() for its logo assets; in plain-Node ESM that name is
// undefined, so give it one that returns the asset path. Nothing else in the module needs Metro.
(globalThis as { require?: unknown }).require = (p: string) => p;
const { PLATFORM_META, HIDDEN_STATUSES, hiddenLoaderNames, pickLoaderPlatforms, normalizeSource } =
  await import('../src/data/loaderPlatforms.ts');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');
console.log('\nA website down on its side leaves the loading strip, and the count drops (owner 2026-09-26)\n');

type Row = { platform: string; status: string };
// Production's down rows on 2026-09-27, plus the up rows that share a logo with one of them.
const ROWS: Row[] = [
  { platform: 'awal', status: 'dormant' },
  { platform: 'sadin', status: 'dormant' },
  { platform: 'aqaralsaudia', status: 'dormant' },
  { platform: 'deal', status: 'dormant' },   // fixture only: a down slug that shares a logo with a live one
  { platform: 'toor', status: 'retired' },
  { platform: 'alnokhba', status: 'retired' },
  { platform: 'dealapp', status: 'active' },
  { platform: 'aqar', status: 'active' },
  { platform: 'aqarmonthly', status: 'active' },
  { platform: 'wasalt', status: 'active' },
];
const DOWN_LOGOS = ['Awal', 'Sadin', 'AqarAlSaudia'];
const names = (rows: Row[], resultSources?: string[]) =>
  pickLoaderPlatforms(resultSources, 0, hiddenLoaderNames(rows)).map((p) => p.name);
const catalog = PLATFORM_META.map((p) => p.name);

// ── 1. The rule itself ─────────────────────────────────────────────────────────────────────────────
for (const n of DOWN_LOGOS) check(`the fixture's down logo "${n}" is in PLATFORM_META (so the test is not vacuous)`, catalog.includes(n));
check('HIDDEN_STATUSES hides dormant (down on its side), never active, and never retired (still searchable)',
  HIDDEN_STATUSES.has('dormant') && !HIDDEN_STATUSES.has('active') && !HIDDEN_STATUSES.has('retired'));

const strip = names(ROWS);
// A logo counts as down only when every slug behind it is dormant (Deal App stays while dealapp is up).
const leaked = ROWS.filter((r) => r.status === 'dormant')
  .map((r) => normalizeSource(r.platform))
  .filter((n): n is string => !!n && strip.includes(n)
    && !ROWS.some((u) => u.status !== 'dormant' && normalizeSource(u.platform) === n));
check('no website that is dormant (down on its side) has a logo in the strip', leaked.length === 0,
  `in the strip while down: ${leaked.join(', ')}`);

const hidden = hiddenLoaderNames(ROWS);
const hiddenInCatalog = catalog.filter((n) => hidden.has(n));
check(`the count drops with the logos: ${strip.length} shown = ${catalog.length} catalog − ${hiddenInCatalog.length} down`,
  strip.length === catalog.length - hiddenInCatalog.length);
const loader = stripComments(readFileSync(join(import.meta.dirname, '..', 'src/components/SearchLoader.tsx'), 'utf8'));
check('the «Reviewing N platforms» number is the number of logos actually shown',
  /platformCount=\{platforms\.length\}/.test(loader));

check('a logo shared with a live slug stays: deal is down but dealapp is active → Deal App shown',
  strip.includes('Deal App'));
check('a retired website keeps its logo (toor: the owner kept it on 2026-09-19)', strip.includes('Toor'));
check('aqarmonthly going down does not take the Aqar logo while aqar is up',
  names([...ROWS.filter((r) => r.platform !== 'aqarmonthly'), { platform: 'aqarmonthly', status: 'dormant' }]).includes('Aqar'));
// Exactly these, nothing more: alnokhba maps to no logo and hides nothing; Deal App stays (above).
// toor is 'retired', so its logo goes only while HIDDEN_STATUSES includes 'retired'.
const expected = [...DOWN_LOGOS, ...(HIDDEN_STATUSES.has('retired') ? ['Toor'] : [])].sort();
check(`the hidden set is exactly ${expected.join(', ')}`, JSON.stringify([...hidden].sort()) === JSON.stringify(expected),
  `got ${[...hidden].sort().join(', ')}`);

check('it comes back by itself: awal flipped to active → its logo returns',
  names(ROWS.map((r) => (r.platform === 'awal' ? { ...r, status: 'active' } : r))).includes('Awal'));
check('a down website\'s slug in the results does not bring its logo back', !names(ROWS, ['awal', 'sadin']).includes('Awal'));
check('a cold scraper does not hide a logo: with no down rows the strip is the whole catalog',
  names([{ platform: 'awal', status: 'active' }]).length === catalog.length);
check('statuses unknown (null) → the full catalog, never a guess',
  pickLoaderPlatforms(undefined, 0, null).length === catalog.length);
check('logo-only brands (no scraper, no registry row) are never hidden',
  PLATFORM_META.filter((p) => p.logoOnly).every((p) => strip.includes(p.name)));

// ── 2. Wiring: the loader actually uses it, once per session ──────────────────────────────────────
check('SearchLoader picks its roster with hiddenPlatformNames()',
  /pickLoaderPlatforms\(resultSources, offsetRef\.current \?\? 0, hiddenPlatformNames\(\)\)/.test(loader));
check('SearchLoader starts the status read at module scope, before the first search',
  /^if \(!IS_WEB \|\| typeof window !== 'undefined'\) void loadHiddenPlatformNames\(\);$/m.test(loader));
const runtime = stripComments(readFileSync(join(import.meta.dirname, '..', 'src/data/loaderActivePlatforms.ts'), 'utf8'));
check('the statuses come from loader_platform_status_ar through the bounded helper',
  /boundedRpc<[^>]*>\(supabase\.rpc\('loader_platform_status_ar'\)\)/.test(runtime));
check('one successful read per session: a loaded or in-flight read is never repeated',
  /if \(hidden \|\| inFlight\) return/.test(runtime));
check('a failed or empty read leaves the set unknown (full roster), never "nothing is down"',
  /if \(error \|\| !Array\.isArray\(data\) \|\| data\.length === 0\) return;\s*hidden = hiddenLoaderNames\(data\);/.test(runtime));

// ── 3. Mutation proofs ─────────────────────────────────────────────────────────────────────────────
const unfiltered = pickLoaderPlatforms(undefined, 0, null).map((p) => p.name);
mustCatch('a strip that ignores the down set (what production shipped until this fix)',
  DOWN_LOGOS.some((n) => unfiltered.includes(n)));
const perSlug = new Set(ROWS.filter((r) => HIDDEN_STATUSES.has(r.status)).map((r) => normalizeSource(r.platform)));
mustCatch('hiding per slug instead of per logo (Deal App would vanish because "deal" is down)',
  perSlug.has('Deal App') && !hidden.has('Deal App'));
mustCatch('SearchLoader going back to the unfiltered pick',
  !/pickLoaderPlatforms\(resultSources, offsetRef\.current \?\? 0, hiddenPlatformNames\(\)\)/.test(
    loader.replace(', hiddenPlatformNames())', ')')));
mustCatch('the once-per-session guard removed',
  !/if \(hidden \|\| inFlight\) return/.test(runtime.replace('if (hidden || inFlight) return', 'if (inFlight) return')));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — a website down on its side still shows its logo, or the count is wrong\n`
  : '\n✓ down websites leave the strip, the count drops with them, and they come back by themselves\n');
process.exit(failed ? 1 : 0);
