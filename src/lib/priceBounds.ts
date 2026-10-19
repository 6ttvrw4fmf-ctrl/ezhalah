// «MORE THAN 3 MILLION» IS A FLOOR, NOT A CEILING (owner 2026-10-11: «keep testing, fix every mistake»; found by the live agent battery).
//
// The agent's price slot is ONE number that the app applies as a CEILING. So «فيلا أكثر من ٣ مليون», «أرض فوق ٢ مليون», «villa over 2 million»
// and «لا تقل عن مليون» all searched for villas UNDER that price — the exact opposite of what was asked — and «من ١ الى ٣ مليون» lost its
// lower bound. This reads the user's own words for the bounds the single slot cannot carry:
//   a RANGE      «من ١ الى ٣ مليون» · «بين ٢ و ٤ مليون» · «30-50 ألف» · "from 1 to 3 million" · "between 2 and 4 million"
//   a FLOOR      «فوق / أكثر من / لا تقل عن / على الأقل ٣ مليون» · «٣ مليون فأكثر / وفوق» · "over / above / at least 3 million" · "3 million+"
//   a CEILING    «تحت / أقل من / لا تتجاوز / ما تزيد عن» · "under / up to / not more than" (already handled by the single slot)
// Pure and dependency-free. `edgePrice` is the SAR figure the edge function already extracted deterministically (currencies converted,
// «مليون ونص» read), used for a single amount so a foreign currency or a number written in words is never re-read here.
export type PriceBounds = { min?: number; max?: number };

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const west = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
const UNIT = '(?:الاف|الف|ألف|آلاف|مليار|مليون|ملايين|thousand|billion|million|mn|bn|[km])';
const unitValue = (u: string | undefined): number => {
  const x = (u ?? '').toLowerCase();
  if (!x) return 1;
  if (/^(?:الف|الاف|thousand|k)$/.test(x)) return 1e3;
  if (/^(?:مليون|ملايين|million|mn|m)$/.test(x)) return 1e6;
  if (/^(?:مليار|billion|bn)$/.test(x)) return 1e9;
  return 1;
};
const NUM = `(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT})?(?![\\p{L}\\d])`;
const BARE = '(مليون|مليونين|الفين)';
const SIZE_AFTER = /^\s{0,2}(?:متر|م²|م2|م(?![ء-ي])|sqm|sq|m²|m2|meter|square|قدم|feet)/i;

const MIN_BEFORE = '(?:فوق|اكثر\\s*من|اكبر\\s*من|اعلى\\s*من|لا\\s*(?:يقل|تقل)\\s*عن|ما\\s*(?:ي|ت)قل\\s*عن|على\\s*الاقل|بحد\\s*ادني|الحد\\s*الادني|(?<!not\\s)(?<!no\\s)more\\s*than|over|above|at\\s*least|minimum|min|starting\\s*(?:from|at)|no\\s*(?:less|smaller)\\s*than|not\\s*less\\s*than)';
const MAX_BEFORE = '(?:تحت|اقل\\s*من|اصغر\\s*من|لا\\s*(?:يتجاوز|تتجاوز|يزيد|تزيد|يتعدي|تتعدي)(?:\\s*عن)?|ما\\s*(?:ي|ت)(?:زيد|تجاوز|تعدي)(?:\\s*عن)?|بحد\\s*اقصي|الحد\\s*الاقصي|حد\\s*اقصي|up\\s*to|under|below|less\\s*than|at\\s*most|max(?:imum)?|not\\s*more\\s*than|no\\s*more\\s*than)';
const MIN_AFTER = '(?:فاكثر|فما\\s*فوق|و\\s*فوق|وفوق|فوق|or\\s*more|and\\s*(?:up|above|over)|\\+)';

function amountsIn(s: string): Array<{ value: number; end: number; start: number }> {
  const out: Array<{ value: number; end: number; start: number }> = [];
  for (const m of s.matchAll(new RegExp(NUM, 'giu'))) {
    const after = s.slice((m.index ?? 0) + m[0].length);
    if (SIZE_AFTER.test(after)) continue;                                  // «500 متر» is a size, not money
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push({ value: n * unitValue(m[2]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const m of s.matchAll(new RegExp(`(?<![\\p{L}])${BARE}(?![\\p{L}])`, 'gu'))) {
    const v = m[1] === 'مليونين' ? 2e6 : m[1] === 'الفين' ? 2e3 : 1e6;
    if (!out.some((o) => (m.index ?? 0) >= o.start && (m.index ?? 0) < o.end)) out.push({ value: v, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function parsePriceBounds(text: string | null | undefined, edgePrice?: number | null): PriceBounds {
  const raw = String(text ?? '');
  if (!raw.trim()) return {};
  const s = west(raw);
  // a price PER METRE is not a budget range; a foreign currency leaves the arithmetic to the edge (single amounts only)
  if (/سعر\s*المتر|للمتر|per\s*(?:sq\s*)?m(?:eter|etre)?\b|\/\s*m\b|ppm/i.test(s)) return {};
  const foreign = /دولار|دينار|يورو|درهم|جنيه|usd|kwd|aed|eur|bhd|dollar|dinar|euro|dirham|[$€£]/i.test(s);
  const amts = amountsIn(s);
  if (!amts.length) return {};

  // RANGE — «من A الى B», «بين A و B», «A - B», "from A to B", "between A and B"
  const range = new RegExp(`(?:من|بين|from|between)\\s*${NUM}\\s*(?:الي|حتي|و|to|and|-|–|—)\\s*${NUM}`, 'iu').exec(s)
    ?? new RegExp(`${NUM}\\s*(?:-|–|—|الي|to)\\s*${NUM}`, 'iu').exec(s);
  // …but «من 1000 الى 1500 متر» is an AREA range: the unit after it says so (owner 2026-10-13: it became a land «سعر المتر»).
  if (range && SIZE_AFTER.test(s.slice((range.index ?? 0) + range[0].length))) return {};
  if (range && !foreign) {
    const a = parseFloat(range[1].replace(/,/g, '')), b = parseFloat(range[3].replace(/,/g, ''));
    let ua = unitValue(range[2]), ub = unitValue(range[4]);
    if (range[2] === undefined && range[4] !== undefined) ua = a > b ? ub / 1000 : ub;     // «من ١ الى ٣ مليون» — the unit is shared; «من ٥٠٠ الى ٣ مليون» — 500 thousand
    if (range[4] === undefined && range[2] !== undefined) ub = ua;
    const lo = a * ua, hi = b * ub;
    if (lo > 0 && hi > 0 && Math.max(lo, hi) >= 1000) return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
  }

  const single = amts.length === 1 ? (edgePrice && edgePrice > 0 ? edgePrice : amts[0].value) : null;
  if (single == null) return {};
  const a = amts[0];
  const before = s.slice(Math.max(0, a.start - 22), a.start), after = s.slice(a.end, a.end + 16);
  // a CEILING word right before the amount wins over everything (also «not more than», which contains «more than»)
  if (new RegExp(`${MAX_BEFORE}\\s*(?:ال)?\\s*$`, 'iu').test(before) || new RegExp(`${MAX_BEFORE}\\s*(?:من|عن)?\\s*$`, 'iu').test(before)) return { max: single };
  if (new RegExp(`^\\s*${MIN_AFTER}`, 'iu').test(after) || new RegExp(`${MIN_BEFORE}\\s*(?:من|عن)?\\s*(?:ال)?\\s*$`, 'iu').test(before)) return { min: single };
  return {};
}
