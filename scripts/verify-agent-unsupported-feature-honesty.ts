// Regression guard for Task 7 (owner request 2026-09-11): "Distinguish between: (a) We cannot
// verify this feature from our data. (b) We support this feature, but no listings match it. Do not
// claim properties lack something merely because the database does not record it."
//
// THE GAP THIS CLOSES. Before this change, JSON_SHAPE_HINT already told the model to "acknowledge
// [an out-of-vocabulary request] neutrally without claiming to filter for it" — but never required
// NAMING what was unverifiable, and nothing stopped the model from phrasing that neutrally-worded
// acknowledgment as an ABSENCE claim ("these listings don't have that") rather than an honesty claim
// ("our data doesn't track that"). Those are different sentences with a different truth value: the
// first asserts something about the PROPERTIES (which the model cannot know), the second asserts
// something about EZHALAH'S SCHEMA (which is verifiably true — the field genuinely isn't tracked).
//
// WHY THIS IS OFFLINE, NOT LIVE. This is prompt TEXT sent to DeepSeek, not deterministic app logic —
// there is no way to execute "does the model actually follow this instruction" without a live model
// call this repo's local test suite cannot make (see AGENTS.md: Filter/AF must never call DeepSeek,
// and this barrier is itself DeepSeek-free — scripts/verify-zero-deepseek-flows.ts already proves
// scripts/ makes no such call). What IS checkable offline, and is checked here, is that the
// INSTRUCTION EXISTS in the exact system prompt sent on every turn, says the right THING (quotes the
// feature, names it unverifiable, forbids the absence claim), and is textually DISTINCT from the two
// existing, already-shipped mechanisms this must not be confused with:
//   - rejectionNotice() (src/data/agent.ts) — a PROPOSED, IN-VOCABULARY filter the current cohort
//     doesn't certify (e.g. bathrooms on a land parcel). Different case: the field IS tracked.
//   - noResultsSuggestion() (src/data/search.ts) — a search that RAN and found zero matches.
//     Different case: the feature WAS searched for, honestly, and nothing matched.
// A live DeepSeek smoke-test (owner or CI, outside this repo's local suite) is still the only way to
// confirm the model actually obeys the new sentence — this barrier proves the sentence is shipped
// and says the right thing, not that DeepSeek reads it correctly.
//
//   node --experimental-strip-types scripts/verify-agent-unsupported-feature-honesty.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const AGENT_EDGE = join(root, 'supabase/functions/agent/index.ts');
const AGENT_DATA = join(root, 'src/data/agent.ts');
const SEARCH = join(root, 'src/data/search.ts');
const edgeSrc = readFileSync(AGENT_EDGE, 'utf8');
const agentDataSrc = readFileSync(AGENT_DATA, 'utf8');
const searchSrc = readFileSync(SEARCH, 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
/**
 * A MUTATION PROOF: this barrier's own predicate, applied to a deliberately broken input, asserting
 * that it really comes back RED. `caught` must be a computed boolean — a literal `true` here is the
 * shape scripts/verify-new-barriers-are-mutation-proven.ts exists to refuse.
 */
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

console.log('\nAn unsupported feature is named honestly as UNVERIFIABLE, never as an absence\n');

// ── 1. the instruction exists, in the SYSTEM prompt sent every turn ─────────────────────────────
const shapeHintIdx = edgeSrc.indexOf('const JSON_SHAPE_HINT');
check('JSON_SHAPE_HINT (the system-prompt suffix sent on every call) exists', shapeHintIdx > -1);
const shapeHint = shapeHintIdx > -1 ? edgeSrc.slice(shapeHintIdx, shapeHintIdx + 4000) : '';

// The anchor phrase both this barrier and any future edit can find the rule by — short enough to
// survive a rewording of the sentences around it, specific enough that nothing else in the prompt
// could match it by accident.
const ANCHOR = 'if something the user asked for is outside your allowed vocabulary';
const anchorIdx = shapeHint.indexOf(ANCHOR);
check('the unsupported-feature rule exists (found by its anchor phrase)', anchorIdx > -1);
// One shared "what does the rule actually say" predicate, applied to the REAL shipped text below and
// to deliberately broken text in the mutation proofs — so a check and its own proof can never drift
// apart into testing different things.
const ruleSaysEnoughTo = (window: string) => ({
  quotesTheUser: /quoting their own word or phrase/.test(window),
  namesTheSchemaClaim: /Ezhalah's data does not track that/.test(window),
  forbidsClaimingToFilter: /never claim to filter for it or guess whether listings have it/.test(window),
  bansTheAbsencePhrasing: /never say listings "don't have" or "lack" it/.test(window),
  namesUnverifiable: /UNVERIFIABLE/.test(window),
  distancesFromZeroMatch: /different from a search that ran and found zero matches/.test(window),
});
const ruleWindow = anchorIdx > -1 ? shapeHint.slice(anchorIdx, anchorIdx + 800) : '';
const shipped = ruleSaysEnoughTo(ruleWindow);

// ── 2. the rule says the three things Task 7 actually asked for ─────────────────────────────────
check('the model is told to QUOTE the user\'s own word/phrase (never a generic "some features aren\'t supported")',
  shipped.quotesTheUser);
check('the model is told to say the DATA doesn\'t track it (a claim about the SCHEMA, verifiably true)',
  shipped.namesTheSchemaClaim);
check('the model is FORBIDDEN from claiming to filter for it or guessing whether listings have it',
  shipped.forbidsClaimingToFilter);

// ── 3. the two words this must never collapse into: "absence" vs "unverifiable" ─────────────────
check('the rule explicitly bans the ABSENCE phrasing ("don\'t have"/"lack") — that claims something about the PROPERTIES, which the model cannot know',
  shipped.bansTheAbsencePhrasing);
check('the rule names the word UNVERIFIABLE — the actual distinction Task 7 asked for',
  shipped.namesUnverifiable);

// ── 4. this stays textually DISTINCT from the two existing, different mechanisms ────────────────
// rejectionNotice: a PROPOSED in-vocabulary filter the current cohort doesn't certify.
check('rejectionNotice() (an in-vocabulary filter rejected for THIS cohort) still exists, unchanged in shape',
  /function rejectionNotice/.test(agentDataSrc)
  && /That option is not available in this search, so I showed the results without it\./.test(agentDataSrc));
// noResultsSuggestion: a search that ran and genuinely found zero matches.
check('noResultsSuggestion() (a search that ran and found ZERO matches) still exists, unchanged in shape',
  /function noResultsSuggestion/.test(searchSrc));
check('the new rule explicitly distances itself from the "ran and found nothing" case, in its own words',
  shipped.distancesFromZeroMatch);

// ── 5. MUTATION PROOFS — the SAME predicate, applied to the actual old (pre-Task-7) wording ──────
const OLD_WORDING =
  'if something the user asked for is outside your allowed vocabulary, acknowledge it neutrally without claiming to filter for it.';
const old = ruleSaysEnoughTo(OLD_WORDING);
mustCatch('the old, pre-Task-7 wording fails the QUOTE requirement', !old.quotesTheUser);
mustCatch('the old, pre-Task-7 wording fails the SCHEMA-claim requirement', !old.namesTheSchemaClaim);
mustCatch('the old, pre-Task-7 wording fails the ANTI-ABSENCE ban', !old.bansTheAbsencePhrasing);
mustCatch('the old, pre-Task-7 wording fails the UNVERIFIABLE requirement', !old.namesUnverifiable);
mustCatch('the old, pre-Task-7 wording fails the zero-match distinction', !old.distancesFromZeroMatch);
// Sanity, not a mutation proof: every check above actually fired on the REAL shipped text — a
// predicate that vacuously passes an empty window (e.g. from a broken anchor) would make every
// check above meaningless.
check('the shipped rule genuinely satisfies every one of these predicates (not a vacuous empty match)',
  Object.values(shipped).every(Boolean) && ruleWindow.length > 0);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — an unsupported feature could again be claimed as an absence, or not named at all.`);
  process.exit(1);
}
console.log('\n✓ the agent prompt names an unsupported feature honestly, quotes it, and never claims an absence the data cannot prove');
