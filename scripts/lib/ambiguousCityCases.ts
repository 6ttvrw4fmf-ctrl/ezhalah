// AMBIGUOUS-CITY CASES ARE DISCOVERED FROM LIVE ROWS, NEVER HARDCODED (2026-11-03).
//
// scripts/verify-region-scoped-city-live.ts pins "a region+city selection returns exactly that
// combination" on Saudi place names that really repeat across regions. It used to hardcode six
// (name, region) pairs measured on 2026-08-26. On 2026-10-26 the catalog cleanup retired three of
// those minority cities as duplicates of the majority one (القويعية/المدينة 0.3 km from القويعية/
// الرياض, البدائع/حائل 7.7 km from البدائع/القصيم, بيش/عسير 0.1 km from بيش/جازان) — the ambiguity was
// a duplicate row, not a second town. The listings moved with it, the three cases went empty, and
// the scheduled check failed every run from 2026-10-30 on while the RPC was behaving perfectly.
//
// So the cases are now DERIVED: for each candidate name, the unscoped search's own rows say which
// regions really hold it today, and every region holding at least one row becomes a case. A
// retirement simply drops a name; the check fails only when too few genuinely ambiguous names
// remain to prove anything — the honest version of "the corpus went empty".

export const REGION_ID_BY_AR: Record<string, number> = {
  'منطقة الرياض': 1, 'منطقة مكة المكرمة': 2, 'منطقة المدينة المنورة': 3, 'منطقة القصيم': 4,
  'المنطقة الشرقية': 5, 'منطقة عسير': 6, 'منطقة تبوك': 7, 'منطقة حائل': 8,
  'منطقة الحدود الشمالية': 9, 'منطقة جازان': 10, 'منطقة نجران': 11, 'منطقة الباحة': 12, 'منطقة الجوف': 13,
};

// Names measured on 2026-11-03 to hold live listings in more than one region, plus the original
// three (kept: should a second town reappear, they are exercised again with no edit).
export const CANDIDATE_CITY_NAMES = [
  'الشيحية', 'الذيبية', 'العيينة', 'الشقيق', 'الجفر', 'القيصومة', 'الرفيعة', 'الطوال', 'القرين',
  'القويعية', 'البدائع', 'بيش',
];

/** The fewest genuinely ambiguous names a run may stand on before it says it proves nothing. */
export const MIN_AMBIGUOUS_NAMES = 3;

export type Case = { city: string; regionId: number; regionAr: string; label: string };
export type Discovery = { cases: Case[]; ambiguousNames: string[]; problems: string[] };

/**
 * `unscopedRows[name]` = the rows location_search_candidates_ar returned for that name with NO
 * region selected (null = the call failed). A failed call is a PROBLEM, never "not ambiguous".
 */
export function discoverAmbiguousCityCases(
  unscopedRows: Record<string, Array<{ city_ar?: string | null; region_ar?: string | null }> | null>,
  min = MIN_AMBIGUOUS_NAMES,
): Discovery {
  const cases: Case[] = [];
  const ambiguousNames: string[] = [];
  const problems: string[] = [];
  for (const [name, rows] of Object.entries(unscopedRows)) {
    if (rows === null) { problems.push(`${name}: the unscoped search failed — a failed fetch is not an empty answer`); continue; }
    const regions = new Set<string>();
    for (const r of rows) {
      if (r.city_ar !== name || !r.region_ar) continue;
      if (!(r.region_ar in REGION_ID_BY_AR)) { problems.push(`${name}: unknown region «${r.region_ar}»`); continue; }
      regions.add(r.region_ar);
    }
    if (regions.size < 2) continue;
    ambiguousNames.push(name);
    for (const regionAr of [...regions].sort()) {
      cases.push({ city: name, regionId: REGION_ID_BY_AR[regionAr], regionAr, label: `${name}@${REGION_ID_BY_AR[regionAr]}` });
    }
  }
  if (ambiguousNames.length < min) {
    problems.push(`only ${ambiguousNames.length} candidate name(s) hold listings in 2+ regions (need ${min}) — add live ambiguous names to CANDIDATE_CITY_NAMES`);
  }
  return { cases, ambiguousNames, problems };
}
