// THE FILTER HOME'S ROTATING WELCOME (owner 2026-10-17).
//
// The Filter home's BIG HEADLINE («موقع واحد للبحث…») sometimes becomes a short,
// personal marketing line for a SIGNED-IN user: a greeting, their name, a live fact, and the brand
// «إزهله» / "Ezhalah" at the end. The owner approved these 30 lines word for word (Arabic), with an
// English translation in which the brand name is never translated.
//
// THE FACTS MUST BE TRUE AND STAY TRUE (owner: «all this needs to be true … gets updated»):
//   • no number is typed into a line — every number is a placeholder filled from a live read;
//   • «أكثر من» / "more than" only ever precedes a number rounded DOWN strictly below the real count;
//   • a line whose fact is missing, failed, or not true today (e.g. «كل مناطق المملكة الـ13» when not
//     every region has listings) is NOT shown — the normal subtitle stays. Never a stale or made-up number.
// Pure: no React, no network, no storage. Executed by scripts/verify-filter-welcome.ts.

export type WelcomeFacts = {
  sites?: number;        // distinct websites with searchable listings (loader_active_platforms_ar)
  listings?: number;     // all searchable listings (loader_scale_stats_ar)
  cities?: number;       // cities with listings
  districts?: number;    // districts with listings
  regions?: number;      // regions with at least one listing
  regionCounts?: Record<string, number>; // region_ar → listings
  city?: { ar: string; en?: string; count: number };       // the user's last-searched city (or the top city)
  topDistrict?: { ar: string; en?: string; count: number }; // that city's district with the most listings
};

type When = 'morning' | 'evening' | 'friday' | 'weekend' | 'any';
type Need = 'sites' | 'listings' | 'cities' | 'districts' | 'allRegions' | 'city' | 'district'
  | 'riyadh' | 'makkah' | 'eastern' | 'qassim';

export type WelcomeLine = { id: number; when: When; needs: Need[]; ar: string; en: string };

