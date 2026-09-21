// AF emoji summary sentences (owner 2026-08-22). PURE — zero runtime deps.
// Each selected Advanced Filter attribute → emoji + Arabic label.
//
// TWO SENTENCES, TWO AUDIENCES — do not merge them.
//
//   buildAfSummary(facets)  → what the filter IS. Committed answers only. This is the sentence the
//     results PILLS carry, so it is a claim about the live predicate: a skipped question appearing
//     here would name a filter that is not applied (permanent rule, owner 2026-08-22).
//
//   buildAfSkipped(ids)     → what the ROUND did. Added 2026-09-20 on the owner's ask ("when user
//     clicks skip add ... an emoji based on the questions u did"). It feeds the completed-round
//     RECEIPT, which is a record of the interview, not a description of the predicate — which is
//     exactly why naming a skip there breaks nothing: the receipt never claims to filter anything.
//     The permanent rule above is untouched and still governs buildAfSummary.

const AMENITY_EMOJI: Record<string, string> = {
  kitchen: '🍳', parking: '🅿️', elevator: '🛗', ac: '❄️',
  private_entrance: '🚪', maid_room: '🧹', driver_room: '🚘',
  car_entrance: '🚗', sanitation: '🚰', furnished: '🛋️',
  electricity: '⚡', water_supply: '💧',
};

export function buildAfSummary(facets: Array<{ id: string; keys: string[]; labels: string[] }>): string {
  if (!facets.length) return '';
  const items: string[] = [];
  for (const f of facets) {
    switch (f.id) {
      case 'property_age':
        items.push(`عمر ${f.labels[0]} ${f.keys[0] === 'new' ? '✨' : '🏗️'}`);
        break;
      case 'rnpl':
        items.push(`${f.labels[0]} 💳`);
        break;
      case 'amenities':
        for (let i = 0; i < f.keys.length; i++)
          items.push(`${f.labels[i]} ${AMENITY_EMOJI[f.keys[i]] ?? '✅'}`);
        break;
      // SCOPE tiers (owner 2026-08-23) — multi-select like amenities, so each picked group/type is
      // its own item. Without these they would fall through `default:` and print as bare labels.
      case 'property_group':
        for (const l of f.labels) items.push(`${l} 🏘️`);
        break;
      case 'property_type':
        for (const l of f.labels) items.push(`${l} 🏡`);
        break;
      case 'bathrooms':
        items.push(`${f.labels[0]} حمامات 🚿`);
        break;
      case 'furnished':
        items.push(`${f.labels[0]} ${f.keys[0] === 'yes' ? '🛋️' : '🏠'}`);
        break;
      case 'street_width':
        items.push(`شارع ${f.labels[0]} 🛣️`);
        break;
      // «أو», not «و». p_directions is a membership filter — picking شمال and غرب returns listings
      // facing north OR west. «شمال وغرب» describes a DIFFERENT, buildable query: one corner listing
      // with both frontages (the index models frontage_count), so the wrong connector does not merely
      // read oddly, it names a real query we did not run. Every OTHER multi-select in this sentence is
      // genuinely conjunctive — amenities AND together in the RPC — which is why they stay on «و».
      case 'direction':
        items.push(`${f.labels.join(' أو ')} 🧭`);
        break;
      case 'rating':
        items.push(`تقييم ${f.labels[0]} ⭐`);
        break;
      case 'unit_subtype':
        items.push(`${f.labels[0]} 🏢`);
        break;
      default:
        for (const l of f.labels) items.push(l);
    }
  }
  // Facet-level dedup (afSteps.ts's dedupeFacetsByLabel) collapses two facets that are IDENTICAL
  // bundles, but this loop explodes multi-select facets (amenities/direction/property_group/type)
  // into one item PER KEY — two facets that only PARTIALLY overlap (e.g. a future second amenities-
  // style question that also offers "Gym") would each survive facet dedup as distinct bundles, yet
  // still push the identical finished item ("Gym ✅") twice into this sentence. Dedupe at the final,
  // fully-rendered item text — the actual thing the user reads — so no upstream shape of overlap can
  // slip through (owner audit, 2026-08-27).
  return joinAr([...new Set(items)]);
}

// «،» between, «، و» before the last — the one Arabic list joiner both sentences share, so the
// receipt's two lines can never drift into different punctuation. Every item ends in its emoji and
// the separator follows it: comma AFTER the emoji, never before (owner, universal).
const joinAr = (items: string[]): string =>
  items.length === 0 ? ''
    : items.length === 1 ? items[0]
      : items.slice(0, -1).join('، ') + '، و' + items[items.length - 1];

// Every question the interview can ASK, as the short noun the receipt names it by — «عمر العقار»,
// not the question sentence «كم عمر العقار تقريباً؟». The emoji is deliberately the SAME one that
// question's committed answer carries above, so one question reads identically whether it was
// answered or skipped. The two SCOPE tiers are here too: they show no Skip button, but «متابعة» with
// nothing ticked leaves them uncommitted, which is a skip in everything but name.
// verify-af-receipt-shows-skips.ts fails if a question id in the real registries is missing a noun,
// so a new question can never go silently unnamed here.
const SKIPPED_QUESTION: Record<string, string> = {
  property_group: 'مجموعة العقار 🏘️',
  property_type: 'نوع العقار 🏡',
  property_age: 'عمر العقار 🏗️',
  rnpl: 'التقسيط 💳',
  amenities: 'المميزات ✅',
  bathrooms: 'دورات المياه 🚿',
  furnished: 'الفرش 🛋️',
  street_width: 'عرض الشارع 🛣️',
  direction: 'الاتجاه 🧭',
  rating: 'التقييم ⭐',
  unit_subtype: 'نوع الوحدة 🏢',
};

export const skippedQuestionNoun = (id: string): string | undefined => SKIPPED_QUESTION[id];

// The questions this round ASKED and the user did not answer, in ask order. An id with no noun is
// dropped rather than printed raw — the barrier is what keeps that branch unreachable.
export function buildAfSkipped(ids: string[]): string {
  return joinAr([...new Set(ids.map((id) => SKIPPED_QUESTION[id]).filter(Boolean) as string[])]);
}
