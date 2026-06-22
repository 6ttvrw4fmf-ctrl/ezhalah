import type { Category, Deal } from './taxonomy';
import type { LocationResolution } from './locations';
import { detailFor, priceBandRange } from './taxonomy';
import { POOLS, LISTED_SEQ, type Listing, type Pools } from './listings';
import { supports } from './platforms';
import { t, tWord, tPlace, tPriceTab, tDetailOption, getLocale } from '@/i18n';
import { translitPlace } from '@/lib/translitPlace';
import { CITY_TO_REGION, isCountryWideQuery, interleave } from './regions';

// A parsed search. Every field optional — empty fields broaden, never dead-end. (PRD §6.1)
export type SearchQuery = {
  deal: Deal;
  location: string;
  category: Category | null;
  type: string | null;
  detail: string | null; // bedrooms value or size band
  priceInput: string; // raw digits
  priceBand: string | null; // selected preset price band ("SAR 75k–150k"); overrides priceInput
  // When the AI agent searches without knowing rent vs buy (it already used its question), it shows
  // BOTH — the deal filter is skipped and the summary reads "Rent or Buy". (user request.)
  bothDeals?: boolean;
  // The agent already converted a daily/weekly/monthly/quarterly rent the user stated INTO an annual
  // figure (rent is always compared annually). When set, priceInput is the ANNUAL cap — the client
  // must NOT re-apply its monthly-magnitude ×12 guess. (user request.)
  priceIsAnnual?: boolean;
  // Filter-side rent period the user picked: 'monthly' or 'annual'. Drives the budget-field label
  // ("Monthly Rent Budget" vs "Yearly Rent Budget") and tells the search engine whether the typed
  // number is a monthly figure (×12 for the annual compare) or already a yearly one. Buy ignores
  // this. Default 'annual'. (user request: Filter rent toggle, no calculator on the user's side.)
  rentPeriod?: 'monthly' | 'annual';
  // What the filter's AI-assisted location resolver understood from a free-typed location (district /
  // city / area nickname / landmark / geography). Drives the Search Summary's location lines so the
  // user sees exactly what Ezhalah matched. Absent on the agent path (Gemini resolves there). (user request.)
  locationMatch?: LocationResolution;
  // The user's ORIGINAL foreign-currency budget, e.g. "USD 100,000" — shown alongside the SAR figure
  // in the Budget line for transparency ("USD 100,000 (≈ SAR 375,000)"). Empty when SAR. (user request.)
  priceOriginal?: string;
  // An OBJECTIVE order the user explicitly asked for (e.g. "cheapest first", "biggest", "newest").
  // Absent → default freshness ranking. Strictly factual sorts only — never "best"/"popular" (that
  // would breach non-advisory neutrality). (user training decision.)
  sort?: SortKey;
  // How many listings the user explicitly asked to see (1–25). Absent → the default grid.
  // Drives how many cards the chat reveals up front. (user training decision.)
  count?: number;
  // Specific district / neighborhood filter — populated when the user named one explicitly ("حي
  // الرمال") OR a recognized area-nickname expanded to its districts ("North Riyadh" → Al Malqa,
  // Hittin, Al Yasmin, Al Narjis, Al Aqiq, …). The engine filters listings by `district` ∩ this
  // list. Stored loosely (Arabic raw or English transliteration) and matched with substring +
  // "حي " prefix stripping so either side reads the other. Empty/undefined → no district filter.
  // (user request: "North Riyadh should show listings IN North Riyadh — the agent should know
  // direct.")
  districts?: string[];
};

// The objective sort keys the agent/UI may request. NEVER a quality/popularity ordering.
export type SortKey =
  | 'newest' | 'oldest'
  | 'price_asc' | 'price_desc'
  | 'area_asc' | 'area_desc'
  | 'ppm_asc' | 'ppm_desc'
  | 'beds_desc';

// Defaults are Rent + Residential so a bare Search (nothing else chosen) returns residential
// rentals nationwide — the filter only narrows from there, it's never required. (PRD §6.1)
export const emptyQuery = (): SearchQuery => ({
  deal: 'Rent',
  location: '',
  category: 'Residential',
  type: null,
  detail: null,
  priceInput: '',
  priceBand: null,
  rentPeriod: 'annual',
});

export const locationPhrase = (q: SearchQuery) => q.location.trim() || 'Saudi Arabia';
const placeText = (q: SearchQuery) => (q.location.trim() ? tPlace(q.location.trim()) : t('Saudi Arabia'));
const verbText = (q: SearchQuery) => t(q.bothDeals ? 'to rent or buy' : q.deal === 'Rent' ? 'to rent' : 'to buy');
const whatText = (q: SearchQuery) => tWord(q.type ?? q.category ?? 'Property');

// A short human label for a query, used in search history. "Villa to rent in Riyadh", etc.
export function queryLabel(q: SearchQuery): string {
  return t('{what} {verb} in {place}', { what: whatText(q), verb: verbText(q), place: placeText(q) });
}

// The "show your work" budget note: how a typed amount was interpreted. A small Rent figure is read
// as a MONTHLY rent and multiplied ×12 to a yearly cap; a small Buy figure is read as a price PER m²
// and multiplied by the chosen size to a total. Returns '' when there's no usable amount. Used by
// both the filter subheading and the AI-agent chat reply so every path explains the math the same
// way and always presents the ANNUAL rent / TOTAL price. (PRD §6.2)
export function priceCalcNote(q: SearchQuery): string {
  if (q.priceBand) return '';
  const amount = parseInt((q.priceInput.match(/\d/g) ?? []).join(''), 10) || 0;
  if (!amount) return '';
  const sar = t('SAR');
  const sizeNum = fixedSize(q);
  if (q.deal === 'Rent') {
    if (amount < 200) return '';
    // The agent already annualized a stated period (day/week/month/quarter) → treat as annual.
    if (!q.priceIsAnnual && amount <= 25_000) {
      return t("You entered {a}/month × 12 = {b}/year, so I'm searching up to {b}. ", { a: `${sar} ${grouped(amount)}`, b: `${sar} ${grouped(amount * 12)}` });
    }
    return t("I'm searching up to {a}/year. ", { a: `${sar} ${grouped(amount)}` });
  }
  if (amount < 100) return '';
  if (amount <= 50_000) {
    // A small Buy figure reads as a price PER m². With a known fixed size we multiply to a single
    // total and show the math; otherwise we match each listing against its OWN area (a villa with
    // 5+ bedrooms gives no area to multiply, so we compare per-listing instead). (PRD §6.2)
    return sizeNum
      ? t("You entered {a}/m² × {size} m² = {total}, so I'm searching up to {total}. ", { a: `${sar} ${grouped(amount)}`, size: sizeNum, total: `${sar} ${grouped(amount * sizeNum)}` })
      : t("You entered {a}/m², so for each listing I do {a}/m² × its area and keep the ones within budget. ", { a: `${sar} ${grouped(amount)}` });
  }
  return t("I'm searching up to {a}. ", { a: `${sar} ${grouped(amount)}` });
}

