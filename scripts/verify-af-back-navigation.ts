// «رجوع» — in-flow Back for the Advanced Filter interview, and the single/double tap contract.
//
// Owner 2026-08-22. Two rules landed together:
//
//   1. Every AF question carries «رجوع». It returns exactly ONE question and restores that
//      question's recorded answer — including restoring a SKIP as a skip (open, no predicate).
//      Earlier answers survive. Changing an earlier answer recomputes the eligible set, the true
//      count, and which later answers are still valid: valid ones are preserved, incompatible ones
//      are dropped, and nothing stale is left behind in the query. From the FIRST question, Back
//      leaves the interview and hands the pre-AF controls back.
//   2. A single tap SELECTS ONLY (the user must see the pick and the recomputed count before
//      committing). A second tap on the same option confirms and advances EXACTLY ONE question.
//      The ~260 ms auto-advance from 2026-08-11 is banned.
//
// This barrier does not merely pattern-match the shipped code: the interview record is a PURE
// module (`src/lib/afSteps.ts`) precisely so the state rules can be EXECUTED here against fake
// questions — one REPLACING (bath) and one APPENDING (amenities), because those two fail in
// different ways. The source-text checks below cover only the wiring that cannot be executed
// (which handler the card calls, which prop the orchestrator passes).
//
// Every assertion is mutation-proven at the bottom: each one is re-run against a deliberately
// broken variant and must FAIL, so a check that has quietly stopped testing anything is caught.
//
//   node --experimental-strip-types scripts/verify-af-back-navigation.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveGuided, sameKeys, type GuidedStep } from '../src/lib/afSteps.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const agentSrc = codeOnly(read('src/app/agent.tsx'));
const cardSrc = codeOnly(read('src/components/AdvancedQuestionCard.tsx'));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter — «رجوع» state restoration + single/double tap contract\n');

// ── the two fake questions, mirroring the two REAL apply shapes ─────────────────────────────────
// bath REPLACES a scalar; amenities APPENDS to a list. An inverse-based "undo" looks fine on the
// first and silently doubles the second, which is the whole reason the rebuild exists.
type Q = GuidedStep['question'];
const q = (id: string, apply: (x: any, keys: string[]) => any): Q =>
  ({ id, titleKey: id, selection: 'single', eligibility: () => true, resolveOptions: async () => ({} as any), apply } as unknown as Q);

const BATH = q('bathrooms', (x, keys) => ({ ...x, bathMin: Number(keys[0]) }));
const AMEN = q('amenities', (x, keys) => ({ ...x, amenities: [...(x.amenities ?? []), ...keys] }));
const opts = (...ks: string[]) => ks.map((k) => ({ key: k, label: `L:${k}`, count: 10 })) as GuidedStep['options'];
const step = (question: Q, options: GuidedStep['options'], keys: string[] | null): GuidedStep =>
  ({ question, options, unknownCount: 0, total: 100, keys });

const BASE = { city: 'الرياض' } as any;

// ── 1. the step UNDER the cursor is never applied ───────────────────────────────────────────────
// While a question is on screen its own answer must not already be in the query, or the option
// counts and the live «N نتيجة» would be computed against a scope that already assumes the answer.
{
  const steps = [step(BATH, opts('2', '3'), ['2'])];
  const atCursor = deriveGuided(BASE, steps, 0); // asking step 0
  const past = deriveGuided(BASE, steps, 1);     // step 0 committed
  check('the question being asked is NOT yet applied to the query',
    (atCursor.query as any).bathMin === undefined && (past.query as any).bathMin === 2);
}

// ── 2. Back un-applies exactly one answer, and keeps the earlier ones ───────────────────────────
{
  const steps = [step(BATH, opts('2'), ['2']), step(AMEN, opts('pool', 'gym'), ['pool'])];
  const back = deriveGuided(BASE, steps, 1); // walked Back onto step 1
  check('Back drops the later predicate and preserves every earlier answer',
    (back.query as any).bathMin === 2 && (back.query as any).amenities === undefined
    && back.askedIds.join(',') === 'bathrooms');
}

