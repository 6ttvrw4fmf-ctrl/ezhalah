// A FIXED SLEEP IS NOT AN ORACLE, AND THE DANGEROUS FAILURE IS THE QUIET ONE.
//
// `double-click-search` asks whether one press of «بحث» fires one search and a double-press fires
// no more. It measured both sides by sleeping 10s and reading a counter. One press fires SIX
// `location_search_candidates_ar` calls (measured, JOURNEY_PERSISTENCE_ENGINEER.md §11.3), so the
// window has to outlast all six on the slowest engine.
//
// It did not. Measured 2026-09-03, WebKit mobile against production: the SINGLE side captured 1 of
// 6 inside the window, the double side captured 6, and the journey filed «double-click fired the
// search twice — single click -> 1 search RPCs, double click -> 6» against an app that had done
// nothing wrong (1/4).
//
// THE MIRROR CASE IS WHY THIS BARRIER EXISTS. If the short capture lands on the DOUBLE side
// instead, a genuine double-fire compares as `double <= single` and the journey PASSES — the guard
// silently failing to guard, on any engine slow enough. That is the direction nobody notices.
//
// `settledCount()` therefore waits for the count to STOP GROWING from a non-zero start, and returns
// `settled:false` rather than a number when it never does, so the caller refuses to compare an
// unfinished measurement instead of comparing two numbers of unknown completeness.
//
// Executed here with an injected clock and sleep, so the real function runs without spending real
// seconds — the same "execute it, don't grep it" rule as the voice and support barriers.
//
// Run: node --experimental-strip-types scripts/verify-journey-settled-count.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { settledCount, classifySearchRpc, SELECTED_CITY_MARKER } from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};

/** A virtual clock: `sleepFn` advances it, so the poll loop runs at full speed. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleepFn: async (ms: number) => { t += ms; } };
}

/** A counter that reaches `target` by stepping up every `stepMs` of virtual time, then holds. */
function risingCounter(clock: { now: () => number }, target: number, stepMs: number) {
  return () => Math.min(target, Math.floor(clock.now() / stepMs));
}

// ── 1. The measured production shape: 6 calls arriving over ~9s ─────────────────────────────────
{
  const c = fakeClock();
  const r = await settledCount(risingCounter(c, 6, 1_500), { ...c, budgetMs: 45_000, stableMs: 3_000 });
  check('six calls arriving over ~9s are ALL counted, and the result is marked settled',
    r.n === 6 && r.settled === true);
}

// ── 2. The exact WebKit failure: six calls that outlast the old fixed window ────────────────────
// Six arriving 2s apart span 12s — past the 10s sleep the journey used to read at, which is how a
// partial count of 1 reached the verdict. All six must now be counted.
{
  const c = fakeClock();
  const r = await settledCount(risingCounter(c, 6, 2_000), { ...c, budgetMs: 45_000 });
  check('six calls spanning 12s (past the old 10s window that produced «1») still count 6, not a partial',
    r.n === 6 && r.settled === true);
}

// ── 2b. The contract's own boundary, stated rather than assumed ─────────────────────────────────
// `settled` means "no new call for stableMs". A trickle SLOWER than that window settles early by
// construction — which is exactly why the constant must exceed the real inter-arrival gap, and why
// this is asserted instead of left as folklore. If someone ever lowers stableMs below the observed
// jitter, this is the check that says what they broke.
{
  const c = fakeClock();
  const r = await settledCount(risingCounter(c, 6, 9_000), { ...c, budgetMs: 60_000, stableMs: 5_000 });
  check('a trickle slower than stableMs settles early BY CONTRACT — stableMs must exceed the real gap (documented, not accidental)',
    r.settled === true && r.n < 6);
}

// ── 3. A count that never stops growing is NOT a measurement ────────────────────────────────────
{
  const c = fakeClock();
  const r = await settledCount(() => Math.floor(c.now() / 100) + 1, { ...c, budgetMs: 20_000, stableMs: 3_000 });
  check('a forever-growing count returns settled:false so the caller refuses to compare it',
    r.settled === false);
}

