function assert(value: boolean, message = 'Assertion failed') { if (!value) throw new Error(message); }
import { loaderPageLayout, loaderSlotIndices, LOADER_PAGE_MS } from './loaderPages.ts';
for (const [width, height, wide] of [[358, 844, false], [288, 568, false], [1088, 800, true]] as const) {
  const layout = loaderPageLayout(width, height, wide);
  for (const total of [0, 1, 11, 150]) {
    const slots = Math.min(total, layout.pageSize);
    const seen = new Set<number>();
    let previous: number[] = [];
    for (let step = 0; step <= total - slots; step++) {
      const indices = loaderSlotIndices(total, slots, step);
      assert(indices.length === slots, 'every occupied slot remains filled through the tail');
      assert(new Set(indices).size === slots, 'visible logos must be unique');
      assert(indices.every(i => i >= 0 && i < total), 'only roster entries may render');
      if (step > 0) assert(indices.filter((i, slot) => i !== previous[slot]).length === 1, 'one tile changes, never a whole page');
      indices.forEach(i => seen.add(i));
      previous = indices;
    }
    assert(seen.size === total, 'completion requires the entire roster');
  }
  assert(layout.pageSize >= 9, 'small phones keep a readable grid');
}
assert(LOADER_PAGE_MS === 1000);
console.log('Continuous loader coverage, full slots and single-tile progression passed.');
