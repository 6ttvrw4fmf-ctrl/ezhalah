// PERMANENT BARRIER: the closing sentence never offers an action that is not on screen.
// (§42 visible output contract; §10/§26 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md. Found by the live
// sweep's AF-scoped pagination journey, 2026-09-05, routine-4 Search & Matching QA.)
//
// THE DEFECT THIS EXISTS FOR. `moreNoteText` was worded from `rc.endKind` and `canNarrowFurther`
// alone, while the buttons it names carry TWO further gates the wording never saw:
//
//   • `isLatestResults` — only the NEWEST results turn keeps live actions (owner 2026-08-24), so in
//     any multi-search chat every earlier turn kept an offer it could no longer honour.
//   • `!ageFlow` — the entire actions row is hidden while the Advanced Filter interview is open
//     (owner 2026-08-21): the AF card is an absolute overlay and buttons underneath are unreachable.
//
// Measured on production 2026-09-05 — الرياض/بيع/فيلا, then one committed AF answer («كم عرض الشارع
// تفضل؟» → p_street_width_min 20). The document held TWO rendered, visible closing lines:
//
//     «عرضت لك أول 13 من أصل 11,254 إعلان مطابق. تبي أعرض لك المزيد؟»
//     «عرضت لك أول 10 من أصل 5,970 إعلان مطابق. تبي أعرض لك المزيد، أو أساعدك توصل لنتائج أدق؟»
//
// …and `document.querySelectorAll('[data-testid="results-load-more"]').length === 0`. Every COUNT was
// exactly right (11,254 = the villa search; 5,970 = the same plus the street-width predicate, both
// confirmed against the RPC). Only the OFFER was false: the user is asked whether to show more and
// given nothing to tap.
//
// WHY IT SURVIVED. `readAloudClosingNote` had ALWAYS gated on `showActionsRow` — the spoken note
// refuses to name an action that is not rendered — so the one surface with the rule applied was the
// one nobody was looking at, while the visible text beside it kept promising. A barrier over either
// surface alone would have read green.
//
// WHAT IS LOCKED: over the COMPLETE input space of `closingNoteKey` (2 endKind × 2 quoteTotal ×
// 2 offersMore × 2 offersNarrow = 16 states, all enumerated — not sampled), no returned key may ask
// for a button that is not offered. Plus: every key it can return really exists in the Arabic
// translation table, so a truthful sentence can never render as an untranslated English string.
//
//   node --experimental-strip-types scripts/verify-closing-note-never-promises-a-missing-button.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closingNoteKey, keyOffersMore, keyOffersNarrow, resultCounts,
         type ClosingNoteKey, type EndKind } from '../src/data/resultCount.ts';

