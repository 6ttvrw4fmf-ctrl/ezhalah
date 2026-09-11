// A NULL LIST IS "NO RESTRICTION". AN EMPTY LIST IS "NOTHING MATCHES". THE ORACLE MUST NOT CONFUSE
// THEM — IN EITHER DIRECTION.
//
// FOUND LIVE, 2026-09-11, routine #9 red team (ops_incident: layer_disagreement:oracle_null_list).
//
// The independent oracle in scripts/lib/afOracleFilter.ts built its scope arm A unconditionally:
//
//     const types = ((reqBody.p_types as string[] | undefined) ?? []).filter(…);
//     const a = `and(source_table.in.(…),type_ar.in.(${types.map(…).join(',')}))`;
//
// so a request carrying `p_types: null` became `type_ar.in.()` — an EMPTY in-list, which matches no
// row at all. Arm A therefore contributed ZERO. Arm B had carried the identical guard since it was
// written (`t2.length ? … : null`); arm A never did.
//
// `p_types: null` is not an exotic shape. It is what the app sends for EVERY category search with
// no نوع picked — the single most common search in the product. Captured off the wire from the real
// site (page.on('request') → request.postData(), تبوك / بيع, 2026-09-11):
//
//     p_types = null   (the KEY IS PRESENT and its value is null — not absent, not [])
//     p_tables = [42]  p_types2 = [24]  p_tables2 = [42]  p_category = "Residential"
//
// and the live clause, read with pg_get_functiondef against PRODUCTION rather than from a migration
// file, is:
//
//     ((p_tables is null or s.source_table = any(p_tables))
//      and (p_types is null or s.type_ar   = any(p_types)))
//
// In Postgres `x = any('{}')` is FALSE, so `[]` genuinely matches nothing while `null` matches
// everything. The two are not interchangeable and the oracle now distinguishes them.
//
// WHAT IT COST, measured on production the day it was found (تبوك / بيع / Residential):
//     production — RPC total_count, and the number on the user's screen ....... 1,026
//     the oracle, before the fix ................................................. 10   (arm B only)
//     set diff: missing 0 · extra 1,016 — a strict SUBSET of production, which is the signature of
//     an over-narrow ORACLE and not of a widened product (§41.15).
//   After the fix, on the same journey re-driven in a real browser: 1,026 = 1,026 = 1,026,
//   missing 0 · extra 0 · duplicates 0.
//
// WHY THIS IS A FALSE-GREEN MECHANISM AND NOT MERELY A NOISY RED — the reason it is worth a barrier
// rather than a one-line fix. Today the defect makes a live check fail loudly. But the oracle's
// whole value is that it is an INDEPENDENT reading, and this bug gave it its own private copy of
// precisely the mistake the RPC could make. Drop the `p_types is null or` guard from
// af_eligibility_clause() — a one-token regression — and production returns 10 rows for every
// untyped category search, a 99% loss of results on the app's commonest journey, while this oracle
// also returns 10 and the differential barrier reports AGREEMENT. Green, over an outage. That is
// exactly PART 2.2's "an oracle that shares an implementation mistake with the thing it audits
// agrees with it for the wrong reason", and it is the shape routine #9 exists to hunt.
//
// WHAT THIS FILE PINS (offline, deterministic, no I/O — the translator is a pure function):
//   1. a NULL p_types never emits an empty in-list, and the arm keeps its table restriction;
//   2. an EXPLICIT [] still means "nothing matches" — the fix must not paper over the real
//      empty-array semantics while repairing the null one;
//   3. category purity SURVIVES a null p_types (production applies it through a separate clause),
//      so the repair does not trade an under-count for an over-count;
//   4. the same rule on the single-scope (`!hasScopeB`) path, where the bug ran the OTHER way;
//   5. every emitted part is a real PostgREST parameter (`key=value`) — a bare `and(…)` is not;
//   6. and the mutation proofs below re-introduce the defect and watch this file catch it.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-oracle-null-list-is-not-an-empty-list.ts   (discovered into `npm test`)
import { buildOracleQS } from './lib/afOracleFilter.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failed++;
};