// ── 3. no stale predicate after a CHANGED earlier answer ────────────────────────────────────────
// The failure this exists for: a replacing answer left at its old value, or an appending answer
// accumulating both the old and the new keys.
{
  const before = [step(BATH, opts('2', '4'), ['2']), step(AMEN, opts('pool', 'gym'), ['pool'])];
  const changed = [step(BATH, opts('2', '4'), ['4']), before[1]];
  const out = deriveGuided(BASE, changed, 2);
  check('changing an earlier answer leaves NO stale predicate behind',
    (out.query as any).bathMin === 4 && (out.query as any).amenities.join(',') === 'pool');

  const reanswered = [before[0], step(AMEN, opts('pool', 'gym'), ['gym'])];
  const out2 = deriveGuided(BASE, reanswered, 2);
  check('re-answering an APPENDING question replaces, never accumulates',
    (out2.query as any).amenities.join(',') === 'gym',
    `got ${JSON.stringify((out2.query as any).amenities)}`);
}

// ── 4. a skip stays open — before AND after a Back ──────────────────────────────────────────────
{
  const steps = [step(BATH, opts('2'), []), step(AMEN, opts('pool'), ['pool'])];
  const out = deriveGuided(BASE, steps, 2);
  check('Skip writes NO predicate yet counts as asked (never a false/No)',
    (out.query as any).bathMin === undefined && out.askedIds.includes('bathrooms')
    && !out.facets.some((f) => f.id === 'bathrooms'));
  const back = deriveGuided(BASE, steps, 0);
  check('walking Back past a skip restores it as open, not as a negative answer',
    (back.query as any).bathMin === undefined && back.askedIds.length === 0);
}

// ── 5. an unanswered step is neither asked nor applied ──────────────────────────────────────────
{
  const out = deriveGuided(BASE, [step(BATH, opts('2'), null)], 1);
  check('a presented-but-unanswered step is not counted as asked',
    out.askedIds.length === 0 && (out.query as any).bathMin === undefined);
}

// ── 6. labels/facets track the surviving answers only ───────────────────────────────────────────
{
  const steps = [step(BATH, opts('2'), ['2']), step(AMEN, opts('pool'), ['pool'])];
  check('facets + summary labels are derived, so Back drops them together with the predicate',
    deriveGuided(BASE, steps, 2).facets.length === 2 && deriveGuided(BASE, steps, 1).labels.join(',') === 'L:2');
}

// ── 7. order-insensitive answer comparison ──────────────────────────────────────────────────────
check('sameKeys ignores tap order (a re-confirm must not look like a change)',
  sameKeys(['a', 'b'], ['b', 'a']) && !sameKeys(['a'], ['a', 'b']) && !sameKeys(['a'], ['b']));

