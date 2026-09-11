// A LATENCY VERDICT IS ONLY HONEST IF THE ENVIRONMENT WAS SANE WHILE IT WAS TAKEN.
//
// THE BUG THIS EXISTS TO KILL (measured 2026-09-04). The AF browser journeys wait a fixed time for
// the next card, and on timeout their `readCardUntil` returned the LAST state it happened to see —
// so the caller went on to assert against a card that had never advanced. One missed transition
// produced 47 "product" failures in CI, every one of them comparing Q1's option counts against a Q2
// oracle. The product was fine. The harness reported an unobserved state as a measurement.
//
// Reproduced on demand, locally, against the same deployed bundle:
//   verify-af-option-card-truth-live.ts alone                       426 checks, 0 failures
//   the same script beside verify-af-live-truth.ts (the CI shape)   5 failures, same shapes as CI
//
// WHY IT ONLY BITES UNDER LOAD. The next AF card comes from a PAID AGENT TURN plus a count RPC, not
// from a render. Measured on production the same afternoon: apartment_guided_counts_ar on an
// unfiltered Buy scope took 14–19s (and 57014'd in CI at ~21s), while fleet-wide search mean rose
// 773ms → 5,109ms as concurrent agent routines drove ~3.8 searches/s against a MEASURED safe
// envelope of 1.5/s (SEARCH_MATCH_QA_ENGINEER.md §40.1). Fixed waits sized for a quiet database
// expire; the harness then judges whatever is on screen.
//
// THE RULE, AND WHY IT IS NOT A LOOSENED THRESHOLD.
//   1. Wait a full agent turn, not a render (AGENT_TURN_MS) — the transition being awaited IS an
//      LLM round trip. This corrects a budget that was measuring the wrong thing.
//   2. Never assert on a state that never arrived. The caller must be TOLD it never arrived
//      (`settled: false`) and must abandon every assertion derived from it.
//   3. A non-arrival becomes a RED verdict only when production was NOT degraded while we waited.
//      Degraded → NOT EXERCISED, counted, and it still fails the run (a check that could not run
//      must never read green — the ledger in each journey counts skips against the exit code).
//      So this can never turn a real failure green: the only thing it changes is WHICH answer a
//      non-arrival gets, and it can only ever move one from "the product is broken" to "this run
//      did not certify the product, here is the measured reason".
//
// `degraded` is not our own opinion about latency — it is production's, from
// public.ops_search_load_now(), the anon-callable signal the search-latency routine shipped
// 2026-09-04 so harnesses can pace themselves instead of stampeding.

export type SearchLoad = {
  recent_mean_ms: number | null;
  search_qps: number | null;
  safe_qps: number | null;
  samples: number | null;
  degraded: boolean;
};

/** The awaited transition is an agent turn (LLM + count RPC), never a paint. */
export const AGENT_TURN_MS = 60_000;

/** How long a journey will WAIT for production to come back inside its envelope before starting. */
export const PACE_BUDGET_MS = 10 * 60_000;
export const PACE_POLL_MS = 30_000;

/** Unreadable load is NOT "healthy" — a journey must not get a free red out of a blind probe. */
export const UNREADABLE_LOAD: SearchLoad = {
  recent_mean_ms: null, search_qps: null, safe_qps: null, samples: null, degraded: true,
};

export async function readSearchLoad(url: string, headers: Record<string, string>): Promise<SearchLoad> {
  try {
    const r = await fetch(`${url}/rest/v1/rpc/ops_search_load_now`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r.ok) return UNREADABLE_LOAD;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return UNREADABLE_LOAD;
    const num = (x: unknown) => (x == null ? null : Number(x));
    return {
      recent_mean_ms: num(row.recent_mean_ms),
      search_qps: num(row.search_qps),
      safe_qps: num(row.safe_qps),
      samples: num(row.samples),
      degraded: row.degraded === true,
    };
  } catch {
    return UNREADABLE_LOAD;
  }
}

export const describeLoad = (l: SearchLoad): string =>
  l.recent_mean_ms == null
    ? 'production load was UNREADABLE (ops_search_load_now did not answer)'
    : `production search mean ${Math.round(l.recent_mean_ms)}ms at ${l.search_qps} q/s ` +
      `(safe ${l.safe_qps} q/s, ${l.samples} sample(s))`;