// The owner-approved lines, in order. {n} = name; other {keys} are live values (see fill()).
export const WELCOME_LINES: readonly WelcomeLine[] = [
  { id: 1, when: 'morning', needs: ['sites'], ar: 'صباح الخير {n}، {sites} موقع عقاري جاهز لك اليوم في إزهله.', en: 'Good morning {n}, {sites} real-estate websites ready for you today on Ezhalah.' },
  { id: 2, when: 'morning', needs: ['listings'], ar: 'صباح الخير {n}، أكثر من {listingsMore} إعلان بانتظارك في إزهله.', en: 'Good morning {n}, more than {listingsMore} listings waiting for you on Ezhalah.' },
  { id: 3, when: 'morning', needs: ['allRegions'], ar: 'صباح الخير {n}، من الرياض إلى الجوف، كل مناطق المملكة الـ{regions} في إزهله.', en: 'Good morning {n}, from Riyadh to Al-Jouf, all {regions} regions of the Kingdom on Ezhalah.' },
  { id: 4, when: 'morning', needs: ['city', 'district'], ar: 'صباح الخير {n}، {district} من أكثر الأحياء إعلانات في {city} الحين. شوفها في إزهله.', en: 'Good morning {n}, {district} is one of the busiest districts in {city} right now. See it on Ezhalah.' },
  { id: 5, when: 'morning', needs: ['cities'], ar: 'صباح الخير {n}، {cities} مدينة في بحث واحد مع إزهله.', en: 'Good morning {n}, {cities} cities in one search with Ezhalah.' },
  { id: 6, when: 'morning', needs: [], ar: 'صباح الخير {n}، وفر وقتك، المنصات الكبيرة والمكاتب المحلية في إزهله.', en: 'Good morning {n}, save your time: big platforms and local offices on Ezhalah.' },
  { id: 7, when: 'evening', needs: ['districts'], ar: 'مساء الخير {n}، أكثر من {districtsMore} حي في السعودية تلقاها في إزهله.', en: 'Good evening {n}, more than {districtsMore} districts across Saudi Arabia on Ezhalah.' },
  { id: 8, when: 'evening', needs: ['city'], ar: 'مساء الخير {n}، {city} فيها أكثر من {cityMore} إعلان الحين، كلها في إزهله.', en: 'Good evening {n}, {city} has more than {cityMore} listings right now, all on Ezhalah.' },
  { id: 9, when: 'evening', needs: ['sites'], ar: 'مساء الخير {n}، {sites} موقع في شاشة واحدة، هذا هو إزهله.', en: "Good evening {n}, {sites} websites on one screen. That's Ezhalah." },
  { id: 10, when: 'evening', needs: [], ar: 'مساء الخير {n}، مكاتب عقارية محلية يصعب تلاقيها، تلقاها في إزهله.', en: 'Good evening {n}, local real-estate offices that are hard to find, on Ezhalah.' },
  { id: 11, when: 'evening', needs: ['riyadh'], ar: 'مساء الخير {n}، منطقة الرياض وحدها فيها أكثر من {riyadhMore} إعلان في إزهله.', en: 'Good evening {n}, the Riyadh region alone has more than {riyadhMore} listings on Ezhalah.' },
  { id: 12, when: 'evening', needs: ['city', 'district'], ar: 'مساء الخير {n}، السوق نشط في {district}، تابعه في إزهله.', en: 'Good evening {n}, the market is active in {district}. Follow it on Ezhalah.' },
  { id: 13, when: 'friday', needs: ['sites'], ar: 'جمعة مباركة {n}، {sites} موقع في بحث واحد، وفر وقتك مع إزهله.', en: 'Jumma Mubarak {n}, {sites} websites in one search. Save your time with Ezhalah.' },
  { id: 14, when: 'friday', needs: ['listings'], ar: 'جمعة مباركة {n}، أكثر من {listingsMore} إعلان، خذ راحتك فيها مع إزهله.', en: 'Jumma Mubarak {n}, more than {listingsMore} listings. Take your time with Ezhalah.' },
  { id: 15, when: 'friday', needs: ['cities'], ar: 'جمعة مباركة {n}، من المدن الكبيرة للصغيرة، {cities} مدينة في إزهله.', en: 'Jumma Mubarak {n}, from big cities to small ones, {cities} cities on Ezhalah.' },
  { id: 16, when: 'weekend', needs: ['sites'], ar: 'إجازة سعيدة {n}، استمتع بإجازتك، والتدوير في {sites} موقع على إزهله.', en: 'Happy weekend {n}, enjoy your break and leave the search across {sites} websites to Ezhalah.' },
  { id: 17, when: 'weekend', needs: ['city'], ar: 'إجازة سعيدة {n}، الأحياء الأكثر إعلانات في {city} تلقاها في إزهله.', en: 'Happy weekend {n}, the busiest districts in {city} are on Ezhalah.' },
  { id: 18, when: 'weekend', needs: ['allRegions'], ar: 'إجازة سعيدة {n}، كل مناطق المملكة الـ{regions} في بحث واحد مع إزهله.', en: 'Happy weekend {n}, all {regions} regions of the Kingdom in one search with Ezhalah.' },
  { id: 19, when: 'any', needs: [], ar: 'هلا بعودتك {n}… اللي تدور عليه، أنا ألقاه لك. عشان كذا اسمي إزهله.', en: "Welcome back {n}… whatever you're looking for, I'll find it for you. That's why my name is Ezhalah." },
  { id: 20, when: 'any', needs: ['sites'], ar: 'هلا {n}، {sites} موقع عقاري، وبحث واحد. هذا هو إزهله.', en: "Hi {n}, {sites} real-estate websites, one search. That's Ezhalah." },
  { id: 21, when: 'any', needs: ['listings'], ar: 'هلا {n}، {listings} إعلان عقاري تنتظرك في إزهله.', en: 'Hi {n}, {listings} real-estate listings waiting for you on Ezhalah.' },
  { id: 22, when: 'any', needs: ['makkah'], ar: 'حياك {n}، منطقة مكة المكرمة فيها أكثر من {makkahMore} إعلان في إزهله.', en: 'Welcome {n}, the Makkah region has more than {makkahMore} listings on Ezhalah.' },
  { id: 23, when: 'any', needs: ['eastern'], ar: 'حياك {n}، المنطقة الشرقية فيها أكثر من {easternMore} إعلان في إزهله.', en: 'Welcome {n}, the Eastern Province has more than {easternMore} listings on Ezhalah.' },
  { id: 24, when: 'any', needs: ['city'], ar: 'رجعت يا {n}؟ {city} فيها أكثر من {cityMore} إعلان، نكمل مع إزهله.', en: "Back again, {n}? {city} has more than {cityMore} listings. Let's continue with Ezhalah." },
  { id: 25, when: 'any', needs: [], ar: 'هلا {n}، حتى المدن الصغيرة لها مكان في إزهله.', en: 'Hi {n}, even small cities have a place on Ezhalah.' },
  { id: 26, when: 'any', needs: [], ar: 'حياك {n}، وفر ساعات من التدوير، كلها في إزهله.', en: 'Welcome {n}, save hours of searching, all on Ezhalah.' },
  { id: 27, when: 'any', needs: ['city', 'district'], ar: 'هلا {n}، {district} من الأكثر إعلانات في {city}، شوفها في إزهله.', en: 'Hi {n}, {district} is among the busiest districts in {city}. See it on Ezhalah.' },
  { id: 28, when: 'any', needs: ['districts', 'cities'], ar: 'رجعت يا {n}؟ أكثر من {districtsMore} حي و{cities} مدينة، بحث واحد في إزهله.', en: 'Back again, {n}? More than {districtsMore} districts and {cities} cities, one search on Ezhalah.' },
  { id: 29, when: 'any', needs: ['qassim'], ar: 'حياك {n}، القصيم وحدها فيها أكثر من {qassimMore} إعلان في إزهله.', en: 'Welcome {n}, Al-Qassim alone has more than {qassimMore} listings on Ezhalah.' },
  { id: 30, when: 'any', needs: [], ar: 'هلا {n}، السوق كله في شاشة واحدة، وفر وقتك مع إزهله.', en: 'Hi {n}, the whole market on one screen. Save your time with Ezhalah.' },
];

