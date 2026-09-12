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
// THE POSITIVE ASSERTION IS THE ONE THAT MATTERS MOST. It would be trivial, and wrong, to "fix"
// this by stripping every digit from every district name — that silently merges genuinely
// different, officially-numbered places (جازان's المحمدية 1/2/3 are three distinct neighborhoods,
// not one saved three times). So the rule checks both directions.

export type DistrictRow = { district_ar: string; listing_count: number };

// The exact shape district_ar_looks_bogus() targets on the database side — mirrored here to judge
// the RPC's real output, never to re-implement what the database already decided.
export const LOOKS_LIKE_INTERNAL_CODE = /مخطط|[0-9]{3,}/;

// The four exact strings the owner reported — proof by NAME, not just by shape.
export const REPORTED_STRINGS = ['الخبر الحمراء 3537', 'الخبر الحمراء 3541', 'حي الدكاترة 3420', 'حي الدكاترة 3422'];
// A representative slice of Jazan's genuine, officially-numbered sub-districts — the positive
// control proving the fix did not over-correct.
export const EXPECTED_DISTINCT = ['المحمدية 1', 'المحمدية 2', 'المحمدية 3', 'الرحاب 1', 'الرحاب 2'];

/** Every way a live district_options_ar response can fail this barrier's two rules. */
export function auditDistrictOptions(riyadh: DistrictRow[], jazan: DistrictRow[]): string[] {
  const bad: string[] = [];
  if (riyadh.length === 0) bad.push('Riyadh returned zero districts');
  const codes = riyadh.filter((r) => LOOKS_LIKE_INTERNAL_CODE.test(r.district_ar));
  if (codes.length) bad.push(`internal-code-shaped district(s) visible: ${codes.map((r) => r.district_ar).join(', ')}`);
  const riyadhNames = new Set(riyadh.map((r) => r.district_ar));
  for (const reported of REPORTED_STRINGS) {
    if (riyadhNames.has(reported)) bad.push(`the exact reported string "${reported}" is still in the Riyadh dropdown`);
  }
  const jazanNames = new Set(jazan.map((r) => r.district_ar));
  for (const name of EXPECTED_DISTINCT) {
    if (!jazanNames.has(name)) bad.push(`genuine numbered district "${name}" is missing (over-correction?)`);
  }
  return bad;
}

// Cities with confirmed pollution history BEFORE the fix (2026-09-11 investigation, every
// digit-containing 'live' row across the whole database — not a sample). The standing detector
// (mon_detect_district_catalog_pollution, migration 20260911211255) now owns exhaustive, continuous
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
