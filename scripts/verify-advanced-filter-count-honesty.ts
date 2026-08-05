// Regression guard for the three advanced-filter parity fixes (audit wf_9b546ebc-267, 2026-08-04).
//
// The audit proved the advanced filter's core arithmetic is exact — 30/30 count-vs-search comparisons
// across 7 scopes, and strictness held on every returned row. These three defects were at the edges,
// all of them breaking owner rule 2 (the number next to an option must equal what the user gets) and
// one of them breaking rule 1 (strict options) as well.
//
//   1. BATHROOMS RE-ASK WIDENED INSTEAD OF INTERSECTING (worst — served wrong listings).
//      apartment_guided_counts_ar computes cnt_bath1..4 over the `scoped` CTE, which already has the
//      caller's p_bath_min applied. LIVE PROBE 2026-08-04, Riyadh annual-rent apartments:
//        no prior         → cnt_bath1 2984 / bath2 1973 / bath3 1117 / bath4 171
//        p_bath_min := 3  → cnt_bath1 1117 / bath2 1117 / bath3 1117 / bath4 171
//      So after answering «٣+» the «١+» pill reads 1,117 — but apply() REPLACED bathMin with 1 and the
//      search returned 2,984, of which 1,867 had FEWER bathrooms than the user asked for. Fixed by
//      (a) Math.max so an answer can only narrow, and (b) dropping rungs at/below the current floor,
//      which are duplicates of the current state rather than offers.
//
//   2. OPTION COUNTS IGNORED CLIENT-ONLY NARROWERS (up to 29× overstatement).
//      Every option count and the «اعرض N نتيجة» footer come from a count RPC, but three narrowers are
//      applied ONLY in runSearch(): agent keywords, the legacy size band, and the per-m² Buy budget.
//      hasClientOnlyNarrowing() already existed for exactly this (it suppresses the exact
//      «لقينا N إعلان» headline after the 9,647-vs-134 bug) but was wired only to the headline. Fixed
//      by gating the whole engine through eligibleQuestions(): counts that cannot be honest are not
//      shown at all, and the caller's existing "nothing qualifies" path falls back to refine chips.
//
//   3. GUIDED INTERVIEW'S MUST-HAVE AMENITY ANSWER DID NOTHING.
//      buildQuery() never wrote q.amenities, so p_amenities was never sent; the answer was echoed back
//      in the user's own bubble and then ignored. Fixed by mapping the answers the RPC's vocabulary
//      actually supports. The vocabulary is fixed and an unknown token matches nothing BY DESIGN, so
//      a guessed slug (e.g. 'pool') would silently zero out every result — Pool/Gym have no column and
//      are deliberately left unmapped (they broaden, per PRD §6.1).
//
//   node --experimental-strip-types scripts/verify-advanced-filter-count-honesty.ts  (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

const adv = readFileSync(new URL('../src/data/advancedFilters.ts', import.meta.url), 'utf8');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const interview = readFileSync(new URL('../src/app/interview.tsx', import.meta.url), 'utf8');
const search = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');

// ── 1. Bathrooms: intersect, never widen ─────────────────────────────────────────────────────────
// EXECUTED replica of the shipped apply(), so this tests the arithmetic and not just its spelling.
type Q = { bathMin: number | null };
const applyBath = (q: Q, keys: string[]): Q => {
  const n = parseInt(keys[0] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? { ...q, bathMin: Math.max(n, q.bathMin ?? 0) } : q;
};
eq('first answer installs the picked floor', applyBath({ bathMin: null }, ['3']).bathMin, 3);
eq('THE BUG: re-answering «1+» on top of «3+» must NOT widen to 1', applyBath({ bathMin: 3 }, ['1']).bathMin, 3);
eq('re-answering «2+» on top of «3+» must NOT widen to 2', applyBath({ bathMin: 3 }, ['2']).bathMin, 3);
eq('re-answering «4+» on top of «3+» narrows to 4', applyBath({ bathMin: 3 }, ['4']).bathMin, 4);
eq('empty answer (no preference) leaves the floor untouched', applyBath({ bathMin: 3 }, []).bathMin, 3);
eq('a junk key never nulls an existing floor', applyBath({ bathMin: 3 }, ['abc']).bathMin, 3);
check('shipped apply() uses Math.max against the existing floor',
  /apply:\s*\(q,\s*keys\)\s*=>\s*\{[\s\S]{0,400}?Math\.max\(n,\s*q\.bathMin\s*\?\?\s*0\)/.test(adv));
check('shipped apply() no longer REPLACES bathMin (the pre-fix one-liner is gone)',
  !adv.includes('bathMin: parseInt(keys[0], 10) || null'));

// Rungs at/below the current floor are duplicates of the current state, not offers — dropping them is
// what lets minOptionsFor('single') retire the question once nothing can narrow further.
const rungsFor = (floor: number) => ['1', '2', '3', '4'].filter((k) => parseInt(k, 10) > floor);
eq('unanswered → all four rungs offered', rungsFor(0), ['1', '2', '3', '4']);
eq('bathMin=3 → only «4+» can narrow', rungsFor(3), ['4']);
eq('bathMin=4 → nothing left to ask (question retires)', rungsFor(4), []);
check('shipped resolveOptions filters rungs above the current floor',
  /const floor = q\.bathMin \?\? 0;/.test(adv) && /rungs\.filter\(\(d\) => parseInt\(d\.key, 10\) > floor\)/.test(adv));

// ── 2. Engine gate: no card when the counts cannot be honest ─────────────────────────────────────
check('advancedFilters imports hasClientOnlyNarrowing from the search engine',
  /import \{[^}]*hasClientOnlyNarrowing[^}]*\} from '\.\/search'/.test(adv));
