// EVERY NUMBER ON THE ADVANCED-FILTER CARD IS DB TRUTH, AND CLICKING IT RETURNS EXACTLY THAT SET —
// ACROSS EVERY PAGE. Proven in a real browser against production.
//
// WHAT THIS EXISTS FOR
// --------------------
// The owner's correctness definition for Advanced Filter is one sentence: «whatever number and option
// AF shows must equal real DB truth, and clicking it must return exactly the correct listings». The
// existing live journeys prove the HEADLINE after a round (verify-af-live-truth.ts) and the pill
// removal path (verify-af-pill-removal-live.ts). Nothing executed against production reads EVERY
// option's pill on EVERY question of a round and asks three independent parties the same question:
//
//    the pill the user sees  ==  the cnt_* column the app was actually handed  ==  an INDEPENDENT
//    PostgREST count of (current search body + that option's predicate) over search_listings_ar
//
// A number that agrees with only two of the three is exactly the defect class this catches: a chip
// wired to the wrong cnt_* column (kitchen showing elevator's count), a count RPC computed over a
// scope that dropped a committed predicate (the 2026-08-20 8.1x district overstatement, the
// 2026-08-23 rating/subtype 8,873-vs-4,946 card), an option whose predicate in apply() is not the
// predicate its count was computed with (the 2026-08-04 «١+» pill promising 1,117 and delivering
// 2,984), a rendered option under the MIN_REAL_OPTION_COUNT floor, an option that cannot narrow, a
// Skip that moves the header chip, a Show More page that dropped or added a predicate between
// pages, a duplicated card across pages, or a second round that forgot the first round's answer.
//
// CONTRACT RULES PROVED (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md)
//   R5.1.1  every rendered option narrows meaningfully: total − count ≥ 0.1·total OR count ≤ 25
//   R5.3.1  no rendered option is backed by fewer than MIN_REAL_OPTION_COUNT = 5 listings
//   R7.1.1  each option's count is the count in the CURRENT eligible set (normal filters + every
//           previously committed AF fact) — proved on round 1 (nothing committed) AND round 2
//   R7.1.2  the header chip shows the count for the current tentative selection
//   R7.4.1  the headline is the true eligible count
//   R7.5.1  headline == RPC total_count == independent oracle, and the ID sets are identical
//   R8.1.1/2 Skip writes zero predicate and leaves the count unchanged, on every question walked
//   R10.1.1 Show More reveals more cards from the SAME eligible set: same predicate on every page,
//           no duplicate card, every fetched card satisfies the predicate
//   §9/§7   a second round's request carries BOTH predicates (AND) and its count is DB truth
//
// THE JOURNEY (defaults: الرياض · الشقق والسكن المشترك · شقة · Buy; env knobs below)
//   1. search → baseline request + total
//   2. open AF; for the first question and, after Skip, for EVERY question of the round: read every
//      rendered option's key and pill, pair the count RPC the app called for this scope, and assert
//      pill == cnt_* == oracle, chip == baseline total, floor, ceiling, usefulness
//   3. fresh load (skipped questions are burned for the session — R8.1.3), same search, open AF,
//      SELECT the smallest-count option on the first question, confirm, skip out → the search that
//      lands must equal the number the user tapped, by count and by ID set
//   4. «عرض المزيد» up to 8 times; every page carries the same predicate, no ID repeats, and every
//      card the user can scroll to is in the oracle set
//   5. answer another question on top → the request carries BOTH predicates and the count is the
//      oracle's count for the conjunction. Preferred: reopen AF (cross-round carry). When the round
//      burned the whole pool (R8.1.3 → R11.2 hides the offer, as it does on a 4-question cohort),
//      it is proved IN-ROUND on a fresh load: answer Q1, then answer Q2 (priced after Q1's fact),
//      then skip out — never a vacuous pass because the offer happened to be gone
//
// The oracle is scripts/lib/afOracleFilter.ts (PostgREST's own filter engine, not our SQL). A body
// it cannot translate makes the case INCONCLUSIVE — reported as SKIP, counted against the exit code,
// never as PASS.
//
// LIVE CHECK — excluded from `npm test` (it drives a real browser against production).

import { chromium } from 'playwright';
import { openAfOffer, type OfferResult } from './lib/afOfferLive.ts';
import { gotoLive } from './lib/liveNav.ts';
import { buildOracleQS, AMENITY_TOKEN_COL } from './lib/afOracleFilter.ts';
import { loadDirectionVariants } from './lib/afOracleLive.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { AGENT_TURN_MS, PACE_BUDGET_MS, PACE_POLL_MS, describeLoad, paceUntilHealthy, readSearchLoad, settleUntil, verdictForNonArrival } from './lib/afJourneyPacing.ts';

const BASE = 'https://ezhalah-app.vercel.app';
const { url: SUPABASE_URL, key: ANON_KEY } = resolvePublicSupabase(process.env);
const H = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

// Scope knobs — one journey covers the desktop Riyadh/Apartment cohort AND the mobile non-Riyadh
// rotation the routine owes every run, instead of near-identical files drifting apart.
const CITY = process.env.AF_OCT_CITY || 'الرياض';
const GROUP = process.env.AF_OCT_GROUP || 'الشقق والسكن المشترك';
const TYPE = process.env.AF_OCT_TYPE || 'شقة';
const DEAL = (process.env.AF_OCT_DEAL || 'buy') as 'buy' | 'rent' | 'rent-monthly';
const MOBILE = process.env.AF_OCT_MOBILE === '1';
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };

// Contract constants, restated here on purpose: this file must fail if PRODUCTION drifts from the
// contract, so it must not import the product's own constants and agree with whatever they became.
const MIN_REAL_OPTION_COUNT = 5;          // R5.3.1
const MEANINGFUL_NARROWING_FRACTION = 0.1; // R5.1.1
const INTERVIEW_STOP_AT = 25;             // R5.1.1 / R11.1
// «عرض المزيد» is served from a 1,500-row page-0 BUFFER (src/data/remote.ts QUERY_LIMIT); a NETWORK
// page (p_offset > 0) only fires once the buffer is spent. So the pagination proof needs a clicked
// option with MORE than PAGE0_BUFFER rows, and up to ceil(1500/100) + 1 clicks to reach the seam.
const PAGE0_BUFFER = 1500;
const MAX_LOAD_MORE_CLICKS = 25;
const FIRST_PAGE = 10;                    // cards shown before any «عرض المزيد»
const BROWSE_BATCH = 100;                 // each «عرض المزيد» reveals to the next 100-boundary
const ID_CAP = 30000;

const AF_PREDICATE_KEYS = [
  'p_bath_min', 'p_bath_exact', 'p_age_min', 'p_age_max', 'p_is_new_construction', 'p_age_unknown',
  'p_amenities', 'p_furnished', 'p_rating_min', 'p_reviews_min', 'p_unit_subtypes',
  'p_street_width_min', 'p_street_width_max', 'p_directions', 'p_rnpl',
];
const AGE_KEYS = ['p_age_min', 'p_age_max', 'p_is_new_construction'];
const SCOPE_KEYS = ['p_cities', 'p_types', 'p_deal', 'p_rent_period', 'p_category'];
// Every non-AF key that narrows a search: a pill click, a confirm or a later page may move NONE of them.
const SCOPE_ALL_KEYS = [...SCOPE_KEYS, 'p_tables', 'p_tables2', 'p_types2', 'p_region_ids', 'p_districts', 'p_platforms',
  'p_price_min', 'p_price_max', 'p_price_min_rent', 'p_price_max_rent', 'p_area_min', 'p_area_max', 'p_beds_exact', 'p_beds_min'];
// Keys that never narrow: paging, ordering, rotation. Everything else on a body is a predicate.
const NON_PREDICATE_KEYS = new Set(['p_limit', 'p_offset', 'p_sort_by', 'p_rotation_seed', 'p_per_platform']);

// THE LABEL THE USER READS, per option key (src/i18n.tsx). A chip whose label says «مصعد» but whose
// key (and therefore count and predicate) is kitchen would pass every numeric check — so the label
// is tied to the key here. Digits are compared script-blind; whitespace-insensitive.
const EXPECTED_LABEL: Record<string, string[]> = {
  kitchen: ['المطبخ', 'مطبخ'], parking: ['مواقف'], elevator: ['مصعد'], ac: ['تكييف'], private_entrance: ['مدخل خاص'],
  maid_room: ['غرفة خادمة'], driver_room: ['غرفة سائق'], car_entrance: ['مدخل سيارة'], sanitation: ['صرف صحي'],
  electricity: ['كهرباء'], water_supply: ['توفر الماء'], furnished: ['مفروش'], rnpl: ['يقبل التقسيط'],
  // The rich residential set certified 2026-08-31 (20260831205347_af_amenity_tokens_residential_
  // rich_set.sql). Labels read from src/i18n.tsx, same as every row above.
  gym: ['صالة رياضية'], pool: ['مسبح'], garden: ['حديقة'], balcony: ['بلكونة'],
  laundry_room: ['غرفة غسيل'], optical_fibers: ['ألياف بصرية'],
  separate_electricity_meter: ['عداد كهرباء مستقل'], separate_water_meter: ['عداد ماء مستقل'],
  '1': ['+1', '1+'], '2': ['+2', '2+'], '3': ['+3', '3+'], '4': ['+4', '4+'],
  '15': ['15 م فأكثر'], '20': ['20 م فأكثر'], '25': ['25 م فأكثر'], '30': ['30 م فأكثر'],
  'شمال': ['شمال'], 'جنوب': ['جنوب'], 'شرق': ['شرق'], 'غرب': ['غرب'],
  'شمال شرق': ['شمال شرق'], 'شمال غرب': ['شمال غرب'], 'جنوب شرق': ['جنوب شرق'], 'جنوب غرب': ['جنوب غرب'],
  yes: ['مفروشة', 'مفروش'], no: ['غير مفروشة'],
  '9.5': ['9.5+'], '9.0': ['9.0+'], '9.0_rc10': ['9.0+ مع 10 تقييمات'],
  'استديو': ['استديو'], 'شقق مخدومة': ['شقة مخدومة'], 'شقة': ['شقة عادية'],
  new: ['جديد'], '1_2': ['1-2 سنوات'], '3_5': ['3-5 سنوات'], '6_9': ['6-9 سنوات'], '10p': ['10 سنوات فأكثر'],
};

