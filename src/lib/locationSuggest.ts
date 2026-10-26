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

// THE CITY BOX OFFERS THE POPULATED DISTRICT, AND RANKS 0-SERVED HOMONYM CITIES BELOW IT (owner decision 2026-10-19,
// backlog 522/566). Two real users typed a DISTRICT name into the city box — «البديعة» (حي البديعة · الرياض, 100+ served
// ads) and «الراكة» (حي الراكة الجنوبية · الخبر, ~200) — and the picker offered only the catalog CITIES of the same
// name, each «لا توجد إعلانات هنا حالياً», so both searches answered 0 over listings that exist. The live location
// index (location_index_live: every served district with its city and count, all deals) knows which districts are
// populated, so a typed name that is the prefix of a served district adds a «حي X · City» row; tapping it selects the
// city AND that district. The rows sit after the cities that have listings in the scope (or an unmeasured count) and
// BEFORE the 0-served cities and the catalog extras. No count is shown for them (scopeKnown:false — the index counts
// every deal, the scope does not), so nothing is claimed that was not measured.
// `key` = stripHayy(norm(districtAr)), precomputed once by the caller so a keystroke never re-folds thousands of names.
export type LiveDistrictRow = { districtAr: string; cityId: number; n: number; matchValues?: string[]; key?: string };
export const stripHayy = (n: string) => n.replace(/^حي/, '');
export const liveDistrictKey = (districtAr: string) => stripHayy(norm(districtAr));
/** Served districts whose name (with «حي» dropped) starts with the query, most listings first; every raw spelling of
 *  one district (حي الراكة الجنوبية / الراكة الجنوبية) folds into ONE row that carries all of them in `matchValues`.
 *  A query under 3 letters, or a Latin one, adds nothing. */
export function populatedDistrictRows(query: string, rows: readonly LiveDistrictRow[], limit = 4): LiveDistrictRow[] {
  if (isLatinQuery(query)) return [];
  const q = stripHayy(norm(query));
  if (q.length < 3) return [];
  const groups = new Map<string, LiveDistrictRow & { top: number }>();
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (n <= 0) continue;
    const key = r.key ?? liveDistrictKey(r.districtAr);
    if (!key.startsWith(q)) continue;
    const g = groups.get(`${r.cityId}:${key}`);
    if (!g) groups.set(`${r.cityId}:${key}`, { districtAr: r.districtAr, cityId: r.cityId, n, matchValues: [r.districtAr], top: n });
    else {
      g.n += n;
      if (!g.matchValues!.includes(r.districtAr)) g.matchValues!.push(r.districtAr);
      if (n > g.top) { g.top = n; g.districtAr = r.districtAr; } // the most common spelling is the one shown
    }
  }
  return [...groups.values()].sort((a, b) => b.n - a.n).slice(0, limit).map(({ top: _t, ...r }) => r);
}
/** A typed CITY wins over the districts that merely start with its name (owner 2026-10-24: «مكة» offered «حي مكة · الجبيل»
 *  and address text like «مكة المكرمة السعودية» above nothing useful). The district rows exist for a name that is a
 *  district with listings and a city without (البديعة, الراكة); when a matching city carries at least as many listings
 *  as the biggest district row, the user is typing that city and the district rows are dropped. */
export function cityOutweighsDistricts(matchingCityCounts: readonly number[], districtRows: readonly { n: number }[]): boolean {
  if (!districtRows.length) return false;
  const city = Math.max(0, ...matchingCityCounts);
  return city > 0 && city >= Math.max(...districtRows.map((r) => r.n));
}
/** Order of the city box: pool cities with listings (or an unmeasured count) → the populated district rows → the pool's
 *  0-served cities → the catalog extras. With no district rows the list is exactly `[...pool, ...extras]` (today's order). */
export function orderCityBoxRows<T extends { listingCount: number; scopeKnown?: boolean }>(pool: readonly T[], districtRows: readonly T[], extras: readonly T[]): T[] {
  if (!districtRows.length) return [...pool, ...extras];
  const live = (c: T) => c.scopeKnown === false || c.listingCount > 0;
  return [...pool.filter(live), ...districtRows, ...pool.filter((c) => !live(c)), ...extras];
}
