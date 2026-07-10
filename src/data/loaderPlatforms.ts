// Platform roster + logos for the SEARCH-LOADING animation (the Perplexity-style "checking the
// platforms" strip shown while a search runs). This is STATUS DISPLAY ONLY — it never changes the
// search, filters, ranking, or which listings return. Every entry is a REAL platform we scrape
// (mirrors src/data/platforms.ts); nothing here is invented.
//
// LOCKED 2026-07-09 (owner clarification, Option A): the animation is a BRAND/TRUST display of the
// COMPLETE Ezhalah network, not a literal per-query eligibility list. It always shows all 32 logos —
// for Buy AND Rent, monthly or not, Residential or Commercial, and even when the user's own search
// restricts to specific platforms. Backend eligibility (which tables a given query actually hits —
// Buy/Rent, Gathern-monthly-only, a platform filter, etc.) is decided ENTIRELY by remote.ts / the
// search RPC and is untouched by this file. See [[search-loader-perplexity-2026-07-09]] for the
// full decision trail (this supersedes the earlier "Buy hides Gathern in the loader" rule).
//
// The logo require() map is deliberately DUPLICATED from ResultCard.tsx rather than shared, so the
// result-card rendering path is never touched by this feature. If a logo asset is renamed, update it
// in both places. All 32 platforms currently have a logo asset.

// name MUST match the `name` in PLATFORMS exactly (so platform(name) resolves allowsRent/allowsBuy).
// i18nKey is the English source string in the AR dictionary → t(i18nKey) gives the Arabic display name
// (same label the result card uses). logo is the bundled asset.
export type LoaderPlatform = { name: string; i18nKey: string; logo: number };

export const PLATFORM_META: LoaderPlatform[] = [
  { name: 'Aqar',         i18nKey: 'AQAR',                                    logo: require('../../assets/images/aqar-logo.png') },
  { name: 'Wasalt',       i18nKey: 'Wasalt',                                  logo: require('../../assets/images/wasalt-logo.png') },
  { name: 'Aldarim',      i18nKey: 'Aldarim Real Estate',                     logo: require('../../assets/images/aldarim.jpg') },
  { name: 'Aqargate',     i18nKey: 'Aqar Gate',                               logo: require('../../assets/images/aqargate-logo.jpg') },
  { name: 'Alhoshan',     i18nKey: 'Al Hoshan',                               logo: require('../../assets/images/alhoshan.jpg') },
  { name: 'Hajer',        i18nKey: 'Hajer Houses Real Estate',                logo: require('../../assets/images/hajer-logo.jpg') },
  { name: 'Sanadak',      i18nKey: 'Sanadak',                                 logo: require('../../assets/images/sanadak-logo.jpg') },
  { name: 'Eastabha',     i18nKey: 'East Abha Real Estate',                   logo: require('../../assets/images/eastabha-logo.jpg') },
  { name: 'Aqarcity',     i18nKey: 'Aqar City',                               logo: require('../../assets/images/aqarcity-logo.jpg') },
  { name: 'Raghdan',      i18nKey: 'Raghdan Real Estate',                     logo: require('../../assets/images/raghdan.jpg') },
  { name: 'Eaqartabuk',   i18nKey: 'Candles',                                 logo: require('../../assets/images/eaqartabuk.jpg') },
  { name: 'Satel',        i18nKey: 'Satel',                                   logo: require('../../assets/images/satel.jpg') },
  { name: 'Sadin',        i18nKey: 'Sadin for Real Estate',                   logo: require('../../assets/images/sadin.jpg') },
  { name: 'Toor',         i18nKey: 'TOOR',                                    logo: require('../../assets/images/toor.jpg') },
  { name: 'Mustqr',       i18nKey: 'Mustaqarr Real Estate',                   logo: require('../../assets/images/mustaqr.jpg') },
  { name: 'Ramzalqasim',  i18nKey: 'Ramz Al Qassim Real Estate Investment',  logo: require('../../assets/images/ramzalqassim.jpg') },
  { name: 'Fursaghyr',    i18nKey: 'Fursa Ghyr Real Estate',                  logo: require('../../assets/images/fursaghyr.jpg') },
  { name: 'Jazwtn',       i18nKey: 'Jazan Watan',                             logo: require('../../assets/images/jazan-watan.jpg') },
  { name: 'Mizlaj',       i18nKey: 'Mizlaj Real Estate',                      logo: require('../../assets/images/mizlaj.jpg') },
  { name: 'Muktamel',     i18nKey: 'Muktamel',                                logo: require('../../assets/images/muktamel.jpg') },
  { name: 'Aqaratikom',   i18nKey: 'Aqaratikom',                              logo: require('../../assets/images/aqaratikom.jpg') },
  { name: 'Awal',         i18nKey: 'Awal United for Real Estate',             logo: require('../../assets/images/awal.jpg') },
  { name: 'Al Khaas',     i18nKey: 'Al Khaas',                                logo: require('../../assets/images/alkhaas.jpg') },
  { name: 'Abeea',        i18nKey: 'Abeea Real Estate',                       logo: require('../../assets/images/abeea.jpg') },
  { name: 'Jurash',       i18nKey: 'Jurash Real Estate',                      logo: require('../../assets/images/jurash.jpg') },
  { name: 'Al Nokhba',    i18nKey: 'Al Nokhba',                               logo: require('../../assets/images/alnokhba.jpg') },
  { name: 'Gathern',      i18nKey: 'Gathern',                                 logo: require('../../assets/images/gathern.jpg') },
  { name: 'Deal App',     i18nKey: 'Deal App',                                logo: require('../../assets/images/dealapp.jpg') },
  { name: '24 Souq',      i18nKey: '24 Souq',                                 logo: require('../../assets/images/souq24.jpg') },
  { name: 'Era Pulse',    i18nKey: 'Era Pulse',                               logo: require('../../assets/images/erapulse.jpg') },
  { name: 'Al Nowaisiry', i18nKey: 'Al Nowaisiry Real Estate',               logo: require('../../assets/images/nowaisiry.jpg') },
  { name: '1 October',    i18nKey: '1 October Real Estate',                   logo: require('../../assets/images/october.jpg') },
];

