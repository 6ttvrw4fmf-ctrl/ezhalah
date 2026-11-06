// The main filter's «الأثاث» answer, in the words the chat repeats back to the user (owner 2026-11-05:
// «confirm that it matches what the user wants»). Measured that day on ezhalah.com: Jeddah + شقة + «غير مفروشة»
// returned the right 3,475 unfurnished ads, but the opening bubble said «أبحث عن شقة للإيجار السنوي في جدة» and
// «ملخص البحث» listed no furniture line, so the user could not see their own choice. PURE — no imports.
export type FurnishingLabelKey = 'Furniture: furnished' | 'Furniture: unfurnished';

export function furnishingLabelKey(pref: boolean | null | undefined): FurnishingLabelKey | null {
  if (pref == null) return null; // «الكل» — nothing was asked of the ads, so nothing is said
  return pref ? 'Furniture: furnished' : 'Furniture: unfurnished';
}
