// EVERY VISIBLE FILTER CONTROL MUST ACTUALLY FILTER.
//
// Owner, 2026-08-10:
//   "A question must never appear if selecting it does nothing.
//    Every visible Advanced Filter control must map to a real backend predicate,
//    real count path, and real results path."
//
// THE DEFECT THIS LOCKS OUT. The guided interview offered «Pool» and «Gym» for months. Neither had a
// slug in AMENITY_TOKEN, so picking one was echoed back in the user's own chat bubble and then applied
// NO constraint whatsoever — the search silently broadened. The 2026-08-10 source audit closed the
// question: only sanadak publishes them and it publishes an explicit NO on 184/184 listings, so
// `pool is true` matches zero rows fleet-wide. Both were removed.
//
// A control is only legitimate when all THREE paths exist:
//   1. results  — the slug is in location_search_candidates_ar's p_amenities vocabulary
//   2. count    — apartment_guided_counts_ar returns the cnt_* the chip's count() reads
//   3. UI       — the control is actually rendered
//
// ── THIS FILE IS THE HERMETIC HALF (split 2026-09-12, routine #10, ops_incident #126) ────────────
//
// Until 2026-09-12 this was ONE file, and it was one of five checks measured (2026-09-06) as deciding
// its verdict in the REQUIRED `npm test` by reaching production. `npm test` gates every PR, so a
// check that cannot answer without asking production fails UNRELATED diffs.
//
// But the placement was not the whole defect. Measured 2026-09-12, by execution:
//
//     EZHALAH_SUPABASE_URL="https://127.0.0.1:9" node --experimental-strip-types \
//       scripts/verify-ui-controls-have-predicates.ts
//   → 14 assertions that read ONLY committed source never executed.
//
// They sat inside `if (Array.isArray(registry) && registry.length) { … }`, and they included the
// TEETH of the owner's 2026-08-11 boundary rule — "the scope prefix never writes Normal-Filter
// 'bedrooms' / 'priceMin' / 'location' / …" — which read `src/lib/afPlan.ts` and nothing else. So a
// momentary production blip took the owner-boundary guard dark, and a PR that violated that rule in
// afPlan.ts would have been reported as `TypeError: fetch failed`. That is coverage reading as
// protection while protecting nothing (docs/ops/BARRIER_ENGINEER.md PART 1) — and the tempting
// "fix", making the network half tolerant, would have taken those 14 dark permanently.
//
// So: every assertion that reads only committed source is here, ungated, and runs on every PR. The
// LIVE registry read is verify-ui-controls-have-predicates-live.ts, homed in
// .github/workflows/af-live-truth-check.yml. Both halves apply the SAME predicate
// (scripts/lib/uiControlPredicates.ts) — never a copy — and §6 below proves BY EXECUTION both that
// the live half is really invoked by its declared home and that the shared predicate catches every
// disagreement shape it is responsible for.
//
// NO per-PR coverage was LOST: the assertions that moved are exactly the ones that could not answer
// from the diff, the predicate deciding them is mutation-proven here on every PR, and 14 assertions
// that previously DID NOT RUN whenever production was unreachable now always do.
//
//   node --experimental-strip-types scripts/verify-ui-controls-have-predicates.ts   (in `npm test`)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import {
  INTERVIEW_FIELDS, REGISTRY_KEY, amenityChipKeys, registryPayload, registryProblems,
} from './lib/uiControlPredicates.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'the predicate did NOT report this defect');

console.log('\nEvery visible filter control must map to a real predicate + count path\n');

const advanced  = read('src/data/advancedFilters.ts');
const remote    = read('src/data/remote.ts');
const interview = read('src/app/interview.tsx');