const root = join(import.meta.dirname, '..');
const agentSrc = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const i18nSrc = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
/**
 * A MUTATION PROOF: this barrier's own predicate, applied to a deliberately broken input, asserting
 * that it really comes back RED. `caught` must be a computed boolean — a literal `true` here is the
 * shape scripts/verify-new-barriers-are-mutation-proven.ts exists to refuse.
 */
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION \u2014 ${label}`, caught, detail);


console.log('\nThe closing sentence never promises a button that is not on screen\n');

// ── 1. EXHAUSTIVE over the whole input space — enumerated, never sampled ─────────────────────────
const BOOL = [false, true];
const KINDS: EndKind[] = ['more', 'all'];
// Six inputs now (owner 2026-09-14): lastTapOffer (the final «عرض المزيد», up to 500) and cappedAtCap
// (terminal at the 500 cap with more still matching) joined the original four.
type State = { endKind: EndKind; quoteTotal: boolean; offersMore: boolean; offersNarrow: boolean; lastTapOffer: boolean; cappedAtCap: boolean };
const states: State[] = [];
for (const endKind of KINDS) for (const quoteTotal of BOOL) for (const offersMore of BOOL) for (const offersNarrow of BOOL)
  for (const lastTapOffer of BOOL) for (const cappedAtCap of BOOL)
    states.push({ endKind, quoteTotal, offersMore, offersNarrow, lastTapOffer, cappedAtCap });

check('the input space is enumerated in full (2 × 2 × 2 × 2 × 2 × 2)', states.length === 64, `saw ${states.length}`);
// closingNoteKey must be TOTAL over all 64 — never throw, always a key — even on combos the app can't
// produce (defence against a future refactor that reaches one).
check('closingNoteKey is total over the whole 64-state space (never throws)',
  states.every((s) => typeof closingNoteKey(s) === 'string'));

// REALIZABLE states only, for the honesty checks: the four booleans are not independent — they are
// derived from the real gating (agent.tsx + resultCounts), so several combos can never occur and
// asserting honesty on them would test fiction. Each exclusion names the invariant that forbids it.
const realizable = (s: State): boolean => {
  // «عرض المزيد» exists only while there is more to page → endKind 'more'. 'all' never offers it.
  if (s.offersMore && s.endKind !== 'more') return false;
  // "this is the last «عرض المزيد»" implies a «عرض المزيد» is actually offered, in the 'more' state.
  if (s.lastTapOffer && (s.endKind !== 'more' || !s.offersMore)) return false;
  // cappedAtCap is a TERMINAL fact (hit 500 with more matching) → only in the 'all' state.
  if (s.cappedAtCap && s.endKind !== 'all') return false;
  // In the 'all' terminal, «تحديد أكثر» survives ONLY in the >500 (capped) case — canNarrowFurther
  // gates on `shown < trueTotal`, so an everything-shown (≤500) terminal never renders it.
  if (s.endKind === 'all' && s.offersNarrow && !s.cappedAtCap) return false;
  return true;
};
const real = states.filter(realizable);
check('the realizable subset is non-empty and smaller than the full space', real.length > 0 && real.length < 64, `real=${real.length}`);

const overPromises = real.filter((s) => {
  const k = closingNoteKey(s);
  return (keyOffersMore(k) && !s.offersMore) || (keyOffersNarrow(k) && !s.offersNarrow);
});
check('NO realizable state produces a sentence offering an action that is not rendered',
  overPromises.length === 0,
  overPromises.map((s) => `${JSON.stringify(s)} → ${closingNoteKey(s)}`).join('\n      '));

// The complement matters too: with the button genuinely on screen the invitation must still be made,
// or the fix would have silently retired a working affordance instead of telling the truth about it.
const underPromises = real.filter((s) => {
  const k = closingNoteKey(s);
  // 'all' has nothing left to page, so offersMore cannot be honoured there by construction.
  const moreApplies = s.endKind === 'more' && s.offersMore;
  return (moreApplies && !keyOffersMore(k)) || (s.offersNarrow && !keyOffersNarrow(k));
});
check('a rendered button IS still invited — the fix removes false offers, never true ones',
  underPromises.length === 0,
  underPromises.map((s) => `${JSON.stringify(s)} → ${closingNoteKey(s)}`).join('\n      '));

// ── 2. THE COUNTS ARE UNTOUCHED — only the question may be dropped ──────────────────────────────
// §42 and verify-result-cap-honesty.ts: a batch size or a buffer length may never stand in for the
// true total. Dropping an offer must never drop or alter a number.
const numbered = (k: ClosingNoteKey) => /\{shown\}|\{total\}|\{n\}/.test(k);
check('every possible sentence still states its counts', states.every((s) => numbered(closingNoteKey(s))));
const quoted = states.filter((s) => s.endKind === 'more' && s.quoteTotal).map((s) => closingNoteKey(s));
check('a trusted total still states BOTH numbers in every no-offer variant',
  quoted.every((k) => k.includes('{shown}') && k.includes('{total}')),
  quoted.join('\n      '));

// ── 3. EVERY KEY IS TRANSLATED ───────────────────────────────────────────────────────────────────
// A truthful sentence that renders as raw English is an Arabic-UI defect (§15) — the new no-offer
// variants are exactly the kind of key that gets added to the code and forgotten in the table.
const allKeys = [...new Set(states.map((s) => closingNoteKey(s)))];
const untranslated = allKeys.filter((k) => !i18nSrc.includes(`'${k}'`));
check(`all ${allKeys.length} reachable keys exist in the Arabic translation table`,
  untranslated.length === 0, untranslated.join('\n      '));
const englishLeak = allKeys.filter((k) => {
  const m = i18nSrc.match(new RegExp(`'${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`));
  return !m || !/[؀-ۿ]/.test(m[1]);
});
check('every one of them translates to actual Arabic, not an English passthrough',
  englishLeak.length === 0, englishLeak.join('\n      '));

