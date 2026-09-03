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
// Deliberately dependency-free and `page`-typed as `any`: the journeys import Playwright
// themselves and this file must not pin a second copy of its types.

/** Find the smallest visible leaf whose trimmed innerText is exactly `txt`, scroll it into view
 *  inside its own scroll container, and hand back a clickable viewport point. Runs in the page. */
export const CLICK_LEAF_SRC = (txt: string) => {
  let best: any = null;
  document.querySelectorAll('div,span,li,button').forEach((e: any) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
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

/** Drive every scrollable container to its bottom — the CTA renders below the newest turn. */
const SCROLL_BOTTOM_SRC = () => {
  [...document.querySelectorAll('*')]
    .filter((e: any) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY))
    .forEach((e: any) => { e.scrollTop = e.scrollHeight; });
};

/** Has the agent finished this turn — i.e. is there a results headline to hang an offer off? */
const HAS_TURN_SRC = () =>
  [...document.querySelectorAll('div,span,p')]
    .some((e: any) => e.children.length === 0 && /لقينا\s[\d,٠-٩،]+\sإعلان/.test((e.textContent || '').trim()));

export const AF_OFFER_CTA = 'خلّنا نحدد الطلب أكثر';

export type OfferResult =
  /** The CTA was found and clicked. */
  | { opened: true; waitedMs: number }
  /** No CTA, but the agent never produced a results turn either — NOT a verdict about AF. */
  | { opened: false; reason: 'no-turn'; waitedMs: number }
  /** The turn landed and stayed put, and no CTA ever rendered on it — a real absence. */
  | { opened: false; reason: 'absent'; waitedMs: number };

/**
 * Wait for the Advanced Filter offer and click it.
 *
 * `timeoutMs` defaults to 60s because the CTA sits behind the agent's own LLM turn: the CI run that
 * motivated this file spent ~40s on the reply alone. It still fails in bounded time — the point is
 * a budget set by what the dependency actually costs, not by what it costs on a good day.
 */
export async function openAfOffer(
  page: any,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<OfferResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollMs ?? 400;
  const t0 = Date.now();
  let sawTurn = false;

  while (Date.now() - t0 < timeoutMs) {
    // Re-scroll EVERY iteration: the conversation is still growing while we poll.
    await page.evaluate(SCROLL_BOTTOM_SRC).catch(() => {});
    if (!sawTurn) sawTurn = await page.evaluate(HAS_TURN_SRC).catch(() => false);
    const box = await page.evaluate(CLICK_LEAF_SRC, AF_OFFER_CTA).catch(() => null);
    if (box) {
      await page.mouse.click(box.x, box.y);
      return { opened: true, waitedMs: Date.now() - t0 };
    }
    await page.waitForTimeout(pollMs);
  }
  return { opened: false, reason: sawTurn ? 'absent' : 'no-turn', waitedMs: Date.now() - t0 };
}
