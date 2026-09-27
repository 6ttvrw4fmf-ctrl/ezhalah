// A CLICK IS NOT A CLICK UNTIL THE PAGE SAYS WHAT TOOK IT (routine #5, 2026-09-24).
//
// THE CLASS. Every live browser journey in this repo taps a control the same way: one round trip to
// measure its centre (`CLICK_LEAF`-style, which also scrolls it into view), a second round trip to
// `page.mouse.click(x, y)`. The Ezhalah chat is REFLOWING between those two round trips — the reveal
// cascade is still mounting cards, the turn is still growing, the scroller is still moving — so the
// point can name a different element by the time the mouse arrives. The click then lands on whatever
// slid under it, and the journey, which never asked, carries on as if the control had been pressed.
//
// WHAT THAT COSTS. It does not produce a harness error. It produces a FALSE ACCUSATION AGAINST
// PRODUCTION, because the next assertion is always "…and then the app did X". Measured on production
// 2026-09-24 (الرياض/شراء/شقة desktop, fleet healthy): 11 of 24 taps on «خلّنا نحدد الطلب أكثر»
// landed on `card-listing-11678443`, and each one was reported as «the offer opened but no af-card
// appeared in 45s» — i.e. as a broken Advanced Filter. `ops_incident` #340 is five days of that.
//
// THE RULE. Measure a point, require it to hold still, arm a capture-phase witness, click, and only
// then say the control was pressed — and when it was not, say so as a HARNESS fact, never as a
// statement about the product. `scripts/verify-af-offer-click-lands.ts` executes this against a stub
// page whose click misses, and carries the pre-fix body as a mutation that must fail the same
// predicate. `scripts/verify-live-clicks-are-witnessed.ts` keeps the unwitnessed sites from growing.

/** What the caller believes it is clicking. Either key alone is enough to identify a landing. */
export type ClickTarget = { testid?: string; text?: string };

/**
 * Arm the witness. Capture phase, so it sees the real event before React does; cleared on every
 * arming, so a landing from a previous attempt can never be read as this attempt's.
 */
export const ARM_CLICK_WITNESS_SRC = (want: { testid?: string; text?: string }) => {
  const w = window as any;
  w.__liveClickHit = null;
  const sig = `${want.testid || ''}|${want.text || ''}`;
  if (w.__liveClickWired === sig) return;
  w.__liveClickWired = sig;
  document.addEventListener('click', (e: any) => {
    const t = e.target as any;
    let onTarget = false;
    if (want.testid && t && typeof t.closest === 'function' && t.closest(`[data-testid="${want.testid}"]`)) onTarget = true;
    if (!onTarget && want.text) {
      // The label may sit on an ancestor of the leaf that actually received the event, so walk up a
      // few hops — but never to the whole transcript, which would match everything.
      let n: any = t;
      for (let i = 0; n && i < 4; i++, n = n.parentElement) {
        if (((n.innerText || n.textContent) || '').trim() === want.text) { onTarget = true; break; }
      }
    }
    w.__liveClickHit = {
      onTarget,
      tid: (t && typeof t.getAttribute === 'function' && t.getAttribute('data-testid')) || '',
      txt: ((t && (t.innerText || t.textContent)) || '').trim().slice(0, 80),
    };
  }, true);
};

/** Read (and consume) what the last click actually hit. */
export const READ_CLICK_WITNESS_SRC = () => {
  const w = window as any;
  const hit = w.__liveClickHit;
  w.__liveClickHit = null;
  return hit;
};

export type WitnessedClick = { landed: boolean; hit: string };

/** Click a measured point and report what the page says took it. Never assumes. */
export async function clickWitnessed(page: any, box: { x: number; y: number }, want: ClickTarget): Promise<WitnessedClick> {
  await page.evaluate(ARM_CLICK_WITNESS_SRC, want).catch(() => {});
  await page.mouse.click(box.x, box.y);
  const hit = await page.evaluate(READ_CLICK_WITNESS_SRC).catch(() => null);
  if (hit?.onTarget) return { landed: true, hit: want.testid || want.text || '(target)' };
  return { landed: false, hit: hit ? (hit.tid || hit.txt || '(unlabelled)') : '(no click event seen)' };
}

/** Two measurements this close together mean the control has stopped moving. */
export const STABLE_PX = 2;

/** A stray click lands on a LIVE control (a listing card opens a listing), so misses are retried a
 *  bounded handful of times with a settle between them — never hammered for a whole budget. */
export const MAX_CLICK_ATTEMPTS = 6;

/** Has a re-measured point held still since the last one? */
export const isStable = (prev: { x: number; y: number } | null, box: { x: number; y: number }): boolean =>
  !!prev && Math.abs(prev.x - box.x) <= STABLE_PX && Math.abs(prev.y - box.y) <= STABLE_PX;