// ── OPTION KEY → the cnt_* column the app reads, and the RPC that column lives on ────────────────
type Rpc = 'guided' | 'age';
// THE AMENITY VOCABULARY IS NOT RE-LISTED HERE (2026-09-03). It is derived from the ONE shared map
// in scripts/lib/afOracleFilter.ts, because a hand-kept second copy is exactly how this file broke:
// the rich residential set (gym, pool, garden, balcony, laundry_room, optical_fibers, separate_*_
// meter) was certified on 2026-08-31 and this list did not follow, so five real options failed as
// "unknown key" against a correct production. Every certified token's count column in
// apartment_guided_counts_ar is `cnt_<token>` — verified 2026-09-03 against the live function
// definition for all 20 tokens — so the mapping is a rule, not a list, and CANNOT drift again.
// `rent_now_pay_later` is an ALIAS the clause accepts, never an option key the card renders; the
// card's key is `rnpl`, which is in the map on its own.
const AMENITY_KEYS = new Set(Object.keys(AMENITY_TOKEN_COL).filter((k) => k !== 'rent_now_pay_later'));
const AMENITY_OPTION_COL = Object.fromEntries(
  [...AMENITY_KEYS].map((k) => [k, { rpc: 'guided' as Rpc, col: `cnt_${k}` }]),
);

// A DERIVED VOCABULARY NEEDS A COMPLETE LABEL MAP, AND THE MISMATCH MUST BE LOUD (2026-09-03).
// The count columns now follow the shared token map automatically; EXPECTED_LABEL still cannot,
// because a label is a translation, not a rule. So the two are reconciled HERE, at load, rather
// than per-cohort: an unlabelled token would otherwise pass unnoticed in every scope that happens
// not to render it and fail mysteriously in the one that does — which is precisely how the five
// rich tokens stayed invisible until a جدة villa cohort surfaced them.
const unlabelled = [...AMENITY_KEYS].filter((k) => !EXPECTED_LABEL[k]?.length);
if (unlabelled.length) {
  console.error(`FATAL: certified amenity token(s) with no EXPECTED_LABEL entry: ${unlabelled.join(', ')}.\n` +
    'Add the Arabic label from src/i18n.tsx — the token is filterable, so the card can render it, ' +
    'and an unlabelled token cannot be checked against the label the user actually reads.');
  process.exit(1);
}

const OPTION_COL: Record<string, { rpc: Rpc; col: string }> = {
  ...AMENITY_OPTION_COL,
  '1': { rpc: 'guided', col: 'cnt_bath1' }, '2': { rpc: 'guided', col: 'cnt_bath2' },
  '3': { rpc: 'guided', col: 'cnt_bath3' }, '4': { rpc: 'guided', col: 'cnt_bath4' },
  '15': { rpc: 'guided', col: 'cnt_stw15' }, '20': { rpc: 'guided', col: 'cnt_stw20' },
  '25': { rpc: 'guided', col: 'cnt_stw25' }, '30': { rpc: 'guided', col: 'cnt_stw30' },
  'شمال': { rpc: 'guided', col: 'cnt_dir_n' }, 'جنوب': { rpc: 'guided', col: 'cnt_dir_s' },
  'شرق': { rpc: 'guided', col: 'cnt_dir_e' }, 'غرب': { rpc: 'guided', col: 'cnt_dir_w' },
  'شمال شرق': { rpc: 'guided', col: 'cnt_dir_ne' }, 'شمال غرب': { rpc: 'guided', col: 'cnt_dir_nw' },
  'جنوب شرق': { rpc: 'guided', col: 'cnt_dir_se' }, 'جنوب غرب': { rpc: 'guided', col: 'cnt_dir_sw' },
  yes: { rpc: 'guided', col: 'cnt_furnished' }, no: { rpc: 'guided', col: 'cnt_unfurnished' },
  '9.5': { rpc: 'guided', col: 'cnt_rating95' }, '9.0': { rpc: 'guided', col: 'cnt_rating90' },
  '9.0_rc10': { rpc: 'guided', col: 'cnt_rating90_rc10' },
  'استديو': { rpc: 'guided', col: 'cnt_sub_studio' }, 'شقق مخدومة': { rpc: 'guided', col: 'cnt_sub_serviced' },
  'شقة': { rpc: 'guided', col: 'cnt_sub_regular' },
  new: { rpc: 'age', col: 'cnt_new' }, '1_2': { rpc: 'age', col: 'cnt_1_2' }, '3_5': { rpc: 'age', col: 'cnt_3_5' },
  '6_9': { rpc: 'age', col: 'cnt_6_9' }, '10p': { rpc: 'age', col: 'cnt_10p' },
};
const DIRECTION_KEYS = new Set(['شمال', 'جنوب', 'شرق', 'غرب', 'شمال شرق', 'شمال غرب', 'جنوب شرق', 'جنوب غرب']);
const BATH_KEYS = new Set(['1', '2', '3', '4']);
const STW_KEYS = new Set(['15', '20', '25', '30']);
const SUBTYPE_KEYS = new Set(['استديو', 'شقق مخدومة', 'شقة']);

/** What apply() writes for one option, merged onto the current search body — the predicate whose
 *  count the pill claims to be. Monotone where the product is (bath/street/rating use Math.max;
 *  amenities/directions union; age REPLACES). */
const predicateFor = (key: string, base: any): Record<string, unknown> => {
  if (AMENITY_KEYS.has(key)) return { p_amenities: [...new Set([...(base?.p_amenities ?? []), key])] };
  if (DIRECTION_KEYS.has(key)) return { p_directions: [...new Set([...(base?.p_directions ?? []), key])] };
  if (BATH_KEYS.has(key)) return { p_bath_min: Math.max(Number(key), Number(base?.p_bath_min ?? 0)) };
  if (STW_KEYS.has(key)) return { p_street_width_min: Math.max(Number(key), Number(base?.p_street_width_min ?? 0)) };
  if (SUBTYPE_KEYS.has(key)) return { p_unit_subtypes: [key] };
  if (key === 'yes') return { p_furnished: true };
  if (key === 'no') return { p_furnished: false };
  if (key === '9.5') return { p_rating_min: Math.max(9.5, Number(base?.p_rating_min ?? 0)) };
  if (key === '9.0') return { p_rating_min: Math.max(9, Number(base?.p_rating_min ?? 0)) };
  if (key === '9.0_rc10') return { p_rating_min: Math.max(9, Number(base?.p_rating_min ?? 0)), p_reviews_min: Math.max(10, Number(base?.p_reviews_min ?? 0)) };
  if (key === 'new') return { p_is_new_construction: true, p_age_min: null, p_age_max: null };
  if (key === '1_2') return { p_is_new_construction: null, p_age_min: 1, p_age_max: 2 };
  if (key === '3_5') return { p_is_new_construction: null, p_age_min: 3, p_age_max: 5 };
  if (key === '6_9') return { p_is_new_construction: null, p_age_min: 6, p_age_max: 9 };
  if (key === '10p') return { p_is_new_construction: null, p_age_min: 10, p_age_max: null };
  return {};
};

// ── the check ledger ───────────────────────────────────────────────────────────────────────────
let failures = 0;
let skips = 0;
const failedLabels: string[] = [];
const skippedLabels: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) { failures++; failedLabels.push(label); }
};
/** INCONCLUSIVE is not PASS. A precondition that prevents an assertion is printed as SKIP, counted
 *  against the exit code, and listed in the summary — a check that could not run must not read green. */
const skip = (label: string, reason: string) => {
  console.log(`SKIP  ${label}\n      inconclusive: ${reason}`);
  skips++; skippedLabels.push(label);
};

// ── A UI STATE THAT NEVER ARRIVED IS NOT A MEASUREMENT ─────────────────────────────────────────
// Rationale, reproduction and the exact rule: scripts/lib/afJourneyPacing.ts. In one line — this
// journey used to assert against whatever was on screen when its wait expired, which is how ONE
// missed transition became 47 "product" failures in CI on 2026-09-04. A non-arrival is now a real
// red only when production was healthy while we waited; under a production that is degraded BY ITS
// OWN MEASURE it is NOT EXERCISED — which still fails this run, because `skips` count against the
// exit code below. Nothing here can turn a real failure green.
const loadNow = () => readSearchLoad(SUPABASE_URL, H);
const unobserved = async (label: string, detail: string) => {
  const l = await loadNow();
  if (verdictForNonArrival(l) === 'red') {
    check(label, false, `${detail} · ${describeLoad(l)} — production was NOT degraded, so this is a real failure`);
    return;
  }
  skip(label, `NOT EXERCISED — the awaited state never arrived within ${AGENT_TURN_MS}ms and ${describeLoad(l)}. ` +
    `Production is outside its own safe envelope, so this run cannot tell a slow product from a busy one. ` +
    `${detail}`);
};

const afKeysOn = (body: any): string[] => AF_PREDICATE_KEYS.filter((k) => body?.[k] != null && !(Array.isArray(body[k]) && body[k].length === 0));
const J = (x: unknown) => JSON.stringify(x ?? null);
/** null, undefined and [] all mean "unset" on a request body. */
const JN = (x: unknown) => (x == null || (Array.isArray(x) && x.length === 0) ? 'null' : JSON.stringify(x));
const normLabel = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const EXPECTED_DEAL = DEAL === 'buy' ? 'بيع' : 'إيجار';
const EXPECTED_PERIOD = DEAL === 'buy' ? null : DEAL === 'rent' ? 'سنوي' : 'شهري';

