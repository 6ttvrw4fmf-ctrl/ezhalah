// The deep-search sentence («إزهله يدقّق في …») shown while the Advanced Filter's final search runs
// (owner redesign 2026-08-31: the white success popup and its «لقينا N عقار أقرب لطلبك» beat are
// GONE — the transition now speaks the user's OWN selections and hands off directly to the results).
//
// PURE on purpose — zero runtime imports, Arabic literals inline (the product is Arabic-only and the
// i18n hook can't reach a pure module; the deviceSessions.ts precedent) — so the barrier
// (scripts/verify-af-deep-search-transition.ts) EXECUTES the sentence builder under plain Node
// instead of pattern-matching its shape.
//
// TRUTH RULES:
//   • The sentence is assembled ONLY from what the user actually picked: the resolved clean type
//     (plural-mapped below) and the committed facet labels the interview recorded. Nothing is
//     invented; an unresolved type says «العقارات», an empty selection says «المطابقة لطلبك».
//   • Labels are quoted verbatim inside «guillemets» so ANY label reads grammatically after the
//     «بـ» connector («بـ«تقييم 9.0+»» works where a bare «بمفروشة» would not).
//   • At most MAX_QUOTED labels are woven in (the sentence must stay one breath on mobile); the
//     rest are acknowledged honestly as «وغيرها» — never dropped silently when more exist.

export const MAX_QUOTED = 3;

// Curated Arabic plurals for every clean type in propertyTypes.ts HIERARCHY (+ the facility types).
// Keyed by the ENGLISH clean-type key the SearchQuery carries. A missing/unknown/null type falls
// back to «العقارات» — generic and truthful, never a guess at a plural we haven't curated.
const TYPE_PLURAL_AR: Record<string, string> = {
  Apartment: 'الشقق',
  Floor: 'الأدوار',
  Studio: 'الاستوديوهات',
  Room: 'الغرف',
  'Residential Building': 'العمائر السكنية',
  Villa: 'الفلل',
  Duplex: 'الدوبلكسات',
  'Rest House': 'الاستراحات',
  Chalet: 'الشاليهات',
  Camp: 'المخيمات',
  Farm: 'المزارع',
  'Agriculture Plot': 'الأراضي الزراعية',
  'Residential Land': 'الأراضي السكنية',
  Office: 'المكاتب',
  Shop: 'المحلات',
  Showroom: 'المعارض',
  Warehouse: 'المستودعات',
  Workshop: 'الورش',
  Factory: 'المصانع',
  'Commercial Building': 'العمائر التجارية',
  Hotel: 'الفنادق',
  'Gas Station': 'محطات الوقود',
  'Staff Housing': 'سكنات الموظفين',
  'Commercial Land': 'الأراضي التجارية',
  'Industrial Land': 'الأراضي الصناعية',
  Bank: 'البنوك',
  School: 'المدارس',
  'Health Center': 'المراكز الصحية',
  'Telecom Tower': 'أبراج الاتصالات',
  Parking: 'المواقف',
};

export function typePluralAr(type: string | null | undefined): string {
  return (type && TYPE_PLURAL_AR[type]) || 'العقارات';
}

/**
 * The headline. Examples:
 *   deepSearchLine('Apartment', ['تقييم 9.0+', '10 تقييمات أو أكثر'])
 *     → «إزهله يدقّق في الشقق بـ«تقييم 9.0+» و«10 تقييمات أو أكثر» للعثور على الأقرب لطلبك…»
 *   deepSearchLine(null, []) → «إزهله يدقّق في العقارات المطابقة لطلبك…»
 * Blank labels are ignored; beyond MAX_QUOTED the tail is «وغيرها».
 */
export function deepSearchLine(type: string | null | undefined, labels: readonly string[]): string {
  const scope = typePluralAr(type);
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  if (!clean.length) return `إزهله يدقّق في ${scope} المطابقة لطلبك…`;
  const shown = clean.slice(0, MAX_QUOTED).map((l) => `«${l}»`);
  const tail = clean.length > MAX_QUOTED ? ' وغيرها' : '';
  return `إزهله يدقّق في ${scope} بـ${shown.join(' و')}${tail} للعثور على الأقرب لطلبك…`;
}
