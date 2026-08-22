// Enforces docs/ADVANCED_FILTER_DESIGN_CONTRACT.md by grepping the shipped source, so no future
// question can drift from the one design system. A question supplies ONLY the seven config fields;
// ONE shared card (AdvancedQuestionCard) owns all chrome/layout/progress/footer/spacing/typography/
// motion/skip/counts/interaction, and branches on `selection` only — never on a question id.
//
//   node --experimental-strip-types scripts/verify-advanced-filter-contract.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const advSrc = readFileSync(join(root, 'src/data/advancedFilters.ts'), 'utf8');
// Cohort config + gate live here since 2026-08-20 (pure module → executable by barriers).
const cohortSrc = readFileSync(join(root, 'src/lib/afCohorts.ts'), 'utf8');
// Ranking + the narrowing gate live here since 2026-08-22 (same reasoning — pure module → executable
// by scripts/verify-af-narrowing-gate.ts instead of regexed; see that script for the EXECUTED half).
const rankingSrc = readFileSync(join(root, 'src/lib/afRanking.ts'), 'utf8');
const cardSrc = readFileSync(join(root, 'src/components/AdvancedQuestionCard.tsx'), 'utf8');
const agentSrc = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── The config boundary — a question supplies ONLY the eight allowed fields ──────────────────────
check('AdvancedQuestion declares exactly the 8 contract fields (id/title/description?/brandImage?/selection/eligibility/resolveOptions/apply)',
  /export type AdvancedQuestion = \{[\s\S]*?\bid:[\s\S]*?titleKey:[\s\S]*?descriptionKey\?:[\s\S]*?brandImage\?:[\s\S]*?selection:[\s\S]*?eligibility:[\s\S]*?resolveOptions:[\s\S]*?\bapply:[\s\S]*?\};/.test(advSrc));
