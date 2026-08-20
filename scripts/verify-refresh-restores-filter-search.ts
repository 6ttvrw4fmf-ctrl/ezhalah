// Permanent guard: A BROWSER REFRESH MUST NEVER COUNT AS A NEW USER SEARCH.
//
// ⚠️ THIS FILE'S CONTRACT WAS DELIBERATELY REVERSED ON 2026-08-16 BY OWNER DECISION. Read this
// before "fixing" anything here — the previous behaviour is not a bug to restore.
//
// Until 2026-08-16 the rule was the opposite: a refresh on `/agent?filter=…` RESTORED the search by
// re-running it (QA §29, 2026-08-14/15), and this file asserted that. The owner then ruled that out
// in full:
//
//     "Right now, when I refresh the page while I am inside a chat/search, it appears to run or
//      reconstruct the search again. I do not want that behavior. … A browser refresh must never
//      accidentally count as a new user search. There should be no duplicate AI request, duplicate
//      property-search RPC, duplicate conversation message, duplicate analytics event, or duplicate
//      saved conversation caused simply by refreshing."
//
// THE RULE NOW, for guests and signed-in users alike:
//   refresh inside a chat/search  →  the FILTER HOME screen (owner, 2026-08-16 rule 2: "when i
//                                    refresh takes me to the filter page … not this here")
//                                 →  ZERO AI calls, ZERO property RPCs, ZERO history writes
//   signed-in                     →  the conversation is already in the sidebar (saved at SEARCH
//                                    time, de-duped by query) and reopens only when clicked
//   guest                         →  nothing to restore; guests have no visible history
//
// ROOT CAUSE that was fixed (not patched): the agent screen treated `?filter=`/`?seed=` as a
// standing instruction re-evaluated on every mount, with nothing distinguishing "the user pressed
// «بحث»" from "the browser re-mounted this route". Two structural changes, no timers and no browser
// flags:
//   1. src/lib/appSession.ts — a search may only run in response to a user action inside a LIVE app
//      session. Params present when the DOCUMENT loaded are page-load params and never execute.
//   2. agent.tsx consumeSearchParams() — the params are a one-shot intent, cleared the moment they
//      are acted on, so a reload has no input left to replay and the URL matches what is on screen.
//
//   node --experimental-strip-types scripts/verify-refresh-restores-filter-search.ts  (in `npm test`)
import { readFileSync, existsSync } from 'node:fs';
import { shouldSendRefreshHome, hasRestorableQuery, AGENT_REFRESH_LANDS_HOME } from '../src/lib/webRefreshRoute.ts';
import { isAppSessionStarted, markAppSessionStarted, __resetAppSessionForTest } from '../src/lib/appSession.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const REAL_FILTER = JSON.stringify({
  deal: 'Rent', location: 'الرياض', category: 'Residential', rentPeriod: 'annual',
  typeGroup: 'Apartments & Co-living', types: ['Apartment'], contextBedsList: ['3'],
  priceMin: '40000', priceMax: '90000', areaMin: '100', areaMax: '250',
  districts: ['حي النرجس', 'حي الملقا'], districtLabel: 'حي النرجس وحي الملقا',
});

const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');

// 1) THE GATE — a page load never executes a search. Executed, not grepped.
__resetAppSessionForTest();
check('before boot completes, the session is NOT started (page-load params must not execute)',
  isAppSessionStarted() === false);
markAppSessionStarted();
check('after boot, the session IS started (in-app navigation may execute)',
  isAppSessionStarted() === true);
__resetAppSessionForTest();
check('the reset restores the pre-boot state (the rule is testable in both directions)',
  isAppSessionStarted() === false);

// 2) The agent screen must consult the gate BEFORE acting on any param, and must bail out of the
//    search branches entirely — not merely skip a line inside them.
const effect = agent.slice(agent.indexOf('const startFresh = ()'), agent.indexOf('}, [seed, filter, chatBubble, chatSub, replay, hid]);'));
check('agent.tsx imports the session gate', /from\s+'@\/lib\/appSession'/.test(agent));
check('agent.tsx drops page-load params instead of running them',
  /if\s*\(\s*\(\s*filter\s*\|\|\s*seed\s*\)\s*&&\s*!isAppSessionStarted\(\)\s*\)/.test(effect));
check('the page-load branch returns before any search branch is reached',
  effect.indexOf('!isAppSessionStarted()') < effect.indexOf('if (filter && filter !== lastFilterRef.current)')
  && /!isAppSessionStarted\(\)[\s\S]{0,400}?return;/.test(effect));
