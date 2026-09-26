// THE الحي LABEL RESOLUTION MUST RUN IN THE SAME CITY SCOPE AS THE COMPARISON IT FEEDS.
//
// WHY THIS EXISTS (routine #4, 2026-09-26 — found by the daily live sweep, on production).
//
// The sweep's layer-5 oracle compares the SERVED حي LABEL exactly, on purpose: normalising the token
// itself would reimplement the RPC's `norm_district_tok` and turn agreement into self-confirmation.
// To stay honest it first RESOLVES the requested حي to whatever label the index actually serves, via
// `districtLabelVariants` («الدانة» → «الدانة» / «حي الدانة») and `servedLabelExists`.
//
// That resolution ran inside a scope built from `city_ar` alone:
//
//     scope = `&city_ar=in.("الاحساء")`
//
// which is the LABEL arm of the city predicate and only the label arm. `dbFilterFromRequest` had
// already been taught all THREE arms on 2026-09-01 — label, `city_id`, and `match_city_ids &&`, the
// one that carries aliases and owner-approved CLUSTERS — after a label-only filter produced eleven
// false COUNT MISMATCHes. The resolution step was never given the same treatment, and kept its
// label-only scope for 25 days.
//
// MEASURED, the run that found it — trending-district الاحساء/بيع/«الدانة», al_ahsa cluster:
//     الاحساء (city_id 3677) renders the token «الدانة»        → 181 production_ready rows
//     الهفوف  (city_id 12)   renders the SAME token «حي الدانة» →  69 production_ready rows
//   and all 69 carry match_city_ids ⊇ {3677}, so the RPC correctly returns both.
// `servedLabelExists('حي الدانة', '&city_ar=in.("الاحساء")')` is FALSE — those rows carry
// `city_ar = 'الهفوف'` — so the variant machinery that exists for exactly this resolved «الدانة»
// alone. The oracle then counted 113 against the RPC's 157 and the sweep reported:
//
//     RPC→DB — RPC 157 vs independent DB 113
//     RPC→DB — 44 served listing(s) fail the user's own filters, e.g. dealapp_residential_listings:8218573
//
// Forty-four healthy listings named as defects, and a correct product accused of serving rows that
// fail the user's filters. §41.15 and §40.7 exactly: when the oracle and the product disagree over a
// whole SLICE of the set, suspect the oracle's ability to NAME the scope before the product's ability
// to find the rows. The identical shape as the 2026-09-01 incident, one function downstream.
//
// THE CLASS, and what this barrier pins: a check whose SETUP resolves its scope more narrowly than
// the COMPARISON it hands that scope to. Both halves looked correct in isolation; only the
// relationship between them was wrong. So the scope is now ONE exported definition (`cityScopeArm`)
// used by both, and this EXECUTES it — never reads the call site and hopes.
//
// Hermetic: no browser, no network, no database. The catalog rows and the row counts below were
// CAPTURED from production 2026-09-26, never invented (AGENTS.md: feed a barrier what production stores).
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-live-sweep-district-scope-spans-the-cluster.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cityScopeArm, districtResolutionScope, districtLabelVariants } from '../e2e/live-sweep/sweep.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe الحي label resolution runs in the SAME city scope as the comparison it feeds\n');

// ── production fixtures (loc_catalog_city, captured 2026-09-26) ─────────────────────────────────
const CATALOG = [
  { city_id: 12,   city_ar: 'الهفوف', city_norm: 'الهفوف', region_id: 5 },
  { city_id: 13,   city_ar: 'الدمام', city_norm: 'الدمام', region_id: 5 },
  { city_id: 31,   city_ar: 'الخبر',  city_norm: 'الخبر',  region_id: 5 },
  { city_id: 3677, city_ar: 'الاحساء', city_norm: 'الاحساء', region_id: 5 },
];
// The real trending-district request, as the app serialised it.
const CLUSTER_REQ = { p_cities: ['الاحساء'], p_districts: ['الدانة'], p_deal: 'بيع', p_region_ids: [5], p_limit: 1500 };

// ── 1. THE SCOPE CARRIES ALL THREE ARMS, BY EXECUTION ───────────────────────────────────────────
const scoped = districtResolutionScope(CLUSTER_REQ, CATALOG);
check('the resolution scope is expressible for the cluster request', !scoped.reason && typeof scoped.scope === 'string',
  scoped.reason ?? String(scoped.scope));
const scope: string = scoped.scope ?? '';
check('it carries the LABEL arm (city_ar)', /city_ar\.in\./.test(scope), scope);
check('it carries the CITY_ID arm', /city_id\.in\.\(3677\)/.test(scope), scope);
check('it carries the MATCH_CITY_IDS arm — the one that carries clusters',
  /match_city_ids\.ov\.\{3677\}/.test(scope),
  `without this arm الهفوف's «حي الدانة» rows are outside the resolution scope\n      ${scope}`);
check('it carries the region predicate', /region_id=in\.\(5\)/.test(scope), scope);

// ── 2. THE MUTATION — the OLD label-only scope must NOT satisfy section 1 ────────────────────────
// Without this, section 1 could be passing for reasons unrelated to the defect.
const OLD_LABEL_ONLY_SCOPE = '&city_ar=in.("الاحساء")&region_id=in.(5)';
check('MUTATION: the label-only scope this replaced lacks the match_city_ids arm',
  !/match_city_ids\.ov\./.test(OLD_LABEL_ONLY_SCOPE));
