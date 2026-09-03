// «مطابق لطلبك» — EVERY active Advanced-Filter predicate has a truthful, card-visible representation
// wherever the listing's canonical row supports it, and NOTHING on that path can turn UNKNOWN into
// No / 0 / false / a guess (owner rule 2026-09-02).
//
// WHAT THIS EXECUTES (never a copy, never a regex over prose):
//   • the REAL question registry — every question's apply() and resolveOptions() LIFTED out of
//     src/data/advancedFilters.ts (it imports ./remote, so Node cannot import it whole), the cohort
//     table COHORT_QUESTIONS imported from src/lib/afCohorts.ts, the option keys read from the
//     questions themselves (counts shimmed — counts decide what is worth SHOWING, never which keys
//     exist);
//   • the REAL evidence module src/lib/afEvidence.ts (pure, imported outright);
//   • the REAL carry (withoutFacet / reconcileCommittedAf from src/lib/afCarry.ts);
//   • the REAL Arabic table + interpolator lifted from src/i18n.tsx, so every expected chip text
//     below is what production would print.
//
// T1 completeness — the certified pool (union of every COHORT_QUESTIONS leg) ⊆ AF_EVIDENCE, no
//    extra def, AF_PREDICATE_FIELDS partitioned by the defs (amenities shared by rnpl+amenities is
//    the ONE declared exception), registry order = ADVANCED_QUESTIONS order.
// T2 truth — per question × option, from the question's OWN apply(): active() round-trips the key;
//    a satisfying row → the expected chip text with the ROW value (bathMin 3 + row 4 → «4 حمامات»);
//    a non-satisfying row → nothing; a NULL row → nothing, via a recording Proxy that also proves the
//    def touches ONLY its declared columns (a hidden `?? 0` or an undeclared read is RED).
// T3 stale / hidden — a cleared facet leaves afActive; a fully loaded query activates EVERY def;
//    no certified question can be active without a def.
// T4 injection — comment-stripped, COUNTED shapes: agent.tsx derives activeAf from m.result.query
//    exactly once and passes it exactly once; the memo comparator includes it; ResultCard renders
//    the strip only from afEvidence(activeAf, listing.canon) — never from listing.features.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { stripComments } from './lib/stripComments.ts';
import { AF_PREDICATE_FIELDS, emptyQuery } from '../src/lib/searchDefaults.ts';
import { COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';
import { withoutFacet } from '../src/lib/afCarry.ts';
import { CLEAN_MACRO, groupsOf } from '../src/data/propertyTypes.ts';
import {
  AF_EVIDENCE, AMENITY_COL, AMENITY_LABEL, afActive, afEvidence, normDirectionAr,
  type ActiveAf, type AfCanon, type T,
} from '../src/lib/afEvidence.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

let failed = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ❌ FAIL  ${msg}`); failed++; }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── the real code, lifted ────────────────────────────────────────────────────────────────────────
const QUESTION_CONSTS = [
  'RNPL_QUESTION', 'AGE_QUESTION', 'AMENITIES_QUESTION', 'BATHROOMS_QUESTION', 'FURNISHED_QUESTION',
  'STREET_WIDTH_QUESTION', 'DIRECTION_QUESTION', 'RATING_QUESTION', 'UNIT_SUBTYPE_QUESTION',
];
type Opt = { key: string; labelKey: string };
type Question = {
  id: string;
  apply: (q: SearchQuery, keys: string[]) => SearchQuery;
  resolveOptions: (q: SearchQuery) => Promise<{ options: Opt[] }>;
};
const lifted = await liftSymbols(
  join(ROOT, 'src/data/advancedFilters.ts'),
  [
    { header: 'function addAmenities' },
    { header: 'const AGE_BUCKETS', endsWith: /^\];$/ },
    { header: 'const DIRECTION_DEFS', endsWith: /^\];$/ },
    ...QUESTION_CONSTS.map((header) => ({ header: `const ${header}` })),
    { header: 'export const ADVANCED_QUESTIONS', endsWith: /^\];$/ },
  ],
  ['addAmenities', 'AGE_BUCKETS', 'DIRECTION_DEFS', ...QUESTION_CONSTS, 'ADVANCED_QUESTIONS'],
  // Cohort logic is imported REAL; only the count path is shimmed. The shim hands each def's key AND
  // labelKey through so T2 can assert the evidence speaks with the chip's own voice (owner
  // decision 6) — without ever hand-listing a label here.
  [
    `import { cohortAllows, scopeCleanTypes, intersectChips } from ${JSON.stringify(pathToFileURL(join(ROOT, 'src/lib/afCohorts.ts')).href)};`,
    'type GuidedCounts = Record<string, number>;',
    'const fetchApartmentGuidedCounts = async (_q: unknown) => ({} as GuidedCounts);',
    'const guidedOptions = (_c: unknown, defs: Array<{ key: string; labelKey: string }>) => ({ options: defs.map((d) => ({ key: d.key, labelKey: d.labelKey })) });',
  ].join('\n'),
);
const ADVANCED = lifted.ADVANCED_QUESTIONS as Question[];
const AGE_BUCKETS = lifted.AGE_BUCKETS as Opt[];
const { applyScopeAnswer, SCOPE_GROUP_ID, SCOPE_TYPE_ID } = await import('../src/lib/afPlan.ts');
const ALL = [
  ...ADVANCED,
  { id: SCOPE_GROUP_ID, apply: (q: SearchQuery, keys: string[]) => applyScopeAnswer(SCOPE_GROUP_ID, q, keys) },
  { id: SCOPE_TYPE_ID, apply: (q: SearchQuery, keys: string[]) => applyScopeAnswer(SCOPE_TYPE_ID, q, keys) },
];

// The production Arabic voice: the real AR table and the real `{n}` interpolator.
const i18n = await liftSymbols(join(ROOT, 'src/i18n.tsx'), [{ header: 'const AR' }, { header: 'function fill' }], ['AR', 'fill']);
const AR = i18n.AR as Record<string, string>;
const fill = i18n.fill as (tpl: string, vars?: Record<string, string | number>) => string;
const t: T = (en, vars) => fill(AR[en] ?? en, vars);

// ── a scope query per certified cohort, exactly as the Filter home sets it ──────────────────────
const SLOT: Record<string, Partial<SearchQuery>> = {
  Buy: { deal: 'Buy' },
  RentAnnual: { deal: 'Rent', rentPeriod: 'annual' },
  RentMonthly: { deal: 'Rent', rentPeriod: 'monthly' },
};
const scopeQuery = (clean: string, slot: string): SearchQuery => ({
  ...emptyQuery(), ...SLOT[slot], location: 'الرياض',
  category: (CLEAN_MACRO[clean] ?? 'Residential') as SearchQuery['category'],
  typeGroups: groupsOf([clean]), types: [clean],
});
type Cohort = { clean: string; slot: string; questions: string[]; q: SearchQuery };
const cohorts: Cohort[] = [];
for (const [clean, cfg] of Object.entries(COHORT_QUESTIONS)) {
  for (const [slot, questions] of Object.entries(cfg ?? {})) {
    if (!Array.isArray(questions) || questions.length === 0) continue;
    if (!SLOT[slot]) throw new Error(`unknown cohort slot ${slot}`);
    cohorts.push({ clean, slot, questions, q: scopeQuery(clean, slot) });
  }
}
const certified = [...new Set(cohorts.flatMap((c) => c.questions))];

console.log('\n── T1. completeness: every certified question has an evidence def ─────────────────');
assert(cohorts.length > 0 && certified.length >= 9, `the real registry yielded ${certified.length} certified question ids across ${cohorts.length} cohorts`);
for (const id of certified) assert(id in AF_EVIDENCE, `certified question «${id}» has an evidence def`);
for (const id of Object.keys(AF_EVIDENCE)) assert(certified.includes(id), `evidence def «${id}» is a certified question (no phantom def)`);
assert(same(Object.keys(AF_EVIDENCE), ADVANCED.map((x) => x.id)),
  `registry order = ADVANCED_QUESTIONS order [${ADVANCED.map((x) => x.id).join(', ')}]`);
for (const f of AF_PREDICATE_FIELDS) {
  const owners = Object.entries(AF_EVIDENCE).filter(([, d]) => (d.fields as readonly string[]).includes(f)).map(([id]) => id);
  if (f === 'amenities') assert(same(owners, ['rnpl', 'amenities']), `field «amenities» is shared by exactly rnpl + amenities (the one declared exception)`);
  else assert(owners.length === 1, `field «${f}» is owned by exactly one def (${owners.join(', ') || 'NONE'})`);
}
for (const [id, d] of Object.entries(AF_EVIDENCE)) {
  for (const f of d.fields) assert((AF_PREDICATE_FIELDS as readonly string[]).includes(f), `«${id}» owns only real AF predicate fields (${f})`);
}

console.log('\n── T2. truth per question × option: actual row value, nothing on NULL, only declared reads ──');
// The one hand table: threshold/range questions, whose chip is the ROW's value, not the pick.
// {row} satisfies the option and yields {text}; {not} does not satisfy it and yields nothing.
const HAND: Record<string, { row: AfCanon; text: string; not: AfCanon }> = {
  'bathrooms:1': { row: { bathrooms: 1 }, text: '1 حمام', not: { bathrooms: 0 } },
  'bathrooms:2': { row: { bathrooms: 3 }, text: '3 حمامات', not: { bathrooms: 1 } },
  'bathrooms:3': { row: { bathrooms: 4 }, text: '4 حمامات', not: { bathrooms: 2 } },
  'bathrooms:4': { row: { bathrooms: 5 }, text: '5 حمامات', not: { bathrooms: 3 } },
  'street_width:15': { row: { street_width_m: 18 }, text: 'عرض الشارع 18 م', not: { street_width_m: 12 } },
  'street_width:20': { row: { street_width_m: 25 }, text: 'عرض الشارع 25 م', not: { street_width_m: 15 } },
  'street_width:25': { row: { street_width_m: 25 }, text: 'عرض الشارع 25 م', not: { street_width_m: 20 } },
  'street_width:30': { row: { street_width_m: 40 }, text: 'عرض الشارع 40 م', not: { street_width_m: 29 } },
  'property_age:new': { row: { property_age: 0 }, text: 'جديد', not: { property_age: 3 } },
  'property_age:1_2': { row: { property_age: 2 }, text: 'عمر سنتين', not: { property_age: 5 } },
  'property_age:3_5': { row: { property_age: 4 }, text: 'عمر 4 سنوات', not: { property_age: 6 } },
  'property_age:6_9': { row: { property_age: 7 }, text: 'عمر 7 سنوات', not: { property_age: 10 } },
  // owner decision 5: canonical 10 is exact for aqar but the «10+» bucket for wasalt → «١٠ سنوات فأكثر»
  'property_age:10p': { row: { property_age: 10 }, text: '١٠ سنوات فأكثر', not: { property_age: 9 } },
  'rating:9.5': { row: { rating: 9.7 }, text: '★ 9.7', not: { rating: 9.2 } },
  'rating:9.0': { row: { rating: 9.2 }, text: '★ 9.2', not: { rating: 8.9 } },
  'rating:9.0_rc10': { row: { rating: 9.2, reviews_count: 59 }, text: '★ 9.2 (59 تقييم)', not: { rating: 9.2, reviews_count: 3 } },
};
const OTHER_DIRECTION: Record<string, string> = { 'شمال': 'جنوب', 'جنوب': 'شمال', 'شرق': 'غرب', 'غرب': 'شرق', 'شمال شرق': 'جنوب غرب', 'شمال غرب': 'جنوب شرق', 'جنوب شرق': 'شمال غرب', 'جنوب غرب': 'شمال شرق' };
const OTHER_SUBTYPE: Record<string, string> = { 'استديو': 'شقة', 'شقق مخدومة': 'استديو', 'شقة': 'استديو' };
// Expected evidence for an option, derived from the option's OWN labelKey wherever the chip and the
// evidence share one voice; the hand table above covers the value-printing questions.
function expected(id: string, opt: Opt): { row: AfCanon; text: string; not: AfCanon } | null {
  const hand = HAND[`${id}:${opt.key}`];
  if (hand) return hand;
  switch (id) {
    case 'rnpl': return { row: { rent_now_pay_later: true }, text: t(opt.labelKey), not: { rent_now_pay_later: false } };
    case 'amenities': {
      const col = AMENITY_COL[opt.key];
      if (!col) return null;
      return { row: { [col]: true }, text: t(opt.labelKey), not: { [col]: false } };
    }
    case 'furnished': return opt.key === 'yes'
      ? { row: { furnished: true }, text: t('Furnished'), not: { furnished: false } }
      : { row: { furnished: false }, text: t('Unfurnished'), not: { furnished: true } };
    case 'direction': return { row: { direction_ar: opt.key }, text: t(opt.labelKey), not: { direction_ar: OTHER_DIRECTION[opt.key] } };
    case 'unit_subtype': return { row: { unit_subtype_ar: opt.key }, text: t(opt.labelKey), not: { unit_subtype_ar: OTHER_SUBTYPE[opt.key] } };
    default: return null;
  }
}
/** A row that answers null to EVERY read and records what was read. */
function recorder(values: AfCanon | null): { row: AfCanon; reads: Set<string> } {
  const reads = new Set<string>();
  const row = new Proxy({}, {
    get: (_t, k) => { if (typeof k === 'string') reads.add(k); return values ? values[k as string] ?? null : null; },
    has: (_t, k) => { if (typeof k === 'string') reads.add(k); return values ? k in values : false; },
  }) as AfCanon;
  return { row, reads };
}
const subset = (a: Iterable<string>, b: Iterable<string>) => { const B = new Set(b); return [...a].every((x) => B.has(x)); };

let cells = 0;
const seen = new Set<string>();
for (const c of cohorts) {
  for (const id of c.questions) {
    const question = ADVANCED.find((x) => x.id === id);
    const def = AF_EVIDENCE[id];
    if (!question || !def) { assert(false, `«${id}» (${c.clean}/${c.slot}) has both a question and a def`); continue; }
    const options: Opt[] = id === 'property_age' ? AGE_BUCKETS : (await question.resolveOptions(c.q)).options;
    assert(options.length > 0, `${c.clean}/${c.slot} «${id}» offers ${options.length} option(s)`);
    for (const opt of options) {
      const cell = `${id}:${opt.key}`;
      if (seen.has(cell)) continue;   // same option under another cohort: identical evidence
      seen.add(cell); cells++;
      const exp = expected(id, opt);
      if (id === 'amenities') {
        assert(AMENITY_LABEL[opt.key] === opt.labelKey,
          `amenity «${opt.key}» evidence label = the chip's own labelKey «${opt.labelKey}» (got «${AMENITY_LABEL[opt.key] ?? 'NONE'}»)`);
      }
      if (!exp) { assert(false, `${cell}: no expectation (option not covered)`); continue; }
      const applied = question.apply(c.q, [opt.key]);
      const active = afActive(applied);
      const entry = active.find((a) => a.id === id);
      assert(!!entry && same(entry.keys, [opt.key]), `${cell}: apply() → afActive() round-trips the key (${JSON.stringify(entry?.keys ?? null)})`);
      assert(!afActive(c.q).some((a) => a.id === id), `${cell}: not active on the untouched scope query`);
      if (!entry) continue;
      const one: ActiveAf = [entry];
      // satisfying row → exactly the expected text, with the ROW's value
      const got = afEvidence(one, exp.row, t).map((x) => x.text);
      assert(same(got, [exp.text]), `${cell}: satisfying row → «${exp.text}» (got ${JSON.stringify(got)})`);
      // non-satisfying row → nothing (drift is never shown as a match)
      const drift = afEvidence(one, exp.not, t);
      assert(drift.length === 0, `${cell}: non-satisfying row → no chip (got ${JSON.stringify(drift.map((x) => x.text))})`);
      // NULL row → nothing, and every read ⊆ declared reads (a hidden `?? 0` cannot hide here)
      const nul = recorder(null);
      const onNull = afEvidence(one, nul.row, t);
      assert(onNull.length === 0, `${cell}: NULL row → NOTHING (got ${JSON.stringify(onNull.map((x) => x.text))})`);
      assert(nul.reads.size > 0 && subset(nul.reads, def.reads(entry.keys)),
        `${cell}: on a NULL row the def read only its declared columns [${[...nul.reads].join(', ')}] ⊆ [${def.reads(entry.keys).join(', ')}]`);
      // satisfying row through the recorder → the formatter too reads only declared columns
      const rec = recorder(exp.row);
      const viaRec = afEvidence(one, rec.row, t).map((x) => x.text);
      assert(same(viaRec, [exp.text]) && subset(rec.reads, def.reads(entry.keys)),
        `${cell}: formatter reads only declared columns [${[...rec.reads].join(', ')}]`);
      // the row's value is what is printed: never the pick — the pick alone cannot be the chip
      assert(!def.chips(entry.keys, exp.row, t).some((s) => s === opt.key && !same(exp.row[def.reads(entry.keys)[0]], opt.key)),
        `${cell}: chip is derived from the row, not echoed from the pick`);
    }
  }
}
assert(cells >= 40, `T2 covered ${cells} distinct option cells from the executed registry (expected ≥ 40 on main)`);

