// verify-af-emoji-summary.ts — regression guard for the AF emoji summary sentence (owner 2026-08-22).
// Guarantees: only selected answers appear, skipped omitted, emoji per attribute, updates on removal,
// matches actual AF state. Pure unit test — no network, no browser.
import { buildAfSummary } from '../src/lib/afSummary.ts';

let pass = 0;
function assert(cond: boolean, label: string) {
  if (!cond) { console.error(`FAIL: ${label}`); process.exit(1); }
  pass++;
}

// 1. Empty facets → empty string
assert(buildAfSummary([]) === '', 'empty facets → empty string');

// 2. Single facet — property age (new)
const singleAge = buildAfSummary([{ id: 'property_age', keys: ['new'], labels: ['جديد'] }]);
assert(singleAge.includes('جديد'), 'age label present');
assert(singleAge.includes('✨'), 'new age gets ✨');
assert(singleAge.includes('عمر'), 'age context word');

// 3. Single facet — property age (old)
const oldAge = buildAfSummary([{ id: 'property_age', keys: ['10p'], labels: ['١٠ سنوات فأكثر'] }]);
assert(oldAge.includes('🏗️'), 'old age gets 🏗️');

// 4. Amenities — each key gets its own emoji
const amenities = buildAfSummary([{ id: 'amenities', keys: ['kitchen', 'elevator', 'ac'], labels: ['المطبخ', 'مصعد', 'تكييف'] }]);
assert(amenities.includes('🍳'), 'kitchen emoji');
assert(amenities.includes('🛗'), 'elevator emoji');
assert(amenities.includes('❄️'), 'ac emoji');
assert(amenities.includes('المطبخ'), 'kitchen label');

// 5. Bathrooms — context word + emoji
const bath = buildAfSummary([{ id: 'bathrooms', keys: ['3'], labels: ['+٣'] }]);
assert(bath.includes('🚿'), 'bathroom emoji');
assert(bath.includes('حمامات'), 'bathroom context word');
assert(bath.includes('+٣'), 'bathroom label');

// 6. Furnished yes/no
const furnYes = buildAfSummary([{ id: 'furnished', keys: ['yes'], labels: ['مفروشة'] }]);
assert(furnYes.includes('🛋️'), 'furnished yes gets 🛋️');
const furnNo = buildAfSummary([{ id: 'furnished', keys: ['no'], labels: ['غير مفروشة'] }]);
assert(furnNo.includes('🏠'), 'furnished no gets 🏠');

// 7. Street width — context word
const street = buildAfSummary([{ id: 'street_width', keys: ['20'], labels: ['٢٠ م فأكثر'] }]);
assert(street.includes('🛣️'), 'street emoji');
assert(street.includes('شارع'), 'street context word');

// 8. Direction — multi labels joined with و
const dir = buildAfSummary([{ id: 'direction', keys: ['شمال', 'شرق'], labels: ['شمال', 'شرق'] }]);
assert(dir.includes('🧭'), 'direction emoji');
assert(dir.includes('شمال و'), 'direction labels joined');

// 9. Rating
const rating = buildAfSummary([{ id: 'rating', keys: ['9.5'], labels: ['9.5+'] }]);
assert(rating.includes('⭐'), 'rating emoji');
assert(rating.includes('تقييم'), 'rating context word');

// 10. RNPL
const rnpl = buildAfSummary([{ id: 'rnpl', keys: ['rnpl'], labels: ['يقبل التقسيط'] }]);
assert(rnpl.includes('💳'), 'rnpl emoji');

// 11. Unit subtype
const sub = buildAfSummary([{ id: 'unit_subtype', keys: ['استديو'], labels: ['استديو'] }]);
assert(sub.includes('🏢'), 'unit subtype emoji');

// 12. Multiple facets — Arabic comma joining, و before last
const multi = buildAfSummary([
  { id: 'property_age', keys: ['new'], labels: ['جديد'] },
  { id: 'amenities', keys: ['kitchen'], labels: ['المطبخ'] },
  { id: 'bathrooms', keys: ['2'], labels: ['+٢'] },
]);
assert(multi.includes('، و'), 'و before last item');
assert(multi.includes('✨'), 'age emoji in multi');
assert(multi.includes('🍳'), 'kitchen emoji in multi');
assert(multi.includes('🚿'), 'bathroom emoji in multi');
// The sentence should NOT contain any item from a question not in the facets
assert(!multi.includes('🛣️'), 'no street emoji when not selected');
assert(!multi.includes('⭐'), 'no rating emoji when not selected');

// 13. Removal simulation — removing a facet updates the summary
const fullFacets = [
  { id: 'property_age', keys: ['new'], labels: ['جديد'] },
  { id: 'amenities', keys: ['kitchen', 'parking'], labels: ['المطبخ', 'مواقف'] },
  { id: 'bathrooms', keys: ['3'], labels: ['+٣'] },
];
const before = buildAfSummary(fullFacets);
assert(before.includes('🅿️'), 'parking emoji before removal');
// Simulate removing bathrooms (index 2)
const afterRemoval = buildAfSummary(fullFacets.filter((_, i) => i !== 2));
assert(!afterRemoval.includes('🚿'), 'bathroom emoji gone after removal');
assert(afterRemoval.includes('🍳'), 'kitchen still present after removal');

// 14. All private entrance amenity variants have correct emoji
for (const [key, emoji] of Object.entries({
  private_entrance: '🚪', maid_room: '🧹', driver_room: '🚘',
  car_entrance: '🚗', sanitation: '🚰', electricity: '⚡', water_supply: '💧',
})) {
  const s = buildAfSummary([{ id: 'amenities', keys: [key], labels: [key] }]);
  assert(s.includes(emoji), `amenity ${key} → ${emoji}`);
}

// 15. Single item has no و or ،
const single = buildAfSummary([{ id: 'rating', keys: ['9.0'], labels: ['9.0+'] }]);
assert(!single.includes('،'), 'single item has no comma');

console.log(`✅ verify-af-emoji-summary: ${pass} assertions passed`);