// ── THE LOAD-BEARING PREDICATES, AS PURE FUNCTIONS ──────────────────────────────────────────────
// The journey calls these on what production actually did; the mutation block at the bottom calls
// the SAME functions on deliberately corrupted copies of those artefacts and requires false.
const R = {
  /** pill == the cnt_* column the app was handed. */
  pillMatchesRpc: (displayed: number, row: any, col: string) =>
    Number.isFinite(displayed) && row != null && Number(row[col]) === displayed,
  /** pill == the independent oracle. */
  pillMatchesOracle: (displayed: number, oracle: number | null) =>
    oracle != null && Number.isFinite(displayed) && oracle === displayed,
  /** R5.3.1 */
  clearsFloor: (count: number) => count >= MIN_REAL_OPTION_COUNT,
  /** an option can never promise more than the set it narrows. */
  underCeiling: (count: number, total: number) => count <= total,
  /** R5.1.1 — the usefulness rule, restated from the contract, not imported from the product. */
  narrowsMeaningfully: (count: number, total: number) =>
    total - count >= total * MEANINGFUL_NARROWING_FRACTION || count <= INTERVIEW_STOP_AT,
  /** R8.1.2 / R7.1.2 — the chip equals the number it must equal. */
  chipEquals: (chip: number | null, expected: number | null) =>
    chip != null && expected != null && chip === expected,
  /** R8.1.1 — a request has no AF predicate. */
  noPredicate: (body: any) => afKeysOn(body).length === 0,
  /** the request carries exactly the predicate the tapped option writes, and nothing else. */
  carriesExactly: (body: any, pred: Record<string, unknown>) => {
    const want = Object.entries(pred).filter(([, v]) => v != null).map(([k]) => k).sort();
    const got = afKeysOn(body).sort();
    return J(want) === J(got) && want.every((k) => J(body[k]) === J(pred[k]));
  },
  /** headline == RPC total == oracle. */
  threeWayCount: (headline: number | null, rpc: number | null, oracle: number | null) =>
    headline != null && rpc != null && oracle != null && headline === rpc && rpc === oracle,
  /** R10.1.1 — no card repeats across pages. */
  noDuplicates: (ids: string[]) => new Set(ids).size === ids.length,
  /** R10.1.1 — a later page carries byte-identical scope + AF predicate; only paging may differ. */
  samePredicate: (first: any, page: any) =>
    [...SCOPE_ALL_KEYS, ...AF_PREDICATE_KEYS].every((k) => JN(first?.[k]) === JN(page?.[k])),
  /** INTENDED STATE = REQUEST STATE: the body carries the city/type/deal/period the user chose. */
  scopeIs: (body: any) =>
    J(body?.p_cities) === J([CITY]) && Array.isArray(body?.p_types) && body.p_types.includes(TYPE) &&
    body?.p_deal === EXPECTED_DEAL && JN(body?.p_rent_period) === JN(EXPECTED_PERIOD),
  /** no non-AF narrowing moved between two bodies (a click/confirm/page may only touch AF keys + paging). */
  scopeUntouched: (before: any, after: any) => SCOPE_ALL_KEYS.every((k) => JN(before?.[k]) === JN(after?.[k])),
  /** the label the user reads belongs to the key whose count and predicate the row carries. */
  labelMatchesKey: (key: string, label: string) => {
    const want = EXPECTED_LABEL[key];
    if (!want) return false;
    const got = normLabel(label);
    return want.some((w) => got.includes(normLabel(w)));
  },
  /** every card the user can reach satisfies the predicate. */
  subsetOfOracle: (ids: Iterable<string>, oracle: Set<string>) => [...ids].every((id) => oracle.has(id)),
  /** ID sets identical: missing = extra = duplicates = 0. */
  idSetsIdentical: (rpc: string[], oracle: Set<string>) => {
    const s = new Set(rpc);
    return s.size === rpc.length && s.size === oracle.size && [...oracle].every((id) => s.has(id));
  },
  /** second round: every round-1 predicate survives (arrays ⊇, minimums ≥, booleans =) AND at least
   *  one predicate is new or strictly extended — i.e. the request is the conjunction. */
  carriesBoth: (before: any, after: any) => {
    const b = afKeysOn(before);
    if (!b.length) return false;
    let extended = false;
    for (const k of b) {
      const x = before[k], y = after?.[k];
      if (y == null) return false;
      if (Array.isArray(x)) { if (!x.every((v) => (y as unknown[]).includes(v))) return false; if (y.length > x.length) extended = true; }
      else if (typeof x === 'number') { if (y < x) return false; if (y > x) extended = true; }
      else if (J(x) !== J(y)) return false;
    }
    const added = afKeysOn(after).filter((k) => !b.includes(k));
    return added.length > 0 || extended;
  },
};

// ── browser helpers (verbatim technique from the sibling live journeys) ────────────────────────
const CLICK_LEAF = (txt: string) => {
  let best: any = null;
  document.querySelectorAll('div,span,li,button').forEach((e: any) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc: any = null;
  while (a) {
    const s = getComputedStyle(a);
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; }
    a = a.parentElement;
  }
  if (sc) { const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect(); sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2; }
  else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

/** Every «لقينا N إعلان» headline currently rendered, oldest first. */
const READ_HEADLINES = () => {
  const out: string[] = [];
  document.querySelectorAll('div,span,p').forEach((e: any) => {
    const t = (e.innerText || '').trim();
    if (!/^لقينا\s+[\d,٬٠-٩۰-۹]+\s+إعلان/.test(t)) return;
    if (e.children.length > 2) return;
    if (!out.includes(t)) out.push(t);
  });
  return out;
};

/** The AF card as the user sees it: title, header chip, every option's key + pill. The pill is the
 *  LAST all-digits leaf inside the option (labels like «15 m or wider» carry letters, «1+» a plus). */
const READ_CARD = () => {
  const map = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  const card = document.querySelector('[data-testid="af-card"]');
  if (!card) return { hasCard: false, q: null as string | null, chip: null as number | null, options: [] as { key: string; count: number | null; label: string }[], unknown: null as number | null, hasSkip: false };
  const q = (card.querySelector('[data-testid="af-question-title"]') as any)?.innerText?.trim() ?? null;
  const chipTxt = (card.querySelector('[data-testid="af-count-chip"]') as any)?.innerText ?? null;
  const chip = chipTxt ? parseInt(map(chipTxt).replace(/[^\d]/g, ''), 10) : null;
  const unkTxt = (card.querySelector('[data-testid="af-unknown-count"]') as any)?.innerText ?? null;
  const unknown = unkTxt ? parseInt(map(unkTxt).replace(/[^\d]/g, ''), 10) : null;
  const options = [...card.querySelectorAll('[data-testid^="af-option-"]')].map((e: any) => {
    const key = e.getAttribute('data-testid').slice('af-option-'.length);
    const leaves: string[] = [];
    const walk = (n: any) => { if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) leaves.push(t); } else n.childNodes.forEach(walk); };
    walk(e);
    const pills = leaves.filter((t) => /^[\d٠-٩۰-۹][\d٠-٩۰-۹,٬\s]*$/.test(t));
    const pill = pills.length ? pills[pills.length - 1] : null;
    // The LABEL is every leaf that is neither the pill nor an icon-font glyph (the checkmark renders
    // as a private-use-area character — a non-empty text node with no letter, digit or sign in it).
    const label = leaves.filter((t) => !pills.includes(t) && /[\p{L}\p{N}+]/u.test(t)).join(' ');
    return { key, count: pill ? parseInt(map(pill).replace(/[^\d]/g, ''), 10) : null, label };
  });
  return { hasCard: true, q, chip: Number.isFinite(chip as number) ? chip : null, options, unknown, hasSkip: !!card.querySelector('[data-testid="af-skip"]') };
};
type CardState = ReturnType<typeof READ_CARD>;

/** Rendered result cards on the whole page — counted by their «#N» rank badge. Earlier turns are
 *  static, so a DELTA against a snapshot is the count on the newest turn. */
const COUNT_CARDS = () => {
  let n = 0;
  document.querySelectorAll('div,span').forEach((e: any) => {
    if (e.children.length) return;
    if (/^#[\d٠-٩۰-۹]+$/.test((e.innerText || '').trim())) n++;
  });
  return n;
};

const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[^\d]/g, '');
const headlineNum = (h: string | undefined): number | null => {
  const m = (h ?? '').match(/لقينا\s*([\d,٬٠-٩۰-۹]+)/);
  return m ? Number(digits(m[1])) : null;
};

// ── the independent oracle ─────────────────────────────────────────────────────────────────────
const TYPE_MACROS: Record<string, string> = await (async () => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/known_type_ar?select=type_ar,macro`, { headers: H });
  if (!r.ok) throw new Error(`known_type_ar unreadable (${r.status}) — the oracle cannot apply category purity`);
  return Object.fromEntries((await r.json()).map((x: any) => [x.type_ar, x.macro]));
})();

// DIRECTIONS: the index stores «شمال شرقي» and the RPC normalises both sides, so a literal
// `direction_ar=in.(key)` UNDERCOUNTS. The shared loader (scripts/lib/afOracleLive.ts) reads the
// OBSERVED spellings, maps them by Arabic morphology alone, THROWS on any transport error and
// returns a null map on any unclassified spelling — never a partial map built from an error body.
// With a null map buildOracleQS reports p_directions UNHANDLED and every direction case is a SKIP.
const DIRECTION = await loadDirectionVariants(SUPABASE_URL, H);
console.log(`      [diag] direction_ar domain: ${DIRECTION.observed.join(' | ')}${DIRECTION.map ? '' : ` — ${DIRECTION.strangers} row(s) with an unclassified spelling: direction cases will be refused`}`);

const oracleOpts = () => ({ typeMacros: TYPE_MACROS, ...(DIRECTION.map ? { directionVariants: DIRECTION.map } : {}) });

/** Every read of production must be a READ: an error body is never an empty set. */
const mustOk = async (r: Response, what: string) => {
  if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r;
};

async function oracleCount(body: any, extraQs = ''): Promise<{ count: number | null; unhandled: string[] }> {
  const { qs, unhandled } = buildOracleQS(body, oracleOpts());
  if (unhandled.length) return { count: null, unhandled };
  const r = await mustOk(await fetch(`${SUPABASE_URL}/rest/v1/search_listings_ar?select=listing_id&${qs}${extraQs ? `&${extraQs}` : ''}`,
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }), 'oracle count');
  const cr = r.headers.get('content-range');
  if (!cr?.includes('/')) throw new Error(`oracle count: no content-range total (${cr})`);
  return { count: Number(cr.split('/')[1]), unhandled };
}

async function oracleIds(body: any): Promise<{ ids: Set<string> | null; unhandled: string[] }> {
  const { qs, unhandled } = buildOracleQS(body, oracleOpts());
  if (unhandled.length) return { ids: null, unhandled };
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; off < ID_CAP; off += PAGE) {
    // ORDERED paging — unordered Range paging drops/repeats rows across page boundaries.
    const r = await mustOk(await fetch(`${SUPABASE_URL}/rest/v1/search_listings_ar?select=listing_id,source_table&${qs}&order=source_table.asc,listing_id.asc`,
      { headers: { ...H, Range: `${off}-${off + PAGE - 1}` } }), `oracle page ${off}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`oracle page ${off}: not an array`);
    if (!rows.length) break;
    for (const row of rows) ids.add(`${row.source_table}:${row.listing_id}`);
    if (rows.length < PAGE) break;
  }
  return { ids, unhandled };
}

