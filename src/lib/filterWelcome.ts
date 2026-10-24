// THE FILTER HOME'S ROTATING WELCOME (owner 2026-10-17).
//
// The Filter home's BIG HEADLINE («موقع واحد للبحث…») sometimes becomes a short,
// personal marketing line for a SIGNED-IN user: a greeting, their name, a live fact, and the brand
// «إزهله» / "Ezhalah" at the end. The owner approved these 30 lines word for word (Arabic), with an
// English translation in which the brand name is never translated.
//
// THE FACTS MUST BE TRUE AND STAY TRUE (owner: «all this needs to be true … gets updated»):
//   • no number is typed into a line — every number is a placeholder filled from a live read;
//   • every count is the exact live number in digits (owner 2026-10-17: «the actual number … not word form»);
//     «أكثر من» survives only on the Riyadh SHARE (a percentage floored strictly below the truth);
//   • a line whose fact is missing, failed, or not true today (e.g. «كل مناطق المملكة الـ13» when not
//     every region has listings) is NOT shown — the normal subtitle stays. Never a stale or made-up number.
// Pure: no React, no network, no storage. Executed by scripts/verify-filter-welcome.ts.
import { isInsightLineId } from './insightWelcome.ts';

export type WelcomeFacts = {
  sites?: number;        // distinct websites with searchable listings (loader_active_platforms_ar)
  listings?: number;     // all searchable listings (loader_scale_stats_ar)
  cities?: number;       // cities with listings
  districts?: number;    // districts with listings
  regions?: number;      // regions with at least one listing
  regionCounts?: Record<string, number>; // region_ar → listings
  city?: { ar: string; en?: string; count: number };       // the user's last-searched city (or the top city)
  topDistrict?: { ar: string; en?: string; count: number }; // that city's district with the most listings
  topDistricts?: Array<{ ar: string; en?: string; count: number }>; // that city's top districts, most listings first
  cityRank?: number;     // the city's position among all cities by listing count (1 = most)
  topCities?: Array<{ ar: string; en?: string; count: number }>; // the cities with the most listings, first first
  myDistrict?: { ar: string; en?: string; count: number; rank: number }; // the district the user last searched, in its city
  newToday?: number;     // listings Ezhalah first saw since midnight Riyadh, searchable now (welcome_new_today_ar)
};

type When = 'morning' | 'evening' | 'friday' | 'weekend' | 'any';
type Need = 'sites' | 'listings' | 'cities' | 'districts' | 'allRegions' | 'city' | 'district'
  | 'district3' | 'rank' | 'riyadhShare' | 'top2' | 'myDistrict' | 'myTop10'
  | 'riyadh' | 'makkah' | 'eastern' | 'qassim' | 'newToday';

export type WelcomeLine = { id: number; when: When; needs: Need[]; ar: string; en: string };

