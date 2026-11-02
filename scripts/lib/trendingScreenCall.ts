// WHICH top_cities_by_deal_ar CALL IS THE SCREEN SHOWING? (backlog 1144, 2026-11-02)
//
// The home screen fires top_cities_by_deal_ar for MORE than the scope on screen: once the current
// pool lands, the «warm the next tap» effect in src/app/index.tsx loads the Rent, Buy + Rent and Buy
// pools too (owner 2026-10-03), one after another. A live check that compares the visible Trending
// rows with "the LAST captured call" therefore compares the Buy screen with the Rent warm-up call.
// Measured on af-live-truth-check 41291980948 (11-01): shown الرياض 96,842 / جدة 76,341 (Buy,
// correct) vs «rpc» 69,773 / 19,390 — the Rent pool (Jeddah rent holds 23,946 listings in total).
// The product was right; the tool read the wrong call, and the backlog item blamed the product.
//
// The rule: the call to compare with is the LAST call whose scope equals the screen's scope — the
// deal the user picked (Buy by default), no rent period on Buy, and the property types the user had
// picked at that moment (none, when Trending Cities is read before the type is chosen). A typed
// price ceiling / minimum area must be in the call too. No matching call → null (never a guess).

export type CapturedCall = { body: Record<string, unknown>; rows: unknown[] };
export type ScreenScope = { deal: string | null; types: string[] | null; priceMax?: number | null; areaMin?: number | null };

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function callMatchesScreen(body: Record<string, unknown>, s: ScreenScope): boolean {
  if ((body.p_deal ?? null) !== s.deal) return false;
  if (s.deal === 'بيع' && body.p_rent_period != null) return false;
  if (!sameSet(asList(body.p_types), s.types ?? [])) return false;
  if (s.priceMax != null && Number(body.p_price_max) !== s.priceMax) return false;
  if (s.areaMin != null && Number(body.p_area_min) !== s.areaMin) return false;
  return true;
}

export function pickScreenCityCall<T extends CapturedCall>(calls: T[], s: ScreenScope): T | null {
  for (let i = calls.length - 1; i >= 0; i--) if (callMatchesScreen(calls[i].body, s)) return calls[i];
  return null;
}
