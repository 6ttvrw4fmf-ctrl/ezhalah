/** Presentation only: every page gets a full dwell before results replace the loader. */
// FASTER, STILL COMPLETE (owner 2026-10-28: «speed up … all logos must show, all messages … target 10-12 seconds»).
// Measured on a mid-range phone: Riyadh search → first card 18.4 s, 13.6 s of it before the summary. The logo
// cycle goes 10 s → 6 s and each page's first/last hold 1 s → 0.7 s; every logo is still shown before results.
export const LOADER_PAGE_MS = 700;
export const LOADER_CYCLE_MS = 6000;
/** Reserve readable first/last holds; distribute the intervening updates across the same budget. */
export function loaderStepDelay(total: number, capacity: number, replacements: number): number {
  const remaining = Math.max(0, total - capacity);
  return replacements === 0 || replacements >= remaining
    ? LOADER_PAGE_MS
    : (LOADER_CYCLE_MS - 2 * LOADER_PAGE_MS) / Math.max(1, remaining - 1);
}
export function loaderPageLayout(width: number, height: number, wide: boolean, top = 300, bottomInset = wide ? 64 : 88) {
  const columns = Math.max(1, Math.floor(width / (wide ? 112 : 96)));
  const rowHeight = wide ? 92 : 84;
  // Use the measured footer (including safe area) and the thread’s 16px bottom padding.
  const available = Math.max(rowHeight, height - Math.max(0, top) - bottomInset - 16);
  const rows = Math.max(1, Math.floor(available / rowHeight));
  return { columns, rows, pageSize: columns * rows, rowHeight, gridHeight: available };
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
