// ADVANCED FILTER "2+ USEFUL QUESTIONS TO OPEN" GATE (owner brief, 2026-08-22) — Advanced Filter must
// never open for a cohort with 0 or 1 "useful" question (one that passes scoreQuestion() — real
// narrowing power over the CURRENT eligible set — not merely structurally eligible via cohortAllows/
// isAgeFilterScope). Opening on exactly one useful question means the user answers or skips it and the
// interview still closes on whatever the >25 result-count gate alone left large — a tax on the user's
// attention, not a niche shortlist. This is a SECOND, independent condition that composes with the
// existing INTERVIEW_STOP_AT/MIN_TOTAL_TO_SHOW result-count gate — both must hold, neither replaces
// the other. It governs the OPENING decision only: once open, the interview still keeps asking down to
// the very last useful question (unchanged continuation loop, proved absent from this gate below).
//
// EXECUTION NOTE: advancedFilters.ts (scoreQuestion's home) is not standalone-importable by a plain
// Node runner — like every other AF barrier in this repo that touches it (verify-advanced-filter-
// contract.ts, verify-advanced-filter-count-honesty.ts, verify-ui-controls-have-predicates.ts), it
// pulls in `./search` → `./remote` → the Supabase/Expo runtime chain, unlike the ONE module (afCohorts.ts)
// that was deliberately extracted pure specifically so cohortAllows() could be executed directly. Adding
// a second such extraction is out of scope for this rule change, so — matching this repo's own
// convention for this exact file — the assertions below are precise source-text checks on the shipped
// code (comments stripped so prose can never satisfy them), each proving the presence/absence of one
// exact shape a mutation would change, plus a live production/RPC proof (see PROGRESS.md for the
// browser + RPC verification log) that the real scoring math this gate counts on is exercised for real.
//
//   node --experimental-strip-types scripts/verify-af-min-useful-questions-gate.ts   (wired into `npm test`)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter "2+ useful questions to open" gate\n');

const adv = codeOnly(read('src/data/advancedFilters.ts'));

// ── The threshold itself is exactly 2 (owner-specified, not 0/1/3) ─────────────────────────────────
check('MIN_USEFUL_QUESTIONS_TO_SHOW is declared, exported, and exactly 2 (owner: 0/1 hide AF, 2+ may show it)',
  /export const MIN_USEFUL_QUESTIONS_TO_SHOW = 2;/.test(adv));

// ── "Useful" is defined ONCE, by scoreQuestion, and this gate counts exactly ITS output ────────────
// rankQuestions() (unchanged by this fix) already filters the pool to questions where scoreQuestion
// returns non-null — that IS "useful" (real narrowing power: N>=MIN_TOTAL_TO_SHOW, an option in
// [max(15,8%N), 90%N], at least one option narrowing to <=75%N — see scoreQuestion's own body,
// unmodified by this change). agent.tsx's plan is built directly from rankQuestions' return value with
// no re-filtering that could silently redefine "useful" a second, disagreeing way.
check('scoreQuestion remains the sole "useful" gate — rankQuestions pushes a question onto `ranked` only when scoreQuestion(...) is non-null',
  /const scored = scoreQuestion\(question, probes\[i\]\);\s*if \(scored\) ranked\.push/.test(adv));
// scoreQuestion's OWN body (the N < MIN_TOTAL_TO_SHOW check) lives in src/data/advancedFilters.ts
// directly, OR — after PR #914's pure-module extraction (src/lib/afRanking.ts, 2026-08-22) — in
// afRanking.ts, with advancedFilters.ts keeping a thin same-signature wrapper. Either shape is
// correct; what must never happen is the check disappearing from BOTH.
const afRankingPath = join(root, 'src/lib/afRanking.ts');
const afRankingSrc = existsSync(afRankingPath) ? codeOnly(readFileSync(afRankingPath, 'utf8')) : '';
check('scoreQuestion itself is unmodified by this change: N < MIN_TOTAL_TO_SHOW still returns null (the existing, separate result-count gate)',
  /if \(N < MIN_TOTAL_TO_SHOW\) return null;/.test(adv) || /if \(N < MIN_TOTAL_TO_SHOW\) return null;/.test(afRankingSrc));