// ── the authoritative slug vocabulary, DERIVED from the clause ────────────────────────────────
// An UNKNOWN token matches nothing by design, so a guessed slug silently zeroes every result.
//
// This used to be a hand-maintained literal "copied from location_search_candidates_ar". Copies go
// stale: by 2026-09-01 production certified 22 tokens and this list still held 14, so the eight
// added on 08-31 (gym, pool, garden, balcony, laundry_room, optical_fibers,
// separate_electricity_meter, separate_water_meter) were outside the vocabulary this check enforces
// — a chip using one would have been reported as an invented slug. Read the real thing instead.
//
// sql/mirrors/af_eligibility_clause.sql is byte-exact with the deployed clause and is kept fresh by
// verify-sql-mirrors-not-stale.ts, so this stays offline. Same parsing idiom as
// verify-af-multiselect-combining-semantics.ts, which already proved it.
const clauseSql = read('sql/mirrors/af_eligibility_clause.sql');
const vocabMatch = clauseSql.match(/where tok not in \(([^)]*)\)/);
if (!vocabMatch) {
  console.log('  FAIL  could not read the amenity vocabulary from sql/mirrors/af_eligibility_clause.sql');
  process.exit(1);                       // FAIL CLOSED: deleting the mirror must not disarm the check
}
const RESULTS_SLUGS = new Set([...vocabMatch[1].matchAll(/''([a-z_]+)''/g)].map((m) => m[1]));
if (RESULTS_SLUGS.size < 12) {
  console.log(`  FAIL  amenity vocabulary parsed as only ${RESULTS_SLUGS.size} tokens — parse miss, not a real shrink`);
  process.exit(1);                       // a silently-empty Set would make every slug check vacuous
}

// The chip keys come from the SHARED derivation both halves use, so the live half can never end up
// judging a different set of chips than this one certifies.
const chipKeys = amenityChipKeys(advanced);
check('found the amenity-bearing question blocks', chipKeys.length > 0);

// ── 1. every amenity chip's key is a real results slug ──────────────────────────────────────────
check('amenity questions declare the expected chips', chipKeys.length >= 6, `found ${chipKeys.length}: ${chipKeys.join(', ')}`);
for (const key of chipKeys) {
  check(`chip '${key}' is a real p_amenities slug`, RESULTS_SLUGS.has(key),
    `not in location_search_candidates_ar's vocabulary — an unknown token matches nothing by design, so the chip would silently zero every result`);
}

// ── 2. every chip's count() reads a field its counts type actually declares ─────────────────────
// Chips read GuidedCounts; the age question reads AgeOptionCounts. Accept either, but the field
// must exist somewhere — otherwise the chip renders a live count of `undefined`.
const typeSlice = (name: string) => {
  const i = remote.indexOf(`export type ${name}`);
  if (i < 0) return '';
  // slice to the type's own closing `};` — a fixed window silently truncates as the type grows
  // (bit 2026-08-18: the six Monthly count fields fell outside the old 1,200-char cap).
  const end = remote.indexOf('\n};', i);
  return remote.slice(i, end < 0 ? i + 1200 : end + 3);
};
const declaredCountFields = typeSlice('GuidedCounts') + typeSlice('AgeOptionCounts');
const countFields = [...advanced.matchAll(/count:\s*\(c\)\s*=>\s*c\.(cnt_[a-z0-9_]+)/g)].map((m) => m[1]);
for (const f of new Set(countFields)) {
  check(`count field '${f}' is declared on a counts type`, new RegExp(`\\b${f}\\s*:`).test(declaredCountFields),
    'the chip would render a live count the RPC never returns (undefined -> NaN)');
}

// ── 3. every amenity the INTERVIEW offers maps to a slug ─────────────────────────────────────────
// This is the exact Pool/Gym failure: an option offered, echoed back, and mapped to nothing.
const tokenBlock = interview.slice(interview.indexOf('const AMENITY_TOKEN'), interview.indexOf('const AMENITY_TOKEN') + 500);
const mapped = new Set([...tokenBlock.matchAll(/'?([A-Za-z ]+?)'?\s*:\s*'([a-z_]+)'/g)].map((m) => m[1].trim()));
const mappedSlugs = [...tokenBlock.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]);

