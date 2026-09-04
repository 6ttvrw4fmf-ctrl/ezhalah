// Platform roster + logos for the SEARCH-LOADING animation (the Perplexity-style "checking the
// platforms" strip shown while a search runs). This is STATUS DISPLAY ONLY — it never changes the
// search, filters, ranking, or which listings return. Every entry is a REAL platform we scrape.
//
// PRODUCT RULE (owner 2026-08-29, supersedes the 2026-07-09 "always show all logos" rule):
// The strip is a HONEST CLAIM about which platforms Ezhalah currently searches — one logo per
// platform users can actually reach in results. If a scraper goes cold and no user can reach that
// platform's listings any more, its logo does not belong in the strip until it comes back. This is
// fairness to users (no logos they cannot reach) AND to platforms (no advertising a platform we
// cannot deliver).
//
// TWO-LAYER HONESTY. The static PLATFORM_META list below is the CATALOG (every platform we have a
// logo asset for AND that we consider a real scraping target). At runtime, SearchLoader calls
// `fetchActivePlatformNames()` — an RPC over `search_listings_ar` — and filters PLATFORM_META down
// to platforms that currently have any active row. If the RPC fails, SearchLoader falls back to
// the full PLATFORM_META (safe degradation — the user might see one platform they cannot reach
// during that outage, never fewer). `scripts/verify-loader-platforms-match-active.ts` enforces at
// CI time that PLATFORM_META, when mapped through SOURCE_TOKENS, equals the production active set —
// so the two lists cannot silently drift.
//
// The logo require() map is deliberately DUPLICATED from ResultCard.tsx rather than shared, so the
// result-card rendering path is never touched by this feature. If a logo asset is renamed, update it
// in both places.

// name MUST match the `name` in PLATFORMS exactly (so platform(name) resolves allowsRent/allowsBuy).
// i18nKey is the English source string in the AR dictionary → t(i18nKey) gives the Arabic display name
// (same label the result card uses). logo is the bundled asset.
export type LoaderPlatform = { name: string; i18nKey: string; logo: number };

// The catalog of platforms with a bundled logo asset. Kept in lock-step with production's active
// set (`search_listings_ar.platform`). When a platform goes cold with zero reachable rows, remove
// its entry here in the same PR that also confirms it should stop being advertised. Barrier:
// `scripts/verify-loader-platforms-match-active.ts`.
//
// Aqar Monthly reuses `aqar-logo.png` — it is Aqar's own monthly-rental vertical (same site, same
// brand), not a separate platform. Distinguished at the token level (see SOURCE_TOKENS) so a raw
// `aqarmonthly` source resolves to the Monthly entry and not the generic Aqar one.
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
  { name: 'Eaqartabuk',   i18nKey: 'Eqar Tabuk',                              logo: require('../../assets/images/eaqartabuk.jpg') },
  { name: 'Satel',        i18nKey: 'Satel',                                   logo: require('../../assets/images/satel.jpg') },
  { name: 'Sadin',        i18nKey: 'Sadin for Real Estate',                   logo: require('../../assets/images/sadin.jpg') },
  { name: 'Mustqr',       i18nKey: 'Mustaqarr Real Estate',                   logo: require('../../assets/images/mustaqr.jpg') },
  { name: 'Ramzalqasim',  i18nKey: 'Ramz Al Qassim Real Estate Investment',  logo: require('../../assets/images/ramzalqassim.jpg') },
  { name: 'Fursaghyr',    i18nKey: 'Fursa Ghyr Real Estate',                  logo: require('../../assets/images/fursaghyr.jpg') },
  { name: 'Jazwtn',       i18nKey: 'Jazan Watan',                             logo: require('../../assets/images/jazan-watan.jpg') },
  { name: 'Mizlaj',       i18nKey: 'Mizlaj Real Estate',                      logo: require('../../assets/images/mizlaj.jpg') },
  { name: 'Aqaratikom',   i18nKey: 'Nawait',                                  logo: require('../../assets/images/aqaratikom.jpg') },
  { name: 'Al Khaas',     i18nKey: 'Al Khaas',                                logo: require('../../assets/images/alkhaas.jpg') },
  { name: 'Abeea',        i18nKey: 'Abeea Real Estate',                       logo: require('../../assets/images/abeea.jpg') },
  { name: 'Jurash',       i18nKey: 'Jurash Real Estate',                      logo: require('../../assets/images/jurash.jpg') },
  { name: 'Gathern',      i18nKey: 'Gathern',                                 logo: require('../../assets/images/gathern.jpg') },
  { name: 'Aqar Monthly', i18nKey: 'AQAR',                                    logo: require('../../assets/images/aqar-logo.png') },
  { name: 'Deal App',     i18nKey: 'Deal App',                                logo: require('../../assets/images/dealapp.jpg') },
  { name: '24 Souq',      i18nKey: '24 Souq',                                 logo: require('../../assets/images/souq24.jpg') },
  { name: 'Era Pulse',    i18nKey: 'Era Pulse',                               logo: require('../../assets/images/erapulse.jpg') },
  { name: 'Al Nowaisiry', i18nKey: 'Al Nowaisiry Real Estate',               logo: require('../../assets/images/nowaisiry.jpg') },
  { name: '1 October',    i18nKey: '1 October Real Estate',                   logo: require('../../assets/images/october.jpg') },
  { name: 'Muktamel',     i18nKey: 'Muktamel',                                logo: require('../../assets/images/muktamel.jpg') },
  { name: 'Arkaan',       i18nKey: 'Arkaan Al Aqar',                          logo: require('../../assets/images/arkaan.png') },
  { name: 'Abralosol',    i18nKey: 'Abr Al Osol Real Estate',                 logo: require('../../assets/images/abralosol.png') },
  { name: 'THERC',        i18nKey: 'The Right Choice Real Estate',            logo: require('../../assets/images/therc.png') },
  { name: 'Rawasi Dark',  i18nKey: 'Rawasi Dark Real Estate',                 logo: require('../../assets/images/rawasidark.png') },
  { name: 'Aouj',         i18nKey: 'Aouj Estates',                            logo: require('../../assets/images/aouj.png') },
];