// ── agent.tsx WIRING — source-text (agent.tsx cannot be imported by a plain Node runner) ───────────
const ag = codeOnly(read('src/app/agent.tsx'));

check('agent.tsx imports MIN_USEFUL_QUESTIONS_TO_SHOW from @/data/advancedFilters',
  /import\s*\{[^}]*\bMIN_USEFUL_QUESTIONS_TO_SHOW\b[^}]*\}\s*from\s*'@\/data\/advancedFilters'/.test(ag));

check("startAgeFlow's opening guard reads `ageFlowPlanRef.current.length < MIN_USEFUL_QUESTIONS_TO_SHOW` (not just an empty-plan check)",
  /if\s*\(ageFlowPlanRef\.current\.length\s*<\s*MIN_USEFUL_QUESTIONS_TO_SHOW\)\s*\{\s*setAgeFlow\(null\);\s*if\s*\(fallbackToRefine\)\s*startRefine\(q\);\s*return;\s*\}/.test(ag),
  'this exact shape is the fix: 0 OR 1 useful question must take the same silent-close/fallback-to-refine path an empty plan already used');

check('the OLD 0-only guard (`if (!ageFlowPlanRef.current.length)`) is gone — regression to the pre-fix 1-question-opens-AF bug',
  !/if\s*\(!ageFlowPlanRef\.current\.length\)/.test(ag));

// ── THE GATE NOW HAS TWO PLACEMENTS, ONE PER ENTRY PATH (owner amendment 2026-08-23) ─────────────
// The scope hierarchy (CATEGORY→GROUP→TYPE) made a single placement impossible. With an unresolved
// hierarchy the ranked plan is empty BY CONSTRUCTION — cohortAllows intersects across every clean
// type in scope and treats an uncertified type as an empty cohort — so gating at startAgeFlow closed
// the interview before the first scope question could ever render. That is the exact bug that left
// 5 of 8 shipped groups unable to open Advanced Filter on either deal. So:
//   • SCOPE ALREADY RESOLVED → the gate stays exactly where it was, in startAgeFlow, before asking.
//   • SCOPE UNRESOLVED       → startAgeFlow hands off to the hierarchy, and the gate is re-evaluated
//                              at the scope→advanced transition inside presentGuided.
// Both are pinned below. Losing EITHER placement re-opens a real defect, in opposite directions.
check('the resolved-scope gate still sits BEFORE presentGuided(0, token) — a <2 plan never reaches the asking phase',
  (() => {
    const gateIdx = ag.search(/if\s*\(ageFlowPlanRef\.current\.length\s*<\s*MIN_USEFUL_QUESTIONS_TO_SHOW\)/);
    // LAST occurrence, deliberately: since 2026-08-23 startAgeFlow contains TWO
    // `void presentGuided(0, token);` calls — the unresolved-scope bypass (which must precede the
    // gate) and the real resolved-scope hand-off (which must follow it). indexOf would find the
    // bypass and read the correct ordering as a violation.
    const presentIdx = ag.lastIndexOf('void presentGuided(0, token);');
    return gateIdx !== -1 && presentIdx !== -1 && gateIdx < presentIdx;
  })());

check('an UNRESOLVED scope bypasses that gate and opens on the hierarchy instead (the 2026-08-23 fix)',
  (() => {
    const bypassIdx = ag.search(/if\s*\(unresolvedScopeTiers\(q\)\.length\)\s*\{\s*void presentGuided\(0, token\);\s*return;\s*\}/);
    const gateIdx = ag.search(/if\s*\(ageFlowPlanRef\.current\.length\s*<\s*MIN_USEFUL_QUESTIONS_TO_SHOW\)/);
    return bypassIdx !== -1 && gateIdx !== -1 && bypassIdx < gateIdx;   // bypass must precede the gate
  })(),
  'without this, a category-only or group-only scope ranks to an empty plan and the interview closes before asking anything');

// ── The continuation loop is UNTOUCHED — presentGuided must keep asking down to the LAST useful
// question (owner §2/§6), never re-apply the >=2 threshold after the interview has already opened.
const presentGuidedBody = ag.match(/const presentGuided = async[\s\S]*?\n  \};/)?.[0] ?? '';
check('presentGuided body located (extraction must fail loudly, never silently pass)', presentGuidedBody.length > 0);

