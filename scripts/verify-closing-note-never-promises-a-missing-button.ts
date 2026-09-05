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
type State = { endKind: EndKind; quoteTotal: boolean; offersMore: boolean; offersNarrow: boolean };
const states: State[] = [];
for (const endKind of KINDS) for (const quoteTotal of BOOL) for (const offersMore of BOOL) for (const offersNarrow of BOOL)
  states.push({ endKind, quoteTotal, offersMore, offersNarrow });

check('the input space is enumerated in full (2 × 2 × 2 × 2)', states.length === 16, `saw ${states.length}`);

const overPromises = states.filter((s) => {
  const k = closingNoteKey(s);
  return (keyOffersMore(k) && !s.offersMore) || (keyOffersNarrow(k) && !s.offersNarrow);
});
check('NO state produces a sentence offering an action that is not rendered',
  overPromises.length === 0,
  overPromises.map((s) => `${JSON.stringify(s)} → ${closingNoteKey(s)}`).join('\n      '));

// The complement matters too: with the button genuinely on screen the invitation must still be made,
// or the fix would have silently retired a working affordance instead of telling the truth about it.
const underPromises = states.filter((s) => {
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
  /closingNoteKey\(\{ endKind: rc\.endKind, quoteTotal, offersMore, offersNarrow \}\)/.test(agentSrc));
check('showActionsRow is still the single gate the buttons themselves are rendered behind',
  /const showActionsRow = \(hasMore \|\| canNarrowFurther\)\s*\n\s*&& !afInterviewOwnsBrowsing\(ageFlow\?\.phase \?\? null\);/.test(agentSrc));

// ── 5. THE PRODUCTION STATE THAT WAS MEASURED, REPLAYED ─────────────────────────────────────────
// الرياض/بيع/فيلا + one AF answer: 5,970 matching, 10 shown, buffer holds more, AF interview open so
// the actions row is hidden. The sentence must state both numbers and ask for nothing.
const rc = resultCounts({ trueTotal: 5970, shown: 10, fetched: 1500, serverMore: true });
check('the measured cohort still legitimately HAS more (the fix did not retire paging)', rc.hasMore);
const afOpenKey = closingNoteKey({ endKind: rc.endKind, quoteTotal: true, offersMore: false, offersNarrow: false });
check('with the AF interview open the sentence states 10 of 5,970 and offers nothing',
  afOpenKey === 'I showed you the first {shown} of {total} matching listings.', afOpenKey);
const afClosedKey = closingNoteKey({ endKind: rc.endKind, quoteTotal: true, offersMore: true, offersNarrow: true });
check('with the interview closed and both buttons rendered, both offers come back',
  keyOffersMore(afClosedKey) && keyOffersNarrow(afClosedKey), afClosedKey);
// The superseded-turn half, which needs no Advanced Filter at all to reproduce.
const staleTurnKey = closingNoteKey({ endKind: 'more', quoteTotal: true, offersMore: false, offersNarrow: false });
check('an older results turn (isLatestResults false) also stops promising a retired button',
  !keyOffersMore(staleTurnKey) && !keyOffersNarrow(staleTurnKey), staleTurnKey);

// ── 6. MUTATION PROOFS — the predicate really discriminates ─────────────────────────────────────
// The pre-fix wording, restored: worded from endKind/canNarrowFurther, blind to what is rendered.
const preFixKey = (s: State): ClosingNoteKey =>
  s.endKind === 'more'
    ? (s.quoteTotal
        ? (s.offersNarrow ? 'I showed you the first {shown} of {total} matching listings. Want me to show more, or help you find more precise ones?'
                          : 'I showed you the first {shown} of {total} matching listings. Want me to show more?')
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

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the closing sentence can promise a button that is not there.`);
  process.exit(1);
}
console.log('\n✓ over all 16 states the sentence offers exactly the buttons that are rendered, and always states its counts');