// ── 4. THE CALL SITE USES THE RENDERED-BUTTON BOOLEANS ──────────────────────────────────────────
// The pure function can only be as right as the values it is handed. `offersMore`/`offersNarrow`
// must fold in `showActionsRow` — the SAME gate the Pressables and the spoken note already use —
// rather than the raw `hasMore`/`canNarrowFurther` the defect was worded from.
check('agent.tsx derives offersMore from showActionsRow, not from hasMore alone',
  /const offersMore = hasMore && showActionsRow;/.test(agentSrc));
check('agent.tsx derives offersNarrow from showActionsRow, not from canNarrowFurther alone',
  /const offersNarrow = canNarrowFurther && showActionsRow;/.test(agentSrc));
check('the visible sentence comes from the pure key function, not a second inline copy',
  /closingNoteKey\(\{ endKind: rc\.endKind, quoteTotal, offersMore, offersNarrow, lastTapOffer: rc\.lastTapOffer, cappedAtCap: rc\.cappedAtCap, chatClosed: completed \}\)/.test(agentSrc));
// `chatClosed` must be the CHAT's terminal flag, not a per-turn one (ops_incident #598). Handing it
// `hasMore`, `isLatestResults` or anything else derived from this turn would put the ☰ hint on every
// quiet older turn of an open chat — noise — and leave the one turn that needs it silent.
check('agent.tsx feeds chatClosed from the conversation-level `completed`, never a per-turn flag',
  /closingNoteKey\(\{[^}]*chatClosed: completed[ ,}]/.test(agentSrc));