async function rpcTotal(body: any): Promise<number> {
  const r = await mustOk(await fetch(`${SUPABASE_URL}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, p_per_platform: null, p_limit: 1, p_offset: 0 }),
  }), 'search RPC total');
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('search RPC total: not an array');
  return Number(j[0]?.total_count ?? (j.length === 0 ? 0 : NaN));
}

/** Page the search RPC fully: p_offset in steps of its p_limit. Returns the raw (possibly repeating) list. */
async function rpcIds(body: any, totalHint: number): Promise<string[]> {
  const ids: string[] = [];
  const PAGE = 1000;
  for (let off = 0; off < Math.min(totalHint, ID_CAP); off += PAGE) {
    const r = await mustOk(await fetch(`${SUPABASE_URL}/rest/v1/rpc/location_search_candidates_ar`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, p_per_platform: null, p_limit: PAGE, p_offset: off }),
    }), `search RPC page ${off}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`search RPC page ${off}: not an array`);
    if (!rows.length) break;
    for (const row of rows) ids.push(`${row.source_table}:${row.listing_id}`);
    if (rows.length < PAGE) break;
  }
  return ids;
}

/** At most TWO production requests in flight (the measured knee is 3). */
async function pool2<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } };
  await Promise.all([worker(), worker()]);
  return out;
}

// ── the browser ────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
         ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ssl-version-max=tls1.2'] : [])],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  locale: 'ar-SA',
  viewport: VIEWPORT,
  ...(MOBILE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
});
const page = await ctx.newPage();

// Requests and responses are paired by the request OBJECT, never by RPC name — several
// location_search_candidates_ar / apartment_guided_counts_ar calls are in flight at once during a
// round, and name-matching pairs a body with somebody else's numbers.
type Search = { body: any; total: number | null; rows: string[]; seq: number };
type Count = { rpc: Rpc; body: any; row: any; seq: number };
const searches: Search[] = [];
const counts: Count[] = [];
let seq = 0;
page.on('response', async (r) => {
  const u = r.url();
  if (r.request().method() !== 'POST') return;
  const isSearch = u.includes('/rpc/location_search_candidates_ar');
  const isGuided = u.includes('/rpc/apartment_guided_counts_ar');
  const isAge = u.includes('/rpc/property_age_option_counts_ar');
  if (!isSearch && !isGuided && !isAge) return;
  try {
    const j = await r.json();
    if (!Array.isArray(j)) return;
    const body = JSON.parse(r.request().postData() || '{}');
    if (isSearch) {
      searches.push({ body, total: j.length ? Number(j[0]?.total_count ?? NaN) : 0, rows: j.map((x: any) => `${x.source_table}:${x.listing_id}`), seq: seq++ });
    } else if (j.length) {
      counts.push({ rpc: isGuided ? 'guided' : 'age', body, row: j[0], seq: seq++ });
    }
  } catch { /* a body we could not read is not a request we can assert on */ }
});

const tap = async (txt: string, timeoutMs = 10000) => {
  const until = Date.now() + timeoutMs;
  let box: any = null;
  while (Date.now() < until) {
    box = await page.evaluate(CLICK_LEAF, txt);
    if (box) break;
    await page.waitForTimeout(300);
  }
  if (!box) throw new Error(`control never rendered: ${txt}`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
};
const scrollToBottom = async () => {
  await page.evaluate(() => {
    [...document.querySelectorAll('*')]
      .filter((e: any) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY))
      .forEach((e: any) => { e.scrollTop = e.scrollHeight; });
  });
  await page.waitForTimeout(1200);
};
const readCard = () => page.evaluate(READ_CARD);
/** THE SETTLED READ. `settled:false` means the state was NEVER observed — the returned card is for
 *  diagnostics only and must not be asserted against (see scripts/lib/afJourneyPacing.ts). The
 *  budget is a full AGENT TURN because that is literally what is being awaited: the next card is an
 *  LLM round trip plus a count RPC, not a paint. The old 25s was sized for a render. */
const readCardSettled = (pred: (s: CardState) => boolean, timeoutMs = AGENT_TURN_MS) =>
  settleUntil<CardState>(readCard, pred, timeoutMs, (ms) => page.waitForTimeout(ms));
/** Legacy convenience for reads whose non-arrival is already handled by the caller's own assertion. */
const readCardUntil = async (pred: (s: CardState) => boolean, timeoutMs = AGENT_TURN_MS): Promise<CardState> =>
  (await readCardSettled(pred, timeoutMs)).value;
/** A RESULTS search, selected by SHAPE, never by arrival order: several calls share the RPC name and
 *  complete in any order, so "the newest response" can be a count-style probe or a sibling call.
 *  A results search is page 0 of a real page size; `want` narrows further (e.g. the AF keys it must carry). */
const isResultsSearch = (s: Search) => (s.body?.p_offset ?? 0) === 0 && Number(s.body?.p_limit ?? 0) > 1;
const waitForSearch = async (armed: number, timeoutMs = 40_000, want?: (s: Search) => boolean): Promise<Search | null> => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const cands = searches.slice(armed).filter((s) => isResultsSearch(s) && (!want || want(s)));
    if (cands.length) return cands[cands.length - 1];
    await page.waitForTimeout(400);
  }
  return null;
};
const waitForHeadline = async (total: number | null, timeoutMs = 25_000): Promise<number | null> => {
  const until = Date.now() + timeoutMs;
  let last: number | null = null;
  while (Date.now() < until) {
    const hs: string[] = await page.evaluate(READ_HEADLINES);
    last = headlineNum(hs[hs.length - 1]);
    if (last != null && last === total) return last;
    await page.waitForTimeout(500);
  }
  return last;
};

/** The Filter flow (never the paid AI path): deal → city → group → type → بحث. Returns the search. */
const runBaselineSearch = async (): Promise<Search | null> => {
  const armed = searches.length;
  await gotoLive(page, `${BASE}/`, { timeout: 60000 });
  await page.waitForTimeout(5000);
  // Buy/Rent are two at-least-one toggles with «شراء» pre-selected; «سنوي» is pre-selected and
  // adding «شهري» first gives BOTH, then dropping «سنوي» leaves monthly-only.
  if (DEAL === 'rent') { await tap('إيجار'); await tap('شراء'); }
  if (DEAL === 'rent-monthly') { await tap('إيجار'); await tap('شراء'); await tap('شهري'); await tap('سنوي'); }
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.click('[data-testid="city-input"]');
    await page.fill('[data-testid="city-input"]', '');
    await page.type('[data-testid="city-input"]', CITY, { delay: 60 });
    await tap(CITY).catch(() => {});
    const took = await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 4000 }).catch(() => null);
    if (took) break;
    if (attempt === 3) throw new Error(`the app never confirmed the city ${CITY} after 3 attempts`);
  }
  await tap(GROUP);
  await tap(TYPE);
  await tap('بحث');
  const s = await waitForSearch(armed, 45_000);
  if (s) await waitForHeadline(s.total);
  return s;
};

/** Open the round. A missing offer is reported by the caller — it is either R11 behaving (a SKIP
 *  with the number that explains it) or a defect (a FAIL); this helper only says whether it opened. */
// Shared with the other live journeys — see scripts/lib/afOfferLive.ts for why a fixed 16s poll
// that scrolls only once is not a budget for something behind a paid LLM turn.
let lastOffer: OfferResult | null = null;
const openAF = async (): Promise<boolean> => {
  lastOffer = await openAfOffer(page);
  if (!lastOffer.opened) return false;
  await page.waitForTimeout(2500);
  return true;
};

/** The count RPC the app actually called for THIS card's scope: same normal-filter scope as the
 *  search body, and exactly the committed AF predicates (the age RPC is called age-agnostic, so
 *  age keys are excluded for it). Latest match wins — the app re-fires on every state change. */
const pairCount = (rpc: Rpc, ctxBody: any): Count | null => {
  // EVERY predicate key on either body must agree (paging/ordering keys aside; the age RPC is called
  // age-agnostic, so age keys are excluded for it). Pairing on a narrower key set silently paired a
  // count computed for a different predicate with this card.
  const keysOf = (b: any) => Object.keys(b ?? {}).filter((k) => !NON_PREDICATE_KEYS.has(k) && !(rpc === 'age' && AGE_KEYS.includes(k)));
  const match = counts.filter((c) => c.rpc === rpc &&
    [...new Set([...keysOf(c.body), ...keysOf(ctxBody)])].every((k) => JN(c.body?.[k]) === JN(ctxBody?.[k])));
  return match.length ? match[match.length - 1] : null;
};

type OptionRead = { key: string; count: number | null; label: string; col?: string; rpcVal?: number; oracle?: number | null; unhandled?: string[] };

/**
 * The per-question proof: every rendered option's pill == the cnt_* the app was handed == the
 * oracle for (ctxBody + that option's predicate); chip == ctxTotal; floor; ceiling; usefulness.
 */
