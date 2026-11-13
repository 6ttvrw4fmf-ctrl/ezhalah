// The bath count a card prints is the one the search index SERVES (🔧 2026-11-10, card_parity_card_missing
// fkralemar/aqargate bathrooms, alerts 13687/13920, backlog 1684).
//
// The raw row the card is hydrated from carries the site's own box (`bathrooms` column); the index serves
// `af_rule_b_num(column, text fact)` — the seller's own sentence fills a box the site left empty
// (docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md, Rule B). So a customer who filtered «3 حمامات» could reach a card
// that showed NO bath count: fkralemar 13106990 (column NULL, words «4 حمامات», index 4), aqargate 10028937
// (column NULL, «غرفة + حمام … حمام», index 3). The card now prints the index's figure when the site's box is
// empty. A box the site DID fill is still the box (card = source page); a conflict the index serves as
// unknown leaves the box as it is. Nothing is invented: the index's figure is the seller's own words.
export function bathroomsForCard(raw: unknown, served: unknown): number | null {
  const r = asCount(raw);
  if (r !== null) return r;
  return asCount(served);
}

function asCount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// WHERE THE INDEX'S FIGURE COMES FROM ON THE SEARCH PATH (🔧 2026-11-11, card_parity_card_missing:squares:bathrooms).
// The results RPC packs af_canon ONLY for a search with an Advanced-Filter answer (migration 20261104033508): every
// ordinary Filter search hands the card af_canon = NULL, so the 11-10 fix never reached it — squares 13602721 (box
// empty, index 5) still printed no bath count on the live card at 21:2x UTC. A no-AF search therefore reads the
// served counts in ONE bounded request beside the card reads (indexBathsRows → this lookup); an AF search keeps
// reading its own canonical row. A failed read leaves the lookup empty: the card shows the site's box, as before.
export type IndexBathRow = { source_table?: unknown; listing_id?: unknown; bathrooms?: unknown };
export const bathKey = (table: unknown, id: unknown) => `${String(table)}:${Number(id)}`;

/** The served bath count per `table:id`, from index rows (only real counts are kept). */
export function indexBathLookup(rows: readonly IndexBathRow[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows ?? []) {
    const n = asCount(r.bathrooms);
    if (n !== null && r.source_table && r.listing_id !== undefined && r.listing_id !== null) out.set(bathKey(r.source_table, r.listing_id), n);
  }
  return out;
}

/** The index's figure for one search candidate: its AF canonical row when the search carried one, else the lookup. */
export function servedBathsFor(c: { source_table: string; listing_id: number; af_canon?: Record<string, unknown> | null },
                               lookup: ReadonlyMap<string, number>): unknown {
  return c.af_canon ? c.af_canon.bathrooms : lookup.get(bathKey(c.source_table, c.listing_id));
}
