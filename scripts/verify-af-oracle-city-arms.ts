// THE ORACLE'S CITY PREDICATE MATCHES A CITY THE THREE WAYS PRODUCTION DOES — OR SAYS IT DOES NOT.
//
// FOUND LIVE, 2026-09-06, routine #9 red team (ops_incident: layer_disagreement:oracle_city_arms).
// The independent oracle in scripts/lib/afOracleFilter.ts translated `p_cities` as a bare
// `city_ar=in.(…)`. Production does not match a city by its label alone. Read straight off the live
// definition with pg_get_functiondef, location_search_candidates_ar's clause is a THREE-ARM OR:
//
//     normalize_ar(s.city_ar) = any (array(select tok from city_tokens))
//  OR s.city_id             = any (array(select city_id from city_ids))
//  OR s.match_city_ids     && (select array_agg(city_id) from city_ids)
//
// with `city_ids` = loc_catalog_city (city_norm) UNION loc_catalog_city_alias (alias_norm).
//
// WHAT THAT COST, measured on production the day it was found:
//   • الهفوف / بيع / فيلا — RPC 802, oracle 652. A 150-row phantom "the product returned extra
//     ineligible listings", reported against a search that was perfectly correct.
//   • Fleet-wide the label-only arm cannot see 6,021 rows, all in the الهفوف/الاحساء twin pair
//     (الاحساء misses 5,181; الهفوف misses 840). Exactly two catalogued cities are affected.
//   • And it had been agreeing with production FOR THE WRONG REASON everywhere else: on 21 cities
//     checked, 20 give an identical count either way, because no city the AF corpus drives —
//     الرياض, جدة, الدمام, الخبر, مكة, المدينة, بريدة, أبها, الطائف, حائل, تبوك and nine more —
//     carries an alias. §40.2's "never Riyadh-heavy" rotation is the only reason it ever surfaced.
//
// The gap ran in BOTH directions, which is why it mattered more than its row count suggests: an
// oracle that undercounts by construction cannot distinguish its own blind spot from the product
// genuinely returning rows it should not. Those cities were uncertifiable either way.
//
// WHAT THIS FILE PINS (offline, deterministic, no I/O — the translator is a pure function):
//   1. with `cityScope`, the emitted filter carries ALL THREE arms, OR-ed, never AND-ed;
//   2. without it, the label-only arm is still emitted (the deliberate, documented default — see
//      the p_cities case; wiring the twelve live callers is routed to routine #10) and this file
//      MEASURES the difference rather than letting it go quiet;
//   3. a city the catalogue cannot resolve is REFUSED (`unhandled`), never translated on the label
//      arm alone — the same discipline p_districts and p_category already follow;
//   4. and the mutation proofs below re-introduce the defect and watch this file catch it.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-af-oracle-city-arms.ts        (discovered into `npm test` by testRegistry.ts)
import { buildOracleQS } from './lib/afOracleFilter.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failed++;
};

// The real production shape: الهفوف resolves to catalogue ids 12 and 501 (loc_catalog_city rows
// sharing that city_norm); the 840 extra rows are labelled الاحساء and reached through
// match_city_ids. Verified live: or=(city_ar.in.(الهفوف),city_id.in.(12,501),
// match_city_ids.ov.{12,501}) returns 6,021 — the RPC's own predicate, to the row.
const HUFUF = 'الهفوف';
const SCOPE = { [HUFUF]: [12, 501] };
const decoded = (body: Record<string, unknown>, opts?: Parameters<typeof buildOracleQS>[1]) => {
  const { qs, unhandled } = buildOracleQS(body, opts);
  return { qs: decodeURIComponent(qs), raw: qs, unhandled };
};

console.log('\nThe oracle matches a city the way production does\n');