// The owner-approved lines, in order. {n} = name; other {keys} are live values (see fill()).
export const WELCOME_LINES: readonly WelcomeLine[] = [
  // CALL-TO-ACTION WORDING (owner 2026-10-17: «should tell them to use us», not just state a fact).
  // Every line keeps its live fact and ends by inviting the user to act, then the brand.
  { id: 1, when: 'morning', needs: ['sites'], ar: 'صباح الخير {n}، {sites} موقع عقاري بانتظارك. ابدأ بحثك مع إزهله.', en: 'Good morning {n}, {sites} real-estate websites are waiting for you. Start your search with Ezhalah.' },
  { id: 2, when: 'morning', needs: ['listings'], ar: 'صباح الخير {n}، {listingsMore} إعلان بانتظارك. دور الحين مع إزهله.', en: 'Good morning {n}, {listingsMore} listings are waiting for you. Search now with Ezhalah.' },
  { id: 3, when: 'morning', needs: ['allRegions'], ar: 'صباح الخير {n}، من الرياض إلى الجوف، المملكة كلها بين يديك. ابحث مع إزهله.', en: 'Good morning {n}, from Riyadh to Al-Jouf, the whole Kingdom is in your hands. Search with Ezhalah.' },
  { id: 4, when: 'morning', needs: ['city', 'district'], ar: 'صباح الخير {n}، {district} من أكثر الأحياء إعلانات في {city} الحين. اكتشفه مع إزهله.', en: 'Good morning {n}, {district} is one of the busiest districts in {city} right now. Explore it with Ezhalah.' },
  { id: 5, when: 'morning', needs: ['cities'], ar: 'صباح الخير {n}، {cities} مدينة في بحث واحد. اختر مدينتك وخلها على إزهله.', en: 'Good morning {n}, {cities} cities in one search. Pick your city and leave the rest to Ezhalah.' },
  { id: 6, when: 'morning', needs: [], ar: 'صباح الخير {n}، وفر وقتك، المنصات الكبيرة والمكاتب المحلية في مكان واحد. ابحث مع إزهله.', en: 'Good morning {n}, save your time: big platforms and local offices in one place. Search with Ezhalah.' },
  { id: 7, when: 'evening', needs: ['districts'], ar: 'مساء الخير {n}، {districtsMore} حي بانتظارك. اختر الحي اللي يناسبك مع إزهله.', en: 'Good evening {n}, {districtsMore} districts are waiting for you. Pick the one that suits you with Ezhalah.' },
  { id: 8, when: 'evening', needs: ['city'], ar: 'مساء الخير {n}، {city} فيها {cityMore} إعلان الحين. شوفها مع إزهله.', en: 'Good evening {n}, {city} has {cityMore} listings right now. See them with Ezhalah.' },
  { id: 9, when: 'evening', needs: ['sites'], ar: 'مساء الخير {n}، {sites} موقع في شاشة واحدة. جرب بحثك الحين مع إزهله.', en: 'Good evening {n}, {sites} websites on one screen. Try your search now with Ezhalah.' },
  { id: 10, when: 'evening', needs: [], ar: 'مساء الخير {n}، مكاتب محلية يصعب تلاقيها، كلها هنا. اكتشفها مع إزهله.', en: 'Good evening {n}, local offices that are hard to find, all here. Discover them with Ezhalah.' },
  { id: 11, when: 'evening', needs: ['riyadh'], ar: 'مساء الخير {n}، منطقة الرياض وحدها فيها {riyadhMore} إعلان. ابدأ منها مع إزهله.', en: 'Good evening {n}, the Riyadh region alone has {riyadhMore} listings. Start there with Ezhalah.' },
  { id: 12, when: 'evening', needs: ['city', 'district'], ar: 'مساء الخير {n}، السوق نشط في {district} الحين. لا يفوتك مع إزهله.', en: "Good evening {n}, the market is active in {district} right now. Don't miss it with Ezhalah." },
  { id: 13, when: 'friday', needs: ['sites'], ar: 'جمعة مباركة {n}، {sites} موقع في بحث واحد. خذ راحتك ودور مع إزهله.', en: 'Jumma Mubarak {n}, {sites} websites in one search. Take your time and search with Ezhalah.' },
  { id: 14, when: 'friday', needs: ['listings'], ar: 'جمعة مباركة {n}، {listingsMore} إعلان بانتظارك. تصفحها على راحتك مع إزهله.', en: 'Jumma Mubarak {n}, {listingsMore} listings are waiting for you. Browse them at your pace with Ezhalah.' },
  { id: 15, when: 'friday', needs: ['cities'], ar: 'جمعة مباركة {n}، من المدن الكبيرة للصغيرة، {cities} مدينة. اختر وجهتك مع إزهله.', en: 'Jumma Mubarak {n}, from big cities to small ones, {cities} cities. Pick your destination with Ezhalah.' },
  { id: 16, when: 'weekend', needs: ['sites'], ar: 'إجازة سعيدة {n}، استمتع بإجازتك وخل التدوير في {sites} موقع على إزهله.', en: 'Happy weekend {n}, enjoy your break and leave the search across {sites} websites to Ezhalah.' },
  { id: 17, when: 'weekend', needs: ['city'], ar: 'إجازة سعيدة {n}، الأحياء الأكثر إعلانات في {city} بانتظارك. اكتشفها مع إزهله.', en: 'Happy weekend {n}, the busiest districts in {city} are waiting for you. Explore them with Ezhalah.' },
  { id: 18, when: 'weekend', needs: ['allRegions'], ar: 'إجازة سعيدة {n}، كل مناطق المملكة في بحث واحد. ابدأ الحين مع إزهله.', en: 'Happy weekend {n}, all {regions} regions of the Kingdom in one search. Start now with Ezhalah.' },
  { id: 19, when: 'any', needs: [], ar: 'هلا بعودتك {n}… اللي تدور عليه، أنا ألقاه لك. عشان كذا اسمي إزهله.', en: "Welcome back {n}… whatever you're looking for, I'll find it for you. That's why my name is Ezhalah." },
  { id: 20, when: 'any', needs: ['sites'], ar: 'هلا {n}، {sites} موقع عقاري وبحث واحد. جربه الحين مع إزهله.', en: 'Hi {n}, {sites} real-estate websites and one search. Try it now with Ezhalah.' },
  { id: 21, when: 'any', needs: ['listings'], ar: 'هلا {n}، {listings} إعلان عقاري تنتظرك. ابدأ بحثك مع إزهله.', en: 'Hi {n}, {listings} real-estate listings are waiting for you. Start your search with Ezhalah.' },
  { id: 22, when: 'any', needs: ['makkah'], ar: 'حياك {n}، منطقة مكة المكرمة فيها {makkahMore} إعلان. شوفها مع إزهله.', en: 'Welcome {n}, the Makkah region has {makkahMore} listings. See them with Ezhalah.' },
  { id: 23, when: 'any', needs: ['eastern'], ar: 'حياك {n}، المنطقة الشرقية فيها {easternMore} إعلان. اكتشفها مع إزهله.', en: 'Welcome {n}, the Eastern Province has {easternMore} listings. Discover them with Ezhalah.' },
  { id: 24, when: 'any', needs: ['city'], ar: 'رجعت يا {n}؟ {city} فيها {cityMore} إعلان. نكمل البحث مع إزهله.', en: "Back again, {n}? {city} has {cityMore} listings. Let's keep searching with Ezhalah." },
  { id: 25, when: 'any', needs: [], ar: 'هلا {n}، حتى المدن الصغيرة لها مكان هنا. ابحث عن مدينتك مع إزهله.', en: 'Hi {n}, even small cities have a place here. Look up your city with Ezhalah.' },
  { id: 26, when: 'any', needs: [], ar: 'حياك {n}، وفر ساعات من التدوير. بحث واحد يكفي مع إزهله.', en: 'Welcome {n}, save hours of searching. One search is enough with Ezhalah.' },
  { id: 27, when: 'any', needs: ['city', 'district'], ar: 'هلا {n}، {district} من الأكثر إعلانات في {city}. شوفها الحين مع إزهله.', en: 'Hi {n}, {district} is among the busiest districts in {city}. See it now with Ezhalah.' },
  { id: 28, when: 'any', needs: ['districts', 'cities'], ar: 'رجعت يا {n}؟ {districtsMore} حي و{cities} مدينة بانتظارك. ابدأ مع إزهله.', en: 'Back again, {n}? More than {districtsMore} districts and {cities} cities are waiting for you. Start with Ezhalah.' },
  { id: 29, when: 'any', needs: ['qassim'], ar: 'حياك {n}، القصيم وحدها فيها {qassimMore} إعلان. اكتشفها مع إزهله.', en: 'Welcome {n}, Al-Qassim alone has {qassimMore} listings. Discover them with Ezhalah.' },
  { id: 30, when: 'any', needs: [], ar: 'هلا {n}، السوق كله في شاشة واحدة. وفر وقتك وابحث مع إزهله.', en: 'Hi {n}, the whole market on one screen. Save your time and search with Ezhalah.' },
  // INSIGHT LINES (owner 2026-10-17: «include insights from Ezhalah's database … trending places»).
  // "Busiest" = most listings right now — the same measure the app's Trending lists use. Never a claim
  // about what people search, and never a deal tip («نشط», not «نار»).
  { id: 31, when: 'any', needs: ['city', 'district'], ar: '{n}، أكثر حي إعلانات في {city} الحين: {district}. شوفه مع إزهله.', en: '{n}, the district with the most listings in {city} right now: {district}. See it with Ezhalah.' },
  { id: 32, when: 'any', needs: ['city', 'district'], ar: '{n}، {district} يتصدر {city} بـ{districtCountMore} إعلان. اكتشفه مع إزهله.', en: '{n}, {district} leads {city} with {districtCountMore} listings. Explore it with Ezhalah.' },
  { id: 33, when: 'any', needs: ['city', 'district3'], ar: '{n}، أقوى ثلاثة أحياء في {city} الحين: {d1}، {d2}، {d3}. اختر منها مع إزهله.', en: '{n}, the top three districts in {city} right now: {d1}, {d2}, {d3}. Pick one with Ezhalah.' },
  { id: 34, when: 'any', needs: ['city', 'district'], ar: '{n}، {district} نشط في {city} الحين. لا يفوتك مع إزهله.', en: "{n}, {district} is active in {city} right now. Don't miss it with Ezhalah." },
  { id: 35, when: 'any', needs: ['city', 'rank'], ar: '{n}، {city} رقم {rank} في المملكة بعدد الإعلانات. ابحث فيها مع إزهله.', en: '{n}, {city} is number {rank} in the Kingdom by listings. Search it with Ezhalah.' },
  { id: 36, when: 'any', needs: ['riyadhShare'], ar: '{n}، منطقة الرياض فيها أكثر من {riyadhShare}% من إعلانات المملكة. ابدأ منها مع إزهله.', en: "{n}, the Riyadh region holds more than {riyadhShare}% of the Kingdom's listings. Start there with Ezhalah." },
  { id: 37, when: 'any', needs: [], ar: '{n}، السوق يتحرك كل يوم. خلك أول من يشوف الجديد مع إزهله.', en: '{n}, the market moves every day. Be the first to see what is new with Ezhalah.' },
  { id: 38, when: 'any', needs: ['city', 'district3'], ar: '{n}، من {d1} إلى {d3}، أنشط أحياء {city} في مكان واحد. تصفحها مع إزهله.', en: "{n}, from {d1} to {d3}, {city}'s most active districts in one place. Browse them with Ezhalah." },
  { id: 39, when: 'any', needs: ['city', 'district'], ar: '{n}، {city} فيها {cityMore} إعلان، و{district} لحاله {districtCountMore}. شوفها مع إزهله.', en: '{n}, {city} has {cityMore} listings, and {district} alone {districtCountMore}. See them with Ezhalah.' },
  { id: 40, when: 'any', needs: ['top2'], ar: '{n}، أنشط مدينتين في المملكة الحين: {c1} و{c2}. ابدأ منهما مع إزهله.', en: "{n}, the Kingdom's two most active cities right now: {c1} and {c2}. Start there with Ezhalah." },
  // THE USER'S OWN DISTRICT (owner 2026-10-17: «include districts»). Only for a user whose last search
  // picked a district; that district's live count and rank inside its city. No line promises to watch
  // or alert — Ezhalah has no such feature. The district is always NAMED (owner rule: no second-person word for it).
  { id: 41, when: 'any', needs: ['city', 'myDistrict'], ar: '{n}، {myDistrict} فيه {myDistrictMore} إعلان الحين. شوف الجديد مع إزهله.', en: '{n}, {myDistrict} has {myDistrictMore} listings right now. See what is new with Ezhalah.' },
  { id: 42, when: 'any', needs: ['city', 'myDistrict'], ar: '{n}، {myDistrict} فيه {myDistrictMore} إعلان من أصل {cityExact} في {city}. تصفحها مع إزهله.', en: '{n}, {myDistrict} has {myDistrictMore} of the {cityExact} listings in {city}. Browse them with Ezhalah.' },
  { id: 43, when: 'any', needs: ['city', 'myDistrict'], ar: '{n}، {myDistrict} رقم {myRank} في {city} بعدد الإعلانات. اكتشفه مع إزهله.', en: '{n}, {myDistrict} is number {myRank} in {city} by listings. Explore it with Ezhalah.' },
  { id: 44, when: 'any', needs: ['city', 'myDistrict'], ar: '{n}، كل إعلانات {myDistrict} من كل المواقع في مكان واحد. شوفها مع إزهله.', en: "{n}, all of {myDistrict}'s listings from every website in one place. See them with Ezhalah." },
  { id: 45, when: 'any', needs: ['city', 'myTop10'], ar: '{n}، {myDistrict} من أنشط أحياء {city} الحين. لا يفوتك مع إزهله.', en: "{n}, {myDistrict} is one of the most active districts in {city} right now. Don't miss it with Ezhalah." },
  // NEW ON EZHALAH TODAY (owner 2026-10-18, option A). "New" = new to Ezhalah (first_seen_at, Ezhalah-owned),
  // since midnight Riyadh; shown only from NEW_TODAY_MIN up, and a held copy never crosses midnight.
  { id: 46, when: 'any', needs: ['newToday'], ar: '{n}، {newToday} إعلان جديد اليوم على إزهله.', en: '{n}, {newToday} new listings today on Ezhalah.' },
];
export const NEW_TODAY_MIN = 100;
// Riyadh is UTC+3 all year (no DST): the calendar day "today" means in the line above.
export const riyadhDay = (t: number): number => Math.floor((t + 3 * 3600_000) / 86_400_000);

