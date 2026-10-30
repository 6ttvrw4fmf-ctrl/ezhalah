// `supports()` throws away a found ad whose platform flag forbids its deal, after the count was taken: «2 results», 1 card.
// 2026-10-30: sakani's 1,532 sale ads and wajaf's 4 rent ads were scraped and counted but never shown, because of a stale flag.
// ponytail: pins the two measured cases and the rent-only rule; a flag vs production comparison needs the live half (backlog).
import assert from 'node:assert/strict';
import { supports } from '../src/data/platforms.ts';

assert.equal(supports('سكني', 'Buy'), true, 'sakani serves sale ads');
assert.equal(supports('سكني', 'Rent'), true, 'sakani serves rent ads');
assert.equal(supports('وجف العقارية', 'Rent'), true, 'wajaf serves rent ads');
assert.equal(supports('وجف العقارية', 'Buy'), true, 'wajaf serves sale ads');
assert.equal(supports('Gathern', 'Buy'), false, 'Gathern is rent-only');
assert.equal(supports('Aqar Monthly', 'Buy'), false, 'Aqar Monthly is rent-only');
console.log('✓ served deal sides are not filtered away by platform flags');