console.log('\n── T2b. multi-value semantics + adjectival direction + AND on amenities ──────────────');
{
  const apt = scopeQuery('Apartment', 'Buy');
  const dirQ = ADVANCED.find((x) => x.id === 'direction')!;
  const two = afActive(dirQ.apply(apt, ['شمال', 'غرب'])).find((a) => a.id === 'direction')!;
  assert(!!two && same([...two.keys].sort(), ['شمال', 'غرب'].sort()), 'direction: two picks → both keys active (OR)');
  assert(same(afEvidence([two], { direction_ar: 'غربي' }, t).map((x) => x.text), [t('West')]),
    'direction: OR → ONE chip, the listing\'s real facing, adjectival «غربي» normalised like norm_direction_ar');
  assert(same(afEvidence([two], { direction_ar: 'شمالية' }, t).map((x) => x.text), [t('North')]), 'direction: «شمالية» → «شمال»');
  assert(afEvidence([two], { direction_ar: 'جنوب' }, t).length === 0, 'direction: a facing outside the picks → nothing');
  assert(afEvidence([two], { direction_ar: 'شمال غرب' }, t).length === 0, 'direction: «شمال غرب» is not «شمال» (no substring match)');
  assert(normDirectionAr('  شمال  شرقي ') === 'شمال شرق' && normDirectionAr('غير معروف') === null, 'normDirectionAr mirrors norm_direction_ar: whitespace + adjective folding; outside the 8 → UNKNOWN');

  const annual = scopeQuery('Apartment', 'RentAnnual');
  const amQ = ADVANCED.find((x) => x.id === 'amenities')!;
  const both = afActive(amQ.apply(annual, ['kitchen', 'parking'])).find((a) => a.id === 'amenities')!;
  assert(!!both && same([...both.keys].sort(), ['kitchen', 'parking']), 'amenities: two tokens → both keys active (AND)');
  assert(same(afEvidence([both], { kitchen: true, parking: true }, t).map((x) => x.text), [t('Kitchen'), t('Parking')]),
    'amenities: AND satisfied → one chip per token');
  assert(afEvidence([both], { kitchen: true, parking: false }, t).length === 0, 'amenities: one token false → NOTHING (AND could not have passed)');
  assert(afEvidence([both], { kitchen: true, parking: null }, t).length === 0, 'amenities: one token NULL → NOTHING (never a partial match)');
  const rn = afActive(amQ.apply(annual, ['rnpl', 'kitchen']));
  assert(same(rn.map((a) => a.id), ['rnpl', 'amenities']), 'rnpl rides q.amenities but is its own question; kitchen stays under amenities');
  assert(afEvidence([{ id: 'rnpl', keys: ['rnpl'] }], { rent_now_pay_later: null }, t).length === 0, 'rnpl: NULL → nothing');
  assert(afEvidence([{ id: 'rnpl', keys: ['rnpl'] }], { rent_now_pay_later: false }, t).length === 0, 'rnpl: false → nothing');
  // a NON-number where a number is expected is UNKNOWN too (never Number()-coerced)
  assert(afEvidence([{ id: 'bathrooms', keys: ['3'] }], { bathrooms: '4' }, t).length === 0, 'bathrooms: a string "4" is not a count → nothing');
  assert(afEvidence([{ id: 'furnished', keys: ['yes'] }], { furnished: 'yes' }, t).length === 0, 'furnished: a string is not a boolean → nothing');
  assert(afEvidence([{ id: 'property_age', keys: ['10p'] }], { property_age: 12 }, t)[0]?.text === 'عمر 12 سنة', 'property_age 12 under «10+» → «عمر 12 سنة» (the real value)');
  assert(afEvidence([{ id: 'property_age', keys: ['1_2'] }], { property_age: 1 }, t)[0]?.text === 'عمر سنة', 'property_age 1 → «عمر سنة»');
}

