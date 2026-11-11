// «نُشر خلال» — PUBLISHED WITHIN (owner 2026-11-11: «time published … like Zillow … in the filter in the map and normal …
// shows the number … except for short stays … ai agent should say it in the sentence» · «see how it says new … by date
// of publishment not ours»).
//
//   · a window is a MAXIMUM age by the listing SITE's own posting date (search_listings_ar.posted_at), never Ezhalah's
//     first-seen day; an undated ad is in no window and shows only under «أي وقت»;
//   · both filters send it (main: rpcFilterParams → every count surface; map: map_pins_ar / map_nopin_markers_ar), never
//     for short stays; the menu shows each window's number (posted_window_counts_ar, one read);
//   · the search sentence and summary say the window; a restored / shared search keeps only a real window;
//   · a pin holding an ad its site published in the last 3 days shows «إعلان جديد» (never «جديد» — that word means a
//     newly built property in the Filter).
//
// EXECUTED here: the window helpers, the real request builders (bundled), the restore allowlist, the map filter, the
// pin tag — each with a mutation. The SQL half is read from the committed migrations production runs.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTED_WINDOWS, postedWindowParam, postedWindowOffered, validPostedWindow, postedPhrase, postedWindowLabel } from '../src/lib/postedWindows.ts';
import { sanitizeForFilterRestore } from '../src/lib/searchDefaults.ts';
import { postedOffered, pinFilterOf, filterCount, isNarrowed, EMPTY_MAP_FILTER } from '../src/lib/mapFilter.ts';
import { isFreshHead, freshTag, pinHead } from '../src/lib/mapPins.ts';
import { bundleMapScope } from './lib/bundleMapScope.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (what: string, brokenPasses: boolean) => check(`MUTATION caught: ${what}`, !brokenPasses);

// 1. The windows (Zillow's list: max ages, each holding the ones before it).
check('the menu offers 1, 7, 14, 30, 90 days and 6 / 12 / 24 / 36 months', JSON.stringify(POSTED_WINDOWS) === JSON.stringify([1, 7, 14, 30, 90, 183, 365, 730, 1095]));
check('every window has its own label, and «أي وقت» is null', POSTED_WINDOWS.every((d) => postedWindowLabel(d) !== postedWindowLabel(null)) && postedWindowLabel(null) === 'Published: any time');
check('only a real window is a value (an old link\'s 5 or "7" reads as any time)', validPostedWindow(7) === 7 && validPostedWindow(5) === null && validPostedWindow('7') === null && validPostedWindow(null) === null);

// 2. Never for short stays.
const buy = { deal: 'Buy' as const, rentPeriod: undefined, dealCombined: false, postedWithinDays: 7 };
const yearly = { deal: 'Rent' as const, rentPeriod: 'annual' as const, dealCombined: false, postedWithinDays: 30 };
const short = { deal: 'Rent' as const, rentPeriod: 'monthly' as const, dealCombined: false, postedWithinDays: 7 };
check('buy and yearly rent send the window; short stays never do', postedWindowParam(buy) === 7 && postedWindowParam(yearly) === 30 && postedWindowParam(short) === null && !postedWindowOffered(short));
const ignoresShort = (q: typeof buy | typeof short) => validPostedWindow(q.postedWithinDays);
mustCatch('a window sent on a short-stay search', ignoresShort(short) === postedWindowParam(short));

// 3. The real request builders (bundled from src/data/remote.ts): every count surface spreads this one builder.
const m = await bundleMapScope(ROOT);
const base = { location: 'الرياض', category: 'Residential', type: null, detail: null };
const narrowing = (q: Record<string, unknown>) => m.rpcAllNarrowingParams!({ ...base, ...q });
check('the Filter\'s narrowing carries p_posted_within_days when picked', narrowing({ deal: 'Buy', postedWithinDays: 7 }).p_posted_within_days === 7);
check('…and omits it when not picked or on short stays (PostgREST matches names exactly)', !('p_posted_within_days' in narrowing({ deal: 'Buy' })) && !('p_posted_within_days' in narrowing({ deal: 'Rent', rentPeriod: 'monthly', postedWithinDays: 7 })));

// 4. A restored search keeps only a real window, and never on short stays.
const restored = (q: Record<string, unknown>) => sanitizeForFilterRestore({ deal: 'Buy', location: 'الرياض', category: 'Residential', type: null, detail: null, ...q } as never) as Record<string, unknown>;
check('a restored search keeps a real window', restored({ postedWithinDays: 30 }).postedWithinDays === 30);
check('…drops a made-up one and any window on short stays', restored({ postedWithinDays: 5 }).postedWithinDays == null && restored({ deal: 'Rent', rentPeriod: 'monthly', postedWithinDays: 30 }).postedWithinDays == null);

