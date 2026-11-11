// A CARD OPENED FROM A MAP PIN NAMES ITS CITY (owner 2026-11-05: an aqar villa in Taif opened from a pin read
// «حي جبرة, الموقع غير محدد» — «idu this issue … our problem or what?»). It was ours: aqar stores the city in English
// («Taif»), the card refuses Latin, and fetchListingCards() — the loader behind the map pin sheet and the ad page's
// «same ad on other sites» row — skipped the Arabic step the search results run, so every aqar card there lost its
// city. Both paths now call ONE applyArabicLocation(); this check EXECUTES the real fetchListingCards() (lifted from
// src/data/remote.ts) against a stub client that answers the way supabase-js does, including a failed index read.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname ?? '.', '..');
const FILE = join(root, 'src/data/remote.ts');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

// Shims for what the lifted code closes over but that carries no location logic: the client, the timeout wrapper,
// the table allow-list, the column list and finalize() (which only copies the raw row's city/neighbourhood across).
// fetchListingCards() also hands the index's bath count to the card rule (🔧 2026-11-10); the lifted copy imports the REAL rule.
const PRELUDE = `
import { bathroomsForCard } from '${pathToFileURL(join(root, 'src/lib/indexBathrooms.ts')).href}';
type Listing = any;
// Every report the lifted code makes is recorded, so a FAILED index read can be asserted to be reported (never swallowed).
export const reports: { msg: string; ctx: any }[] = [];
const reportMessage = (msg: string, ctx?: any) => { reports.push({ msg, ctx }); };
const bounded = (p: any) => p;
const SEARCHABLE_TABLES = ['aqar_residential_listings'];
const listSelectFor = (_t: string) => '*';
const finalize = (data: any[], _k: string) => data.map((d) => ({ id: d.id, city: d.city, district: d.neighborhood, districtArFallback: null, regionAr: '' }));
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
`;
const SYMBOLS = [
  { header: 'const CITY_AR: Record<string, string> = {', endsWith: /^\};$/ },
  { header: 'const JUNK_LOCATION_TOKENS' , endsWith: /;$/ },
  { header: 'function isJunkLocationToken(' },
  { header: 'function arCity(' },
  { header: 'export function applyArabicLocation(' },
  { header: 'export async function fetchListingCards(', endsWith: /^\}$/ },
];

type Stub = { index: 'ok' | 'error' };
function client(s: Stub) {
  const raw = [{ id: 17656083, city: 'Taif', neighborhood: 'حي جبرة' }, { id: 1, city: 'Other', neighborhood: '' }, { id: 2, city: 'الرياض', neighborhood: 'حي الملقا' }];
  const idx = [{ listing_id: 17656083, region_ar: 'منطقة مكة المكرمة', city_ar: 'الطائف', district_ar: 'حي جبرة' }];
  return {
    from(table: string) {
      const chain: any = { select: () => chain, in: () => chain, eq: () => chain, limit: () => chain,
        then: (res: any) => res(table === 'search_listings_ar'
          ? (s.index === 'ok' ? { data: idx, error: null } : { data: null, error: { message: 'timeout' } })
          : { data: raw, error: null }) };
      return chain;
    },
  };
}

async function load(src: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-card-city-'));
  const f = join(dir, 'remote.ts');
  writeFileSync(f, src);
  // arCity reads CITY_AR_FROM_CATALOG too; an empty catalog map keeps the hand dictionary as the only source here.
  return liftSymbols(f, SYMBOLS, ['fetchListingCards', 'applyArabicLocation', 'setClient'], PRELUDE + 'const CITY_AR_FROM_CATALOG: Record<string, string> = {};\n');
}
let lastReports: { msg: string; ctx: any }[] = [];
async function cards(src: string, s: Stub) {
  const m = await load(src) as any;
  m.setClient(client(s));
  const out = await m.fetchListingCards('aqar_residential_listings', [17656083, 1, 2]);
  lastReports = [...m.reports];
  return new Map<number, any>(out.map((r: any) => [r.id, r]));
}

const real = readFileSync(FILE, 'utf8');
const ok = await cards(real, { index: 'ok' });
check('a map-pin card for an aqar villa (raw «Taif») names its city in Arabic: الطائف', ok.get(17656083)?.city === 'الطائف', JSON.stringify(ok.get(17656083)));
check('…and carries the index\'s region and canonical district (the same row the search results use)', ok.get(17656083)?.regionAr === 'منطقة مكة المكرمة' && ok.get(17656083)?.districtCanonical === 'حي جبرة');
check('an already-Arabic city (dealapp/wasalt) is kept as the site wrote it', ok.get(2)?.city === 'الرياض');
check('a junk sentinel («Other») stays honestly blank, never printed', ok.get(1)?.city === '');
check('every card still carries its table', [...ok.values()].every((r) => r.sourceTable === 'aqar_residential_listings'));
const down = await cards(real, { index: 'error' });
check('a FAILED index read still names the city (CITY_AR) and still returns every card — never a blank-for-error', down.get(17656083)?.city === 'الطائف' && down.size === 3);
check('…and the failed read is REPORTED exactly once (A FAILED FETCH IS NOT AN EMPTY ANSWER; CodeRabbit on #11678)',
  lastReports.length === 1 && /search_listings_ar read failed/.test(lastReports[0].msg) && lastReports[0].ctx?.table === 'aqar_residential_listings', JSON.stringify(lastReports));
check('a healthy index read reports nothing', (await (async () => { await cards(real, { index: 'ok' }); return lastReports.length; })()) === 0);
const noReport = real.replace("if (loc.error) reportMessage('fetchListingCards: search_listings_ar read failed'", "if (false) reportMessage('fetchListingCards: search_listings_ar read failed'");
mustCatch('a card loader that swallows the failed index read again', noReport !== real && (await (async () => { await cards(noReport, { index: 'error' }); return lastReports.length; })()) === 0);

// The loop also hands the index's bath count to the card rule (🔧 2026-11-10); the mutant drops ONLY the Arabic step.
const noCall = real.replace('    applyArabicLocation(r, arById.get(Number(r.id)));\n    // Same rule as the search path', '    // Same rule as the search path');
mustCatch('fetchListingCards skipping the Arabic step (the «الموقع غير محدد» card of 2026-11-05)', noCall !== real && (await cards(noCall, { index: 'ok' })).get(17656083)?.city !== 'الطائف');
const rawWins = real.replace("l.city = /[ء-ي]/.test(rawCity || '') ? rawCity : ((ar?.city) || arCity(safeRawCity) || safeRawCity || '');", 'l.city = rawCity;');
mustCatch('the English raw city printed on the card', rawWins !== real && (await cards(rawWins, { index: 'ok' })).get(17656083)?.city === 'Taif');
check('the search results use the same applyArabicLocation() (one rule, two paths)', /applyArabicLocation\(l, ar\);/.test(real));

if (failed) { console.error(`\n❌ verify-map-sheet-card-city-is-arabic: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-sheet-card-city-is-arabic: cards opened from a map pin name their city in Arabic');