/** Saudi Arabia has 13 administrative regions; «كل المناطق» is said only when every one has listings. */
export const SAUDI_REGION_COUNT = 13;
const REGION_AR = { riyadh: 'منطقة الرياض', makkah: 'منطقة مكة المكرمة', eastern: 'المنطقة الشرقية', qassim: 'منطقة القصيم' } as const;

/**
 * How long one line stays before the next (owner 2026-10-17: «not every refresh … every now and then,
 * hours» → every 4 hours, and a signed-in user always sees a personal line).
 */
export const HOLD_MS = 4 * 60 * 60 * 1000;
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
        const m = moreThan(f.listings, locale); if (!m) return null; v.listingsMore = m; break;
      }
      case 'cities': if (!positive(f.cities)) return null; v.cities = fmt(f.cities); break;
      case 'districts': { const m = moreThan(f.districts, locale); if (!m) return null; v.districtsMore = m; break; }
      case 'allRegions': if (f.regions !== SAUDI_REGION_COUNT) return null; v.regions = fmt(f.regions); break;
      case 'city': {
        const c = f.city; if (!c || !positive(c.count)) return null;
        const label = locale === 'ar' ? c.ar : c.en;
        if (!label || (locale === 'en' && /[؀-ۿ]/.test(label))) return null;
        v.city = label;
        const m = moreThan(c.count, locale); if (!m && line.ar.includes('{cityMore}')) return null;
        if (m) v.cityMore = m;
        break;
      }
      case 'district': {
        const d = f.topDistrict; if (!d || !positive(d.count)) return null;
        if (locale === 'ar') v.district = /^حي\s/.test(d.ar) ? d.ar : `حي ${d.ar}`;
        else if (d.en && !/[؀-ۿ]/.test(d.en)) v.district = d.en; // never Arabic mid-English
        else return null;
        break;
      }
      default: {
        const m = moreThan(f.regionCounts?.[REGION_AR[need]], locale); if (!m) return null;
        v[`${need}More`] = m;
      }
    }
  }
  const tpl = locale === 'ar' ? line.ar : line.en;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? `\u0000${k}`);
  return out.includes('\u0000') ? null : out;
}

/** A fresh line for a new period: fits the moment, never the previous one. `rand` is injectable for tests. */
export function chooseWelcomeLine(now: Date, lastId: number | null, rand: () => number = Math.random): WelcomeLine | null {
  const pool = WELCOME_LINES.filter((l) => l.id !== lastId && lineFitsTime(l, now));
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export type HeldWelcome = { id: number; at: number };

/**
 * The line for this page load. The held line is KEPT while it is younger than HOLD_MS and still fits
 * the moment (a morning line does not survive into the evening); otherwise a new period starts with a
 * new line. `keep` says whether the caller should leave the held record untouched.
 */
export function welcomeForNow(now: Date, held: HeldWelcome | null, rand: () => number = Math.random): { line: WelcomeLine; keep: boolean } | null {
  if (held) {
    const line = WELCOME_LINES.find((l) => l.id === held.id);
    const age = now.getTime() - held.at;
    if (line && age >= 0 && age < HOLD_MS && lineFitsTime(line, now)) return { line, keep: true };
  }
  const line = chooseWelcomeLine(now, held?.id ?? null, rand);
  return line ? { line, keep: false } : null;
}

/** When the chosen line's fact is unknown right now, a factless any-time line stands in (never the previous one). */
export function fallbackLine(avoidId: number | null, rand: () => number = Math.random): WelcomeLine {
  const ids = FACTLESS_ANYTIME_IDS.filter((id) => id !== avoidId);
  const id = ids[Math.min(ids.length - 1, Math.floor(rand() * ids.length))];
  return WELCOME_LINES.find((l) => l.id === id)!;
}
