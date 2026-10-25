// A DISTRICT READ FROM AN AD'S PIN IS LABELLED «تقريبي» (owner 2026-10-25, «finish Apple Maps»).
//
// The index serves a pin-derived district exactly like any other (search finds it), but it is a gap-filler, not the source's own
// word, so every card and the ad page must say so. The database answers "which of these listings are served a pin district?" through
// pin_district_approx_ar(source_tables, listing_ids). This file is the pure part (no react, no supabase) so a barrier can run it:
//   · who needs asking: only a listing whose OWN district field is blank but whose index district is set (a pin row is always that);
//   · what an answer means: in the set → approximate; not in the set → the source's own word; no answer at all (the lookup
//     failed or timed out) → we cannot tell, so the district is HIDDEN, never shown unlabelled.
// Display-only: matching still reads districtCanonical, so a failed lookup never changes which ads a search returns.

export type PinProbe = { key: string; table: string; id: number };
export type PinVerdict = 'approx' | 'source' | 'unknown';

export const pinKey = (table: string, id: number | string): string => `${table}:${Number(id)}`;

export function needsPinProbe(rawDistrict: string | null | undefined, indexDistrict: string | null | undefined): boolean {
  return !String(rawDistrict ?? '').trim() && !!String(indexDistrict ?? '').trim();
}

export function pinVerdict(key: string, answer: ReadonlySet<string> | null): PinVerdict {
  if (answer === null) return 'unknown';
  return answer.has(key) ? 'approx' : 'source';
}

/** Applies a verdict to a listing's DISPLAY fields. `districtCanonical` (the match field) is never touched. */
export function applyPinVerdict<T extends { district: string; districtApprox?: boolean }>(l: T, v: PinVerdict): T {
  if (v === 'approx') l.districtApprox = true;
  else if (v === 'unknown') { l.district = ''; l.districtApprox = false; }
  return l;
}

/** «حي X» + the label, in the language the card is drawn in. */
export function districtWithLabel(district: string, approx: boolean | undefined, label: string): string {
  return district && approx ? `${district} (${label})` : district;
}
