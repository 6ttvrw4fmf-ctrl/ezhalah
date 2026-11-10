// THE MAP SEARCH BOX, ITS PURE RULES (owner 2026-11-10: «the search can be a bit glitchy, it's a bit annoying, not
// nice»). Measured live on ezhalah.com (390×844, 2026-11-10):
//  - typing a NEW place kept the OLD place's list under it for 0.75-1.1 s («الخبر» showed حي النرجس rows, «riyadh park»
//    showed الخبر rows) — the list belongs to the words it was found for, never to other words;
//  - each list waited for the slowest of 8 place look-ups, up to 1.5 s each;
//  - a tap held 0.35 s on a suggestion lost the list (the field's blur closed it first) and picked nothing.
// Import-free so scripts/verify-map-search-not-glitchy.ts executes it.

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The list on screen for what is typed NOW: the rows found for these exact words, or for words these refine (typing
 *  on: «الخب» → «الخبر» keeps «الخب»'s rows until the new ones arrive). Rows for other words never show. */
export function hitsToShow<T>(typed: string, found: { q: string; rows: T[] } | null): T[] {
  if (!found) return [];
  const now = norm(typed), was = norm(found.q);
  return now === was || (was.length >= 2 && now.startsWith(was)) ? found.rows : [];
}

/** How long one row waits for Apple's place details before it shows without a kind tag (was 1,500 ms). */
export const RESOLVE_BUDGET_MS = 600;

/** A small memory of recent answers, so going back (backspace, the same word again) is instant. */
export function makeSuggestCache<T>(max = 60) {
  const m = new Map<string, T>();
  return {
    get: (k: string) => { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },   // used = recent
    set: (k: string, v: T) => { m.delete(k); m.set(k, v); if (m.size > max) m.delete(m.keys().next().value as string); },
    size: () => m.size,
  };
}
/** The cache key: the words, the language, and roughly where the map is (Apple ranks around the view). */
export const suggestKey = (q: string, language: string, center?: { latitude: number; longitude: number }) =>
  `${language}|${norm(q)}|${center ? `${Math.round(center.latitude * 2) / 2},${Math.round(center.longitude * 2) / 2}` : ''}`;
