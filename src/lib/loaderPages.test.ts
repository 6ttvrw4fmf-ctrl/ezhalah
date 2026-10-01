function assert(value: boolean, message = 'Assertion failed') { if (!value) throw new Error(message); }
import { loaderPageLayout, nextUnseenPage, LOADER_PAGE_MS } from './loaderPages.ts';
for (const [width, height, wide] of [[358, 844, false], [288, 568, false], [1088, 800, true]] as const) {
  const layout = loaderPageLayout(width, height, wide);
  const total = Math.ceil(150 / layout.pageSize);
  const seen = new Set<number>();
  let page: number | null = 0;
  while (page !== null) {
    assert(!seen.has(page), 'automatic presentation must not repeat a completed page');
    seen.add(page);
    page = nextUnseenPage(seen, page, total);
  }
  assert(seen.size === total, 'completion requires every page');
  assert(layout.pageSize >= 9, 'small phones must not degenerate into one-logo pages');
}
assert(nextUnseenPage(new Set([2]), 2, 4) === 3);
assert(nextUnseenPage(new Set([2, 3]), 3, 4) === 0);
assert(nextUnseenPage(new Set([0, 1, 2, 3]), 0, 4) === null);
assert(LOADER_PAGE_MS === 1000);
console.log('Loader pagination coverage and automatic progression tests passed.');