// Generous span: the option list sits behind a long explanatory comment block.
const amenityOptsMatch = interview.match(/title:\s*'Must-have amenities\?'[\s\S]{0,3000}?opts:\s*\[([^\]]+)\]/);
check('found the interview amenity option list', !!amenityOptsMatch);

if (amenityOptsMatch) {
  const offered = [...amenityOptsMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)]
    .map((m) => (m[1] ?? m[2]).trim())
    .filter((o) => o && !/doesn't matter/i.test(o));
  check('interview offers at least one amenity', offered.length > 0);
  for (const opt of offered) {
    check(`interview option '${opt}' maps to an amenity slug`, mapped.has(opt),
      `offered to the user but absent from AMENITY_TOKEN — picking it would apply NO constraint and silently broaden the search (this is the Pool/Gym bug)`);
  }
  // and the slugs it maps to must themselves be real
  for (const slug of mappedSlugs) {
    check(`interview slug '${slug}' is a real p_amenities slug`, RESULTS_SLUGS.has(slug),
      'an unknown token matches nothing by design and would zero every result');
  }
}

// ── 4. controls we deliberately retired must not creep back ──────────────────────────────────────
// THE REASON CHANGED AGAIN, THE RULE DID NOT (restated 2026-09-02). 2026-09-01's wording — "no
// cnt_pool / cnt_gym exists, so the chip could not carry a count" — stops being true the moment
// 20260902220000 lands: both tokens get a cnt_* column inside the scoped CTE and a CARD chip
// (AMENITIES_QUESTION, cohort-gated). What this check guards is a different surface: the INTERVIEW's
// four-option amenity list (src/app/agent.tsx). That list is owner-scoped; growing it is an interview
// decision with its own certification (verify-af-interview-*), never a side effect of a card chip
// landing. So Pool/Gym stay out of the interview's option list until the owner scopes them in there.
for (const dead of ['Pool', 'Gym']) {
  const offeredAgain = amenityOptsMatch ? new RegExp(`'${dead}'`).test(amenityOptsMatch[1]) : false;
  check(`'${dead}' is not offered as an amenity option`, !offeredAgain,
    `the interview's amenity option list is owner-scoped (4 options); '${dead}' reaching it is an ` +
    `interview decision with its own certification, not a side effect of the card chip — scope it in deliberately.`);
}

// ── 5. THE SOURCE-ONLY HALF OF THE BOUNDARY RULE ────────────────────────────────────────────────
// Everything in this section reads committed source and NOTHING else. Until 2026-09-12 all of it sat
// behind the live registry fetch, so it did not run whenever production was unreachable. The tier
// lookups that genuinely need the registry are in the live half; these are the teeth.

// deed_location_text specifically: prose must never become a predicate anywhere.
const deedInUi = /deed_location_text/.test(advanced) || /deed_location_text/.test(interview);
check('deed_location_text never reaches the filter UI (it is prose, not a predicate)', !deedInUi,
  'a free-text title-deed description cannot be a filter, and must never be parsed into '
  + 'district/street/coordinates — those are separate facts with their own sources');

// Every interview question the boundary rule governs still exists in the pool. (The registry decides
// its TIER; that this file names a question that is actually shipped is a source fact.)
for (const qid of Object.keys(INTERVIEW_FIELDS)) {
  check(`interview question '${qid}' exists in the pool`, new RegExp(`id: '${qid}'`).test(advanced));
}

// ── 5b. THE 2026-08-23 CARVE-OUT (owner) — property GROUP + TYPE, and NOTHING else ───────────────
// The interview resolves CATEGORY → GROUP → TYPE before asking a certified question (see
// docs/ADVANCED_FILTER_DESIGN_CONTRACT.md «Amendment 2026-08-23»). Scope dimensions have never had
// af_field_registry rows — that registry lists listing ATTRIBUTE fields — so the tier check in the
// live half cannot see them, and omitting them here would let the boundary rule silently stop
// covering the interview at exactly the moment it grew. These assertions are that coverage: the
// interview may ask these two scope ids and NO other piece of Normal-Filter territory.
const AUTHORIZED_SCOPE_IDS = ['property_group', 'property_type'];
const scopeIds = [...advanced.matchAll(/id: (SCOPE_[A-Z_]+_ID)/g)].map((m) => m[1]);
check('the scope pool declares exactly TWO scope questions', scopeIds.length === 2,
  `found ${scopeIds.length}: ${scopeIds.join(', ')}`);
