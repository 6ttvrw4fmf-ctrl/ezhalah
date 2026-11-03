// PRICE-FIDELITY DETECTORS MUST TELL A SOURCE COINCIDENCE FROM OUR LEAK — 2026-11-03.
// Two detectors cried wolf on rows that are exactly what the source / the rule says:
//   · price_size_contamination:index_price_differs_from_raw compared a price-JUDGED silent-period rent (served ×12,
//     rent_period_judged) with rent_price_annual_ar(), which leaves a period-less figure as published (63 rows);
//   · price_eq_area_or_ppm + rate_stored_as_total read a price the scraper recorded as coming from the source's own
//     TOTAL-price field (price_evidence) as an area/ppm-as-price leak (62 of 67 rows).
// This pins, hermetically, against the committed migration, that each detector distinguishes the cases — and that
// every guard in public.price_read_from_source_total() is load-bearing (each mutant must be caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sql = readFileSync(join(root, 'supabase/migrations/20261103193951_price_fidelity_detectors_read_source_evidence.sql'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); if (!ok) failed++; };

console.log('verify-price-fidelity-detectors-read-source-evidence: the detectors read what the source and the rule say.');

const fnBody = (s: string) => (s.split('create or replace function public.price_read_from_source_total')[1] ?? '').split('$function$;')[0] ?? '';

// Each guard the predicate needs before it may clear a row. Removing any one would let a parser leak through.
const guards: [string, RegExp][] = [
  ['evidence must say found = true', /coalesce\(e->>'found', ''\) = 'true'/],
  ['evidence must be a TOTAL figure', /coalesce\(e->>'kind', ''\) = 'total'/],
  ['evidence must come from a structured / api field, never prose', /coalesce\(e->>'origin', ''\) in \('api', 'structured'\)/],
  ['the recorded figure must equal the price being judged (a stale capture proves nothing)', /\(e->>'stored'\)::numeric = p_price/],
  ['a field named for area / metre is never a total-price field', /!~\* '\(area\|space\|size\|sqm\|meter\|metre\|مساحة\|متر\)'/],
  ['only a listing table can be read', /'\^\[a-z0-9_\]\+_\(residential\|commercial\)_listings\$'/],
];
const body = fnBody(sql);
for (const [name, rx] of guards) {
  check(name, rx.test(body));
  check(`(mutation) dropping «${name}» is caught`, !rx.test(body.replace(rx, 'true')));
}
check('the predicate is costed so the cheap equality predicates run first', /cost 1000/.test(sql.split('$function$')[0] ?? ''));

// The two detectors call it.
const eqArea = /execute replace\(d, c_old,[\s\S]*?and not public\.price_read_from_source_total\(s\.source_table, s\.listing_id, s\.price_total\)/;
check('mon_detect_price_eq_area_or_ppm consults the source-evidence predicate', eqArea.test(sql));
check('(mutation) price_eq_area_or_ppm without the predicate is caught', !eqArea.test(sql.replace(/price_read_from_source_total\(s\.source_table, s\.listing_id, s\.price_total\);/, 'true;')));
const rate = /\|\| E'    and not public\.price_read_from_source_total\(s\.source_table, s\.listing_id, s\.price_total\)\\n'\s*\n\s*\|\| '  group by s\.platform having count\(\*\) > 0'/;
check('rate_stored_as_total consults the source-evidence predicate', rate.test(sql));

// A price-judged silent-period rent is expected at what the judgment writes (×12), every other row as the rule says.
const judged = /case when s\.rent_period_judged and a\.rent_period is null'\s*\n\s*\|\| ' and public\.judge_silent_rent_period_ar\(coalesce\(a\.price_annual, a\.price_total\), s\.type_ar\) = ''شهري'''\s*\n\s*\|\| ' then coalesce\(a\.price_annual, a\.price_total\) \* 12'\s*\n\s*\|\| ' else public\.rent_price_annual_ar\(''aqar'', a\.rent_period, a\.price_annual, a\.property_type\) end\)'/;
check('index_price_differs_from_raw expects a judged silent-period rent at ×12', judged.test(sql));
check('(mutation) back on rent_price_annual_ar alone for judged rows is caught', !judged.test(sql.replace('s.rent_period_judged and a.rent_period is null', 'false and a.rent_period is null')));

// Both patches fail closed when the live body has moved.
check('both live-body patches are anchored and raise when the anchor is missing', /raise exception 'mon_price_size_fidelity_barrier: anchors not found exactly once'/.test(sql) && /raise exception 'mon_detect_price_eq_area_or_ppm: anchor found % times'/.test(sql));

if (failed) { console.log(`\n❌ verify-price-fidelity-detectors-read-source-evidence: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-price-fidelity-detectors-read-source-evidence: both detectors read the source evidence and the rule.');
