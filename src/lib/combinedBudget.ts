// Combined شراء+إيجار budget wording. PURE — zero runtime deps (same precedent as lib/afSummary.ts),
// so scripts/verify-combined-budget-summary.ts can EXECUTE it instead of regexing it.
//
// dealCombined (owner feature 2026-08-20) carries TWO INDEPENDENT budgets: priceMin/priceMax cap the
// BUY half only, priceMinRent/priceMaxRent cap the RENT half (annual basis). remote.ts sends them as
// two separate RPC caps (p_price_max + p_price_max_rent), so every user-facing restatement of the
// budget must name WHICH half each figure caps, and must never drop a half the user filled in.
//
// Before this existed, both restatements (the green user bubble and the «ملخص البحث» panel) rendered
// one unlabelled `Budget` line off priceMin/priceMax alone. A combined search with Buy ≤ 500,000 and
// Rent ≤ 50,000 therefore announced «الميزانية: إلى 500,000 ر.س» — the rent cap silently hidden, the
// buy cap passed off as the budget for the whole «إيجار أو شراء» search — and a combined search whose
// only budget was the rent one announced NO budget at all while still capping the rent half
// (reproduced on production 2026-08-23). VISIBLE UI STATE MUST EQUAL COMMITTED REQUEST STATE.

export type CombinedBudgetQuery = {
  priceMin?: string | null; priceMax?: string | null;
  priceMinRent?: string | null; priceMaxRent?: string | null;
};

/** Already-translated words, injected so this module stays dependency-free. */
export type BudgetWords = { buy: string; rent: string; from: string; to: string; sar: string };

// Same raw-digit-string → positive-number reading as search.ts's numOrNull (an empty/0/garbage box
// means "no cap was sent", so it must not produce a bullet).
const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const grouped = (n: number) => n.toLocaleString('en-US'); // Western digits everywhere (PRD rule).

/** One labelled fragment per budget half the user actually filled — Buy first, then Rent. */
export function combinedBudgetParts(q: CombinedBudgetQuery, sep: string, w: BudgetWords): string[] {
  const side = (label: string, lo: number | null, hi: number | null): string | null => {
    if (lo == null && hi == null) return null;
    const range = lo != null && hi != null ? `${w.from} ${grouped(lo)} ${w.to} ${grouped(hi)}`
      : lo != null ? `${w.from} ${grouped(lo)}` : `${w.to} ${grouped(hi!)}`;
    return `${label}${sep}${range} ${w.sar}`;
  };
  return [
    side(w.buy, num(q.priceMin), num(q.priceMax)),
    side(w.rent, num(q.priceMinRent), num(q.priceMaxRent)),
  ].filter((x): x is string => x !== null);
}