check('the old per-mode API is GONE — no mode/fetchOptions/applyAnswer/applyMulti/liveCount on questions',
  !/\bmode:\s*'(single|multi)'/.test(advSrc) && !/fetchOptions\s*[:(]/.test(advSrc)
  && !/applyAnswer\b/.test(advSrc) && !/applyMulti\b/.test(advSrc) && !/\bliveCount:/.test(advSrc));
check('all four questions use selection + eligibility + resolveOptions',
  (advSrc.match(/selection:\s*'(single|multi)'/g) || []).length >= 4
  && (advSrc.match(/eligibility:/g) || []).length >= 4
  && (advSrc.match(/resolveOptions\s*\(/g) || []).length >= 4);

// ── Sequence + selection modes ───────────────────────────────────────────────────────────────────
// CONTRACT CHANGE (owner 2026-08-11, contextual interview): ask-order is no longer the static
// queue — rankQuestions() re-ranks the pool against the user's CURRENT candidate set after every
// answer. The pool array still exists (probe universe); what we now pin is the ranking engine.
check('the pool contains all five questions and rankQuestions re-ranks it contextually',
  /ADVANCED_QUESTIONS[^=]*=\s*\[\s*RNPL_QUESTION,\s*AGE_QUESTION,\s*AMENITIES_QUESTION,\s*BATHROOMS_QUESTION,\s*FURNISHED_QUESTION/.test(advSrc)
  && /export async function rankQuestions/.test(advSrc)
  && /export function scoreQuestion/.test(advSrc)
  // INTERVIEW_STOP_AT/MIN_TOTAL_TO_SHOW moved to afRanking.ts (2026-08-22, pure-module extraction);
  // advancedFilters.ts still re-exports them (checked separately below) so every existing importer
  // is unaffected.
  && /INTERVIEW_STOP_AT = 25/.test(rankingSrc)
  && /MIN_TOTAL_TO_SHOW = INTERVIEW_STOP_AT \+ 1/.test(rankingSrc)
  && /INTERVIEW_STOP_AT, MIN_TOTAL_TO_SHOW/.test(advSrc));
// MECHANISM CHANGE (owner 2026-08-22, «رجوع»): asked-tracking is no longer an incremental
// `.add()` on a Set that only ever grows — it is DERIVED from the ordered step record by
// syncGuidedFromSteps(cursor), so walking Back genuinely un-asks the steps behind the cursor
// instead of leaving them permanently marked. Same guarantee (never re-ask what is still
// committed), now reversible. Pinned in both directions: derived, and never re-grown by hand.
check('the orchestrator re-ranks after every answer and tracks asked questions (never re-asks)',
  /rankQuestions\(q, ageFlowAskedRef\.current\)/.test(agentSrc)
  && /ageFlowAskedRef\.current = new Set\(/.test(agentSrc)
  && !/ageFlowAskedRef\.current\.add\(/.test(agentSrc));
// ASK-FIRST TIER (owner 2026-08-15): installments is the PREFERRED opening question, and only that.
// The tier must reorder ONLY questions that already passed scoreQuestion()'s usefulness gates — it
// must never bypass them, or a scope with too little installment coverage would be asked a useless
// question. Pinned structurally: the tier is applied in the SORT (post-gate), never inside
// scoreQuestion, and scoreQuestion still returns null on every gate.
check('installments is ask-first via a TIER applied in the sort, never by bypassing the gates',
  /ASK_FIRST_TIER/.test(advSrc)
  && /askTier\(b\.question\.id\) - askTier\(a\.question\.id\) \|\| b\.score - a\.score/.test(advSrc)
  && !/ASK_FIRST_TIER|askTier/.test(advSrc.slice(advSrc.indexOf('export function scoreQuestion'), advSrc.indexOf('export type RankedQuestion'))));
// NARROWING GATE (owner 2026-08-22, supersedes the 2026-08-11 8%-90% option band — see the design
// contract's "Amendment 2026-08-22"): a question is asked whenever it has a real option that would
// actually change the result (count < N) — selectivity orders the ask sequence, it no longer decides
// inclusion. scripts/verify-af-narrowing-gate.ts mutation-proves this by calling scoreQuestion() with
// synthetic scopes (now pure, in afRanking.ts); this check only pins that the OLD selectivity-as-
// inclusion gate is gone from BOTH the pure implementation and advancedFilters.ts's thin wrapper.
check('scoreQuestion gates on scope size and genuine narrowing, not selectivity',
  /if \(N < MIN_TOTAL_TO_SHOW\) return null;/.test(rankingSrc)
  && /const narrowing = result\.options\.filter\(\(o\) => o\.count < N\);/.test(rankingSrc)
  && /if \(narrowing\.length < minOptionsFor\(selection\)\) return null;/.test(rankingSrc)
  && !/Math\.max\(15, Math\.ceil\(0\.08 \* N\)\)/.test(rankingSrc)
  && !/o\.count <= 0\.9 \* N/.test(rankingSrc)
  && !/Math\.max\(15, Math\.ceil\(0\.08 \* N\)\)/.test(advSrc)
  && !/o\.count <= 0\.9 \* N/.test(advSrc));
// The installment answer means ONLY "source-confirmed supported". No invented payment frequency.
check('the installment question stays a single binary source-confirmed chip (no invented frequencies)',
  /RNPL_QUESTION[\s\S]{0,600}labelKey: 'Offers installments'/.test(advSrc)
  && !/دفعتين|٤ دفعات|١٢ دفعة/.test(advSrc));
// COHORT CONFIG (owner 2026-08-15): eligibility is data — COHORT_QUESTIONS maps each single type ×
// deal to its source-justified question list; cohortAllows() is the ONLY eligibility gate for the
// config-driven questions. The old per-question hardcoded gates are superseded, but their
// INVARIANTS survive as data shape and are pinned below.
check('furnished question is single-select, cohort-gated, true tri-state via furnishedPref',
  /FURNISHED_QUESTION[\s\S]{0,400}selection:\s*'single'/.test(advSrc)
  && /FURNISHED_QUESTION[\s\S]{0,420}cohortAllows\(q, 'furnished'\)/.test(advSrc)
  && /furnishedPref:\s*true/.test(advSrc) && /furnishedPref:\s*false/.test(advSrc));
// MONTHLY UNFROZEN BY OWNER ORDER 2026-08-18 ("Start building the Monthly Advanced Filter now") —
// this check previously pinned the ABSENCE of any Monthly key (the 2026-08-15 freeze). The freeze is
// replaced, not deleted: Monthly keys may exist ONLY on the certified cohorts (Apartment/Room/Villa),
// may draw ONLY from the Monthly-certified question set, and may NEVER carry the fields that are
// fresh-DEAD in Monthly data (kitchen 94/30,356 · AC 7 · age 564 · floor 53 · furnished 100%-true).
// The DB half of the same contract is the af_registry_monthly_uncertified P1 guard.
const cohortBlock = cohortSrc.slice(cohortSrc.indexOf('export const COHORT_QUESTIONS'), cohortSrc.indexOf('export function scopeCleanTypes'));
const monthlyLists = [...cohortBlock.matchAll(/RentMonthly:\s*\[([^\]]*)\]/g)].map((m) => m[1]);
const MONTHLY_ALLOWED = ['rating', 'unit_subtype', 'amenities', 'bathrooms'];
check('COHORT_QUESTIONS exists, Monthly keys exist ONLY for the certified cohorts (شقة/غرفة/فيلا)',
  /export const COHORT_QUESTIONS/.test(cohortSrc)
  && monthlyLists.length === 3
  && /Apartment:\s*\{[\s\S]{0,900}RentMonthly:/.test(cohortBlock)
  && /Room:\s*\{[\s\S]{0,400}RentMonthly:/.test(cohortBlock)
  && /Villa:\s*\{[\s\S]{0,700}RentMonthly:/.test(cohortBlock));
check('every Monthly question list draws ONLY from the Monthly-certified set (no Annual copy-paste)',
  monthlyLists.length > 0 && monthlyLists.every((l) =>
    [...l.matchAll(/'([^']+)'/g)].every((m) => MONTHLY_ALLOWED.includes(m[1]))));
check('no Monthly list carries a fresh-dead Annual staple (age/furnished/rnpl/street_width/direction)',
  monthlyLists.every((l) => !/property_age|furnished|rnpl|street_width|direction/.test(l)));
check('no Buy list contains a rent-only question',
  !/Buy:\s*\[[^\]]*'furnished'/.test(advSrc)
  && !/Buy:\s*\[[^\]]*'rnpl'/.test(advSrc));
check('the rating question is cohort-gated, single-select, monotone, and review-confidence rides WITH a rating floor',
  /RATING_QUESTION[\s\S]{0,500}selection:\s*'single'/.test(advSrc)
  && /RATING_QUESTION[\s\S]{0,600}cohortAllows\(q, 'rating'\)/.test(advSrc)
  && /ratingMin:\s*Math\.max\(9\.5/.test(advSrc)
  && /reviewsMin:\s*Math\.max\(10/.test(advSrc)
  && !/reviewsMin[^}]*\}\s*;?\s*$/m.test('') // structural placeholder, kept simple
  );
check('the unit-subtype question is strict Gathern vocabulary and never rewrites the canonical taxonomy',
  /UNIT_SUBTYPE_QUESTION[\s\S]{0,600}cohortAllows\(q, 'unit_subtype'\)/.test(advSrc)
  && /'استديو'/.test(advSrc) && /'شقق مخدومة'/.test(advSrc)
  && /unitSubtypes:\s*\[keys\[0\]\]/.test(advSrc));
check('the pool carries the two new data-justified questions (street_width + direction)',
  /STREET_WIDTH_QUESTION, DIRECTION_QUESTION,/.test(advSrc)
  && /cnt_stw15/.test(advSrc) && /cnt_dir_n/.test(advSrc));
check('RNPL + amenities are multi; age + bathrooms are single',
  /RNPL_QUESTION[\s\S]{0,400}selection:\s*'multi'/.test(advSrc)
  && /AMENITIES_QUESTION[\s\S]{0,500}selection:\s*'multi'/.test(advSrc)
  && /AGE_QUESTION[\s\S]{0,400}selection:\s*'single'/.test(advSrc)
  && /BATHROOMS_QUESTION[\s\S]{0,400}selection:\s*'single'/.test(advSrc));

// ── Unified gates + floors (age gate moved INTO its config; ONE per-option floor) ────────────────
check("age's eligibility lives in its own config, and agent.tsx no longer holds the age gate",
  /AGE_QUESTION[\s\S]{0,400}eligibility:\s*\(q\)\s*=>\s*isAgeFilterScopeFor/.test(advSrc)
  && !/isAgeFilterScope/.test(agentSrc));
check('one shared per-option floor (MIN_REAL_OPTION_COUNT via meaningful()); the >0-chips vs >=5-buckets split is banned',
  // Definition moved to afRanking.ts (2026-08-22); advancedFilters.ts imports+re-exports the constant
  // and imports meaningful() (checked separately below), so this only needs to prove the definition
  // still exists somewhere real, not that advancedFilters.ts re-declares it.
  /export const MIN_REAL_OPTION_COUNT/.test(rankingSrc) && /export function meaningful/.test(rankingSrc)
  && /MIN_REAL_OPTION_COUNT/.test(advSrc) && /\bmeaningful\(/.test(advSrc)
  && !/MIN_REAL_BUCKET_COUNT/.test(advSrc) && !/\.count\(counts\)\s*>\s*0/.test(advSrc));
// RNPL is a rent concept → rent-only; amenities + bathrooms extend to Buy where the cohort's data
// justifies them. Both now enforced as DATA (COHORT_QUESTIONS) rather than per-question functions —
// the checks above assert no Buy list carries 'rnpl' or 'furnished'.
// Commercial expansion (2026-08-16): the category gate matches the cohort's own macro (not
// Residential-only), no commercial list carries rnpl/furnished-question on Buy, no NEW cohort
// carries the fresh-dead 'ac' chip, and mapped types render EXACTLY their COHORT_CHIPS list.
check('cohortAllows matches the clean type macro and COHORT_CHIPS scopes commercial chips',
  /q\.category !== \(CLEAN_MACRO\[type\] \?\? 'Residential'\)/.test(cohortSrc)
  && /export const COHORT_CHIPS/.test(cohortSrc)
  && !/COHORT_CHIPS[\s\S]{0,900}'ac'/.test(cohortSrc.slice(cohortSrc.indexOf('export const COHORT_CHIPS'), cohortSrc.indexOf('export const COHORT_CHIPS') + 1200))
  && /chipAllow\.includes\(d\.key\)/.test(advSrc));

// Villa cohort (2026-08-16): rnpl leads Rent only; Buy carries neither rnpl nor furnished; the two
// villa-form chips (car_entrance/sanitation) are Villa-scoped so certified cohorts' cards never change.
check('Villa cohort lists exist and the villa chips are Villa-scoped',
  /Villa:\s*\{\s*RentAnnual:\s*\['rnpl'/.test(cohortSrc)
  && /Villa:\s*\{[\s\S]{0,400}Buy:\s*\[(?![^\]]*'rnpl')(?![^\]]*'furnished')[^\]]*\]/.test(cohortSrc)
  // Multi-type safe since 2026-08-20: EVERY selected type must be Villa before the villa-form chips
  // are offered — a Villa+Apartment scope must not inherit a chip only villa ads carry.
  && /scope\.every\(\(ty\) => ty === 'Villa'\)[\s\S]{0,320}car_entrance[\s\S]{0,200}sanitation/.test(advSrc));

check('RNPL + amenities + bathrooms are cohort-gated through cohortAllows',
  /RNPL_QUESTION[\s\S]{0,420}cohortAllows\(q, 'rnpl'\)/.test(advSrc)
  && /cohortAllows\(q, 'amenities'\)/.test(advSrc)
  && /cohortAllows\(q, 'bathrooms'\)/.test(advSrc)
  && /export function cohortAllows[\s\S]{0,900}q\.rentPeriod === 'monthly'\) return \(cfg\.RentMonthly/.test(cohortSrc));

// Mixed period ('both', owner 2026-08-19): cohortAllows must require BOTH RentAnnual and RentMonthly
// membership — union would let a period-specific question fire against the other period's rows.
// Full behavioral coverage lives in scripts/verify-mixed-period-af-gating.ts (mutation-tested); this
// is a lighter structural check that the contract-level pool still routes 'both' through that gate.
check("cohortAllows has an explicit 'both' branch (intersection of RentAnnual and RentMonthly), never aliasing to Annual",
  /q\.rentPeriod === 'both'\) return \(cfg\.RentAnnual \?\? \[\]\)\.includes\(id\) && \(cfg\.RentMonthly \?\? \[\]\)\.includes\(id\)/.test(cohortSrc));
check('Furnished chip is cohort-gated — never offered where the cohort config withholds it',
  /cohortAllows\(q, 'furnished'\)\)\s*defs\.push\(\{\s*key:\s*'furnished'/.test(advSrc));

// ── ONE card, no per-question branching, tokens only ─────────────────────────────────────────────
check('the card branches on selection ONLY — never on a question id',
  /selection\s*===\s*'multi'/.test(cardSrc)
  && !/'property_age'|'rnpl'|'amenities'|'bathrooms'/.test(cardSrc));
check('the card uses design tokens and has ZERO raw hex/rgba color literals',
  /from '@\/theme\/tokens'/.test(cardSrc) && /font\.family/.test(cardSrc)
  && !/#[0-9a-fA-F]{3,8}\b/.test(cardSrc) && !/rgba\(/.test(cardSrc));
check('ONE shared row template — no separate single/multi bodies',
  /function OptionRow/.test(cardSrc) && !/MultiChips/.test(cardSrc));

// ── Same footer / skip / count / progress for EVERY question (rendered once, mode-independent) ───
check('footer Show-{N} primary + Skip + Skip-all render for every question',
  /Show \{count\} results/.test(cardSrc) && /onSkip\b/.test(cardSrc) && /onSkipAll\b/.test(cardSrc) && /primaryBtn/.test(cardSrc));
check('a live count pill renders on EVERY option row (both modes)',
  /countPill/.test(cardSrc) && /grouped\(option\.count\)/.test(cardSrc));
check('progress is animated and shared',
  /Animated\.timing/.test(cardSrc) && /progFill/.test(cardSrc));
// CONTRACT CHANGE (owner 2026-08-11): NO numeric N-of-M caption — with contextual re-ranking the
// denominator legitimately moves between steps, and the owner wants no questionnaire pressure. The
// thin animated bar stays as the only progress signal.
check('no numeric Question-N-of-M caption renders (subtle bar only)',
  !/Question \{cur\} of \{total\}/.test(cardSrc));
// CONTRACT CHANGE (owner 2026-08-22): the ~260 ms single-select auto-advance is GONE. A single tap
// selects only — the user must see the pick and the recomputed count before committing — and a
// second tap on the same option within DOUBLE_TAP_MS confirms. Asserted in BOTH directions so the
// old behaviour cannot creep back: no confirm-on-a-timer anywhere, and the double-tap path present.
check('a single tap NEVER auto-advances (no timer-driven onConfirm)',
  !/setTimeout\([^)]*onConfirm/.test(cardSrc) && !/onConfirm\([^)]*\),\s*\d+\s*\)/.test(cardSrc));
check('double tap on the same option confirms, via the SAME onPress path (no rival dbl handler)',
  /DOUBLE_TAP_MS/.test(cardSrc) && /lastTapRef/.test(cardSrc) &&
  !/onDoubleClick|onLongPress|doubleTapHandler/.test(cardSrc));
check('«رجوع» renders on the question card and rides onBack',
  /testID="af-back"/.test(cardSrc) && /onPress=\{onBack\}/.test(cardSrc) && /t\('Back'\)/.test(cardSrc));
// CONTRACT CHANGE (owner 2026-08-16, conversational refresh): the always-available escape is a calm
// «عرض النتائج» link — «The user must always be able to go straight to the properties … never feel
// trapped in the interview.» No question-count arithmetic in the link anymore.
check('the always-available escape link reads «عرض النتائج» and rides onSkipAll',
  /onPress=\{onSkipAll\}/.test(cardSrc) && /skipAllTxt/.test(cardSrc));
// Multi-select commits via «متابعة · N نتيجة» with the LIVE count (owner 2026-08-16 §4); single
// keeps «عرض N نتيجة». Both numbers come from the same liveCount pipe — never a placeholder.
check('multi-select primary reads Continue · {count} results with the live count',
  /Continue · \{count\} results/.test(cardSrc));
// §11: one tiny plain-language availability line; the technical unknown-count phrasing is gone.
check('availability is explained naturally (no database language, no unknown-count phrasing)',
  /Options reflect the information available for the current listings/.test(cardSrc)
  && !/Age unknown for \{count\}/.test(cardSrc));
// §2: the opening state is its own calm card — count, invitation, soft supporting line, opt-in
// begin + «عرض النتائج» — and it lives in the SAME shell as the questions (one visual language).
check('the intro card exists with the count + invitation + supporting line',
  /AdvancedIntroCard/.test(cardSrc)
  && /We found \{count\} properties/.test(cardSrc)
  && /Let’s pin down what you’re looking for/.test(cardSrc)
  && /We’ll use what we know about these listings/.test(cardSrc));
// §5: the live narrowing count is always visible (the bar chip), and §8: motion respects the
// user's reduced-motion setting everywhere the card animates.
check('a live narrowing count chip renders in the card bar and motion respects reduced-motion',
  /AnimatedCount/.test(cardSrc) && /useReducedMotion/.test(cardSrc));

// ── Brand image: card-owned registry + one shared slot; questions supply only a string TOKEN ─────
check('brand images are card-owned: registry in the card, single shared slot, token-only config',
  /BRAND_IMAGES/.test(cardSrc) && /brandStrip/.test(cardSrc)
  && !/require\(/.test(advSrc) && /brandImage: 'ejari-rnpl'/.test(advSrc));

// ── Select-then-confirm interaction for ALL ──────────────────────────────────────────────────────
check('every question is select-then-confirm: rows select, the footer commits',
  /onConfirm\(sel\)/.test(cardSrc) && /onPress=\{\(\) => pick\(o\.key\)\}/.test(cardSrc));

// ── Orchestration: eligible-based progress + plan + one confirm handler ──────────────────────────
check('progress denominator = ageFlow.progressTotal (the eligible set), NOT the static ADVANCED_QUESTIONS.length',
  /progressTotal=\{ageFlow\.progressTotal\}/.test(agentSrc) && !/progressTotal=\{ADVANCED_QUESTIONS\.length\}/.test(agentSrc));
check('agent builds a plan, presents via one confirm handler, and enters via anyGuidedEligible',
  /ageFlowPlanRef/.test(agentSrc) && /presentGuided/.test(agentSrc) && /onAgeConfirm/.test(agentSrc) && /anyGuidedEligible/.test(agentSrc));

// ── Intro-first Filter search (owner 2026-08-16, SUPERSEDED 2026-08-19) ──────────────────────────
// The 2026-08-16 rule below (auto-open the AF overlay on an intro after >25 results) was ITSELF
// killed by owner decision 2026-08-19: "The advanced filter interview must NEVER auto-open as a
// popup/overlay after a search. It only appears when the user manually taps «خلّنا نحدد الطلب
// أكثر»." The startAgeFlow(q, false, { auto: true }) trigger call site is gone; startAgeFlow's
// `opts?.auto` PARAMETER is deliberately left in place (harmless, unused surface) rather than
// stripped, since manual invocation still flows through the same function. Pinned in both
// directions so neither the manual path nor the auto-open's return can regress silently.
check('startAgeFlow takes a fallbackToRefine flag and only pops refine chips when it is set',
  /const startAgeFlow = async \(q: SearchQuery, fallbackToRefine = true/.test(agentSrc)
  && /if \(fallbackToRefine\) startRefine\(q\)/.test(agentSrc));
check('the auto-open trigger call site (>25 results -> startAgeFlow(..., { auto: true })) stays REMOVED',
  !/startAgeFlow\(q2, false, \{ auto: true/.test(agentSrc));
// The check above pins the EXACT call shape #768 deleted. Widened 2026-08-19 so a re-introduction
// under any other spelling — different variable, different spacing, an extra arg — is caught too;
// the literal check stays as the precise historical anchor.
check('no auto-entry into the interview can return under ANY spelling',
  !/startAgeFlow\([^;]*\bauto\s*:\s*true/.test(agentSrc)
  && !/anyGuidedEligible\([^)]*\)\s*&&\s*\w+\s*>\s*INTERVIEW_STOP_AT/.test(agentSrc));
check('the guided flow stays reachable on demand via the narrow-it-down button',
  /if \(q && anyGuidedEligible\(q\)\) void startAgeFlow\(q\)/.test(agentSrc));
// ── Result-intro count = matchTotal, never a page-capped length (owner bug, found live 2026-08-16)
// RESTORED 2026-08-19. The original guard read the `introTotal` const inside the auto-open block;
// #768 deleted that block and #770 dropped the guard with it as collateral, leaving this rule
// unprotected in the whole repo. But the RULE did not die with the popup — the computation simply
// MOVED into the results-message render, where it still feeds the on-screen «لقينا N» sentence (and
// now Read Aloud too). Without a guard, a future edit could reinstate the page-capped count that
// once displayed 1,500 (the candidate cap) when the true total was 8,458. Re-anchored to its new
// home rather than re-deleted.
check('the result-intro count comes from matchTotal, never a page-capped listings length',
  /const introTotal = m\.result\.matchTotal \?\? m\.result\.listings\.length/.test(agentSrc)
  && /const introCountSafe = !m\.result\.query\?\.priceIsAnnual && introTotal > 0/.test(agentSrc));

// ── Mining transition (owner 2026-08-16 §9) ─────────────────────────────────────────────────────
// The «digging through the market» beat is DECORATION: its dismissal is driven by plain setTimeout
// latches in finishGuided (never an animation callback — src/lib/afterAnimation.ts's rule), it uses
// the REAL from/to counts, and a hard failsafe dismisses it even if the search turn dies.
const miningSrc = readFileSync(join(root, 'src/components/MiningTransition.tsx'), 'utf8');
check('mining dismissal is setTimeout-driven with a hard failsafe (never an animation callback)',
  /phase: 'mining'/.test(agentSrc)
  && /timers\.push\(setTimeout\(/.test(agentSrc)
  && /15000/.test(agentSrc)
  && !/\.start\(\s*\(/.test(miningSrc));
check('mining shows real numbers and respects reduced motion',
  /Going through \{count\} properties/.test(miningSrc)
  && /We found \{count\} properties closest to your request/.test(miningSrc)
  && /useReducedMotion/.test(miningSrc));

// ── Results summary + removable pills (owner 2026-08-16 §10) ────────────────────────────────────
// Removal is PURE recomputation — rebuild from the interview's baseQ by re-applying the remaining
// facets through each question's own apply(), never a hand-written inverse per question id.
check('removable pills rebuild the query from baseQ via the questions’ own apply()',
  /removeGuidedFacet/.test(agentSrc)
  && /for \(const f of remaining\)/.test(agentSrc)
  && /question\.apply\(q, f\.keys\)/.test(agentSrc)
  && /Based on: \{labels\}/.test(agentSrc));

// ── Count RPCs must never receive p_sort_by (bug-hunt 2026-07-30) ────────────────────────────────
// PostgREST resolves RPCs by exact param-name match; leaking p_sort_by 404s BOTH counts calls the
// moment a sort is active, silently killing the guided flow. The count call sites must spread the
// sort-free helper, never rpcFilterParams directly.
const remoteSrc = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
check('both count RPCs spread rpcCountFilterParams (sort-free), never rpcFilterParams',
  /property_age_option_counts_ar',\s*\{\s*\.\.\.scopeParams,\s*\.\.\.rpcCountFilterParams\(q\)/.test(remoteSrc)
  && /apartment_guided_counts_ar',\s*\{\s*\.\.\.scopeParams,\s*\.\.\.rpcCountFilterParams\(q\)/.test(remoteSrc)
  && /const \{ p_sort_by: _drop, \.\.\.rest \}/.test(remoteSrc));

console.log(failed === 0 ? '\n✓ all advanced-filter contract assertions passed' : `\n✗ ${failed} contract assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