const planSrc = read('src/lib/afPlan.ts');
for (const id of AUTHORIZED_SCOPE_IDS)
  check(`scope id '${id}' is the owner-authorized one, declared in afPlan.ts`,
    new RegExp(`SCOPE_(GROUP|TYPE)_ID = '${id}'`).test(planSrc));
check('afPlan ships EXACTLY the two authorized scope tiers — no third tier crept in',
  /SCOPE_QUESTION_IDS = \[SCOPE_GROUP_ID, SCOPE_TYPE_ID\] as const/.test(planSrc));
// The teeth: no Normal-Filter dimension other than group/type may be asked by the interview.
for (const banned of ['bedrooms', 'priceInput', 'priceMin', 'priceMax', 'areaMin', 'areaMax', 'location', 'districts', 'deal', 'rentPeriod'])
  check(`the scope prefix never writes Normal-Filter '${banned}'`,
    !new RegExp(`\\b${banned}\\b`).test(planSrc),
    `afPlan.ts must only ever write typeGroups/types/type — found '${banned}'`);

// ── 6. THE LIVE HALF STILL RUNS, AND THE SHARED PREDICATE STILL BITES ───────────────────────────
// "Moved out of npm test" and "silently deleted" look identical from inside the suite, so the split
// is only safe while this executes.
const LIVE = 'verify-ui-controls-have-predicates-live.ts';
const liveProblems = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (bare) => existsSync(join(ROOT, 'scripts', bare)),
  (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; } },
);
check(`the LIVE half (${LIVE}) is homed in a workflow that actually invokes it`,
  liveProblems.length === 0, liveProblems.join('\n      '));

// ── 6b. MUTATION PROOFS over registryProblems() — the predicate the live half's verdict comes from.
// This is the half that moved, so this is where the proof has to be. Before 2026-09-12 this barrier
// carried NO mutation proof at all and sat on scripts/mutation-proof-grandfathered.txt: nobody had
// ever watched it fail. Each proof feeds the REAL shared function a registry shaped like the defect
// it is responsible for, and the last two are the negative controls — without them a predicate that
// is red for everything would read as perfect coverage.
console.log('\n  mutation proof — the shared registry predicate, fed each disagreement it must catch\n');

const CHIPS = ['kitchen', 'parking', 'elevator', 'ac', 'private_entrance', 'maid_room'];
// Shaped like what production actually stores, under the names production uses: every chip described,
// every interview field 'advanced', bedrooms 'normal'. A proof that invents its own vocabulary proves
// nothing (docs/ops/BARRIER_ENGINEER.md PART 3, R1 technique 5).
const healthy = (): Array<Record<string, unknown>> => [
  ...CHIPS.map((k) => ({ canonical_key: REGISTRY_KEY[k] ?? k, ui_exposed: true, not_exposed_reason: null, filter_tier: 'advanced' })),
  ...Object.values(INTERVIEW_FIELDS).flat().map((k) => ({ canonical_key: k, ui_exposed: true, not_exposed_reason: null, filter_tier: 'advanced' })),
  { canonical_key: 'bedrooms', ui_exposed: true, not_exposed_reason: null, filter_tier: 'normal' },
  { canonical_key: 'deed_location_text', ui_exposed: false, not_exposed_reason: 'free prose, not a predicate', filter_tier: 'backend' },
];
const withRow = (key: string, patch: Record<string, unknown>) =>
  healthy().map((r) => (r.canonical_key === key ? { ...r, ...patch } : r));

