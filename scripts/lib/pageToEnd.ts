// Read a paged REST result to its END — the independent DB-truth side of a count check must never be a prefix.
//
// How this was earned (🔬 2026-11-09, alert 11763, af-live-truth-check runs 42367029446 / 42475448017 / 42495155481):
// verify-af-full-surface-differential.ts's oracle stopped paging once `off > MAX_IDS` (60,000), i.e. after 62,000 rows.
// Jeddah Apartment/Buy grew to ~63,500 and the region-1 Apartment+Villa union to ~64,400, so «DB truth» read exactly
// 62000 three nights running and the rows it never read (ordered by source_table, so whole later tables) surfaced as
// 50–74 phantom «EXTRA ineligible listing(s)» against a correct search. A truncated truth is not an answer.
//
// So: page until a short page proves the end. A ceiling still exists (a runaway read must stop), but reaching it with a
// full last page is reported as `truncated: true`, never returned as if it were the whole set.

export type PagedRead<T> = { rows: T[]; truncated: boolean };

export async function pageToEnd<T>(
  fetchPage: (offset: number, size: number) => Promise<T[]>,
  size: number,
  ceiling: number,
): Promise<PagedRead<T>> {
  const rows: T[] = [];
  for (let off = 0; ; off += size) {
    const page = await fetchPage(off, size);
    rows.push(...page);
    if (page.length < size) return { rows, truncated: false };
    if (rows.length >= ceiling) return { rows, truncated: true };
  }
}