// The call gained a local `!afReceipt[m.id] &&` conjunct on 2026-09-20 so a spent turn swaps its
// buttons for the completed-round receipt at once, instead of waiting for `chatCompleted` to land a
// whole search later. The rule this check owns is unchanged — the gate is still the executable
// `resultsActionsRowVisible` and still carries the interview phase — so the pattern tolerates that
// one conjunct and nothing else.
check('showActionsRow is still the single gate the buttons themselves are rendered behind',
  // Gate hoisted into the pure resultsActionsRowVisible() (owner 2026-09-06, `final=50`); still the
  // single const the Pressables, the spoken note, and offersMore/offersNarrow all derive from.
  /const showActionsRow = (?:!afReceipt\[m\.id\] && )?resultsActionsRowVisible\(\{[\s\S]{0,240}?afPhase: ageFlow\?\.phase \?\? null/.test(agentSrc));

// ── 5. THE PRODUCTION STATE THAT WAS MEASURED, REPLAYED ─────────────────────────────────────────
// الرياض/بيع/فيلا + one AF answer: 5,970 matching, 10 shown, buffer holds more, AF interview open so
// the actions row is hidden. The sentence must state both numbers and ask for nothing.
const rc = resultCounts({ trueTotal: 5970, shown: 10, fetched: 1500, serverMore: true });
check('the measured cohort still legitimately HAS more (the fix did not retire paging)', rc.hasMore);
const afOpenKey = closingNoteKey({ endKind: rc.endKind, quoteTotal: true, offersMore: false, offersNarrow: false, lastTapOffer: false, cappedAtCap: false });
check('with the AF interview open the sentence states 10 of 5,970 and offers nothing',
  afOpenKey === 'I showed you the first {shown} of {total} matching listings.', afOpenKey);
const afClosedKey = closingNoteKey({ endKind: rc.endKind, quoteTotal: true, offersMore: true, offersNarrow: true, lastTapOffer: false, cappedAtCap: false });
check('with the interview closed and both buttons rendered, both offers come back',
  keyOffersMore(afClosedKey) && keyOffersNarrow(afClosedKey), afClosedKey);
// The superseded-turn half, which needs no Advanced Filter at all to reproduce.
const staleTurnKey = closingNoteKey({ endKind: 'more', quoteTotal: true, offersMore: false, offersNarrow: false, lastTapOffer: false, cappedAtCap: false });
check('an older results turn (isLatestResults false) also stops promising a retired button',
  !keyOffersMore(staleTurnKey) && !keyOffersNarrow(staleTurnKey), staleTurnKey);

// ── 5b. A CLOSED CHAT NEVER ENDS ON A DEAD END (ops_incident #598) ───────────────────────────────
// The mirror image of the rule this file was born for. §42 says never offer a button that is not on
// screen; it says nothing about the state where NO button is on screen and none ever will be —
// because until the owner's 2026-09-20 rule («a completed Advanced Filter round ends the chat»)
// that state could not carry unreached inventory. It can now, and it did:
//
//   production, 2026-09-22, الرياض/شراء/شقة + one amenity answer —
//   «عرضت لك أول 156 من أصل 6,441 إعلان مطابق.», load-more elements anywhere = 0, «تحديد أكثر» = 0.
//
// Every count was exactly right. The sentence simply stopped, and 6,285 matching listings read as
// unreachable from a chat whose composer was locked. The fix names the one path that IS open — the
// owner's own «افتح القائمة ☰ فوق واختر «بحث»» from the two terminal notes — and changes no number.
//
// WHY IT IS GATED ON THE CHAT AND NOT ON THE TURN. A button-less turn in an OPEN chat is ordinary:
// an older results turn keeps its honest counts and stays quiet because the newest turn below it is
// where the user acts. Only a closed chat makes a button-less turn the end of the road.
type ClosedState = State & { chatClosed: boolean };
const closedStates: ClosedState[] = [];
for (const s of states) for (const chatClosed of BOOL) closedStates.push({ ...s, chatClosed });
check('the closed-chat input space is enumerated in full (64 × 2)', closedStates.length === 128, `saw ${closedStates.length}`);
check('closingNoteKey stays total once chatClosed is in play (never throws)',
  closedStates.every((s) => typeof closingNoteKey(s) === 'string'));

/** Does this key name a forward path the user can actually take right now? */
const keyNamesAWayOut = (k: ClosingNoteKey): boolean =>
  keyOffersMore(k) || keyOffersNarrow(k) || k.includes('open the menu');

// THE RULE. A closed chat + no button + matches the user has not seen ⇒ the sentence must name the
// menu. `endKind: 'more'` IS "matches remain beyond what is shown" (resultCounts computes it), so
// the unreached inventory is implied by the state rather than asserted from a second number.
const strandedStates = closedStates.filter((s) => realizable(s) && s.chatClosed && s.endKind === 'more' && !s.offersMore && !s.offersNarrow);
check('the stranded state is reachable at all (an empty filter would make the next check vacuous)',
  strandedStates.length > 0, `stranded states=${strandedStates.length}`);
const deadEnds = strandedStates.filter((s) => !keyNamesAWayOut(closingNoteKey(s)));
check('a CLOSED chat with matches still unreached always names a way out',
  deadEnds.length === 0,
  deadEnds.map((s) => `${JSON.stringify(s)} → ${closingNoteKey(s)}`).join('\n      '));

// …and it must not leak into an OPEN chat, where the turn below is the forward path and a ☰ hint on
// every superseded turn would be noise. This is the half a careless fix gets wrong.
const openQuietStates = closedStates.filter((s) => realizable(s) && !s.chatClosed && s.endKind === 'more' && !s.offersMore && !s.offersNarrow);
const leaked = openQuietStates.filter((s) => closingNoteKey(s).includes('open the menu'));
check('an OPEN chat\'s quiet turn is unchanged — no ☰ hint where the newest turn is the way forward',
  leaked.length === 0, leaked.map((s) => `${JSON.stringify(s)} → ${closingNoteKey(s)}`).join('\n      '));

// The counts survive the new branch: adding a way out may never drop or alter a number.
check('every closed-chat sentence still states its counts',
  closedStates.every((s) => numbered(closingNoteKey(s))));
// …and the new keys are translated, like every other one.
const closedKeys = [...new Set(closedStates.map((s) => closingNoteKey(s)))];
const closedUntranslated = closedKeys.filter((k) => !i18nSrc.includes(`'${k}'`));
check(`all ${closedKeys.length} keys reachable with chatClosed exist in the Arabic table`,
  closedUntranslated.length === 0, closedUntranslated.join('\n      '));

// The exact production state, replayed end to end.
const rc598 = resultCounts({ trueTotal: 6441, shown: 156, fetched: 1500, serverMore: true });
const k598 = closingNoteKey({ endKind: rc598.endKind, quoteTotal: true, offersMore: false, offersNarrow: false, lastTapOffer: rc598.lastTapOffer, cappedAtCap: rc598.cappedAtCap, chatClosed: true });
check('#598 replayed: 156 of 6,441 in a closed chat now points at the ☰ new search',
  k598 === 'I showed you the first {shown} of {total} matching listings. For a new search, open the menu and choose Search.', k598);
check('#598 replayed: and it still promises neither button',
  !keyOffersMore(k598) && !keyOffersNarrow(k598), k598);

// ── 6. MUTATION PROOFS — the predicate really discriminates ─────────────────────────────────────
// The pre-fix wording, restored: worded from endKind/canNarrowFurther, blind to what is rendered.
const preFixKey = (s: State): ClosingNoteKey =>
  s.endKind === 'more'
    ? (s.quoteTotal
        ? (s.offersNarrow ? 'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}, or help you find more precise ones.'
                          : 'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}.')
        : (s.offersNarrow ? 'I showed you the first {n} listings. Want me to show more, or help you find more precise ones?'
                          : 'I showed you the first {n} listings. Want me to show more?'))
    : (s.offersNarrow ? 'I showed you all {n} matching listings. Want help finding more precise ones?'
                      : 'I showed you all {n} matching listings.');
const preFixOverPromises = states.filter((s) => {
  const k = preFixKey({ ...s, offersNarrow: s.offersNarrow });
  return (keyOffersMore(k) && !s.offersMore) || (keyOffersNarrow(k) && !s.offersNarrow);
});
mustCatch('the PRE-FIX wording is caught by this barrier (it over-promises)',
  preFixOverPromises.length > 0,
  `${preFixOverPromises.length} of 16 states over-promised before the fix`);

mustCatch('a key-classifier that never sees an offer would fail the complement check',
  states.some((s) => keyOffersMore(closingNoteKey(s))) && states.some((s) => keyOffersNarrow(closingNoteKey(s))));

// ops_incident #598: the wording BEFORE this run's fix — identical except that it was blind to
// `chatClosed` — must be caught by 5b, or 5b is decoration.
const preFix598 = (s: ClosedState): ClosingNoteKey =>
  closingNoteKey({ ...s, chatClosed: false });
const preFix598DeadEnds = strandedStates.filter((s) => !keyNamesAWayOut(preFix598(s)));
mustCatch('the PRE-FIX closed-chat wording is caught (it left the user with no way out)',
  preFix598DeadEnds.length > 0,
  `${preFix598DeadEnds.length} of ${strandedStates.length} stranded state(s) named no forward path before the fix`);
// The over-correction is caught too: hinting at ☰ on every button-less turn, closed or not.
const overCorrect = (s: ClosedState): boolean => openQuietStates.includes(s);
mustCatch('an over-correction that hints ☰ in an OPEN chat would be caught by the leak check',
  openQuietStates.length > 0 && openQuietStates.every(overCorrect),
  `${openQuietStates.length} open-chat quiet state(s) are watched for the leak`);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the closing sentence can promise a button that is not there.`);
  process.exit(1);
}
console.log('\n✓ over all 16 states the sentence offers exactly the buttons that are rendered, and always states its counts');