check('eligibleQuestions returns NO questions when a client-only narrower is active',
  /export function eligibleQuestions\([\s\S]{0,200}?if \(hasClientOnlyNarrowing\(q\)\) return \[\];/.test(adv));
check('eligibleQuestions still applies each question\'s own eligibility() gate',
  /return ADVANCED_QUESTIONS\.filter\(\(question\) => question\.eligibility\(q\)\);/.test(adv));
check('the offer gate (anyGuidedEligible) routes through eligibleQuestions',
  /function anyGuidedEligible\(q: SearchQuery\): boolean \{\s*return eligibleQuestions\(q\)\.length > 0;/.test(agent));
check('the flow planner (startAgeFlow) routes through eligibleQuestions',
  agent.includes('const eligible = eligibleQuestions(q);'));
check('NO call site re-derives eligibility by filtering ADVANCED_QUESTIONS itself (contract: gates live in the engine)',
  !/ADVANCED_QUESTIONS\s*\.?\s*(filter|some)\(\((question|c)\) => \1\.eligibility/.test(agent));
check('hasClientOnlyNarrowing still guards the exact count headline too (its original job)',
  agent.includes('hasClientOnlyNarrowing(m.result.query)'));
check('hasClientOnlyNarrowing still covers all three narrowers',
  /if \(q\.keywords && q\.keywords\.length\) return true;/.test(search)
  && /q\.contextSize \|\| \(q\.detail && !bedroomSpec\(q\)\)/.test(search)
  && /q\.deal === 'Buy'[\s\S]{0,300}?amount <= 50_000\) return true;/.test(search));

// ── 3. Interview: the must-have amenity actually filters ─────────────────────────────────────────
check('buildQuery writes q.amenities from the answer',
  /if \(real\(a\.s_amenities\) && AMENITY_TOKEN\[a\.s_amenities\]\) q\.amenities = \[AMENITY_TOKEN\[a\.s_amenities\]\];/.test(interview));

// The live p_amenities vocabulary of location_search_candidates_ar, read off pg_get_functiondef
// 2026-08-04. An unknown token matches nothing BY DESIGN, so every mapped value must be in this set —
// a typo here would silently zero out every interview search that answers this question.
const LIVE_AMENITY_TOKENS = new Set([
  'elevator', 'parking', 'kitchen', 'ac', 'maid_room', 'driver_room', 'private_entrance',
  'furnished', 'rnpl', 'rent_now_pay_later',
]);
const mapBlock = interview.match(/const AMENITY_TOKEN: Record<string, string> = \{([\s\S]*?)\};/);
check('AMENITY_TOKEN map exists', !!mapBlock);
const mapped = [...(mapBlock?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
check(`every mapped token is in the live RPC vocabulary (mapped: ${mapped.join(', ')})`,
  mapped.length > 0 && mapped.every((tok) => LIVE_AMENITY_TOKENS.has(tok)));
check('Pool and Gym are NOT mapped — no such column exists, and a guessed slug would zero out results',
  !/'pool'/i.test(mapBlock?.[1] ?? '') && !/'gym'/i.test(mapBlock?.[1] ?? ''));

// The amenities question's own skip option must not be treated as a stated preference (it was
// previously echoed back to the user as a chosen extra).
const NO_PREFERENCE = "Doesn't matter";
const realReplica = (v?: string) => !!v && v !== '__skip' && v !== 'Other' && v !== NO_PREFERENCE;
check('«Doesn\'t matter» is treated as a skip, not an answer', !realReplica(NO_PREFERENCE));
check('a genuine amenity answer is still treated as an answer', realReplica('Parking'));
check('shipped real() excludes the no-preference option',
  /const real = \(v\?: string\) => !!v && v !== SKIP && v !== 'Other' && v !== NO_PREFERENCE;/.test(interview));

if (failed) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll advanced-filter count-honesty checks passed.');
