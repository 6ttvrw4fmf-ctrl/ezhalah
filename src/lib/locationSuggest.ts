// PURE place-suggestion helpers (owner, 2026-10-03: «users should always have the right to search the city and
// district they're looking for, no matter what … he types what he's looking for, and then a number pops up»).
//
// The city and district pickers used to match ONLY against pools fetched from the database for the user's
// exact scope (deal × category × period × types × Advanced Filter). Two consequences, both measured:
//   • a place with no listings in the scope was not in the pool, so it could not be typed at all;
//   • the moment any filter changed the pool for the new scope had to load first, so typing showed nothing
//     (or «Loading…») for as long as the RPC took — «the user can run away».
// The built-in catalog (sa-locations.json: every city and district, in memory) answers instantly. These
// functions add its entries to whatever the scoped pool already has; the pool keeps its ranking and its counts,
// the catalog only ADDS places the pool does not carry, flagged so the UI never prints a number or a «nothing
// here» claim it has not measured. Pure and dependency-free so a barrier can execute them (no imports).
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/ء/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    // Number fold, EITHER END — mirrors norm_district_tok (migration 20260914204035, owner
    // 2026-09-14: «in our district catalog… we don't include numbers. We just match it with ours»).
    // Our picker now offers «المحمدية» for المحمدية 1/2/3, so a user who types the «المحمدية 2» they
    // read off a card — in the picker box or to the agent — must still land on it. Separators are
    // already gone by this line, so the DB's space-separated number is a digit run here. Leading
    // matters: «1النرجس» is real production data (city 67, 9 listings).
    .replace(/^[0-9]+/, '')
    .replace(/[0-9]+$/, '');

export type CatalogCity = { cityId: number; cityAr: string; regionId: number | null; regionAr: string | null };
export type CatalogDistrict = { cityId: number; districtAr: string };

/** Prefix matches first, then substring matches, each group in catalog order. Empty query → []. */
function rankedByName<T>(items: readonly T[], query: string, nameOf: (t: T) => string): T[] {
  const q = norm(query);
  if (!q) return [];
  const prefix: T[] = [];
  const inside: T[] = [];
  for (const it of items) {
    const n = norm(nameOf(it));
    if (n.startsWith(q)) prefix.push(it);
    else if (n.includes(q)) inside.push(it);
  }
  return [...prefix, ...inside];
}

/** Catalog cities matching what the user typed that the scoped pool does not already carry (by city id). */
export function catalogCityExtras(query: string, catalog: readonly CatalogCity[], haveIds: ReadonlySet<number>, limit = 30): CatalogCity[] {
  return rankedByName(catalog, query, (c) => c.cityAr).filter((c) => !haveIds.has(c.cityId)).slice(0, limit);
}

/** Catalog districts of ONE city matching the query that the pool does not already carry (by folded name). */
export function catalogDistrictExtras(query: string, catalog: readonly CatalogDistrict[], cityId: number, haveNorms: ReadonlySet<string>, limit = 30): CatalogDistrict[] {
  return rankedByName(catalog.filter((d) => d.cityId === cityId), query, (d) => d.districtAr)
    .filter((d) => !haveNorms.has(norm(d.districtAr)))
    .slice(0, limit);
}
