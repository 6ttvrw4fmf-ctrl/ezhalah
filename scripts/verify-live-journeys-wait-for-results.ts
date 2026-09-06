// A LIVE JOURNEY MUST WAIT FOR THE RESULTS, NOT FOR THE REQUEST AND NOT FOR A CLOCK.
//
// THE CLASS. Three live journeys have now been found reading the screen before production had put
// anything on it, and each time the harness reported a CORRECT production as broken:
//
//   • the district panel (#1734)  `click(); await sleep(4200);` then one scrape.
//   • combined Buy+Rent (here)    polled until the search REQUEST landed — the first thing that
//                                 happens after «بحث», not the last — then immediately read
//                                 `hydrated` and the DOM. Measured 2026-09-04: driving the same
//                                 flow by hand, production answered «لقينا 28,846 إعلان», hydrated
//                                 9,421 rows and painted «/سنوياً» + «/شهرياً» cards, while this
//                                 journey saw `0 row(s) hydrated` and `0 «/سنوياً»` and accused
//                                 production of the pre-2026-09-02 rent-deletion defect.
//   • trending four-way (here)    `tap('بحث'); await page.waitForTimeout(14000);` then read.
//
// It is NOT latency. The combined journey failed byte-identically with production INSIDE its own
// envelope (`degraded=false`, mean 909 ms, 1.53 q/s) and while degraded — same three failures, same
// numbers. A wait for the wrong event does not get better on a fast day; it just loses less often.
//
// THE RULE THIS PINS, and the subtle half is the second one:
//
//   1. Between committing the search and reading what it produced, there must be a readiness wait —
//      never a fixed sleep, never only "the request was sent".
//   2. THE READINESS CONDITION MUST BE NEUTRAL. It must not wait for the thing the journey is about
//      to assert. Waiting until rent cards appear would make a genuine rent-deletion regression —
//      the exact defect the journey exists to catch — never settle, and it would then be filed as a
//      non-arrival instead of the red it is. A hidden defect is worse than a false one.
//   3. It must settle on QUIESCENCE, not first sight. "Some price is on screen" settles on the first
//      card to paint, which for a 28,846-row cohort is a Buy card far more often than a rent one;
//      that is how two of the three assertions still failed after the first fix attempt.
//
// Every assertion below runs on COMMENT-STRIPPED source, and that is load-bearing here rather than
// hygiene: this very file's subject matter means `waitForTimeout(14000)` and the word `سنوياً` appear
// in prose inside the files under test, so a raw grep would be satisfied by the explanation of the
// bug it is meant to forbid. Mutation M5 proves the decoy does not fool it.
//
//   node --experimental-strip-types scripts/verify-live-journeys-wait-for-results.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const COMBINED = 'scripts/verify-combined-budget-live.ts';
const TRENDING = 'scripts/verify-trending-live-four-way-truth.ts';
const PILL = 'scripts/verify-af-remove-last-pill-live.ts';
const rawOf = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/** A mutation proof: the rule under test, applied to the real source with the real regression put
 *  back, asserted to go RED. Named so scripts/verify-new-barriers-are-mutation-proven.ts can see it
 *  is an executable re-break rather than prose claiming one. */
const mustCatch = (label: string, caught: boolean, detail = '') => check(label, caught, detail);

// ── the rules, each computed from stripped source ───────────────────────────────────────────────

