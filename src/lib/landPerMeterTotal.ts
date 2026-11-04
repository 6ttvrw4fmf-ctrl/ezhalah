// A LAND PER-METRE PRICE TYPED INTO THE TOTAL BOX (owner 2026-11-04: «build the best solution, a strong guard»).
// abwbna 10777645 (الأحساء / المطيرفي الغربي, 375 m²) publishes «1,700» as the total; it is the per-metre price, so the
// plot is ≈ 637,500. The SEARCH INDEX decides (public.land_ppm_typed_as_total_served_ar: the district/city price band and
// the ad's own words — data the client does not have) and serves price_total = figure × area, flagged ppm_typed_as_total
// (migrations 20261104221247 + 20261104221607). The card does NOT re-decide: it reads the index's verdict from the
// results RPC's effective_price, so the card, the client budget net (which re-reads the printed price) and the count
// are one number. The platform table keeps the source figure (PRICE = SOURCE); the card keeps it visible too.
// Zero-dep on purpose: scripts/verify-land-ppm-typed-as-total.ts executes this file directly.

/** The upper bound of the typed figure the SQL rule accepts (land_ppm_typed_as_total_ar: total < 20,000). */
export const TYPED_FIGURE_MAX = 20_000;
/** The derived-total bound (DERIVED_TOTAL_MAX in src/data/listings.ts, and the SQL rule's own cap). */
export const SERVED_TOTAL_MAX = 500_000_000;

/** The total the index serves for this row when it read the source total as a per-metre price, else null.
 *  Exact recognition: the served figure IS source total × area (no other index rule produces that shape). */
export function servedTotalFromTypedPerMeter(deal: unknown, sourceTotal: unknown, area: unknown, served: unknown): number | null {
  if (deal !== 'Buy') return null;
  if (typeof sourceTotal !== 'number' || !(sourceTotal > 0) || sourceTotal >= TYPED_FIGURE_MAX) return null;
  if (typeof area !== 'number' || !(area >= 100)) return null;
  const s = typeof served === 'string' && served.trim() !== '' ? Number(served) : served;
  if (typeof s !== 'number' || !Number.isFinite(s) || !(s > sourceTotal) || s > SERVED_TOTAL_MAX) return null;
  return Math.abs(s / area - sourceTotal) < 0.01 ? s : null;
}

type PriceCard = {
  deal: string; price: string; area: number;
  priceIsDerived?: boolean; pricePerMeter?: number | null; discount?: unknown;
  salePriceTotal?: number | null; typedTotalAsPerMeter?: number | null;
};

/** Apply the index's verdict to a finalized card: «≈ total», the seller's figure as the per-metre rate (so the card's
 *  «سعر المتر × المساحة = …» line shows the working) and kept as typedTotalAsPerMeter for the «the ad wrote N» line.
 *  Returns true when the card changed. A row already showing a derived total is left alone. */
export function followIndexPerMeterVerdict(l: PriceCard, effectivePrice: unknown): boolean {
  if (l.priceIsDerived) return false;
  const total = servedTotalFromTypedPerMeter(l.deal, l.salePriceTotal, l.area, effectivePrice);
  if (total == null) return false;
  l.typedTotalAsPerMeter = l.salePriceTotal as number;
  l.pricePerMeter = l.salePriceTotal as number;
  l.price = `≈ SAR ${total.toLocaleString('en-US')}`;
  l.priceIsDerived = true;
  l.discount = null;
  return true;
}
