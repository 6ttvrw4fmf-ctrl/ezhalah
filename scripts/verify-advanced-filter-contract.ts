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
  && /INTERVIEW_STOP_AT = 25/.test(advSrc)
  && /MIN_TOTAL_TO_SHOW = INTERVIEW_STOP_AT \+ 1/.test(advSrc));
check('the orchestrator re-ranks after every answer and tracks asked questions (never re-asks)',
  /rankQuestions\(q, ageFlowAskedRef\.current\)/.test(agentSrc) && /ageFlowAskedRef\.current\.add\(/.test(agentSrc));
check('furnished question is single-select, Rent-only, true tri-state via furnishedPref',
  /FURNISHED_QUESTION[\s\S]{0,400}selection:\s*'single'/.test(advSrc)
  && /FURNISHED_QUESTION[\s\S]{0,400}eligibility:\s*isAnnualRentApartment/.test(advSrc)
  && /furnishedPref:\s*true/.test(advSrc) && /furnishedPref:\s*false/.test(advSrc));
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
  /MIN_REAL_OPTION_COUNT/.test(advSrc) && /function meaningful/.test(advSrc)
  && !/MIN_REAL_BUCKET_COUNT/.test(advSrc) && !/\.count\(counts\)\s*>\s*0/.test(advSrc));
// RNPL is a rent concept → rent-only. Amenities + bathrooms are physical attributes → they extend to
// BUY apartments too (owner follow-up 2026-07-27), via isApartmentAttributeScope (deal Buy OR annual Rent).
check('RNPL gates rent-only (isAnnualRentApartment); amenities + bathrooms extend to Buy (isApartmentAttributeScope)',
  /RNPL_QUESTION[\s\S]{0,400}eligibility:\s*isAnnualRentApartment/.test(advSrc)
  && (advSrc.match(/eligibility:\s*isApartmentAttributeScope/g) || []).length >= 2
  && /function isApartmentAttributeScope[\s\S]{0,400}q\.deal\s*===\s*'Buy'[\s\S]{0,120}q\.deal\s*===\s*'Rent'/.test(advSrc));
check('Furnished chip stays Rent-only — never offered on Buy (owner: Buy furnished ≈2%)',
  /isAnnualRentApartment\(q\)\)\s*defs\.push\(\{\s*key:\s*'furnished'/.test(advSrc));

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
check('single-select auto-advances after a short hold via plain setTimeout (never an animation callback)',
  /setTimeout\(\(\) => onConfirm\(next\), 260\)/.test(cardSrc));
check('skip-all link discloses how many questions remain',
  /Skip remaining \(\{count\}\) and search now/.test(cardSrc));

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

// ── Results-first Filter search (owner 2026-08-03) ───────────────────────────────────────────────
// A تصفية search shows its results immediately and must NOT auto-open the guided interview — the modal
// jumping over the cards read as an unprompted quiz. The SAME shared flow stays one tap away via the
// «narrow it down» button, so the opt-in entry (anyGuidedEligible → startAgeFlow) must still exist.
check('startAgeFlow takes a fallbackToRefine flag and only pops refine chips when it is set',
  /const startAgeFlow = async \(q: SearchQuery, fallbackToRefine = true\)/.test(agentSrc)
  && /if \(fallbackToRefine\) startRefine\(q\)/.test(agentSrc));
check('filter search is results-first: NO auto-open of the guided flow after a search',
  !/if \(anyGuidedEligible\(guidedQ\)\) void startAgeFlow\(guidedQ, false\)/.test(agentSrc));
check('the guided flow stays reachable on demand via the narrow-it-down button',
  /if \(q && anyGuidedEligible\(q\)\) void startAgeFlow\(q\)/.test(agentSrc));

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
