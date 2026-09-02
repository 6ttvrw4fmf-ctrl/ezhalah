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
  // NOTE (round-2 fix, 2026-08-31): 'price' was removed here — SearchQuery (src/data/search.ts) has
  // no such field (never did, post the priceInput/priceMin/priceMax/priceBand refactor) and no code
  // anywhere in the app reads or writes `.price` on a SearchQuery, so this entry was a silent no-op:
  // `established(out['price'])` and `established(p['price'])` were always both false, the loop
  // iteration never rescued anything. Found alongside the identical field-name bug in
  // supabase/functions/agent/index.ts's establishedState construction (both read a `.price`/`.af`
  // shape that only ever existed on the edge's OWN wire format, never on this type). The real budget
  // fields — priceInput/priceMin/priceMax/priceBand — are already listed below and unaffected.
  'deal', 'bothDeals', 'rentPeriod', 'type', 'category', 'location', 'regionPin', 'districtPin',
  'districts', 'detail', 'contextSize', 'priceInput', 'priceIsAnnual', 'priceOriginal',
  'priceMin', 'priceMax', 'priceBand', 'areaMin', 'areaMax', 'sources',
  // advanced filter (the canonical AF question outputs)
  'amenities', 'furnishedPref', 'ratingMin', 'reviewsMin', 'bathMin', 'ageMin', 'ageMax',
  'isNewConstruction', 'streetWidthMin', 'directions', 'unitSubtypes',
] as const;

/**
 * Fields whose EMPTY state is a non-empty default, so `established()` alone cannot tell "the user
 * said this" from "nobody said anything".
 *
 * THE BUG THIS EXISTS FOR (found 2026-08-30 by executing the real merge, not by reading it):
 *   T1 «ابغى شقة شهرية في الرياض تقييمها ٩.٥»  → monthly · Apartment · ratingMin 9.5   ✅
 *   T2 anything that does not restate the period → emptyQuery() supplies rentPeriod:'annual',
 *      which is a non-empty string, so established() said TRUE and the carry-forward never fired.
 *   Result: the period silently flipped monthly → ANNUAL while ratingMin 9.5 — a Gathern
 *   MONTHLY-ONLY signal — was faithfully carried into it. The executed search then matched almost
 *   nothing, and the reply said «سنوي». Both halves looked individually reasonable; together they
 *   were a query the user never asked for.
 *
 * So for these fields the merge needs the caller to say what the turn EXPLICITLY stated. Absence of
 * a statement is "not mentioned", never "reset to the default".
 *
 * furnishedPref is deliberately NOT here: it is only ever set when the user states it, so its
 * `false` is a real answer ("unfurnished"), not a default.
 */
export const DEFAULTED_FIELDS = ['deal', 'rentPeriod', 'category', 'bothDeals', 'priceIsAnnual'] as const;

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
  /**
   * The keys this turn EXPLICITLY stated. Required to carry a defaulted field (see
   * DEFAULTED_FIELDS) correctly — without it a default is indistinguishable from an answer.
   * Omitted (legacy callers): defaulted fields fall back to the value-shape test, which is the
   * pre-2026-08-30 behaviour.
   */
  stated?: Iterable<string>,
): SearchQuery {
  if (!prev) return next;
  const said = stated ? new Set(stated) : null;
  const out: Record<string, unknown> = { ...(next as unknown as Record<string, unknown>) };
  const p = prev as unknown as Record<string, unknown>;
  const defaulted = new Set<string>(DEFAULTED_FIELDS as readonly string[]);
  for (const key of STICKY_FIELDS) {
    // A defaulted field counts as established ONLY if this turn actually said it.
    const establishedNow = said && defaulted.has(key) ? said.has(key) : established(out[key]);
    if (!establishedNow && established(p[key])) out[key] = p[key];
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
  //
  // `s.price` DOES NOT EXIST on SearchQuery and never did — `price` is a field of the edge's wire type
  // BackendQuery, which agent.ts maps into q.priceInput. So this line read undefined every time and the
  // budget was silently absent from the state we hand the model, which is how an established budget
  // gets asked for twice. The same class as the STICKY_FIELDS bug documented at the top of this file,
  // and it survived because the barrier's fixture invented a `price` member with an `as never` cast.
  // A priceBand is already a complete human phrase ("SAR 75k–150k"), so the annual note is never
  // appended to it — same reason priceCalcNote() returns early for a band.
  const budget = established(s.priceBand) ? String(s.priceBand)
    : established(s.priceInput) ? String(s.priceInput) : null;
  if (budget) bits.push(`budget=${budget}${!s.priceBand && s.priceIsAnnual ? ' (annual-equivalent)' : ''}`);
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
