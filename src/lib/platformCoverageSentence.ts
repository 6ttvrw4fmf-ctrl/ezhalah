// Coverage describes listing locations, never a company's office address or business services.
export type PickerCoverage = {
  state: 'known' | 'unknown' | 'source-examples';
  total: number | null;
  regions: { id: number; name: string; en: string; count: number }[];
  topCity?: { name: string; en?: string; count: number } | null;
  examples?: { ar: string; en: string }[];
};

export function platformCoverageSentence(coverage: PickerCoverage | undefined, locale: 'ar' | 'en'): string {
  const ar = locale === 'ar';
  if (coverage?.state === 'source-examples' && coverage.examples?.length) {
    const areas = coverage.examples.map(area => area[locale]);
    return ar ? `عقارات في ${areas.join('، ')}.` : `Listings in ${areas.join(', ')}.`;
  }
  const unavailable = ar ? 'بيانات نطاق العقارات غير متاحة حالياً.' : 'Listing location coverage is currently unavailable.';
  if (coverage?.state !== 'known' || !coverage.total || !coverage.regions.length) return unavailable;
  const { total } = coverage;
  const regions = coverage.regions.filter(region => region.count > 0).slice().sort((a, b) => b.count - a.count);
  if (!regions.length) return unavailable;
  const first = regions[0];
  const place = ar ? first.name : first.en;
  const city = coverage.topCity;
  if (city && city.count === total && (ar || city.en)) {
    return ar ? `عقارات في ${city.name}.` : `Listings in ${city.en}.`;
  }
  if (regions.length === 1 && first.count / total >= 0.95) {
    return ar ? `عقارات في ${place}.` : `Listings in ${place} Region.`;
  }
  // A dominant concentration takes precedence over a handful of outlying listings.
  if (first.count / total >= 0.7) {
    return ar ? `أغلب العقارات في ${place}.` : `Most listings are in ${place} Region.`;
  }
  if (regions.length >= 6) {
    return ar ? 'عقارات في مختلف مناطق المملكة.' : 'Listings across Saudi Arabia.';
  }
  if (first.count > total / 2) {
    return ar ? `أغلب العقارات في ${place}.` : `Most listings are in ${place} Region.`;
  }
  const areas = regions.slice(0, 3).map(region => ar ? region.name : `${region.en} Region`);
  return ar
    ? `عقارات في ${areas.join('، ')}${regions.length > 3 ? ' ومناطق أخرى' : ''}.`
    : `Listings in ${areas.join(', ')}${regions.length > 3 ? ' and other regions' : ''}.`;
}
