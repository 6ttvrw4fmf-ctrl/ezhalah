// Pure, zero-dependency rule for ONE question: does a نوع=غرفة (Room) selection turn the filter's
// «غرف النوم» control into a real bedrooms predicate?
//
// Answer: NO — and that is a bug fix, not a relaxation of the owner's rule.
//
// THE DEFECT (Search & Matching QA, found by hand 2026-08-14 and again 2026-08-17)
// Picking نوع=غرفة auto-selects «1 غرفة نوم» on the user's behalf (src/app/index.tsx, owner rule
// 2026-07-06: "a room is a single room"), and the bedroom chip row COLLAPSES to just "1" — so the
// user cannot express any other bedroom intent there. That "1" is a label describing the type, not
// a choice the user made.
//
// It was nevertheless translated into a strict predicate (p_beds_exact=[1] server-side, l.beds === 1
// client-side). Bedrooms is deliberately strict — unknown counts are excluded, which is right for a
// count the user actually chose. Applied to a count nobody chose, it silently deleted every غرفة row
// whose SOURCE never published a bedroom number:
//
//   nationwide, production_ready, type_ar='غرفة':  2,406 rooms exist
//                                    reachable:      475   (bedrooms = 1)
//                                    unreachable:  1,888   (bedrooms unrecorded)  ← deleted by a filter nobody chose
//                                                     43   (source published a different count)
//   الرياض/إيجار/سنوي:  the app's own trending panel promised 1,172 while the search returned 1.
//
// So the product contradicted itself on a single screen, and 1,931 of 2,406 rooms were unreachable
// through the Normal Filter — a MATCH failure (§3: "no correctly-matching listing lost to
// Ezhalah-side search logic"), which outranks everything else in this product's priority order.
//
// WHAT DOES *NOT* CHANGE
//   • The owner's 2026-07-06 rule stands: غرفة still means a single room, and the chip still shows 1.
//   • Bedrooms stays STRICT everywhere the user actually picks a count (شقة + «3», فيلا + «4», …) —
//     an unknown-bedroom apartment must still never answer a 3-bedroom request.
//   • The AI-agent surface is untouched: an explicit `detail` (what the agent parses from a sentence)
//     still wins, so "غرفة بغرفتين" would still filter. Only the filter's AUTO-APPLIED lock is dropped.
//
// Kept dependency-free (mirrors src/lib/searchDefaults.ts and src/lib/arabicText.ts) so
// scripts/verify-room-bedrooms-not-a-predicate.ts can import and EXECUTE the real rule rather than
// grepping for its shape.

// The clean type id for «غرفة». Matches CLEAN_TO_QUERY['Room'] in src/data/propertyTypes.ts.
export const ROOM_CLEAN_TYPE = 'Room';

/**
 * True when the user's type selection is EXACTLY «غرفة» and nothing else — the only case in which
 * the filter collapses the bedroom chips to a single un-choosable "1".
 *
 * Deliberately requires a sole selection: غرفة + شقة together is a real multi-type search where the
 * bedroom control is fully available again, so a bedroom count there IS a user choice and must keep
 * filtering strictly.
 */
export function isRoomOnlySelection(types: readonly string[] | null | undefined): boolean {
  return !!types && types.length === 1 && types[0] === ROOM_CLEAN_TYPE;
}

const BEDROOM_TOKEN = /^([1-4]|5\+?)$/;

/**
 * THE bedroom-token rule, in one pure place. src/data/search.ts's `bedroomTokens(q)` is a thin
 * adapter over this, and it is the single source feeding BOTH the server param (p_beds_exact /
 * p_beds_min in src/data/remote.ts) and the client predicate (bedroomFilter) — so whatever this
 * returns is exactly what the user's search filters on, on both sides.
 *
 * Pure and import-free on purpose: `node --experimental-strip-types` cannot load src/data/search.ts
 * (its graph reaches i18n.tsx, and .tsx is unsupported), so keeping the rule here is what lets
 * scripts/verify-room-bedrooms-not-a-predicate.ts execute the REAL logic instead of grepping for it
 * — the same reasoning as src/lib/searchDefaults.ts.
 *
 * @param type                 the single selected clean type, when the query uses the single-select
 *                             field (agent / type-level chip); null on the filter's multi-select path
 * @param detail               the shared free-form detail field (agent-parsed or type-level chip)
 * @param types                the effective clean-type selection (multi-select aware)
 * @param beds                 the filter's category/group bedroom chips (multi-select aware)
 * @param typeDetailIsBedrooms whether `detail` means bedrooms for `type` (false when `type` is null);
 *                             computed by the caller via detailFor() so this module stays dependency-free
 */
export function bedroomTokensPure(input: {
  type?: string | null;
  detail?: string | null;
  types?: readonly string[] | null;
  beds?: readonly string[] | null;
  typeDetailIsBedrooms?: boolean;
}): string[] {
  const { type, detail, types, beds, typeDetailIsBedrooms } = input;
  if (!type) {
    const fb = (beds ?? []).map((d) => (d || '').trim()).filter((d) => BEDROOM_TOKEN.test(d));
    // غرفة alone: the auto-selected "1" is a label describing the type, not a choice — so it is the
    // ONLY case where the filter's bedroom chips are ignored. Skipping (rather than returning early)
    // deliberately lets an explicit `detail` below still win, so the AI-agent surface is untouched.
    if (fb.length && !isRoomOnlySelection(types)) return fb;
  }
  if (detail) {
    const d = detail.trim();
    if (BEDROOM_TOKEN.test(d) && (!type || !!typeDetailIsBedrooms)) return [d];
  }
  return [];
}
