function assert(value: boolean, message = 'Assertion failed') { if (!value) throw new Error(message); }
import { loaderPageLayout, loaderSlotIndices, loaderStepDelay, LOADER_CYCLE_MS, LOADER_PAGE_MS } from './loaderPages.ts';
for (const [width, height, wide] of [[358, 844, false], [288, 568, false], [1088, 800, true]] as const) {
  const layout = loaderPageLayout(width, height, wide, 200, 52);
  for (const total of [0, 1, 11, 150]) {
    const slots = Math.min(total, layout.pageSize);
    const seen = new Set<number>();
    let previous: number[] = [];
    let elapsed = 0;
    for (let step = 0; step <= total - slots; step++) {
      elapsed += loaderStepDelay(total, slots, step);
      const indices = loaderSlotIndices(total, slots, step);
      assert(indices.length === slots, 'every occupied slot remains filled through the tail');
      assert(new Set(indices).size === slots, 'visible logos must be unique');
      assert(indices.every(i => i >= 0 && i < total), 'only roster entries may render');
      if (step > 0) assert(indices.filter((i, slot) => i !== previous[slot]).length === 1, 'one tile changes, never a whole page');
      indices.forEach(i => seen.add(i));
      previous = indices;
    }
    assert(seen.size === total, 'completion requires the entire roster');
    assert(elapsed <= LOADER_CYCLE_MS + 0.001, 'small screens must not stretch the animation past ten seconds');
    if (total - slots > 1) assert(Math.abs(elapsed - LOADER_CYCLE_MS) < 0.001, 'the whole cycle uses the ten-second budget');
  }
  assert(layout.pageSize >= 9, 'small phones keep a readable grid');
}
assert(LOADER_PAGE_MS === 1000);
console.log('Continuous loader coverage, full slots and single-tile progression passed.');

// Regression: do not strand the unused fraction of a row above a guessed footer.
for (const [width, height, wide, top, footer] of [
  [358, 844, false, 220, 52],
  [288, 568, false, 205, 72],
  [528, 760, false, 155, 48],
  [1056, 800, true, 200, 40],
] as const) {
  const layout = loaderPageLayout(width, height, wide, top, footer);
  assert(top + layout.gridHeight + 16 === height - footer, 'grid reaches measured footer with only thread padding');
  assert(layout.rows * layout.rowHeight <= layout.gridHeight, 'every row fits above the footer');
  assert((layout.rows + 1) * layout.rowHeight > layout.gridHeight, 'use every complete row that fits');
}
assert(loaderPageLayout(358, 844, false, 170, 52).rows === 7, 'measured phone footer recovers another row');
console.log('Measured footer and full-height loader layout passed.');
