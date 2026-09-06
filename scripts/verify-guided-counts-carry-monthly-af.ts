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
//   B. LIVE — SPLIT OUT on 2026-09-06 into verify-guided-counts-carry-monthly-af-live.ts (routine
//      #10, ops_incident #104). A source check alone would stay green if the RPC quietly stopped
//      honouring a param, so that half must exist — but it can only answer by asking production,
//      and `npm test` is the REQUIRED status check on every PR, whose verdict must depend only on
//      the diff. Four checks in that suite were measured flipping on UNCHANGED code on 2026-09-06.
//      NO per-PR coverage was lost: A is the half that catches the defect IN A DIFF (the hand-copied
//      param list drifting away from rpcAdvancedFilterParams), and it is now mutation-proven below
//      rather than merely present. B runs on af-live-truth-check.yml — daily, and immediately after
//      every production deploy — and this file asserts, by EXECUTION, that the home really invokes it.
//
//   node --experimental-strip-types scripts/verify-guided-counts-carry-monthly-af.ts   (wired into `npm test`)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';

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

// THE PREDICATE, as a pure function so the mutation proof below exercises the REAL rule rather than
// a copy of it. Spreading the shared helper carries the whole set; naming each param carries it too.
// Anything else is the hand-copied list that drifted — which is the defect.
export const spreadsHelper = (args: string) =>
  /\.\.\.(?:ageAgnostic\()?rpcAdvancedFilterParams\(q\)\)?/.test(args);

export function missingParams(args: string, helper: string, params: string[]): string[] {
  const effective = spreadsHelper(args) ? args + helper : args;
  return params.filter((p) => !effective.includes(p));
}

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
  const viaHelper = spreadsHelper(args);
  for (const p of ADVANCED_PARAMS) {
    check(`    ${fn} carries ${p}`, missingParams(args, helperBody, [p]).length === 0,
      viaHelper ? 'spread of rpcAdvancedFilterParams(q) no longer carries it'
                : `hand-listed params at this call site omit ${p} — spread ...rpcAdvancedFilterParams(q) instead`);
  }
}


// ── THE LIVE HALF (B) MUST STILL RUN SOMEWHERE ──────────────────────────────────────────────────
// A split must not be able to decay into a deletion: "moved to a workflow" and "quietly removed"
// look identical from inside the suite unless something asserts otherwise. liveHalfProblems() is
// EXECUTED against the real registry and the real workflow file — never a string match, the shape
// that left two checks homed only by a workflow COMMENT for weeks on 2026-09-03.
const LIVE = 'verify-guided-counts-carry-monthly-af-live.ts';
const ROOT = root;
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── MUTATION PROOF — the real predicate, against call sites that must be caught ─────────────────
console.log('\n  mutation proof — missingParams(), against drifted call sites\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};
const HELPER = 'p_amenities, p_bath_min, p_furnished, p_street_width_min, p_directions, p_rating_min, p_reviews_min, p_unit_subtypes';

// M-1: EXACTLY the 2026-08-23 defect — a hand-listed call site missing the three Monthly params.
mustCatch('THE 2026-08-23 SHAPE: a hand-copied list missing p_rating_min/p_reviews_min/p_unit_subtypes',
  missingParams('{ p_amenities, p_bath_min, p_furnished, p_street_width_min, p_directions }', HELPER,
    ADVANCED_PARAMS).length === 3);
// M-2: a single dropped param is still the defect — the list drifts one entry at a time.
mustCatch('a hand-copied list missing exactly ONE advanced param',
  missingParams('{ p_amenities, p_bath_min, p_furnished, p_street_width_min, p_directions, p_rating_min, p_reviews_min }',
    HELPER, ADVANCED_PARAMS).join() === 'p_unit_subtypes');
// M-3: THE REGRESSION THAT WOULD FAKE A PASS — the spread is still written, but the shared helper
// itself stopped carrying a param. The `viaHelper ? args + helper` branch exists precisely so the
// helper's own contents are checked; without it, the spread would launder any omission.
mustCatch('the spread is present but rpcAdvancedFilterParams() itself dropped a param',
  missingParams('{ ...rpcAdvancedFilterParams(q) }', 'p_amenities, p_bath_min', ADVANCED_PARAMS).length > 0);
// M-4: the ageAgnostic() wrapper must still count as the spread — a recogniser that stops seeing it
// would report a false failure on correct code, which is how a barrier gets ignored.
mustCatch('the ageAgnostic(rpcAdvancedFilterParams(q)) wrapper still counts as the spread',
  spreadsHelper('{ ...ageAgnostic(rpcAdvancedFilterParams(q)) }') === true);
// The negative controls — a predicate red for everything is as useless as one green for everything.
mustCatch('a call site that spreads the complete helper is NOT reported as broken',
  missingParams('{ ...rpcAdvancedFilterParams(q) }', HELPER, ADVANCED_PARAMS).length === 0);
mustCatch('a call site that names every param explicitly is NOT reported as broken',
  missingParams(`{ ${HELPER} }`, '', ADVANCED_PARAMS).length === 0);

if (mutFail > 0) failures += mutFail;

console.log(failures === 0
  ? '\n✓ verify-guided-counts-carry-monthly-af: the source contract holds, and its live half still runs.'
  : `\n❌ verify-guided-counts-carry-monthly-af: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