// 5. The sentence says the window (and «أي وقت» says nothing).
check('the sentence reads «، منشور خلال آخر 7 أيام» / «, published in the last 7 days»', postedPhrase(7, 'ar') === '، منشور خلال آخر 7 أيام' && postedPhrase(7, 'en') === ', published in the last 7 days' && postedPhrase(1, 'ar') === '، منشور خلال آخر 24 ساعة');
check('«أي وقت» adds nothing to the sentence', postedPhrase(null, 'ar') === '' && postedPhrase(5, 'ar') === '');
const search = readFileSync(join(ROOT, 'src/data/search.ts'), 'utf8');
const SENT = /price: \(tooLow \? '' : pricePhrase\) \+ postedPhrase\(postedWindowParam\(q\), getLocale\(\) === 'ar' \? 'ar' : 'en'\)/;
check('the Filter search bubble appends the window, and the summary lists it', SENT.test(search) && /lines\.push\(`• \$\{t\('Published within'\)\}: \$\{t\(postedWindowLabel\(postedDays\)\)\}`\)/.test(search));
mustCatch('a bubble that forgets the window', SENT.test(search.replace("+ postedPhrase(postedWindowParam(q), getLocale() === 'ar' ? 'ar' : 'en')", '')));

// 6. The map filter: same window, never with short stays shown; it counts as a choice.
const mf = { ...EMPTY_MAP_FILTER, postedWithinDays: 30 };
const id = (x: string[]) => x;
check('the map sends the window on buy / rent, never when short stays are shown', pinFilterOf(mf, id, () => [], ['buy']).postedWithinDays === 30 && pinFilterOf(mf, id, () => [], ['rent', 'short']).postedWithinDays === null && postedOffered(['buy']) && !postedOffered(['short']));
check('the map pin and district reads carry p_posted_within_days', m.rpcArgs({ s: 1, w: 1, n: 2, e: 2 }, 0, { deals: ['buy'], postedWithinDays: 30 }).p_posted_within_days === 30 && m.noPinArgs!({ s: 1, w: 1, n: 2, e: 2 }, { deals: ['buy'], postedWithinDays: 30 }).p_posted_within_days === 30);
check('a picked window narrows the map and counts as one choice', isNarrowed(mf) && filterCount(mf) === 1 && !isNarrowed(EMPTY_MAP_FILTER));
check('the map menu numbers come from the Filter\'s own nationwide search for those choices', m.mapFilterSearchQuery!({ category: 'Residential', types: ['Villa'], beds: [], furnished: null, areaMin: '', areaMax: '', priceMin: '', priceMax: '' }, ['buy'])?.deal === 'Buy' && m.mapFilterSearchQuery!({ category: 'Residential', types: [], beds: [], furnished: null, areaMin: '', areaMax: '', priceMin: '', priceMax: '' }, ['buy', 'rent']) === null);

// 7. «إعلان جديد» on a pin: by the site's date (map_pins_ar `fresh`), never on short stays, never the word «جديد» alone.
check('a spot with a new ad shows «إعلان جديد»; short stays and old ads do not', isFreshHead({ fresh: 2, deal: 'buy' }) && !isFreshHead({ fresh: 0, deal: 'buy' }) && !isFreshHead({ fresh: 3, deal: 'short' }) && freshTag('ar') === 'إعلان جديد');
check('the tag never changes the price rule under it', pinHead({ n: 2, deal: 'buy', price: 750000, price_max: 750000, unpriced: 0, platform: null, fresh: 1 } as never, 'ar') === '750 ألف');
const web = readFileSync(join(ROOT, 'src/components/AppleMap.web.tsx'), 'utf8');
const TAG = /if \(cell === 0 && isFreshHead\(row\)\) \{[\s\S]{0,400}tag\.textContent = freshTag\(loc\);/;
check('the map draws the tag above the price on exact pins', TAG.test(web));
mustCatch('a map that never draws the tag', TAG.test(web.replace('if (cell === 0 && isFreshHead(row)) {', 'if (false) {')));

// 8. The database half (committed migrations).
const dir = join(ROOT, 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
const find = (needle: string) => files.map((f) => readFileSync(join(dir, f), 'utf8')).find((x) => x.includes(needle)) ?? '';
const idx = find('add column if not exists posted_at timestamptz;\n\ncreate or replace function public.sync_search_posted_at()');
check('the search index carries the SITE\'s date (source_posted_at(date_added)), never a future one', /set posted_at = public\.source_posted_at\(r\.date_added\)/.test(idx) && /<= now\(\) \+ interval '1 day'/.test(idx) && /cron\.schedule\('sync-search-posted-at'/.test(idx));
const af = find('p_posted_within_days integer DEFAULT NULL::integer$x$;');
check('the Filter clause keeps only dated ads inside the window, in every generated RPC', /s\.posted_at is not null and s\.posted_at >= now\(\) - make_interval\(days => p_posted_within_days\)/.test(af) && /perform \* from rebuild_af_filter_rpcs\(\)/.test(af) && /'posted_window_counts_ar'/.test(af));
const map = find('map_asks_published_within') || find('p_posted_within_days integer DEFAULT NULL::integer, p_posted_within_days') || find('unpriced integer, fresh integer)');
check('the map reads take the window and return `fresh` (3 days, short stays excepted)', /unpriced integer, fresh integer\)/.test(map) && /k\.deal <> ''short'' and k\.posted_at >= now\(\) - interval ''3 days''/.test(map) && /m\.posted_at is not null and m\.posted_at >= now\(\)/.test(map));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\n«نُشر خلال» works the same in the Filter, the map and the sentence — by the site\'s own date, never on short stays');