/** THE PRIMITIVE. Poll until `pred` holds, and tell the caller whether it EVER held. `settled:false`
 *  means the state was never observed — the last state is returned for diagnostics only and must
 *  not be asserted against. */
export async function settleUntil<T>(
  read: () => Promise<T>,
  pred: (v: T) => boolean,
  budgetMs: number,
  sleep: (ms: number) => Promise<void>,
  pollMs = 350,
): Promise<{ settled: boolean; value: T }> {
  const until = Date.now() + budgetMs;
  let last = await read();
  for (;;) {
    if (pred(last)) return { settled: true, value: last };
    if (Date.now() >= until) return { settled: false, value: last };
    await sleep(pollMs);
    last = await read();
  }
}

/** How a non-arrival must be reported: a real red only when production was healthy while we waited. */
export function verdictForNonArrival(load: SearchLoad): 'red' | 'not_exercised' {
  return load.degraded ? 'not_exercised' : 'red';
}

/** Wait (bounded) for production to come back inside its own envelope before measuring it. */
export async function paceUntilHealthy(
  readLoad: () => Promise<SearchLoad>,
  sleep: (ms: number) => Promise<void>,
  budgetMs = PACE_BUDGET_MS,
  pollMs = PACE_POLL_MS,
  log: (s: string) => void = () => {},
): Promise<SearchLoad> {
  const until = Date.now() + budgetMs;
  let l = await readLoad();
  while (l.degraded && Date.now() < until) {
    log(`      [pace] ${describeLoad(l)} — waiting for production to come back inside its envelope`);
    await sleep(pollMs);
    l = await readLoad();
  }
  return l;
}

// ── THE SEARCHING BEAT: THE SAME LESSON, ON THE OTHER SIDE OF THE COMMIT ────────────────────────
//
// Everything above is about waiting for the NEXT AF QUESTION. This half is about waiting for the
// RESULTS TURN that a committed answer produces — and it is the half that was missing on
// 2026-09-06, when seven live steps went red across five scripts in one night.
//
// WHAT HAPPENED. The owner raised the searching beat that morning: "let the user wait 10 seconds …
// make sure all the platforms in the animation show clearly, cuz doing it quick will make them
// lost" (agent.tsx SEARCH_MIN_MS 2,200 → 10,000, + LOADER_EXIT_MS 450). The beat HOLDS THE PREVIOUS
// SCREEN while it plays: the loader is on top, and it intercepts pointer events. Every AF journey
// that committed an answer and then read the screen after a FIXED sleep of 2.5–6s was now sampling
// the middle of the animation. verify-af-card-evidence-live.ts read at +4,000ms and found 0 cards
// and 0 «مطابق لطلبك» strips, and reported «§12A is not honest on the live card» — an accusation
// against a product rule the owner had shipped three days earlier, and which was in fact working.
// Two other scripts failed on `subtree intercepts pointer events`: the click landed on the loader.
//
// This is EXACTLY the class the header of this file was written about, one commit later and one
// screen further on. The product was fine; a fixed sleep sized for the old beat judged a state it
// had never observed. Do not fix it by raising a number — the number is what broke.
//
// TWO RULES.
//   1. NOBODY TYPES THE FLOOR. It is DERIVED from the product's own constants, so the next time an
//      owner changes the beat the harness follows instead of accusing. A private per-file copy of a
//      shared vocabulary is the drift this surface keeps paying for (AGENTS.md harness note 13);
//      verify-web-runtime-smoke.mjs had already hard-coded its own 12000 for this very reason.
//   2. OBSERVE THE ARRIVAL. Poll for the results turn to actually be on screen and tell the caller
//      whether it ever arrived — `settleUntil` already does this, so this is not a second mechanism.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Read the product's OWN searching-beat constants out of `src/app/agent.tsx`.
 *
 * agent.tsx is JSX, so a plain Node barrier cannot import it — the same constraint
 * `src/lib/searchLoaderTiming.ts` documents in its own header, and the reason
 * `verify-search-loader-shows-every-platform.ts` already reads SEARCH_MIN_MS by regex. This shares
 * that one read instead of adding a second copy of it.
 *
 * FAILS CLOSED. If either constant cannot be read this THROWS rather than falling back to a
 * default: a harness that silently guesses the beat is how the accusation above got written.
 */