// The fixed area (m²) to multiply a per-m² Buy price by — ONLY when the chosen detail is an exact,
// free-typed size. A size band ("300–600 m²") or a bedroom count ("5+") is NOT a single area, so we
// return 0 and let the search compare each listing against its own area instead. This is what keeps
// "villa with 5+ bedrooms at SAR 1,000/m²" from misreading 5 bedrooms as 5 m². (PRD §6.2)
function fixedSize(q: SearchQuery): number {
  if (!q.detail) return 0;
  if (q.type && detailFor(q.type).isBedrooms) return 0; // detail is bedrooms, not an area
  const clean = q.detail.replace(/,/g, '');
  return /^\d+$/.test(clean) ? parseInt(clean, 10) || 0 : 0;
}

// Filter search → Ezhalah chat. Builds the natural-language user bubble + the result subheading,
// mirroring the prototype's runFilterSearch (ezhalah-mobile.jsx §runFilterSearch). Results render
// inline in the chat — there is no separate results page. The price echo shows the math (e.g.
// monthly → annual) so the user sees how the budget was interpreted (PRD §6.2).
export function filterToChat(q: SearchQuery): { bubble: string; sub: string } {
  const verb = verbText(q);
  const place = placeText(q);
  const hasCity = !!q.location.trim();
  const sar = t('SAR');

  const whatPhrase = q.type
    ? tWord(q.type)
    : q.category
      ? t('{cat} property', { cat: tWord(q.category) })
      : t('a property');

  let detailPhrase = '';
  if (q.detail && q.type) {
    if (detailFor(q.type).isBedrooms) {
      detailPhrase = t(q.detail === '1' ? ' with {n} bedroom' : ' with {n} bedrooms', { n: q.detail });
    } else if (/m²/.test(q.detail)) {
      // A size band already carries the unit ("100–300 m²") — localize it, don't append m² again.
      detailPhrase = t(' around {n}', { n: tDetailOption(q.detail) });
    } else {
      // A free-typed exact size (digits only) — add the unit.
      detailPhrase = t(' around {n} m²', { n: q.detail });
    }
  }

  const amount = parseInt((q.priceInput.match(/\d/g) ?? []).join(''), 10) || 0;
  let pricePhrase = '';
  let tooLow = false;
  let tooLowAmount = '';
  if (q.priceBand) {
    // A preset price band is its own complete phrase — no monthly→annual / per-m² math.
    pricePhrase = t(' for {a}', { a: tPriceTab(q.priceBand) });
  } else if (amount) {
    if (q.deal === 'Rent') {
      if (amount < 200 && !q.priceIsAnnual) {
        tooLow = true;
        tooLowAmount = t('{a}/month', { a: `${sar} ${grouped(amount)}` });
      } else if (!q.priceIsAnnual && amount <= 25_000) {
        pricePhrase = t(' for {a}/month', { a: `${sar} ${grouped(amount)}` });
      } else {
        pricePhrase = t(' for up to {a}/year', { a: `${sar} ${grouped(amount)}` });
      }
    } else {
      if (amount < 100) {
        tooLow = true;
        tooLowAmount = `${sar} ${grouped(amount)}`;
      } else if (amount <= 50_000) {
        pricePhrase = t(' at {a}/m²', { a: `${sar} ${grouped(amount)}` });
      } else {
        pricePhrase = t(' for up to {a}', { a: `${sar} ${grouped(amount)}` });
      }
    }
  }
  // The "show the math" note (monthly→annual, per-m²×size→total). Shared with the AI-agent chat path
  // so a free-text budget gets the same explanation a filter search does. (PRD §6.2)
  const calcNote = tooLow ? '' : priceCalcNote(q);

  const bubble = t("I'm looking for {what}{detail} {verb} in {place}{price}", {
    what: whatPhrase,
    detail: detailPhrase,
    verb,
    place,
    price: tooLow ? '' : pricePhrase,
  });

  const subWhat = q.type
    ? tWord(q.type)
    : q.category
      ? t('{cat} properties', { cat: tWord(q.category) })
      : t('properties');
  const subPlace = hasCity ? t('in {place}', { place }) : t('across Saudi Arabia');
  const sub = tooLow
    ? t("I couldn't find anything at {amount}, but here are some similar to what you're looking for:", { amount: tooLowAmount })
    : t('{calc}Here are {what} {verb} {place} that match what you’re looking for.', { calc: calcNote, what: subWhat, verb, place: subPlace });

  return { bubble, sub };
}

export const grouped = (n: number) => n.toLocaleString('en-US');

