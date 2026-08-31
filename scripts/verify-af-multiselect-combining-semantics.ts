// HOW A MULTI-SELECT ADVANCED FILTER ANSWER COMBINES — R7.2 of docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md.
//
// WHY THIS EXISTS
// ---------------
// R7.2 ("multi-select marginal vs combined") was the ONE rule family in the contract's §15 audit
// table with no directly-corresponding barrier — the 2026-08-27 run flagged it as the next run's
// work after establishing live that production has TWO combining shapes and both are correct:
//
//   • AMENITY chips INTERSECT (AND). Each ticked chip is its own boolean column, so
//     kitchen+parking returns the AND-set. The routine spec's standing rule says this in as many
//     words: "multi-amenity must be AND, not OR", and Part 6 item 12 asks for a barrier on the OR
//     regression specifically.
//   • VALUE-DOMAIN chips UNION (OR). direction شمال+جنوب is one column with disjoint values, so the
//     combined count is the sum of the marginals. Same for unit_subtypes, bath_exact, types.
//
// Nothing pinned either shape. A "simplification" that collapsed the amenity chain into one
// `or (...)` would silently turn every multi-amenity answer into a union — the user asks for a flat
// with a kitchen AND parking and is shown flats with either — and every count surface would agree
// with itself, because they are all generated from the same clause.
//
// THE DRIFT THIS ALSO CAUGHT (real, fixed in the same change)
// -----------------------------------------------------------
// scripts/lib/afOracleFilter.ts — the INDEPENDENT oracle that verify-af-live-truth.ts runs against
// production daily — listed COLUMN names as if they were request tokens. So the clause's «'ac' →
// s.air_conditioner» and «'furnished' → s.furnished» were unknown to it, and the two chips resolved
// to `unhandled`:
//
//     buildOracleQS({p_amenities:['ac']})  ->  qs: production_ready=is.true   unhandled: [p_amenities:ac]
//
// «تكييف» is the single biggest amenity chip in production (2,831 of the 11,153 Riyadh /
// Rent-Annual / شقة cohort). It fails CLOSED — verify-af-live-truth.ts line 341 turns that into a
// loud FAIL rather than a silent skip, which is why no wrong number ever shipped — but the oracle
// could not certify those journeys at all, and the journey corpus simply never ticked them. The
// drift ran the other way too: the set carried nine tokens the clause REJECTS fail-closed (balcony,
// laundry_room, pool, gym, garden, separate_*_meter, optical_fibers), for which the oracle would
// have filtered a real column while the RPC returned zero rows.
//
// So this barrier does not just assert the shapes — it derives the clause's OWN vocabulary from
// sql/mirrors/af_eligibility_clause.sql (added in the same change; verify-sql-mirrors-not-stale.ts
// keeps it byte-exact with production) and fails if the UI, the clause and the oracle disagree in
// EITHER direction.
//
// Offline and hermetic on purpose: no DB, no network, so it can sit in `npm test` on every PR.
//
//   node --experimental-strip-types scripts/verify-af-multiselect-combining-semantics.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOracleQS } from './lib/afOracleFilter.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-af-multiselect-combining-semantics: R7.2 — amenity chips AND, value domains OR,');
console.log('  and one shared amenity vocabulary across the clause, the UI and the independent oracle.');

// ── The canonical predicate, from the mirror ─────────────────────────────────────────────────────
const clause = read('sql/mirrors/af_eligibility_clause.sql');
check('the af_eligibility_clause mirror exists and carries the amenities predicate',
  clause.includes('p_amenities is null or ('));

// The clause is stored as a doubled-quote SQL string literal ('' for a single quote). Read tokens
// out of the fail-closed vocabulary guard: `where tok not in (''elevator'',''parking'',...)`.
const vocabMatch = clause.match(/where tok not in \(([^)]*)\)/);
check('the clause carries the fail-closed amenity vocabulary guard', !!vocabMatch);
const clauseTokens = vocabMatch
  ? [...vocabMatch[1].matchAll(/''([a-z_]+)''/g)].map((m) => m[1])
  : [];
check('the vocabulary guard lists a plausible token set', clauseTokens.length >= 12,
  `${clauseTokens.length} tokens: ${clauseTokens.join(',')}`);

// ── R7.2.2 (a) — AMENITIES COMBINE WITH AND ──────────────────────────────────────────────────────
// Every token must have its own conjunctive guard: `and (not (''tok'' = any(p_amenities)) or s.col)`.
// Chained with `and`, N ticked chips intersect. This is the shape Part 6 item 12 guards.
const guardRe = /and \(not \(''([a-z_]+)''\s*=\s*any\(p_amenities\)(?:\s*or\s*''([a-z_]+)''\s*=\s*any\(p_amenities\))?\)\s*or\s*s\.([a-z_]+)\)/g;
const guards = new Map<string, string>();     // token -> column
for (const m of clause.matchAll(guardRe)) {
  guards.set(m[1], m[3]);
  if (m[2]) guards.set(m[2], m[3]);           // the rnpl / rent_now_pay_later alias pair
}
check('every vocabulary token has a per-column conjunctive guard (multi-amenity = AND)',
  clauseTokens.every((t) => guards.has(t)),
  `missing: ${clauseTokens.filter((t) => !guards.has(t)).join(',') || 'none'}`);
