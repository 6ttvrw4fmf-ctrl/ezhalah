// The ONE rule both the hermetic check and its live sibling judge a district_options_ar response
// by. A copy in each file would prove nothing about the code that decides the live half's verdict
// — the exact drift class recorded in scripts/lib/liveHalf.ts's own header comment.
//
// Owner report, 2026-09-11: the Riyadh Advanced Filter district dropdown showed entries like
// "الخبر الحمراء 3537" / "حي الدكاترة 3420" — raw internal plot numbers, never meant to be
// user-facing. Root cause: public.refresh_loc_canonical_district()'s 'live' fallback branch
// promoted unrecognized scraped district_ar text verbatim. Fixed by public.district_ar_looks_bogus()
// (migration 20260911201716).
//
// ── CONTRACT CHANGE, owner decision 2026-09-14 — READ THIS BEFORE "FIXING" A FAILURE HERE ────────
// This file used to assert the OPPOSITE of what it asserts now, and that inversion is deliberate.
// It carried EXPECTED_DISTINCT = ['المحمدية 1','المحمدية 2','المحمدية 3',…] with the warning that
// merging them would be wrong — and that assertion is what (correctly) caused migration
// 20260913200718 to be reverted by 20260913201221, which closed with: «The owner's rule ("our own
// list must never show a number") and this invariant ("these numbered districts are real and must
// stay selectable") cannot both hold for جازان. That is an owner decision.»
//
// The owner made it, verbatim: «in our district catalog, make sure there are no numbers. I know
// maybe they write numbers in the neighborhood, but in our district, we don't include numbers. We
// just match it with ours, and then in their property card, if they kept a number, we include that
// number.» So: our list shows «المحمدية»; picking it returns the listings of المحمدية 1/2/3 as well;
// the card still reads «المحمدية 2» (cards render the platform's raw `neighborhood` column — nothing
// in src/ reads search_listings_ar). Migration 20260914204035 folds a number at either end inside
// norm_district_tok(), the one shared token function.
//
// THE POSITIVE ASSERTION STILL MATTERS MOST — it has simply moved. The danger is no longer "a real
// numbered district disappeared"; it is "the fold DELETED instead of MERGING", which would strand
// those listings exactly as the reverted migration did. So the control below asserts the folded name
// is present AND carries the COMBINED count of everything that folded onto it.

export type DistrictRow = { district_ar: string; listing_count: number };

// Any digit at all is now a breach of the owner's rule — not just the 3+ run that marked a plot
// code. «مخطط» stays: a subdivision-plan reference is an internal code with or without its number.
export const LOOKS_LIKE_INTERNAL_CODE = /مخطط|[0-9٠-٩]/;

// The four exact strings the owner reported in 2026-09-11 — proof by NAME, not just by shape.
export const REPORTED_STRINGS = ['الخبر الحمراء 3537', 'الخبر الحمراء 3541', 'حي الدكاترة 3420', 'حي الدكاترة 3422'];

// جازان's المحمدية is the flagship fold: four picker rows on 2026-09-14 — «المحمدية 2» (160),
// «المحمدية 1» (30), bare «المحمدية» (28), «المحمدية 3» (22) — became one row of 240. The floor is
// set above the largest single pre-fold member (160) on purpose: no arrangement in which the merge
// silently dropped a member can reach it, so this number is what separates a fold from a deletion.
export const FOLDED_CONTROL = {
  city: 'جازان',
  name: 'المحمدية',
  absorbed: ['المحمدية 1', 'المحمدية 2', 'المحمدية 3'],
  minCount: 200,
};

/** Every way a live district_options_ar response can fail this barrier's rules. */
export function auditDistrictOptions(riyadh: DistrictRow[], jazan: DistrictRow[]): string[] {
  const bad: string[] = [];
  if (riyadh.length === 0) bad.push('Riyadh returned zero districts');
  bad.push(...auditNoBogusEntries('الرياض (Riyadh)', riyadh));
  const riyadhNames = new Set(riyadh.map((r) => r.district_ar));
  for (const reported of REPORTED_STRINGS) {
    if (riyadhNames.has(reported)) bad.push(`the exact reported string "${reported}" is still in the Riyadh dropdown`);
  }

  // The fold control — a FAILED fetch is not an empty answer, so an empty جازان is a failure too.
  if (jazan.length === 0) {
    bad.push('جازان returned zero districts');
    return bad;
  }
  bad.push(...auditNoBogusEntries(FOLDED_CONTROL.city, jazan));
  const folded = jazan.find((r) => r.district_ar === FOLDED_CONTROL.name);
  if (!folded) {
    bad.push(`the folded district "${FOLDED_CONTROL.name}" is missing from ${FOLDED_CONTROL.city} — `
      + 'the numbered siblings were DELETED, not merged (see migration 20260913201221)');
  } else if (folded.listing_count < FOLDED_CONTROL.minCount) {
    bad.push(`"${FOLDED_CONTROL.name}" holds only ${folded.listing_count} listings, below the `
      + `${FOLDED_CONTROL.minCount} floor — its numbered siblings did not fold onto it, their listings are stranded`);
  }
  const jazanNames = new Set(jazan.map((r) => r.district_ar));
  for (const absorbed of FOLDED_CONTROL.absorbed) {
    if (jazanNames.has(absorbed)) bad.push(`"${absorbed}" is still its own picker row — the number fold stopped folding`);
  }
  return bad;
}

// Cities with confirmed pollution history BEFORE the 2026-09-11 fix (every digit-containing
// source='live' row across the whole database — not a sample). The standing detector
// (mon_detect_district_catalog_pollution, migration 20260911211255) owns exhaustive, continuous
// coverage of the underlying TABLE for all 297 cities that carry any live-source district; this list
// is deliberately smaller — it exists to additionally prove the PUBLIC RPC PATH itself
// (district_options_ar, not just loc_canonical_district) stays clean for the cities that actually
// had a documented history of leaking, on a schedule independent of the detector's own sweep.
export const HISTORICALLY_POLLUTED_CITIES: { id: number; label: string }[] = [
  { id: 3, label: 'الرياض (Riyadh)' },
  { id: 15, label: 'أبها (Abha)' },
  { id: 3677, label: 'الاحساء (Al-Ahsa)' },
  { id: 1542, label: 'الباحة (Al-Bahah)' },
  { id: 18, label: 'جدة (Jeddah)' },
];

/** Every internal-code-shaped entry visible for ONE city's district list. Simple, reusable per-city
 *  half of the same rule auditDistrictOptions applies to Riyadh specifically. */
export function auditNoBogusEntries(cityLabel: string, rows: DistrictRow[]): string[] {
  const codes = rows.filter((r) => LOOKS_LIKE_INTERNAL_CODE.test(r.district_ar));
  return codes.length
    ? [`${cityLabel}: internal-code-shaped district(s) visible: ${codes.map((r) => r.district_ar).join(', ')}`]
    : [];
}
