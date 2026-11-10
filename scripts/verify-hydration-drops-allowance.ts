// Hermetic proof of scripts/lib/hydrationDrops.ts — the one rule the live count robots use to judge an honest headline.
// Executes the functions on synthetic hydration traffic; every mutation must be caught.
import { newHydrationLedger, recordHydration, beginHydration, dropsOf, honestHeadline, isResultsPage, newestBySeq, pickResultsSearch, MAX_HYDRATION_DROPS } from './lib/hydrationDrops.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
// A mutation proof: `caught` must be TRUE when the rule rejects the deliberately broken input.
const mustCatch = (label: string, caught: boolean) => check(`MUTATION ${label}`, caught);

const led = newHydrationLedger();
const url = (tbl: string, ids: number[]) => `https://ezhalah.com/sb/rest/v1/${tbl}?select=id,price&id=in.%28${ids.join('%2C')}%29&active=eq.true`;
check('a hydration response is recorded', recordHydration(led, url('aqar_residential_listings', [1, 2, 3]), true, [{ id: 1 }, { id: 3 }], 5));
check('a failed chunk is not recorded (not a drop)', !recordHydration(led, url('wasalt_residential_listings', [9]), false, [], 6));
const rows = ['aqar_residential_listings:1', 'aqar_residential_listings:2', 'aqar_residential_listings:3'];
const d = dropsOf(led, rows, 4);
check('one row asked and not returned is one measured drop', d.n === 1 && d.keys[0] === 'aqar_residential_listings:2');
check('a row whose request was never observed makes the allowance null', dropsOf(led, [...rows, 'wasalt_residential_listings:9'], 4).n === null);
check('a request older than the search does not count', dropsOf(led, rows, 6).n === null);
// two successful responses for two tables: the drops of both are measured together
check('a second hydration response is recorded', recordHydration(led, url('wasalt_residential_listings', [9, 10]), true, [{ id: 9 }], 7));
const combined = dropsOf(led, [...rows, 'wasalt_residential_listings:9', 'wasalt_residential_listings:10'], 4);
check('drops accumulate across responses', combined.n === 2 && combined.keys.includes('aqar_residential_listings:2') && combined.keys.includes('wasalt_residential_listings:10'));
// CROSSING (CodeRabbit, PR 11725): a newer search (seq 10) hydrates id 7 and loses it; an OLDER search's response that
// had returned id 7 arrives later with an earlier stamp (seq 8) — it must not mask the newer drop or overwrite it.
const x = newHydrationLedger();
recordHydration(x, url('haraj_residential_listings', [7, 8]), true, [{ id: 8 }], 11);          // newer search's hydration: 7 dropped
recordHydration(x, url('haraj_residential_listings', [7]), true, [{ id: 7 }], 9);              // older response, read later
const xd = dropsOf(x, ['haraj_residential_listings:7', 'haraj_residential_listings:8'], 10);
check('an older response read late neither masks nor overwrites the newer drop', xd.n === 1 && xd.keys[0] === 'haraj_residential_listings:7');
const y = newHydrationLedger();
recordHydration(y, url('haraj_residential_listings', [5]), true, [{ id: 5 }], 3);              // an older search got id 5 back
recordHydration(y, url('haraj_residential_listings', [5]), true, [], 12);                      // the newer search lost it
check('a row an older search got back cannot mask the newer search drop', dropsOf(y, ['haraj_residential_listings:5'], 10).n === 1);
// An older search's hydration ARRIVING after the newer one's (seq 13 > 11) and disagreeing: ambiguous → unmeasured.
const z = newHydrationLedger();
recordHydration(z, url('haraj_residential_listings', [4]), true, [], 11);                      // newer search: 4 dropped
recordHydration(z, url('haraj_residential_listings', [4]), true, [{ id: 4 }], 13);             // older search's, arriving later
check('an older hydration arriving later and disagreeing makes the count unmeasured', dropsOf(z, ['haraj_residential_listings:4'], 10).n === null);
mustCatch('that ambiguous overlap cannot excuse an unsubtracted or a subtracted headline', !honestHeadline(99, 100, dropsOf(z, ['haraj_residential_listings:4'], 10).n));
check('headline == rpc − 1 with one measured drop is honest', honestHeadline(99, 100, 1));
check('headline == rpc with zero drops is honest', honestHeadline(100, 100, 0));
check('headline == rpc with unobserved drops is honest', honestHeadline(100, 100, null));
// mutations — each must be REJECTED
mustCatch('an unsubtracted headline with one measured drop is caught', !honestHeadline(100, 100, 1));
mustCatch('a headline one below with zero drops is caught', !honestHeadline(99, 100, 0));
mustCatch('a headline one below with unobserved drops is caught', !honestHeadline(99, 100, null));
mustCatch('a headline above the total is caught', !honestHeadline(101, 100, 1));
mustCatch('a miscount by two with one drop is caught', !honestHeadline(98, 100, 1));
mustCatch('drift above the cap is caught', !honestHeadline(100 - (MAX_HYDRATION_DROPS + 1), 100, MAX_HYDRATION_DROPS + 1));
mustCatch('an unreadable headline is caught', !honestHeadline(null, 100, 0));