/** COMBINED: the readiness wait must sit between the request-landed check and the result reads. */
function combinedRules(src: string) {
  const landedIdx = src.indexOf('const landed = await settleUntil');
  const readyIdx = src.indexOf('const results = await settleUntil');
  const rentIdx = src.indexOf('const rentRows = hydrated.filter');
  // the readiness closure only — so the neutrality rule cannot be satisfied or broken by other code
  const closure = readyIdx >= 0 && rentIdx > readyIdx ? src.slice(readyIdx, rentIdx) : '';
  return {
    ordered: landedIdx >= 0 && readyIdx > landedIdx && rentIdx > readyIdx,
    exists: readyIdx >= 0,
    // neutral: the wait must not mention the deal-specific things the journey asserts
    neutral: closure.length > 0 && !/Rent|سنوياً|شهرياً|transaction_type|rentRows/.test(closure),
    // quiescence: compares this reading against the previous one
    quiescent: /prev\s*[.=]/.test(closure) && /===\s*prev\./.test(closure),
    // non-arrival is reported, not silently passed over
    reportsNonArrival: /if \(!results\.settled\)[\s\S]{0,600}?unobserved\(/.test(src),
  };
}

/** TRENDING: no fixed sleep between «بحث» and the headline read; a readiness wait instead. */
function trendingRules(src: string) {
  const tapIdx = src.indexOf("await tap('بحث');");
  const checkIdx = src.indexOf('the search request was captured after click-through');
  const between = tapIdx >= 0 && checkIdx > tapIdx ? src.slice(tapIdx, checkIdx) : '';
  return {
    ordered: between.length > 0,
    // a long fixed sleep is exactly the defect; short settling waits elsewhere are not in this span
    noFixedSleep: between.length > 0 && !/waitForTimeout\(\s*\d{4,}\s*\)/.test(between),
    hasReadinessWait: /settleUntil\(/.test(between),
    quiescent: /===\s*prevHeadline/.test(between),
    // neutral: it waits for a headline to exist and stop moving, never for a particular number
    neutral: between.length > 0 && !/rpcTotal|uiCount\s*===/.test(between),
  };
}

/** PILL: the first-page size must come from the PRODUCT's initialReveal(), not a copy of the rule.
 *
 *  The second way a live journey calls a correct production broken: it keeps its own copy of a
 *  product rule and the product moves. FIRST_PAGE stopped being a cap on 2026-09-02 (#1688, owner
 *  PERMANENT rule) and became a FLOOR — reveal max(10, distinct matching platforms) — but this
 *  journey still asserted `min(total, 10)`, so the restored الرياض turn rendering 13 cards for its
 *  13 matching platforms was reported as `expected=10`. Calling the real function cannot drift. */
function pillRules(src: string) {
  return {
    callsProduct: /initialReveal\(\{/.test(src) && /from '\.\.\/src\/lib\/initialReveal\.ts'/.test(src),
    usesRealPlatformCount: /distinctPlatformCount\(/.test(src)
      && /from '\.\.\/src\/lib\/platformDiversity\.ts'/.test(src),
    // the stale cap must not come back, in the rule or at the call site
    noLocalCap: !/renderedFirstPage:[^\n]*Math\.min\([^\n]*firstPage/.test(src)
      && !/renderedFirstPage\([^)]*,\s*N2\s*,\s*FIRST_PAGE\s*\)/.test(src),
  };
}

const combined = combinedRules(stripComments(rawOf(COMBINED)));
const trending = trendingRules(stripComments(rawOf(TRENDING)));
const pill = pillRules(stripComments(rawOf(PILL)));

console.log(`  ${COMBINED}`);
check('the readiness wait exists', combined.exists, 'no `const results = await settleUntil`');
check('it sits BETWEEN the request-landed wait and the result reads', combined.ordered,
  'ordering is wrong — a wait after the read is not a wait');
check('the readiness condition is NEUTRAL (never waits for the rent rows it asserts)',
  combined.neutral, 'the wait references the very thing being asserted — a regression would be hidden, not reported');
check('it settles on QUIESCENCE, not first sight', combined.quiescent,
  'no comparison against the previous reading');
check('a non-arrival is reported rather than passed over', combined.reportsNonArrival,
  'no unobserved() on the !settled path');

console.log(`\n  ${TRENDING}`);
check('the «بحث» → headline span is present', trending.ordered, 'anchors not found');
check('no fixed multi-second sleep stands in for waiting', trending.noFixedSleep,
  'a waitForTimeout(>=1000) literal is back between the search and the read');
check('a readiness wait is used instead', trending.hasReadinessWait, 'no settleUntil in the span');
check('it settles on QUIESCENCE, not first sight', trending.quiescent, 'no comparison against prevHeadline');
check('the readiness condition is NEUTRAL (never waits for the count to equal the RPC)',
  trending.neutral, 'the wait references the asserted equality');

console.log(`\n  ${PILL}`);
check('the first-page size is read from the PRODUCT\'s initialReveal(), not re-derived',
  pill.callsProduct, 'the journey keeps its own copy of a rule the product owns');
check('the platform count comes from the product\'s distinctPlatformCount()',
  pill.usesRealPlatformCount, 'a hand-rolled platform count will drift from the product\'s');
check('the pre-#1688 fixed cap min(total, FIRST_PAGE) is gone', pill.noLocalCap,
  'the stale cap is back — a scope matching >10 platforms will be reported as a product defect');

console.log('');
check('npm test discovers and runs this check',
  npmTestRuns(ROOT, 'verify-live-journeys-wait-for-results'), 'not in the resolved run set');

// ── MUTATION PROOFS — each is the real regression, applied to the real source ────────────────────
type Mut = { name: string; file: string; apply: (s: string) => string; rule: (src: string) => boolean };
const muts: Mut[] = [
  { name: 'M1 restore the fixed 14s sleep in the trending journey', file: TRENDING,
    apply: (s) => s.replace("await tap('بحث');", "await tap('بحث');\n    await page.waitForTimeout(14000);"),
    rule: (s) => trendingRules(s).noFixedSleep },
  { name: 'M2 delete the readiness wait in the combined journey', file: COMBINED,
    apply: (s) => s.replace(/  let prev = \{ rows: -1, sar: -1 \};[\s\S]*?\n  \}\n\n(?=  const rentRows)/, ''),
    rule: (s) => combinedRules(s).exists && combinedRules(s).ordered },
  { name: 'M3 wait on the ASSERTED thing (rent), which would HIDE a real regression', file: COMBINED,
    apply: (s) => s.replace('(v) => v.stable,', '(v) => v.stable && hydrated.some((r: any) => r.transaction_type === \'Rent\'),'),
    rule: (s) => combinedRules(s).neutral },
  { name: 'M4 settle on FIRST SIGHT instead of quiescence', file: COMBINED,
    apply: (s) => s.replace(/const stable = now\.rows > 0 && now\.sar > 0 && now\.rows === prev\.rows && now\.sar === prev\.sar;/,
      'const stable = now.rows > 0 && now.sar > 0;'),
    rule: (s) => combinedRules(s).quiescent },
  { name: 'M5 delete the wait but leave it behind as a COMMENT (the decoy)', file: COMBINED,
    apply: (s) => s.replace(/  let prev = \{ rows: -1, sar: -1 \};[\s\S]*?\n  \}\n\n(?=  const rentRows)/,
      '  // let prev = { rows: -1, sar: -1 };\n  // const results = await settleUntil(...) === prev.rows ... unobserved(\n'),
    rule: (s) => combinedRules(s).exists && combinedRules(s).ordered },
  { name: 'M7 restore the pre-#1688 fixed cap in the rule', file: PILL,
    apply: (s) => s.replace(
      /renderedFirstPage: \(delta: number, expected: number \| null\) =>\n\s*expected != null && Number\.isFinite\(expected\) && delta === expected,/,
      'renderedFirstPage: (delta: number, total: number | null, firstPage: number) => total != null && Number.isFinite(total) && delta === Math.min(total, firstPage),'),
    rule: (s) => pillRules(s).noLocalCap },
  { name: 'M8 stop calling the product and re-derive the first page locally', file: PILL,
    apply: (s) => s.replace("import { initialReveal } from '../src/lib/initialReveal.ts';", ''),
    rule: (s) => pillRules(s).callsProduct },
  { name: 'M6 stop reporting a non-arrival (silently pass over it)', file: COMBINED,
    apply: (s) => s.replace(/if \(!results\.settled\) \{[\s\S]*?\n  \}\n/, ''),
    rule: (s) => combinedRules(s).reportsNonArrival },
];

console.log('\n  mutation proofs (each must turn its rule RED):');
for (const m of muts) {
  const raw = rawOf(m.file);
  const mutated = m.apply(raw);
  const changed = mutated !== raw;
  const stillGreen = m.rule(stripComments(mutated));
  mustCatch(`${m.name} — applied and caught`, changed && !stillGreen,
    !changed ? 'mutation did not apply (pattern drifted — fix the mutant, not the rule)'
             : 'MUTANT SURVIVED: the rule passes on the regression it exists to catch');
}

console.log(failures === 0
  ? '\nverify-live-journeys-wait-for-results: all checks passed'
  : `\nverify-live-journeys-wait-for-results: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
