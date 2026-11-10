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
