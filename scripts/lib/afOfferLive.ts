// ONE WAY TO OPEN ADVANCED FILTER IN A LIVE JOURNEY (2026-09-03).
//
// WHY THIS EXISTS. Three journeys each carried a byte-identical copy of the same opener:
//
//     for (let i = 0; i < 40 && !btn; i++) { btn = await page.evaluate(CLICK_LEAF, CTA); … 400ms }
//
// a 16-second poll for «خلّنا نحدد الطلب أكثر». On 2026-09-03 that window ran out in CI on
// verify-af-remove-last-pill-live and the journey reported the offer ABSENT on a الرياض/شقة/Buy
// baseline of 10,665 listings — far above INTERVIEW_STOP_AT, so R11.1 could not have hidden it.
// Production was fine: the same journey passed three times locally against the same bundle, and
// three sibling journeys in the SAME CI job opened AF on the same cohort minutes earlier. The
// timestamps say what happened — the agent's own reply took ~40s on that run before the 16s
// window even started. The offer arrives behind a PAID LLM call whose latency is variable, and a
// fixed 16s budget measured against a good day is not a budget.
//
// This is the third widening of that number (6s → 16s in verify-af-live-truth's own comment → here),
// which is the argument for a shared helper rather than a fourth edit in three files: today's
// amenity-vocabulary drift came from exactly one private copy too many.
//
// TWO THINGS IT FIXES BEYOND THE BUDGET:
//
//   1. IT RE-SCROLLS ON EVERY ITERATION. The old openers scrolled once, up front, then polled. The
//      agent flow STREAMS: content lands after that scroll, and the CTA renders at the bottom of a
//      conversation that is still growing. Scrolling once races the very thing being waited for.
//
//   2. IT DISTINGUISHES "STILL THINKING" FROM "GENUINELY NOT OFFERED". Those are different facts
//      with the same old symptom, and conflating them is the failure this repo names most often —
//      an absent probe is not a verdict (scripts/verify-af-probe-failure-not-a-verdict.ts, and the
//      run-#15 rent-period lesson in AGENTS.md). A caller that cannot tell them apart either cries
//      wolf on a slow agent or, worse, records "AF correctly hidden" when nothing ever rendered.
//      `reason` says which, so the caller can fail loudly on 'absent' and report NOT VERIFIED on
//      'no-turn'.
//
// `page` is typed as `any` on purpose: the journeys import Playwright themselves and this file must
// not pin a second copy of its types. Its one import is e2e/lib/resultsSentence.mjs, which reads the
// shipped template pool off disk and pulls in no driver — the Results-Found sentence rotates, so a
// parser of it restated here would go blind the next time the owner edits a template, and this file
// has already paid that price once (see HAS_TURN_SRC).

import { resultsSentenceAtStartSource } from '../../e2e/lib/resultsSentence.mjs';
import { clickWitnessed, isStable, MAX_CLICK_ATTEMPTS } from './liveClick.ts';

/** Find the offer, scroll it into view inside its own scroll container, and hand back a clickable
 *  viewport point. Runs in the page.
 *
 *  THE TESTID IS TRIED FIRST, AND THAT IS THE POINT (routine #5, 2026-09-25, `ops_incident` #687).
 *  This used to match on `innerText` alone. `innerText` is the RENDERED text: it depends on layout,
 *  and it is empty for a node the engine has not laid out yet. The AF offer renders directly beneath
 *  a turn whose reveal cascade is still mounting cards, so on a big restored turn it is routinely in
 *  the DOM with an `innerText` this scan cannot see — measured on production 2026-09-25 on
 *  الرياض/شراء/شقة, where `[data-testid="results-narrow"]` and an exact `textContent` leaf were BOTH
 *  present at every 3 s sample for the whole 60 s budget while this probe returned null on every
 *  poll. `openAfOffer` then reported `reason: 'absent'` — an ADVANCED FILTER verdict — for a button
 *  that was on screen the entire time, and three runs recorded it as a broken R9.2.3.
 *
 *  So: ask the app's own testID, which this file already calls "the join key, never the label", and
 *  keep the label only as a fallback — now on `textContent`, which does not need layout. */
