// ─────────────────────────────────────────────────────────────────────────────
// conversationState — canonical search state must SURVIVE a clarification turn.
//
// THE PRODUCTION BUG THIS EXISTS FOR (owner-reported 2026-08-29, reproduced live):
//   T1 «ابي شقة تقييم الشقة تكون 9.5 و فوق شهرية»  → Apartment · monthly · rating 9.5  ✅
//   T2 «الرياض»                                     → + الرياض, all three kept        ✅
//   T3 «عطني الإقليم»                               → kind="message", query GONE       ❌
// The agent asked one more clarifying question and every previously-understood field vanished:
// «شهرية» came back as RentAnnual and the 9.5 rating disappeared from the executed search entirely.
//
// ROOT CAUSE, and why patching the sentence would have been useless: queryFromBackend() rebuilt the
// query FRESH from the model's latest output on every turn. Only `price` had a carry-forward (added
// for a foreign-currency budget). Everything else — rent period, type, rating, bathrooms, age,
// street width, direction, amenities, furnished — existed only for as long as the model happened to
// re-state it. A clarification turn returns no query at all, so it reset the entire conversation.
//
// PERMANENT INVARIANT (owner): clarification may ADD or explicitly MODIFY state. It must NEVER
// silently reset unrelated already-understood filters.
//
// HOW: a field is carried forward when the new turn did not establish one. When the user really does
// change something, the model DOES re-state it (proven live: «لا خلها شهري» flips the period), so an
// explicit change always wins. Absence means "not mentioned this turn", never "cleared".
import type { SearchQuery } from '@/data/search';

/**
 * The canonical fields a conversation accumulates. Everything the user can establish in words and
 * would reasonably expect to still hold three turns later.
 *
 * NOT here on purpose: `sort`, `count` and `keywords` are per-utterance intents («ورني الأرخص»,
 * «ورني ٥») that describe THIS request, not a standing constraint, so they are deliberately not sticky.
 */
export const STICKY_FIELDS = [
  // normal filter
  'deal', 'bothDeals', 'rentPeriod', 'type', 'category', 'location', 'regionPin', 'districtPin',
  'districts', 'detail', 'contextSize', 'price', 'priceInput', 'priceIsAnnual', 'priceOriginal',
  'priceMin', 'priceMax', 'priceBand', 'areaMin', 'areaMax', 'sources',
  // advanced filter (the canonical AF question outputs)
  'amenities', 'furnishedPref', 'ratingMin', 'reviewsMin', 'bathMin', 'ageMin', 'ageMax',
  'isNewConstruction', 'streetWidthMin', 'directions', 'unitSubtypes',
] as const;

/** Has this turn actually established a value for the field? Empty string/array/null mean "no". */
function established(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'boolean') return true;   // false is a REAL value (furnishedPref, bothDeals)
  if (typeof v === 'number') return true;    // 0 is a real value
  return true;
}

/**
 * Merge the conversation's accumulated state under this turn's understanding.
 *
 * `next` always wins where it established something — an explicit change must never be overridden by
 * history. `prev` fills only the gaps. Returns a NEW object; neither input is mutated.
 */
export function mergeConversationState(
  prev: SearchQuery | null | undefined, next: SearchQuery,
): SearchQuery {
  if (!prev) return next;
  const out: Record<string, unknown> = { ...(next as unknown as Record<string, unknown>) };
  const p = prev as unknown as Record<string, unknown>;
  for (const key of STICKY_FIELDS) {
    if (!established(out[key]) && established(p[key])) out[key] = p[key];
  }
  return out as unknown as SearchQuery;
}

/**
 * Which sticky fields the merge had to rescue. Purely diagnostic — the barrier asserts on it, and it
 * makes a silent state loss visible instead of invisible.
 */
export function rescuedFields(prev: SearchQuery | null | undefined, next: SearchQuery): string[] {
  if (!prev) return [];
  const n = next as unknown as Record<string, unknown>;
  const p = prev as unknown as Record<string, unknown>;
  return STICKY_FIELDS.filter((k) => !established(n[k]) && established(p[k]));
}

/**
 * A compact, human-readable summary of what the conversation has ALREADY established — sent to the
 * model each turn so it can see its own accumulated state.
 *
 * WHY THIS EXISTS (owner ruling 2026-08-29). The edge function received only the raw text and the
 * chat history; it never received the canonical query. So the model had to re-derive everything from
 * conversation prose every turn and had no reliable way to know what it already knew — which is
 * exactly how it ends up asking a question whose answer is already in the search state. The owner's
 * principle: "The agent must be aware of what it already knows. It should never ask a question whose
 * answer already exists in the conversation or current search state."
 *
 * This is a MIRROR of state, never a source of it. The model may not edit it; it exists so the model
 * can stop asking. Every value here was already established deterministically by the client.
 */
export function describeKnownState(q: SearchQuery | null | undefined): string {
  if (!q) return '';
  const s = q as unknown as Record<string, unknown>;
  const bits: string[] = [];
  const push = (label: string, v: unknown) => { if (established(v)) bits.push(`${label}=${Array.isArray(v) ? v.join('/') : String(v)}`); };
  push('deal', s.bothDeals ? 'Buy+Rent' : s.deal);
  push('rentPeriod', s.rentPeriod);
  push('propertyType', s.type);
  push('location', s.location);
  push('region', s.regionPin);
  push('district', s.districtPin);
  push('bedroomsOrSize', s.detail);
  // The budget is stored annualized for rent; say so, or the model will read 72000 as a monthly figure.
  if (established(s.price)) bits.push(`budget=${String(s.price)}${s.priceIsAnnual ? ' (annual-equivalent)' : ''}`);
  push('furnished', s.furnishedPref);
  push('amenities', s.amenities);
  push('ratingMin', s.ratingMin);
  push('reviewsMin', s.reviewsMin);
  push('bathroomsMin', s.bathMin);
  push('ageMin', s.ageMin);
  push('ageMax', s.ageMax);
  push('newConstruction', s.isNewConstruction);
  push('streetWidthMin', s.streetWidthMin);
  push('direction', s.directions);
  push('unitSubtype', s.unitSubtypes);
  push('platforms', s.sources);
  return bits.join(', ');
}
