// `supports()` throws away a found ad whose platform flag forbids its deal, after the count was taken: «2 results», 1 card.
// 2026-10-30: sakani's 1,532 sale ads and wajaf's 4 rent ads were scraped and counted but never shown, because of a stale flag.
// ponytail: pins the two measured cases and the rent-only rule; a flag vs production comparison needs the live half (backlog 1097).
import assert from 'node:assert/strict';
import { supports } from '../src/data/platforms.ts';

type Deal = 'Rent' | 'Buy';
const EXPECTED: [string, Deal, boolean][] = [
  ['سكني', 'Buy', true],
  ['سكني', 'Rent', true],
  ['وجف العقارية', 'Rent', true],
  ['وجف العقارية', 'Buy', true],
  ['Gathern', 'Buy', false],
  ['Aqar Monthly', 'Buy', false],
];
const wrongFlags = (allowed: (name: string, deal: Deal) => boolean) =>
  EXPECTED.filter(([name, deal, want]) => allowed(name, deal) !== want);

function mustCatch(label: string, caught: boolean) {
  assert.ok(caught, `mutation not caught: ${label}`);
}
mustCatch('sakani back to rent-only', wrongFlags((n, d) => (n === 'سكني' && d === 'Buy' ? false : supports(n, d))).length > 0);
mustCatch('wajaf back to sale-only', wrongFlags((n, d) => (n === 'وجف العقارية' && d === 'Rent' ? false : supports(n, d))).length > 0);
mustCatch('Gathern leaking into Buy', wrongFlags((n, d) => (n === 'Gathern' ? true : supports(n, d))).length > 0);

assert.deepEqual(wrongFlags(supports), [], 'a platform flag hides a deal side it serves, or lets a rent-only site into Buy');
console.log('✓ served deal sides are not filtered away by platform flags');