export function readSearchBeatMs(agentSrc?: string): { floorMs: number; exitMs: number } {
  const src = agentSrc ?? readFileSync(join(REPO_ROOT, 'src', 'app', 'agent.tsx'), 'utf8');
  const floor = src.match(/^const SEARCH_MIN_MS = (\d+);/m);
  const exit = src.match(/^const LOADER_EXIT_MS = (\d+);/m);
  if (!floor || !exit) {
    throw new Error(
      'afJourneyPacing: could not read SEARCH_MIN_MS / LOADER_EXIT_MS from src/app/agent.tsx. ' +
      'The searching beat is the thing every post-search read must outlast, so a harness that ' +
      'cannot see it must stop, not guess.');
  }
  return { floorMs: Number(floor[1]), exitMs: Number(exit[1]) };
}

/** The full beat a committed answer must outlast before the new results turn is on screen. */
export const SEARCH_BEAT_MS = (() => { const b = readSearchBeatMs(); return b.floorMs + b.exitMs; })();

/**
 * Budget for a post-search read: the beat, plus the real network/render time that follows it, plus
 * an agent turn's headroom because a committed AF answer re-runs the search through the agent.
 * Generous on purpose — `settleUntil` returns the INSTANT the state arrives, so a large budget
 * costs a fast run nothing and only decides how long a genuinely stuck screen is given.
 */
export const POST_SEARCH_BUDGET_MS = SEARCH_BEAT_MS + AGENT_TURN_MS;

/**
 * THE IDS THAT PROVE A NEW RESULTS TURN: the ids this turn returned, MINUS the ids that were already
 * on screen when the wait began.
 *
 * WHY THE SUBTRACTION IS THE WHOLE POINT (measured on production 2026-09-11). The first version of
 * `awaitResultsTurn` polled "how many on-screen cards are in the committed id set", and its own
 * comment called that "the only set that proves the NEW turn has rendered". It is not. An Advanced
 * Filter answer NARROWS: the committed set is drawn from the very rows the previous screen was
 * showing, so the intersection is non-empty BEFORE the new turn renders at all — the poll returns at
 * t=0 and the caller reads the screen the beat is still holding. That is a fixed sleep with extra
 * steps, which is exactly what the header of this file forbids, rebuilt one screen further on.
 *
 * Measured: الرياض/شقة, committed 159 rows against a screen of 13 cards from the pre-AF search. The
 * old predicate settled immediately; the real turn arrived 9,065 ms later and DID render its
 * «مطابق لطلبك» strips. Six live steps had been red for five days over it, every one of them
 * accusing a correct production (ops_incident #141).
 *
 * This is the same lesson `awaitAfStep`'s `previousOptions` already encodes for the question card —
 * "some options are on screen" is true the instant after a confirm — applied to the results turn.
 */
export function provingIds(turnIds: Iterable<number>, onScreenBefore: Iterable<number>): number[] {
  const before = new Set<number>(onScreenBefore);
  return [...new Set<number>(turnIds)].filter((id) => !before.has(id));
}

export type TurnArrival = {
  /** a PROVING id was observed on screen. Only then may the caller read that screen. */
  settled: boolean;
  /**
   * false ⇒ this turn cannot be proven by id from this screen (every id it returned was already
   * rendered). The caller must report NOT EXERCISED — never fall back to "something is on screen",
   * which is the defect this type exists to make unrepresentable.
   */
  provable: boolean;
  /** how many proving ids were on screen when the poll stopped. */
  proving: number;
  /** how large the proving set was to begin with (0 ⇒ not provable). */
  provingPool: number;
};