mustCatch('a backend-only field that has acquired a chip (the inverse of the Pool/Gym bug)',
  registryProblems(withRow('parking', { ui_exposed: false, not_exposed_reason: 'zero inventory' }), CHIPS)
    .some((p) => p.includes('rendered as a chip')));

mustCatch('a chip the registry cannot DESCRIBE at all (the optical_fibers shape)',
  registryProblems(healthy(), [...CHIPS, 'optical_fibers']).some((p) => p.includes('no af_field_registry row')));

mustCatch('a hidden field that never records WHY it is hidden',
  registryProblems(withRow('deed_location_text', { not_exposed_reason: null }), CHIPS)
    .some((p) => p.includes('do not record WHY')));

mustCatch("an interview field demoted out of 'advanced' tier — Normal-Filter territory auto-asked",
  registryProblems(withRow('bathrooms', { filter_tier: 'normal' }), CHIPS)
    .some((p) => p.includes("interview field 'bathrooms'") && p.includes("filter_tier='normal'")));

mustCatch("bedrooms being promoted to 'advanced' so the interview could ask it",
  registryProblems(withRow('bedrooms', { filter_tier: 'advanced' }), CHIPS)
    .some((p) => p.includes("'bedrooms' is filter_tier")));

mustCatch('an interview field that VANISHED from the registry (absence must not read as compliance)',
  registryProblems(healthy().filter((r) => r.canonical_key !== 'furnished'), CHIPS)
    .some((p) => p.includes("'furnished'")));

// ── the failure-path proofs: the class AGENTS.md calls A FAILED FETCH IS NOT AN EMPTY ANSWER ─────
// PostgREST answers an error with a JSON OBJECT and supabase-js never throws, so a failed read
// arrives at the predicate as a well-formed value. If any of these read as "no problems", the live
// half would certify the contract at the exact moment it learned nothing.
mustCatch('a PostgREST ERROR OBJECT standing in for the registry',
  registryProblems({ message: 'permission denied for table af_field_registry' }, CHIPS).length > 0);

mustCatch('an EMPTY registry read as "no hidden fields exist"',
  registryProblems([], CHIPS).length > 0);

mustCatch('an unreachable endpoint (the shape the live half hands over on a fetch throw)',
  registryProblems({ fetchFailed: 'TypeError: fetch failed' }, CHIPS).length > 0);

mustCatch('a null registry — the silent→NULL value the owner rule is about',
  registryProblems(null, CHIPS).length > 0);

// The live half's response→data judgement is proven HERE too, so it is covered on every PR and not
// only on the daily live run. A failing response whose body still parses as a plausible registry is
// the dangerous case: if status were ignored, a statement timeout would certify the contract.
const PLAUSIBLE = [{ canonical_key: 'parking', ui_exposed: true, not_exposed_reason: null, filter_tier: 'advanced' }];
mustCatch('a non-200 response whose BODY still parses as a plausible registry (status must decide)',
  registryProblems(registryPayload(500, PLAUSIBLE), CHIPS).length > 0
  && registryProblems(registryPayload(401, PLAUSIBLE), CHIPS).length > 0);

// ── negative controls ────────────────────────────────────────────────────────────────────────────
mustCatch('…while a HEALTHY registry is NOT flagged (the predicate is not vacuously red)',
  registryProblems(healthy(), CHIPS).length === 0);

mustCatch('…and the chip derivation still finds the real shipped chips (not vacuously empty)',
  amenityChipKeys(advanced).length >= 6 && amenityChipKeys('const NOTHING = 1;').length === 0);

mustCatch('…and a 200 body is passed THROUGH unchanged, so a healthy read is still judged as data',
  registryPayload(200, PLAUSIBLE) === PLAUSIBLE);

console.log(failures === 0
  ? '\n✓ every visible control maps to a real predicate; the boundary teeth run unconditionally; the live half still runs\n'
  : `\n✗ ${failures} check(s) FAILED — a control would be silently ignored, or a hidden field leaked into the UI\n`);
process.exit(failures === 0 ? 0 : 1);
