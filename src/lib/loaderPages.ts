/** Presentation only: every page gets a full dwell before results replace the loader. */
export const LOADER_PAGE_MS = 1000;
export const LOADER_CYCLE_MS = 10000;
/** Reserve readable first/last holds; distribute the intervening updates across the same budget. */
export function loaderStepDelay(total: number, capacity: number, replacements: number): number {
  const remaining = Math.max(0, total - capacity);
  return replacements === 0 || replacements >= remaining
    ? LOADER_PAGE_MS
    : (LOADER_CYCLE_MS - 2 * LOADER_PAGE_MS) / Math.max(1, remaining - 1);
}
export function loaderPageLayout(width: number, height: number, wide: boolean, top = 300) {
  const columns = Math.max(1, Math.floor(width / (wide ? 112 : 96)));
  const rowHeight = wide ? 92 : 84;
  // Fill the actual space below the heading, leaving room for the footer and safe area.
  const available = Math.max(rowHeight, height - Math.max(0, top) - (wide ? 64 : 88));
  const rows = Math.max(1, Math.floor(available / rowHeight));
  return { columns, rows, pageSize: columns * rows, rowHeight };
}
/** Replace occupied slots individually; the tail retains earlier logos instead of empty cells. */
export function loaderSlotIndices(total: number, capacity: number, replacements: number): number[] {
  const slots = Math.min(total, capacity);
  if (slots <= 0) return [];
  const changed = Math.min(Math.max(0, replacements), total - slots);
  return Array.from({ length: slots }, (_, slot) => {
    if (changed <= slot) return slot;
    return slots + slot + Math.floor((changed - 1 - slot) / slots) * slots;
  });
}