// ── 4. Zero is never "settled" ──────────────────────────────────────────────────────────────────
// The app types an intro before the first request, so an early zero means "not started yet", not
// "fired nothing" (PART 11.2 rule 1). Treating a stable 0 as settled would report a dead control.
{
  const c = fakeClock();
  const r = await settledCount(() => 0, { ...c, budgetMs: 20_000, stableMs: 3_000 });
  check('a count stuck at 0 is NOT reported as settled — a not-yet-started search is not a dead control',
    r.n === 0 && r.settled === false);
}
{
  // ...but a genuinely late first request is still caught within the budget.
  const c = fakeClock();
  const r = await settledCount(risingCounter(c, 3, 4_000), { ...c, budgetMs: 45_000, stableMs: 3_000 });
  check('a search that starts late still settles once its calls arrive', r.n === 3 && r.settled === true);
}

// ── 5. It waits the full stability window before declaring settled ──────────────────────────────
// Returning at the first repeat would reintroduce the partial-capture bug with extra steps.
{
  const c = fakeClock();
  // Jumps to 5 immediately, then adds a 6th at t=2000 — inside a 3000ms stability window.
  const r = await settledCount(() => (c.now() >= 2_000 ? 6 : 5), { ...c, budgetMs: 45_000, stableMs: 3_000 });
  check('a call arriving INSIDE the stability window resets it — the late 6th is not missed',
    r.n === 6 && r.settled === true);
}