/** Saudi Arabia has 13 administrative regions; «كل المناطق» is said only when every one has listings. */
export const SAUDI_REGION_COUNT = 13;
const REGION_AR = { riyadh: 'منطقة الرياض', makkah: 'منطقة مكة المكرمة', eastern: 'المنطقة الشرقية', qassim: 'منطقة القصيم' } as const;

/**
 * How long one line stays before the next (owner 2026-10-17: «not every refresh … every now and then,
 * hours» → every 4 hours; owner 2026-10-20: «every 2 hours»; owner 2026-10-22: «1 hour» — a new fact every
 * hour, still calm, never on every refresh; a signed-in user always sees a personal line).
 */
export const HOLD_MS = 1 * 60 * 60 * 1000;
/** A user with a searched district sees one of THEIR district's lines about this share of periods. */
export const MY_DISTRICT_SHARE = 1 / 3;
/** «من أنشط أحياء {city}» is said only when the district is within this rank in its city. */
export const MY_DISTRICT_TOP = 10;
/** Lines that state no live fact and fit any hour — the fallback when a chosen line's fact is unknown. */
export const FACTLESS_ANYTIME_IDS: readonly number[] = WELCOME_LINES.filter((l) => !l.needs.length && l.when === 'any').map((l) => l.id);

const fmt = (n: number) => Math.trunc(n).toLocaleString('en-US');

