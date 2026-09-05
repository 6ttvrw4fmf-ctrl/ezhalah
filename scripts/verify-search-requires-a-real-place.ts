// A SEARCH REQUIRES A REAL PLACE — NATIONWIDE IS NOT A SCOPE (owner, 2026-09-04).
//
// The Normal Filter has always refused a search with no city («الرجاء اختيار مدينة من القائمة»).
// The agent had no such rule. PR #1711 removed the client-side affordance and the advertisement,
// and production STILL searched the whole Kingdom, because the client deliberately does not
// re-litigate the server's decision ("THE SERVER IS THE SINGLE DECISION AUTHORITY", 2026-08-30) —
// so the rule has to live in decideAgentTurn(), the one function allowed to assign a `kind`.
//
// Reproduced on production 2026-09-04 AFTER #1711 had shipped:
//   «ابغى شقة للبيع في كل مدن المملكة» → p_cities/p_districts/p_region_ids all null → 39,055 rows,
//   summary «المدينة: المملكة العربية السعودية».
// hasEnoughToSearch() was satisfied by the TYPE alone, so the ladder searched, and the country-level
// location made that search unscoped.
//
// This barrier EXECUTES the real ladder — never a copy.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideAgentTurn, hasUsableLocation, QUESTION_BUDGET_CEILING } from '../supabase/functions/agent/decide.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};
const decide = (state: Record<string, unknown>, askCount = 0, locationAmbiguous = false) =>
  decideAgentTurn({ rawText: 'شقة', locationAmbiguous, establishedState: state as never, askCount }).kind;

// ── 1. THE COUNTRY IS NOT A PLACE ─────────────────────────────────────────────────────────────
// Hoisted to module scope so §7's mutation proofs feed the SAME two vocabularies to a broken
// predicate and watch these rules reject it.
const NOT_A_PLACE = [
  'المملكة العربية السعودية', 'المملكة', 'السعودية', 'السعوديه', 'كل المملكة', 'كل مدن المملكة',
  'في كل مدن المملكة', 'جميع مدن السعودية', 'Saudi Arabia', 'saudi', 'KSA', 'the Kingdom', '', '   ',
  // «سعودية» without the definite article is caught ONLY by the exact-alias branch — the loose
  // Kingdom test looks for «السعودي». Without this case that branch is untested and a mutation
  // deleting it survives (it did, on the first run of this barrier).
  'سعودية',
];
const A_REAL_PLACE = ['الرياض', 'جدة', 'حي الملقا', 'منطقة الرياض', 'المدينة المنورة', 'الخبر', 'أبها'];
{
  for (const loc of NOT_A_PLACE) {
    check(!hasUsableLocation({ location: loc } as never), `«${loc || '(empty)'}» is NOT a usable location`);
  }
  // Real places must stay usable — a fix that also blocks these has gone too far.
  for (const loc of A_REAL_PLACE) {
    check(hasUsableLocation({ location: loc } as never), `«${loc}» IS a usable location`);
  }
}

// ── 2. THE LADDER NEVER RETURNS `listings` WITHOUT A PLACE ────────────────────────────────────
{
  // Any single signal used to be enough on its own — that is exactly how the nationwide search
  // survived, since a bare type satisfies hasEnoughToSearch().
  for (const [label, st] of [
    ['type only', { type: 'Villa' }],
    ['price only', { price: '500000' }],
    ['detail only', { detail: '3' }],
    ['amenities only', { amenities: ['parking'] }],
    ['af only', { af: { bathrooms: 2 } }],
    ['type + the COUNTRY as location', { type: 'Apartment', location: 'المملكة العربية السعودية' }],
    ['type + «كل مدن المملكة»', { type: 'Apartment', location: 'كل مدن المملكة' }],
    ['nothing at all', {}],
  ] as const) {
    check(decide(st as never) === 'message', `${label} → message, never a nationwide search`);
  }
  // …and the budget ceiling must not manufacture one either. This is the half that actually bit:
  // step 3 used to read "search anyway, broad/nationwide if that's nothing at all".
  for (const askCount of [QUESTION_BUDGET_CEILING, QUESTION_BUDGET_CEILING + 3, 50]) {
    check(decide({ type: 'Apartment' }, askCount) === 'message',
      `askCount=${askCount} with no place → still asks, never searches the Kingdom`);
  }
}

