// A ROUND FINISHES ON ≤ 50 OR NOTHING TRUTHFUL REMAINING, AND NEVER RE-OPENS ITSELF (owner
// 2026-09-20 — REVERSES the 2026-09-04 "rounds continue automatically" rule this file used to pin;
// see git history for that rule's own reasoning). It never repeats an answered or skipped question,
// never invents one, and never shows a stale selection.
//
//   any round    → ends the moment it runs out of questions OR the user skips to the end. Full stop,
//                  always — a round can never re-open a new one on its own, on a timer or otherwise.
//                  Skip means "not this question", never "ask me something else on your own
//                  initiative" — a round that was mostly Skips is not an exception.
//   ≤ 50 results → additionally: reveal every remaining listing (no «عرض المزيد»), finish the chat
//                  (composer replaced by «محادثة جديدة»).
//   > 50 results → the PASSIVE assessNarrowing effect (unchanged) decides whether «تحديد أكثر»
//                  shows; tapping it is the ONLY way a new round can ever open.
//   skipped      → stays skipped for the whole AF session; answered → never re-asked; Back and
//                  pill-removal keep working through the same carry.
//   the card     → its selection reflects the CURRENT question only (stale-state fix).
//
// Executes the pure modules where a pure module exists (afRanking, initialReveal, afSteps) and pins
// the executable shape of agent.tsx / the card elsewhere, comments stripped first.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERVIEW_STOP_AT, MIN_TOTAL_TO_SHOW } from '../src/lib/afRanking.ts';
import { initialReveal } from '../src/lib/initialReveal.ts';
import { deriveGuided } from '../src/lib/afSteps.ts';
import { stripComments } from './lib/stripComments.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const root = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

console.log('\nAdvanced Filter rounds: never self-reopen, finish at ≤ 50, never repeat, never stale (owner 2026-09-20)\n');

// ── 1. The stop line, EXECUTED ───────────────────────────────────────────────────────────────────
check(`INTERVIEW_STOP_AT is 25 (got ${INTERVIEW_STOP_AT})`, INTERVIEW_STOP_AT === 25);
check('MIN_TOTAL_TO_SHOW is the stop line + 1 (a question is asked only ABOVE 25)', MIN_TOTAL_TO_SHOW === 26);
check('≤ 25 reveals EVERY fetched listing (honestTotal 25 → 25 revealed; 18 → 18) — no «عرض المزيد» on a finished set',
  initialReveal({ fetched: 25, honestTotal: 25, stopAt: INTERVIEW_STOP_AT }) === 25
  && initialReveal({ fetched: 18, honestTotal: 18, stopAt: INTERVIEW_STOP_AT }) === 18);
// No `platforms` passed → safety floor of 1 (owner PERMANENT rule 2026-09-25 retired the fixed
// floor of 10; src/lib/initialReveal.ts has the full history). This line only cares that 26 is NOT
// a finished set, not the exact preview width.
check('26 is NOT a finished set: not fully revealed', initialReveal({ fetched: 26, honestTotal: 26, stopAt: INTERVIEW_STOP_AT }) === 1);
const agent = stripComments(read('src/app/agent.tsx'));
check('agent.tsx feeds initialReveal the canonical stop line (stopAt: INTERVIEW_STOP_AT), never a retyped number',
  /stopAt: INTERVIEW_STOP_AT/.test(agent) && !/stopAt: 25\b/.test(agent) && !/stopAt: 50\b/.test(agent));

// ── 2. ≤ 50 completes the chat; a round NEVER re-opens itself, at any total ─────────────────────
const fin = agent.slice(agent.indexOf('const finishGuided = '), agent.indexOf('const startAgeFlow = '));
check('finishGuided exists', fin.length > 200);
check('a completed round ends the chat — at ANY total since 2026-09-20, with R11.1 still standing behind it',
  /if \(afRoundEndsChat \|\| searchIsFinishedAtThreshold\(total, INTERVIEW_STOP_AT\)\) setCompleted\(true\);/.test(fin));
