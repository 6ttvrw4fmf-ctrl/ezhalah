// THE NUMBER A CUSTOMER SEES EQUALS THE CARDS THEY CAN REACH (owner 2026-10-30: «a count that differs from the
// reachable cards is a bug»; 🔧 backlog 1153, 2026-11-01).
//
// The results count (`total_count`) comes from the served INDEX; the cards are hydrated from the RAW tables with
// the kept filters and `active = true`. Between the moment a listing is hidden at source (♻️ sets active=false)
// and the hourly :22 sync that prunes it from the index, the index still COUNTS the row while hydration DROPS
// its card — measured 2026-11-01: tuba 13260147 hidden 11:56:07, journey 41303419393 at 12:02 read «47» over 46
// reachable cards, the 12:39 journey (index pruned 12:35) read 46 = 46. The honest number subtracts the rows this
// page could not hydrate. It never ADDS (match-first: nothing after the match may invent a listing) and never
// goes below zero. On a later page the same full-set total is corrected only by that page's own drops, so the
// shown number can still be high by rows on pages not yet loaded — but it can never contradict the cards on screen.
export function honestTotal(total: number, candidates: number, hydrated: number): number {
  const t = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const dropped = Math.max(0, Math.trunc(candidates) - Math.trunc(hydrated));
  return Math.max(0, t - dropped);
}