check('the amenity guards are joined by AND, never collapsed into a single or-list',
  !/or \(not \(''[a-z_]+'' = any\(p_amenities\)\)/.test(clause));
// The literal regression shape: a disjunction of the amenity COLUMNS.
check('FORBIDDEN: a disjunctive amenity predicate (s.kitchen or s.parking …)',
  !/s\.(kitchen|parking|elevator|air_conditioner)\s+or\s+s\.(kitchen|parking|elevator|air_conditioner)/.test(clause));

// ── R7.2.2 (b) — VALUE DOMAINS COMBINE WITH OR ───────────────────────────────────────────────────
// One column, disjoint values: a membership test, so several ticked values union.
const UNION_PARAMS: { param: string; marker: RegExp; why: string }[] = [
  { param: 'p_directions', marker: /p_directions is null or norm_direction_ar\(s\.direction_ar\) in \(select norm_direction_ar\(d\) from unnest\(p_directions\) d\)/,
    why: 'several compass answers must union, canonicalised on BOTH sides' },
  { param: 'p_unit_subtypes', marker: /p_unit_subtypes is null or cardinality\(p_unit_subtypes\) = 0 or s\.unit_subtype_ar = any\(p_unit_subtypes\)/,
    why: 'studio + serviced must union' },
  { param: 'p_bath_exact', marker: /cardinality\(p_bath_exact\),0\) > 0 and s\.bathrooms = any\(p_bath_exact\)/,
    why: 'exact bathroom counts union' },
  { param: 'p_types', marker: /p_types is null or s\.type_ar = any\(p_types\)/,
    why: 'R1.3.1 — Apartment + Villa is a row-level union, never an intersection' },
];
for (const u of UNION_PARAMS) {
  check(`${u.param} is a membership test (multi-value = OR) — ${u.why}`, u.marker.test(clause));
}

// ── ONE VOCABULARY: clause == UI == oracle ───────────────────────────────────────────────────────
// The UI half: every amenity key src/data/advancedFilters.ts can put into q.amenities.
const af = read('src/data/advancedFilters.ts');
const amenitiesBlock = af.slice(af.indexOf('const AMENITIES_QUESTION'), af.indexOf('const BATHROOMS_QUESTION'));
const uiTokens = [...amenitiesBlock.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
check('the UI amenity question offers a plausible number of chips', uiTokens.length >= 10,
  `${uiTokens.length}: ${uiTokens.join(',')}`);
check('every chip the UI can send is in the clause vocabulary (else the clause fails CLOSED and the user sees zero results)',
  uiTokens.every((t) => clauseTokens.includes(t)),
  `not accepted by the clause: ${uiTokens.filter((t) => !clauseTokens.includes(t)).join(',') || 'none'}`);

// The oracle half, exercised through its real entry point rather than by reading its source: for
// each clause token, buildOracleQS must emit a filter on the SAME column the clause guards with,
// and must report nothing unhandled. This is what was broken for 'ac' and 'furnished'.
for (const tok of clauseTokens) {
  const { qs, unhandled } = buildOracleQS({ p_amenities: [tok] });
  const col = guards.get(tok)!;
  check(`the independent oracle understands '${tok}' and filters s.${col}`,
    unhandled.length === 0 && qs.includes(`${col}=is.true`),
    unhandled.length ? `unhandled: ${unhandled.join(',')}` : `qs: ${qs}`);
}
// …and the reverse direction: a token the clause REJECTS must not be silently filtered by the
// oracle, or the oracle disagrees with a fail-closed RPC and reports a phantom mismatch.
// pool/gym/garden/balcony moved OUT of this list 2026-08-31 — they are now genuinely certified
// (see AMENITY_TOKEN_COL's own history comment) and are exercised in the clauseTokens loop above
// instead. Replaced with other still-uncertified concepts so this direction keeps real coverage.
for (const bogus of ['view', 'security', 'storage_room', 'not_a_real_amenity']) {
  const { unhandled } = buildOracleQS({ p_amenities: [bogus] });
  check(`the oracle refuses '${bogus}' (not in the clause vocabulary) instead of inventing a filter`,
    unhandled.some((u) => u.includes(bogus)));
}

// ── R7.2.2 behaviour, on the oracle: AND for amenities, OR for a value domain ────────────────────
const multiAmenity = buildOracleQS({ p_amenities: ['kitchen', 'parking', 'ac'] });
check('three amenity chips produce three separate conjunctive filters (AND), not one or-list',
  multiAmenity.unhandled.length === 0
  && multiAmenity.qs.includes('kitchen=is.true')
  && multiAmenity.qs.includes('parking=is.true')
  && multiAmenity.qs.includes('air_conditioner=is.true')
  && !multiAmenity.qs.includes('or='),
  multiAmenity.qs);
const multiDir = buildOracleQS({ p_directions: ['شمال', 'جنوب'] });
check('two direction chips produce ONE membership filter (OR/union), not two conjunctive ones',
  (multiDir.qs.match(/direction_ar=in\./g) ?? []).length === 1,
  multiDir.qs);

// ── R7.2.1 — each chip's count is MARGINAL; the footer is COMBINED ───────────────────────────────
// Every chip reads its own cnt_* column from one guided-counts row (the marginal), while the
// footer/Continue count is cnt_selected recomputed for the tentative selection (the combined).
check('R7.2.1: each amenity chip reads its OWN cnt_* column (a marginal count)',
  /count: \(c\) => c\.cnt_kitchen/.test(af) && /count: \(c\) => c\.cnt_parking/.test(af));
const remote = read('src/data/remote.ts');
check('R7.2.1: the footer/Continue count is cnt_selected recomputed for the tentative selection (the COMBINED count)',
  /fetchGuidedLiveCount[\s\S]{0,600}amenities: amenities\.length \? amenities : null[\s\S]{0,400}counts\.cnt_selected/.test(remote));

console.log(failures === 0
  ? '\n✅ verify-af-multiselect-combining-semantics: all checks passed.'
  : `\n❌ verify-af-multiselect-combining-semantics: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
