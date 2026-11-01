// WHAT «كبير» MEANS IN SAUDI ARABIA (owner 2026-10-11: «when someone says big, think Saudi — what is big in
// Riyadh, not America»). A vague adjective is an AREA intent — never a bedroom count — and it is read on the
// Saudi scale: a standard villa plot here is 300–400 m², so «big» starts at 500, not at an American 5-bed house.
//
// The numbers are MEASURED on our own listings (12% sample, 2026-10-11, area_m2 percentiles, for sale):
//   فيلا      Riyadh p50 337 · p75 406 · all-KSA p90 613      → big from 500 m²
//   شقة       p50 156 · rent p75 337                          → big from 200 m²
//   دور       p50 192 · p75 233 · rent p75 412                → big from 300 m²
//   أرض سكنية  p50 590 · p75 770 (Riyadh 800) · p90 1,001      → big from 900 m²  (900 is the Saudi «big plot»)
//   عمارة      p50 532 · p75 720 (Riyadh 875)                   → big from 900 m²
//   استراحة    p50 726 · p75 2,000                              → big from 2,000 m²
//   مزرعة      p50 10,367 · p75 50,003                          → big from 50,000 m²
// Every other type uses the TOP tab of its own product-defined size ladder (taxonomy SIZE_BY_TYPE: «600+ m²»
// for an office, «5,000+ m²» for a warehouse…). A type with neither (chalet, room, studio…) has NO threshold:
// «big» then only orders the results largest-first and filters nothing — never a guess.
//
// The summary says so out loud («المساحة: من 500 م² (كبير بمقياس السوق السعودي)») so the user sees what we did
// with the word and can change it. Whether the word is said at all is read from the user's OWN words only.
import { detailFor } from './taxonomy.ts';

const SAUDI_BIG_M2: Readonly<Record<string, number>> = {
  Villa: 500, House: 500, Apartment: 200, Floor: 300, 'Residential Land': 900, Building: 900,
  'Rest House': 2000, Farm: 50000,
};

export function bigAreaMin(type: string | null | undefined): number | null {
  if (!type) return null;
  if (type in SAUDI_BIG_M2) return SAUDI_BIG_M2[type];
  const d = detailFor(type);
  if (d.isBedrooms) return null;
  const top = /^([\d,]+)\+/.exec(d.options[d.options.length - 1] ?? '');
  return top ? parseInt(top[1].replace(/,/g, ''), 10) : null;
}

const fold = (s: string) => s
  .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();

const L = '(?<![\\p{L}])', R = '(?![\\p{L}])';
const NOUN_AR = '(?:بيت|منزل|فيلا|فله|شقه|شقق|دور|ارض|اراضي|استراحه|مزرعه|عماره|محل|مكتب|مستودع|معرض|دوبلكس|قصر)';
const BIG_AR = '(?:ال)?(?:كبير|كبيره|كبار|واسع|واسعه|ضخم|ضخمه|شاسع|شاسعه)';
const FILLER_AR = '(?:(?:جدا|مره|وايد|كثير)\\s+)?';
const NOUN_EN = '(?:villa|house|home|apartment|flat|floor|land|plot|farm|warehouse|shop|office|building|chalet|showroom|duplex|palace)s?';
const BIG_EN = '(?:big|large|huge|spacious|massive)';
const BIG_NEXT_TO_NOUN = [
  new RegExp(`${L}${NOUN_AR}\\s+${FILLER_AR}${BIG_AR}${R}`, 'u'),
  new RegExp(`${L}مساح\\p{L}*\\s+${FILLER_AR}${BIG_AR}${R}`, 'u'),
  new RegExp(`\\b${BIG_EN}\\s+(?:\\w+\\s+)?${NOUN_EN}\\b`, 'i'),
  new RegExp(`\\b${BIG_EN}\\s+(?:area|size|plot)\\b`, 'i'),
];
// «ما ابي بيت كبير» / "I don't want a big house" — the opposite of a request.
const NEGATED = new RegExp(`${L}(?:ما|لا|مو|مب|مش)\\s+(?:ابي|ابغي|ابغى|ابغا|ابا|ابى|اريد|احتاج)${R}|\\b(?:don'?t|do not|not)\\s+(?:want|need|looking)\\b`, 'iu');

/** TRUE when the user's own words call the PROPERTY big («بيت كبير», «شقة واسعة», «مساحة كبيرة», "big villa").
 *  The big word must sit right next to a property noun (or «مساحة»): «حوش كبير» / «مطبخ كبير» / «غرفة كبيرة» are
 *  features of the home, not its size, and never trigger this. */
export function bigWanted(text: string | null | undefined): boolean {
  const s = fold(String(text ?? ''));
  if (!s || NEGATED.test(s)) return false;
  return BIG_NEXT_TO_NOUN.some((re) => re.test(s));
}