// Ordered SPECIFIC-first token → platform name map, mirroring ResultCard's SourceBadge matching so a
// raw listing/source value ("aqargate", "aqar_commercial", "gathern") resolves to exactly ONE platform.
// Generic "aqar" is LAST so aqargate/aqarcity/aqaratikom win first. Used to (a) resolve a user's
// `sources` filter and (b) figure out which pool platforms actually appear in a result set.
const SOURCE_TOKENS: Array<[string, string]> = [
  ['wasalt', 'Wasalt'], ['aldarim', 'Aldarim'], ['aqargate', 'Aqargate'], ['aqarcity', 'Aqarcity'],
  ['aqaratikom', 'Aqaratikom'], ['alhoshan', 'Alhoshan'], ['alnokhba', 'Al Nokhba'], ['alkhaas', 'Al Khaas'],
  ['hajer', 'Hajer'], ['sanadak', 'Sanadak'], ['eastabha', 'Eastabha'], ['raghdan', 'Raghdan'],
  ['eaqartabuk', 'Eaqartabuk'], ['satel', 'Satel'], ['sadin', 'Sadin'], ['toor', 'Toor'],
  ['mustqr', 'Mustqr'], ['mustaqr', 'Mustqr'], ['ramzalqasim', 'Ramzalqasim'], ['ramzalqassim', 'Ramzalqasim'],
  ['fursaghyr', 'Fursaghyr'], ['jazwtn', 'Jazwtn'], ['jazan', 'Jazwtn'], ['muktamel', 'Muktamel'],
  ['mizlaj', 'Mizlaj'], ['awal', 'Awal'], ['abeea', 'Abeea'], ['jurash', 'Jurash'],
  ['gathern', 'Gathern'], ['dealapp', 'Deal App'], ['deal', 'Deal App'], ['souq', '24 Souq'],
  ['erapulse', 'Era Pulse'], ['pulse', 'Era Pulse'], ['nowaisiry', 'Al Nowaisiry'], ['october', '1 October'],
  ['aqar', 'Aqar'],
];

// Raw source/table value → canonical platform name (or null if it matches nothing we know).
export function normalizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  for (const [tok, name] of SOURCE_TOKENS) if (s.includes(tok)) return name;
  return null;
}

// A rotating cursor so each search shows a DIFFERENT mix and, over many searches, every platform
// eventually appears (instead of replaying the same handful). Seeded from localStorage on web so the
// rotation continues across reloads; a plain module counter on native.
const ROT_KEY = 'ezhalah:loaderRot';
function readRot(): number {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const v = ls?.getItem(ROT_KEY);
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch { return _rot; }
}
let _rot = 0;
export function currentRotation(): number { return readRot(); }
export function bumpRotation(): void {
  _rot = (readRot() + 1) % 100000;
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(ROT_KEY, String(_rot)); } catch {}
}

// Rotate an array left by `by` (non-mutating).
function rotate<T>(arr: T[], by: number): T[] {
  if (arr.length === 0) return arr;
  const k = ((by % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

// Choose which platforms the searching strip shows for THIS search: ALWAYS the complete 32-platform
// roster (LOCKED — see the file-header note). No deal filter, no category filter, no user-`sources`
// restriction — every logo, every search, unconditionally. `resultSources` (raw source values from
// the listings that actually came back, once known) only REORDERS the display — platforms that truly
// contributed lead the strip — it never removes a platform. `offset` rotates the rest per search so
// repeat searches don't always show the same visual order.
export function pickLoaderPlatforms(resultSources: string[] | undefined, offset: number): LoaderPlatform[] {
  const inResults = new Set((resultSources ?? []).map((s) => normalizeSource(s)).filter(Boolean) as string[]);
  const pri = PLATFORM_META.filter((p) => inResults.has(p.name));
  const rest = rotate(PLATFORM_META.filter((p) => !inResults.has(p.name)), offset);
  return [...pri, ...rest];
}
