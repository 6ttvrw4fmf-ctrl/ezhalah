// "Only ask the city if there is something [to find]" (owner, 2026-09-11).
//
// Before showing THE location question (decide.ts's noPlaceReply/ambiguityReply, surfaced to the
// client as turn.locationQuestion — see supabase/functions/agent/index.ts), the client quietly
// checks whether the OTHER stated requirements (type/amenities/price/af/...) match anything AT
// ALL, anywhere — reusing the exact same match-first RPC a real search would hit (via
// fetchListingsForQuery in src/data/remote.ts), just with every location field stripped so the
// scope resolves nationwide instead of "no location, ask". If genuinely nothing matches, there is
// nothing to search for once we learn the city, so the question is skipped and Ezhalah says so
// honestly instead (the same zero-match message used after a real search finds nothing).
//
// Deliberately zero-dependency (same shape as src/lib/arabicText.ts / regionOrCityAnswer.ts) so
// scripts/verify-agent-location-probe.ts can import and execute it from plain Node — src/data/
// search.ts and src/data/remote.ts transitively pull react-native/supabase-js and cannot be
// loaded there.

// Minimal structural shape — only the fields this file touches. The real SearchQuery
// (src/data/search.ts) carries many more; TypeScript only needs a structural match here.
export type LocationProbeQuery = {
  location: string;
  locationMatch?: unknown;
  districts?: unknown;
  regionPin?: unknown;
  [key: string]: unknown;
};

// Strips every location-identifying field so resolveSearchScope() (src/data/remote.ts) treats the
// query as "no location given at all" → p_cities: null → genuinely nationwide, instead of "a
// location was named but didn't resolve" → an honest zero for the WRONG reason (see
// resolveSearchScope's `(q.location || '').trim()` guard, which only fires on non-empty text).
export function buildLocationProbeQuery<Q extends LocationProbeQuery>(query: Q): Q {
  return { ...query, location: '', locationMatch: undefined, districts: undefined, regionPin: undefined };
}

// probeListings is fetchListingsForQuery()'s own `listings` field, verbatim: `null` means the
// fetch itself failed or timed out (A FAILED FETCH IS NOT AN EMPTY ANSWER — never claim "nothing
// matches" on our own network hiccup), `[]` means a genuine, confirmed zero, anything else means
// real inventory exists somewhere. Only the genuine-zero case swaps the reply; a failed probe or a
// real match falls back to asking the location question exactly as before.
export function replyAfterLocationProbe(
  askedQuestion: string,
  zeroMatchMessage: string,
  probeListings: unknown[] | null,
): string {
  if (probeListings && probeListings.length === 0) return zeroMatchMessage;
  return askedQuestion;
}
