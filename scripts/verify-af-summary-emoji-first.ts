// EMOJI FIRST, ALWAYS, in every Advanced Filter pill (owner 2026-11-01).
//
// The owner noticed the results line mixing «يقبل التقسيط 💳» (old pills: emoji LAST) with «🛗 مصعد»
// (card chips: emoji FIRST) and asked for one rule. The rule is FIRST — the question cards and the
// property cards already read «🛗 مصعد», so the pills, the round receipt and the search beat follow.
//
// This EXECUTES the real builders (src/lib/afSummary.ts) over one facet of EVERY question id the
// summary knows, in both locales, and over a round log with skips, and fails on any item that does
// not start with an emoji. It is not a text grep: a rewrite of one case that puts the words back in
// front is caught by running it.
import assert from 'node:assert/strict';
import { buildAfSummaryItems, buildAfRoundLog, AF_LINE_LABEL } from '../src/lib/afSummary.ts';
import type { AfFacet } from '../src/lib/afSummary.ts';

// An item starts with its emoji: the first grapheme is a pictograph (variation selectors allowed), then a space.
const STARTS_WITH_EMOJI = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})(️|‍\p{Extended_Pictographic})*\s\S/u;
export const emojiFirst = (item: string): boolean => STARTS_WITH_EMOJI.test(item);

// Predicate sanity, both directions, before trusting it on the real output.
assert.equal(emojiFirst('🛗 مصعد'), true, 'predicate accepts emoji-first');
assert.equal(emojiFirst('🏗️ عمر سنتين'), true, 'predicate accepts an emoji with a variation selector');
assert.equal(emojiFirst('⏭️ تخطى عمر العقار'), true, 'predicate accepts the skip mark');
assert.equal(emojiFirst('يقبل التقسيط 💳'), false, 'predicate rejects emoji-last');
assert.equal(emojiFirst('مصعد'), false, 'predicate rejects a bare word');

const SAMPLE: Record<string, AfFacet> = {
  property_group: { id: 'property_group', keys: ['Apartments & Co-living'], labels: ['الشقق والسكن المشترك'] },
  property_type: { id: 'property_type', keys: ['Apartment'], labels: ['شقة'] },
  property_age: { id: 'property_age', keys: ['new', '2'], labels: ['جديد', 'حتى سنتين'] },
  rnpl: { id: 'rnpl', keys: ['yes'], labels: ['يقبل التقسيط'] },
  amenities: { id: 'amenities', keys: ['elevator', 'parking', 'zzz_unknown_token'], labels: ['مصعد', 'مواقف', 'غريب'] },
  comfort: { id: 'comfort', keys: ['elevator'], labels: ['🛗 مصعد'] },
  space: { id: 'space', keys: ['majlis'], labels: ['🛋️ مجلس'] },
  bathrooms: { id: 'bathrooms', keys: ['3'], labels: ['+٣'] },
  furnished: { id: 'furnished', keys: ['yes', 'no'], labels: ['مفروشة', 'غير مفروشة'] },
  street_width: { id: 'street_width', keys: ['20'], labels: ['٢٠ م'] },
  direction: { id: 'direction', keys: ['N', 'W'], labels: ['شمال', 'غرب'] },
  rating: { id: 'rating', keys: ['9'], labels: ['٩+'] },
  unit_subtype: { id: 'unit_subtype', keys: ['studio'], labels: ['استوديو'] },
};
// Every id the summary labels must be covered here, so a question added later is checked too.
for (const id of Object.keys(AF_LINE_LABEL)) {
  if (!SAMPLE[id]) SAMPLE[id] = { id, keys: ['k'], labels: ['🧩 عينة'] };
}

let checked = 0;
for (const locale of ['ar', 'en'] as const) {
  for (const f of Object.values(SAMPLE)) {
    for (const item of buildAfSummaryItems([f], locale)) {
      assert.ok(emojiFirst(item), `[${locale}] ${f.id}: «${item}» must start with its emoji`);
      checked++;
    }
  }
  // The round receipt: answers AND skips, every item emoji-first.
  const log = buildAfRoundLog(['property_age', 'bathrooms', 'direction', 'rating'], [SAMPLE.bathrooms, SAMPLE.direction], locale);
  const parts = locale === 'en' ? log.split(', ') : log.split(/، و?/);
  for (const p of parts) { assert.ok(emojiFirst(p), `[${locale}] receipt item «${p}» must start with its emoji`); checked++; }
}
assert.ok(checked >= 30, `expected to check many items, checked ${checked}`);

// MUTATION PROOF — the predicate this barrier applies to every real item must FAIL on the old shape.
// `mustCatch(label, caught)`: `caught` is true only when the predicate rejects the broken input.
function mustCatch(label: string, caught: boolean): void {
  assert.ok(caught, `mutation NOT caught: ${label}`);
  console.log(`  (mutation) catches ${label}`);
}
const brokenItems = ['يقبل التقسيط 💳', 'عمر جديد ✨', 'شمال 🧭', '+٣ حمامات 🚿', 'تخطى عمر العقار ⏭️', 'Age Up to 2 years 🏗️'];
mustCatch('an emoji-last pill of the old shape (every one of the six)', brokenItems.every((it) => !emojiFirst(it)));
mustCatch('a receipt item with no emoji at all', !emojiFirst('تخطى عمر العقار'));
mustCatch('an item whose emoji is glued to the word with no space', !emojiFirst('🛗مصعد'));

console.log(`verify-af-summary-emoji-first: OK — ${checked} items, every one starts with its emoji`);