const proveQuestion = async (label: string, st: CardState, ctxBody: any, ctxTotal: number | null): Promise<OptionRead[]> => {
  console.log(`\n── ${label}: «${st.q}» · chip=${st.chip} · ${st.options.length} option(s)${st.unknown != null ? ` · unknown=${st.unknown}` : ''} ──`);
  check(`${label}: at least one option rendered (a card with no option is not a question)`, st.options.length > 0);
  check(`${label}: R8.1.2/R7.1.2 — header chip == the current eligible total (nothing selected on this card)`,
    R.chipEquals(st.chip, ctxTotal), `chip=${st.chip} expected=${ctxTotal}`);

  const reads: OptionRead[] = st.options.map((o) => ({ ...o }));
  const tasks = reads.map((o) => async () => {
    const spec = OPTION_COL[o.key];
    if (!spec) return;
    o.col = spec.col;
    const c = pairCount(spec.rpc, ctxBody);
    o.rpcVal = c ? Number(c.row?.[spec.col]) : NaN;
    const body = { ...ctxBody, ...predicateFor(o.key, ctxBody) };
    const { count, unhandled } = await oracleCount(body);
    o.oracle = count; o.unhandled = unhandled;
  });
  await pool2(tasks);

  for (const o of reads) {
    const tag = `${label} · ${o.key}`;
    if (!OPTION_COL[o.key]) { check(`${tag}: option key is one this file knows the column and predicate for`, false, `unknown key «${o.key}» (label «${o.label}») — extend OPTION_COL/predicateFor`); continue; }
    if (o.count == null) { check(`${tag}: a count pill is rendered`, false, `no digits found on the option row (label «${o.label}»)`); continue; }
    const paired = Number.isFinite(o.rpcVal as number);
    if (!paired) {
      check(`${tag}: the count RPC the app called for this scope was captured`, false,
        `no ${OPTION_COL[o.key].rpc} response matched scope ${SCOPE_KEYS.map((k) => `${k}=${J(ctxBody?.[k])}`).join(' ')} + AF ${J(Object.fromEntries(afKeysOn(ctxBody).map((k) => [k, ctxBody[k]])))}; saw ${counts.length} count response(s)`);
    } else {
      check(`${tag}: pill == cnt_* the app was handed (${o.col})`, R.pillMatchesRpc(o.count, { [o.col!]: o.rpcVal }, o.col!), `pill=${o.count} ${o.col}=${o.rpcVal}`);
    }
    if (o.unhandled?.length) skip(`${tag}: pill == independent oracle`, `oracle cannot translate: ${o.unhandled.join(', ')}`);
    else check(`${tag}: pill == independent oracle (search body + ${J(predicateFor(o.key, ctxBody))})`, R.pillMatchesOracle(o.count, o.oracle ?? null), `pill=${o.count} oracle=${o.oracle}`);
    check(`${tag}: the label the user reads belongs to this key`, R.labelMatchesKey(o.key, o.label), `label «${o.label}» expected one of ${J(EXPECTED_LABEL[o.key])}`);
    check(`${tag}: R5.3.1 — clears the MIN_REAL_OPTION_COUNT floor`, R.clearsFloor(o.count), `count=${o.count} floor=${MIN_REAL_OPTION_COUNT}`);
    check(`${tag}: never promises more than the set it narrows`, ctxTotal != null && R.underCeiling(o.count, ctxTotal), `count=${o.count} total=${ctxTotal}`);
    check(`${tag}: R5.1.1 — narrows meaningfully (removes ≥10% or lands ≤25)`, ctxTotal != null && R.narrowsMeaningfully(o.count, ctxTotal), `count=${o.count} total=${ctxTotal} removes=${ctxTotal != null ? ctxTotal - o.count : '?'}`);
  }
  // R7.1.3 — the unknown caption is a number on the card too: it must be the exact count of rows
  // whose source did not state the fact, in the CURRENT search body. The column is implied by the
  // option keys on the card (age buckets → property_age, yes/no → furnished, compass → direction_ar).
  if (st.unknown != null) {
    const keys = st.options.map((o) => o.key);
    const col = keys.some((k) => ['new', '1_2', '3_5', '6_9', '10p'].includes(k)) ? 'property_age'
      : keys.some((k) => k === 'yes' || k === 'no') ? 'furnished'
      : keys.some((k) => DIRECTION_KEYS.has(k)) ? 'direction_ar' : null;
    if (!col) skip(`${label}: R7.1.3 — the unknown caption (${st.unknown}) is the DB's NULL count`, 'this question has no single unknown column');
    else {
      const { count, unhandled } = await oracleCount(ctxBody, `${col}=is.null`);
      if (unhandled.length) skip(`${label}: R7.1.3 — the unknown caption is the DB's NULL count`, unhandled.join(', '));
      else check(`${label}: R7.1.3 — the unknown caption (${st.unknown}) == rows with NULL ${col} in this search`, count === st.unknown, `caption=${st.unknown} db=${count}`);
    }
  }
  return reads;
};

// ── artefacts the mutation block needs ─────────────────────────────────────────────────────────
let baseline: Search | null = null;
let roundOneReads: OptionRead[] = [];
let landed: Search | null = null;
let clickedPred: Record<string, unknown> = {};
let clickedCount: number | null = null;
let landedOracle: number | null = null;
let landedOracleIds: Set<string> | null = null;
let unionIds: string[] = [];
let pageBodies: any[] = [];
let second: Search | null = null;

