// THE PIN SHOWS THE PRICE, NEVER A COUNT — owner 2026-11-10, final rule («we don't say 2 instead we just put the price …
// lowest price wins … price on request = price listed if there is … make sure no bugs»). Measured that day at حي الملك
// عبدالله, المجمعة: the pin said «7 إعلانات», the pill 8, the sheet «3 فيلا» — three numbers, none of them the price.
//
//   · one price and nothing else at the spot            → «750 ألف»
//   · anything else there (another price, a no-price ad) → «من 750 ألف» (the lowest real price)
//   · no real price                                      → «السعر عند الطلب»
//   · a sale under 10,000 / a yearly rent under 1,000 is a placeholder on the pin, not a price
//   · a rent is per year; a short stay shows «إقامة قصيرة»; buy and rent at one spot are two pins
//
// pinHead() is EXECUTED here on every case, with mutations; the SQL half is read from the committed migration.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinHead, priceHead, pinPrice, joinPins, PIN_PRICE_FLOOR, type PinRow } from '../src/lib/mapPins.ts';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
type R = Pick<PinRow, 'n' | 'deal' | 'price' | 'platform' | 'price_max' | 'unpriced'>;
const r = (o: Partial<R>): R => ({ n: 1, deal: 'buy', price: null, platform: null, price_max: null, unpriced: 0, ...o });
const head = (o: Partial<R>, loc: 'ar' | 'en' = 'ar') => pinHead(r(o), loc);

// 1. The owner's cases.
check('one ad, 750,000 → «750 ألف»', head({ price: 750000 }) === '750 ألف');
check('3 villas × 7 ads, all 750,000 (المجمعة) → «750 ألف», no count', head({ n: 7, price: 750000, price_max: 750000, unpriced: 0 }) === '750 ألف');
check('different prices → the lowest with «من»', head({ n: 3, price: 600000, price_max: 900000, unpriced: 0 }) === 'من 600 ألف');
check('two prices and a no-price ad → «من» the lowest', head({ n: 3, price: 750000, price_max: 900000, unpriced: 1 }) === 'من 750 ألف');
check('one price and a no-price ad → «من 750 ألف»', head({ n: 2, price: 750000, price_max: 750000, unpriced: 1 }) === 'من 750 ألف');
check('no real price at all → «السعر عند الطلب»', head({ n: 4, price: null, price_max: null, unpriced: 4 }) === 'السعر عند الطلب' && head({}) === 'السعر عند الطلب');
check('a rent is per year, with «من» when it varies', head({ deal: 'rent', price: 45000 }) === '45 ألف/سنة' && head({ deal: 'rent', n: 2, price: 45000, price_max: 60000 }) === 'من 45 ألف/سنة');
check('a short stay never shows a price', head({ deal: 'short', n: 3, price: 500, price_max: 900 }) === 'إقامة قصيرة' && head({ platform: 'gathern', price: 500 }) === 'إقامة قصيرة');
check('English reads the same rule', head({ n: 2, price: 750000, price_max: 750000, unpriced: 1 }, 'en') === 'from 750K' && head({}, 'en') === 'Price on request');
check('no exact spot head is ever a count', [head({ n: 7, price: 750000, price_max: 750000 }), head({ n: 5, price: null, unpriced: 5 }), head({ n: 2, deal: 'rent', price: 30000, price_max: 30000 })].every((h) => !/إعلان/.test(h)));

// 2. Placeholders are not prices.
check('a sale of 1 / 100 / 9,999 reads «السعر عند الطلب» on the pin', [1, 100, 9999].every((p) => head({ price: p }) === 'السعر عند الطلب'));
check('a sale of exactly 10,000 is a price', head({ price: 10000 }) === '10 ألف' && PIN_PRICE_FLOOR.buy === 10000);
check('a yearly rent under 1,000 is a placeholder; 1,000 is a price', head({ deal: 'rent', price: 999 }) === 'السعر عند الطلب' && pinPrice(1000, 'rent') === 1000);
check('a price that arrives as text is read as a number', head({ price: '750000' }) === '750 ألف');