// RESULTS-PAGE SELECTION (CodeRabbit, PR 11725): a results page with two drops followed by a count probe — the probe
// must never become the search the headline is judged against.
const results = { body: { p_offset: 0, p_limit: 1500 }, rows: ['t_listings:1', 't_listings:2', 't_listings:3'], seq: 20 };
const probe = { body: { p_offset: 0, p_limit: 1 }, rows: ['t_listings:2'], seq: 21 };
const picked = newestBySeq([results, probe].filter((s) => isResultsPage(s.body)));
check('a count probe arriving after the results page never replaces it', picked === results);
check('a later page is not a results page', !isResultsPage({ p_offset: 1500, p_limit: 1500 }));
mustCatch('selecting the newest response WITHOUT the results-page filter would pick the probe', newestBySeq([results, probe]) === probe);
const late = [{ seq: 30, id: 'newer' }, { seq: 25, id: 'older-read-late' }];
check('the newest ARRIVAL wins, not the last body read', newestBySeq(late)?.id === 'newer');
mustCatch('taking the last array entry instead would pick the older response', late[late.length - 1].id === 'older-read-late');

// PENDING (CodeRabbit, PR 11725): an older hydration omitted id 6 after the search started while the newer hydration's
// body is still being read — no verdict until it lands.
const pz = newHydrationLedger();
recordHydration(pz, url('haraj_residential_listings', [6]), true, [], 12);          // older search's omission, recorded
const doneNewer = beginHydration(pz);                                                 // newer response arrived, body pending
check('while a hydration body is still pending the count is unmeasured', dropsOf(pz, ['haraj_residential_listings:6'], 10).n === null);
mustCatch('a pending body cannot let the older omission excuse a reduced headline', !honestHeadline(99, 100, dropsOf(pz, ['haraj_residential_listings:6'], 10).n));
recordHydration(pz, url('haraj_residential_listings', [6]), true, [{ id: 6 }], 13); doneNewer();
check('once the newer body lands the disagreement makes it unmeasured, never a drop', dropsOf(pz, ['haraj_residential_listings:6'], 10).n === null);

// THE HANDLER'S RULE (CodeRabbit, PR 11725): a results page with TWO measured drops, then a later count probe whose single
// row is one of the dropped ones. The kept search must stay the results page, so the drop count stays 2.
const hl = newHydrationLedger();
const page = { body: { p_offset: 0, p_limit: 1500 }, rows: ['t_listings:1', 't_listings:2', 't_listings:3'], seq: 40 };
recordHydration(hl, url('t_listings', [1, 2, 3]), true, [{ id: 1 }], 41);
const probeLate = { body: { p_offset: 0, p_limit: 1 }, rows: ['t_listings:2'], seq: 42 };
let kept: typeof page | null = null;
for (const r of [page, probeLate]) kept = pickResultsSearch(kept, r);
const keptDrops = kept ? dropsOf(hl, kept.rows, kept.seq).n : null;
check('the handler rule keeps the results page after a later probe, two drops measured', kept === page && keptDrops === 2);
check('an honest headline (rpc − 2) passes on the kept page', honestHeadline(98, 100, keptDrops));
// mutation: the same handler without the results-page filter keeps the probe and measures the wrong count
const noFilter = (k: any, a: any) => (!k || a.seq > k.seq ? a : k);
let keptBroken: any = null; for (const r of [page, probeLate]) keptBroken = noFilter(keptBroken, r);
mustCatch('a handler without the filter keeps the probe and rejects the honest rpc − 2 headline',
  keptBroken === probeLate && !honestHeadline(98, 100, dropsOf(hl, keptBroken.rows, keptBroken.seq).n));
// WIRING: the Trending robot's search branch must route through pickResultsSearch, so removing it there turns this red
import { readFileSync } from 'node:fs';
const trending = readFileSync(new URL('./verify-trending-live-four-way-truth.ts', import.meta.url), 'utf8');
const at = trending.indexOf("u.includes('/rpc/location_search_candidates_ar'))");
const branch = at < 0 ? '' : trending.slice(at, at + 240);   // the search branch of the response listener
check('the Trending robot keeps its search through pickResultsSearch (wiring)', /lastSearch\s*=\s*pickResultsSearch\(/.test(branch));
mustCatch('a branch that assigns lastSearch directly fails the wiring check',
  !/lastSearch\s*=\s*pickResultsSearch\(/.test(branch.replace('pickResultsSearch(lastSearch, ', '(')));

console.log(failed ? `\n❌ ${failed} check(s) failed` : '\n✅ the honest-headline allowance is exact and measured');
process.exit(failed ? 1 : 0);