console.log('\n── T3. stale predicates leave; every def can activate; no active id without a def ────');
{
  const annual = scopeQuery('Apartment', 'RentAnnual');
  const bathQ = ADVANCED.find((x) => x.id === 'bathrooms')!;
  const amQ = ADVANCED.find((x) => x.id === 'amenities')!;
  let q = amQ.apply(bathQ.apply(annual, ['3']), ['kitchen']);
  q = { ...q, afFacets: [{ id: 'bathrooms', keys: ['3'], labels: ['3+'] }, { id: 'amenities', keys: ['kitchen'], labels: ['المطبخ'] }] };
  assert(same(afActive(q).map((a) => a.id), ['amenities', 'bathrooms']), 'both committed predicates are active (registry order)');
  const cleared = withoutFacet(q, 0, ALL);
  assert(cleared.bathMin == null, 'withoutFacet really removed bathMin from the query');
  assert(same(afActive(cleared).map((a) => a.id), ['amenities']), 'a cleared facet is gone from afActive → no chip can be made for it');
  assert(afEvidence(afActive(cleared), { bathrooms: 4, kitchen: true }, t).every((x) => x.id !== 'bathrooms'),
    'a row that WOULD satisfy the cleared predicate still yields no bathrooms chip');
  // the WeakMap memo: one frozen reference per query object; a different object is recomputed
  assert(afActive(q) === afActive(q) && Object.isFrozen(afActive(q)), 'afActive returns one frozen reference per result.query object');
  assert(afActive({ ...q }) !== afActive(q) && same(afActive({ ...q }), afActive(q)), 'a new query object is recomputed to equal content');
  assert(afActive(null).length === 0 && afActive(undefined).length === 0, 'no query → no active predicates');
  // THE CARRIER IS THE PREDICATE FIELDS, NEVER A RECEIPT. afFacets / guidedPills / afReceipt are
  // records of what was asked; only the predicate fields are what the RPC filtered on. A receipt
  // without its field (cleared by the chat path, a legacy transcript) must NOT activate; a field
  // without a receipt (chat one-shot) MUST.
  const receiptOnly: SearchQuery = { ...annual, afFacets: [{ id: 'bathrooms', keys: ['3'], labels: ['3+'] }] };
  assert(afActive(receiptOnly).length === 0, 'an afFacets receipt WITHOUT its predicate field activates nothing (receipts are not predicates)');
  assert(same(afActive({ ...annual, bathMin: 3 }).map((a) => a.id), ['bathrooms']), 'a predicate field WITHOUT a receipt activates (chat one-shot turns carry no facets)');
  const readKeys = new Set<string>();
  afActive(new Proxy({ ...annual, bathMin: 2, amenities: ['kitchen'] } as Record<string, unknown>, {
    get(tt, k) { if (typeof k === 'string') readKeys.add(k); return tt[k]; },
  }) as unknown as SearchQuery);
  const offSurface = [...readKeys].filter((k) => !(AF_PREDICATE_FIELDS as readonly string[]).includes(k));
  assert(readKeys.size > 0 && offSurface.length === 0, `afActive reads ONLY AF_PREDICATE_FIELDS off the query (off-surface reads: [${offSurface.join(', ')}])`);
  // THE GENERIC NULL-GUARD IS LOAD-BEARING ON ITS OWN. Every shipped ok() happens to fail on null
  // too, so removing the guard changes nothing observable today — and would silently arm the first
  // def whose ok() is lax. A probe def whose ok() and chips() would LEAK proves the guard runs
  // before either of them, for any def, then is removed again.
  (AF_EVIDENCE as Record<string, unknown>).__probe = { fields: [], active: () => null, reads: () => ['probe_col'], ok: () => true, chips: () => ['LEAK'] };
  try {
    assert(afEvidence([{ id: '__probe', keys: ['x'] }], { probe_col: null }, t).length === 0, 'a NULL read column blocks the chip BEFORE ok()/chips() run — generic, for any def');
    assert(afEvidence([{ id: '__probe', keys: ['x'] }], {}, t).length === 0, 'an ABSENT read column (index↔shape drift) blocks the chip the same way');
    assert(same(afEvidence([{ id: '__probe', keys: ['x'] }], { probe_col: 1 }, t).map((x) => x.text), ['LEAK']), 'the probe def does produce its chip once its column is present (the probe is live)');
  } finally { delete (AF_EVIDENCE as Record<string, unknown>).__probe; }

  const LOADED: SearchQuery = {
    ...annual, ageMin: 3, ageMax: 5, isNewConstruction: null, amenities: ['rnpl', 'elevator'], bathMin: 3,
    ratingMin: 9, reviewsMin: 10, unitSubtypes: ['استديو'], furnishedPref: false, streetWidthMin: 20, directions: ['شمال'],
  };
  const all = afActive(LOADED);
  assert(same(all.map((a) => a.id), Object.keys(AF_EVIDENCE)), `a fully loaded query activates EVERY def, in registry order (${all.map((a) => a.id).join(', ')})`);
  for (const a of all) assert(a.id in AF_EVIDENCE, `active «${a.id}» has a def (no hidden predicate)`);
  const allNull: AfCanon = Object.fromEntries([
    'bathrooms', 'property_age', 'furnished', 'street_width_m', 'direction_ar', 'rating', 'reviews_count', 'unit_subtype_ar',
    'rent_now_pay_later', ...Object.values(AMENITY_COL),
  ].map((k) => [k, null]));
  assert(afEvidence(all, allNull, t).length === 0, 'every predicate active + every column NULL → the strip is EMPTY (UNKNOWN stays UNKNOWN)');
  assert(afEvidence(all, null, t).length === 0 && afEvidence(all, undefined, t).length === 0, 'no canonical row → nothing (never falls back to raw fields)');
  const full: AfCanon = {
    bathrooms: 4, property_age: 4, furnished: false, street_width_m: 25, direction_ar: 'شمالية', rating: 9.4, reviews_count: 59,
    unit_subtype_ar: 'استديو', rent_now_pay_later: true, elevator: true,
  };
  const chips = afEvidence(all, full, t).map((x) => x.text);
  assert(same(chips, [t('Offers installments'), 'عمر 4 سنوات', t('Elevator'), '4 حمامات', t('Unfurnished'), 'عرض الشارع 25 م', t('North'), '★ 9.4 (59 تقييم)', t('Studio unit')]),
    `fully loaded + fully satisfying row → one chip per question, row values, registry order: ${JSON.stringify(chips)}`);
  // furnished:false is a STATED No (source said unfurnished) — shown as «غير مفروشة», never as unknown
  assert(chips.includes('غير مفروشة'), 'furnishedPref:false + furnished:false → «غير مفروشة» (a stated No is a value)');
}

