// THE GUIDED-COUNT RPC MUST CARRY EVERY ANSWERED ADVANCED-FILTER QUESTION — LIVE HALF (B).
//
// Split out of verify-guided-counts-carry-monthly-af.ts on 2026-09-06 (routine #10, ops_incident
// #104). That file always declared two halves in its own header — «A. SOURCE (hermetic)» and
// «B. LIVE» — and this is B, unchanged. A stays in the required `npm test`, because A is the half
// that catches the defect IN A DIFF: the hand-copied param list at the call site drifting away from
// rpcAdvancedFilterParams(). B asserts that production still agrees, which is a fact about
// production, not about the diff — and `npm test` is the REQUIRED status check on every PR, whose
// verdict must depend only on the diff.
//
// THE DEFECT BOTH HALVES EXIST FOR (found live 2026-08-23, Monthly Rent). fetchApartmentGuidedCounts()
// is the single count source behind the whole Advanced Filter card: cnt_selected is the header pill
// AND the green «عرض N نتيجة» footer, and cnt_* are the per-option pills on every later question. Its
// call site spread the advanced params ONE BY ONE, as a hand-copied list, and the three Monthly params
// added on 2026-08-18 — p_rating_min / p_reviews_min / p_unit_subtypes — never reached it. Measured on
// الرياض / إيجار / شهري / شقة:
//     answer «9.5+»  → card kept promising 8,873 · truth 4,946
//     next question  → offered «استديو / 3,719» · truth 2,361
//     user taps «عرض النتائج» → the SEARCH applies both and lands them on 2,361.
// Every number in the flow was a lie except the one the user could no longer act on.
//
// WHY THE LIVE HALF IS STILL NEEDED, AND WHY IT IS NOT THE PR GATE. A source check alone would stay
// green if the RPC quietly stopped honouring a param — so this half must exist. But it can only
// answer by asking production, so it runs on af-live-truth-check.yml (daily, plus immediately after
// every production deploy) with the other AF live differentials.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { rpcProbeOutcome, outcomeIsUsable } from './lib/liveHalf.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nGuided-count RPCs still carry every answered Advanced-Filter question, server-side (LIVE)\n');

// الرياض / إيجار / شهري / شقة — the cohort the defect was found in, and the only scope with enough
// rated Gathern inventory for a rating answer to mean anything.
const { url: URL_BASE, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const SCOPE = {
  p_deal: 'إيجار', p_rent_period: 'شهري', p_cities: ['الرياض'], p_region_ids: [1],
  p_category: 'Residential', p_types: ['شقة', 'مبنى شقق مخدومة', 'ملحق علوي'],
};
const RATING = { p_rating_min: 9.5 };
const STUDIO = { p_unit_subtypes: ['استديو'] };

async function rpc(fn: string, extra: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: H, body: JSON.stringify({ ...SCOPE, ...extra }),
  });
  return r.json();
}
const guided = async (extra: Record<string, unknown>) => (await rpc('apartment_guided_counts_ar', extra))?.[0] ?? null;
const searchTotal = async (extra: Record<string, unknown>) => {
  const j = await rpc('location_search_candidates_ar', { ...extra, p_per_platform: null, p_limit: 1, p_offset: 0 });
  return Array.isArray(j) ? (j.length ? Number(j[0].total_count) : 0) : null;
};

const [gBase, gRating, tBase, tRating, tRatingStudio] = await Promise.all([
  guided({}), guided(RATING), searchTotal({}), searchTotal(RATING), searchTotal({ ...RATING, ...STUDIO }),
]);

// Fails CLOSED: an RPC that did not answer is a FAILURE, never "nothing to report" (AGENTS.md: A
// FAILED FETCH IS NOT AN EMPTY ANSWER).
check('live: the guided-count RPC answered', !!gBase && !!gRating,
  `base=${JSON.stringify(gBase)?.slice(0, 120)} rating=${JSON.stringify(gRating)?.slice(0, 120)}`);

if (gBase && gRating) {
  // The test must be able to bite: if a rating answer no longer narrows this scope, agreement below
  // proves nothing. (Same reasoning as verify-af-independent-oracle's "can bite" assertion.)
  check('live: p_rating_min actually narrows this scope (the check can bite)',
    Number(gBase.cnt_selected) > Number(gRating.cnt_selected),
    `base cnt_selected=${gBase.cnt_selected} rating cnt_selected=${gRating.cnt_selected}`);

  check('live: cnt_selected(base) == search total(base)',
    Number(gBase.cnt_selected) === tBase, `${gBase.cnt_selected} vs ${tBase}`);

  // THE DEFECT, server-side half: the footer/header number under a rating answer.
  check('live: cnt_selected(rating) == search total(rating)',
    Number(gRating.cnt_selected) === tRating, `${gRating.cnt_selected} vs ${tRating}`);

  // THE DEFECT, option-count half: the next question's «استديو» pill must promise what picking it
  // returns WITH the rating answer still applied — 2,361, not the un-narrowed 3,719.
  check('live: cnt_sub_studio(rating) == search total(rating + استديو)',
    Number(gRating.cnt_sub_studio) === tRatingStudio, `${gRating.cnt_sub_studio} vs ${tRatingStudio}`);
  check('live: the استديو option count really is narrowed by the rating answer',
    Number(gRating.cnt_sub_studio) < Number(gBase.cnt_sub_studio),
    `rating=${gRating.cnt_sub_studio} base=${gBase.cnt_sub_studio}`);
}

// ── MUTATION PROOF — the fail-closed rule, which is what a LIVE half can actually get wrong ─────
// The SOURCE contract this file's offline half enforces is mutation-proven there, against real
// drifted call sites. What only THIS half can get wrong is the class AGENTS.md names as the repo's
// largest: a request that FAILED rendered as a confident negative. Both shapes are proven here —
// the RPC-level outcome rule, and the "the RPC answered" gate that decides whether the comparisons
// below are allowed to run at all.
console.log('\n  mutation proof — an RPC that did not answer must never read as agreement\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};
// The gate this file actually applies before comparing anything: `if (gBase && gRating)`.
const answered = (base: unknown, rating: unknown) => !!base && !!rating;
mustCatch('a NULL guided-count row treated as an answer (every comparison below would be skipped silently)',
  answered(null, { cnt_selected: 1 }) === false);
mustCatch('both rows null — the shape a total outage produces',
  answered(null, null) === false);
mustCatch('...and two real rows ARE an answer (the negative control)',
  answered({ cnt_selected: 10 }, { cnt_selected: 4 }) === true);
// The transport-level rule, shared with every other split live half.
mustCatch('HTTP 500 (statement timeout) treated as usable data',
  outcomeIsUsable(rpcProbeOutcome(500)) === false);
mustCatch('HTTP 401 (a rotated anon key) treated as usable data',
  outcomeIsUsable(rpcProbeOutcome(401)) === false);
mustCatch('a 200 IS usable (a rule red for everything guards nothing)',
  outcomeIsUsable(rpcProbeOutcome(200)) === true);

if (mutFail > 0) failures += mutFail;

console.log(failures === 0
  ? '\n✓ verify-guided-counts-carry-monthly-af-live: all checks passed.'
  : `\n❌ verify-guided-counts-carry-monthly-af-live: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