// ── 3. SUPPORTED SCOPES STILL SEARCH NORMALLY ────────────────────────────────────────────────
// The whole risk of this rule is over-blocking. Every supported scope must be unaffected.
{
  for (const [label, st] of [
    ['city', { location: 'الرياض' }],
    ['city + type', { location: 'جدة', type: 'Apartment' }],
    ['district', { location: 'حي الملقا' }],
    ['region', { location: 'منطقة الرياض' }],
    ['city + price', { location: 'الدمام', price: '500000' }],
  ] as const) {
    check(decide(st as never) === 'listings', `${label} → listings (supported scope, unaffected)`);
  }
  check(decide({ location: 'الرياض' }, QUESTION_BUDGET_CEILING) === 'listings',
    'a real place at the budget ceiling still searches — optional fields never block');
}

// ── 4. AN AMBIGUOUS PLACE ASKS — SUPERSEDED 2026-09-05, AND IT WAS MY OWN ERROR ──────────────
// This section previously asserted that an ambiguity CONVERGES to listings once the budget is
// spent, on the stated belief that "the search it converges on is scoped to the term, not
// nationwide". That belief was wrong: turnWiring cleared the location outright and its own comment
// said so — "absent, nationwide, never guessed". The assertion was therefore pinning the bug.
// Section 7 below now owns this case, including the termination proof.
{
  check(decide({}, 0, true) === 'message', 'ambiguous place under the ceiling → asks');
}

// ── 5. THE COUNTRY VOCABULARY IS A DOCUMENTED MIRROR, NOT A SILENT COPY ──────────────────────
{
  const decideSrc = readFileSync(join(root, 'supabase/functions/agent/decide.ts'), 'utf8');
  check(/LITERAL MIRROR of COUNTRY_ALIASES/.test(decideSrc),
    'the country vocabulary says it mirrors src/data/regions.ts (edge cannot import it)');
  const regions = readFileSync(join(root, 'src/data/regions.ts'), 'utf8');
  for (const alias of ['المملكة', 'السعودية', 'ksa']) {
    check(regions.includes(alias), `«${alias}» still exists in regions.ts's own alias set`,
      'if regions.ts drops it, the edge mirror is stale');
  }
}

// ── 6. THE REFUSAL ASKS FOR THE CITY — it never just goes quiet ──────────────────────────────
// Closing the search without asking anything is its own defect: verified live 2026-09-05, the
// ladder correctly issued ZERO searches but the reply still read «أبشر، بدور لك على شقق للبيع في
// كل مدن المملكة» — a promise to search the Kingdom, followed by nothing.
{
  const idx = readFileSync(join(root, 'supabase/functions/agent/index.ts'), 'utf8');
  check(/const noPlaceReply\s*=/.test(idx),
    'index.ts builds a deterministic reply when the turn was refused for having no place');
  check(/hasUsableLocation\(wired\.establishedState\)/.test(idx),
    'that reply is gated on the SAME hasUsableLocation() the ladder used — not a second rule');
  check(/في أي مدينة تبحث؟/.test(idx),
    'the refusal asks the city question in Arabic');
  check(/ambiguityReply \?\? noPlaceReply \?\?/.test(idx),
    'a loc_classify ambiguity still wins — its question is more specific than the generic city ask');
  check(/!ambiguityReply && !hasUsableLocation/.test(idx),
    'the no-place question never overrides an ambiguity question');
}

