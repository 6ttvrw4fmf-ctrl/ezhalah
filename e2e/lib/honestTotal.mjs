// THE NUMBER ON SCREEN FOLLOWS THE CARDS — the harness-side mirror of src/lib/honestTotal.ts (🔧 1153, PR #9816,
// shipped 2026-11-01). The results count (`total_count`) is the served INDEX's; the cards are hydrated from the RAW
// tables with `active = true`. Between a listing being hidden at source and the hourly :22 sync that prunes it from
// the index, the index still COUNTS the row while hydration DROPS its card, and the app prints `total − dropped` so the
// number never exceeds the cards a customer can reach. Every count oracle that compares the sentence with the raw
// `total_count` must therefore allow EXACTLY that subtraction — and nothing else:
//   · 2026-11-08 run 42466204757: trending «الرياض» advertised 99015, landed 99014; AF chip 19465 → 19464;
//   · 2026-11-09 run 42597206618: sentence quotes 73350, RPC total_count 73351.
// All three were the app being honest about one dropped card, filed as a product defect by an oracle that did not know
// the rule. The allowance is MEASURED, never assumed: the drop is `rows the page asked for − cards on screen`, so a
// sentence that is low by more than the cards it is missing is still a defect, and an index that moved is still the
// bracket's business (sweep.mjs onOneIndex), not this file's.

/**
 * Cards the page could not hydrate: how many rows it asked the index for (the request's p_limit, capped by the total)
 * minus the cards it rendered. 0 when nothing was dropped or when the inputs cannot say (fail-closed: no allowance).
 */
export function droppedAtHydration({ total, pageLimit, cards }) {
  const t = Number(total), lim = Number(pageLimit), c = Number(cards);
  if (![t, lim, c].every(Number.isFinite) || t < 0 || lim <= 0 || c < 0) return 0;
  return Math.max(0, Math.min(lim, t) - c);
}

/**
 * Is `shown` the honest rendering of `total` after `dropped` cards? True ONLY for `total − dropped` with dropped > 0;
 * equality is the caller's ordinary agree path, and any other difference is a mismatch.
 */
export function isHonestlyLower(shown, total, dropped) {
  return Number.isFinite(shown) && Number.isFinite(total) && dropped > 0 && shown === total - dropped;
}

/** Distinct «#N» card badges in a screen's innerText — the cards a customer can reach. */
export function cardBadges(innerText) {
  const seen = new Set();
  for (const line of String(innerText ?? '').split('\n')) { const t = line.trim(); if (/^#\d+$/.test(t)) seen.add(t); }
  return seen.size;
}
