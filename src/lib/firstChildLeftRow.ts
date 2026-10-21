// Pure: `flexDirection` for a page-structure row whose FIRST child must stay on the physical LEFT in both languages,
// given whether the PAGE is right-to-left right now (src/lib/useDocumentRtl.ts). Under dir=rtl a `row` lays its
// first child on the right, so it is reversed exactly then.
export const firstChildLeftRow = (docRtl: boolean): 'row' | 'row-reverse' => (docRtl ? 'row-reverse' : 'row');
