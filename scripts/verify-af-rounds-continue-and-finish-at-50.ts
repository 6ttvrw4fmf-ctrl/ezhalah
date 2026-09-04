// THE ADVANCED FILTER NARROWS IN ROUNDS UNTIL ≤ 50 OR NOTHING TRUTHFUL REMAINS (owner product rule
// 2026-09-04), and it never repeats an answered or skipped question, never invents one, and never
// shows a stale selection.
//
//   > 50 results  → keep offering NEW certified, unasked questions in rounds, automatically, using
//                   different unanswered fields, until ≤ 50 or genuinely nothing truthful is left.
//   ≤ 50 results  → stop, reveal every remaining listing (no «عرض المزيد»), finish the chat
//                   (composer replaced by «محادثة جديدة»).
//   > 50, nothing → say so out loud and show the genuine results — never guess, never lock the chat.
//   skipped       → stays skipped for the whole AF session; answered → never re-asked; Back and
//                   pill-removal keep working through the same carry.
//   the card      → its selection reflects the CURRENT question only (stale-state fix).
//
// Executes the pure modules where a pure module exists (afRanking, initialReveal, afSteps) and pins
// the executable shape of agent.tsx / the card elsewhere, comments stripped first. The behaviour is
// production-proven on the exact 2026-09-04 journey (Riyadh → Buy → Residential → apartments).
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

console.log('\nAdvanced Filter rounds: continue while truthful, finish at ≤ 50, never repeat, never stale (owner 2026-09-04)\n');

// ── 1. The stop line, EXECUTED ───────────────────────────────────────────────────────────────────
check(`INTERVIEW_STOP_AT is 50 (got ${INTERVIEW_STOP_AT})`, INTERVIEW_STOP_AT === 50);
check('MIN_TOTAL_TO_SHOW is the stop line + 1 (a question is asked only ABOVE 50)', MIN_TOTAL_TO_SHOW === 51);
const FP = 10;
check('≤ 50 reveals EVERY fetched listing (honestTotal 50 → 50 revealed; 37 → 37) — no «عرض المزيد» on a finished set',
  initialReveal({ fetched: 50, honestTotal: 50, firstPage: FP, stopAt: INTERVIEW_STOP_AT }) === 50
  && initialReveal({ fetched: 37, honestTotal: 37, firstPage: FP, stopAt: INTERVIEW_STOP_AT }) === 37);
check('51 is NOT a finished set: first page only', initialReveal({ fetched: 51, honestTotal: 51, firstPage: FP, stopAt: INTERVIEW_STOP_AT }) === FP);
const agent = stripComments(read('src/app/agent.tsx'));
check('agent.tsx feeds initialReveal the canonical stop line (stopAt: INTERVIEW_STOP_AT), never a retyped number',
  /stopAt: INTERVIEW_STOP_AT/.test(agent) && !/stopAt: 25\b/.test(agent) && !/stopAt: 50\b/.test(agent));

// ── 2. ≤ 50 completes the chat; > 50 continues through the ONE shared assessment ────────────────
const fin = agent.slice(agent.indexOf('const finishGuided = '), agent.indexOf('const startAgeFlow = '));
check('finishGuided exists', fin.length > 200);
check('R11.1: a round landing at ≤ INTERVIEW_STOP_AT completes the chat (composer → «محادثة جديدة»)',
  /if \(total != null && total <= INTERVIEW_STOP_AT\) setCompleted\(true\);/.test(fin));
check('> INTERVIEW_STOP_AT: the SAME assessment the offer button uses decides whether a round follows',
  /total > INTERVIEW_STOP_AT && continueGuided && msgId/.test(fin)
  && /assessNarrowing\(continueQ, continueGuided\.asked\)/.test(fin));
check("only a 'yes' verdict continues — 'no' and 'unknown' never open a round (nothing is invented)",
  /if \(!stillMining\(\) \|\| verdict !== 'yes'\) return;/.test(fin));
check('the next round CARRIES the origin, every committed facet and every answered-or-skipped id (no repeats)',
  /afCarryRef\.current = \{ msgId, originQ: continueGuided\.baseQ, facets: continueGuided\.facets, asked: continueGuided\.asked \};/.test(fin)
  && /void startAgeFlow\(continueQ\);/.test(fin));
check('the continuation is bound to the round token — a superseded flow can never auto-open a round',
  /if \(ageFlowTokenRef\.current !== token\) return;\s*afCarryRef\.current = \{ msgId/.test(fin));
check('the continuation waits for the count to land and read (AF_NEXT_ROUND_DELAY_MS), it does not pre-empt the results',
  /AF_NEXT_ROUND_DELAY_MS/.test(fin) && /const AF_NEXT_ROUND_DELAY_MS = \d+;/.test(agent));

// ── 3. > 50 with nothing truthful left is SAID, not silently completed ──────────────────────────
check('a MEASURED "no" after an AF round posts the spoken line (i18n key present in both languages)',
  /verdict === 'no' && afCarryRef\.current && !noMoreSaidRef\.current\[m\.id\]/.test(agent)
  && read('src/i18n.tsx').includes("'No further truthful narrowing question exists for this scope — these are all the genuine matches.': 'ما فيه سؤال إضافي موثوق"));
check('…and does NOT complete the chat (setCompleted(true) has exactly ONE site: the ≤ 50 rule)',
  (agent.match(/setCompleted\(true\)/g) ?? []).length === 1);
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
  !read('scripts/test-exclusions.txt').includes('verify-af-rounds-continue-and-finish-at-50'));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — the interview can again stop early, repeat a question, lock a big set, or show a stale selection`
  : '\n✓ rounds continue only through the shared assessment while > 50; ≤ 50 finishes and reveals all; nothing truthful left is SAID; skipped/answered never repeat; the card never shows a stale selection');
process.exit(failed ? 1 : 0);
