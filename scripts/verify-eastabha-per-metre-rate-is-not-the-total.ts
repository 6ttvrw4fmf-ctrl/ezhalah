// A PER-METRE RATE IS NOT THE TOTAL — AND A TOTAL'S FLOOR HAS NO BUSINESS JUDGING A RATE.
//
// THE DEFECT (source-proven live 2026-09-06, Data Integrity run). eastabha.sa (WP Residence)
// publishes land and property prices in two shapes inside one `data-price` attribute:
//
//   A) a qualifier carrying its OWN rate beside the total —
//      «<span class='infocur infocur_first'>سعر المتر 300ريال </span>ر.س2,280,000»
//      → rate 300, total 2,280,000.
//   B) a qualifier with no number of its own, so the displayed figure IS the rate —
//      «<span class='infocur infocur_first'>للمتر</span>ر.س625» → rate 625, NO published total.
//
// The shape-A branch read the qualifier with `_price_from_text`, whose ≥1000 floor exists to catch
// a dropped «ألف» on a TOTAL price. A per-metre rate has no such floor: 300 ر.س/م² is an ordinary
// land rate. So the 300 was discarded as noise, shape A fell through to shape B, and EA22962 — a
// 760 m² property the source advertises at ر.س2,280,000 with سعر المتر 300ريال — was parsed as
// price_per_meter = 2,280,000 (a rate 7,600× the published one) AND price_is_rate = true, which
// tells map_listing there is no total to store. One published figure invented, one retracted, from
// a floor borrowed from the other caller.
//
// Fetched and reproduced against production the day this was written:
//   https://eastabha.sa/estate_property/2-bedrooms-modern-flat-in-greenville/  (HTTP 200, 315,057 B)
//   «السعر: سعر المتر 300ريال ر.س2,280,000 مساحة للعقار الكلية: 760 متر 2»
//   https://eastabha.sa/estate_property/0621/                                   (HTTP 200, 291,804 B)
//   «السعر: للمتر ر.س625 مساحة العقار: 800 متر 2»
//
// THE FIX splits the parser in two — `_price_from_text` (floor 1000, totals) and `_rate_from_text`
// (floor 1, per-metre rates) — over one shared implementation, so the total's protection is
// untouched. THIS BARRIER EXECUTES THE REAL `parse_detail` against the two `data-price` values
// verbatim as the source serves them, and mutation-proves both halves: putting the total's floor
// back on the rate must fail, and so must removing the floor from totals.
//
// Run: node --experimental-strip-types scripts/verify-eastabha-per-metre-rate-is-not-the-total.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MOD = 'scrapers.eastabha.run';
const SRC = join(ROOT, 'scrapers/eastabha/run.py');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, wouldFail: boolean, detail = '') =>
  check(`MUTATION: catches ${what}`, wouldFail, detail);

// Verbatim from the two live pages: the url-encoded data-price the source serves, and the
// data-clean_price beside it. Nothing here is paraphrased.
const SHAPE_A = '%3Cspan%20class%3D%27infocur%20infocur_first%27%3E%D8%B3%D8%B9%D8%B1%20%D8%A7%D9%84'
  + '%D9%85%D8%AA%D8%B1%20300%D8%B1%D9%8A%D8%A7%D9%84%20%3C%2Fspan%3E%D8%B1.%D8%B32%2C280%2C000'
  + '%3Cspan%20class%3D%27infocur%27%3E%3C%2Fspan%3E';
const SHAPE_B = '%3Cspan%20class%3D%27infocur%20infocur_first%27%3E%D9%84%D9%84%D9%85%D8%AA%D8%B1'
  + '%3C%2Fspan%3E%D8%B1.%D8%B3625%3Cspan%20class%3D%27infocur%27%3E%3C%2Fspan%3E';

const page = (dataPrice: string, clean: string) =>
  `<div class="listing_wrapper" data-price="${dataPrice}" data-clean_price="${clean}"></div>`;

const A = page(SHAPE_A, '2280000');
const B = page(SHAPE_B, '625');