// Price Intelligence for the Search Summary panel: render the budget the SAME way the engine actually
// filters (priceFilter), but spell out the math so the user can verify it before results. Filter Mode
// never blindly trusts the typed number — a small Rent figure is read as MONTHLY rent and shown with
// its annual equivalent (×12); a small Buy figure is read as a price PER m² and, when an exact size is
// known, multiplied to a calculated total. An explicit annual (agent-converted) or a preset band is
// shown verbatim. Returns the bullet text(s) WITHOUT the leading "• ". (user spec: Filter Price Intelligence.)
function budgetLines(q: SearchQuery): string[] {
  const sar = t('SAR');
  // If the user gave a foreign currency, lead with their original figure so both are visible:
  // "Your budget: USD 100,000" then the SAR line(s) used for the actual search. (user request.)
  const orig = q.priceOriginal ? [`${t('Your budget')}: ${q.priceOriginal}`] : [];
  if (q.priceBand) return [...orig, `${t('Budget')}: ${tPriceTab(q.priceBand)}`];
  const amount = parseInt((q.priceInput.match(/\d/g) ?? []).join(''), 10) || 0;
  if (!amount) return orig;

  if (q.deal === 'Rent') {
    if (amount < 200 && !q.priceIsAnnual) return orig; // unrealistic — engine broadens, nothing to show
    const yearly = `${t('Budget')}: ${t('{a}/year', { a: `${sar} ${grouped(amount)}` })}`;
    // Agent already annualized, or the figure is too large to be a monthly rent → show it as annual.
    if (q.priceIsAnnual || amount > 25_000) return [...orig, yearly];
    // Otherwise read it as a monthly rent and show the ×12 annual equivalent (most platforms store annual).
    return [
      ...orig,
      `${t('Monthly Rent')}: ${t('{a}/month', { a: `${sar} ${grouped(amount)}` })}`,
      `${t('Annual Equivalent')}: ${t('{a}/year', { a: `${sar} ${grouped(amount * 12)}` })}`,
    ];
  }

  // Buy
  if (amount < 100) return orig; // unrealistic
  if (amount <= 50_000) {
    // A small Buy figure is a price PER m². With a known exact size we multiply to a calculated total
    // (the existing Size line above already states the area, so we don't repeat it here).
    const size = fixedSize(q);
    if (size > 0) {
      return [
        ...orig,
        `${t('Price Per m²')}: ${sar} ${grouped(amount)}`,
        `${t('Calculated Total')}: ${sar} ${grouped(amount * size)}`,
      ];
    }
    return [...orig, `${t('Price Per m²')}: ${t('{a}/m²', { a: `${sar} ${grouped(amount)}` })}`];
  }
  return [...orig, `${t('Budget')}: ${sar} ${grouped(amount)}`];
}

// The location line(s) for the Search Summary. When the filter's AI resolver understood a free-typed
// location, spell out the match so the user sees exactly what Ezhalah picked — a corrected spelling
// ("Al Malka" → Al Malqa), the districts an area nickname covers ("North Riyadh" → …), or a landmark
// and its nearby districts/cities ("Near KFUPM" → Dhahran / Khobar / Dammam). Falls back to the plain
// City line when there's no resolution. Returns bullet text WITHOUT the leading "• ". (user request.)
function locationLines(q: SearchQuery): string[] {
  const lm = q.locationMatch;
  if (!lm || lm.kind === 'none') {
    return q.location.trim() ? [`${t('City')}: ${tPlace(q.location.trim())}`] : [];
  }
  const join = (xs: string[]) => xs.join(getLocale() === 'ar' ? '، ' : ', ');
  const cityLabel = lm.city ? tPlace(lm.city) : '';
  // Reassure the user when we corrected a typo'd place name.
  const simp = (s: string) => s.toLowerCase().replace(/[^a-zء-ي]/gu, '');
  const out: string[] = [];
  if ((lm.kind === 'district' || lm.kind === 'city') && simp(lm.raw) && simp(lm.raw) !== simp(lm.label)) {
    out.push(`${t('You typed')}: ${lm.raw}`);
  }
  switch (lm.kind) {
    case 'city':
      out.push(`${t('City')}: ${tPlace(lm.label)}`);
      break;
    case 'region':
      out.push(`${t('Region')}: ${lm.label}`);
      break;
    case 'district':
      if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
      out.push(`${t('Neighborhood')}: ${lm.label}`);
      break;
    case 'area':
      // The nickname phrase ("North Riyadh") is already echoed in the request bubble; here we show the
      // city it maps to and the districts it covers.
      if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
      if (lm.districts.length) out.push(`${t('Districts')}: ${join(lm.districts)}`);
      break;
    case 'landmark':
      out.push(`${t('Landmark')}: ${lm.landmark ?? lm.label}`);
      if (lm.districts.length) out.push(`${t('Nearby Districts')}: ${join(lm.districts)}`);
      if (lm.cities.length) out.push(`${t('Nearby Cities')}: ${join(lm.cities.map((c) => tPlace(c)))}`);
      else if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
      break;
    case 'geography':
    case 'lifestyle':
      if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
      if (lm.districts.length) out.push(`${t('Districts')}: ${join(lm.districts)}`);
      break;
  }
  return out;
}

// Structured "Search Summary" panel shown right before the search runs, so the user sees EXACTLY what
// Ezhalah understood and can spot a mistake before results (user spec: Search Understanding Panel).
// Only fields that were actually identified are included. District / lifestyle / landmark / property-age
// aren't captured in the query yet (they need the richer scraped listing schema), so they're omitted.
export function searchSummary(q: SearchQuery): string {
  const lines: string[] = [];
  // English keeps the canonical capitalized type ("Villa", "Rest House"); Arabic uses the translation.
  // If the user didn't pick a SPECIFIC type, fall back to the CATEGORY they have selected (Residential/
  // Commercial — always one or the other), so a default-button "Search" still shows what they chose.
  // (user request: "if user just clicks search by default, it shows what the button clicked at.")
  if (q.type) lines.push(`• ${t('Property Type')}: ${getLocale() === 'ar' ? tWord(q.type) : q.type}`);
  else if (q.category) lines.push(`• ${t('Property Type')}: ${t(q.category)}`);
  lines.push(`• ${t('Transaction Type')}: ${q.bothDeals ? t('Rent or Buy') : t(q.deal === 'Rent' ? 'For Rent' : 'For Sale')}`);
  // Always show a location line. If nothing was typed/inferred, the search covers the whole Kingdom,
  // so the summary says "City: Saudi Arabia". (user request: empty region → Saudi Arabia.)
  const locLines = locationLines(q);
  if (locLines.length) for (const l of locLines) lines.push(`• ${l}`);
  else lines.push(`• ${t('City')}: ${t('Saudi Arabia')}`);
  for (const b of budgetLines(q)) lines.push(`• ${b}`);
  if (q.detail) {
    // Label by VALUE, not by type: a home's detail may be a BEDROOM count OR a SIZE (the user's
    // choice). A bedroom-shaped value (1–4 or "5+") → Bedrooms; a size band ("100–300 m²") or any
    // larger number → Size. This keeps "house, 3 beds" → Bedrooms 3 and "house, 1500 m²" → Size 1500.
    if (/m²/.test(q.detail)) lines.push(`• ${t('Size')}: ${tDetailOption(q.detail)}`);
    else if (/^([1-4]|5\+?)$/.test(q.detail)) lines.push(`• ${t('Bedrooms')}: ${q.detail}`);
    else lines.push(`• ${t('Size')}: ${q.detail} ${t('m²')}`);
  }
  return `${t('Search Summary')}\n${lines.join('\n')}`;
}