try {
  console.log(`── scope: ${CITY} · ${GROUP} · ${TYPE} · ${DEAL} · ${MOBILE ? 'MOBILE 390x844' : 'desktop 1440x900'} ──\n`);

  // ── 0. MEASURE THE PRODUCT, NOT THE QUEUE ───────────────────────────────────────────────────
  // This journey is latency work behind a paid agent turn. Starting it while production is outside
  // its own safe envelope measures the queue in front of the database, and every fixed wait below
  // then expires against a card that was simply still coming. Wait (bounded) for production's own
  // signal to clear before touching it; if it never does, the journey still runs and reports what
  // it could not observe — it never invents a pass.
  const startLoad = await paceUntilHealthy(loadNow, (ms) => page.waitForTimeout(ms), PACE_BUDGET_MS, PACE_POLL_MS, (s) => console.log(s));
  console.log(startLoad.degraded
    ? `      [pace] STARTING ANYWAY after ${Math.round(PACE_BUDGET_MS / 60000)}min — ${describeLoad(startLoad)}. ` +
      `Non-arrivals below will be reported NOT EXERCISED rather than as product failures.`
    : `      [pace] production is inside its envelope — ${describeLoad(startLoad)}`);

  // ── 1. the baseline search ──────────────────────────────────────────────────────────────────
  baseline = await runBaselineSearch();
  check('1. the baseline search landed', !!baseline, `${searches.length} search request(s)`);
  if (!baseline) throw new Error('no baseline search — nothing below can be asserted');
  check('1. the baseline search carries NO AF predicate', R.noPredicate(baseline.body), `AF keys: ${afKeysOn(baseline.body).join(', ') || '(none)'}`);
  check(`1. INTENT = REQUEST — the body carries the chosen city/type/deal/period (${CITY} · ${TYPE} · ${EXPECTED_DEAL} · ${EXPECTED_PERIOD ?? '—'})`, R.scopeIs(baseline.body),
    `p_cities=${J(baseline.body.p_cities)} p_types=${J(baseline.body.p_types)} p_deal=${J(baseline.body.p_deal)} p_rent_period=${J(baseline.body.p_rent_period)}`);
  check('1. the direction vocabulary is fully classified (else direction cases are refused, never undercounted)', !!DIRECTION.map, `${DIRECTION.strangers} unclassified row(s); observed ${DIRECTION.observed.join(' | ')}`);
  // predicateFor ↔ OPTION_COL: every key this file knows must write a predicate on an AF key of the
  // SAME family as the column it reads, so the two tables cannot drift apart silently.
  {
    const family = (col: string) => col.startsWith('cnt_bath') ? 'p_bath_min' : col.startsWith('cnt_stw') ? 'p_street_width_min' : col.startsWith('cnt_dir_') ? 'p_directions'
      : col.startsWith('cnt_sub_') ? 'p_unit_subtypes' : col.startsWith('cnt_rating') ? 'p_rating_min' : col === 'cnt_unfurnished' ? 'p_furnished'
      : ['cnt_new', 'cnt_1_2', 'cnt_3_5', 'cnt_6_9', 'cnt_10p'].includes(col) ? (col === 'cnt_new' ? 'p_is_new_construction' : 'p_age_min') : null;
    const drift = Object.entries(OPTION_COL).filter(([key, spec]) => {
      const p = predicateFor(key, {});
      const wrote = Object.entries(p).filter(([, v]) => v != null).map(([k]) => k);
      const fam = family(spec.col) ?? (key === 'yes' ? 'p_furnished' : 'p_amenities');
      return !wrote.includes(fam) || !wrote.every((k) => AF_PREDICATE_KEYS.includes(k));
    }).map(([k]) => k);
    check('1. every option key writes a predicate of the same family as the column it reads (OPTION_COL ↔ predicateFor)', drift.length === 0, `drifted: ${drift.join(', ') || 'none'}`);
  }
  const baseHeadline = await waitForHeadline(baseline.total);
  check('1. R7.4.1 — baseline headline == RPC total_count', baseHeadline != null && baseHeadline === baseline.total, `headline=${baseHeadline} rpc=${baseline.total}`);
  {
    const { count, unhandled } = await oracleCount(baseline.body);
    if (unhandled.length) skip('1. R7.5.1 — baseline total == independent oracle', unhandled.join(', '));
    else check('1. R7.5.1 — baseline total == independent oracle', count === baseline.total, `rpc=${baseline.total} oracle=${count}`);
  }

  // ── 2. every option on every question of the round, walked with Skip ────────────────────────
  const opened = await openAF();
  if (!opened) {
    if ((baseline.total ?? 0) <= INTERVIEW_STOP_AT) skip('2. the AF offer is present', `baseline total ${baseline.total} ≤ ${INTERVIEW_STOP_AT} — R11.1 hides the offer; choose a wider scope`);
    else check('2. the AF offer «خلّنا نحدد الطلب أكثر» is present on a scope of ' + baseline.total, false, 'no offer rendered in 16s');
    throw new Error('AF did not open — the card assertions cannot run');
  }
  const seenQ: string[] = [];
  let roundEnd: Search | null = null;
  let roundClosed = false;
  let roundCardNeverArrived = false;
  for (let step = 1; step <= 8; step++) {
    const r = await readCardSettled((s) => s.hasCard && s.chip != null && s.options.length > 0 && s.options.every((o) => o.count != null));
    const st = r.value;
    // A card that never finished rendering is not "the round refused to walk". Before this, the
    // loop broke here and the two round-level assertions below reported a product failure built on
    // a card nobody ever saw — two of the five CI reds reproduced locally on 2026-09-04.
    if (!r.settled && step === 1) { roundCardNeverArrived = true; break; }
    if (!st.hasCard) break;
    if (st.q && seenQ.includes(st.q)) { check(`2. the round never re-asks a question (${st.q})`, false); break; }
    if (st.q) seenQ.push(st.q);
    const reads = await proveQuestion(`2.Q${step}`, st, baseline.body, baseline.total);
    if (step === 1) roundOneReads = reads;
    // Skip — zero predicate, chip unchanged, next question or round end.
    const armed = searches.length;
    const hasSkip = await page.$('[data-testid="af-skip"]');
    check(`2.Q${step}: the footer offers Skip`, !!hasSkip);
    if (!hasSkip) break;
    await page.click('[data-testid="af-skip"]');
    await page.waitForTimeout(900);
    const nxt = await readCardUntil((s) => !s.hasCard || (s.q !== st.q && s.chip != null) || searches.length > armed);
    if (!nxt.hasCard || searches.length > armed) {
      roundClosed = true;
      roundEnd = await waitForSearch(armed, 8_000);
      break;
    }
    check(`2.Q${step}: R8.1.2 — Skip leaves the header chip unchanged`, R.chipEquals(nxt.chip, st.chip), `before=${st.chip} after=${nxt.chip}`);
  }
  if (roundCardNeverArrived) {
    await unobserved('2. the round walked at least one question',
      'the first AF card of the round never finished rendering its chip and option counts');
    await unobserved('2. skipping every question closed the round',
      'no question was ever presented, so the skip path was never reached');
  } else {
    check('2. the round walked at least one question', seenQ.length >= 1, `questions: ${seenQ.join(' → ') || '(none)'}`);
    // A round where NOTHING was committed closes without a search (finishGuided: `!(q &&
    // ageFlowChangedRef.current)` → the card just closes) — zero predicate, zero re-search, the
    // baseline turn stays. If production DOES re-search, that search must carry no predicate and the
    // same total. Either way the newest headline must still be the baseline number.
    check('2. skipping every question closed the round', roundClosed, 'the card was still open after 8 skips');
    if (roundEnd) {
      check('2. R8.1.1 — the all-skip search carries NO predicate', R.noPredicate(roundEnd.body), `AF keys: ${afKeysOn(roundEnd.body).join(', ') || '(none)'}`);
      check('2. R8.1.2 — the all-skip search total == baseline total', roundEnd.total === baseline.total, `baseline=${baseline.total} after skips=${roundEnd.total}`);
    } else console.log('      [diag] no search fired after the all-skip round — nothing committed, nothing re-searched');
    const hsAfterSkips: string[] = await page.evaluate(READ_HEADLINES);
    check('2. R8.1.2 — after skipping every question the newest headline is still the baseline number',
      R.chipEquals(headlineNum(hsAfterSkips[hsAfterSkips.length - 1]), baseline.total), `headline=${headlineNum(hsAfterSkips[hsAfterSkips.length - 1])} baseline=${baseline.total}`);
  }

  // ── 3. fresh load; SELECT the smallest option on the first question; the landed set ──────────
  // Skipped questions are remembered for the session (R8.1.3), so the round above burned its
  // questions; a fresh load is the honest way back to question 1 rather than a Back on a card that
  // may already be the round's last.
  const base2 = await runBaselineSearch();
  check('3. the second baseline search landed', !!base2 && base2.total === baseline.total, `first=${baseline.total} second=${base2?.total}`);
  if (!base2) throw new Error('no second baseline');
  const opened2 = await openAF();
  check('3. the AF offer is present again on a fresh load', opened2);
  if (!opened2) throw new Error('AF did not open on the second load');
  const q1 = await readCardUntil((s) => s.hasCard && s.chip != null && s.options.length > 0 && s.options.every((o) => o.count != null));
  console.log(`      [diag] first question on load 1: «${seenQ[0]}» · on load 2: «${q1.q}»`);
  const q1reads = await proveQuestion('3.Q1', q1, base2.body, base2.total);
  check('3. INTENT = REQUEST on the second load', R.scopeIs(base2.body) && R.scopeUntouched(baseline.body, base2.body));
  const eligible = q1reads.filter((o) => o.count != null && o.count >= MIN_REAL_OPTION_COUNT && OPTION_COL[o.key]);
  // The clicked option must be LARGER than the page-0 buffer or «عرض المزيد» never leaves the buffer
  // and the pagination proof is vacuous; prefer the largest such option, else the smallest real one.
  const overBuffer = eligible.filter((o) => o.count! > PAGE0_BUFFER).sort((a, b) => (b.count! - a.count!));
  const target = overBuffer[0] ?? eligible.sort((a, b) => (a.count! - b.count!))[0];
  const paginationPossible = !!overBuffer.length;
  check('3. a real (≥5) option exists to click', !!target, target ? `clicking «${target.key}» (${target.label}) = ${target.count}${paginationPossible ? ` (> ${PAGE0_BUFFER}: a network page is reachable)` : ''}` : 'no rendered option at or above the floor');
  if (!target) throw new Error('nothing to click');
  clickedPred = predicateFor(target.key, base2.body);
  clickedCount = target.count!;
  await page.click(`[data-testid="af-option-${target.key}"]`);
  const afterSelect = await readCardUntil((s) => s.chip != null && s.chip !== q1.chip);
  check('3. R7.1.2 — after selecting, the header chip == the option\'s own pill (tentative count)', R.chipEquals(afterSelect.chip, clickedCount), `chip=${afterSelect.chip} pill=${clickedCount}`);
  const armed3 = searches.length;
  await page.click('[data-testid="af-confirm"]');
  await page.waitForTimeout(1200);
  for (let hop = 0; hop < 8 && searches.length === armed3; hop++) {
    const open = await page.evaluate(() => !!document.querySelector('[data-testid="af-card"]'));
    if (!open) break;
    const sk = await page.$('[data-testid="af-skip"]');
    if (!sk) break;
    await sk.click();
    await page.waitForTimeout(1200);
  }
  landed = await waitForSearch(armed3, 40_000, (s) => afKeysOn(s.body).length > 0);
  check('3. confirming the answer produced a search', !!landed);
  if (!landed) throw new Error('no search after confirm');
  check(`3. the request carries EXACTLY the tapped option's predicate ${J(clickedPred)}`, R.carriesExactly(landed.body, clickedPred),
    `AF on request: ${afKeysOn(landed.body).map((k) => `${k}=${J(landed!.body[k])}`).join(', ') || '(none)'}`);
  check('3. the confirm moved NO non-AF narrowing (city/type/deal/period/tables/budget/area/beds untouched)', R.scopeUntouched(base2.body, landed.body),
    SCOPE_ALL_KEYS.filter((k) => JN(base2.body[k]) !== JN(landed!.body[k])).map((k) => `${k}: ${J(base2.body[k])} → ${J(landed!.body[k])}`).join(' · ') || 'identical');
  check('3. R7.1.1 — landed RPC total == the pill the user tapped', landed.total === clickedCount, `tapped=${clickedCount} rpc=${landed.total}`);
  const landedHeadline = await waitForHeadline(landed.total);
  {
    const { count, unhandled } = await oracleCount(landed.body);
    landedOracle = count;
    if (unhandled.length) skip('3. R7.5.1 — headline == RPC total == oracle', unhandled.join(', '));
    else check('3. R7.5.1 — headline == RPC total == independent oracle == tapped pill', R.threeWayCount(landedHeadline, landed.total, count) && count === clickedCount,
      `headline=${landedHeadline} rpc=${landed.total} oracle=${count} pill=${clickedCount}`);
    if (!unhandled.length) {
      const [rIds, o] = await Promise.all([rpcIds(landed.body, landed.total ?? 0), oracleIds(landed.body)]);
      landedOracleIds = o.ids;
      const rSet = new Set(rIds);
      check('3. both ID sets are COMPLETE before they are diffed (paged RPC set and oracle set both equal total_count)',
        rSet.size === landed.total && o.ids?.size === landed.total, `rpc=${rSet.size} oracle=${o.ids?.size} total=${landed.total}`);
      const missing = o.ids ? [...o.ids].filter((id) => !rSet.has(id)) : [];
      const extra = o.ids ? [...rSet].filter((id) => !o.ids!.has(id)) : [];
      const dupes = rIds.length - rSet.size;
      check('3. R7.5.1 — clicking returns EXACTLY the oracle set: MISSING=0 EXTRA=0 DUPES=0', !!o.ids && R.idSetsIdentical(rIds, o.ids),
        `rpc=${rIds.length} oracle=${o.ids?.size} missing=${missing.length} extra=${extra.length} dupes=${dupes}${missing.length || extra.length ? ` sample missing=${missing.slice(0, 3).join(',')} extra=${extra.slice(0, 3).join(',')}` : ''}`);
    }
  }

  // ── 4. PAGINATION under the AF predicate ────────────────────────────────────────────────────
  // Page 0 fetches up to 1,500 matching candidates; each «عرض المزيد» reveals the buffer to the next
  // 100-boundary and only fetches a NEW page (p_offset > 0) once the buffer is spent. So the cards a
  // user can scroll to are exactly: page-0 rows ∪ every load-more page's rows — the union asserted
  // here — and the DOM is asserted to reveal from that set and nothing else.
  // Snapshot the badge count once the landed turn's first page has finished dripping in: the
  // newest turn already shows min(total, FIRST_PAGE) cards, so "revealed" adds that back.
  let cardsBefore: number = await page.evaluate(COUNT_CARDS);
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(700); const n: number = await page.evaluate(COUNT_CARDS); if (n === cardsBefore) break; cardsBefore = n; }
  const alreadyShown = Math.min(landed.total ?? 0, FIRST_PAGE);
  const armed4 = searches.length;
  let clicks = 0;
  let revealed = 0;
  let lastRevealCheckOk = true;
  // Click until a NETWORK page (p_offset > 0) has fired — that is the only click that proves R10.1.1
  // — or until the button is gone / the cap is hit. Past the seam one more click is enough.
  let networkPageSeen = false;
  for (let i = 0; i < MAX_LOAD_MORE_CLICKS; i++) {
    if (networkPageSeen) break;
    await scrollToBottom();
    const btns = await page.$$('[data-testid="results-load-more"]');
    const btn = btns[btns.length - 1];
    if (!btn) break;
    const shownBefore: number = await page.evaluate(COUNT_CARDS);
    await btn.click();
    clicks++;
    const until = Date.now() + 15_000;
    let shown = shownBefore;
    while (Date.now() < until) {
      await page.waitForTimeout(600);
      const now: number = await page.evaluate(COUNT_CARDS);
      const stillBusy = await page.evaluate(() => { const b = document.querySelector('[data-testid="results-load-more"]') as any; return !!b && (b.getAttribute('aria-disabled') === 'true' || b.disabled === true); });
      if (now > shownBefore && now === shown && !stillBusy) break;
      shown = now;
    }
    revealed = shown - cardsBefore + alreadyShown;
    const expected = Math.min(landed.total ?? 0, BROWSE_BATCH * clicks);
    lastRevealCheckOk = lastRevealCheckOk && revealed === expected;
    networkPageSeen = searches.slice(armed4).some((s) => Number(s.body?.p_offset ?? 0) > 0);
    console.log(`      [diag] load-more click ${clicks}: revealed ${revealed} card(s) on the newest turn (expected ${expected})${networkPageSeen ? ' — a network page fired' : ''}`);
  }
  const pages = searches.slice(armed4).filter((s) => Number(s.body?.p_offset ?? 0) > 0);
  pageBodies = pages.map((p) => p.body);
  unionIds = [...landed.rows, ...pages.flatMap((p) => p.rows)];
  check('4. R10.1.1 — «عرض المزيد» was exercised (the button was there to click)', clicks > 0 || (landed.total ?? 0) <= FIRST_PAGE,
    clicks ? `${clicks} click(s), ${pages.length} network page(s) fired (p_offset ${pages.map((p) => p.body.p_offset).join(',') || '— buffer served every click'})` : `no button and total=${landed.total} > ${FIRST_PAGE}`);
  // THE NETWORK PAGE IS THE POINT. Below the buffer every click is served from page 0 and nothing
  // about "the same predicate on every page" is exercised — so that case is a loud SKIP, not a PASS.
  if (paginationPossible) {
    check(`4. R10.1.1 — a NETWORK page (p_offset > 0) actually fired after ${clicks} click(s) on a ${landed.total}-row set`, pages.length > 0,
      pages.length ? `p_offset ${pages.map((p) => p.body.p_offset).join(',')}` : `no p_offset > 0 request within ${MAX_LOAD_MORE_CLICKS} clicks`);
  } else skip('4. R10.1.1 — a NETWORK page (p_offset > 0) fired', `no option on Q1 exceeds the ${PAGE0_BUFFER}-row buffer in this scope (largest ${eligible[eligible.length - 1]?.count ?? '?'}); the page-continuity assertions cannot be exercised here`);
  for (const [i, pb] of pageBodies.entries()) {
    check(`4. R10.1.1 — page ${i + 1} (p_offset=${pb.p_offset}) carries the SAME whole predicate as page 0 (only paging differs)`, R.samePredicate(landed.body, pb) && R.scopeIs(pb),
      [...SCOPE_ALL_KEYS, ...AF_PREDICATE_KEYS].filter((k) => JN(landed!.body[k]) !== JN(pb[k])).map((k) => `${k}: ${J(landed!.body[k])} → ${J(pb[k])}`).join(' · ') || 'identical');
  }
  if (clicks > 0) {
    check('4. R10.1.1 — every click revealed exactly to the next 100-boundary (or the end of the set)', lastRevealCheckOk && revealed === Math.min(landed.total ?? 0, BROWSE_BATCH * clicks),
      `revealed=${revealed} total=${landed.total} clicks=${clicks}`);
  }
  check('4. R10.1.1 — the cards the user can reach never exceed what was fetched', revealed <= unionIds.length, `revealed=${revealed} fetched=${unionIds.length}`);
  check('4. R10.1.1 — no card repeats across pages (union of every fetched page has no duplicate ID)', R.noDuplicates(unionIds), `${unionIds.length} row(s), ${new Set(unionIds).size} distinct`);
  if (landedOracleIds) {
    const off = unionIds.filter((id) => !landedOracleIds!.has(id));
    check('4. R10.1.1 — every fetched card satisfies the predicate (union ⊆ oracle set)', R.subsetOfOracle(unionIds, landedOracleIds), off.length ? `${off.length} outside the oracle, sample ${off.slice(0, 3).join(',')}` : `${unionIds.length} ⊆ ${landedOracleIds.size}`);
  } else skip('4. R10.1.1 — every fetched card satisfies the predicate (union ⊆ oracle set)', 'the oracle could not translate the landed body');
  if ((landed.total ?? 0) > unionIds.length) {
    console.log(`      [note] total ${landed.total} exceeds the ${unionIds.length} rows ${clicks} click(s) reached — the page assertions above cover what was fetched`);
  }

  // ── 5. another answer on top: the request must be the CONJUNCTION ──────────────────────────
  // Preferred path: reopen AF after round 1 (the cross-round carry). On a 4-question pool the full
  // round above burned every question (R8.1.3), so the offer is legitimately gone (R11.2) — the
  // conjunction is then proved IN-ROUND on a fresh load: answer Q1 as before, and instead of
  // skipping Q2 answer it too. Q2's pills are computed AFTER Q1's fact (R7.1.1's second half), so
  // that path proves strictly more than the reopen path, not less. Neither path may pass vacuously.
  const pickAndCommit = async (label: string, ctxBody: any, ctxTotal: number | null, skipOut: boolean) => {
    const cr = await readCardSettled((s) => s.hasCard && s.chip != null && s.options.length > 0 && s.options.every((o) => o.count != null));
    if (!cr.settled) {
      // The chip is the card's own claim about the eligible total, and it arrives with a count RPC.
      // Asserting `chip == ctxTotal` against a card whose chip never rendered reports the harness's
      // impatience as a product defect — CI 2026-09-04 printed exactly that: "chip=null expected=10625".
      await unobserved(`${label}: R8.1.2/R7.1.2 — header chip == the current eligible total (nothing selected on this card)`,
        `card=${cr.value.hasCard} question=«${cr.value.q}» chip=${cr.value.chip} options=${cr.value.options.length}`);
      return null;
    }
    const card = cr.value;
    const reads = await proveQuestion(label, card, ctxBody, ctxTotal);
    const el = reads.filter((o) => o.count != null && o.count >= MIN_REAL_OPTION_COUNT && OPTION_COL[o.key]);
    // WHICH OPTION TO CLICK (corrected 2026-09-03). The narrowest option is the sharpest proof, but
    // when this step must be FOLLOWED by another question (`!skipOut`), the narrowest is often the
    // wrong pick: R4.3.1/R11.1 say AF legitimately STOPS at ≤ INTERVIEW_STOP_AT results, so an
    // option landing on, say, 13 correctly ends the interview and fires the search — and the old
    // unconditional "confirming advanced to a DIFFERENT question" then failed a production that had
    // just obeyed the contract. Measured live 2026-09-03 (جدة/فيلا): «غرفة سائق» = 13, AF stopped,
    // 4 checks went red against correct behaviour. So: when a Q2 is required, take the narrowest
    // option that still leaves MORE than INTERVIEW_STOP_AT; only fall back to the global narrowest
    // when the step is allowed to end the interview.
    const byCount = (a: typeof el[number], b: typeof el[number]) => a.count! - b.count!;
    const keepsGoing = el.filter((o) => o.count! > INTERVIEW_STOP_AT);
    const t = (skipOut ? el : keepsGoing).sort(byCount)[0];
    if (!skipOut && !t) {
      // Not a failure of the product: this cohort has no option that both clears the ≥5 floor and
      // leaves >25 behind, so a second in-round question cannot exist to be proved. Reporting that
      // honestly is the rule (PART 7, "never fake green"); passing it silently would be worse.
      skip(`${label}: a real (≥5) option exists to click`,
        `NOT EXERCISED — every option at or above the floor lands at or below INTERVIEW_STOP_AT ` +
        `(${INTERVIEW_STOP_AT}), so R11.1 ends the interview and there is no Q2 to prove here. ` +
        `Options offered: ${el.map((o) => `${o.key}=${o.count}`).join(', ') || '(none)'}`);
      return null;
    }
    check(`${label}: a real (≥5) option exists to click`, !!t, t ? `clicking «${t.key}» (${t.label}) = ${t.count}` : 'no rendered option at or above the floor');
    if (!t) return null;
    const pred = predicateFor(t.key, ctxBody);
    await page.click(`[data-testid="af-option-${t.key}"]`);
    const sel = await readCardUntil((s) => s.chip != null && s.chip !== card.chip);
    check(`${label}: R7.1.2 — after selecting, the header chip == the option's own pill`, R.chipEquals(sel.chip, t.count!), `chip=${sel.chip} pill=${t.count}`);
    const armed = searches.length;
    await page.click('[data-testid="af-confirm"]');
    await page.waitForTimeout(1200);
    if (!skipOut) {
      // Q2 must be proved on Q2's card: wait until the question TITLE changes (rankQuestions is a
      // network round trip), or the proof below would read Q1's card a second time.
      const nx = await readCardSettled((s) => s.hasCard && s.q !== card.q && s.chip != null && s.options.length > 0 && s.options.every((o) => o.count != null));
      if (!nx.settled) {
        // THE 45-FAILURE BUG. This used to fall through and let the caller prove Q2 against a card
        // still showing Q1 — every option's pill compared to an oracle that assumed Q1's answer was
        // committed. Measured in CI 2026-09-04: driver_room pill=13 vs oracle=6, balcony 176 vs 22,
        // maid_room 40 of 40 "removes=0" — all of them Q1's own numbers. Returning null abandons the
        // Q2 proof instead of inventing it.
        await unobserved(`${label}: confirming advanced to a DIFFERENT question`,
          `still on «${nx.value.q}» after committing «${t.key}» (${t.count})`);
        return null;
      }
      check(`${label}: confirming advanced to a DIFFERENT question`, true, `was «${card.q}», now «${nx.value.q}»`);
      return { req: null, pill: t.count!, pred, armed };
    }
    for (let hop = 0; hop < 8 && searches.length === armed; hop++) {
      const open = await page.evaluate(() => !!document.querySelector('[data-testid="af-card"]'));
      if (!open) break;
      const sk = await page.$('[data-testid="af-skip"]');
      if (!sk) break;
      await sk.click();
      await page.waitForTimeout(1200);
    }
    const want = Object.entries(pred).filter(([, v]) => v != null).map(([k]) => k);
    return { req: await waitForSearch(armed, 40_000, (s) => want.every((k) => s.body?.[k] != null)), pill: t.count!, pred, armed };
  };

  let prevBody: any = null; let prevTotal: number | null = null; let step5: Awaited<ReturnType<typeof pickAndCommit>> = null;
  const opened5 = await openAF();
  if (opened5) {
    console.log('      [diag] the offer is back after round 1 — proving the conjunction across rounds');
    prevBody = landed.body; prevTotal = landed.total;
    step5 = await pickAndCommit('5.Q1 (round 2)', prevBody, prevTotal, true);
  } else {
    console.log(`      [diag] no offer after round 1 (total ${landed.total}; the round burned its questions, R8.1.3/R11.2) — proving the conjunction IN-ROUND on a fresh load`);
    const base3 = await runBaselineSearch();
    check('5. the third baseline search landed', !!base3 && base3.total === baseline.total, `first=${baseline.total} third=${base3?.total}`);
    if (!base3) throw new Error('no third baseline');
    const opened3 = await openAF();
    check('5. the AF offer is present on the fresh load', opened3);
    if (!opened3) throw new Error('AF did not open on the third load');
    const first = await pickAndCommit('5.Q1', base3.body, base3.total, false);
    if (first) {
      // The card advanced to Q2 without a search; Q2 is priced after Q1's committed fact.
      check('5. answering Q1 advanced the card without firing a search', searches.length === first.armed, `${searches.length - first.armed} search(es) fired`);
      prevBody = { ...base3.body, ...first.pred }; prevTotal = first.pill;
      step5 = await pickAndCommit('5.Q2 (after Q1 committed)', prevBody, prevTotal, true);
    }
  }
  second = step5?.req ?? null;
  // `step5 === null` means an earlier step ALREADY reported why the conjunction could not be built
  // (a card that never rendered, or a commit that never advanced — each already classified against
  // production's own load signal). Re-reporting it here as "no search landed" would state a second,
  // wronger reason for one cause, and would turn a NOT EXERCISED into a product failure.
  if (step5 === null) {
    skip('5. the conjunction produced a search',
      'NOT EXERCISED — the second answer was never reached; see the reason reported on the step above');
  } else
  check('5. the conjunction produced a search', !!second, second ? '' : 'no search landed after the second answer');
  if (second && step5 && prevBody) {
    check('5. the request carries BOTH predicates (the earlier answer AND the new one)', R.carriesBoth(prevBody, second.body),
      `earlier: ${afKeysOn(prevBody).map((k) => `${k}=${J(prevBody[k])}`).join(', ')} · request: ${afKeysOn(second.body).map((k) => `${k}=${J(second!.body[k])}`).join(', ')}`);
    check(`5. the new predicate is the tapped option's ${J(step5.pred)}`, Object.entries(step5.pred).every(([k, v]) => v == null ? second!.body[k] == null : J(second!.body[k]) === J(v)),
      Object.entries(step5.pred).map(([k, v]) => `${k}: want ${J(v)} got ${J(second!.body[k])}`).join(' · '));
    check('5. R7.1.1 — the conjunction\'s RPC total == the pill the user tapped (priced after the earlier fact)', second.total === step5.pill, `tapped=${step5.pill} rpc=${second.total}`);
    check('5. the second answer moved NO non-AF narrowing', R.scopeUntouched(prevBody, second.body) && R.scopeIs(second.body),
      SCOPE_ALL_KEYS.filter((k) => JN(prevBody[k]) !== JN(second!.body[k])).map((k) => `${k}: ${J(prevBody[k])} → ${J(second!.body[k])}`).join(' · ') || 'identical');
    const h2 = await waitForHeadline(second.total);
    const { count, unhandled } = await oracleCount(second.body);
    if (unhandled.length) skip('5. R7.5.1 — conjunction: headline == RPC total == oracle', unhandled.join(', '));
    else check('5. R7.5.1 — conjunction: headline == RPC total == independent oracle', R.threeWayCount(h2, second.total, count), `headline=${h2} rpc=${second.total} oracle=${count}`);
    check('5. the conjunction narrowed or held (AND can never widen)', second.total != null && prevTotal != null && second.total <= prevTotal, `before=${prevTotal} after=${second.total}`);
  }

  // ── MUTATION PROOFS ────────────────────────────────────────────────────────────────────────
  // Each takes the REAL captured artefacts, breaks exactly the property one assertion protects, and
  // requires that assertion to return false. Values are DERIVED from the capture, never hard-coded,
  // so a "mutation" can never coincide with the real value and prove nothing.
  console.log('\n── MUTATION PROOFS (each must turn the paired assertion RED) ──');
  const mut = (label: string, ok: boolean, detail = '') => check(`MUTATION — ${label}`, ok, detail);
  const real = roundOneReads.find((o) => o.count != null && Number.isFinite(o.rpcVal as number) && o.oracle != null) ?? null;
  if (!real) skip('MUTATION — the option-count proofs', 'no option with a paired RPC value and an oracle count was captured');
  else {
    const row = { [real.col!]: real.rpcVal };
    mut(`a pill off by one (${real.count}→${real.count! + 1}) is caught by pillMatchesRpc`, !R.pillMatchesRpc(real.count! + 1, row, real.col!));
    mut('a pill off by one is caught by pillMatchesOracle', !R.pillMatchesOracle(real.count! + 1, real.oracle!));
    // A wrong column: pick a REAL sibling column on the same captured row whose value differs.
    const c = pairCount(OPTION_COL[real.key].rpc, baseline.body);
    const other = c ? Object.keys(c.row).find((k) => k.startsWith('cnt_') && k !== real.col && Number(c.row[k]) !== real.count) : undefined;
    if (!other) skip('MUTATION — a chip wired to the wrong cnt_* column is caught by pillMatchesRpc', 'every other cnt_* on the captured row equals this pill');
    else mut(`a chip wired to the wrong column (${real.col}→${other}) is caught by pillMatchesRpc`, !R.pillMatchesRpc(real.count!, c!.row, other), `${other}=${c!.row[other]} vs pill ${real.count}`);
  }
  mut('a rendered option below the floor is caught by clearsFloor', !R.clearsFloor(MIN_REAL_OPTION_COUNT - 1));
  mut('an option promising more than the total is caught by underCeiling', !R.underCeiling((baseline.total ?? 0) + 1, baseline.total ?? 0));
  // narrowsMeaningfully is pure: prove it on fixed totals so a small scope can never turn these into a false red.
  mut('an option that removes nothing (count == total) is caught by narrowsMeaningfully', !R.narrowsMeaningfully(1000, 1000));
  mut('an option removing 9% of a >25 set is caught by narrowsMeaningfully (910 of 1000)', !R.narrowsMeaningfully(910, 1000) && R.narrowsMeaningfully(900, 1000));
  mut('a chip that moved on Skip is caught by chipEquals', !R.chipEquals((baseline.total ?? 0) + 1, baseline.total));
  mut('a skip that wrote a predicate is caught by noPredicate', !R.noPredicate({ ...baseline.body, ...clickedPred }));
  mut('a body whose city moved is caught by scopeIs', !R.scopeIs({ ...baseline.body, p_cities: [...(baseline.body.p_cities ?? []), '__not_a_city__'] }));
  mut('a body whose deal flipped is caught by scopeIs', !R.scopeIs({ ...baseline.body, p_deal: baseline.body.p_deal === 'بيع' ? 'إيجار' : 'بيع' }));
  mut('a confirm that moved a non-AF key (p_tables) is caught by scopeUntouched', !R.scopeUntouched(baseline.body, { ...baseline.body, p_tables: ['__moved__'] }));
  mut('a swapped label (kitchen row reading «مصعد») is caught by labelMatchesKey', !R.labelMatchesKey('kitchen', 'مصعد') && R.labelMatchesKey('kitchen', 'المطبخ'));
  mut('a count body that differs in ONE AF key does not pair (pairCount)', (() => {
    const c = counts.find((x) => x.rpc === 'guided');
    return !!c && pairCount('guided', { ...c.body, p_bath_min: 99 }) !== c;
  })());
  if (landed) {
    const k = afKeysOn(landed.body)[0];
    mut('a request that dropped the tapped predicate is caught by carriesExactly', k != null && !R.carriesExactly({ ...landed.body, [k]: null }, clickedPred));
    mut('a request that added an uncommitted predicate is caught by carriesExactly', !R.carriesExactly({ ...landed.body, p_rating_min: 4 }, clickedPred));
    mut('a headline off by one is caught by threeWayCount', !R.threeWayCount((landed.total ?? 0) + 1, landed.total, landed.total));
    if (unionIds.length) mut('a duplicated card across pages is caught by noDuplicates', !R.noDuplicates([...unionIds, unionIds[0]]));
    const later = { ...landed.body, p_offset: 1500, [k]: null };
    mut(`a later page that dropped ${k} is caught by samePredicate`, k != null && !R.samePredicate(landed.body, later));
    mut('a later page whose city moved is caught by samePredicate', !R.samePredicate(landed.body, { ...landed.body, p_offset: 1500, p_cities: ['__elsewhere__'] }));
    mut('a later page that differs ONLY in paging is accepted by samePredicate', R.samePredicate(landed.body, { ...landed.body, p_offset: 1500, p_limit: 1500 }));
    if (landedOracleIds) {
      mut('a fetched card outside the predicate is caught by subsetOfOracle', !R.subsetOfOracle([...unionIds, '__not_in_oracle__:0'], landedOracleIds));
      const withPhantom = [...landedOracleIds, '__phantom__:0'];
      mut('an EXTRA id is caught by idSetsIdentical', !R.idSetsIdentical(withPhantom, landedOracleIds));
      const first = [...landedOracleIds][0];
      if (first) mut('a MISSING id is caught by idSetsIdentical', !R.idSetsIdentical([...landedOracleIds].slice(1), landedOracleIds));
      if (first) mut('a DUPLICATE id is caught by idSetsIdentical', !R.idSetsIdentical([...landedOracleIds, first], landedOracleIds));
    }
    mut('a second round that forgot round 1 is caught by carriesBoth', !R.carriesBoth(landed.body, { ...landed.body, [k]: null, p_rating_min: 4 }));
    mut('a second round that added nothing is caught by carriesBoth', !R.carriesBoth(landed.body, { ...landed.body }));

    // REAL-RPC mutations: the DB-truth claims are only worth anything if the backend is sensitive to
    // the body. Drop the tapped predicate and require BOTH the RPC and the oracle to answer
    // differently from the number the pill promised.
    const loosened = { ...landed.body, [k]: null };
    const lt = await rpcTotal(loosened);
    check(`MUTATION — dropping ${k} from the body really changes the backend's total (RPC)`, Number.isFinite(lt) && lt !== landed.total, `with: ${landed.total} · without: ${lt}`);
    const { count: lo, unhandled } = await oracleCount(loosened);
    if (unhandled.length) skip(`MUTATION — dropping ${k} really changes the oracle's count`, unhandled.join(', '));
    else check(`MUTATION — dropping ${k} from the oracle body really changes the oracle's count`, lo != null && lo !== landedOracle, `with: ${landedOracle} · without: ${lo}`);
  }
} catch (e: any) {
  check('the journey completed without a harness error', false, e?.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e));
} finally {
  await ctx.close();
  await browser.close();
}

const bad = failures + skips;
console.log(bad
  ? `\n✗ ${failures} check(s) FAILED, ${skips} SKIPPED (inconclusive):\n` +
    failedLabels.map((l) => `    • FAIL ${l}`).concat(skippedLabels.map((l) => `    • SKIP ${l}`)).join('\n') + '\n'
  : '\n✓ every number on the AF card is DB truth, clicking it returns exactly that set, and every page keeps the predicate\n');
process.exit(bad ? 1 : 0);