// The REAL captured request, verbatim in shape: p_types is null with the key present, and the
// Residential second scope is attached exactly as src/data/remote.ts attachResScopeB builds it.
const RES_TABLES = ['aqar_residential_listings', 'wasalt_residential_listings', 'sadin_residential_listings'];
const COM_TABLES = ['aqar_commercial_listings', 'wasalt_commercial_listings', 'sadin_commercial_listings'];
const RES_TYPES = ['شقة', 'فيلا', 'دور'];
const MACROS: Record<string, string> = {
  'شقة': 'Residential', 'فيلا': 'Residential', 'دور': 'Residential',
  'عمارة': 'both', 'غير معروف': 'both',
  'مكتب': 'Commercial', 'معرض': 'Commercial',
};
const LIVE_SHAPE = {
  p_deal: 'بيع', p_cities: ['تبوك'], p_region_ids: [7],
  p_category: 'Residential',
  p_tables: RES_TABLES, p_types: null,
  p_tables2: COM_TABLES, p_types2: RES_TYPES,
  p_limit: 1500, p_offset: 0,
};
const decoded = (body: Record<string, unknown>, opts?: Parameters<typeof buildOracleQS>[1]) => {
  const { qs, unhandled } = buildOracleQS(body, opts);
  return { qs: decodeURIComponent(qs), raw: qs, unhandled };
};

console.log('\nA null list is not an empty list\n');

// ── 1. THE DEFECT ITSELF — a null p_types must never become an empty in-list ────────────────────
{
  const { qs, unhandled } = decoded(LIVE_SHAPE, { typeMacros: MACROS });
  check('the real captured request emits NO empty in-list anywhere',
    !/\.in\.\(\)/.test(qs), qs);
  check('…and arm A keeps its source_table restriction (the arm did not simply vanish)',
    qs.includes('source_table.in.(aqar_residential_listings'), qs);
  check('…and the request is fully translated (nothing reported unhandled)',
    unhandled.length === 0, unhandled.join(' | '));
}

// ── 2. AN EXPLICIT [] STILL MEANS "NOTHING MATCHES" ────────────────────────────────────────────
// The repair must not overshoot. Production's `= any('{}')` is FALSE, so an empty array genuinely
// selects nothing, and an oracle that quietly widened it to "everything" would be wrong the other
// way — the same class of error, wearing the opposite sign.
{
  const { qs } = decoded({ ...LIVE_SHAPE, p_types: [] }, { typeMacros: MACROS });
  check('an EXPLICIT empty p_types still emits the empty in-list that matches nothing',
    /type_ar\.in\.\(\)/.test(qs), qs);
}
{
  const nullQs = decoded(LIVE_SHAPE, { typeMacros: MACROS }).qs;
  const emptyQs = decoded({ ...LIVE_SHAPE, p_types: [] }, { typeMacros: MACROS }).qs;
  check('null and [] produce genuinely DIFFERENT filters (the distinction is real, not cosmetic)',
    nullQs !== emptyQs);
}

// ── 3. CATEGORY PURITY SURVIVES A NULL p_types ─────────────────────────────────────────────────
// `p_types is null` removes the type LIST, not the purity clause. Production keeps a row only when
// its type_ar EXISTS in known_type_ar with macro = p_category, or macro = 'both' on arm A. So the
// permitted types are named explicitly; a Commercial-macro type in a residential table is excluded,
// and a type_ar absent from the reference table is excluded too, exactly as `exists(...)` does.
{
  const { qs } = decoded(LIVE_SHAPE, { typeMacros: MACROS });
  check('a null p_types still applies category purity — Residential and `both` types are named',
    qs.includes('"شقة"') && qs.includes('"عمارة"'), qs);
  check('…and a Commercial-macro type is NOT admitted into arm A by the null p_types',
    !new RegExp('and\\([^)]*"مكتب"').test(qs) && !qs.includes('type_ar.in.("مكتب"'), qs);
  check('…and with NO typeMacros supplied, p_category is reported UNHANDLED rather than guessed',
    decoded(LIVE_SHAPE).unhandled.some((u) => u.includes('p_category')),
    decoded(LIVE_SHAPE).unhandled.join(' | '));
}

