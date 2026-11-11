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