console.log('\n── T4. injection: one carrier, one prop, comparator, strip only from afEvidence ────────');
{
  const agent = read('src/app/agent.tsx');
  assert(count(agent, 'afActive(m.result.query)') === 1, 'agent.tsx derives activeAf from m.result.query exactly once');
  assert(count(agent, 'activeAf={activeAf}') === 1, 'agent.tsx passes activeAf into the card map exactly once');
  assert(count(agent, 'afActive(') === 1, 'agent.tsx calls afActive on NOTHING else (not the store query, not afFacets, not guidedPills)');
  const memo = agent.match(/const MemoResultCard = memo\(ResultCard,[\s\S]*?\);/)?.[0] ?? '';
  assert(memo.includes('prev.activeAf === next.activeAf'), 'the MemoResultCard comparator includes activeAf (otherwise the memo swallows the prop)');
  assert(/import \{[^}]*\bafActive\b[^}]*\} from '@\/lib\/afEvidence'/.test(agent), 'agent.tsx imports afActive from @/lib/afEvidence');

  const card = read('src/components/ResultCard.tsx');
  assert(count(card, 'afEvidence(') === 1, 'ResultCard calls afEvidence exactly once');
  assert(/const evidence = useMemo\(\(\) => afEvidence\(activeAf \?\? \[\], listing\.canon, t\)/.test(card),
    'evidence = afEvidence(activeAf ?? [], listing.canon, t) — the canonical row, never features/bathrooms');
  const start = card.indexOf('testID="card-af-evidence"');
  assert(start > 0, 'the strip renders testID="card-af-evidence"');
  const stripOpen = card.lastIndexOf('{evidence.length > 0 ?', start);
  const strip = card.slice(stripOpen, card.indexOf(') : null}', start) + ') : null}'.length);
  assert(strip.startsWith('{evidence.length > 0 ?'), 'the strip is gated on evidence.length > 0 (absent entirely when there is no evidence)');
  assert(strip.includes("t('Matches your request')"), 'the strip label is «Matches your request»');
  assert(strip.includes('testID={`card-af-evidence-${c.id}`}'), 'each chip carries card-af-evidence-{id}');

  // R12A.1 — VISIBLE WITHOUT EXPANDING. The 2026-09-02 draft rendered the first AF_CHIP_CAP = 4 and
  // hid the rest behind a «+N» expander. R12A.1 requires an ACTIVE selection to be visible "without
  // expanding, scrolling a sub-panel, or opening the source", and rounds accumulate — five or more
  // committed answers is ordinary (AF_ROUND_MAX_QUESTIONS is 4 per round, and a single amenities
  // answer emits one chip PER TOKEN), so a cap of four would hide a field the user explicitly asked
  // for. These three assertions are the rule: map over the WHOLE array, no slice, no expander.
  assert(/\{evidence\.map\(\(c, i\) => \(/.test(strip),
    'R12A.1 — chips are mapped from the WHOLE evidence array (no slice)');
  assert(!/\.slice\(/.test(strip), 'R12A.1 — the strip never slices the evidence (a cap would hide a selected field)');
  assert(!card.includes('card-af-evidence-more') && !card.includes('AF_CHIP_CAP'),
    'R12A.1 — no «+N» expander and no chip cap anywhere in the card');
  for (const forbidden of ['listing.features', 'listing.bathrooms', 'FEATURE_META', 'allActive', 'listing.rent_now_pay_later']) {
    assert(!strip.includes(forbidden), `the strip does not read ${forbidden}`);
  }
  assert(AR['Matches your request'] === 'مطابق لطلبك' && AR['m'] === 'م', 'i18n: «مطابق لطلبك» and «م» exist');
}

// ── T5. R12A.5 — the card's vocabulary covers the certified vocabulary ──────────────────────────
// "Every certified amenity token must be renderable; a token the RPC can filter on but the card
// cannot draw is a defect of this rule, not a missing nice-to-have." The 2026-09-02 draft shipped
// 12 of 20 labels and a `chips` that FILTERED the unlabelled ones out, so gym / pool / garden /
// balcony / laundry_room / optical_fibers / separate_*_meter each passed ok() and then rendered
// nothing — the exact silent hole §12A exists to close. Both halves are pinned here.
{
  console.log('\n── T5. R12A.5: every certified amenity token is drawable ───────────────────────────────');
  const unlabelled = Object.keys(AMENITY_COL).filter((k) => !AMENITY_LABEL[k]);
  assert(unlabelled.length === 0,
    `every certified amenity token has a label (unlabelled: ${unlabelled.join(', ') || 'none'})`);
  assert(Object.keys(AMENITY_LABEL).length === Object.keys(AMENITY_COL).length,
    'AMENITY_LABEL has no entry for a token the filter does not accept');
  // T2 already compares evidence label vs chip labelKey for every option a COHORT resolves. That is
  // per-cohort, so it can only see the tokens that cohort certifies. This is the whole-registry half:
  // the amenity chip defs as advancedFilters.ts DECLARES them, so a token defined for some cohort
  // this file never exercises is still held to the same one-voice rule.
  const advSrc = readFileSync(join(ROOT, 'src/data/advancedFilters.ts'), 'utf8');
  const declared = new Map<string, string>(
    [...advSrc.matchAll(/\{\s*key:\s*'([a-z_]+)',\s*labelKey:\s*'([^']+)',\s*count:/g)]
      .map((m) => [m[1], m[2]] as [string, string]),
  );
  const amenityDefs = [...declared].filter(([k]) => k in AMENITY_COL);
  assert(amenityDefs.length === Object.keys(AMENITY_COL).length,
    `every certified amenity token has a declared chip def (${amenityDefs.length} of ${Object.keys(AMENITY_COL).length})`);
  const wrongVoice = amenityDefs.filter(([k, labelKey]) => AMENITY_LABEL[k] !== labelKey);
  assert(wrongVoice.length === 0,
    `every evidence label equals the AF chip's own labelKey (${amenityDefs.length} defs compared; ` +
    `mismatched: ${wrongVoice.map(([k, l]) => `${k}: «${AMENITY_LABEL[k]}» vs «${l}»`).join(', ') || 'none'})`);
  // The map is also guarded at module load, so a token added without a label cannot even boot.
  const src = read('src/lib/afEvidence.ts');
  // The runtime fails SAFE rather than crashing (verify-no-public-test-crash-surface.ts forbids a
  // module-scope throw in src/ — a data mistake must never take down a user's results screen). That
  // makes THIS barrier the only thing standing between an unlabelled token and a silent hole, so the
  // completeness assertions above are load-bearing, not decorative.
  assert(!/throw new Error/.test(src), 'afEvidence never throws at module scope (it must not crash a user)');
  assert(/AMENITY_LABEL\[x\] \? t\(AMENITY_LABEL\[x\]\) : null/.test(src),
    'the amenities formatter renders NOTHING for an unlabelled token — never a raw English key to an Arabic reader');
}

// ── T6. af_canon: the SQL the RPC runs and the columns the card reads are one contract ──────────
// afEvidence asks af_canon for a column; the RPC packs af_canon in SQL. Nothing but this holds the
// two together — a `reads` entry the migration never packed renders nothing (the null-guard eats it),
// and an AF parameter missing from the payload GATE makes af_canon NULL for a search narrowed by that
// answer alone, so the card would show nothing for exactly the field the user chose. Both directions
// are checked against sql/mirrors/af_canon_select.sql, the repo-side copy of the projection.
{
  console.log('\n── T6. af_canon ⇄ afEvidence: one contract, both directions ─────────────────────────────');
  const mirror = readFileSync(join(ROOT, 'sql/mirrors/af_canon_select.sql'), 'utf8');
  const packed = new Set([...mirror.matchAll(/'([a-z_]+)',\s*s\.[a-z_]+/g)].map((m) => m[1]));
  assert(packed.size === 28, `the mirror packs 28 canonical columns (found ${packed.size})`);

  // (a) every column any def declares it reads must be packed
  const q = emptyQuery() as any;
  q.amenities = Object.keys(AMENITY_COL); q.bathMin = 1; q.ageMin = 1; q.ageMax = 2;
  q.furnishedPref = true; q.streetWidthMin = 15; q.directions = ['شمال'];
  q.ratingMin = 9; q.reviewsMin = 10; q.unitSubtypes = ['استديو'];
  let missing: string[] = [];
  for (const { id, keys } of afActive(q)) {
    for (const col of AF_EVIDENCE[id].reads(keys)) if (!packed.has(col)) missing.push(`${id}:${col}`);
  }
  assert(missing.length === 0,
    `every column afEvidence reads is packed into af_canon (missing: ${missing.join(', ') || 'none'})`);

  // (b) every AF predicate field's RPC parameter must be in the gate, or a search narrowed by that
  //     answer alone returns af_canon NULL and the card silently shows nothing for it.
  const gate = mirror.slice(mirror.indexOf('case when ('), mirror.indexOf(') then'));
  const PARAM_OF: Record<string, string> = {
    ageMin: 'p_age_min', ageMax: 'p_age_max', isNewConstruction: 'p_is_new_construction',
    amenities: 'p_amenities', bathMin: 'p_bath_min', ratingMin: 'p_rating_min',
    reviewsMin: 'p_reviews_min', unitSubtypes: 'p_unit_subtypes', furnishedPref: 'p_furnished',
    streetWidthMin: 'p_street_width_min', directions: 'p_directions',
  };
  const ungated = AF_PREDICATE_FIELDS.filter((f) => !gate.includes(`${PARAM_OF[f]} is not null`));
  assert(ungated.length === 0,
    `every AF predicate field's RPC param is in the payload gate (ungated: ${ungated.join(', ') || 'none'})`);
  assert(Object.keys(PARAM_OF).length === AF_PREDICATE_FIELDS.length,
    'the field→param map covers AF_PREDICATE_FIELDS exactly (a new field must be mapped, not forgotten)');

  // (c) remote.ts carries it VERBATIM onto the listing — never coerced.
  const remote = read('src/data/remote.ts');
  assert(/af_canon:\s*\(c\.af_canon \?\? null\)/.test(remote),
    'remote.ts copies af_canon verbatim (`c.af_canon ?? null`), never `!!` and never `?? 0`');
  assert(/l\.canon = c\.af_canon;/.test(remote), 'remote.ts attaches the canonical row to the listing');
  assert(!/af_canon[^\n]*\?\?\s*(0|false|\{\})/.test(remote), 'remote.ts never defaults af_canon to a value');
}

console.log('');
if (failed) { console.error(`❌ verify-af-card-evidence: ${failed} check(s) failed.`); process.exit(1); }
console.log('✓ verify-af-card-evidence: all checks passed.');