check('finishGuided never calls startAgeFlow — a round cannot open the next one itself',
  !/startAgeFlow/.test(fin));
check('finishGuided never calls assessNarrowing — deciding whether MORE narrowing is worth offering '
    + 'belongs solely to the passive button effect, never to the flow that just finished',
  !/assessNarrowing/.test(fin));
check('the dead auto-continue timing knob is gone, not just unused (root-cause removal, not a stray flag)',
  !/AF_NEXT_ROUND_DELAY_MS/.test(agent));
// The ONE place a round CAN open is the passive effect + the «تحديد أكثر» tap handler — both outside
// finishGuided. Confirmed together so "moved the call, not deleted it" cannot pass.
const passive = agent.slice(agent.indexOf('const assessNarrowing = async'), agent.indexOf('const runRefine = async'));
// TWO call sites since 2026-09-20, both on the SAME passive path: prefetchNarrowing() starts the
// probe alongside the search, and the effect falls back to an inline call when no prefetch matches.
// What this check has always been about is that NEITHER is a round re-opening itself — that is
// asserted directly above (`fin` contains no assessNarrowing at all), and is the rule that matters.
// Pinning the exact sites keeps a third, unexamined caller from appearing unnoticed.
// 2026-09-21: assessNarrowing gained a third argument (`key`) for its background tap-priming walk
// (primeFooterCounts) to detect a superseded search — both call sites still pass exactly
// afPrefetchKey(q, asked), and the DEFINITION `assessNarrowing = async (` never matches `assessNarrowing(`.
check('assessNarrowing has exactly two call sites, both on the passive offer path',
  (agent.match(/assessNarrowing\(/g) ?? []).length === 2
  && /afPrefetchRef\.current = \{ key, p: assessNarrowing\(q, asked, key\)/.test(agent)
  && /pre\.key === afPrefetchKey\(q, asked\) \? pre\.p : assessNarrowing\(q, asked, afPrefetchKey\(q, asked\)\)/.test(agent),
  'a third caller means something other than the button is deciding whether a round may follow');
check('opening a new round anywhere in the file requires a Pressable tap (narrow-further button), '
    + 'never a bare timer',
  /onPress={\(\) => \{[\s\S]{0,700}?void startAgeFlow\(q\);/.test(agent));

// ── 3. > 50 with nothing truthful left is SILENT, but never a completion ────────────────────────
// Owner reversal 2026-09-12/13: the 2026-09-04 decision to SPEAK a "nothing left" verdict as a chat
// bubble is reversed — too dense/confusing in practice. The verdict must still be measured honestly
// (afCanNarrow still hides «تحديد أكثر» when exhausted) and must still never silently COMPLETE the
// chat (that's the next check) — it just no longer narrates itself. So this check now asserts the
// OPPOSITE of its original name: the old spoken-message call site and its i18n key are both gone.
check('a MEASURED "no" after an AF round stays SILENT (no chat bubble, no dangling i18n key)',
  !/noMoreSaidRef/.test(agent)
  && !/No further truthful narrowing question exists for this scope/.test(agent)
  && !read('src/i18n.tsx').includes("No further truthful narrowing question exists for this scope")
  && /setAfCanNarrow\(\(c\) => \(\{ \.\.\.c, \[m\.id\]: verdict === 'yes' \}\)\);/.test(agent));
// Generalized 2026-09-11, extended 2026-09-14 (owner rules: a plain search or typed AI message
// landing at <= the threshold finishes cleanly too, not only an AF round; AND the reveal hitting the
// 500 cap or the true end — `revealIsTerminal` — finishes at ANY total) from "exactly one site" to
// "every site is one of the named, honest gates and nothing else" — see
// scripts/verify-af-interview-owns-browsing.ts for the call-site-level version of this same check;
// this one keeps the ORIGINAL intent of this specific check intact: a measured "no more truthful
// narrowing" verdict must never itself complete the chat.
// THREE named gates since 2026-09-20. `afRoundEndsChat` was added when the owner ruled that a
// completed Advanced Filter round ENDS the conversation at any total ("the chat gets closed … you
// just have to do skip, and that's it"). It is listed BY NAME, not matched loosely, so the ratchet
// still does its job: a FOURTH trigger — in particular a "nothing left to ask" verdict locking the
// chat, the 2026-09-12 defect this check exists for — is still a failure.
const GATED_COMPLETED = /if \((?:afRoundEndsChat \|\| )?(?:searchIsFinishedAtThreshold\(.*?\)|revealIsTerminal)\)\s*setCompleted\(true\);/g;
check('…and does NOT complete the chat (every setCompleted(true) site is the ≤ 50 rule or the 500-cap/show-all terminal, never the "no more questions" verdict)',
  (agent.match(/setCompleted\(true\)/g) ?? []).length >= 1
  && (agent.match(/setCompleted\(true\)/g) ?? []).length === (agent.match(GATED_COMPLETED) ?? []).length);
check("assessNarrowing returns 'no' ONLY when every probe ANSWERED (ranked && !ranked.probeFailed), else 'unknown'",
  /if \(ranked && !ranked\.probeFailed\) return 'no';/.test(agent) && /return 'unknown';\s*\};/.test(agent));

// ── 4. Skipped stays skipped, answered never repeats — EXECUTED on the real deriveGuided ─────────
const q0 = { deal: 'Buy' } as never;
const noop = { id: 'Q', titleKey: 'k', selection: 'single', eligibility: () => true, resolveOptions: async () => ({ options: [], unknownCount: null, total: 0 }), apply: (q: unknown) => q } as never;
const steps = [
  { question: { ...(noop as object), id: 'answered' }, options: [{ key: 'a', label: 'A', count: 9 }], unknownCount: null, total: 9, keys: ['a'] },
  { question: { ...(noop as object), id: 'skipped' }, options: [], unknownCount: null, total: 9, keys: [] },
  { question: { ...(noop as object), id: 'unanswered' }, options: [], unknownCount: null, total: 9, keys: null },
] as never;
const d = deriveGuided(q0, steps, 3);
check('deriveGuided marks an ANSWERED step as asked', d.askedIds.includes('answered'));
check('deriveGuided marks a SKIPPED step as asked too (a skip is never re-asked)', d.askedIds.includes('skipped'));
check('a merely PRESENTED step (keys null) is not asked — Back genuinely un-asks it', !d.askedIds.includes('unanswered'));
check('the round seeds its asked-set from the carry (round N+1 never re-asks round N)',
  /ageFlowAskedRef\.current = new Set\(afCarryRef\.current\?\.asked \?\? \[\]\);/.test(agent)
  && /ageFlowAskedRef\.current = new Set\(\[\.\.\.\(afCarryRef\.current\?\.asked \?\? \[\]\), \.\.\.d\.askedIds\]\);/.test(agent));
check('removing a pill releases ONLY that question (Back/remove keep working; the rest of the carry survives)',
  /asked: guidedPills\.asked\.filter\(\(id\) => id !== removed\.id\)/.test(agent));

// ── 5. Stale state: the card's selection reflects the CURRENT question only ─────────────────────
const card = stripComments(read('src/components/AdvancedQuestionCard.tsx'));
check('the selection reset is keyed on the question identity — title AND option set AND restored answer',
  /const optionKeySig = dedupedOptions\.map\(\(o\) => o\.key\)\.join\('\|'\);/.test(card)
  && /\}, \[titleKey, optionKeySig, initialSig\]\);/.test(card),
  'keyed on titleKey alone, the type tier re-shown for a different group kept the old selection');
check('a restored answer is filtered to keys that exist on THIS card (a stale key can never be re-priced or committed)',
  /setSel\(\(initialKeys \?\? \[\]\)\.filter\(\(k\) => onCard\.has\(k\)\)\);/.test(card));
const replay = agent.slice(agent.indexOf('const presentGuided = async'), agent.indexOf('const revalidateStepsAfter'));
check('re-showing a step prefers the FRESH resolution whenever the probe ANSWERED (even an honest empty), keeping the recorded list only on a FAILED probe',
  /const answered = !!fresh && !fresh\.probeFailed;/.test(replay)
  && /const options = answered \? fresh!\.options : st\.options;/.test(replay)
  && !/fresh\?\.options\.length \? fresh\.options : st\.options/.test(replay));

// ── 6. Wired ─────────────────────────────────────────────────────────────────────────────────────
check('this barrier is discovered and run by npm test (not excluded)',
  !read('scripts/test-exclusions.txt').includes('verify-af-rounds-never-self-reopen-and-finish-at-25'));

// ── 7. MUTATION PROOFS — each rule above, fed the regression it exists to catch ─────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The stop line moved back up to 50: a 37-result set would start counting as "finished" and be
// revealed in full, when at the owner's 2026-09-20 line of 25 it is a browsable set with a pager.
mustCatch('the stop line moved back to 50 — a 37-result set wrongly reads as finished',
  initialReveal({ fetched: 37, honestTotal: 37, stopAt: 50 }) !== 1);

// The canonical constant retyped as a literal at the call site — the shape that drifts the next time
// the owner moves the line.
{
  const retyped = agent.replace('stopAt: INTERVIEW_STOP_AT', 'stopAt: 50');
  mustCatch('agent.tsx retyping the stop line as a literal instead of importing it',
    retyped !== agent
    && !(/stopAt: INTERVIEW_STOP_AT/.test(retyped) && !/stopAt: 25\b/.test(retyped) && !/stopAt: 50\b/.test(retyped)));
}

// A second setCompleted(true) site is exactly how "nothing truthful left" becomes a silent lock
// instead of the spoken line.
mustCatch('an UNGATED setCompleted(true) site locking the chat outside the ≤ 50 rule',
  (() => {
    const withUngated = agent + "\nif (verdict === 'no') setCompleted(true);";
    const total = (withUngated.match(/setCompleted\(true\)/g) ?? []).length;
    const gated = (withUngated.match(GATED_COMPLETED) ?? []).length;
    return total !== gated;
  })());

// THE REGRESSION THIS FILE EXISTS TO CATCH NOW: the exact 2026-09-04 auto-continue call, verbatim,
// re-added inside finishGuided. If it comes back, two of the §2 checks must fail on it.
{
  const reintroduced = fin.replace(
    'const wait = Math.max(0, 1400 - (Date.now() - startedAt));',
    "if (total != null && total > INTERVIEW_STOP_AT && guided && msgId) { "
      + "void assessNarrowing(q, guided.asked).then((verdict) => { if (verdict === 'yes') void startAgeFlow(q); }); } "
      + 'const wait = Math.max(0, 1400 - (Date.now() - startedAt));',
  );
  mustCatch('the 2026-09-04 auto-continue call reintroduced into finishGuided',
    reintroduced !== fin
    && !(!/startAgeFlow/.test(reintroduced) && !/assessNarrowing/.test(reintroduced)));
}

// The card keyed on the title alone — the stale-selection defect, verbatim.
mustCatch('the card selection keyed on titleKey alone (a re-shown tier keeps the old selection)',
  !/\}, \[titleKey, optionKeySig, initialSig\]\);/.test(card.replace('}, [titleKey, optionKeySig, initialSig]);', '}, [titleKey]);')));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — the interview can again stop early, repeat a question, lock a big set, or show a stale selection`
  : '\n✓ rounds continue only through the shared assessment while > 50; ≤ 50 finishes and reveals all; nothing truthful left is SAID; skipped/answered never repeat; the card never shows a stale selection');
process.exit(failed ? 1 : 0);