/**
 * Wait for the results turn a committed answer produced to be ON SCREEN, and say whether it ever
 * arrived. `settled:false` means it never did — the caller must abandon every assertion that reads
 * that screen and report NOT EXERCISED (rule 2 in the header), never judge what it found.
 *
 * The caller passes the turn's own ids and the ids ON SCREEN when the wait began; the proving set is
 * computed here, once, so no journey can reintroduce the intersection predicate by hand. Snapshot
 * `onScreenBefore` as soon as the committed response is captured — the beat holds the previous
 * screen for SEARCH_BEAT_MS, so that read is the screen being replaced. If the new turn somehow
 * rendered before the snapshot, the pool shrinks and this reports NOT PROVABLE: it fails toward
 * "this run did not certify the product", never toward judging an unobserved screen.
 */
export async function awaitResultsTurn(
  readShownIds: () => Promise<readonly number[]>,
  sleep: (ms: number) => Promise<void>,
  turn: { turnIds: Iterable<number>; onScreenBefore: Iterable<number> },
  budgetMs = POST_SEARCH_BUDGET_MS,
): Promise<TurnArrival> {
  const pool = provingIds(turn.turnIds, turn.onScreenBefore);
  if (pool.length === 0) return { settled: false, provable: false, proving: 0, provingPool: 0 };
  const proof = new Set(pool);
  const r = await settleUntil(
    async () => (await readShownIds()).filter((id) => proof.has(id)).length,
    (n) => n > 0, budgetMs, sleep);
  return { settled: r.settled, provable: true, proving: r.value, provingPool: pool.length };
}

/**
 * IS THIS CONTROL REACHABLE BY A USER RIGHT NOW? — the other half of the beat, on the way IN.
 *
 * `awaitResultsTurn` answers "may I READ the screen yet". This answers "may I CLICK it yet", and it
 * is the question a journey asks the moment a committed answer starts a new search: the searching
 * loader is painted over the whole chat for the beat plus the agent turn behind it, with
 * `pointer-events` live, so a click lands on the loader. Playwright's own actionability retry says
 * exactly that — «subtree intercepts pointer events» — and then gives up on ITS budget, which has
 * nothing to do with the product's.
 *
 * Measured 2026-09-11, verify-af-pill-removal-live on MOBILE جدة/فيلا: five checks green, then
 * `page.click('[data-testid="af-pill-0"]')` timed out after 30,000 ms against the loader — a budget
 * that predates a beat of 11,050 ms sitting in front of an agent turn measured near 40 s.
 *
 * The answer is NOT a bigger number. It is to observe the thing that actually matters: whether the
 * control is on top at its own centre point. `elementsFromPoint` (the PLURAL — the singular form
 * reports a scrolled-out control as blocked, an artifact that already cost one run a false «20
 * controls blocked», see PR #2040) returns the painted stack; the control is reachable when it is in
 * it. Bounded by the same POST_SEARCH_BUDGET_MS, and a control that never surfaces is reported, not
 * clicked into.
 */
export type PointQueryable = {
  evaluate: <R>(fn: (sel: string) => R, arg: string) => Promise<R>;
};

/**
 * CLICK THE POINT THE PROBE VALIDATED, not the selector.
 *
 * `page.click(selector)` re-runs its own scroll-into-view before dispatching, so the element can end
 * up at a DIFFERENT scroll offset from the one the reachability probe just measured — and on a
 * narrow viewport that is enough to slide it back under the AF question card. Measured 2026-09-11:
 * `awaitClickable` answered `ok`, and Playwright's own retry then reported the card's «af-confirm»
 * intercepting at ITS scroll position. Clicking the measured coordinates closes that gap, and it is
 * the same idiom the journeys already use for every other control (the CLICK_LEAF `tap` helpers).
 */
export type PointClickable = PointQueryable & {
  mouse: { click: (x: number, y: number) => Promise<unknown> };
};

export type Reach = 'ok' | 'covered' | 'absent' | 'unpainted' | 'offscreen';

/**
 * The page-side probe, exported so a barrier can execute it against a fake DOM.
 *
 * IT SCROLLS FIRST, AND «OFFSCREEN» IS ITS OWN ANSWER. A control that is merely scrolled out of view
 * still has a rect, and `elementsFromPoint` at a point outside the viewport returns an empty stack —
 * which is indistinguishable from "an overlay is on top of it" unless the two are separated. Measured
 * 2026-09-11: the AF pill row on a 390x844 viewport read «covered» for the full 71,050 ms budget
 * while nothing was covering it at all. That is the same confusion PR #2040 recorded from the other
 * direction («20 controls blocked» on a healthy build), and it must not be re-learned a third time.
 */
