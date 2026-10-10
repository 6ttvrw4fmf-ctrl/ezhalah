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

export type CatalogCity = { cityId: number; cityAr: string; regionId: number | null; regionAr: string | null; cityEn?: string };
export type CatalogDistrict = { cityId: number; districtAr: string; districtEn?: string };

// ENGLISH TYPING (owner 2026-10-09: «the user can select the city he wants in English. The district, everything is
// in English»). In the English UI a query in Latin letters is matched against the place's ENGLISH name. English
// spellings of one place vary («Al Khobar» / «Khobar», «An Narjis» / «Al Narjis», «Buraidah» / «Buraydah»), so the
// query and the name fold the same way: lower-case, letters and digits only, a leading article dropped; a looser
// third rank also drops vowels. A few well-known names people type differently from the official one are aliases.
export const isLatinQuery = (s: string) => /[A-Za-z]/.test(s) && !/[\u0600-\u06FF]/.test(s);
export const latinKey = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^(?:al|an|ar|as|at|ad|az|ash|adh|ath|el)[\s\-'‘’]+/, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
const skeleton = (k: string) => (k ? k[0] + k.slice(1).replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1').replace(/h$/, '') : '');
const EN_ALIASES: Record<string, string> = {
  mecca: 'Makkah', makka: 'Makkah', medina: 'Madinah', madina: 'Madinah', jiddah: 'Jeddah', jedda: 'Jeddah',
  hofuf: 'Al Hafuf', alhasa: 'Al Ahsa', ahsa: 'Al Ahsa', hasa: 'Al Ahsa', taif: 'At Taif', khobar: 'Al Khobar',
};
/** 0 = the name starts with the query, 1 = contains it, 2 = loose (vowels dropped), null = no match. */
export function latinRank(query: string, nameEn: string | undefined): number | null {
  const q = latinKey(query);
  if (!q || !nameEn) return null;
  const names = [nameEn, ...Object.entries(EN_ALIASES).filter(([a, to]) => to === nameEn && a.startsWith(q)).map(([a]) => a)];
  let best: number | null = null;
  for (const name of names) {
    const n = latinKey(name);
    const full = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const sq = skeleton(q);
    const r = n.startsWith(q) || full.startsWith(q) ? 0 : n.includes(q) || full.includes(q) ? 1
      : sq.length >= 3 && skeleton(n).startsWith(sq) ? 2 : null;
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

/** Prefix matches first, then substring matches, each group in catalog order. Empty query → []. A Latin query
 *  ranks by the English name instead (`nameEnOf`), when the caller has one. */
function rankedByName<T>(items: readonly T[], query: string, nameOf: (t: T) => string, nameEnOf?: (t: T) => string | undefined): T[] {
  if (nameEnOf && isLatinQuery(query)) {
    const ranked: T[][] = [[], [], []];
    for (const it of items) { const r = latinRank(query, nameEnOf(it)); if (r !== null) ranked[r].push(it); }
    return ranked.flat();
  }
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
export function catalogCityExtras(query: string, catalog: readonly CatalogCity[], haveIds: ReadonlySet<number>, limit = 30, skipNames: ReadonlySet<string> = new Set()): CatalogCity[] {
  // skipNames = folded names that two or more real cities share. While NO pool of any scope is cached the catalog cannot
  // tell which of them has listings, and rows that re-order under the user's finger when the pool arrives are worse
  // than a one-second wait, so those names are held back until the pool (which ranks the real one first) is there.
  return rankedByName(catalog, query, (c) => c.cityAr, (c) => c.cityEn).filter((c) => !haveIds.has(c.cityId) && !skipNames.has(norm(c.cityAr))).slice(0, limit);
}

/** Catalog districts of ONE city matching the query that the pool does not already carry (by folded name). */
export function catalogDistrictExtras(query: string, catalog: readonly CatalogDistrict[], cityId: number, haveNorms: ReadonlySet<string>, limit = 30): CatalogDistrict[] {
  return rankedByName(catalog.filter((d) => d.cityId === cityId), query, (d) => d.districtAr, (d) => d.districtEn)
    .filter((d) => !haveNorms.has(norm(d.districtAr)))
    .slice(0, limit);
}
