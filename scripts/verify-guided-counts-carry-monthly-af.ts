// THE GUIDED-COUNT RPC MUST CARRY EVERY ANSWERED ADVANCED-FILTER QUESTION.
//
// THE DEFECT THIS EXISTS TO PREVENT (found live 2026-08-23, Monthly Rent)
// -----------------------------------------------------------------------
// `fetchApartmentGuidedCounts()` is the single count source behind the whole Advanced Filter card:
// `cnt_selected` is the header pill AND the green «عرض N نتيجة» footer, and `cnt_*` are the per-option
// pills on every later question. Its call site spread the advanced params ONE BY ONE, as a hand-copied
// list. The three Monthly params added on 2026-08-18 — p_rating_min / p_reviews_min / p_unit_subtypes —
// were added to the RPC, to the search path, and to rpcAdvancedFilterParams(), but never to that list.
//
// So the RPC computed every number over a scope that ignored the rating and unit-subtype answers.
// Measured live on الرياض / إيجار / شهري / شقة (2026-08-23):
//     answer «9.5+»  → card kept promising 8,873 · truth 4,946
//     next question  → offered «استديو / 3,719» · truth 2,361
//     user taps «عرض النتائج» → the SEARCH applies both and lands them on 2,361.
// Every number in the flow was a lie except the one the user could no longer act on. This is the
// exact class the design contract forbids: "an option's count is exactly what Search returns if picked".
//
// The fix is the ONE shared definition (rpcAdvancedFilterParams) instead of a hand-copied list, so a
// future advanced question is carried by this surface for free.
//
// WHAT THIS BARRIER ASSERTS
//   A. SOURCE (hermetic) — the two count-RPC call sites carry every advanced param, either by
//      spreading rpcAdvancedFilterParams(q) or by naming each one. Catches the omission itself.
//   B. LIVE — the params still BITE server-side, and the guided-count row equals what Search returns:
//        cnt_selected(rating)        == search total(rating)        and != base   (it narrows)
//        cnt_sub_studio(rating)      == search total(rating+studio)               (option promise)
//      A source check alone would stay green if the RPC quietly stopped honouring a param.
//
//   node --experimental-strip-types scripts/verify-guided-counts-carry-monthly-af.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const root = join(import.meta.dirname, '..');
// Comments are stripped before any source check below: the call site this guards is documented with
// a comment that NAMES the missing params, so prose alone would satisfy every `includes()` and the
// barrier would pass on the re-broken code. (Proved by mutation — it did, until this line existed.)
// Full-line form only, exactly like the other AF barriers' codeOnly(), so a URL in a string literal
// is never mangled.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nGuided-count RPCs must carry every answered Advanced-Filter question\n');

// ── A. SOURCE ────────────────────────────────────────────────────────────────────────────────────
const remote = codeOnly(readFileSync(join(root, 'src/data/remote.ts'), 'utf8'));

// Brace-match the object literal passed to supabase.rpc('<fn>', { … }) so a param named in some
// OTHER function can never satisfy a check about this one.
function rpcArgs(fn: string): string | null {
  const at = remote.indexOf(`.rpc('${fn}', {`);
  if (at < 0) return null;
  const start = remote.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < remote.length; i++) {
    if (remote[i] === '{') depth++;
    else if (remote[i] === '}' && --depth === 0) return remote.slice(start, i + 1);
  }
  return null;
}

const helperBody = remote.match(/export function rpcAdvancedFilterParams\(q: SearchQuery\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
check('rpcAdvancedFilterParams() — the ONE shared definition — exists', helperBody.length > 0);

// Every advanced predicate location_search_candidates_ar applies BEYOND the normal filter. A count
// surface that omits one overstates the moment that question is answered.
const ADVANCED_PARAMS = [
  'p_amenities', 'p_bath_min', 'p_furnished', 'p_street_width_min', 'p_directions',
  'p_rating_min', 'p_reviews_min', 'p_unit_subtypes',
];

for (const fn of ['apartment_guided_counts_ar', 'property_age_option_counts_ar']) {
  const args = rpcArgs(fn);
  check(`${fn} call site found in src/data/remote.ts`, !!args);
  if (!args) continue;
  // Spreading the shared helper carries the whole set; naming each param carries it too. Anything
  // else is the hand-copied list that drifted.
  //
  // 2026-08-25: property_age_option_counts_ar spreads the same helper through `ageAgnostic()`, which
  // deletes ONLY the three age params that RPC is itself pricing (passing them collapses every
  // non-selected bucket to 0 — verified live). Every ADVANCED_PARAM below still rides along, which is
  // the property this file is about, so the wrapped spread counts as the spread. The failure detail
  // this barrier printed on that shape already told the reader to "spread ...rpcAdvancedFilterParams(q)
  // instead" — which the code now does; only the recogniser was behind.
  // verify-property-age-counts-amenities-param.ts pins the wrapper's exact deletion list, so it can
  // never widen into the drift this check exists to catch.
  const viaHelper = /\.\.\.(?:ageAgnostic\()?rpcAdvancedFilterParams\(q\)\)?/.test(args);
  const effective = viaHelper ? args + helperBody : args;
  for (const p of ADVANCED_PARAMS) {
    check(`    ${fn} carries ${p}`, effective.includes(p),
      viaHelper ? 'spread of rpcAdvancedFilterParams(q) no longer carries it'
                : `hand-listed params at this call site omit ${p} — spread ...rpcAdvancedFilterParams(q) instead`);
  }
}

// ── B. LIVE ──────────────────────────────────────────────────────────────────────────────────────
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

console.log(failures === 0
  ? '\n✓ verify-guided-counts-carry-monthly-af: all checks passed.'
  : `\n❌ verify-guided-counts-carry-monthly-af: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