export const REACH_AT_CENTRE = (sel: string): { reach: Reach; x: number; y: number } => {
  const no = (reach: Reach) => ({ reach, x: -1, y: -1 });
  const el = document.querySelector(sel);
  if (!el) return no('absent');
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return no('unpainted');
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return no('offscreen');
  const stack = document.elementsFromPoint(x, y);
  return stack.some((n) => n === el || el.contains(n)) ? { reach: 'ok', x, y } : no('covered');
};

export async function awaitClickable(
  page: PointQueryable,
  selector: string,
  sleep: (ms: number) => Promise<void>,
  budgetMs = POST_SEARCH_BUDGET_MS,
  pollMs = 500,
): Promise<{ reachable: boolean; last: Reach; x: number; y: number }> {
  const r = await settleUntil(
    () => page.evaluate(REACH_AT_CENTRE, selector),
    (v) => v.reach === 'ok', budgetMs, sleep, pollMs);
  return { reachable: r.settled, last: r.value.reach, x: r.value.x, y: r.value.y };
}

/** Wait for a control to be genuinely on top, then click the exact point that was validated. */
export async function clickWhenReachable(
  page: PointClickable,
  selector: string,
  sleep: (ms: number) => Promise<void>,
  budgetMs = POST_SEARCH_BUDGET_MS,
): Promise<{ clicked: boolean; last: Reach }> {
  const r = await awaitClickable(page, selector, sleep, budgetMs);
  if (!r.reachable) return { clicked: false, last: r.last };
  await page.mouse.click(r.x, r.y);
  return { clicked: true, last: r.last };
}

/**
 * Wait for the AF round's NEXT step to actually be readable: either its options have rendered, or
 * the round has ended (the card is gone, or the committed search has left the page).
 *
 * WHY THIS IS SHARED. Three journeys had grown their own private version of this wait, each a
 * different fixed sleep (2,500 / 3,500 / 3,800 ms), and each one sized for a build that no longer
 * exists. The options behind an AF step come from a PAID AGENT TURN, not a paint (AGENT_TURN_MS),
 * and the step AFTER the last one is the searching beat — so a fixed sleep is wrong at both ends.
 * A per-file copy of a shared vocabulary is the drift this surface keeps paying for.
 *
 * Returns what was OBSERVED, never a guess: 'options' (readable, and they are returned),
 * 'ended' (the round finished — a search left the page or the card is gone), or 'timeout'
 * (nothing was ever observed; the caller must not assert on the screen).
 */
export async function awaitAfStep(
  readOptions: () => Promise<string[]>,
  cardPresent: () => Promise<boolean>,
  searchFired: () => Promise<boolean>,
  sleep: (ms: number) => Promise<void>,
  budgetMs = AGENT_TURN_MS,
  pollMs = 500,
  /**
   * The options of the question just ANSWERED. Pass it and the poll will not return until the card
   * shows a DIFFERENT set — because "some options are on screen" is true the instant after a
   * confirm, while the card still shows the question that was just answered. A walk that trusts
   * that reading clicks the same question's option a second time (toggling the answer it just
   * committed) and the round ends one question in. That is the shape the fixed 3,800ms sleep this
   * replaced was really buying, and dropping the sleep without expressing the CONDITION reproduced
   * it — measured 2026-09-06: round 1 committed 1 answer on a cohort with 4 useful questions.
   */
  previousOptions?: readonly string[],
): Promise<{ outcome: 'options' | 'ended' | 'timeout'; options: string[] }> {
  const until = Date.now() + budgetMs;
  const same = (a: string[]) => previousOptions != null
    && a.length === previousOptions.length && a.every((o, i) => o === previousOptions[i]);
  for (;;) {
    if (await searchFired()) return { outcome: 'ended', options: [] };
    const opts = await readOptions();
    if (opts.length && !same(opts)) return { outcome: 'options', options: opts };
    if (!opts.length && !(await cardPresent())) return { outcome: 'ended', options: [] };
    if (Date.now() >= until) return { outcome: 'timeout', options: [] };
    await sleep(pollMs);
  }
}