/**
 * A number to print after «أكثر من» / "more than": rounded DOWN, and always STRICTLY below the real
 * count (so "more than X" is true even when the count is a round number). ≥100,000 → tens of
 * thousands; ≥10,000 → thousands; ≥1,000 → hundreds. Below 1,000 there is no honest "more than"
 * phrasing worth showing, so it returns null and the line is skipped.
 */
export function moreThan(count: number | undefined, locale: 'ar' | 'en'): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1001) return null;
  const c = count - 1; // strictly below
  const step = c >= 100_000 ? 10_000 : c >= 10_000 ? 1_000 : 100;
  const v = Math.floor(c / step) * step;
  if (v <= 0) return null;
  if (v >= 1_000 && v % 1_000 === 0) return locale === 'ar' ? `${fmt(v / 1_000)} ألف` : fmt(v);
  return fmt(v);
}

/** Is this line allowed at this moment (device local time)? */
export function lineFitsTime(line: WelcomeLine, now: Date): boolean {
  const h = now.getHours();
  const day = now.getDay(); // 5 = Friday, 6 = Saturday
  switch (line.when) {
    case 'morning': return h >= 5 && h < 12;
    case 'evening': return h >= 17 && h < 24;
    case 'friday': return day === 5;
    case 'weekend': return day === 5 || day === 6;
    default: return true;
  }
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
// EXACT, IN DIGITS (owner 2026-10-17): the live count as it is — «372,889», never «370 ألف».
const exact = (n: unknown): string | null => (positive(n) ? fmt(n) : null);

// THE NAME IS FILLED LAST, PER LANGUAGE (owner 2026-10-17: «رجعت يا yusuf؟» — a Latin name inside the
// Arabic line). Lines are rendered and remembered with NAME_SLOT in place of the name; fillName() puts
// in the Arabic spelling for Arabic and the Latin one for English when the line is shown. A remembered
// sentence therefore never carries a name from another language or from before a rename.
export const NAME_SLOT = '⟦n⟧';
/** Put the user's name for THIS language into a slotted line; null when there is no fitting name
 *  (an Arabic line never shows Latin letters for the name — the normal headline stays instead). */
export function fillName(text: string | null | undefined, name: string, locale: 'ar' | 'en'): string | null {
  if (!text) return null;
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first || (locale === 'ar' && /[A-Za-z]/.test(first)) || (locale === 'en' && /[\u0600-\u06FF]/.test(first))) return null;
  // Isolated (U+2068 … U+2069): an Arabic name in an English line (or the reverse) can't drag the comma.
  return text.split(NAME_SLOT).join(`\u2068${first}\u2069`);
}