// Ordered SPECIFIC-first token → platform name map, mirroring ResultCard's SourceBadge matching so a
// raw listing/source value ("aqargate", "aqar_commercial", "gathern", "aqarmonthly") resolves to
// exactly ONE platform. Generic "aqar" is LAST so aqargate/aqarcity/aqaratikom/aqarmonthly win first.
// Used to (a) resolve a user's `sources` filter, (b) figure out which pool platforms actually appear
// in a result set, AND (c) filter PLATFORM_META against the live-active set returned by
// loader_active_platforms_ar().
const SOURCE_TOKENS: Array<[string, string]> = [
  ['wasalt', 'Wasalt'], ['aldarim', 'Aldarim'], ['aqargate', 'Aqargate'], ['aqarcity', 'Aqarcity'],
  ['aqaratikom', 'Aqaratikom'], ['aqarmonthly', 'Aqar Monthly'],
  ['alhoshan', 'Alhoshan'], ['alkhaas', 'Al Khaas'],
  ['hajer', 'Hajer'], ['sanadak', 'Sanadak'], ['eastabha', 'Eastabha'], ['raghdan', 'Raghdan'],
  ['eaqartabuk', 'Eaqartabuk'], ['satel', 'Satel'], ['sadin', 'Sadin'],
  ['mustqr', 'Mustqr'], ['mustaqr', 'Mustqr'], ['ramzalqasim', 'Ramzalqasim'], ['ramzalqassim', 'Ramzalqasim'],
  ['fursaghyr', 'Fursaghyr'], ['jazwtn', 'Jazwtn'], ['jazan', 'Jazwtn'],
  ['mizlaj', 'Mizlaj'], ['abeea', 'Abeea'], ['jurash', 'Jurash'],
  ['gathern', 'Gathern'], ['dealapp', 'Deal App'], ['deal', 'Deal App'], ['souq', '24 Souq'],
  ['erapulse', 'Era Pulse'], ['pulse', 'Era Pulse'], ['nowaisiry', 'Al Nowaisiry'], ['october', '1 October'],
  ['muktamel', 'Muktamel'], ['arkaan', 'Arkaan'],
  ['abralosol', 'Abralosol'], ['therc', 'THERC'], ['rawasidark', 'Rawasi Dark'], ['aouj', 'Aouj'],
  ['aqar', 'Aqar'],
];

// Raw source/table value → canonical platform name (or null if it matches nothing we know).
export function normalizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  for (const [tok, name] of SOURCE_TOKENS) if (s.includes(tok)) return name;
  return null;
}

// RUNTIME truth source lives in a separate file (loaderActivePlatforms.ts) so this file has zero
// dependency on the Supabase client — the barrier (scripts/verify-loader-platforms-match-active.ts)
// can import PLATFORM_META and normalizeSource without pulling Metro-only path aliases into a
// plain-Node test process. See loaderActivePlatforms.ts for fetchActivePlatformNames().

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

// Choose which platforms the searching strip shows for THIS search.
//
// If `activeNames` is provided (from fetchActivePlatformNames), the roster is FILTERED to just
// platforms that currently have reachable rows in production — a scraper that went cold today
// stops advertising within one page-load without a deploy. If undefined (RPC not yet resolved, or
// the request failed), the full PLATFORM_META is used — safe degradation, never fewer than reality.
//
// `resultSources` (raw source values from the listings that actually came back, once known) only
// REORDERS the display — platforms that truly contributed lead the strip — it never removes a
// platform. `offset` rotates the rest per search so repeat searches don't always show the same
// visual order.
export function pickLoaderPlatforms(
  resultSources: string[] | undefined,
  offset: number,
  activeNames?: Set<string> | null,
): LoaderPlatform[] {
  const catalog = activeNames && activeNames.size
    ? PLATFORM_META.filter((p) => activeNames.has(p.name))
    : PLATFORM_META;
  const inResults = new Set((resultSources ?? []).map((s) => normalizeSource(s)).filter(Boolean) as string[]);
  const pri = catalog.filter((p) => inResults.has(p.name));
  const rest = rotate(catalog.filter((p) => !inResults.has(p.name)), offset);
  return [...pri, ...rest];
}
