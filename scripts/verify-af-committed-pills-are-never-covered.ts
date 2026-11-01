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
//   1. the pills render in every phase of a round (loading, intro, question);
//   2. they sit INSIDE the card, directly under its title bar (owner 2026-10-11: «I don't like how that
//      popped up» — above the card they floated over the page), so the card itself is what shows them;
//   3. NO pill is removable.
//
// AMENDED 2026-10-03 (owner: «we should not show any X button on this»). The pills stay exactly where
// #155 put them — visible above the scrim in every phase — but they are READ-ONLY now: no ✕, no
// handler, no removal path from the card. Rule 3 used to say a SCOPE facet stays unremovable while
// every other facet could be removed; with nothing removable, the scope exception is moot.
//
// WHAT THIS HALF CAN AND CANNOT PROVE, stated plainly rather than dressed up. (1) and (2) are
// facts about JSX nesting order, and this file reads them as such: `AdvancedQuestionCard` imports
// reanimated, expo-image and the icon font, so a plain node barrier cannot render it. (3) is
// EXECUTED — it imports the real `isScopeQuestionId` and the real id list and calls them.
//
// This file is the offline, structural check. (The live removal journeys that used to execute the
// other half — verify-af-pill-removal-live / verify-af-remove-last-pill-live — were retired with the
// removal itself on 2026-10-03.)
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

// ── 1. THE PILLS ARE INSIDE THE CARD, UNDER ITS TITLE BAR ───────────────────────────────────────
// Structure, read as ORDER inside the overlay: backdrop, card, title bar, pills, the round's body. If the
// pills move out above the card they float over the page again (owner 2026-10-11); if they move below
// {children} they scroll away with the question. Both are the defect.
const placement = (code: string): string[] => {
  const out: string[] = [];
  const overlay = code.indexOf('style={s.overlay}');
  const backdrop = code.indexOf('style={s.backdrop}', overlay);
  const cardEl = code.indexOf('<Reveal style={s.card}>', overlay);
  // The title bar may carry an Arabic-only style next to s.bar (owner 2026-10-24: the ✕ stays top-right), so match
  // `<View style={s.bar}>` and `<View style={[s.bar, …]}>` alike.
  const barAt = cardEl >= 0 ? code.slice(cardEl).search(/<View style=\{\[?s\.bar[\]},]/) : -1;
  const bar = barAt >= 0 ? cardEl + barAt : -1;
  const pills = code.indexOf('<CommittedPills', overlay);
  const body = code.indexOf('{children}', cardEl);
  if (!(overlay >= 0 && pills > overlay)) out.push('no <CommittedPills> inside the AF overlay');
  if (!(backdrop >= 0 && pills > backdrop)) out.push('the pills are rendered before the backdrop — the scrim would cover them');
  if (!(cardEl >= 0 && pills > cardEl)) out.push('the pills float above the card again');
  if (!(bar > cardEl && pills > bar && body > pills)) out.push('the pills are not directly under the title bar, before the round body');
  return out;
};
{
  const p = placement(cardCode);
  check('the committed pills render inside the card, under the title bar, above the round body', p.length === 0, p.join('; '));
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
// stale set while the transcript showed the live one. Pin that the overlay is fed from guidedPills —
// the same thing the transcript row uses — and from nothing that could change them.
{
  const memo = agentCode.indexOf('const afCardPills');
  const memoBody = agentCode.slice(memo, memo + 300);
  check('agent.tsx derives the card pills from guidedPills, not a copy',
    memo >= 0 && /facets:\s*guidedPills\?\.facets/.test(memoBody),
    'the AF card is being fed a second, independent list of committed selections');
  check('…and hands the card NO removal handler (the pills are read-only)',
    !/onRemove/.test(memoBody) && !/removeGuidedFacet/.test(agentCode),
    'a removal path is back: the owner ruled on 2026-10-03 that no pill shows an X');
  const uses = [...agentCode.matchAll(/pills=\{afCardPills\}/g)].length;
  check('…and every AF card state on screen receives it (loading, intro, question)',
    uses === 3, `${uses} of 3 render sites pass pills`);
}

// ── 4. NO PILL IS REMOVABLE ─────────────────────────────────────────────────────────────────────
{
  const pillsFn = cardCode.indexOf('function CommittedPills');
  // Up to the NEXT top-level declaration, so the whole component body is in scope rather than the
  // first few lines of it.
  const body = cardCode.slice(pillsFn, cardCode.indexOf('export type ShellPills', pillsFn));
  check('the card renders every committed pill as a plain chip',
    pillsFn >= 0 && /<View key=\{`\$\{f\.id\}-\$\{i\}`\} style=\{s\.pill\}>/.test(body),
    'the card pills are no longer plain chips');
  check('…with no Pressable, no handler and no ✕ anywhere in the pill row',
    !/Pressable|onPress|onRemove|name="close"/.test(body),
    'a pill can be pressed or carries a ✕ again — the owner banned both on 2026-10-03');
  check('the transcript row\'s chips are equally read-only',
    !/testID=\{`af-pill-\$\{i\}`\}[^>]*onPress/.test(agentCode)
      && !/<Pressable[^>]*af-pill/.test(agentCode),
    'a transcript pill takes a press again');
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

// M-2: the pills floating ABOVE the card again (the shape the owner rejected on 2026-10-11).
mustCatch('pills floating above the card again', placement('<View style={s.overlay}>\n<Pressable style={s.backdrop} />\n<CommittedPills />\n<Reveal style={s.card}>\n<View style={s.bar}></View>\n{children}').length > 0);

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
  const copied = 'const afCardPills = { facets: myOwnCopyOfTheFacets };';
  return !/facets:\s*guidedPills\?\.facets/.test(copied);
})());

// M-6: a removal handler threaded back into the card, so its pills grow a ✕ again.
mustCatch('a card whose pills take a remove handler', (() => {
  const loose = 'const afCardPills = { facets: guidedPills?.facets ?? [], onRemove: removeGuidedFacet };';
  return !(!/onRemove/.test(loose) && !/removeGuidedFacet/.test(loose));
})());

// M-6b: a pill row that is pressable again.
mustCatch('a pill row with a Pressable and a close icon', (() => {
  const loose = '<Pressable onPress={() => onRemove(i)}><Ionicons name="close" /></Pressable>';
  return /Pressable|onPress|onRemove|name="close"/.test(loose);
})());

// M-7: and a correct implementation must NOT be flagged.
mustCatch('the shipped implementation is not flagged', placement(cardCode).length === 0);
mustCatch('pills pushed below the round body', placement(cardCode.replace('{pills ? <CommittedPills facets={pills.facets} /> : null}\n        {children}', '{children}\n        {pills ? <CommittedPills facets={pills.facets} /> : null}')).length > 0);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the committed selections stand above the round, on every phase and every viewport — read-only.\n'
    : `\n❌ ${failed} check(s) failed — the AF round can cover the user's committed selections.\n`);
process.exit(failed === 0 ? 0 : 1);