/** Fill a line, or null when any fact it states is missing or not true today. */
export function renderWelcome(line: WelcomeLine, name: string, f: WelcomeFacts, locale: 'ar' | 'en'): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first) return null;
  const v: Record<string, string> = { n: first };
  for (const need of line.needs) {
    switch (need) {
      case 'sites': if (!positive(f.sites)) return null; v.sites = fmt(f.sites); break;
      case 'listings': {
        if (!positive(f.listings)) return null;
        v.listings = fmt(f.listings);
        const m = exact(f.listings); if (!m) return null; v.listingsMore = m; break;
      }
      case 'cities': if (!positive(f.cities)) return null; v.cities = fmt(f.cities); break;
      case 'districts': { const m = exact(f.districts); if (!m) return null; v.districtsMore = m; break; }
      case 'allRegions': if (f.regions !== SAUDI_REGION_COUNT) return null; v.regions = fmt(f.regions); break;
      case 'city': {
        const c = f.city; if (!c || !positive(c.count)) return null;
        const label = locale === 'ar' ? c.ar : c.en;
        if (!label || (locale === 'en' && /[؀-ۿ]/.test(label))) return null;
        v.city = label;
        const m = exact(c.count); if (!m && line.ar.includes('{cityMore}')) return null;
        if (m) v.cityMore = m;
        break;
      }
      case 'district': {
        const d = f.topDistrict; if (!d || !positive(d.count)) return null;
        if (locale === 'ar') v.district = /^حي\s/.test(d.ar) ? d.ar : `حي ${d.ar}`;
        else if (d.en && !/[؀-ۿ]/.test(d.en)) v.district = d.en; // never Arabic mid-English
        else return null;
        const m = exact(d.count);
        if (m) v.districtCountMore = m;
        else if (line.ar.includes('{districtCountMore}')) return null;
        break;
      }
      case 'district3': {
        const ds = (f.topDistricts ?? []).slice(0, 3);
        if (ds.length < 3 || !ds.every((d) => positive(d.count))) return null;
        const names = ds.map((d) => (locale === 'ar' ? d.ar.replace(/^حي\s+/, '') : d.en));
        if (names.some((x) => !x || (locale === 'en' && /[؀-ۿ]/.test(x)))) return null;
        [v.d1, v.d2, v.d3] = names as string[];
        break;
      }
      case 'rank': if (!positive(f.cityRank)) return null; v.rank = fmt(f.cityRank); break;
      case 'riyadhShare': {
        // A share of the SAME pool (sum of region counts), floored strictly below the true percentage.
        const counts = Object.values(f.regionCounts ?? {});
        const total = counts.reduce((a, b) => a + b, 0);
        const r = f.regionCounts?.[REGION_AR.riyadh];
        if (!positive(total) || !positive(r)) return null;
        const pct = Math.ceil((r / total) * 100) - 1;
        if (pct < 1) return null;
        v.riyadhShare = String(pct);
        break;
      }
      case 'top2': {
        const cs = (f.topCities ?? []).slice(0, 2);
        if (cs.length < 2) return null;
        const names = cs.map((c) => (locale === 'ar' ? c.ar : c.en));
        if (names.some((x) => !x || (locale === 'en' && /[؀-ۿ]/.test(x)))) return null;
        [v.c1, v.c2] = names as string[];
        break;
      }
      case 'newToday': if (!positive(f.newToday) || f.newToday < NEW_TODAY_MIN) return null; v.newToday = fmt(f.newToday); break;
      case 'myDistrict': case 'myTop10': {
        const d = f.myDistrict;
        if (!d || !positive(d.count) || !positive(d.rank)) return null;
        if (need === 'myTop10' && d.rank > MY_DISTRICT_TOP) return null; // «من أنشط الأحياء» only when true
        if (locale === 'ar') v.myDistrict = /^حي\s/.test(d.ar) ? d.ar : `حي ${d.ar}`;
        else if (d.en && !/[؀-ۿ]/.test(d.en)) v.myDistrict = d.en;
        else return null;
        v.myRank = fmt(d.rank);
        const m = exact(d.count);
        if (m) v.myDistrictMore = m;
        else if (line.ar.includes('{myDistrictMore}')) return null;
        if (f.city && positive(f.city.count)) v.cityExact = fmt(f.city.count);
        else if (line.ar.includes('{cityExact}')) return null;
        break;
      }
      default: {
        const m = exact(f.regionCounts?.[REGION_AR[need]]); if (!m) return null;
        v[`${need}More`] = m;
      }
    }
  }
  const tpl = locale === 'ar' ? line.ar : line.en;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? `\u0000${k}`);
  return out.includes('\u0000') ? null : out;
}

