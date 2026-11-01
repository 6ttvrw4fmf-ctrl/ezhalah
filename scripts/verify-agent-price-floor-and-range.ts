// «MORE THAN 3 MILLION» IS A FLOOR, A «FROM … TO …» KEEPS BOTH ENDS (owner 2026-10-11; found by the live agent battery).
//
// The edge's single price slot is applied as a CEILING: «فيلا أكثر من ٣ مليون», «أرض فوق ٢ مليون», «villa over 2 million» and «لا تقل عن
// مليون» searched villas UNDER that price — the exact opposite — and «من ١ الى ٣ مليون» lost its lower bound. parsePriceBounds reads the
// user's own words; queryFromBackend turns a floor / range into real priceMin / priceMax. EXECUTED here, then the wiring is pinned.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePriceBounds as p } from '../src/lib/priceBounds.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA floor is a floor and a range keeps both ends\n');

const T: Array<[string, number | null, { min?: number; max?: number }]> = [
  ['فيلا اكثر من ٣ مليون في جدة', 3e6, { min: 3e6 }], ['ارض فوق ٢ مليون في الرياض', 2e6, { min: 2e6 }], ['villa in Jeddah over 2 million', 2e6, { min: 2e6 }], ['فيلا في الدمام لا تقل عن مليون', 1e6, { min: 1e6 }],
  ['شقة للإيجار في الرياض اكثر من ٨٠ ألف بالسنة', 80000, { min: 80000 }], ['فيلا ٣ مليون فاكثر', 3e6, { min: 3e6 }], ['شقة ٨٠ ألف وفوق', 80000, { min: 80000 }], ['at least 2 million', 2e6, { min: 2e6 }],
  ['فيلا من ١ الى ٣ مليون في الدمام', 3e6, { min: 1e6, max: 3e6 }], ['بين ٢ و ٤ مليون', 4e6, { min: 2e6, max: 4e6 }], ['شقة من ٣٠ الى ٥٠ ألف بالسنة', 50000, { min: 30000, max: 50000 }],
  ['from 1 to 3 million', 3e6, { min: 1e6, max: 3e6 }], ['between 2 and 4 million', 4e6, { min: 2e6, max: 4e6 }], ['من ٥٠٠ الى ٣ مليون', 3e6, { min: 5e5, max: 3e6 }], ['من ٥٠٠ ألف الى ٣ مليون', 3e6, { min: 5e5, max: 3e6 }], ['٣٠-٥٠ ألف', 50000, { min: 30000, max: 50000 }],
  ['فيلا تحت ٣ مليون', 3e6, { max: 3e6 }], ['فيلا اقل من ٢ مليون', 2e6, { max: 2e6 }], ['villa up to 3 million', 3e6, { max: 3e6 }], ['ما تزيد عن ٣ مليون', 3e6, { max: 3e6 }], ['لا تتجاوز ٥ مليون', 5e6, { max: 5e6 }], ['not more than 3 million', 3e6, { max: 3e6 }],
  ['فيلا ٣ مليون', 3e6, {}], ['ميزانيتي ٣ مليون', 3e6, {}], ['', null, {}],
  // a size is not money, a per-metre price is not a range, a foreign currency keeps the edge's conversion
  ['فيلا فوق ٥٠٠ متر', null, {}], ['شقة اكثر من ١٥٠ م²', null, {}], ['ارض ١٠٠٠ متر سعر المتر ٢٠٠٠ فوق', null, {}], ['villa 500 sqm over', null, {}],
  ['فيلا فوق ٥ مليون دينار', 61e6, { min: 61e6 }], ['من ١ الى ٣ مليون دولار', 11.25e6, {}],
  // an AREA range is not a price range (owner 2026-10-13: «من 1000 الى 1500 متر» became a land «سعر المتر»)
  ['ارض من 1000 الى 1500 متر', null, {}], ['ارض بين ١٠٠٠ و ١٥٠٠ متر في الرياض', null, {}], ['أبي أرض في الرياض مساحتها تكون بين 1000 متر إلى 1500', null, {}],
];
const wrong = T.filter(([t, e, w]) => JSON.stringify(p(t, e)) !== JSON.stringify(w));
check(`${T.length} real phrasings: floors, ranges, ceilings, sizes, per-metre prices and currencies are all read the right way round`, wrong.length === 0, wrong.map(([t]) => `${t} → ${JSON.stringify(p(t))}`).join(' | '));
{ // the real priceBounds.ts with the area-range guard removed must read «من 1000 الى 1500 متر» as a price range again
  const GUARD = "  if (range && SIZE_AFTER.test(s.slice((range.index ?? 0) + range[0].length))) return {};\n";
  const src = readFileSync(join(ROOT, 'src/lib/priceBounds.ts'), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-pb-'));
  writeFileSync(join(dir, 'pb.mts'), src.replace(GUARD, ''));
  const mutant = (await import(join(dir, 'pb.mts'))).parsePriceBounds as typeof p;
  mustCatch('an area range read as a price range again (the guard removed from the real file)',
    src.includes(GUARD) && JSON.stringify(mutant('ارض من 1000 الى 1500 متر', null)) !== '{}' && JSON.stringify(p('ارض من 1000 الى 1500 متر', null)) === '{}');
}
check('«فوق / أكثر من / over» is NEVER a ceiling and «تحت / أقل من / under» is NEVER a floor',
  !!p('فيلا اكثر من ٣ مليون', 3e6).min && p('فيلا اكثر من ٣ مليون', 3e6).max == null && !!p('فيلا تحت ٣ مليون', 3e6).max && p('فيلا تحت ٣ مليون', 3e6).min == null);

const agent = readFileSync(join(ROOT, 'src/data/agent.ts'), 'utf8');
const wire = windowBetween(agent, '// «MORE THAN 3 MILLION» IS A FLOOR', "  if (typeof b.sort === 'string'", 'agent.ts');
const wired = (src: string) => /parsePriceBounds\(_tx, edgeSar\)/.test(src) && /q\.priceMin = String\(Math\.round\(pb\.min\)\);/.test(src) && /q\.priceInput = '';/.test(src)
  && /!q\.bothDeals && !q\.dealCombined && q\.rentPeriod !== 'monthly'/.test(src) && /pb\.min == null/.test(src);
check('queryFromBackend turns a floor / range into priceMin / priceMax and drops the single ceiling', wired(wire));
mustCatch('the floor being ignored (it would search UNDER 3 million again)', !wired(wire.replace('q.priceMin = String(Math.round(pb.min));', '')));
mustCatch('the ceiling staying in place next to the floor', !wired(wire.replace("q.priceInput = '';", '')));
check('a monthly rent and a «rent or buy» search are left to the edge (their numbers mean different things)', /q\.rentPeriod !== 'monthly'/.test(wire) && /!q\.bothDeals/.test(wire));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a floor is a floor and a range keeps both ends');