export const CLICK_LEAF_SRC = (want: { testid: string; txt: string }) => {
  let best: any = null;
  const consider = (e: any) => {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  };
  const byId = document.querySelector(`[data-testid="${want.testid}"]`);
  if (byId) consider(byId);
  if (!best) {
    document.querySelectorAll('div,span,li,button').forEach((e: any) => {
      if (((e.textContent || '')).trim() !== want.txt) return;
      consider(e);
    });
  }
  if (!best) return null;
  let a = best.parentElement, sc: any = null;
  while (a) {
    const s = getComputedStyle(a);
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; }
    a = a.parentElement;
  }
  if (sc) {
    const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2;
  }
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

/** IS THE OFFER IN THE DOM AT ALL? Presence, deliberately separate from clickability.
 *
 *  `absent` is a statement about ADVANCED FILTER ("the offer never came back"); every other verdict
 *  here is a statement about the HARNESS. Deciding absence from a CLICK probe fuses the two, and the
 *  fused version accused production three times (`ops_incident` #687). Presence is read from the
 *  app's own testID, with the label on `textContent` as a fallback — neither needs layout, so a CTA
 *  below the fold or under a running reveal cascade still counts as present, which is the truth. */
export const CTA_PRESENT_SRC = (want: { testid: string; txt: string }) =>
  !!document.querySelector(`[data-testid="${want.testid}"]`)
  || [...document.querySelectorAll('div,span,li,button')]
    .some((e: any) => e.children.length === 0 && (e.textContent || '').trim() === want.txt);

/** Drive every scrollable container to its bottom — the CTA renders below the newest turn. */
const SCROLL_BOTTOM_SRC = () => {
  [...document.querySelectorAll('*')]
    .filter((e: any) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY))
    .forEach((e: any) => { e.scrollTop = e.scrollHeight; });
};

/**
 * Has the agent finished this turn — i.e. is there a results headline to hang an offer off?
 *
 * DERIVED FROM THE SHIPPED POOL, never restated (routine #10, 2026-09-19). It used to be
 * `/لقينا\s[\d,٠-٩،]+\sإعلان/`, which PR #3186 retired: all ten AR guest templates say «نتيجة»
 * and none say «إعلان», so this returned false on every real results turn. It fails SILENTLY —
 * `openAfOffer` then reports `{ opened: false, reason: 'no-turn' }`, which the type below documents
 * as explicitly NOT a verdict about AF — so the four AF live journeys that import this stood down
 * on every run instead of testing anything, and reported nothing wrong.
 *
 * The source string is passed IN because this function is serialized into the page, where this
 * module cannot be reached. It is the ANCHORED variant: the reader walks leaf nodes and asks "is
 * THIS node a headline", so an unanchored test would match a wrapper holding the whole transcript.
 */
const HAS_TURN_SRC = (src: string) =>
  [...document.querySelectorAll('div,span,p')]
    .some((e: any) => e.children.length === 0 && new RegExp(src).test((e.textContent || '').trim()));

/** The shipped Results-Found pool, as a regex source the page can compile. */
const HEADLINE_AT_START = resultsSentenceAtStartSource();

export const AF_OFFER_CTA = 'خلّنا نحدد الطلب أكثر';

/** The app's own testID on the offer (src/app/agent.tsx:4103) — the join key, never the label. */
export const AF_OFFER_TESTID = 'results-narrow';

// THE CLICK IS WITNESSED, NOT ASSUMED — the whole rule, and why, lives in scripts/lib/liveClick.ts.
// In one line: `CLICK_LEAF_SRC` measures the CTA in one round trip and the mouse clicks in the next,
// and the agent conversation reflows in between. Measured on production 2026-09-24
// (الرياض/شراء/شقة desktop, fleet healthy): 11 of 24 taps landed on `card-listing-11678443`, and
// every one was reported as a broken Advanced Filter — `ops_incident` #340.

/** How many polls the CTA must be PRESENT IN THE DOM for before "it never took a click" outranks
 *  "it was not really there" — a single flicker must never mask a real absence. Counted from
 *  `CTA_PRESENT_SRC`, never from the click probe: see that function for why the two must not fuse. */
const CTA_PERSISTENT_POLLS = 3;