check('the page-load branch lands on the AI new-chat screen (greeting + empty composer)',
  /!isAppSessionStarted\(\)[\s\S]{0,400}?sendGreeting\(\)/.test(effect));
check('the page-load branch runs NO search (no sendFilter/send/openStatic before its return)',
  !/!isAppSessionStarted\(\)[\s\S]{0,300}?(sendFilter\(|openStatic\(|\bsend\(seed\))/.test(effect));

// 3) THE ONE-SHOT INTENT — params are consumed when acted on, so a reload has nothing to replay.
check('consumeSearchParams exists and clears every executable param', /const\s+consumeSearchParams\s*=/.test(agent)
  && /filter:\s*undefined/.test(agent) && /seed:\s*undefined/.test(agent)
  && /replay:\s*undefined/.test(agent) && /hid:\s*undefined/.test(agent));
check('the filter branch consumes its params after acting', /sendFilter\(q,\s*override\);[\s\S]{0,400}?consumeSearchParams\(\)/.test(effect));
check('the seed branch consumes its params after acting', /send\(seed\);\s*\n\s*consumeSearchParams\(\)/.test(effect));
check('a sidebar replay also consumes its params (refreshing a reopened chat starts new — req. 6)',
  /replay === '0'[\s\S]{0,600}?consumeSearchParams\(\)/.test(effect));
check('consuming marks the greeting handled so clearing params cannot inject a greeting mid-search',
  /greetedRef\.current = true;[\s\S]{0,200}?router\.setParams/.test(agent));

// 4) NOTHING may write a search back into the URL. PR#705 published results to `?filter=` so a
//    refresh would restore them — the exact behaviour the owner then rejected. If it comes back,
//    refresh silently starts re-running searches again.
check('playListings no longer publishes results to the URL (PR#705 reverted by owner decision)',
  !/publishSearchToUrl/.test(agent));
check('no setParams call writes a filter value back into the URL',
  !/setParams\(\s*\{[^}]*filter:\s*(?!undefined)[A-Za-z_$]/.test(agent));

// 5) Where the refresh LANDS (owner rule 2, 2026-08-16 — see this file's header). `/agent` no longer
//    gets an exemption: a hard refresh lands on the Filter home like every other deep route. This is
//    independent of rule 1 above — checks 2/3 already proved the reload executes nothing, and they
//    must keep passing alongside this.
check('/agent goes Home on a hard refresh, with or without params',
  shouldSendRefreshHome('/agent', '') === true
  && shouldSendRefreshHome('/agent', `?filter=${encodeURIComponent(REAL_FILTER)}`) === true
  && shouldSendRefreshHome('/agent', '?seed=%D8%B4%D9%82%D8%A9') === true);
check('/settings still goes Home', shouldSendRefreshHome('/settings', '') === true);
check('/interview still goes Home', shouldSendRefreshHome('/interview', `?filter=${encodeURIComponent(REAL_FILTER)}`) === true);
check('/about still goes Home', shouldSendRefreshHome('/about', '') === true);
check('/ is left alone', shouldSendRefreshHome('/', '') === false);
check('/auth is left alone (OAuth redirect must finish signing in)', shouldSendRefreshHome('/auth', '?code=abc') === false);
check('null/empty pathname is left alone',
  shouldSendRefreshHome(null, '') === false && shouldSendRefreshHome('', '') === false);
check('the contract constant states the rule for both halves', AGENT_REFRESH_LANDS_HOME === true);
check('_layout.tsx opens the session only AFTER this load\'s screen effects have run',
  /markAppSessionStarted/.test(layout) && /setTimeout\(markAppSessionStarted,\s*0\)/.test(layout));

// 6) hasRestorableQuery is retained to state what a reloaded URL must NOT contain.
check('hasRestorableQuery still detects an executable payload', hasRestorableQuery(`?filter=${encodeURIComponent(REAL_FILTER)}`) === true);
check('a consumed (bare) agent URL carries nothing executable', hasRestorableQuery('') === false);
check('unrelated params are not executable', hasRestorableQuery('?utm_source=x') === false);

// 7) INTENTIONAL behaviour that must keep working — the fix must not turn into "searches stop".
check('an in-session ?filter= still runs a search', /if\s*\(\s*filter\s*&&\s*filter\s*!==\s*lastFilterRef\.current\s*\)/.test(agent));
check('an in-session ?seed= still runs a search', /else if\s*\(\s*seed\s*&&\s*seed\s*!==\s*lastSeedRef\.current\s*\)/.test(agent));
check('the sidebar still reopens a saved chat via replay=0 + hid',
  /replay:\s*'0',\s*hid:\s*c\.id/.test(readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8')));
check('re-running the SAME query later still works (the handled-refs are released when params clear)',
  /if\s*\(\s*!filter\s*&&\s*!seed\s*\)[\s\S]{0,400}?lastFilterRef\.current = undefined;[\s\S]{0,120}?lastSeedRef\.current = undefined;/.test(effect));
check('agent.tsx still seeds the app query from a filter payload (تصفية stays usable)',
  /setQuery\(\s*\(\s*\)\s*=>\s*q\s*\)/.test(agent));
check('agent.tsx never calls setQuery with a bare value (the 2026-08-15 outage signature)',
  !/setQuery\(\s*(?!\(|function\b)[A-Za-z_$][\w$]*\s*\)/.test(agent));

// 8) Signed-in persistence: the conversation must already be saved BEFORE any refresh, and a repeat
//    must never fork a second copy. Both live in store.tsx and are asserted there.
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
check('history is written at SEARCH time, not at refresh time', /recordHistory\(/.test(store));
check('history de-dupes by QUERY, so a repeated search cannot create a second saved conversation',
  /const prior = h\.find\(\(it\) => sameQuery\(it\.query, q\)\)/.test(store));
check('history is bucketed per account, so a signed-in user sees their own chats after a refresh',
  /const historyKey = \(sub: string\) =>/.test(store));
// The rule this has always guarded is "a refresh cannot load the WRONG bucket". It used to be
// written as the literal ternary historyKey(user ? user.sub : 'guest'), because a guest had a bucket
// of their own. The owner's 2026-08-20 account-aware decision removed that bucket entirely — an
// anonymous search is never persisted — so the contract is now STRICTER, not looser: hydration still
// waits for the auth check, and the only key that can ever be read is the signed-in user's own.
// (verify-saved-search-identity.ts owns the rest of the account-aware contract.)
check('history hydration waits for the auth check, so a refresh cannot load the wrong bucket',
  /if \(!authChecked\) return;[\s\S]{0,600}?const key = user \? historyKey\(user\.sub\) : null;/.test(store));
check('a refresh as a GUEST loads no saved history at all (anonymous searches are never persisted)',
  /if \(!key\) \{[\s\S]{0,400}?setHistory\(\[\]\);[\s\S]{0,120}?return;/.test(store));

// 9) The runtime half. Static checks were ALL GREEN on the 2026-08-15 outage commit; only a real
//    browser proves the built app behaves.
const smoke = new URL('./verify-web-runtime-smoke.mjs', import.meta.url);
const wf = new URL('../.github/workflows/web-runtime-smoke.yml', import.meta.url);
check('the browser runtime smoke test still exists', existsSync(smoke));
// The edge half of the same decision: a hard load of /agent is answered by Vercel before any JS
// runs, so the user never waits for the bundle to boot just to be redirected. Pinned here because
// deleting it looks harmless (the client redirect still "works") while silently restoring the
// multi-second stuck screen the owner reported.
const vercelCfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as
  { redirects?: Array<{ source?: string; destination?: string; permanent?: boolean }> };
const agentEdge = (vercelCfg.redirects ?? []).find((r) => r.source === '/agent');
check('vercel.json redirects a hard /agent load to Home at the edge', !!agentEdge && agentEdge.destination === '/');
check('that edge redirect is NOT permanent (a 308 would be cached in browsers past any future change)',
  !!agentEdge && agentEdge.permanent === false);

check('the smoke test asserts BOTH halves at runtime: zero search requests AND landing on the Filter home',
  existsSync(smoke)
  && /refresh issues ZERO/.test(readFileSync(smoke, 'utf8'))
  && /refresh lands on the FILTER HOME/.test(readFileSync(smoke, 'utf8')));
check('a workflow still runs the runtime smoke test on src/ changes', existsSync(wf)
  && /verify-web-runtime-smoke\.mjs/.test(readFileSync(wf, 'utf8'))
  && /src\/\*\*/.test(readFileSync(wf, 'utf8')));

console.log(failed ? `\n${failed} FAILED` : '\nAll refresh-behaviour checks passed');
process.exit(failed ? 1 : 0);