type Detail = { price?: number | null; price_per_meter?: number | null; price_is_rate?: boolean | null };
const parse = (html: string, mutated?: string): Detail =>
  pyCall(ROOT, MOD, 'parse_detail', [[html]], mutated)[0] as Detail;

// ── 1. THE REAL PARSER, THE REAL BYTES ────────────────────────────────────────────────────────
const a = parse(A);
check('shape A keeps the source total 2,280,000 as the price', a.price === 2280000, `got ${a.price}`);
check('shape A reads the qualifier rate 300 (not the total) as price_per_meter',
  a.price_per_meter === 300, `got ${a.price_per_meter}`);
check('shape A does NOT mark the row price_is_rate (a total IS published)',
  !a.price_is_rate, `got ${a.price_is_rate}`);

const b = parse(B);
check('shape B keeps the displayed 625 as the rate', b.price_per_meter === 625, `got ${b.price_per_meter}`);
check('shape B marks price_is_rate, so no total is manufactured from rate × area',
  b.price_is_rate === true, `got ${b.price_is_rate}`);

// ── 2. MUTATION: put the total's floor back on the rate ───────────────────────────────────────
// This is the defect exactly as it stood in production this morning. If the barrier survives it,
// the barrier is decorative.
const src = readFileSync(SRC, 'utf8');
const RATE_CALL = 'qual_rate = _rate_from_text(qual)';
check('the shape-A branch reads the qualifier through the RATE parser', src.includes(RATE_CALL));

const reverted = src.replace(RATE_CALL, 'qual_rate = _price_from_text(qual)');
check('mutation is a real edit', reverted !== src);
const am = parse(A, reverted);
mustCatch('the total-price floor being put back on the rate — 2,280,000 becomes the per-metre rate',
  am.price_per_meter === 2280000 && am.price_is_rate === true,
  `mutant produced ppm=${am.price_per_meter} is_rate=${am.price_is_rate}`);

// ── 3. NARROWNESS: the floor a TOTAL depends on must not have moved ───────────────────────────
// The ≥1000 floor was earned by a real bug (land prices stored as 400/100 when «ألف» was dropped).
// Relaxing it for rates must not relax it for totals, so both are asserted here, and a mutation
// that removes it from totals must fail too.
const totals = pyCall(ROOT, MOD, '_price_from_text', [['400 ريال'], ['100'], ['400 ألف ريال'], ['1.2 مليون']]);
check('a bare sub-1000 TOTAL is still discarded as parse noise',
  totals[0] === null && totals[1] === null, JSON.stringify(totals.slice(0, 2)));
check('magnitude words still apply to totals (400 ألف → 400,000; 1.2 مليون → 1,200,000)',
  totals[2] === 400000 && totals[3] === 1200000, JSON.stringify(totals.slice(2)));

const rates = pyCall(ROOT, MOD, '_rate_from_text', [['سعر المتر 300ريال'], ['3 آلاف للمتر'], ['']]);
check('a sub-1000 RATE survives (300 ر.س/م² is an ordinary land rate)', rates[0] === 300, `got ${rates[0]}`);
check('magnitude words still apply to rates (3 آلاف → 3,000)', rates[1] === 3000, `got ${rates[1]}`);
check('an empty qualifier is still nothing, not zero', rates[2] === null, `got ${rates[2]}`);

const floorless = src.replace('return _amount_from_text(s, floor=1000)', 'return _amount_from_text(s, floor=1)');
check('floor mutation is a real edit', floorless !== src);
const loosened = pyCall(ROOT, MOD, '_price_from_text', [['400 ريال']], floorless);
mustCatch('the floor being dropped from TOTALS — «400 ريال» comes through as a price',
  loosened[0] === 400, `mutant produced ${loosened[0]}`);

// ── 4. WIRING ─────────────────────────────────────────────────────────────────────────────────
check('npm test runs this barrier', npmTestRuns(ROOT, 'verify-eastabha-per-metre-rate-is-not-the-total'));

console.log(failed === 0
  ? '\n✅ verify-eastabha-per-metre-rate-is-not-the-total: a rate is read as a rate, a total keeps its floor.'
  : `\n❌ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