// A compact, dot-separated one-liner of what the user asked for — shown right before scraping as a
// "Looking for: Villa · Rent · Riyadh · SAR 5,000 · 3 beds" confirmation. Empty fields are skipped so
// a vague query stays short. Western digits throughout (PRD rule). (user request: short summary.)
export function querySummaryLine(q: SearchQuery): string {
  const parts: string[] = [];
  if (q.type) parts.push(tWord(q.type));
  else if (q.category) parts.push(tWord(q.category));
  parts.push(t(q.deal === 'Rent' ? 'Rent' : 'Buy'));
  if (q.location.trim()) parts.push(tPlace(q.location.trim()));
  if (q.priceBand) {
    parts.push(tPriceTab(q.priceBand));
  } else {
    const amount = parseInt((q.priceInput.match(/\d/g) ?? []).join(''), 10) || 0;
    if (amount) parts.push(`${t('SAR')} ${grouped(amount)}`);
  }
  if (q.detail) {
    if (/m²/.test(q.detail)) parts.push(tDetailOption(q.detail));
    else if (/^([1-4]|5\+?)$/.test(q.detail)) parts.push(t('{n} beds', { n: q.detail }));
    else parts.push(t('{n} m²', { n: q.detail }));
  }
  return parts.join(' · ');
}

// Numbers are always shown in Western/Latin digits (PRD rule), but the user may type the
// amount in Arabic-Indic (٠-٩) or Persian (۰-۹) digits. Fold those onto 0-9, then keep only
// the digits — so a price typed in either script normalizes to the same Latin value.
export function toLatinDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660); // Arabic-Indic
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0); // Persian
    else out += ch;
  }
  return (out.match(/\d/g) ?? []).join('');
}

// Magnitude-based price interpretation. (PRD §6.2) Returns null when no price entered.
export type Price =
  | { kind: 'monthlyRent'; echo: string }
  | { kind: 'annualRent'; echo: string }
  | { kind: 'perMeterBuy'; echo: string }
  | { kind: 'totalBuy'; echo: string }
  | { kind: 'unrealistic'; echo: string };

export function interpretPrice(rawDigits: string, deal: Deal, sizeM2?: number, isAnnual?: boolean): Price | null {
  const digits = (rawDigits.match(/\d/g) ?? []).join('');
  if (!digits) return null;
  const amount = parseInt(digits, 10);
  const sar = t('SAR');
  if (!amount || amount < 100) {
    return { kind: 'unrealistic', echo: t("I couldn't find anything at that price — but here are some similar.") };
  }
  if (deal === 'Rent') {
    // The agent already annualized a stated period → it's an annual figure, no monthly guess.
    if (!isAnnual && amount <= 25_000) {
      const annual = amount * 12;
      return { kind: 'monthlyRent', echo: t('{a}/mo → {b}/yr', { a: `${sar} ${grouped(amount)}`, b: `${sar} ${grouped(annual)}` }) };
    }
    return { kind: 'annualRent', echo: t('{a}/yr', { a: `${sar} ${grouped(amount)}` }) };
  }
  // Buy
  if (amount <= 50_000) {
    const size = sizeM2 ?? 0;
    if (size > 0) {
      return { kind: 'perMeterBuy', echo: t('{a}/m² × {size} m² → {total}', { a: `${sar} ${grouped(amount)}`, size, total: `${sar} ${grouped(amount * size)}` }) };
    }
    return { kind: 'perMeterBuy', echo: t('{a}/m²', { a: `${sar} ${grouped(amount)}` }) };
  }
  return { kind: 'totalBuy', echo: `${sar} ${grouped(amount)}` };
}

export type SearchResult = { heading: string; notes: string[]; listings: Listing[]; sortNote?: string; count?: number; suggestion?: string };

function pickPool(q: SearchQuery, pools: Pools): Listing[] {
  const t = q.type?.toLowerCase();
  if (t) {
    if (t.includes('villa')) return pools.villa;
    if (t === 'room') return pools.room; // 1-bedroom, room-market priced — not apartment prices
    if (t.includes('apartment') || t === 'floor') return pools.apartment;
    if (t.includes('land') || t.includes('plot') || t === 'warehouse' || t === 'factory') return pools.land;
  }
  // "Rent or Buy" (deal unknown) with no specific type → draw from BOTH the rent and buy mixes so the
  // results can actually contain each (runSearch then keeps both). Otherwise the rent-only mix would
  // never surface a Buy listing for a "Both" search. (bothDeals correctness.)
  if (q.bothDeals) return [...pools.mixRent, ...pools.mixBuy];
  if (q.deal === 'Buy') {
    const amount = parseInt((q.priceInput.match(/\d/g) ?? []).join(''), 10);
    if (amount > 50_000 && amount <= 700_000) return pools.budget;
    return pools.mixBuy;
  }
  return pools.mixRent;
}

const RECENCY = Object.fromEntries(LISTED_SEQ.map((s, i) => [s, i])) as Record<string, number>;

// Display prices are pre-formatted ("SAR 95,000/year", "SAR 2.9M") — pull out a comparable SAR value.
function listingPriceValue(price: string): number {
  const m = price.match(/([\d.,]+)\s*([MK]?)/i);
  if (!m) return NaN;
  const num = parseFloat(m[1].replace(/,/g, ''));
  const suffix = m[2].toUpperCase();
  if (suffix === 'M') return num * 1_000_000;
  if (suffix === 'K') return num * 1_000;
  return num;
}

