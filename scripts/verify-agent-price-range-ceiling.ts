// Regression guard for the "price range collapses to the LOWER bound" bug found live 2026-07-27
// (round-8 filter/backend audit).
//
// supabase/functions/agent/index.ts's deterministic extractPrice() takes precedence over the model's
// own `price` field (the model is unreliable at exact arithmetic) — but it used to return the FIRST
// valid money figure it found in the raw text, with zero range awareness. So an explicit price range
// ("من 300,000 الى 1,500,000" / "from 300k to 1.5m") returned the LOWER bound as the price. Since this
// function's single price slot is always applied as a CEILING (never a minimum — see the SYSTEM
// prompt's `price` field docs and the client's agentPriceCapAnnual()), a stated 300k-1.5m budget
// silently became a "≤300,000 SAR only" search — live-reproduced: a 254,000 SAR listing came back,
// below the user's own stated floor, the wrong price band entirely.
//
// Fixed by collecting every valid money candidate instead of returning on the first match, and taking
// the HIGHEST one when 2+ candidates exist AND the text reads as an explicit range (a bare second
// number elsewhere in the message, with no range connector, still falls back to the original
// first-match behavior — unrelated figures must not silently become the budget).
//
// This second fix ALSO needed a Unicode-aware boundary fix for the Arabic range connectors (من...الى /
// بين...و) — a first attempt used plain /\bمن\b/, which (like the region_or_city Arabic-boundary bug
// elsewhere in this same file) can never match Arabic script with JS's ASCII-only \b, so the range
// branch was silently dead for every real Arabic user despite passing a code review that only checked
// the English connectors.
//
//   node --experimental-strip-types scripts/verify-agent-price-range-ceiling.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const src = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
check('extractPrice collects candidates instead of returning on first match', /const candidates: number\[\] = \[\];/.test(src));
check('RANGE_RE uses Unicode-aware lookarounds for the Arabic connectors (not a bare \\b)', /\(\?<!\[\\p\{L\}\\p\{N\}\]\)من\(\?!\[\\p\{L\}\\p\{N\}\]\)/.test(src));
check('the old bare-\\b Arabic pattern is gone as executable code', !/const RANGE_RE = \/\\bمن\\b/.test(src));
check('2+ candidates + range phrase -> take the MAX, never the first', /candidates\.length > 1 && RANGE_RE\.test\(input\)\) return String\(Math\.max\(\.\.\.candidates\)\)/.test(src));