check('MUTATION: the label-only scope lacks the city_id arm too',
  !/city_id\.in\./.test(OLD_LABEL_ONLY_SCOPE));
check('MUTATION: the new scope and the old one genuinely differ', scope !== OLD_LABEL_ONLY_SCOPE);
// The whole reason the old scope was wrong: «حي الدانة» rows carry city_ar='الهفوف', so a predicate
// that can only name «الاحساء» cannot see them. Proven as a property of the STRINGS, since the row
// counts (181 / 69, both verified in production) are what make it matter.
check('MUTATION: the old scope cannot name الهفوف at all, so its «حي الدانة» rows are invisible to it',
  !OLD_LABEL_ONLY_SCOPE.includes('الهفوف') && !/(city_id|match_city_ids)/.test(OLD_LABEL_ONLY_SCOPE),
  'if it could reach الهفوف by any arm, the 44 false accusations would not have happened');

// ── 3. ONE DEFINITION — the resolution scope IS the comparison's city arm ───────────────────────
// This is the actual class: two places deriving "the same" scope independently. Proven by comparing
// what the two functions RETURN, so they cannot drift apart silently again.
const arm = cityScopeArm(CLUSTER_REQ, CATALOG);
check('cityScopeArm resolves the cluster request', !arm.reason, arm.reason ?? '');
check('districtResolutionScope BEGINS with exactly cityScopeArm\'s arm — one definition, not two',
  scope.startsWith(arm.arm ?? '\u0000'),
  `arm:   ${arm.arm}\n      scope: ${scope}`);
check('and adds nothing but the region predicate',
  scope.slice((arm.arm ?? '').length) === '&region_id=in.(5)',
  JSON.stringify(scope.slice((arm.arm ?? '').length)));

// ── 4. THE VARIANT MACHINERY STILL OFFERS BOTH RENDERINGS ───────────────────────────────────────
// The scope fix only helps if «حي الدانة» is among the candidates tried inside it.
const variants = districtLabelVariants('الدانة');
check('districtLabelVariants offers both «الدانة» and «حي الدانة»',
  variants.includes('الدانة') && variants.includes('حي الدانة'), JSON.stringify(variants));
check('and it is symmetric — a «حي X» request also offers the bare form',
  districtLabelVariants('حي الدانة').includes('الدانة'), JSON.stringify(districtLabelVariants('حي الدانة')));

// ── 5. FAIL CLOSED — an unresolvable scope REFUSES, it does not narrow ──────────────────────────
// A FAILED FETCH IS NOT AN EMPTY ANSWER (AGENTS.md). With no catalog the three arms cannot be
// expressed, and the honest answer is a refusal — never a quiet fall back to the label-only scope
// that caused this.
check('no catalog → REFUSE with a reason, never a label-only scope',
  Boolean(districtResolutionScope(CLUSTER_REQ, []).reason)
  && districtResolutionScope(CLUSTER_REQ, []).scope === undefined);
check('null catalog → REFUSE', Boolean(districtResolutionScope(CLUSTER_REQ, null as never).reason));
check('an unresolvable city name → REFUSE, naming the city',
  (districtResolutionScope({ ...CLUSTER_REQ, p_cities: ['مدينة لا توجد'] }, CATALOG).reason ?? '')
    .includes('مدينة لا توجد'));
// §41.16: a city NAME is not an identity — 290 of them repeat across regions.
check('a city that does not resolve IN THE REQUESTED REGION → REFUSE',
  Boolean(districtResolutionScope({ ...CLUSTER_REQ, p_region_ids: [4] }, CATALOG).reason));

// ── 6. A NON-CLUSTER REQUEST IS UNCHANGED ───────────────────────────────────────────────────────
// The fix must not alter the 2,050 cohorts the layer already expressed correctly.
const plain = districtResolutionScope(
  { p_cities: ['الخبر'], p_districts: ['الراكة'], p_deal: 'بيع', p_region_ids: [5] }, CATALOG);
check('a single non-clustered city still resolves to exactly its own id',
  /city_id\.in\.\(31\)/.test(plain.scope ?? '') && /match_city_ids\.ov\.\{31\}/.test(plain.scope ?? ''),
  plain.scope ?? plain.reason);
check('and «الخبر» is never widened to «الخبراء» by the scope',
  !(plain.scope ?? '').includes('الخبراء'), plain.scope);

// ── 7. THE CALL SITE USES THE SHARED RULE ───────────────────────────────────────────────────────
// Sections 1–6 prove the rule; this proves the sweep reaches it. Comments are stripped because the
// file documents the old label-only scope verbatim — that history is why it is readable.
const sweep = read('e2e/live-sweep/sweep.mjs');
const sweepCode = sweep
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
check('the comment stripper still holds real code',
  ['export function cityScopeArm', 'export function districtResolutionScope', 'resolveDistrictLabels(']
    .every((s) => sweepCode.includes(s)));
check('assertChain resolves حي labels through districtResolutionScope',
  /resolveDistrictLabels\(req\.p_districts,\s*districtResolutionScope\(/.test(sweepCode),
  'the resolution no longer goes through the shared scope');
check('no hand-built city_ar-only resolution scope survives in the code',
  !/scope\s*\+?=\s*`&city_ar=in\./.test(sweepCode),
  'a label-only scope is being assembled again — that is the defect, restored');
check('dbFilterFromRequest builds its city filter from the same cityScopeArm',
  /const cs = cityScopeArm\(req, cities\)/.test(sweepCode));

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