// A predicate deciding whether a listing fits the query's budget — or null when there's no usable
// price filter (broaden). Mirrors interpretPrice's magnitude logic and handles three Buy modes:
//   • a fixed total ceiling (large Buy figure, or per-m² × a known exact size);
//   • a per-m² price with NO fixed size → compare each listing by its OWN area (total ÷ area ≤ rate),
//     which is what lets "villa at SAR 1,000/m²" filter correctly without an entered area;
//   • Rent → annual ceiling (monthly ×12, or a large figure as-is). (PRD §6.2)
function priceFilter(q: SearchQuery): ((l: Listing) => boolean) | null {
  if (q.priceBand) {
    const r = priceBandRange(q.priceBand);
    if (r) return (l) => withinValue(l.price, r.min, r.max);
  }
  const digits = (q.priceInput.match(/\d/g) ?? []).join('');
  if (!digits) return null;
  const amount = parseInt(digits, 10);
  if (!amount || amount < 100) return null;
  if (q.deal === 'Rent') {
    // Don't assume a small figure is a MONTHLY rent (×12) when we're showing BOTH rent & buy — the
    // same cap is applied to Buy listings too, so a rent×12 ceiling would wrongly exclude them.
    // If the user explicitly picked the rent period in the Filter, USE IT — monthly → ×12, annual →
    // as-is. Otherwise (AI agent path) fall back to the magnitude heuristic. (user request.)
    const explicitMonthly = q.rentPeriod === 'monthly';
    const explicitAnnual = q.rentPeriod === 'annual';
    // "Per month": the pool is true monthly rentals priced per MONTH, so compare the monthly budget
    // directly — do NOT ×12. "Per year": compare the yearly price. Agent path (neither set): keep the
    // old magnitude heuristic. (user: per month = charged monthly, never converted to a year.)
    const cap = explicitMonthly ? amount
      : explicitAnnual ? amount
      : (!q.priceIsAnnual && !q.bothDeals && amount <= 25_000 ? amount * 12 : amount);
    return (l) => withinValue(l.price, 0, cap);
  }
  // Buy
  if (amount <= 50_000) {
    const size = fixedSize(q);
    if (size > 0) return (l) => withinValue(l.price, 0, amount * size);
    // per-m² with no fixed size → evaluate each listing against its own area
    return (l) => {
      const v = listingPriceValue(l.price);
      return !Number.isNaN(v) && l.area > 0 && v / l.area <= amount;
    };
  }
  return (l) => withinValue(l.price, 0, amount);
}

function withinValue(price: string, min: number, max: number): boolean {
  const v = listingPriceValue(price);
  return !Number.isNaN(v) && v >= min && v <= max;
}

