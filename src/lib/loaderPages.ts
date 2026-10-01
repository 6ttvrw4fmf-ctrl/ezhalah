/** Presentation only: every page gets a full dwell before results replace the loader. */
export const LOADER_PAGE_MS = 1000;
export function loaderPageLayout(width: number, height: number, wide: boolean) {
  const columns = Math.max(1, Math.floor(width / (wide ? 112 : 96)));
  const rowHeight = wide ? 92 : 84;
  const rows = Math.max(wide ? 2 : 3, Math.min(4, Math.floor((height - 380) / rowHeight)));
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