// 3. Mutations: each broken rule must be caught by the predicates above.
const oldHead = (o: Partial<R>) => (r(o).n > 1 ? `${r(o).n} إعلانات` : head(o));
mustCatch('the old count head («7 إعلانات»)', oldHead({ n: 7, price: 750000, price_max: 750000 }) !== '750 ألف');
const noFrom = (o: R) => { const m = pinPrice(o.price, o.deal); return priceHead(m, m, 0, o.deal, 'ar'); };
mustCatch('a head that drops «من» when a no-price ad shares the spot', noFrom(r({ n: 2, price: 750000, price_max: 750000, unpriced: 1 })) !== 'من 750 ألف');
const highest = (o: R) => priceHead(pinPrice(o.price_max, o.deal), null, 0, o.deal, 'ar');
mustCatch('a head that shows the highest price instead of the lowest', highest(r({ n: 3, price: 600000, price_max: 900000 })) !== 'من 600 ألف');
const noFloor = (p: number) => priceHead(p, p, 0, 'buy', 'ar');
mustCatch('a head that prints a placeholder «1» as a price', noFloor(1) !== head({ price: 1 }));

// 3b. Two heads joined on a crowded screen keep the rule (CodeRabbit #11777): the lowest real price of both, «من».
const row = (o: Partial<PinRow>): PinRow => ({ lat: 24.7, lng: 46.7, n: 1, deal: 'buy', type_ar: null, platforms: 1, ids: null, price: null, platform: null, ...o });
const j1 = joinPins(row({ price: 900000 }), row({ price: 750000 }));
check('two joined single ads (900k, 750k) → «من 750 ألف»', pinHead(j1, 'ar') === 'من 750 ألف');
const j2 = joinPins(row({ price: 750000 }), row({ price: null }));
check('a priced ad joined with a no-price ad → «من 750 ألف», never «السعر عند الطلب»', pinHead(j2, 'ar') === 'من 750 ألف');
const j3 = joinPins(row({ n: 3, price: 600000, price_max: 600000, unpriced: 0 }), row({ n: 2, price: null, price_max: null, unpriced: 2 }));
check('a priced spot joined with a no-price spot → «من 600 ألف»', pinHead(j3, 'ar') === 'من 600 ألف');
check('two no-price ads joined → «السعر عند الطلب»', pinHead(joinPins(row({}), row({})), 'ar') === 'السعر عند الطلب');
check('a joined head keeps every id of both', joinPins(row({ ids: [{ t: 'a', i: 1 }] }), row({ ids: [{ t: 'b', i: 2 }] })).ids?.length === 2);
const mixedJoin = joinPins(joinPins(row({ deal: 'buy', price: 750000 }), row({ deal: 'rent', price: 5000 })), row({ deal: 'rent', price: 3000 }));
check('a head joining buy and rent carries no price, even when joined again (no rent re-read through the sale floor)', mixedJoin.deal === 'mixed' && mixedJoin.price === null && mixedJoin.price_max === null);
const droppedJoin = { ...j2, price: null, price_max: null, unpriced: 0 };
mustCatch('a joined head that drops its price (the old joinPins)', pinHead(droppedJoin, 'ar') !== 'من 750 ألف');

// 4. The database half (the committed migration production runs).
const dir = join(root, 'supabase/migrations');
const file = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => readFileSync(join(dir, f), 'utf8').includes('price_max numeric, unpriced integer)'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
const floor = "case when k.deal = ''rent'' then 1000 else 10000 end";
check('map_pins_ar returns the spot\'s lowest and highest real price and its no-price count', !!file && sql.includes("min(k.price) filter (where k.price >= ' || floor_ || ')") && sql.includes("max(k.price) filter (where k.price >= ' || floor_ || ')") && sql.includes("count(*) filter (where k.price is null or k.price < ' || floor_ || ')"));
check('…with the same placeholder floor as the pin (10,000 sale / 1,000 rent)', sql.includes(floor));
check('…and a spot with buy and rent is two pins (grouped by deal)', sql.includes("group by k.la, k.lo, k.deal"));

console.log(`\nverify-map-pin-shows-the-price-never-a-count: ${failed ? `${failed} FAILED` : 'every pin shows its price — lowest wins, «من» when there is more, never a count'}`);
process.exit(failed ? 1 : 0);