const isMyDistrictLine = (l: WelcomeLine) => l.needs.includes('myDistrict') || l.needs.includes('myTop10');

/**
 * A fresh line for a new period: fits the moment, never the previous one. `rand` is injectable for tests.
 * A user with a searched district gets one of THEIR district's lines about 1 period in 3 (owner
 * 2026-10-17: the most personal lines should come up often); without one, those lines never come up.
 */
export function chooseWelcomeLine(now: Date, lastId: number | null, rand: () => number = Math.random, hasMyDistrict = false): WelcomeLine | null {
  const fits = (l: WelcomeLine) => l.id !== lastId && lineFitsTime(l, now);
  const mine = WELCOME_LINES.filter((l) => isMyDistrictLine(l) && fits(l));
  const others = WELCOME_LINES.filter((l) => !isMyDistrictLine(l) && fits(l));
  const pool = hasMyDistrict && mine.length && rand() < MY_DISTRICT_SHARE ? mine : others;
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export type HeldWelcome = { id: number; at: number };

/**
 * The line for this page load. The held line is KEPT while it is younger than HOLD_MS and still fits
 * the moment (a morning line does not survive into the evening); otherwise a new period starts with a
 * new line. `keep` says whether the caller should leave the held record untouched.
 */
export function welcomeForNow(now: Date, held: HeldWelcome | null, rand: () => number = Math.random, hasMyDistrict = false): { line: WelcomeLine; keep: boolean } | null {
  if (held) {
    const line = WELCOME_LINES.find((l) => l.id === held.id);
    const age = now.getTime() - held.at;
    if (line && age >= 0 && age < HOLD_MS && lineFitsTime(line, now) && (hasMyDistrict || !isMyDistrictLine(line))) return { line, keep: true };
  }
  const line = chooseWelcomeLine(now, held?.id ?? null, rand, hasMyDistrict);
  return line ? { line, keep: false } : null;
}

/** When the chosen line's fact is unknown right now, a factless any-time line stands in (never the previous one). */
export function fallbackLine(avoidId: number | null, rand: () => number = Math.random): WelcomeLine {
  const ids = FACTLESS_ANYTIME_IDS.filter((id) => id !== avoidId);
  const id = ids[Math.min(ids.length - 1, Math.floor(rand() * ids.length))];
  return WELCOME_LINES.find((l) => l.id === id)!;
}

// THE HEADLINE NEVER CHANGES ONCE SHOWN (owner 2026-10-17: «I see it changing … make sure it never
// happens, never ever»). The swap the owner saw had two causes: the page paints before the session
// restore knows who the visitor is (guest headline → personal line), and the personal line's live
// numbers arrive a moment after mount. So the headline's entrance is HELD until this state settles,
// and after it settles nothing may replace it for the rest of the page load:
//   guest (after the restore)  → normal headline, final
//   facts arrived              → the personal line, final
//   cap reached (SETTLE_CAP_MS) → normal headline, final; late facts are IGNORED, never swapped in
// Pure reducer so scripts/verify-filter-welcome.ts can execute the "late facts are ignored" rule.
export const SETTLE_CAP_MS = 2500;
export type HeadlineState = { settled: boolean; line: WelcomeLine | null; facts: WelcomeFacts | null };
export type HeadlineEvent =
  | { type: 'guest' }
  | { type: 'timeout' }
  | { type: 'facts'; line: WelcomeLine; facts: WelcomeFacts };
export const HEADLINE_UNSETTLED: HeadlineState = { settled: false, line: null, facts: null };
export function headlineReduce(s: HeadlineState, ev: HeadlineEvent): HeadlineState {
  if (s.settled) return s; // whatever is on screen stays on screen
  if (ev.type === 'facts') return { settled: true, line: ev.line, facts: ev.facts };
  return { settled: true, line: null, facts: null };
}

// INSTANT (owner 2026-10-17: «could we make it built in, like it doesn't load?»). The headline must
// not wait for the network. The device remembers the line it last SHOWED — its id, when it started,
// and its rendered text in both languages — and the next page open shows that text immediately,
// with no fetch in the way. Its numbers are refreshed in the background and written back for the
// NEXT visit; what is on screen never changes (the no-swap rule above). A device with a session but
// no usable memory yet shows a line that needs no numbers at all, instantly, and the real held line
// (with its live numbers) is prepared in the background for the next visit.
//   hasSession = a Supabase session is stored on this device (synchronous; the restore only confirms it)
//   cache      = what this device showed last; reused only while held (HOLD_MS) and while it still
//                fits the moment (a morning line is not reused at night)
//   next       = the line PREPARED in the background for the next period, not yet seen. Its hour starts
//                when it is first SHOWN (`promoted`: the caller then remembers it as the shown line).
//
// WHY `next` EXISTS (owner 2026-10-22: «I keep seeing the same one always»). The background used to
// write the next period's line over the shown one, stamped with the moment it was PREPARED. A visitor
// who came back more than 2 hours later found it already expired, so the screen fell back to one of
// the five lines with no numbers — measured live: four visits 2 h apart showed «حياك {n}، وفر ساعات من
// التدوير…» three times while lines 6, 37 and 30 were prepared and thrown away unseen.
export const PREPARED_MAX_MS = 24 * 60 * 60 * 1000;
export type WelcomeCache = { id: number; at: number; ar: string; en: string };

// THE SIGN-IN WELCOME (owner 2026-10-22: «whenever the user logs in or signs up, this message appears»,
// with five wordings so users see different ones). Approved Arabic, word for word; the English is its
// translation, with the brand never translated. Shown on the page right after a sign-in (or sign-up),
// then held GREET_HOLD_MS so a reload keeps it; after that the normal rotation resumes. Never chosen
// by the normal rotation (they are not in WELCOME_LINES).
export const GREET_LINES: readonly WelcomeLine[] = [
  { id: 101, when: 'any', needs: [], ar: 'حياك الله {n}، إزهله طريقتك الجديدة لتلاقي عقارك في السعودية. 🥳', en: 'Welcome {n}, Ezhalah is your new way to find your property in Saudi Arabia. 🥳' },
  { id: 102, when: 'any', needs: [], ar: 'أهلاً {n}، مع إزهله صار البحث عن عقارك في السعودية أسهل. 🥳', en: 'Hello {n}, with Ezhalah, finding your property in Saudi Arabia just got easier. 🥳' },
  { id: 103, when: 'any', needs: [], ar: 'حياك الله {n}، إزهله يدور لك على عقارك في كل السعودية. 🥳', en: 'Welcome {n}, Ezhalah searches all of Saudi Arabia for your property. 🥳' },
  { id: 104, when: 'any', needs: [], ar: 'هلا {n}، عقارك في السعودية صار أقرب مع إزهله. 🥳', en: 'Hi {n}, your property in Saudi Arabia is closer with Ezhalah. 🥳' },
  { id: 105, when: 'any', needs: [], ar: 'مرحباً {n}، إزهله بدايتك الجديدة للبحث عن عقارك في السعودية. 🥳', en: 'Welcome {n}, Ezhalah is your fresh start in the search for property in Saudi Arabia. 🥳' },
];
export const GREET_HOLD_MS = 30 * 60 * 1000;
/** Which of the five a sign-in shows: starts from the user's own id (so users differ), then moves one
 *  step per sign-in on this device (so the same user does not always see the same one). */
export function greetIndex(userId: string, signIns: number): number {
  let h = 0;
  for (const ch of String(userId ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h + Math.max(0, Math.trunc(signIns))) % GREET_LINES.length;
}
/** The sign-in welcome in both languages, name still slotted (fillName puts it in per language). */
export function greetingFor(userId: string, signIns: number, name: string): { id: number; ar: string; en: string } | null {
  const line = GREET_LINES[greetIndex(userId, signIns)];
  const ar = renderWelcome(line, name, {}, 'ar');
  const en = renderWelcome(line, name, {}, 'en');
  return ar && en ? { id: line.id, ar, en } : null;
}

const cachedFits = (c: WelcomeCache, now: Date, maxAge: number): boolean => {
  const age = now.getTime() - c.at;
  // A daily-insight line (lib/insightWelcome.ts): its greeting is put in when shown, from Saudi time, so it
  // fits any hour; only its age counts.
  if (isInsightLineId(c.id)) return age >= 0 && age < maxAge && !!c.ar && !!c.en;
  const greet = GREET_LINES.find((l) => l.id === c.id);
  if (greet) return age >= 0 && age < Math.min(maxAge, GREET_HOLD_MS) && !!c.ar && !!c.en;
  const line = WELCOME_LINES.find((l) => l.id === c.id);
  return !!line && age >= 0 && age < maxAge && lineFitsTime(line, now) && !!c.ar && !!c.en
    && (!line.needs.includes('newToday') || riyadhDay(c.at) === riyadhDay(now.getTime()));
};
export function instantWelcome(a: { hasSession: boolean; cache: WelcomeCache | null; next?: WelcomeCache | null; now: Date; name: string; rand?: () => number }): { id: number; ar: string; en: string; fromCache: boolean; promoted?: boolean } | null {
  if (!a.hasSession) return null;
  const c = a.cache;
  if (c && cachedFits(c, a.now, HOLD_MS)) return { id: c.id, ar: c.ar, en: c.en, fromCache: true };
  const n = a.next;
  if (n && n.id !== c?.id && cachedFits(n, a.now, PREPARED_MAX_MS)) return { id: n.id, ar: n.ar, en: n.en, fromCache: true, promoted: true };
  const line = fallbackLine(c?.id ?? null, a.rand);
  const ar = renderWelcome(line, a.name, {}, 'ar');
  const en = renderWelcome(line, a.name, {}, 'en');
  return ar && en ? { id: line.id, ar, en, fromCache: false } : null;
}
