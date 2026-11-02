// The Trending live check must compare the screen with the call FOR THE SCOPE ON SCREEN, never with
// the last call captured (backlog 1144). EXECUTED against the 11-01 capture shape: the Buy pool,
// then the background Rent / Buy + Rent warm-ups (src/app/index.tsx «warm the next tap»).
import { readFileSync } from 'node:fs';
import { pickScreenCityCall, callMatchesScreen } from './lib/trendingScreenCall.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const buy = { body: { p_deal: 'بيع', p_category: 'Residential', p_types: null }, rows: [{ city_ar: 'الرياض', listing_count: 96842 }] };
const rent = { body: { p_deal: 'إيجار', p_rent_period: 'سنوي', p_category: 'Residential' }, rows: [{ city_ar: 'الرياض', listing_count: 69773 }] };
const both = { body: { p_deal: null, p_category: 'Residential' }, rows: [{ city_ar: 'الرياض', listing_count: 166615 }] };
const buyApt = { body: { p_deal: 'بيع', p_types: ['شقة'] }, rows: [] };
const buyPrice = { body: { p_deal: 'بيع', p_price_max: 900000, p_area_min: 120 }, rows: [] };
const calls = [buy, rent, both];
const screen = { deal: 'بيع', types: null };

check('picks the Buy call although the Rent and Buy+Rent warm-ups arrived after it', pickScreenCityCall(calls, screen) === buy);
check('a scope with no captured call is null, never a neighbouring scope', pickScreenCityCall([rent, both], screen) === null);
check('a type picked on screen needs a call carrying that type', pickScreenCityCall([buy, buyApt], { deal: 'بيع', types: ['شقة'] }) === buyApt);
check('a call without the type is not the screen after the type is picked', !callMatchesScreen(buy.body, { deal: 'بيع', types: ['شقة'] }));
check('typed price + area must be carried', pickScreenCityCall([buy, buyPrice], { deal: 'بيع', types: null, priceMax: 900000, areaMin: 120 }) === buyPrice);
check('Rent is matched on its own deal', pickScreenCityCall(calls, { deal: 'إيجار', types: null }) === rent);

// Mutations: the old rule (last call) and a deal-blind matcher must both be caught by the fixture.
const lastCall = (cs: typeof calls) => cs[cs.length - 1];
mustCatch('«the last captured call» (the 11-01 tool)', lastCall(calls) !== buy);
const dealBlind = (cs: typeof calls) => [...cs].reverse().find((c) => !(c.body as any).p_types) ?? null;
mustCatch('a matcher that ignores the deal', dealBlind(calls) !== buy);

// Wiring: the live check must use the picker, not cityCalls[cityCalls.length - 1].
const live = readFileSync(new URL('./verify-trending-live-four-way-truth.ts', import.meta.url), 'utf8');
check('the live Trending check calls pickScreenCityCall', /pickScreenCityCall\(cityCalls,/.test(live));
check('the live Trending check no longer reads the last captured city call', !/cityCalls\[cityCalls\.length - 1\]/.test(live));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-trending-check-reads-the-screen-call: all checks pass');
