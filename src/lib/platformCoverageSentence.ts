// Coverage describes listing locations, never a company's office address or business services.
export type PickerCoverage = {
  state: 'known' | 'unknown' | 'source-examples';
  total: number | null;
  regions: { id: number; name: string; en: string; count: number }[];
  topCity?: { name: string; en?: string; count: number } | null;
  focusCounts?: { Residential: number | null; Commercial: number | null };
  examples?: { ar: string; en: string }[];
};

function locationSentence(coverage: PickerCoverage | undefined, locale: 'ar' | 'en'): string {
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

export function platformCoverageSentence(coverage: PickerCoverage | undefined, locale: 'ar' | 'en'): string {
  const location = locationSentence(coverage, locale);
  const residential = coverage?.focusCounts?.Residential ?? 0;
  const commercial = coverage?.focusCounts?.Commercial ?? 0;
  if (!residential && !commercial) return location;
  const sum = coverage?.total;
  if (!sum) return location;
  const ar = locale === 'ar';
  const focus = residential / sum >= 0.7 ? (ar ? (residential === sum ? 'عقارات سكنية' : 'عقارات سكنية بالدرجة الأولى') : (residential === sum ? 'Residential listings' : 'Primarily residential listings'))
    : commercial / sum >= 0.7 ? (ar ? (commercial === sum ? 'عقارات تجارية' : 'عقارات تجارية بالدرجة الأولى') : (commercial === sum ? 'Commercial listings' : 'Primarily commercial listings'))
    : residential && commercial ? (ar ? 'عقارات سكنية وتجارية' : 'Residential and commercial listings')
    : (ar ? 'عقارات' : 'Listings');
  if (ar) {
    if (location.startsWith('أغلب العقارات في ')) return `${focus}، أغلبها في ${location.slice('أغلب العقارات في '.length)}`;
    if (location.startsWith('عقارات في ')) return location.replace('عقارات في ', `${focus} في `);
    return `${focus}؛ نطاقها الجغرافي غير متاح حالياً.`;
  }
  return location.startsWith('Most listings are in ') ? `${focus}, mostly in ${location.slice('Most listings are in '.length)}`
    : location.startsWith('Listings ') ? location.replace('Listings ', `${focus} `)
    : `${focus}; location coverage is currently unavailable.`;
}

export function platformCoverageGroup(coverage: PickerCoverage | undefined, locale: 'ar' | 'en') {
  const ar = locale === 'ar';
  if (coverage?.state === 'known' && coverage.total && coverage.regions.length) {
    const first = coverage.regions.slice().sort((a, b) => b.count - a.count)[0];
    if (coverage.regions.length >= 6 && first.count / coverage.total < 0.7) {
      return { key: 'nationwide', order: 0, label: ar ? 'في مختلف مناطق المملكة' : 'Across Saudi Arabia' };
    }
    if (first.count > coverage.total / 2) {
      return { key: `region-${first.id}`, order: first.id, label: ar ? first.name : `${first.en} Region` };
    }
  }
  if (coverage?.state === 'source-examples' || coverage?.regions.length) {
    return { key: 'multiple-regions', order: 100, label: ar ? 'عدة مناطق' : 'Several regions' };
  }
  return { key: 'other', order: 101, label: ar ? 'مواقع أخرى' : 'Other websites' };
}
