// Permanent guard: a hard web REFRESH on a results URL must not throw the user's search away.
// (Search & Matching QA, 2026-08-14 — SEARCH_MATCH_QA_ENGINEER.md §29 "Refresh, back, and state
// persistence".)
//
// The bug this locks out, observed live on https://ezhalah-app.vercel.app: a Filter search routes to
// `/agent?filter=<JSON SearchQuery>` — the whole query («إيجار»/«شراء», «سنوي»/«شهري», المدينة,
// الأحياء, فئة/نوع, غرف النوم, السعر, المساحة) travels in the URL, and agent.tsx re-runs it on open.
// A blanket "every web refresh goes Home" rule in _layout.tsx fired first, so refreshing (or opening a
// bookmarked/shared results link) landed on Home with every selection silently dropped and no search
// run at all. The rule is right for screens that really do come back empty; it must skip the ones that
// can rebuild themselves.
//
// webRefreshRoute.ts is zero-dep, so this EXECUTES the real decision rather than grepping for it.
//   node --experimental-strip-types scripts/verify-refresh-restores-filter-search.ts   (wired into `npm test`)
import { readFileSync, existsSync } from 'node:fs';
import { shouldSendRefreshHome, hasRestorableQuery } from '../src/lib/webRefreshRoute.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// A real filter payload, exactly as the app serialises it into the URL (captured from production).
const REAL_FILTER = JSON.stringify({
  deal: 'Rent', location: 'الرياض', category: 'Residential', rentPeriod: 'annual',
  typeGroup: 'Apartments & Co-living', types: ['Apartment'], contextBedsList: ['3'],
  priceMin: '40000', priceMax: '90000', areaMin: '100', areaMax: '250',
  districts: ['حي النرجس', 'حي الملقا'], districtLabel: 'حي النرجس وحي الملقا',
});

// 1) A results URL that can restore itself is NEVER sent Home.
check('/agent + real ?filter= stays put (the whole search survives refresh)',
  shouldSendRefreshHome('/agent', `?filter=${encodeURIComponent(REAL_FILTER)}`) === false);
check('/agent + ?seed= stays put ("Start here" chip link survives refresh)',
  shouldSendRefreshHome('/agent', '?seed=%D8%B4%D9%82%D8%A9') === false);
check('/agent + both filter and seed stays put',
  shouldSendRefreshHome('/agent', `?seed=x&filter=${encodeURIComponent(REAL_FILTER)}`) === false);

// 2) Screens that genuinely come back empty still go Home — the original behaviour is preserved.
check('/agent with NO query still goes Home (nothing to restore)',
  shouldSendRefreshHome('/agent', '') === true);
check('/agent with a malformed filter goes Home (would render empty)',
  shouldSendRefreshHome('/agent', '?filter=not-json') === true);
check('/agent with a non-object filter goes Home',
  shouldSendRefreshHome('/agent', '?filter=%5B1%2C2%5D') === true);
check('/agent with an empty seed goes Home',
  shouldSendRefreshHome('/agent', '?seed=%20') === true);
check('/settings goes Home', shouldSendRefreshHome('/settings', '') === true);
check('/interview goes Home even with a filter (only /agent self-restores)',
  shouldSendRefreshHome('/interview', `?filter=${encodeURIComponent(REAL_FILTER)}`) === true);
check('/about goes Home', shouldSendRefreshHome('/about', '?filter=%7B%7D') === true);

// 3) Home and the OAuth callback are never redirected.
check('/ is left alone', shouldSendRefreshHome('/', '') === false);
check('/auth is left alone (OAuth redirect must finish signing in)',
  shouldSendRefreshHome('/auth', '?code=abc') === false);
check('empty pathname is left alone', shouldSendRefreshHome('', '') === false);
check('null pathname is left alone', shouldSendRefreshHome(null, '') === false);

// 4) hasRestorableQuery only accepts a payload the screen can actually rebuild from.
check('hasRestorableQuery: real filter → true', hasRestorableQuery(`?filter=${encodeURIComponent(REAL_FILTER)}`) === true);
check('hasRestorableQuery: empty object filter → true', hasRestorableQuery('?filter=%7B%7D') === true);
check('hasRestorableQuery: garbage → false', hasRestorableQuery('?filter=%7Bnope') === false);
check('hasRestorableQuery: no query at all → false', hasRestorableQuery('') === false);
check('hasRestorableQuery: unrelated params → false', hasRestorableQuery('?utm_source=x') === false);