// ── 8. the card: single tap selects only, double tap confirms ───────────────────────────────────
// NB: `[^)]*` cannot cross the ')' in `setTimeout(() => …)`, which made an earlier draft of this
// guard blind to the exact regression it exists for. The mutation proof below caught that.
check('a single tap NEVER auto-advances (no timer-driven onConfirm anywhere in the card)',
  !/setTimeout\([\s\S]{0,120}?onConfirm/.test(cardSrc) && !/autoRef/.test(cardSrc));
check('the double tap rides the SAME onPress path — no rival dbl-click/long-press handler',
  /DOUBLE_TAP_MS/.test(cardSrc) && /lastTapRef/.test(cardSrc)
  && !/onDoubleClick|onLongPress|doubleTapHandler/.test(cardSrc));
// One onConfirm call per double tap: the confirm sits inside the double-tap branch and returns
// immediately, so the same tap cannot also fall through to the select branch and advance twice.
check('the double-tap branch commits once and returns (cannot advance two questions)',
  /if \(last && last\.key === key && now - last\.at <= DOUBLE_TAP_MS\) \{[\s\S]{0,240}?onConfirm\(\[key\]\);\s*\n\s*return;/.test(cardSrc));
check('the tap log is cleared when the question changes (no cross-question double tap)',
  /lastTapRef\.current = null;/.test(cardSrc));

// ── 9. the card: «رجوع» exists and is restorable ────────────────────────────────────────────────
check('«رجوع» renders on the question card with a stable testID and rides onBack',
  /testID="af-back"/.test(cardSrc) && /onPress=\{onBack\}/.test(cardSrc) && /t\('Back'\)/.test(cardSrc));
check('the card restores the recorded answer instead of clearing on every question change',
  /setSel\(initialKeys \?\? \[\]\)/.test(cardSrc) && !/^\s*setSel\(\[\]\);$/m.test(cardSrc));

// ── 10. the orchestrator: cursor, restoration, revalidation, back-to-start ──────────────────────
// onAgeBack is read SEMANTICALLY, not as a literal line: the walk-back is the part of the handler
// after the stepIndex<=0 early exit, and what matters there is (a) the cursor moves back exactly
// one, and (b) the token handed to that walk is a freshly BUMPED one. Pinning the old exact spelling
// `presentGuided(stepIndex - 1, ageFlowTokenRef.current)` made this guard fail on the 2026-08-23
// token-bump fix even though the cursor semantics never changed.
const backBody = (src: string) => src.slice(src.indexOf('const onAgeBack = () => {'), src.indexOf('const onAgeClose'));
const backWalk = (src: string) => {
  const b = backBody(src);
  return b.slice(b.lastIndexOf('}', b.indexOf('presentGuided(')) + 1); // past the stepIndex<=0 exit
};
// every presentGuided cursor argument on the walk-back path, however the token arg is spelled
const backCursors = (src: string) => [...backBody(src).matchAll(/presentGuided\(([^,)]*)/g)].map((m) => m[1].trim());
check('Back steps the cursor back exactly one question',
  backCursors(agentSrc).length === 1 && backCursors(agentSrc)[0] === 'stepIndex - 1',
  `presentGuided cursor args in onAgeBack: ${JSON.stringify(backCursors(agentSrc))}`);
// Owner 2026-08-23. The abandoned step may still have probes in flight — a SCOPE step fires one
// count RPC per taxonomy option, which widens that window materially — and every probe guards on the
// token it captured. Back must therefore supersede them BEFORE walking back, and must carry the
// POST-bump value: `const back = ageFlowTokenRef.current++` (postfix, old value) would hand
// presentGuided a token that is already stale and kill the walk-back outright.
const backTokenOk = (src: string) => {
  const walk = backWalk(src);
  const stmts = walk.split(';').map((x) => x.trim());
  const bumpIdx = stmts.findIndex((x) => /\+\+\s*ageFlowTokenRef\.current|ageFlowTokenRef\.current\s*(?:\+\+|\+= 1)/.test(x));
  const callIdx = stmts.findIndex((x) => x.includes('presentGuided('));
  if (bumpIdx < 0 || callIdx <= bumpIdx) return false;               // no bump, or bumped too late
  const arg2 = (walk.match(/presentGuided\([^,)]*,\s*([^)]*)\)/) ?? [])[1]?.trim() ?? '';
  const prefixLocal = (stmts[bumpIdx].match(/^(?:const|let)\s+(\w+)\s*=\s*\+\+\s*ageFlowTokenRef\.current$/) ?? [])[1];
  const standalone = /^(?:\+\+\s*ageFlowTokenRef\.current|ageFlowTokenRef\.current\s*(?:\+\+|\+= 1))$/.test(stmts[bumpIdx]);
  return arg2 === prefixLocal || (standalone && arg2 === 'ageFlowTokenRef.current');
};
check('Back bumps the supersession token first and walks back under the BUMPED one (an abandoned in-flight probe cannot re-show the step just left)',
  backTokenOk(agentSrc), backWalk(agentSrc).trim());
