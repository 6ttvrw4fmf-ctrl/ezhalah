// AF emoji summary sentences (owner 2026-08-22). PURE — zero runtime deps.
// Each selected Advanced Filter attribute → emoji + Arabic label.
//
// TWO SENTENCES, TWO AUDIENCES — do not merge them.
//
//   buildAfSummary(facets)  → what the filter IS. Committed answers only. This is the sentence the
//     results PILLS carry, so it is a claim about the live predicate: a skipped question appearing
//     here would name a filter that is not applied (permanent rule, owner 2026-08-22).
//
//   buildAfRoundLog(ids, facets) → what the ROUND did, step by step, IN ASK ORDER. Added
//     2026-09-20 on the owner's ask ("you asked about apartment and then age, and he decided to
//     skip, then he chose الواجهة ... you say: user decided to skip"). It feeds the completed-round
//     RECEIPT, which is a record of the interview, not a description of the predicate — which is
//     exactly why naming a skip there breaks nothing: the receipt never claims to filter anything.
//     The permanent rule above is untouched and still governs buildAfSummary.
//
// ONE LIST, NOT TWO PILES. The first version of this card split the round into «اخترت: ...» and
// «تخطيت: ...» on separate lines. The owner replaced it with a single ask-ordered line the same
// day: read straight through, it tells the story of the interview — picked, skipped, picked — which
// two sorted piles cannot. A skip therefore has to be legible WHERE IT HAPPENED, mid-sentence, and
// that is why it carries ⏭️ rather than the question's own emoji: «عمر العقار 🏗️» sitting between
// two real answers reads as a third answer. «تخطى عمر العقار ⏭️» cannot be mistaken for one.

const AMENITY_EMOJI: Record<string, string> = {
  kitchen: '🍳', parking: '🅿️', elevator: '🛗', ac: '❄️',
  private_entrance: '🚪', maid_room: '🧹', driver_room: '🚘',
  car_entrance: '🚗', sanitation: '🚰', furnished: '🛋️',
  electricity: '⚡', water_supply: '💧',
};

export type AfFacet = { id: string; keys: string[]; labels: string[] };

// ONE committed facet → its finished, reader-facing item(s). Shared by the summary and the round
// log, so an answer is worded identically wherever it appears; a multi-select facet explodes into
// one item per key.
function facetItems(f: AfFacet): string[] {
  const items: string[] = [];
  {
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
  return items;
}

export function buildAfSummary(facets: AfFacet[]): string {
  return joinAr([...new Set(facets.flatMap(facetItems))]);
}

// «،» between, «، و» before the last — the one Arabic list joiner both sentences share, so the
// receipt's two lines can never drift into different punctuation. Every item ends in its emoji and
// the separator follows it: comma AFTER the emoji, never before (owner, universal).
const joinAr = (items: string[]): string =>
  items.length === 0 ? ''
    : items.length === 1 ? items[0]
      : items.slice(0, -1).join('، ') + '، و' + items[items.length - 1];

// Every question the interview can ASK, as the short noun the round log names it by — «عمر العقار»,
// not the question sentence «كم عمر العقار تقريباً؟». NOUN ONLY, no per-question emoji: a skipped
// question is marked as a SKIP (⏭️ below), never dressed as an answer.
//
// The two SCOPE tiers are here too. They show no Skip button, but «متابعة» with nothing ticked
// leaves them uncommitted, which is a skip in everything but name.
//
// verify-af-receipt-shows-skips.ts executes this map against the ids scanned out of the real
// question registries, so a question added later can never go silently unnamed here.
const SKIPPED_QUESTION: Record<string, string> = {
  property_group: 'مجموعة العقار',
  property_type: 'نوع العقار',
  property_age: 'عمر العقار',
  rnpl: 'التقسيط',
  amenities: 'المميزات',
  bathrooms: 'دورات المياه',
  furnished: 'الفرش',
  street_width: 'عرض الشارع',
  direction: 'الاتجاه',
  rating: 'التقييم',
  unit_subtype: 'نوع الوحدة',
};

export const skippedQuestionNoun = (id: string): string | undefined => SKIPPED_QUESTION[id];

// ⏭️, not the question's own emoji — see ONE LIST, NOT TWO PILES in the header.
const SKIP_MARK = '⏭️';
const skipItem = (id: string): string | null => {
  const noun = SKIPPED_QUESTION[id];
  return noun ? `تخطى ${noun} ${SKIP_MARK}` : null;
};

// THE ROUND, IN THE ORDER IT HAPPENED. `askedIds` is the ask order; a question with a committed
// facet prints its answer, one without prints as a skip, and the reader gets the interview back as
// a story rather than as two sorted piles.
//
// The trailing loop is not decoration: it guarantees that a committed facet whose question is
// somehow absent from `askedIds` is still named. Rule 1 of the permanent summary rule — a facet in
// the predicate MUST appear — is the half that must never fail quiet, so ordering yields to it.
export function buildAfRoundLog(askedIds: string[], facets: AfFacet[]): string {
  const byId = new Map(facets.map((f) => [f.id, f]));
  const items: string[] = [];
  for (const id of askedIds) {
    const f = byId.get(id);
    if (f) items.push(...facetItems(f));
    else { const sk = skipItem(id); if (sk) items.push(sk); }
  }
  for (const f of facets) if (!askedIds.includes(f.id)) items.push(...facetItems(f));
  return joinAr([...new Set(items)]);
}
