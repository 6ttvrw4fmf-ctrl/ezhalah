// A PRICE TYPED IN THOUSANDS (owner 2026-11-06, option A: «show ≈ figure × 1000 with a small note, keep the source
// figure visible»). Asas Makeen «سنا مكين — حي القيروان» shows «75 ﷼» for a yearly flat (= 75,000); Haraj land ads write
// «السوم 750 ألف» and type 750. The SEARCH INDEX decides (public.price_in_thousands_served_ar in enforce_price_size_sanity:
// the deal/type/district price bands and the ad's own words — data the client does not have) and serves figure × 1000,
// flagged price_in_thousands (migration 20261106224500). The card does NOT re-decide: it reads the index's verdict from
// the results RPC's effective_price, so the card, the client budget net and the count are one number. The platform table
// keeps the source figure (PRICE = SOURCE); the card keeps it visible too («الموقع كتب 75 — قرأناه بالألف»).
// Zero-dep on purpose: scripts/verify-price-typed-in-thousands.ts executes this file directly.

/** The source figure must be below these for the SQL rule to read it in thousands (sale: the land signature's bound —
 *  homes stop at 10,000 inside it; rent: 300 a year). */
export const THOUSANDS_SALE_BELOW = 20_000;
export const THOUSANDS_RENT_BELOW = 300;
/** The SQL rule never serves a rent under this (the silent-period judge must read it yearly, never ×12 again). */
export const THOUSANDS_RENT_SERVED_MIN = 15_000;
export const THOUSANDS_SERVED_MAX = 500_000_000;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** The figure the index serves for this row when it read the source price in thousands, else null.
 *  Exact recognition: the served figure IS source × 1000. */
export function servedFromThousands(deal: unknown, source: unknown, served: unknown): number | null {
  const below = deal === 'Buy' ? THOUSANDS_SALE_BELOW : deal === 'Rent' ? THOUSANDS_RENT_BELOW : 0;
  if (typeof source !== 'number' || !(source > 0) || !(source < below)) return null;
  const s = num(served);
  if (s == null || Math.abs(s - source * 1000) > 0.5 || s > THOUSANDS_SERVED_MAX) return null;
  if (deal === 'Rent' && s < THOUSANDS_RENT_SERVED_MIN) return null;
  return s;
}

type PriceCard = {
  deal: string; price: string; priceIsDerived?: boolean; discount?: unknown;
  salePriceTotal?: number | null; priceAnnual?: number | null; rentPeriod?: string | null;
  typedInThousands?: number | null;
};

/** Apply the index's verdict to a finalized card: «≈ figure × 1000», a yearly rent, and the source figure kept as
 *  typedInThousands for the «الموقع كتب N — قرأناه بالألف» line. Returns true when the card changed.
 *  A card the land per-metre verdict already changed is left alone (a 1,000 m² plot gives the same number). */
export function followIndexThousandsVerdict(l: PriceCard, effectivePrice: unknown): boolean {
  if (l.priceIsDerived || l.typedInThousands != null) return false;
  if (l.deal === 'Buy') {
    const total = servedFromThousands('Buy', l.salePriceTotal, effectivePrice);
    if (total == null) return false;
    l.typedInThousands = l.salePriceTotal as number;
    l.price = `≈ SAR ${total.toLocaleString('en-US')}`;
    l.discount = null;
    return true;
  }
  if (l.deal === 'Rent') {
    const annual = servedFromThousands('Rent', l.priceAnnual, effectivePrice);
    if (annual == null) return false;
    l.typedInThousands = l.priceAnnual as number;
    l.priceAnnual = annual;          // the client budget net reads this (src/data/search.ts rentAnnualValue)
    l.rentPeriod = 'annual';         // the index judged the served figure yearly (≥ 15,000, judge_silent_rent_period_ar)
    l.price = `≈ SAR ${annual.toLocaleString('en-US')}/yr`;
    l.discount = null;
    return true;
  }
  return false;
}