// ── 1. WITH cityScope: all three arms, OR-ed ────────────────────────────────────────────────────
{
  const { qs, unhandled } = decoded({ p_cities: [HUFUF] }, { cityScope: SCOPE });
  check('no parameter is left unhandled when the catalogue resolves the city', unhandled.length === 0, unhandled.join(', '));
  check('arm 1 — the literal label is still matched', qs.includes(`city_ar.in.("${HUFUF}")`) || qs.includes(`city_ar.in.(${HUFUF})`), qs);
  check('arm 2 — the resolved catalogue city_ids are matched', qs.includes('city_id.in.(12,501)'), qs);
  check('arm 3 — match_city_ids OVERLAP is matched (this is the arm that carries an alias)',
    qs.includes('match_city_ids.ov.{12,501}'), qs);
  check('the three arms are OR-ed, not AND-ed (an AND would return the intersection — near zero)',
    /or=\(.*city_ar\.in.*,city_id\.in\.\(12,501\),match_city_ids\.ov\.\{12,501\}\)/.test(qs), qs);
  check('…and they are ONE `or=` group, so a later AND-ed predicate still narrows all three',
    (qs.match(/or=\(/g) ?? []).length === 1, qs);
}

// ── 2. WITHOUT cityScope: the documented default, measured rather than assumed ───────────────────
{
  const { qs, unhandled } = decoded({ p_cities: [HUFUF] });
  check('the default still emits the label arm (twelve live callers depend on it — see the p_cities case)',
    qs.includes('city_ar=in.') && unhandled.length === 0, qs);
  check('THE KNOWN LIMITATION IS REAL AND NAMED: the default carries neither id arm, so an aliased '
    + 'city undercounts (6,021 rows across الهفوف/الاحساء). Wiring the live callers is routed to #10.',
    !qs.includes('city_id.in.') && !qs.includes('match_city_ids.ov.'), qs);
}

// ── 3. AN UNRESOLVABLE CITY IS REFUSED, NEVER TRANSLATED ON THE LABEL ARM ALONE ──────────────────
{
  const { qs, unhandled } = decoded({ p_cities: [HUFUF, 'مدينة لا توجد في الفهرس'] }, { cityScope: SCOPE });
  check('a city the catalogue cannot resolve is REFUSED', unhandled.some((u) => u.startsWith('p_cities:')), unhandled.join(', '));
  check('…and no city filter is emitted for that request at all (refuse, never half-translate)',
    !qs.includes('city_ar.in.') && !qs.includes('city_id.in.'), qs);
}

// ── 4. THE ARMS SURVIVE A REAL, FULLY-PARAMETERISED REQUEST ─────────────────────────────────────
{
  const { qs, unhandled } = decoded(
    { p_cities: [HUFUF], p_deal: 'بيع', p_types: ['فيلا', 'تاون هاوس', 'بيت'], p_limit: 1500, p_offset: 0 },
    { cityScope: SCOPE });
  check('a full request still carries all three city arms alongside its other predicates',
    unhandled.length === 0 && qs.includes('city_id.in.(12,501)') && qs.includes('match_city_ids.ov.{12,501}')
    && qs.includes('deal_ar=eq.بيع'), `${unhandled.join(',')} :: ${qs}`);
}

// ── MUTATION PROOFS — the defect re-introduced, and watched ─────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
console.log('\nMutation proofs\n');

// The DEFECT ITSELF: the pre-2026-09-06 translation, applied to the request that exposed it.
const defective = `city_ar=in.("${HUFUF}")`;
const repaired = decoded({ p_cities: [HUFUF] }, { cityScope: SCOPE }).qs;

mustCatch('DEFECT AS SHIPPED — a label-only city filter is not the three-arm predicate production runs',
  !/city_id\.in\.|match_city_ids\.ov\./.test(defective));
mustCatch('…and the repaired translation genuinely differs from it (the fix is not a no-op)',
  repaired !== defective && /city_id\.in\./.test(repaired) && /match_city_ids\.ov\./.test(repaired));
mustCatch('dropping the OVERLAP arm alone — the one that carries the alias — is still a defect',
  !/match_city_ids\.ov\./.test(repaired.replace(/,match_city_ids\.ov\.\{[\d,]+\}/, '')));
mustCatch('AND-ing the arms instead of OR-ing them (the intersection, not the union) is not what this emits',
  !repaired.includes(`city_ar=in.("${HUFUF}")&city_id=in.(12,501)`));
mustCatch('an EMPTY resolved id set must not emit a filter matching everything',
  (() => {
    const { qs } = decoded({ p_cities: [HUFUF] }, { cityScope: { [HUFUF]: [] } });
    return qs.includes('city_ar.in.') && !qs.includes('city_id.in.()') && !qs.includes('.ov.{}');
  })());
mustCatch('…while the real, correctly-scoped request still passes every assertion above (none is vacuously red)',
  decoded({ p_cities: [HUFUF] }, { cityScope: SCOPE }).unhandled.length === 0
  && /or=\(/.test(repaired));

const ok = failed === 0 && mutFail === 0;
console.log(ok
  ? '\n✓ the oracle matches a city the three ways production does, or refuses to guess'
  : `\n✗ ${failed} check(s) failed, ${mutFail} mutation(s) survived`);
process.exit(ok ? 0 : 1);