// ── 4. THE SINGLE-SCOPE PATH — where the bug ran the OTHER way ──────────────────────────────────
// Without a second scope the `case 'p_types'` arm never fires for a null value (the loop skips
// null), so the oracle previously applied NO type predicate at all while production still applied
// purity. That OVER-counts. Both directions are now covered by the same rule.
{
  const single = { p_deal: 'بيع', p_cities: ['تبوك'], p_category: 'Commercial',
                   p_tables: COM_TABLES, p_types: null, p_limit: 1500, p_offset: 0 };
  const { qs, unhandled } = decoded(single, { typeMacros: MACROS });
  check('single-scope + null p_types still carries a category-purity type predicate',
    /type_ar=in\.\(/.test(qs), qs);
  check('…naming the Commercial and `both` types, and not the Residential ones',
    qs.includes('"مكتب"') && qs.includes('"عمارة"') && !qs.includes('"شقة"'), qs);
  check('…and it is fully translated', unhandled.length === 0, unhandled.join(' | '));
}

// ── 5. EVERY EMITTED PART IS A REAL POSTGREST PARAMETER ────────────────────────────────────────
// A latent sibling in the same block: when scope B emptied out, arm A was pushed as a bare
// `and(source_table.in.(…),type_ar.in.(…))` with no `=`, which is not a query parameter at all.
{
  const bEmpty = { ...LIVE_SHAPE, p_types2: ['مكتب'] };   // every type2 filtered out by B-purity
  const { raw } = decoded(bEmpty, { typeMacros: MACROS });
  const parts = raw.split('&');
  const malformed = parts.filter((p) => !/^[a-z_]+=/.test(p));
  check('when scope B empties out, arm A is still emitted as a real `key=value` parameter',
    malformed.length === 0, `malformed: ${malformed.join(' | ')}`);
}

// ── MUTATION PROOFS — the defect re-introduced, and watched ─────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
console.log('\nMutation proofs\n');

// The DEFECT AS SHIPPED, rebuilt exactly as scripts/lib/afOracleFilter.ts wrote it before today,
// and fed the request that exposed it. This is the pre-fix arm A, verbatim in behaviour.
const defectiveArmA = (body: Record<string, unknown>) => {
  const tables = (body.p_tables as string[] | undefined) ?? [];
  const types = ((body.p_types as string[] | undefined) ?? []);
  return `and(source_table.in.(${tables.join(',')}),type_ar.in.(${types.map((x) => `"${x}"`).join(',')}))`;
};
const repaired = decoded(LIVE_SHAPE, { typeMacros: MACROS }).qs;

mustCatch('DEFECT AS SHIPPED — the pre-fix arm A emits `type_ar.in.()` on the real captured request',
  /type_ar\.in\.\(\)/.test(defectiveArmA(LIVE_SHAPE)));
mustCatch('…and this file\'s assertion 1 genuinely rejects it (the predicate is not vacuously true)',
  /\.in\.\(\)/.test(defectiveArmA(LIVE_SHAPE)) && !/\.in\.\(\)/.test(repaired));
mustCatch('…and the repair is not a no-op — the emitted filter really changed',
  repaired !== defectiveArmA(LIVE_SHAPE) && repaired.includes('source_table.in.'));
mustCatch('a repair that widened [] to "everything" would be caught (the opposite over-correction)',
  /type_ar\.in\.\(\)/.test(decoded({ ...LIVE_SHAPE, p_types: [] }, { typeMacros: MACROS }).qs));
mustCatch('dropping category purity from the null path would be caught',
  (() => {
    const q = decoded(LIVE_SHAPE, { typeMacros: MACROS }).qs;
    return q.includes('"شقة"') && q.includes('"عمارة"');   // a bare table-only arm A would carry neither
  })());
mustCatch('an arm A that silently narrowed to scope B alone would be caught',
  (() => {
    // p_tables null AND p_types null ⇒ arm A is unconditionally TRUE ⇒ the WHOLE scope predicate
    // drops out. Emitting `or=(B)` there would restrict the oracle to the commercial arm.
    const { qs } = decoded({ ...LIVE_SHAPE, p_tables: null, p_types: null, p_category: null },
      { typeMacros: MACROS });
    return !/source_table/.test(qs);
  })());
mustCatch('…while the real, correctly-translated request still passes every assertion above '
  + '(none of them is vacuously red)',
  decoded(LIVE_SHAPE, { typeMacros: MACROS }).unhandled.length === 0
  && !/\.in\.\(\)/.test(repaired) && /or=\(/.test(repaired));

const ok = failed === 0 && mutFail === 0;
console.log(ok
  ? '\n✓ the oracle tells a null list from an empty one, in both directions'
  : `\n✗ ${failed} check(s) failed, ${mutFail} mutation(s) survived`);
process.exit(ok ? 0 : 1);
