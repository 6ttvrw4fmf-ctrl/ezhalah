// «Show the calculation» for a budget typed in another currency (owner 2026-10-11).
//
// The agent edge converts «خمس مليون دينار» to SAR 61,000,000 and sends the user's own figure as
// `priceOriginal` ("KWD 5,000,000"). The summary used to show only the converted number, so the user could
// not see what we did with theirs. This renders the same conversion as a line they can check:
//   «5,000,000 دينار كويتي × 12.2 = ر.س 61,000,000»   /   «KWD 5,000,000 × 12.2 = SAR 61,000,000»
//
// The rates are the SAME table the search uses (CURRENCY_RATES in src/data/agent.ts and the edge's
// CURRENCY_RATES / AR_CURRENCY); scripts/verify-currency-calc-line.ts keeps the three equal.
export const CURRENCY_RATE_BY_CODE: Readonly<Record<string, number>> = {
  USD: 3.75, AED: 1.02, EUR: 4.1, GBP: 4.8, KWD: 12.2, BHD: 9.95, JOD: 5.3, QAR: 1.03, OMR: 9.75, EGP: 0.08,
};
const AR_NAME: Readonly<Record<string, string>> = {
  USD: 'دولار', AED: 'درهم', EUR: 'يورو', GBP: 'جنيه إسترليني', KWD: 'دينار كويتي', BHD: 'دينار بحريني',
  JOD: 'دينار أردني', QAR: 'ريال قطري', OMR: 'ريال عماني', EGP: 'جنيه مصري',
};

export function parseOriginalBudget(original: string | null | undefined): { code: string; amount: number } | null {
  const m = /^([A-Z]{3})\s+([\d,]+)$/.exec((original ?? '').trim());
  if (!m || !(m[1] in CURRENCY_RATE_BY_CODE)) return null;
  const amount = parseInt(m[2].replace(/,/g, ''), 10);
  return amount > 0 ? { code: m[1], amount } : null;
}

/**
 * The calculation line, or null when `original` is not a currency we convert. `totalSar` (the SAR figure the
 * search really uses) is appended as «= total» ONLY when it equals amount × rate (within 1%) — a rent that
 * was also ×12 or a range must never show a total that the arithmetic does not produce.
 */
export function currencyCalcLine(
  original: string | null | undefined, totalSar: number | null, locale: 'ar' | 'en', sarLabel: string,
): string | null {
  const o = parseOriginalBudget(original);
  if (!o) return null;
  const rate = CURRENCY_RATE_BY_CODE[o.code];
  const product = o.amount * rate;
  const grouped = (n: number) => Math.round(n).toLocaleString('en-US');
  const showTotal = totalSar != null && totalSar > 0 && Math.abs(totalSar - product) <= product * 0.01;
  const left = locale === 'ar' ? `${grouped(o.amount)} ${AR_NAME[o.code]}` : `${o.code} ${grouped(o.amount)}`;
  return `${left} × ${rate}${showTotal ? ` = ${sarLabel} ${grouped(totalSar!)}` : ''}`;
}