// ── 6. The journey actually uses it, and no fixed sleep is left standing in for an oracle ───────
const run = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
const journey = run.slice(run.indexOf("JOURNEYS['double-click-search']"), run.indexOf("JOURNEYS['back-after-search']"));
check('double-click-search measures both sides with settledCount()', /settledCount\(/.test(journey));
// Anchored to CODE lines: this file's own explanation quotes the old `sleep(10_000)` call, and a
// naive substring match would fail on the comment that documents the fix.
const journeyCode = journey.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
check('double-click-search no longer reads its counts after a fixed sleep',
  !/sleep\(10_000\)/.test(journeyCode));
check('an unsettled count is REFUSED rather than compared',
  /!single\.settled/.test(journey) && /!double\.settled/.test(journey) && /skip\(name,/.test(journey));
check('the pass line reports both counts AND that they settled, so a reader can see the measurement was complete',
  /both settled/.test(journey));
// A CLICK THAT NEVER LANDED IS NOT A DEAD CONTROL. The «بحث» click used to swallow its error in a
// bare `.catch(() => {})`, so an intercepted click produced zero RPCs and the journey reported
// «dead control» — its most alarming verdict, from the least evidence (measured 2/2 on WebKit
// desktop, 2026-09-04, while Chromium and Firefox ran the same journey clean on that bundle).
// Matched on the ANTIPATTERN itself, not on one line's formatting: the first version of this check
// pinned the exact single-line `.click({...}).catch(() => {})` and a mutation that merely split it
// across two lines walked straight through. A bare swallowing catch anywhere in this journey is the
// thing that must not come back, however it is laid out.
check('the «بحث» click no longer swallows its own failure (no bare catch anywhere in this journey)',
  !/catch\(\(\)\s*=>\s*\{\s*\}\)/.test(journeyCode));
check('a click that never landed SKIPS with the reason instead of being called a dead control',
  /clickErr/.test(journeyCode) && /never landed/.test(journey));
check('the non-landing check is judged BEFORE the dead-control verdict',
  journey.indexOf('never landed') < journey.indexOf("'dead control'"));

// ── 7. COUNTING CALLS IS NOT COUNTING SEARCHES ──────────────────────────────────────────────────
// `location_search_candidates_ar` is the results query AND the RPC behind fetchScopeOptionCounts
// and fetchDistrictEligibleCounts, which fire one `p_limit: 1` call PER VISIBLE OPTION on the
// screen the search just produced (src/data/remote.ts:920, :965, :1476). So the raw call count is a
// property of what the results screen decorates, not of how many searches were submitted.
//
// Measured on production 2026-09-04, mobile, 2/2 each: a SINGLE press → 6 calls = 1 results
// (p_limit 1500) + 5 option counts; a DOUBLE press → also 6 = 1 results + 5 option counts. So the
// app submits one search either way, and the results class shows it as 1 = 1 — while the raw count
// produced «double-click fired the search twice: single -> 1, double -> 6» on WebKit mobile.
const rpc = (name: string, body: unknown) => ({ name, body });
check('the RESULTS query (p_limit 1500) is a search',
  classifySearchRpc(rpc('location_search_candidates_ar', { p_limit: 1500, p_offset: 0 })) === 'results');
check('a p_limit:1 option-count call is NOT a search',
  classifySearchRpc(rpc('location_search_candidates_ar', { p_limit: 1, p_districts: ['حي'] })) === 'option-count');
check('a page-2 results call (p_limit 1500, offset 1500) is still a search',
  classifySearchRpc(rpc('location_search_candidates_ar', { p_limit: 1500, p_offset: 1500 })) === 'results');
check('a different RPC entirely is neither',
  classifySearchRpc(rpc('loader_active_platforms_ar', { p_limit: 1500 })) === 'other');
// An unreadable body must NOT be guessed into the results class — that is the direction that
// manufactures a double-fire out of a parse failure.
check('an unparsable body is UNKNOWN, never silently counted as a search',
  classifySearchRpc(rpc('location_search_candidates_ar', null)) === 'unknown');
check('a body with no p_limit at all is UNKNOWN, not a search',
  classifySearchRpc(rpc('location_search_candidates_ar', { p_offset: 0 })) === 'unknown');
check('null/undefined entries do not throw and are not searches',
  classifySearchRpc(null) === 'other' && classifySearchRpc(undefined) === 'other');
// The measured mixes, end to end: both sides are ONE search.
{
  const press = [rpc('location_search_candidates_ar', { p_limit: 1500 }),
    ...Array.from({ length: 5 }, () => rpc('location_search_candidates_ar', { p_limit: 1 })),
    rpc('loader_active_platforms_ar', {})];
  check('the measured 6-call press counts as exactly ONE results search',
    press.filter((r) => classifySearchRpc(r) === 'results').length === 1);
  check('a GENUINE double-fire (two results calls) is still counted as two — the guard still guards',
    [...press, rpc('location_search_candidates_ar', { p_limit: 1500 })]
      .filter((r) => classifySearchRpc(r) === 'results').length === 2);
}
check('the journey counts the RESULTS class, not every call with that RPC name',
  /classifySearchRpc\(r\) === cls/.test(journeyCode) && /'results'/.test(journeyCode));
check('an unknown-class call is REFUSED rather than compared',
  /unknown/.test(journeyCode) && /unreadable body/.test(journey));

// ── 8. A FORM THE APP WILL REFUSE TO SUBMIT IS NOT A PRIMED FORM ────────────────────────────────
// `onSearch` returns at `if (!citySelected)` with a validation message and ZERO requests
// (src/app/index.tsx:712) — the owner's 2026-07-17 spec, "never guess a location". Only a tapped
// suggestion row sets `citySelected`, and every keystroke clears it, so the tap is a race. When it
// loses, «بحث» correctly fires nothing and the journey called that a DEAD CONTROL (WebKit desktop,
// 2026-09-04). primeSearch must prove the city was committed before any caller reaches a verdict.
check('SELECTED_CITY_MARKER is a testID, not visible text — text answers true from the wrong screen',
  /^\[data-testid="[a-z-]+"\]$/.test(SELECTED_CITY_MARKER));
const prime = run.slice(run.indexOf('const primeSearch'), run.indexOf("JOURNEYS['double-click-search']"));
check('primeSearch requires the committed-city marker before reporting the form ready',
  /SELECTED_CITY_MARKER/.test(prime));
check('an uncommitted city returns FALSE (→ the caller skips), rather than being reported as primed',
  /if \(!\(await page\.locator\(SELECTED_CITY_MARKER\)\.count\(\)\)\) return false;/.test(prime));
// The check is worthless if it runs after the verdict, so pin the order: marker first, «بحث» last.
check('the marker is checked BEFORE the «بحث»-exists check that used to be the whole precondition',
  prime.indexOf('SELECTED_CITY_MARKER') < prime.indexOf("getByText('بحث'"));

if (failed) { console.error(`\nverify-journey-settled-count: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-journey-settled-count: counts are compared only once they have stopped moving.');
