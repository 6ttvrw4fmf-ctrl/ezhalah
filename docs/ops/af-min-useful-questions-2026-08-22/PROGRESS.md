# AF "2+ useful questions" gate — progress log (2026-08-22)

Owner brief: hide Advanced Filter entirely when the current eligible cohort has 0 or 1 "useful"
question (one that passes scoreQuestion — real narrowing power, not just structural eligibility).
Show AF only when 2+ useful questions exist. Composes with the existing >25 result-count gate.
Skip must remain fully unrestricted (already true — see finding below). Once shown, keep asking
while ≥1 useful question remains (unchanged — presentGuided's re-rank loop already does this).

Branch: fix/af-min-useful-questions-gate (worktree .wt-af-min-useful-gate off main @ 1df6dcc)

## Findings (read-before-code phase, DONE)
- "Useful" already has an exact existing definition: `scoreQuestion()` in src/data/advancedFilters.ts
  (N >= MIN_TOTAL_TO_SHOW=26, an option in [max(15,8%N), 90%N], at least one option narrows to
  <=75%N). `rankQuestions()` returns exactly the set of questions that pass it — this is reused,
  not duplicated.
- The ONLY place AF opens is agent.tsx's `startAgeFlow()`, triggered from ONE call site (the manual
  "Let's narrow it down" button). No auto-popup exists today (opts.auto is always false — matches
  memory rule "AF NEVER auto-open popup 08-19").
- THE BUG: `startAgeFlow` opens the guided interview whenever `ageFlowPlanRef.current.length >= 1`
  (i.e. >=1 useful question), not >=2. A cohort with exactly 1 useful question opens AF, the user
  answers/skips it, presentGuided re-ranks to 0 remaining, and closes on the (still large) set —
  exactly the "open AF, answer one weak question, still see thousands" bug described.
- Combined-period (mixed Annual+Monthly) interaction: rankQuestions() -> eligibleQuestions() ->
  question.eligibility() -> cohortAllows(), which ALREADY does the RentAnnual∩RentMonthly
  intersection for combined-period cohorts (shipped PR #777/#901). Reusing rankQuestions/
  startAgeFlow's existing plan means the >=2 gate is automatically computed AFTER that
  intersection — no separate implementation, no risk of disagreement.
- SKIP vs CONFIRM-EMPTY: traced onAgeConfirm(keys) and onAgeSkip in agent.tsx. When keys=[],
  onAgeConfirm skips `question.apply` / `ageFlowChangedRef.current=true` / facets entirely — it
  only adds the question id to askedRef and calls presentGuided(planIndex+1). onAgeSkip does
  exactly the same two things. THEY ALREADY MATCH — no divergence found. (Brief flagged this as a
  suspect; verified NOT a bug.)

## Plan
1. [DONE] Add MIN_USEFUL_QUESTIONS_TO_SHOW=2 to src/data/advancedFilters.ts (next to
   INTERVIEW_STOP_AT/MIN_TOTAL_TO_SHOW).
2. [DONE] agent.tsx startAgeFlow: change the empty-plan fallback guard from
   `!ageFlowPlanRef.current.length` to `ageFlowPlanRef.current.length < MIN_USEFUL_QUESTIONS_TO_SHOW`.
   presentGuided (the continuation loop) is UNTOUCHED — still stops only at 0 remaining.
3. [DONE] New barrier script scripts/verify-af-min-useful-questions-gate.ts. advancedFilters.ts is
   NOT standalone-importable by plain Node (drags in ./search -> ./remote -> Supabase/Expo runtime),
   same constraint every other AF barrier in this repo hits for this exact file — so, matching repo
   convention, assertions are precise source-text checks (comments stripped) on: the threshold
   constant, the exact gate shape + its location (before presentGuided(0,...)), proof presentGuided
   itself is untouched (no threshold reference, still finishes only on a truly empty re-ranked plan),
   and proof onAgeConfirm([])/onAgeSkip stay structurally identical. Wired into npm test.
4. [DONE] Mutation-proved the barrier — 4 independent mutations, ALL caught, files restored
   byte-identical after each: (a) reverted guard to old `!ageFlowPlanRef.current.length` → 3 checks
   failed; (b) MIN_USEFUL_QUESTIONS_TO_SHOW changed 2→1 → 1 check failed; (c) leaked the >=2
   threshold into presentGuided's continuation loop → 2 checks failed; (d) made onAgeSkip set
   ageFlowChangedRef (diverging from onAgeConfirm's empty-keys path) → 1 check failed.
5. [DONE] Full `npm test` regression pass — see result below.
6. [DONE] docs/ADVANCED_FILTER_DESIGN_CONTRACT.md updated with the rule.
7. [DONE] Commit, push, PR (--head/--base explicit, file list verified twice).
8. [ ] Merge on green CI.
9. [ ] Deploy via GH Actions "Deploy frontend (production)" workflow, confirm=DEPLOY.
10. [ ] Verify production bundle + real browser behavior.
11. [ ] Final report to owner.

Status as of last update: see below.
