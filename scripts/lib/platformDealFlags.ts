// One rule, shared by the hermetic barrier and the live robot: a platform flag (allowsRent / allowsBuy in
// src/data/platforms.ts) may never forbid a deal side that production SERVES. runSearch() drops such rows
// with supports() AFTER the count is taken, so the customer reads «2 نتيجة» and sees 1 card.
// 2026-10-30: sakani (1,532 sale) and wajaf (4 rent) were hidden exactly this way. Backlog 1097.
export type Deal = 'Rent' | 'Buy';
export type ServedSide = { slug: string; source: string; deal: Deal; sample: string };

export const dealOf = (dealAr: string): Deal | null => (dealAr === 'إيجار' ? 'Rent' : dealAr === 'بيع' ? 'Buy' : null);

/** Every served (platform, deal) side the card filter would throw away. Empty = counts and cards agree. */
export function hiddenServedSides(served: ServedSide[], supports: (source: string, deal: Deal) => boolean): string[] {
  return served
    .filter((s) => !supports(s.source, s.deal))
    .map((s) => `${s.slug} «${s.source}» serves ${s.deal} rows (e.g. ${s.sample}) but its platform flag forbids ${s.deal}: counted, never shown`);
}