export type OfferResult =
  /** The CTA was found and clicked — and the click was OBSERVED to land on it. */
  | { opened: true; waitedMs: number; attempts: number }
  /** No CTA, but the agent never produced a results turn either — NOT a verdict about AF. */
  | { opened: false; reason: 'no-turn'; waitedMs: number }
  /** The turn landed and stayed put, and no CTA ever rendered on it — a real absence. */
  | { opened: false; reason: 'absent'; waitedMs: number }
  /** The CTA WAS on screen and never took a click — either every tap landed elsewhere, or it never
   *  held still long enough to be measured. Both are HARNESS failures, never a statement about
   *  Advanced Filter. `hit` names what took the click instead, or why none was spent. */
  | { opened: false; reason: 'intercepted'; waitedMs: number; attempts: number; hit: string };

/**
 * Wait for the Advanced Filter offer and click it.
 *
 * `timeoutMs` defaults to 60s because the CTA sits behind the agent's own LLM turn: the CI run that
 * motivated this file spent ~40s on the reply alone. It still fails in bounded time — the point is
 * a budget set by what the dependency actually costs, not by what it costs on a good day.
 *
 * A click is only reported as `opened` once the page itself has confirmed the CTA took it. A click
 * that missed is retried inside the same budget, and a budget that expires with the CTA present and
 * every click landing elsewhere returns `'intercepted'` — a harness verdict, so a caller can never
 * again turn a missed tap into an accusation against Advanced Filter.
 */
export async function openAfOffer(
  page: any,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<OfferResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollMs ?? 400;
  const t0 = Date.now();
  let sawTurn = false;
  let ctaSeen = 0;
  let attempts = 0;
  let lastHit = '(the offer was on screen but never yielded a stable point to click)';
  let prev: { x: number; y: number } | null = null;

  while (Date.now() - t0 < timeoutMs && attempts < MAX_CLICK_ATTEMPTS) {
    // Re-scroll EVERY iteration: the conversation is still growing while we poll.
    await page.evaluate(SCROLL_BOTTOM_SRC).catch(() => {});
    if (!sawTurn) sawTurn = await page.evaluate(HAS_TURN_SRC, HEADLINE_AT_START).catch(() => false);
    const want = { testid: AF_OFFER_TESTID, txt: AF_OFFER_CTA };
    // PRESENCE FIRST, and counted on its OWN poll: a CTA that is in the DOM but not measurable this
    // frame must still retire `absent`, because `absent` is the only verdict here that blames AF.
    if (await page.evaluate(CTA_PRESENT_SRC, want).catch(() => false)) ctaSeen++;
    const box = await page.evaluate(CLICK_LEAF_SRC, want).catch(() => null);
    if (box) {
      // ONLY CLICK A POINT THAT HAS HELD STILL. The measurement and the click are two round trips;
      // requiring the same coordinates twice in a row is what makes the point still true when the
      // mouse gets there. A page mid-reveal simply does not qualify yet, and we poll again — this is
      // the cheap half of the fix, and the witness below is the half that cannot be fooled.
      if (isStable(prev, box)) {
        attempts++;
        const w = await clickWitnessed(page, box, { testid: AF_OFFER_TESTID, text: AF_OFFER_CTA });
        if (w.landed) return { opened: true, waitedMs: Date.now() - t0, attempts };
        // The page moved under the pointer anyway. Say what took the click, let the conversation
        // settle, and measure again — never report a tap that the CTA did not receive.
        lastHit = w.hit;
        prev = null;                            // re-establish stability before spending another click
        // A miss means the turn is still moving. Let the reveal cascade breathe rather than spending
        // the bounded attempts inside one second — the six of them should cover the settle, not race it.
        await page.waitForTimeout(Math.max(pollMs, 1200));
      } else {
        prev = box;
      }
    } else {
      prev = null;
    }
    await page.waitForTimeout(pollMs);
  }
  // A CTA that was PERSISTENTLY on screen and never clickable is a harness verdict; a one-frame
  // flicker is not, and must not be allowed to downgrade a genuine absence into a NOT-VERIFIED.
  if (attempts > 0 || ctaSeen >= CTA_PERSISTENT_POLLS) {
    return { opened: false, reason: 'intercepted', waitedMs: Date.now() - t0, attempts, hit: lastHit };
  }
  return { opened: false, reason: sawTurn ? 'absent' : 'no-turn', waitedMs: Date.now() - t0 };
}
