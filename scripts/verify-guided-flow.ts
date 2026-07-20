// Static invariant checks for the Apartment → Annual Rent guided flow (owner 2026-07-20). Mirrors
// verify-district-field.ts: greps the shipped source so the load-bearing rules can't silently regress.
// The flow must: ask installments → property age → amenities → minimum bathrooms, in that order; scope
// the three new questions to a single-Apartment / Residential / Rent / ANNUAL query (Monthly + Buy get
// no RNPL/amenities/bathrooms); treat amenities + RNPL as STRICT chip tokens; show a live result count
// on the multi-select continue button; and chain the steps into ONE search at the end.
//
//   node --experimental-strip-types scripts/verify-guided-flow.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const advSrc = readFileSync(join(root, 'src/data/advancedFilters.ts'), 'utf8');
const cardSrc = readFileSync(join(root, 'src/components/AdvancedQuestionCard.tsx'), 'utf8');
const agentSrc = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const remoteSrc = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── Exact sequence: installments → age → amenities → bathrooms ────────────────────────────────────
check('ADVANCED_QUESTIONS order is RNPL → age → amenities → bathrooms',
  /ADVANCED_QUESTIONS[^=]*=\s*\[\s*RNPL_QUESTION,\s*AGE_QUESTION,\s*AMENITIES_QUESTION,\s*BATHROOMS_QUESTION/.test(advSrc));
check('RNPL question is first and multi-select (installments chip)',
  /RNPL_QUESTION[\s\S]{0,500}mode:\s*'multi'/.test(advSrc) && /'Do you prefer listings with installment options\?'/.test(advSrc));
check('amenities is multi-select and includes the Furnished chip',
  /AMENITIES_QUESTION[\s\S]{0,700}mode:\s*'multi'/.test(advSrc) && /key:\s*'furnished'/.test(advSrc));
check('bathrooms is single-select', /BATHROOMS_QUESTION[\s\S]{0,400}mode:\s*'single'/.test(advSrc));

// ── Scope: annual-rent apartment ONLY (Monthly + Buy excluded from the three new questions) ───────
check('the three new questions gate on a single Apartment type', /types\[0\]\s*===\s*'Apartment'/.test(advSrc));
check('gated to Residential + Rent + ANNUAL (rentPeriod !== monthly)',
  /q\.category\s*===\s*'Residential'\s*&&\s*q\.deal\s*===\s*'Rent'\s*&&\s*q\.rentPeriod\s*!==\s*'monthly'/.test(advSrc));
check('each new question calls isAnnualRentApartment before showing options',
  (advSrc.match(/isAnnualRentApartment\(q\)/g) || []).length >= 3);

// ── Strictness: Furnished + RNPL are STRICT amenity tokens (not the lenient p_furnished) ───────────
check('picked chips are merged into q.amenities (strict RPC tokens)', /mergeAmenities/.test(advSrc) && /addAmenities/.test(advSrc));
check('bathrooms sets a strict minimum (bathMin)', /bathMin:\s*parseInt/.test(advSrc));

// ── Multi-select card: toggle chips + live count on the continue button ───────────────────────────
check('multi card renders a live result count on the continue button',
  /Show \{count\} apartments/.test(cardSrc) && /liveCount\(sel\)/.test(cardSrc));
check('card branches on mode (generic, no per-question special-casing)', /mode\s*===\s*'multi'/.test(cardSrc));

// ── Chained orchestration: accumulate answers, ONE search at the end, skip advances ───────────────
check('agent chains steps via advanceGuided and searches once at the end (__guided__)',
  /advanceGuided/.test(agentSrc) && /'__guided__'/.test(agentSrc));
check('Skip advances to the next question (does not end the whole flow)', /onAgeSkip[\s\S]{0,180}advanceGuided/.test(agentSrc));
check('multi confirm merges the selection via the config', /onAgeMultiConfirm[\s\S]{0,260}applyMulti/.test(agentSrc));

// ── Data layer: params + count RPC wired ──────────────────────────────────────────────────────────
check('remote sends p_amenities + p_bath_min to the search RPC',
  /p_amenities:\s*q\.amenities/.test(remoteSrc) && /p_bath_min:\s*q\.bathMin/.test(remoteSrc));
check('remote fetches guided counts via apartment_guided_counts_ar', /apartment_guided_counts_ar/.test(remoteSrc));

console.log(failed === 0 ? '\n✓ all guided-flow assertions passed' : `\n✗ ${failed} guided-flow assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