// 5) The screen the fix exists for must still consume ?filter= on open — otherwise "don't go Home"
//    would just leave the user on a blank /agent.
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
check('agent.tsx still reads the filter param', /useLocalSearchParams<[\s\S]{0,400}?>/.test(agent) && /\bfilter\b/.test(agent));
check('agent.tsx still runs a ?filter= search on open',
  /if\s*\(\s*filter\s*&&\s*filter\s*!==\s*lastFilterRef\.current\s*\)/.test(agent));

// 5b) …and it must SEED the shared filter state from that payload, or the second half of the class
//     comes back: results restore fine, but reopening «تصفية» shows a blank form and «بحث» dies with
//     «الرجاء اختيار مدينة من القائمة». The app context is the only thing the home form rehydrates
//     from (index.tsx city/district rehydration effects read `query`), and a hard refresh resets it
//     to HOME_DEFAULT_QUERY(), so the parsed payload has to be written back. (QA §29, 2026-08-15.)
const filterBranch = agent.slice(agent.indexOf('const q = JSON.parse(filter)'));
check('agent.tsx pulls setQuery out of useApp (can seed the filter form)',
  /const\s*\{[^}]*\bsetQuery\b[^}]*\}\s*=\s*useApp\(\)/.test(agent));
check('agent.tsx seeds the app query from the parsed ?filter= payload, before the search runs',
  /setQuery\(\s*\(\s*\)\s*=>\s*q\s*\)/.test(filterBranch)
  && filterBranch.search(/setQuery\(/) < filterBranch.indexOf('sendFilter(q'));

// 5c) setQuery takes an UPDATER FUNCTION, never a value. `setQuery(q)` type-checks nowhere and
//     throws «TypeError: e is not a function» at runtime the moment a filter search opens — it
//     SHIPPED that way on 2026-08-15 (PR#661) and killed search app-wide until PR#662 reverted it.
//     The store does setQueryState((prev) => updater(prev)), so a plain object gets *called*.
check('agent.tsx never calls setQuery with a bare value (the 2026-08-15 outage signature)',
  !/setQuery\(\s*(?!\(|function\b)[A-Za-z_$][\w$]*\s*\)/.test(agent));

// 5d) The runtime half of this barrier must stay present and reachable. Static checks like the ones
//     above were ALL GREEN on the broken commit — only a real browser catches a runtime TypeError.
const smoke = new URL('./verify-web-runtime-smoke.mjs', import.meta.url);
const wf = new URL('../.github/workflows/web-runtime-smoke.yml', import.meta.url);
check('the browser runtime smoke test still exists', existsSync(smoke));
check('the runtime smoke test drives «بحث» and asserts the page does not blank',
  existsSync(smoke) && /does not blank the page/.test(readFileSync(smoke, 'utf8')));
check('a workflow still runs the runtime smoke test on src/ changes', existsSync(wf)
  && /verify-web-runtime-smoke\.mjs/.test(readFileSync(wf, 'utf8'))
  && /src\/\*\*/.test(readFileSync(wf, 'utf8')));

// 6) The layout must route its decision through the shared helper (no re-inlined divergent copy).
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
check('_layout.tsx imports shouldSendRefreshHome', /from\s+'@\/lib\/webRefreshRoute'/.test(layout));
check('_layout.tsx calls shouldSendRefreshHome', /shouldSendRefreshHome\s*\(/.test(layout));
check('_layout.tsx has no unconditional pathname !== "/" redirect left',
  !/pathname\s*!==\s*'\/'\s*&&\s*pathname\s*!==\s*'\/auth'\s*\)\s*\{?\s*router\.replace\('\/'\)/.test(layout));
check('_layout.tsx passes the real query string, not a hardcoded one',
  /window\.location\.search/.test(layout));

console.log(failed ? `\n${failed} FAILED` : '\nAll refresh-restore checks passed');
process.exit(failed ? 1 : 0);
