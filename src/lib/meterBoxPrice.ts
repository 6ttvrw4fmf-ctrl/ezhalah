// A SALE TOTAL TYPED INTO THE «سعر المتر» BOX (owner 2026-10-28: «fix it … make sure we never get those mistakes
// again»). The seller typed the total into the per-meter box and the site multiplied it by the area: dealapp 451328
// stores 52,000,000,000 SAR for 200,000 m² with its own box at 260,000. The search index has served the seller's
// figure since 20261028213252 (public.price_typed_in_meter_box_ar + enforce_price_size_sanity); the card did not,
// because it prints the platform table's price_total — and the client budget net re-reads that printed price, so a
// search the server matched at 260,000 dropped the card again: «N نتيجة» with N−1 cards (falcon 2026-10-30,
// 43 served sale rows, 41 of them dealapp). Zero-dep on purpose: scripts/verify-card-price-follows-meter-box-rule.ts
// executes these against the SQL migration's own proof cases. Source tables stay untouched (PRICE = SOURCE).

/** public.price_size_impossible(pt, pa, area), verbatim. */
export function priceSizeImpossible(pt: number | null, pa: number | null, area: number | null): boolean {
  const t = pt ?? 0, a = pa ?? 0;
  return t > 50_000_000_000 || a > 50_000_000_000 || (area ?? 0) > 50_000_000
    || (area != null && area > 0 && Math.max(t, a) / area > 5_000_000);
}

/** public.price_typed_in_meter_box_ar(p, area, ppm): the seller's figure, or null when this is not that typo. */
export function priceTypedInMeterBox(p: unknown, area: unknown, ppm: unknown): number | null {
  if (typeof p !== 'number' || typeof area !== 'number' || typeof ppm !== 'number') return null;
  if (!Number.isFinite(p) || !Number.isFinite(area) || !Number.isFinite(ppm)) return null;
  if (ppm < 1000 || area < 1 || area > 50_000_000) return null;
  if (!priceSizeImpossible(p, null, area)) return null;
  if (Math.abs(p / area - ppm) > Math.max(ppm * 0.002, 1)) return null;
  if (ppm / area < 0.1 || ppm / area > 150_000) return null;
  if (priceSizeImpossible(ppm, null, area)) return null;
  return ppm;
}

/** What a SALE card prints and filters on: the index's served total and per-meter figure (enforce_price_size_sanity). */
export function servedSaleFigures(priceTotal: unknown, priceAnnual: unknown, area: unknown, ppm: unknown):
  { priceTotal: unknown; pricePerMeter: unknown } {
  const fix = priceTypedInMeterBox(priceTotal, area, ppm);
  if (fix == null || priceSizeImpossible(fix, typeof priceAnnual === 'number' ? priceAnnual : null, area as number)) {
    return { priceTotal, pricePerMeter: ppm };
  }
  return { priceTotal: fix, pricePerMeter: Math.round(fix / (area as number)) };
}
