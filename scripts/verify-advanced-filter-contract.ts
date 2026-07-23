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
check('queue order is RNPL → age → amenities → bathrooms',
  /ADVANCED_QUESTIONS[^=]*=\s*\[\s*RNPL_QUESTION,\s*AGE_QUESTION,\s*AMENITIES_QUESTION,\s*BATHROOMS_QUESTION/.test(advSrc));
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
check('the three annual questions gate on isAnnualRentApartment',
  (advSrc.match(/eligibility:\s*isAnnualRentApartment/g) || []).length >= 3);

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
check('numeric progress caption (Question {cur} of {total}) renders beside the bar for every question',
  /Question \{cur\} of \{total\}/.test(cardSrc) && /progNum/.test(cardSrc));
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

console.log(failed === 0 ? '\n✓ all advanced-filter contract assertions passed' : `\n✗ ${failed} contract assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
