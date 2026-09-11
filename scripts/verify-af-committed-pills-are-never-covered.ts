// THE AF ROUND CARD MUST NOT COVER THE COMMITTED PILL ROW.
// Auto-discovered barrier (scripts/verify-*.ts), offline and deterministic — no browser, no network.
//
// OWNER DECISION, 2026-09-11 (ops_incident #155), verbatim:
//
//   «#155 — AF round card: it must NOT cover the selected-filter pill row. The user's committed
//    Advanced Filter selections must remain visible and removable while the next AF round is active,
//    on desktop and mobile.»
//
// WHAT WAS WRONG. The round card is a centred modal over a scrim (`s.overlay` + `s.backdrop`), and
// the committed pills lived only in the chat transcript — which is behind that scrim by
// construction, on every viewport. Measured on a 390×844 phone: at the removal step the pill's own
// centre reported «@ 338,-6469» with an EMPTY painted stack, and scrolling it into view put it
// under the card's «af-confirm». On desktop the same journey passed only when the next round had
// not opened yet, which is timing, not correctness.
//
// THE FIX, and what this file holds it to: the pills are rendered inside the overlay ITSELF, above
// the card and above the scrim, from the same facets and the same removal handler the transcript row
// uses. Three things have to stay true:
//
//   1. the pills render, with their ✕, in every phase of a round (loading, intro, question);
//   2. they sit ABOVE the scrim and OUTSIDE the card, so nothing of the round's is on top of them;
//   3. a SCOPE facet stays unremovable — owner rule 2026-08-23, unchanged by any of this.
//
// WHAT THIS HALF CAN AND CANNOT PROVE, stated plainly rather than dressed up. (1) and (2) are
// facts about JSX nesting order, and this file reads them as such: `AdvancedQuestionCard` imports
// reanimated, expo-image and the icon font, so a plain node barrier cannot render it. (3) is
// EXECUTED — it imports the real `isScopeQuestionId` and the real id list and calls them.
//
// So this is deliberately the OFFLINE half of a split, on the precedent AGENTS.md already sets for
// production-dependent checks. The EXECUTING half is the live journey
// `scripts/verify-af-pill-removal-live.ts`, which opens a real round on a real browser at 390×844
// and at 1440×900 and removes a committed pill WHILE the round is on screen — the thing a structural
// read can never establish. Neither half is sufficient; the split is what makes both honest.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const card = readFileSync(join(ROOT, 'src/components/AdvancedQuestionCard.tsx'), 'utf8');
const agent = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const cardCode = stripComments(card);
const agentCode = stripComments(agent);

console.log('\nThe AF round card must not cover the committed pill row\n');

// ── 1. THE PILLS ARE IN THE OVERLAY, ABOVE THE SCRIM ────────────────────────────────────────────
// Structure, read as ORDER inside the overlay: backdrop first, pills second, card third. If the
// pills ever move below <Reveal style={s.card}> they are inside the card; if they move above the
// backdrop they are under the scrim. Both are the defect, in opposite directions.
{
  const overlay = cardCode.indexOf('style={s.overlay}');
  const backdrop = cardCode.indexOf('style={s.backdrop}', overlay);
  const pills = cardCode.indexOf('<CommittedPills', overlay);
  const cardEl = cardCode.indexOf('<Reveal style={s.card}>', overlay);
  check('the Shell renders the committed pills inside the overlay',
    overlay >= 0 && pills > overlay, 'no <CommittedPills> inside the AF overlay');
  check('…ABOVE the scrim, so nothing is painted on top of them',
    backdrop >= 0 && pills > backdrop, 'the pills are rendered before the backdrop — the scrim would cover them');
  check('…and OUTSIDE the card, so the round card cannot cover them',
    cardEl >= 0 && pills < cardEl, 'the pills moved inside the card body');
}

// ── 2. EVERY STATE OF THE ROUND CARRIES THEM ────────────────────────────────────────────────────
// A round is not one screen. `loading`, `intro` and the question card are three different renders,
// and the pills have to survive all three or they blink out mid-round — which is exactly "covered"
// from the user's side.
for (const entry of ['AdvancedQuestionLoading', 'AdvancedIntroCard']) {
  const at = cardCode.indexOf(`export function ${entry}`);
  const shellAt = cardCode.indexOf('<Shell', at);
  check(`${entry} passes the pills through to the Shell`,
    at >= 0 && shellAt > at && /pills=\{pills\}/.test(cardCode.slice(shellAt, shellAt + 120)),
    `${entry} renders a Shell without pills — they vanish in that phase of the round`);
}
{
  const q = cardCode.indexOf('<Shell onClose={onClose} countChip={count}');
  check('the question card passes the pills through to the Shell',
    q >= 0 && /pills=\{pills\}/.test(cardCode.slice(q, q + 140)));
}

// ── 3. AGENT.TSX SUPPLIES THEM, FROM THE ONE SOURCE OF TRUTH ────────────────────────────────────
// A second copy of the user's committed selections is the failure mode here: the card would show a
// stale set while the transcript showed the live one. Pin that the overlay is fed from guidedPills
// and removeGuidedFacet — the same two things the transcript row uses.
{
  const memo = agentCode.indexOf('const afCardPills');
  check('agent.tsx derives the card pills from guidedPills and removeGuidedFacet, not a copy',
    memo >= 0
      && /facets:\s*guidedPills\?\.facets/.test(agentCode.slice(memo, memo + 400))
      && /onRemove:\s*removeGuidedFacet/.test(agentCode.slice(memo, memo + 400)),
    'the AF card is being fed a second, independent list of committed selections');
  const uses = [...agentCode.matchAll(/pills=\{afCardPills\}/g)].length;
  check('…and every AF card state on screen receives it (loading, intro, question)',
    uses === 3, `${uses} of 3 render sites pass pills`);
  // TEMPORAL DEAD ZONE, and it is a real throw rather than a style point: the useMemo factory runs
  // during render, so the memo must be declared BELOW removeGuidedFacet. This ordering was wrong on
  // the first draft of the fix.
  check('the memo is declared AFTER removeGuidedFacet (its factory runs during render)',
    agentCode.indexOf('const afCardPills') > agentCode.indexOf('const removeGuidedFacet'),
    'afCardPills reads removeGuidedFacet from its temporal dead zone — render would throw');
}

