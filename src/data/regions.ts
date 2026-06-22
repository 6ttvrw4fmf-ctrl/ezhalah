// Saudi Arabia's 13 administrative regions → the canonical DB `city` labels each contains (mirrors
// the scraper's city catalog). Shared by the fetch (remote.ts) and the ranking (search.ts) so a
// country-wide "Saudi" search returns a balanced spread across every region instead of a Riyadh-heavy
// newest list. (user: "put Saudi → show diversified from those 13 regions".) In its own module so
// both remote.ts and search.ts can import it without a circular dependency.
import type { SearchQuery } from './search';

export const REGIONS: Record<string, string[]> = {
  Riyadh: ['Riyadh', 'Al Kharj', 'Al Majmaah', 'Dawadmi', 'Al Zulfi', 'Afif', 'Al Quwayiyah', 'Shaqra', 'Diriyah', 'Al Muzahimiyah', 'Thadiq', 'Hawtat Bani Tamim', 'Al Ghat', 'Rumah', 'Al Dalam', 'Al Hariq', 'As Sulayyil', 'Al Hayathim'],
  Makkah: ['Jeddah', 'Mecca', 'Taif', 'Rabigh', 'Al Qunfudhah', 'KAEC', 'Thuwal', 'Al Jumum', 'Al Kamil', 'Al Lith', 'Turabah', 'Raniyah', 'Al Khurma'],
  Madinah: ['Medina', 'Yanbu', 'Al Ula', 'Badr', 'Al Hanakiyah', 'Umluj', 'Khaybar', 'Mahd adh Dhahab'],
  Qassim: ['Buraidah', 'Unaizah', 'Ar Rass', 'Al Bukayriyah', 'Al Mithnab', 'Al Badai', 'Riyadh Al Khabra', 'An Nabhaniyah', 'Ash Shamasiyah'],
  Eastern: ['Dammam', 'Khobar', 'Dhahran', 'Hofuf', 'Jubail', 'Qatif', 'Hafar Al Batin', 'Ras Tanura', 'Abqaiq', 'An Nairyah', 'Khafji', 'Sayhat', 'Safwa', 'Tarout', 'Al Uyun', 'Anak'],
  Asir: ['Abha', 'Khamis Mushait', 'Bisha', 'Mahayel', 'Ahad Rafidah', 'Al Majardah', 'Balsamar', 'Tathlith'],
  Tabuk: ['Tabuk', 'Duba', 'Al Wajh', 'Tayma'],
  Hail: ['Hail', 'Baqaa', 'Al Ghazalah', 'Ash Shanan'],
  'Northern Borders': ['Arar', 'Rafha', 'Turaif'],
  Jazan: ['Jazan', 'Sabya', 'Abu Arish', 'Samtah', 'Baysh', 'Ahad Al Masarihah'],
  Najran: ['Najran', 'Sharurah'],
  'Al Bahah': ['Al Baha'],
  'Al Jouf': ['Sakaka', 'Qurayyat', 'Dawmat Al Jandal'],
};

// city label → region name (reverse index), so results can be ordered/interleaved by region.
export const CITY_TO_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(REGIONS).flatMap(([region, cities]) => cities.map((c) => [c, region])),
);

// "Saudi Arabia" / "السعودية" / KSA picked (or resolved) as the location → the whole Kingdom.
const COUNTRY_ALIASES = new Set([
  'saudi arabia', 'saudi', 'ksa', 'kingdom', 'saudi arabia ksa',
  'المملكة العربية السعودية', 'المملكة', 'السعودية', 'العربية السعودية', 'سعودية', 'السعوديه',
]);
export function isCountryWideQuery(q: SearchQuery): boolean {
  if ((q.locationMatch as { kind?: string } | undefined)?.kind === 'country') return true;
  const loc = (q.location || '').trim().toLowerCase()
    // strip Arabic prefix words that don't change meaning: "كل / جميع / في كل / في"
    .replace(/^(في\s+)?(كل|جميع)\s+/i, '')
    .replace(/^في\s+/i, '')
    .trim();
  if (!loc) return true; // no place named (agent "search everywhere") → the whole Kingdom, diversified
  if (COUNTRY_ALIASES.has(loc)) return true;
  // Loose contains-match — covers any phrasing that mentions the Kingdom (e.g. "أنحاء السعودية").
  return /(saudi|kingdom|ksa|السعودي|المملكة)/i.test(loc);
}

// Round-robin interleave per-region lists: 1st of each region, then 2nd, … so the order rotates
// through regions instead of front-loading one.
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
