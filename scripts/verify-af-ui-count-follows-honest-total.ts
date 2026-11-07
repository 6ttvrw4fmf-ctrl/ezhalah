// THE LIVE AF CHECK COMPARES THE SCREEN WITH THE HONEST TOTAL, NOT THE RAW INDEX TOTAL (🔬 2026-11-07, alert 11763).
//
// Since 🔧 backlog 1153 (2026-11-01) the results sentence shows honestTotal(total_count, page candidates, cards the raw
// hydration returned) — a row hidden at source since the last :22 sync is counted by the index but has no card, and the
// owner's rule is that the number never exceeds the reachable cards. verify-af-live-truth.ts kept comparing the screen
// with the RAW total_count and went red on correct screens: run 42352580488 (2026-11-07) ui=6705 rpc=6706,
// ui=18701 rpc=18703, ui=17400 rpc=17402 — always below, never above, which is exactly honestTotal's shape.
//
// This barrier EXECUTES scripts/lib/afShownTotal.ts on a synthetic page shaped like that run, carries the OLD rule as a
// mutation that must fail where the new one passes, proves the new rule still catches a screen that is wrong in either
// direction, and pins that the live check really calls the helper (by its code, not a comment).
import { readFileSync } from 'node:fs';
import { expectedShownTotal, hydrationKeys } from './lib/afShownTotal.ts';
import { honestTotal } from '../src/lib/honestTotal.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, caught ? '' : 'MUTANT SURVIVED — the check is blind to the defect it exists for');

console.log('\nThe live AF check reads the number the app is required to show\n');

// A page of 24 candidates, total 6,706; one row (aqar 999) was hidden at source after the last sync.
const page = Array.from({ length: 24 }, (_, i) => ({ source_table: i % 2 ? 'aqar_residential_listings' : 'dealapp_residential_listings',
  listing_id: 1000 + i, total_count: 6706 }));
page[5] = { source_table: 'aqar_residential_listings', listing_id: 999, total_count: 6706 };
const hydratedUrlA = 'https://ezhalah.com/sb/rest/v1/aqar_residential_listings?select=id%2Ctitle&active=eq.true&id=in.%281001%2C1003%29&limit=50';
const hydratedUrlD = 'https://ezhalah.com/sb/rest/v1/dealapp_residential_listings?select=*&id=in.(1000,1002)';
const hydrated = new Set<string>();
for (const r of page) if (r.listing_id !== 999) hydrated.add(`${r.source_table}:${r.listing_id}`);

// ── 1. the measured false red ────────────────────────────────────────────────
{
  const w = expectedShownTotal(page, hydrated);
  check('one unloadable card → the screen must read 6,705, not 6,706', w.shown === 6705 && w.dropped === 1, JSON.stringify(w));
  check('…and that is the app\'s own honestTotal()', w.shown === honestTotal(6706, 24, 23));
  const ui = 6705;
  check('the measured screen (6,705) passes', ui === w.shown);
  mustCatch('the OLD rule — compare the screen with the raw total_count — which is why run 42352580488 was red', ui !== w.total);
}

// ── 2. a wrong screen is still caught, both directions ───────────────────────
{
  const w = expectedShownTotal(page, hydrated);
  mustCatch('a screen that shows the raw total although a card is missing (6,706 over 23 reachable cards)', 6706 !== w.shown);
  mustCatch('a screen that undercounts (6,704)', 6704 !== w.shown);
  const all = new Set(hydrated); all.add('aqar_residential_listings:999');
  mustCatch('a screen that subtracts a card the page DID load', expectedShownTotal(page, all).shown !== 6705);
  check('every card loaded → the screen must equal total_count exactly', expectedShownTotal(page, all).shown === 6706);
  mustCatch('a hydration of another page\'s rows counted as this page\'s',
    expectedShownTotal(page, new Set([...hydrated, 'aqar_residential_listings:424242'])).shown === 6705);
}

// ── 3. the hydration reads are recognised exactly ────────────────────────────
{
  check('a by-id raw read yields its table:id keys', JSON.stringify(hydrationKeys(hydratedUrlD, [{ id: 1000 }, { id: '1002' }]))
    === JSON.stringify(['dealapp_residential_listings:1000', 'dealapp_residential_listings:1002']));
  check('…also URL-encoded', hydrationKeys(hydratedUrlA, [{ id: 1001 }]).length === 1);
  mustCatch('a non-hydration REST read (no id=in.) counted as loaded cards',
    hydrationKeys('https://ezhalah.com/sb/rest/v1/aqar_residential_listings?select=id&limit=5', [{ id: 1001 }]).length === 0);
  mustCatch('an RPC response counted as loaded cards', hydrationKeys('https://ezhalah.com/sb/rest/v1/rpc/location_search_candidates_ar', [{ id: 1 }]).length === 0);
  mustCatch('an error body counted as loaded cards', hydrationKeys(hydratedUrlD, { code: '57014' }).length === 0);
}

// ── 4. the live check really uses it (code, not a comment) ───────────────────
{
  const src = readFileSync(new URL('./verify-af-live-truth.ts', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('verify-af-live-truth.ts imports the helper', /import \{[^}]*expectedShownTotal[^}]*\} from '\.\/lib\/afShownTotal\.ts'/.test(src));
  check('…feeds it every by-id hydration response', /hydrationKeys\(u, await resp\.json\(\)\)/.test(src));
  check('…and asserts the screen against want.shown', /uiCount === want\.shown/.test(src));
  mustCatch('the raw comparison coming back', !/uiCount === rpcTotal/.test(src));
}

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ the live AF check compares the screen with honestTotal(), and still catches a wrong screen');
