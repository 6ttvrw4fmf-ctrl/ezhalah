// Hermetic proof of scripts/lib/hydrationDrops.ts — the one rule the live count robots use to judge an honest headline.
// Executes the functions on synthetic hydration traffic; every mutation must be caught.
import { newHydrationLedger, recordHydration, dropsOf, honestHeadline, MAX_HYDRATION_DROPS } from './lib/hydrationDrops.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };

const led = newHydrationLedger();
const url = (tbl: string, ids: number[]) => `https://ezhalah.com/sb/rest/v1/${tbl}?select=id,price&id=in.%28${ids.join('%2C')}%29&active=eq.true`;
check('a hydration response is recorded', recordHydration(led, url('aqar_residential_listings', [1, 2, 3]), true, [{ id: 1 }, { id: 3 }], 5));
check('a failed chunk is not recorded (not a drop)', !recordHydration(led, url('wasalt_residential_listings', [9]), false, [], 6));
const rows = ['aqar_residential_listings:1', 'aqar_residential_listings:2', 'aqar_residential_listings:3'];
const d = dropsOf(led, rows, 4);
check('one row asked and not returned is one measured drop', d.n === 1 && d.keys[0] === 'aqar_residential_listings:2');
check('a row whose request was never observed makes the allowance null', dropsOf(led, [...rows, 'wasalt_residential_listings:9'], 4).n === null);
check('a request older than the search does not count', dropsOf(led, rows, 6).n === null);
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
check('headline == rpc − 1 with one measured drop is honest', honestHeadline(99, 100, 1));
check('headline == rpc with zero drops is honest', honestHeadline(100, 100, 0));
check('headline == rpc with unobserved drops is honest', honestHeadline(100, 100, null));
// mutations — each must be REJECTED
check('MUTATION an unsubtracted headline with one measured drop is caught', !honestHeadline(100, 100, 1));
check('MUTATION a headline one below with zero drops is caught', !honestHeadline(99, 100, 0));
check('MUTATION a headline one below with unobserved drops is caught', !honestHeadline(99, 100, null));
check('MUTATION a headline above the total is caught', !honestHeadline(101, 100, 1));
check('MUTATION a miscount by two with one drop is caught', !honestHeadline(98, 100, 1));
check('MUTATION drift above the cap is caught', !honestHeadline(100 - (MAX_HYDRATION_DROPS + 1), 100, MAX_HYDRATION_DROPS + 1));
check('MUTATION an unreadable headline is caught', !honestHeadline(null, 100, 0));

console.log(failed ? `\n❌ ${failed} check(s) failed` : '\n✅ the honest-headline allowance is exact and measured');
process.exit(failed ? 1 : 0);
