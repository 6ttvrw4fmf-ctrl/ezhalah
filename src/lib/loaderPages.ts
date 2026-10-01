/** Presentation only: every page gets a full dwell before results replace the loader. */
export const LOADER_PAGE_MS = 1000;
export function loaderPageLayout(width: number, height: number, wide: boolean) {
  const columns = Math.max(1, Math.floor(width / (wide ? 112 : 96)));
  const rowHeight = wide ? 116 : Math.max(84, Math.min(102, (height - 316) / 4));
  const rows = Math.max(wide ? 2 : 3, Math.min(4, Math.floor((height - 380) / rowHeight)));
  return { columns, rows, pageSize: columns * rows, rowHeight };
}
export function nextUnseenPage(seen: ReadonlySet<number>, page: number, total: number): number | null {
  for (let step = 1; step <= total; step++) {
    const next = (page + step) % total;
    if (!seen.has(next)) return next;
  }
  return null;
}