// ── 7. A TWIN/AMBIGUOUS PLACE ASKS — AND NEVER DEGRADES INTO A NATIONWIDE SEARCH ─────────────
// «الرياض» is a twin (city AND region). Answering the city question with it used to reach
// kind="listings" once the budget was spent; turnWiring then CLEARED the location, whose own comment
// said it outright — "absent, nationwide, never guessed". Measured in production 2026-09-05:
// p_cities/p_districts/p_region_ids all null, 39,015 listings, top result in جدة.
// The bounded question now outranks the ceiling (owner, 2026-09-05).
{
  for (const askCount of [0, 1, QUESTION_BUDGET_CEILING, QUESTION_BUDGET_CEILING + 3, 50]) {
    check(decide({}, askCount, true) === 'message',
      `an unresolved twin at askCount=${askCount} → asks, never a nationwide search`);
  }
  // TERMINATION. The owner's other requirement: this must not become an infinite loop. It cannot,
  // because the question is CLOSED — it names both options and the client resolves either answer
  // deterministically. Prove the exit exists: once the answer is folded in, the very next turn
  // searches, at ANY askCount.
  for (const answered of ['مدينة الرياض', 'منطقة الرياض', 'الرياض', 'الهفوف']) {
    check(decide({ location: answered }, 50, false) === 'listings',
      `«${answered}» resolved → listings on the next turn (the loop has an exit)`);
  }
  // …and the exit is a REAL place, never the country sneaking back in through the twin door.
  check(decide({ location: 'المملكة العربية السعودية' }, 50, false) === 'message',
    'the twin exit cannot resolve to the country');

  // turnWiring must NEVER clear a location into absence again. Absence IS nationwide downstream.
  const wiring = readFileSync(join(root, 'supabase/functions/agent/turnWiring.ts'), 'utf8');
  check(!/location = "";/.test(wiring),
    'turnWiring never blanks the location (absence is what the RPC reads as the whole Kingdom)');
  check(/decision = \{ kind: "message"/.test(wiring),
    'an unresolved ambiguity that somehow reached "listings" degrades to a QUESTION, fail-closed');

  // The ladder must not re-acquire a budget bound on the ambiguity step.
  const decideSrc = readFileSync(join(root, 'supabase/functions/agent/decide.ts'), 'utf8');
  check(!/locationAmbiguous && askCount < QUESTION_BUDGET_CEILING/.test(decideSrc),
    'the twin question is NOT bounded by the question budget (that bound is what produced the bug)');
  // DEFENCE IN DEPTH, pinned at the source because it is deliberately unreachable today and so has
  // no behaviour to mutate: step 1 always asks on an ambiguity, so the no-place gate below never
  // sees one. Keep it unexempted anyway — the safety of that gate must not depend on the ladder's
  // ORDER staying exactly as it is. (A mutation restoring the exemption is invisible at runtime,
  // which is precisely why it needs a source assertion rather than none.)
  check(!/!locationAmbiguous && !hasUsableLocation/.test(decideSrc),
    'the no-place gate carries NO ambiguity exemption — it must hold even if the ladder is reordered');
}
// ── 8. MUTATION PROOFS — the pre-fix rules, rebuilt and fed to the assertions above ───────────
// This barrier exists because a rule that was never watched fail is indistinguishable from prose.
// Each mutant is the behaviour production actually shipped on 2026-09-04.
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// THE DEFECT VERBATIM: any non-empty location string counts as a place, so «كل مدن المملكة» searched
// the whole Kingdom. §1's rule — every NOT_A_PLACE entry must be unusable — rejects it.
const anyStringIsAPlace = (st: { location?: string }) => !!st.location?.trim();
mustCatch('a location rule where any non-empty string is a place (the Kingdom-wide search, verbatim)',
  NOT_A_PLACE.some((loc) => anyStringIsAPlace({ location: loc })));

// THE OVER-BLOCKING DIRECTION, which is the real risk of this rule: a fix that also refuses short
// real city names. §1's second half — every A_REAL_PLACE entry must stay usable — rejects it.
const overBlocking = (st: { location?: string }) => (st.location ?? '').trim().length >= 8;
mustCatch('an over-blocking rule that also refuses real short city names («جدة», «أبها»)',
  !A_REAL_PLACE.every((loc) => overBlocking({ location: loc })));

// THE LADDER's pre-fix shape: any single signal was enough to search. §2's rule rejects it.
const anySignalSearches = (st: Record<string, unknown>) =>
  st.type || st.price || st.detail || st.amenities || st.af || st.location ? 'listings' : 'message';
mustCatch('a ladder where a bare type is enough to search (no place required)',
  anySignalSearches({ type: 'Villa' }) !== 'message');
mustCatch('a ladder that treats the COUNTRY as a scope it can search',
  anySignalSearches({ type: 'Apartment', location: 'كل مدن المملكة' }) !== 'message');

// THE BUDGET CEILING manufacturing a search out of impatience — the half that actually bit.
const ceilingSearchesAnyway = (_st: Record<string, unknown>, askCount: number) =>
  askCount >= QUESTION_BUDGET_CEILING ? 'listings' : 'message';
mustCatch('a budget ceiling that searches anyway once the questions run out',
  ceilingSearchesAnyway({ type: 'Apartment' }, QUESTION_BUDGET_CEILING) !== 'message');

// §3's over-blocking mirror: a rule that stops real cities searching at all.
mustCatch('a rule that refuses a real city outright (supported scopes must be unaffected)',
  ((st: Record<string, unknown>) => (st.location === 'الرياض' ? 'message' : 'listings'))({ location: 'الرياض' }) !== 'listings');

console.log(failed === 0
  ? '\n✅ verify-search-requires-a-real-place: all checks passed.'
  : `\n❌ verify-search-requires-a-real-place: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