// presentGuided may now reference the constant EXACTLY ONCE, and only for the scope→advanced
// transition. The property that actually matters — and that the old "appears nowhere" check was a
// proxy for — is that the threshold is an OPENING decision and never throttles the continuation
// loop: once the interview is open on a resolved scope it must keep asking down to the LAST useful
// question (owner §2/§6). So instead of banning the constant, pin the guard it must be part of.
const transitionGate = presentGuidedBody.match(
  /if \(steps\.length && steps\.every\(\(st\) => isScopeQuestionId\(st\.question\.id\)\)\s*\n?\s*&& plan\.length < MIN_USEFUL_QUESTIONS_TO_SHOW\) \{ finishGuided\(token\); return; \}/,
);
check('the transition gate exists and is guarded by "every recorded step so far is a SCOPE step"',
  !!transitionGate,
  'the >=2 threshold may only be re-evaluated at the scope→advanced hand-off — never on a later answer');
check('presentGuided references the threshold EXACTLY once (only that transition gate)',
  (presentGuidedBody.match(/MIN_USEFUL_QUESTIONS_TO_SHOW/g) ?? []).length === 1,
  `found ${(presentGuidedBody.match(/MIN_USEFUL_QUESTIONS_TO_SHOW/g) ?? []).length}`);
check('the transition gate counts ADVANCED questions only — it reads plan.length, never steps.length',
  /&& plan\.length < MIN_USEFUL_QUESTIONS_TO_SHOW/.test(presentGuidedBody),
  'hierarchy steps are what earned the right to ask; they must never count toward the 2');
check('at the transition the interview STOPS CLEANLY (finishGuided) and never bounces to startRefine',
  !!transitionGate && !/startRefine/.test(transitionGate[0]),
  'by this point the user has answered real scope questions — their narrowing must be honoured, not discarded for the legacy chips');
check('presentGuided still finishes (finishGuided) only when its own re-ranked plan is truly empty, not on any count threshold',
  /if \(!plan\.length\) \{ finishGuided\(token\); return; \}/.test(presentGuidedBody));

// ── SKIP vs CONFIRM-WITH-EMPTY parity (brief's named suspicion — traced, found NOT diverging).
// Since the «رجوع» rebuild (owner 2026-08-22) this is no longer a parity that has to be checked
// effect-by-effect: Skip and Confirm are THE SAME FUNCTION called with a different answer, and an
// empty answer contributes nothing because the query is rebuilt from the record, which skips
// empty-keyed steps outright. Asserted in that stronger form — plus the absence of any separate
// skip-only side effect, so a future edit cannot re-split them.
const onAgeConfirmLine = ag.match(/const onAgeConfirm = \(keys: string\[\]\) => \{[^\n]*\};/)?.[0] ?? '';
const onAgeSkipLine = ag.match(/const onAgeSkip = \(\) => \{[^\n]*\};/)?.[0] ?? '';

check('Skip and Confirm are the SAME commit path — Skip is simply the empty answer',
  /void commitGuidedStep\(keys\);/.test(onAgeConfirmLine) && /void commitGuidedStep\(\[\]\);/.test(onAgeSkipLine));
check('neither Skip nor Confirm applies a predicate directly — the query is rebuilt from the record',
  !/question\.apply|ageFlowChangedRef\.current = true|ageFlowFacetsRef\.current\.push/.test(onAgeConfirmLine + onAgeSkipLine)
  && /const d = deriveGuided\(/.test(ag));
check('an empty answer contributes no predicate (enforced in the shared derivation, not per handler)',
  /if \(!st\.keys\.length\) continue;/.test(
    readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'afSteps.ts'), 'utf8')));

console.log(failures === 0
  ? '\n✓ AF 2+ useful-questions gate intact: correct threshold, correct wiring, continuation loop untouched, Skip = confirm-empty\n'
  : `\n✗ ${failures} check(s) FAILED — the AF 2+ useful-questions gate is broken\n`);
process.exit(failures === 0 ? 0 : 1);