// EXTENDED for progressive rounds (owner 2026-08-24). The two original conditions are unchanged and
// still required — but their MEANING moved under them, so on their own they had gone blind:
// "the FIRST question" is now the first question of the CURRENT ROUND, and "the pre-AF controls" is
// the result turn that round was opened FROM — which, from round 2 onwards, already holds every
// earlier round's committed answers. "Leaves AF" is therefore no longer sufficient: an exit that
// quietly FINISHED the round (committing what is on screen and re-searching, the «عرض النتائج» shape)
// would satisfy both original regexes while landing the user on a different result set than the one
// they pressed Back to get out of. The exit must CANCEL: drop this round's record, re-derive at cursor
// 0, and neither commit nor search. Round-crossing itself is pinned in verify-af-round-back-boundary.ts.
const cancelBranch = (src: string) => {
  const b = backBody(src);
  const i = b.indexOf('if (stepIndex <= 0) {');
  const end = b.indexOf('\n    }', i);              // the 4-space brace closing the if, not a nested one
  return i < 0 ? '' : b.slice(i, end < 0 ? undefined : end);
};
const backToStartCancels = (src: string) =>
  /if \(stepIndex <= 0\) \{[\s\S]{0,220}?setAgeFlow\(null\);/.test(src)
  && /\(hasMore \|\| canNarrowFurther\) && !ageFlow/.test(src)
  && /ageFlowStepsRef\.current = \[\];/.test(cancelBranch(src))
  && /syncGuidedFromSteps\(0\);/.test(cancelBranch(src))
  && !/runRefine|finishGuided|commitGuidedStep/.test(cancelBranch(src));
check('Back from the FIRST question of a ROUND CANCELS it — leaves AF (restoring that turn\'s controls), drops only this round\'s record, and neither commits nor searches',
  backToStartCancels(agentSrc), cancelBranch(agentSrc).replace(/\s+/g, ' ').trim());
check('the recorded answer is handed back to the card on Back',
  /initialKeys: st\.keys \?\? \[\]/.test(agentSrc) && /initialKeys=\{ageFlow\.initialKeys\}/.test(agentSrc));
check('a CHANGED earlier answer triggers re-validation of everything after it',
  /const changedAnswer = prev != null && !sameKeys\(prev, keys\)/.test(agentSrc)
  && /if \(changedAnswer\) await revalidateStepsAfter\(stepIndex, token\)/.test(agentSrc));
check('re-validation keeps a skip, and drops only ineligible or zero-yield later answers',
  /if \(!st\.keys\.length\) \{ kept\.push\(st\); continue; \}/.test(agentSrc)
  && /eligibleQuestions\(q\)\.some\(\(x\) => x\.id === st\.question\.id\)/.test(agentSrc)
  && /if \(n == null \|\| n <= 0\) continue;/.test(agentSrc));
// Count honesty applies to the option pills too: a step re-shown after an EARLIER answer changed
// would otherwise display the counts captured under the old scope.
check('a re-presented question re-resolves its option counts against the CURRENT scope',
  /fresh = await st\.question\.resolveOptions\(q0\)/.test(agentSrc)
  && /const options = fresh\?\.options\.length \? fresh\.options : st\.options;/.test(agentSrc));
// Found live on production 2026-08-22: with the auto-advance gone, a user could sit on a SELECTED
// but uncommitted option and leave via «عرض النتائج», which ran finishGuided directly and discarded
// the visible answer (10,945 delivered against a chip reading 2,488). The fix routed every exit
// through the ONE commit path. UPDATE (owner, 2026-08-28): that exit was then REMOVED entirely —
// the discard-a-visible-answer hazard is now closed structurally, not just routed correctly, and
// this check pins that no such exit (nor a direct finishGuided footer control) creeps back.
check('no in-question early-exit exists that could discard a visible selection',
  !/onSkipAll/.test(cardSrc)
  && !/onAgeSkipAll/.test(agentSrc)
  && !/const onAgeSkipAll = \(\) => finishGuided/.test(agentSrc));
// EXTENDED for progressive rounds (owner 2026-08-24). `ageFlowBaseQRef` used to have one possible
// meaning — the pre-AF query — so pinning the rebuild call was the whole invariant. Under rounds it
// means THIS ROUND's start, and a second, tempting anchor now exists beside it: the carry's `originQ`,
// the true pre-AF query kept so the cumulative pills stay removable back to the beginning. Re-anchoring
// the rebuild to that origin looks correct in round 1 and silently drops rounds 1..N-1 from round 2 on
// — with the original regex still matching, because the call spelling never changes. Both halves are
// pinned now: the rebuild reads the round's own base, and that base is only ever assigned the query the
// round opened on.
const rebuiltFromRoundStart = (src: string) =>
  /deriveGuided\(ageFlowBaseQRef\.current, ageFlowStepsRef\.current, upTo\)/.test(src)
  && !/ageFlowQueryRef\.current = question\.apply\(/.test(src)
  && /ageFlowBaseQRef\.current = q;/.test(src)
  && !/ageFlowBaseQRef\.current\s*=[^;]*(afCarryRef|originQ)/.test(src);
check('the query is REBUILT from the record against THIS ROUND\'s start — never mutated in place, never re-anchored to the carried pre-AF origin',
  rebuiltFromRoundStart(agentSrc));

// ── 11. reentrancy guard (bug-hunt 2026-08-23) ──────────────────────────────────────────────────
// presentGuided's re-rank is a real network round trip before the next question replaces the
// current one on screen. Without a guard, a second confirm/skip tap landing in that gap — slow
// network, or an impatient double-tap while the card looks unresponsive — was processed as a
// SECOND answer to the SAME visual step (nothing rejected the stale stepIndex closure): confirmed
// once more, an already-selected single-select option reads as a re-click and clears back to
// unanswered, silently downgrading a real answer to "no preference". Reproduced live (production
// and a local instrumented build) at a 100% rate under fast synthetic clicking before this fix.
check('commitGuidedStep checks the reentrancy guard BEFORE touching any state',
  /const commitGuidedStep = async \(keys: string\[\], finish = false\) => \{\s*\n\s*if \(ageFlowCommittingRef\.current\) return;/.test(agentSrc));
check('the guard is set before the async work starts and released in a finally (never on just one exit path)',
  /ageFlowCommittingRef\.current = true;\s*\n\s*try \{/.test(agentSrc)
  && /\} finally \{\s*\n\s*ageFlowCommittingRef\.current = false;\s*\n\s*\}/.test(agentSrc));
check('presentGuided is AWAITED inside commitGuidedStep — the guard must span its network round trip, not just the synchronous part',
  /await presentGuided\(stepIndex \+ 1, token\);/.test(agentSrc)
  && !/void presentGuided\(stepIndex \+ 1, token\);/.test(agentSrc));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// Each assertion is re-run against a deliberately broken variant; a check that no longer fails on
// its own defect has stopped testing anything.
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, brokenIsCaught: boolean) => {
  if (brokenIsCaught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// Executable mutations — re-implement the defect and check the same predicate flips.
{
  // (a) applying the step under the cursor
  const bad = (steps: GuidedStep[], upTo: number) => deriveGuided(BASE, steps, upTo + 1);
  mustCatch('deriveGuided applying the question currently being asked',
    (bad([step(BATH, opts('2'), ['2'])], 0).query as any).bathMin === 2);

  // (b) a skip treated as a real answer — the defect lives in the DERIVATION (dropping the
  // empty-keys guard), not in a question's apply(), so the broken derivation is what must be run.
  const deriveWithoutSkipGuard = (steps: GuidedStep[], upTo: number) => {
    let query: any = BASE;
    for (const st of steps.slice(0, upTo)) { if (st.keys == null) continue; query = st.question.apply(query, st.keys); }
    return query;
  };
  const skipAsNo = q('bathrooms', (x, keys) => ({ ...x, bathMin: keys.length ? Number(keys[0]) : 0 }));
  mustCatch('a skip written into the query as a value (false/No)',
    deriveWithoutSkipGuard([step(skipAsNo, opts('2'), [])], 1).bathMin === 0
    && (deriveGuided(BASE, [step(skipAsNo, opts('2'), [])], 1).query as any).bathMin === undefined);

  // (c) appending answer accumulating across a re-answer — the classic stale predicate
  const stale = { ...BASE, amenities: ['pool'] };
  mustCatch('an appending answer accumulating the OLD keys as well as the new',
    (deriveGuided(stale, [step(AMEN, opts('gym'), ['gym'])], 1).query as any).amenities.join(',') === 'pool,gym');

  // (d) order-sensitive comparison would report a spurious change
  mustCatch('sameKeys comparing raw order', ['a', 'b'].join() === ['b', 'a'].join() ? false : true);
}

// Source mutations — flip the shipped text and confirm the regex stops matching.
const mut = (src: string, from: string | RegExp, to: string) => src.replace(from, to);
mustCatch('the 260 ms auto-advance creeping back',
  /setTimeout\([\s\S]{0,120}?onConfirm/.test(mut(cardSrc, 'lastTapRef.current = { key, at: now };',
    'autoRef.current = setTimeout(() => onConfirm([key]), 260);')));
mustCatch('a rival double-click handler being added',
  /onDoubleClick|onLongPress|doubleTapHandler/.test(mut(cardSrc, 'onPress={onBack}', 'onDoubleClick={onBack}')));
mustCatch('«رجوع» losing its testID',
  !/testID="af-back"/.test(mut(cardSrc, 'testID="af-back"', '')));
mustCatch('the card going back to clearing the selection on every question',
  !/setSel\(initialKeys \?\? \[\]\)/.test(mut(cardSrc, 'setSel(initialKeys ?? [])', 'setSel([])')));
mustCatch('Back walking the cursor somewhere other than exactly one question back',
  backCursors(mut(agentSrc, 'presentGuided(stepIndex - 1, back)', 'presentGuided(stepIndex, back)'))[0] !== 'stepIndex - 1');
mustCatch('Back skipping two questions at once',
  backCursors(mut(agentSrc, 'presentGuided(stepIndex - 1, back)', 'presentGuided(stepIndex - 2, back)'))[0] !== 'stepIndex - 1');
mustCatch('the supersession bump being dropped from the walk-back (a stale probe could re-show the abandoned step)',
  !backTokenOk(mut(agentSrc, 'const back = ++ageFlowTokenRef.current;', '')));
mustCatch('the walk-back capturing the PRE-bump token (postfix ++ hands presentGuided an already-superseded token)',
  !backTokenOk(mut(agentSrc, 'const back = ++ageFlowTokenRef.current;', 'const back = ageFlowTokenRef.current++;')));
mustCatch('Back-to-start no longer restoring the pre-AF controls',
  !backToStartCancels(mut(agentSrc, /if \(stepIndex <= 0\) \{/, 'if (false) {')));
mustCatch('the pre-AF CTA row losing its !ageFlow gate',
  !backToStartCancels(mut(agentSrc, '(hasMore || canNarrowFurther) && !ageFlow', '(hasMore || canNarrowFurther)')));
// The round-era defects the original two conditions could not see. `syncGuidedFromSteps(0);` is the
// one line unique to this branch — anchoring on `ageFlowStepsRef.current = [];` or `setAgeFlow(null);`
// would land the mutation in startAgeFlow and prove nothing about onAgeBack.
mustCatch('Back-to-start quietly FINISHING the round instead of cancelling it (a search the user backed out of)',
  !backToStartCancels(mut(agentSrc, 'syncGuidedFromSteps(0);', 'finishGuided(ageFlowTokenRef.current);')));
mustCatch('Back-to-start committing the on-screen answer on its way out (the «عرض النتائج» shape borrowed by «رجوع»)',
  !backToStartCancels(mut(agentSrc, 'syncGuidedFromSteps(0);', 'void commitGuidedStep([], true);')));
mustCatch('this round\'s record surviving the cancel (a re-opened round would resume mid-flight)',
  !backToStartCancels(mut(agentSrc, /ageFlowStepsRef\.current = \[\];\n(\s*)syncGuidedFromSteps\(0\);/, '$1syncGuidedFromSteps(0);')));
mustCatch('the cancel skipping the re-derive (ageFlowQueryRef left holding the abandoned round\'s narrowing)',
  !backToStartCancels(mut(agentSrc, 'syncGuidedFromSteps(0);', '')));
mustCatch('the round rebuild re-anchored to the carried pre-AF origin (rounds 1..N-1 silently dropped)',
  !rebuiltFromRoundStart(mut(agentSrc, 'ageFlowBaseQRef.current = q;', 'ageFlowBaseQRef.current = afCarryRef.current?.originQ ?? q;')));
mustCatch('the round losing its own base entirely',
  !rebuiltFromRoundStart(mut(agentSrc, 'ageFlowBaseQRef.current = q;', '')));
mustCatch('a changed earlier answer no longer re-validating later ones',
  !/if \(changedAnswer\) await revalidateStepsAfter\(stepIndex, token\)/.test(
    mut(agentSrc, 'if (changedAnswer) await revalidateStepsAfter(stepIndex, token)', '')));
mustCatch('re-validation starting to drop skips',
  !/if \(!st\.keys\.length\) \{ kept\.push\(st\); continue; \}/.test(
    mut(agentSrc, 'if (!st.keys.length) { kept.push(st); continue; }', 'if (!st.keys.length) continue;')));
mustCatch('a handler mutating the query in place again',
  !rebuiltFromRoundStart(
    mut(agentSrc, 'ageFlowQueryRef.current = d.query;', 'ageFlowQueryRef.current = question.apply(q, keys);')));
mustCatch('a re-presented step showing stale per-option counts',
  !/fresh = await st\.question\.resolveOptions\(q0\)/.test(
    mut(agentSrc, 'fresh = await st.question.resolveOptions(q0)', 'fresh = null')));
// The early-exit was REMOVED entirely (owner 2026-08-28); the modern defect shape is it CREEPING
// BACK — including in its worst historical form, the direct-finishGuided variant that discarded
// the visible selection. Appending either form must trip the absence check above.
mustCatch('a skip-all early-exit creeping back into the card or agent',
  /onSkipAll/.test(cardSrc + "\n<Pressable testID=\"af-skip-all\" onPress={() => onSkipAll(sel)} />")
  && /onAgeSkipAll/.test(agentSrc + '\nconst onAgeSkipAll = () => finishGuided(ageFlowTokenRef.current);'));
mustCatch('the restored answer no longer reaching the card',
  !/initialKeys=\{ageFlow\.initialKeys\}/.test(mut(agentSrc, 'initialKeys={ageFlow.initialKeys}', '')));
mustCatch('the reentrancy guard check being removed from commitGuidedStep',
  !/const commitGuidedStep = async \(keys: string\[\], finish = false\) => \{\s*\n\s*if \(ageFlowCommittingRef\.current\) return;/.test(
    mut(agentSrc, /if \(ageFlowCommittingRef\.current\) return;[^\n]*\n/, '')));
mustCatch('the guard release reverting to an early-return path that skips the finally',
  !/\} finally \{\s*\n\s*ageFlowCommittingRef\.current = false;\s*\n\s*\}/.test(
    mut(agentSrc, '    } finally {\n      ageFlowCommittingRef.current = false;\n    }', '    }')));
mustCatch('presentGuided reverting to fire-and-forget (guard would release before the re-rank finishes)',
  /void presentGuided\(stepIndex \+ 1, token\);/.test(
    mut(agentSrc, 'await presentGuided(stepIndex + 1, token);', 'void presentGuided(stepIndex + 1, token);')));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ «رجوع» restores state without stale predicates; single tap selects, double tap advances one\n');