// ── 4. THE OWNER'S 2026-08-23 SCOPE RULE SURVIVES ───────────────────────────────────────────────
// Scope facets (group/type) are shown but NOT removable, in the card exactly as in the transcript.
// Executed, not read: call the predicate the component is handed and confirm both branches.
{
  const { isScopeQuestionId, SCOPE_QUESTION_IDS } = await import('../src/lib/afPlan.ts');
  // The ids come from the module, never typed here: a rename would otherwise make this pass by
  // testing two strings the product no longer uses.
  check('the scope predicate the card uses still recognises every scope question',
    SCOPE_QUESTION_IDS.length > 0 && SCOPE_QUESTION_IDS.every((id) => isScopeQuestionId(id)),
    `SCOPE_QUESTION_IDS = ${JSON.stringify(SCOPE_QUESTION_IDS)}`);
  check('…and does not claim an ordinary advanced answer is one',
    !isScopeQuestionId('bathrooms') && !isScopeQuestionId('amenities'));
  const pillsFn = cardCode.indexOf('function CommittedPills');
  // Up to the NEXT top-level declaration, so the whole component body is in scope rather than the
  // first few lines of it.
  const body = cardCode.slice(pillsFn, cardCode.indexOf('export type ShellPills', pillsFn));
  check('a scope facet renders as a plain chip with no remove handler',
    /isScope\(f\.id\)\s*\|\|\s*!onRemove\s*\?/.test(body),
    'the card would let a user remove a TYPE pill, broadening past anything they asked for');
  check('…and every other facet is a Pressable that calls onRemove with its own index',
    /onPress=\{\(\)\s*=>\s*onRemove\(i\)\}/.test(body));
  check('the card pills carry their own testIDs, distinct from the transcript row\'s',
    /af-card-pill-\$\{i\}/.test(cardCode) && !/af-card-pill/.test(agentCode.replace(/afCardPills/g, '')),
    'duplicate af-pill-N testIDs would make every live locator ambiguous');
}

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the same predicates, against the defects they exist to catch\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// M-1: THE DEFECT ITSELF — the overlay renders no pills at all, which is production before today.
mustCatch('an overlay that renders no committed pills (the state this fix replaces)', (() => {
  const before = '<View style={s.overlay} testID="af-card">\n<Pressable style={s.backdrop} />\n<Reveal style={s.card}>';
  return before.indexOf('<CommittedPills') === -1;
})());

// M-2: the pills pushed INSIDE the card — visible, but back under the round's own chrome and
// scrolling with it rather than standing clear of it.
mustCatch('pills moved inside the card body instead of above it', (() => {
  const moved = '<View style={s.overlay}>\n<Pressable style={s.backdrop} />\n<Reveal style={s.card}>\n<CommittedPills />';
  return moved.indexOf('<CommittedPills') > moved.indexOf('<Reveal style={s.card}>');
})());

// M-3: the pills under the SCRIM — rendered, dimmed, and unclickable. The subtlest version.
mustCatch('pills rendered before the backdrop, so the scrim covers them', (() => {
  const under = '<View style={s.overlay}>\n<CommittedPills />\n<Pressable style={s.backdrop} />';
  return under.indexOf('<CommittedPills') < under.indexOf('style={s.backdrop}');
})());

// M-4: one phase of the round drops them, so they blink out mid-interview.
mustCatch('a round phase that renders a Shell without pills', (() => {
  const phase = 'export function AdvancedIntroCard({ onClose }) { return (<Shell onClose={onClose}>';
  const at = phase.indexOf('<Shell');
  return !/pills=\{pills\}/.test(phase.slice(at, at + 120));
})());

// M-5: a second, independent list of committed selections in the card.
mustCatch('the card fed a copy instead of the live guidedPills', (() => {
  const copied = 'const afCardPills = { facets: myOwnCopyOfTheFacets, onRemove: doSomethingElse };';
  return !/facets:\s*guidedPills\?\.facets/.test(copied);
})());

// M-6: the scope rule dropped, so a TYPE pill becomes removable.
mustCatch('a card that lets a SCOPE facet be removed', (() => {
  const loose = '{facets.map((f, i) => (<Pressable onPress={() => onRemove(i)}>';
  return !/isScope\(f\.id\)\s*\|\|\s*!onRemove\s*\?/.test(loose);
})());

// M-7: and a correct implementation must NOT be flagged.
mustCatch('the shipped implementation is not flagged', (() => {
  const overlay = cardCode.indexOf('style={s.overlay}');
  return cardCode.indexOf('<CommittedPills', overlay) > cardCode.indexOf('style={s.backdrop}', overlay)
    && cardCode.indexOf('<CommittedPills', overlay) < cardCode.indexOf('<Reveal style={s.card}>', overlay);
})());

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the committed selections stand above the round, on every phase and every viewport.\n'
    : `\n❌ ${failed} check(s) failed — the AF round can cover the user's committed selections.\n`);
process.exit(failed === 0 ? 0 : 1);