// Verbatim copy of the fixed extractPrice()/RANGE_RE logic — executed against real repro text.
const CURRENCY_RATES: Record<string, number> = {
  sar: 1, sr: 1, riyal: 1,
  usd: 3.75, dollar: 3.75, aed: 1.02, dh: 1.02, dhm: 1.02, dhs: 1.02, dirham: 1.02,
  eur: 4.1, euro: 4.1, gbp: 4.8, pound: 4.8,
  kwd: 12.2, kd: 12.2, dinar: 12.2, bhd: 9.95, bd: 9.95,
  qar: 1.03, qr: 1.03, omr: 9.75, egp: 0.08,
};
const AR_CURRENCY: Array<[RegExp, number]> = [
  [/دينار\s*كويتي/, 12.2],
  [/دينار\s*بحريني/, 9.95],
  [/دينار\s*أردني|دينار\s*اردني/, 5.3],
  [/دينار/, 12.2],
  [/درهم/, 1.02],
  [/دولار/, 3.75],
  [/يورو/, 4.1],
  [/جنيه\s*(?:استرليني|إسترليني)/, 4.8],
  [/جنيه/, 0.08],
  [/ريال|ريالات|﷼/, 1],
];
const RANGE_RE = /(?<![\p{L}\p{N}])من(?![\p{L}\p{N}])[\s\S]{0,40}?(?<![\p{L}\p{N}])(?:الى|إلى)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])بين(?![\p{L}\p{N}])[\s\S]{0,60}?(?<![\p{L}\p{N}])و(?![\p{L}\p{N}])|\bfrom\b[\s\S]{0,40}?\bto\b|\bbetween\b[\s\S]{0,60}?\band\b|\d\s*-\s*\d/imu;
function extractPrice(input: string): string {
  const t = input.toLowerCase();
  const NUM_RE =
    /(\d[\d,.]*)\s*(?:(k|m|mn|million|thousand|bn|billion)(?![a-z]))?\s*(sar|sr|riyal|usd|\$|dollar|aed|dirham|dhm|dhs|dh|eur|€|euro|gbp|£|pound|kwd|kd|dinar|bhd|bd|qar|qr|omr|egp)?/gi;
  const candidates: number[] = [];
  for (const mm of t.matchAll(NUM_RE)) {
    const after = t.slice(mm.index! + mm[0].length, mm.index! + mm[0].length + 24);
    if (/^[^\d]{0,16}?(bed|bedroom|br\b|sqm|sq\.?\s*m|m2|m²|meter|metre|cm|centimeters?|centimetres?|square|sqft|sq\.?\s*ft|ft2|ft²|foot|feet|sq\b|متر|م٢|م2|غرف|غرفة|غرفه)/i.test(after)) continue;
    let n = parseFloat(mm[1].replace(/,/g, ''));
    if (!isFinite(n)) continue;
    const scale = (mm[2] || '').toLowerCase();
    if (scale === 'k' || scale === 'thousand') n *= 1_000;
    else if (scale === 'm' || scale === 'mn' || scale === 'million') n *= 1_000_000;
    else if (scale === 'bn' || scale === 'billion') n *= 1_000_000_000;
    else if (/^\s*(?:ألف|الف|آلاف)/.test(after)) n *= 1_000;
    else if (/^\s*(?:مليون|ملايين)/.test(after)) n *= 1_000_000;
    else if (/^\s*(?:مليار)/.test(after)) n *= 1_000_000_000;
    let rate = 0;
    const cur = (mm[3] || '').toLowerCase();
    if (cur) rate = CURRENCY_RATES[cur] ?? 0;
    if (!rate) { for (const [re, r] of AR_CURRENCY) { if (re.test(after)) { rate = r; break; } } }
    if (rate && rate !== 1) n = Math.round(n * rate);
    if (n >= 100) candidates.push(Math.round(n));
  }
  if (!candidates.length) return '';
  if (candidates.length > 1 && RANGE_RE.test(input)) return String(Math.max(...candidates));
  return String(candidates[0]);
}

const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

eq('real repro: "من 300000 الى 1500000" -> HIGH bound (1500000), not the low one', extractPrice('أبغى شقة للبيع في جدة 3 غرف بسعر من 300000 الى 1500000'), '1500000');
eq('range with commas + ريال', extractPrice('من 300,000 إلى 1,500,000 ريال'), '1500000');
eq('بين X و Y range', extractPrice('بين 300 الف و 1.5 مليون ريال'), '1500000');
eq('English "from X to Y"', extractPrice('from 300k to 1.5m SAR'), '1500000');
eq('English "between X and Y"', extractPrice('between 300,000 and 1,500,000 SAR'), '1500000');
eq('bare hyphen range', extractPrice('300000-1500000 ريال'), '1500000');
eq('single number unchanged (ceiling)', extractPrice('فيلا للبيع تحت 2 مليون'), '2000000');
eq('single number with currency unchanged', extractPrice('شقة بميزانية 100000 دولار'), '375000');
eq('no price mentioned at all', extractPrice('شقة في الرياض 3 غرف'), '');
eq('a size is never treated as a price', extractPrice('أرض 500 متر'), '');
eq('two unrelated numbers, no range phrase -> first (unchanged legacy fallback)', extractPrice('3 غرف نوم وفيلا للبيع 900000 ريال قريبة من مدرسة تتسع 500 طالب'), '900000');
eq('trap: a place name containing "من" fused with no space must not false-positive as a range connector', extractPrice('شقة في اليمن للبيع بسعر 500000 ريال'), '500000');

console.log(
  failed === 0
    ? '\n✓ agent price-range-ceiling fix verified (extractPrice takes the upper bound of an explicit range)'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