// Parse a detail value into an area range in m² — or null when it's a bedroom count (not a size).
// A size BAND ("Under 300 m²", "300–600 m²", "1,000+ m²") → its explicit range; a single exact size
// ("200", "139 m²") → ±15% tolerance, since exact areas are rarely available. (user request: filter
// by size, accept any unit, ±10–15% tolerance.)
function parseSizeRange(detail: string): { min: number; max: number } | null {
  const d = detail.replace(/,/g, '').trim();
  // NOTE: the bedroom-vs-size decision is the CALLER's (sizeFilter guards on bedroomSpec first). We no
  // longer reject a bare "5" here — for a non-bedroom type (e.g. Building) a kept "5" is a 5 m² SIZE and
  // must build a real band, not be silently dropped. (audit: size bedroom-guard misfire.)
  const nums = (d.match(/\d+/g) ?? []).map((x) => parseInt(x, 10)).filter((n) => isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
  const n = nums[0];
  if (/under|less|below|أقل|أصغر|<|۰?دون/i.test(d)) return { min: 0, max: n };
  if (/\+|plus|more|أكثر|فأكثر|>/i.test(d)) return { min: n, max: Infinity };
  return { min: Math.round(n * 0.85), max: Math.round(n * 1.15) }; // exact size → ±15%
}

// Area predicate: keep listings whose size falls in the requested m² range. Null when there's no size
// to filter on (bedroom count, or no detail). The user can give the size in any unit — the agent/app
// converts to m² before it reaches here. (user request: area is a first-class filter.)
function sizeFilter(q: SearchQuery): ((l: Listing) => boolean) | null {
  if (!q.detail) return null;
  if (bedroomSpec(q)) return null; // the kept detail is a bedroom count → bedroomFilter handles it, not size
  const r = parseSizeRange(q.detail);
  if (!r) return null;
  return (l) => l.area > 0 && l.area >= r.min && l.area <= r.max;
}

// Exact property-type predicate: keep only listings of the kept type. Defense-in-depth on top of the
// server's now-exact-type fetch — a kept type must NEVER surface a sibling (Apartment must not show
// Floor/Building/Rest House/Chalet; Residential Land must not show Commercial Land). Null = no type
// kept → broaden. (user: cards must match the kept property type, period.)
function typeFilter(q: SearchQuery): ((l: Listing) => boolean) | null {
  if (!q.type) return null;
  return (l) => l.type === q.type;
}

// The bedroom constraint a query implies — or null when `detail` isn't a bedroom count (a size band,
// or a non-bedroom property type). "5+" → { n: 5, atLeast: true }; "1".."4" → exact. ONE source of
// truth, shared by the client filter (runSearch) AND the server fetch (fetchListingsForQuery) so the
// two never disagree. Mirrors the bedroom token used everywhere else: /^([1-4]|5\+?)$/.
export function bedroomSpec(q: SearchQuery): { n: number; atLeast: boolean } | null {
  if (!q.detail) return null;
  const d = q.detail.trim();
  // A bare 1-4 / 5+ token is ALWAYS a bedroom count (no size string ever looks like this — sizes carry a
  // unit, a range, or a value >5). Don't require q.type: the agent can keep "3 bedrooms" with no type
  // ("a place to rent in Riyadh, 3 bedrooms") and it must still constrain. (audit: bedroom type-null hole.)
  if (!/^([1-4]|5\+?)$/.test(d)) return null;
  // Only EXCLUDE it when a non-bedroom type is explicitly kept (e.g. an Office where "3" is a size, not beds).
  if (q.type && !detailFor(q.type).isBedrooms) return null;
  return { n: parseInt(d, 10), atLeast: d.startsWith('5') }; // "5"/"5+" is the top bucket → 5 or more
}

// Bedroom predicate: keep ONLY listings with the requested count ("5+" → 5 or more, else exact).
// Unlike price/size, bedrooms is NEVER substituted with a "closest" value — a 6-bedroom house is a
// different property, not a near-match for a 3-bedroom request, and showing it is exactly the bug the
// user reported. Unknown counts (beds = 0) are excluded. (user: filter shows ONLY what I kept, period.)
function bedroomFilter(q: SearchQuery): ((l: Listing) => boolean) | null {
  const spec = bedroomSpec(q);
  if (!spec) return null;
  return spec.atLeast ? (l) => l.beds >= spec.n : (l) => l.beds === spec.n;
}

// "Ezhalah!" is reserved for when listings are shown. (PRD §7.3)
function heading(q: SearchQuery): string {
  return t('Ezhalah! Here are {what} listings {verb} in {place}.', {
    what: whatText(q),
    verb: verbText(q),
    place: placeText(q),
  });
}

function notes(q: SearchQuery): string[] {
  const out: string[] = [];
  if (!q.location.trim()) out.push(t('Searching all of Saudi Arabia — add a city to narrow it down.'));
  if (!q.type && !q.category) out.push(t('Showing a mix of property types.'));
  if (q.priceBand) {
    out.push(t('Price: {echo}', { echo: tPriceTab(q.priceBand) }));
    return out;
  }
  // Use the SAME fixed-size rule the price filter uses (fixedSize returns 0 for a bedroom count), so a
  // "villa, 3 beds, SAR 1,000/m²" never misreads 3 bedrooms as 3 m² in the echoed math. (audit bug #1.)
  const size = fixedSize(q) || undefined;
  const p = interpretPrice(q.priceInput, q.deal, size, q.priceIsAnnual);
  if (p) out.push(p.kind === 'unrealistic' ? p.echo : t('Price: {echo}', { echo: p.echo }));
  return out;
}

// Runs the search and enforces the hard rules: source eligibility per deal (allowsRent/allowsBuy),
// recency ranking, top 5. (PRD §5.5, §8.1, §11 guardrails)
// A short, neutral note shown above results explaining the objective order applied. Pure fact,
// no judgement words. Keys are i18n strings (translated by t()).
const SORT_NOTE: Record<SortKey, string> = {
  newest: 'Sorted by newest first.',
  oldest: 'Sorted by oldest first.',
  price_asc: 'Sorted by price, lowest first.',
  price_desc: 'Sorted by price, highest first.',
  area_asc: 'Sorted by area, smallest first.',
  area_desc: 'Sorted by area, largest first.',
  ppm_asc: 'Sorted by price per m², lowest first.',
  ppm_desc: 'Sorted by price per m², highest first.',
  beds_desc: 'Sorted by bedrooms, most first.',
};

// Digits-only value of a listing's display price ("SAR 1,200,000/yr" → 1200000). Used only for
// OBJECTIVE sorting — never to judge a listing.
const priceOf = (l: Listing): number => parseInt((l.price.match(/\d/g) ?? []).join(''), 10) || 0;

// Re-order the (already filtered) listings by an OBJECTIVE key the user asked for. Returns a NEW
// array; default freshness order is untouched when no sort is set. Strictly factual — there is no
// "best"/"popular" branch, by design (non-advisory). (user training decision.)
function sortListings(list: Listing[], sort: SortKey): Listing[] {
  const out = [...list];
  const recency = (l: Listing) => RECENCY[l.listed] ?? 99; // 0 = newest
  const ppm = (l: Listing) => (l.area > 0 ? priceOf(l) / l.area : Infinity);
  switch (sort) {
    case 'newest':    out.sort((a, b) => recency(a) - recency(b)); break;
    case 'oldest':    out.sort((a, b) => recency(b) - recency(a)); break;
    case 'price_asc': out.sort((a, b) => priceOf(a) - priceOf(b)); break;
    case 'price_desc':out.sort((a, b) => priceOf(b) - priceOf(a)); break;
    case 'area_asc':  out.sort((a, b) => a.area - b.area); break;
    case 'area_desc': out.sort((a, b) => b.area - a.area); break;
    case 'ppm_asc':   out.sort((a, b) => ppm(a) - ppm(b)); break;
    case 'ppm_desc':  out.sort((a, b) => ppm(b) - ppm(a)); break;
    case 'beds_desc': out.sort((a, b) => b.beds - a.beds); break;
  }
  return out;
}

// True if a stored listing district matches one of the wanted district names. Both sides are stripped
// of the "حي " prefix and lowercased on the Latin side, then matched with bidirectional substring so
// "حي الملقا" matches "الملقا" and vice versa, and "Al Olaya" matches "Olaya" too.
function listingInDistricts(stored: string, wanted: string[]): boolean {
  const s = stored.replace(/^حي\s+/, '').trim();
  const sLc = s.toLowerCase();
  // The stored neighborhood is Arabic ("حي العليا"); a kept district label is usually English ("Al
  // Olaya"). Transliterate the Arabic side so the two can match across scripts. (audit: district leak.)
  const sTr = translitPlace(stored).toLowerCase();
  return wanted.some((w) => {
    const wn = w.replace(/^حي\s+/, '').trim();
    const wLc = wn.toLowerCase();
    return s.includes(wn) || wn.includes(s) || sLc.includes(wLc) || wLc.includes(sLc)
      || (!!sTr && (sTr.includes(wLc) || wLc.includes(sTr)));
  });
}

// The single target size (m²) the user asked for — ONLY when they entered an exact size (a bare number,
// optionally with a unit), not a band ("300–600 m²") or an open phrase ("under 300", "600+"). Used by
// the closeness ranking; bands have no single target so every in-band card is equally close. Null when
// the detail is a bedroom count or not a clean size.
function exactSizeTarget(q: SearchQuery): number | null {
  if (!q.detail || bedroomSpec(q)) return null;
  const d = q.detail.replace(/,/g, '').trim();
  if (!/^\d+(\s*(m²|m2|meter|metre|متر|م))?$/i.test(d)) return null; // a single size, not a range/keyword
  const n = parseInt(d, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The flat budget ceiling (SAR) the query implies, or null when there's no usable single cap (no price,
// or a per-m² Buy with no fixed size). MUST mirror priceFilter's cap math — used only to rank above-
// budget fallbacks by how close they are to the stated budget. (keep in sync with priceFilter.)
function budgetCap(q: SearchQuery): number | null {
  if (q.priceBand) { const r = priceBandRange(q.priceBand); return r ? r.max : null; }
  const digits = (q.priceInput.match(/\d/g) ?? []).join('');
  if (!digits) return null;
  const amount = parseInt(digits, 10);
  if (!amount || amount < 100) return null;
  if (q.deal === 'Rent') {
    const explicitMonthly = q.rentPeriod === 'monthly';
    const explicitAnnual = q.rentPeriod === 'annual';
    // Monthly pool is priced per month → the cap is the monthly budget as-is (mirrors priceFilter).
    return explicitMonthly ? amount
      : explicitAnnual ? amount
      : (!q.priceIsAnnual && !q.bothDeals && amount <= 25_000 ? amount * 12 : amount);
  }
  if (amount <= 50_000) { const size = fixedSize(q); return size > 0 ? amount * size : null; }
  return amount;
}

// CLOSENESS score — the default ranking, so #1 is the closest match to what the user asked and the last
// card is the least close. After the hard filters every card already matches the kept type/deal/city/
// beds/size, so closeness is decided by the soft signals that still vary:
//   • Budget: a card WITHIN the stated budget scores 1 (uniform — all equally satisfy "up to X"); an
//     above-budget fallback scores LESS the more it exceeds the cap, so the least-over-budget (closest
//     to the stated budget) ranks highest. Neutral — it measures distance to the user's number, never
//     "a better deal".
//   • Exact size: the nearer the area to the requested size, the higher (bands stay uniform).
//   • Newer listing (higher id) breaks ties.
// Strictly factual closeness to the user's OWN criteria — never a quality/value judgment. (PRD §7 neutrality.)
function closenessScore(l: Listing, q: SearchQuery, cap: number | null): number {
  let bonus = 0;
  if (cap && cap > 0) {
    const v = listingPriceValue(l.price);
    if (!Number.isNaN(v) && v > 0) bonus += 1 - Math.min(1, Math.max(0, v - cap) / cap);
  }
  const target = exactSizeTarget(q);
  if (target && l.area > 0) bonus += 1 - Math.min(1, Math.abs(l.area - target) / target);
  return bonus * 1e12 + (l.id || 0); // closeness dominates; newest-first tiebreak
}

// Round-robin an already-ranked list through the 13 regions so a country-wide search visibly spans
// the Kingdom. The input is assumed sorted (closeness/newest); each region's sublist keeps that order,
// and we interleave region-by-region. A listing whose city isn't in the catalog falls into 'Other'.
function diversifyByRegion(listings: Listing[]): Listing[] {
  const byRegion: Record<string, Listing[]> = {};
  for (const l of listings) {
    const r = CITY_TO_REGION[l.city] || 'Other';
    (byRegion[r] ||= []).push(l);
  }
  return interleave(Object.values(byRegion));
}

// Round-robin the (already-ranked) matches across their SOURCE platform (Aqar / Wasalt / …) so the
// results visibly MIX both sources instead of one sweeping the top. This is REQUIRED because all
// source tables share ONE id sequence with DISJOINT ranges (Aqar 1–431k, Wasalt 431k+), and the
// closeness tiebreak is `+ l.id` — so without this every higher-id Wasalt row outranks every Aqar
// row and the first screen is 100% one source. Closeness order is preserved WITHIN each source.
// (user: "make it a mixture between Aqar and Wasalt — I don't see Aqar anymore".)
function diversifyBySource(listings: Listing[]): Listing[] {
  const bySource: Record<string, Listing[]> = {};
  for (const l of listings) (bySource[l.source || 'Other'] ||= []).push(l);
  const groups = Object.values(bySource);
  return groups.length > 1 ? interleave(groups) : listings;
}

export function runSearch(q: SearchQuery, pools: Pools = POOLS, opts?: { fetchFailed?: boolean }): SearchResult {
  let eligible = pickPool(q, pools)
    // bothDeals (agent searched without knowing rent/buy) → show BOTH; otherwise filter to the deal.
    .filter((l) => q.bothDeals || l.deal === q.deal)
    .filter((l) => supports(l.source, q.deal))
    // Exact kept type — a kept "Apartment" must never show a Floor/Building/Rest House sibling. (audit.)
    .filter((l) => !q.type || l.type === q.type)
    .sort((a, b) => (RECENCY[a.listed] ?? 99) - (RECENCY[b.listed] ?? 99));

  // District filter: when the agent / area-phrase resolver named specific neighborhoods, narrow to
  // listings in any of them — STRICTLY. (user: "North Riyadh should show listings IN North Riyadh"
  // and "if there's nothing, say you couldn't find it — never show the wrong ones.")
  if (q.districts && q.districts.length) {
    // District is a STRICT kept field, exactly like bedrooms/size: keep ONLY listings in the chosen
    // district(s). Zero in-district matches → show NONE (the 0-results path says "couldn't find that
    // area"), NEVER widen to the whole city under a neighborhood heading. (user: match what I picked
    // to the cards, or tell me you couldn't find it — never show the wrong ones.)
    eligible = eligible.filter((l) => listingInDistricts(l.district || '', q.districts!));
  }

  const ns = notes(q);
  let listings = eligible;
  // Apply the price filter, but never dead-end: if nothing fits, show the closest options and say so.
  const fits = priceFilter(q);
  if (fits != null) {
    const within = listings.filter(fits);
    if (within.length > 0) listings = within;
    else ns.push(t('Nothing within your budget right now — showing the closest options above it.'));
  }
  // Apply the size filter HARD — like bedrooms, no "closest size" substitution. A kept size of 30,000 m²
  // with zero in-band used to fall back to the FULL unfiltered list (cards wildly off the kept size with
  // only a soft note). The kept-value contract requires every visible card to match; zero in-band → show
  // none and let the 0-results path offer to drop the size. (audit: size zero-in-band fallback leak.)
  const sizeFits = sizeFilter(q);
  if (sizeFits != null) listings = listings.filter(sizeFits);
  // Apply the bedroom filter HARD — unlike price it does NOT fall back to the closest count.
  // If it squeezes to zero, the 0-results path (noResultsSuggestion) offers to drop it. This is the
  // fix for "filter says 3 bedrooms but you showed 5- and 6-bed houses". (user: show ONLY what I kept.)
  const bedFits = bedroomFilter(q);
  if (bedFits != null) listings = listings.filter(bedFits);

  // Order the matches. An explicit OBJECTIVE sort (cheapest, biggest, newest…) wins; otherwise the
  // DEFAULT is closeness — #1 is the closest match to what the user asked, the last card the least
  // close — which is what the "Ranked by closest match" heading promises. Done AFTER filtering so it
  // applies to the matches the user actually sees. (user: "#1 closest … #25 least close.")
  let sortNote: string | undefined;
  if (q.sort) {
    listings = sortListings(listings, q.sort);
    sortNote = t(SORT_NOTE[q.sort]);
  } else {
    const cap = budgetCap(q);
    listings = [...listings].sort((a, b) => closenessScore(b, q, cap) - closenessScore(a, q, cap));
    if (isCountryWideQuery(q)) {
      // Country-wide "Saudi" search → the user wants to SEE every platform we aggregate. So we
      // (1) pick ONE representative card per source up-front (closest match within that source,
      //     biased toward a property type no earlier source has shown yet → diverse top row), and
      // (2) follow with the existing region-spread mix for the rest of the feed (deduped).
      // Net effect: scrolling the first ~17 cards = one card per platform, each a different type.
      // (user: "show me 1 listing from each, make sure different property type, all 17 platforms".)
      const bySource: Record<string, Listing[]> = {};
      for (const l of listings) (bySource[l.source || 'Other'] ||= []).push(l);
      const usedTypes = new Set<string>();
      const usedIds = new Set<number>();
      const topRow: Listing[] = [];
      // Walk sources in descending catalog size so the densest platforms anchor the top first.
      const sourceOrder = Object.keys(bySource).sort((a, b) => bySource[b].length - bySource[a].length);
      for (const src of sourceOrder) {
        // Among this platform's closeness-sorted listings, pick the first whose property_type is
        // still unseen. Fall back to the very first if every type is already shown.
        const pool = bySource[src];
        const pick = pool.find((l) => !usedTypes.has(l.type)) || pool[0];
        if (pick) {
          topRow.push(pick);
          usedIds.add(pick.id);
          if (pick.type) usedTypes.add(pick.type);
        }
      }
      // Country-wide = EXACTLY one card per platform (the full roster, ordered by catalog size).
      // No extra region "tail" — the user wants to see the platforms cleanly, ONE card each, and
      // NOT be padded out to 25. So a country-wide "show me everywhere" returns exactly N cards =
      // the number of platforms that have a matching listing. (user: "just show me the 20 only".)
      void usedIds;
      listings = topRow;
    } else {
      // City/area search → mix the two sources so neither dominates the top. Without this, Wasalt's
      // higher id range sweeps the closeness id-tiebreak and the user "doesn't see Aqar anymore".
      listings = diversifyBySource(listings);
    }
  }

  // Return up to 25 matches (display cap): the chat shows the first `count` the user explicitly
  // asked for, or up to 25 by default. Fewer than 25 available → show whatever exists; never pad
  // to 25 by inventing rows.
  const count = q.count && q.count >= 1 ? Math.min(q.count, 25) : undefined;
  // 0-results case → a friendly, ACTIONABLE recommendation. Three situations:
  //  (a) the server fetch FAILED (network/backend error) → tell the user to retry, not that nothing
  //      matched. (opts.fetchFailed is set by runQuery when fetchListingsForQuery returned null.)
  //  (b) the fetch succeeded but the source pool is empty → there's genuinely no inventory of that
  //      type/deal/city → suggest broadening (noResultsSuggestion handles the wording).
  //  (c) the pool has rows but filters squeezed it to zero → relax the bottleneck filter.
  let suggestion: string | undefined;
  if (listings.length === 0) {
    if (opts?.fetchFailed) {
      suggestion = t('Loading listings — please try again in a few seconds.');
    } else {
      suggestion = noResultsSuggestion(q, pools);
    }
  }
  return { heading: heading(q), notes: ns, listings: listings.slice(0, 25), sortNote, count, suggestion };
}

// Try relaxing one query field at a time and see which unlocks results. The order matters: we
// prefer to relax the field the user is LEAST attached to (budget caps, then districts, then bed
// count, then property type, finally city). The first relaxation that yields >0 listings wins.
function noResultsSuggestion(q: SearchQuery, pools: Pools): string {
  const countWith = (mod: Partial<SearchQuery>): number => {
    const q2: SearchQuery = { ...q, ...mod };
    let list = pickPool(q2, pools)
      .filter((l) => q2.bothDeals || l.deal === q2.deal)
      .filter((l) => supports(l.source, q2.deal))
      .filter((l) => !q2.type || l.type === q2.type);
    if (q2.districts && q2.districts.length) {
      list = list.filter((l) => listingInDistricts(l.district || '', q2.districts!));
    }
    const pf = priceFilter(q2); if (pf) list = list.filter(pf);
    const sf = sizeFilter(q2); if (sf) list = list.filter(sf);
    const bf = bedroomFilter(q2); if (bf) list = list.filter(bf);
    return list.length;
  };
  if (q.priceInput && countWith({ priceInput: '' }) > 0) {
    return t("No listings within that budget — there are matches above it. Want me to remove the budget?");
  }
  if (q.districts?.length && countWith({ districts: undefined }) > 0) {
    return t("No matches in that specific area — but I can find some elsewhere in the same city. Want me to widen the area?");
  }
  if (q.detail && countWith({ detail: null }) > 0) {
    return t("No matches with that exact size/bedroom count — close options exist if I drop it. Want me to?");
  }
  if (q.type && countWith({ type: null, category: q.category }) > 0) {
    return t("No matches for that property type here — other types are available. Want me to broaden the type?");
  }
  if (q.location && countWith({ location: '' }) > 0) {
    return t("No matches in that city — but the same search has results elsewhere in Saudi Arabia. Want me to broaden it Kingdom-wide?");
  }
  return t("Nothing matches that exact combination right now. Want me to broaden the search and try again?");
}
