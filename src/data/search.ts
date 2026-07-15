import type { Category, Deal } from './taxonomy';
import type { LocationResolution } from './locations';
import type { ProximityIntent } from './proximity';
import { scoreListingProximity } from './proximity';
import { cityHasListings, nearbyCityWithListings, cityDisplay } from './locations';
import { detailFor, priceBandRange } from './taxonomy';
import { POOLS, LISTED_SEQ, type Listing, type Pools } from './listings';
import { supports } from './platforms';
import { t, tWord, tPlace, tPriceTab, tDetailOption, getLocale, LOCATION_UNRESOLVED_AR, TYPE_UNRESOLVED_AR } from '@/i18n';
import { arabicOrPlaceholder } from '@/lib/arabicText';
import { translitPlace } from '@/lib/translitPlace';
import { CITY_TO_REGION, isCountryWideQuery, interleave } from './regions';
import { groupMembers, CLEAN_MACRO, SUBGROUPS } from './propertyTypes';

// A parsed search. Every field optional — empty fields broaden, never dead-end. (PRD §6.1)
export type SearchQuery = {
  deal: Deal;
  location: string;
  category: Category | null;
  type: string | null;
  // Multi-select within a group (filter path): OR across these clean types. The single `type` stays
  // for the agent path; the engine treats `type` as a 1-element selection (see effectiveTypes).
  types?: string[] | null;
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
  // A region (Arabic, e.g. "منطقة الرياض") the AI Agent's catalog backstop already pinned to
  // disambiguate a TWIN city — same city name in 2+ regions (القصب in الرياض AND عسير). When set,
  // the engine scopes `location` to THIS region only and must NOT treat it as ambiguous (the user
  // already chose). Absent on a normal single-city search. (2026-06-26 twin-city false-zero fix.)
  regionPin?: string;
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
  // Free-text terms matched against the listing's OWN text (street_name / title / description / facade) —
  // the street / "near a mosque|school|park" / facade search. Extracted from the user's message; if real
  // matches exist we show only them, else we keep the area + a note. Never invented. (Q3.)
  keywords?: string[];
  // Location-RELATIONSHIP intents parsed from the user's message (2026-06-26): each is a
  // {relationship, category, name} triple — «قريب من مستشفى الحبيب» → near / hospital / الحبيب.
  // The keyword filter still narrows the set; THIS drives RANKING — listings that express the same
  // relationship to the same entity (strong phrase + exact name) rank above bare keyword mentions.
  proximity?: ProximityIntent[];
  // Restrict results to specific PLATFORMS the user named ("show me Gathern only", "Aqar and
  // Wasalt"). Values are table prefixes ('gathern', 'aqar', …). When set, only those platforms'
  // tables are queried (remote.tablesFor) and the country-wide one-card-per-platform roster is
  // bypassed so the user sees that platform's listings in full. Empty/undefined → all platforms.
  // (user: "if I say show me gathern only, show me gathern only".)
  sources?: string[];
  // Subcategory GROUP selected in the filter (e.g. "Vacation & Rural") — a SOFT/broad intent: match
  // any clean type in that group. `type` (a single CLEAN property type, e.g. "Chalet") is the HARD
  // exact filter. Both feed the one engine; the filter sets these, the agent resolves to them.
  // (user: filter = structured AI input; group = head-start intent, type = exact.)
  typeGroup?: string | null;
  // Bedroom count selected at the CATEGORY/GROUP level — shown before the user picks a specific type.
  // Independent of `detail` so both beds and area can be set simultaneously. Ignored once a type is
  // selected (the type-level detail chip takes over). (user: no forced type selection for bed filter.)
  contextBeds?: string | null;
  // Multi-select bedrooms (filter path): OR across these counts ("1".."4" exact, "5+" = 5 or more).
  // The single `contextBeds` stays for back-compat; the engine treats it as a 1-element selection
  // (see effectiveBeds). ANDed with every other filter; never widened by diversity.
  contextBedsList?: string[] | null;
  // Area (m²) entered at the CATEGORY/GROUP level. Has its OWN field so a bare "3" is never mistaken
  // for a 3-bedroom count (the shared `detail` field reads a bare 1–5 as bedrooms). Independent of
  // contextBeds so the user can set area only, beds only, or both. (user: typing 1–5 m² showed nothing.)
  contextSize?: string | null;
  // Area range (filter UI, m²): min only → area ≥ min, max only → area ≤ max, both → between. Raw digit
  // strings. Mutually exclusive with bedrooms in the UI. Supersede contextSize when set. HARD filter.
  areaMin?: string | null;
  areaMax?: string | null;
  // Price range (filter UI, SAR — same unit as the displayed price for the chosen deal/period): min →
  // price ≥ min, max → price ≤ max, both → between. Raw digit strings. HARD filter (no closest-above).
  priceMin?: string | null;
  priceMax?: string | null;
};

// Parse a raw digit string ("1,200" / "300" / "") → a positive number, or null when empty/invalid.
const numOrNull = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// The objective sort keys the agent/UI may request. NEVER a quality/popularity ordering.
export type SortKey =
  | 'newest' | 'oldest'
  | 'price_asc' | 'price_desc'
  | 'area_asc' | 'area_desc'
  | 'ppm_asc' | 'ppm_desc'
  | 'beds_desc';

// Moved to src/lib/searchDefaults.ts (zero-dependency, so a plain Node test can execute it) —
// re-exported here so every existing `import { emptyQuery } from '@/data/search'` keeps working.
export { emptyQuery } from '@/lib/searchDefaults';

export const locationPhrase = (q: SearchQuery) => q.location.trim() || 'Saudi Arabia';
const placeText = (q: SearchQuery) => (q.location.trim() ? arabicOrUnresolved(tPlace(q.location.trim())) : t('Saudi Arabia'));
const verbText = (q: SearchQuery) => t(q.bothDeals ? 'to rent or buy' : q.deal === 'Rent' ? 'to rent' : 'to buy');
const whatText = (q: SearchQuery) => arabicOrTypeUnresolved(tWord(q.type ?? q.category ?? 'Property'));

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

  // FILTER selections live in q.types (multi-select) / contextBedsList / areaMin-Max; the AGENT path
  // uses q.type / q.detail. Read the FILTER fields first (via effectiveTypes/effectiveBeds) so the
  // generated sentence reflects exactly what was picked — previously this only read q.type, so a filter
  // type (e.g. ورشة) was ignored and the bubble said a generic "عقار سكني/تجاري". (user bug 2026-07-06.)
  const selTypes = effectiveTypes(q);
  const whatPhrase = selTypes.length
    ? selTypes.map((x) => arabicOrTypeUnresolved(tWord(x))).join('، ')
    : q.typeGroup
      ? arabicOrTypeUnresolved(t(q.typeGroup))
      : q.category
        ? t('{cat} property', { cat: arabicOrTypeUnresolved(tWord(q.category)) })
        : t('a property');

  let detailPhrase = '';
  const selBeds = effectiveBeds(q);
  const aLo = numOrNull(q.areaMin), aHi = numOrNull(q.areaMax);
  if (selBeds.length) {
    detailPhrase = selBeds.length === 1 && selBeds[0] === '1'
      ? t(' with {n} bedroom', { n: selBeds[0] })
      : t(' with {n} bedrooms', { n: selBeds.join('، ') });
  } else if (aLo != null || aHi != null) {
    const r = aLo != null && aHi != null ? `${t('From')} ${grouped(aLo)} ${t('To')} ${grouped(aHi)}`
      : aLo != null ? `${t('From')} ${grouped(aLo)}` : `${t('To')} ${grouped(aHi!)}`;
    detailPhrase = t(' around {n} m²', { n: r });
  } else if (q.detail && (q.type || selTypes.length)) {
    const dtype = (q.type ?? selTypes[0])!;
    if (detailFor(dtype).isBedrooms) {
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
  const pLo = numOrNull(q.priceMin), pHi = numOrNull(q.priceMax);
  if (pLo != null || pHi != null) {
    // Filter من/إلى price range (HARD filter) — show verbatim, no monthly/per-m² math.
    const rng = pLo != null && pHi != null ? `${t('From')} ${grouped(pLo)} ${t('To')} ${grouped(pHi)}`
      : pLo != null ? `${t('From')} ${grouped(pLo)}` : `${t('To')} ${grouped(pHi!)}`;
    pricePhrase = t(' for {a}', { a: `${rng} ${sar}` });
  } else if (q.priceBand) {
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

  const subWhat = selTypes.length
    ? selTypes.map((x) => arabicOrTypeUnresolved(tWord(x))).join('، ')
    : q.typeGroup
      ? arabicOrTypeUnresolved(t(q.typeGroup))
      : q.category
        ? t('{cat} properties', { cat: arabicOrTypeUnresolved(tWord(q.category)) })
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
  const pLo = numOrNull(q.priceMin), pHi = numOrNull(q.priceMax);
  if (pLo != null || pHi != null) {
    const r = pLo != null && pHi != null ? `${t('From')} ${grouped(pLo)} ${t('To')} ${grouped(pHi)}`
      : pLo != null ? `${t('From')} ${grouped(pLo)}` : `${t('To')} ${grouped(pHi!)}`;
    return [...orig, `${t('Budget')}: ${r} ${sar}`];
  }
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
// Arabic locale only: a place value that still contains no Arabic character after translation/
// catalog lookup means nothing matched (a raw scraped/typed English name, an out-of-catalog
// district, an ambiguous-match echo, etc.) — show the existing honest "unresolved" sentinel instead
// of leaking that raw English text into an otherwise-Arabic summary. Never touches the English UI
// (an English place name there is correct, not a leak) and never touches empty strings (callers
// already guard those with `if (cityLabel) ...`). See src/lib/arabicText.ts for the pure, unit-tested
// implementation.
function arabicOrUnresolved(s: string): string {
  return arabicOrPlaceholder(s, getLocale(), LOCATION_UNRESOLVED_AR);
}

// Same idea, for property-type/category words. q.type/q.types/q.category/q.typeGroup are normally a
// closed, fully-AR{}-translated set from the filter UI or agent parser — but the guided interview's
// free-text "Something else" answer can set any of them to arbitrary custom text (buildQuery() in
// src/app/interview.tsx has no dictionary-membership check), which tWord()/t() would otherwise leak
// straight through on a miss. Guards whatText()/searchSummary()/querySummaryLine() the same way
// arabicOrUnresolved() already guards every location line. (2026-07-13 sibling-leak audit.)
function arabicOrTypeUnresolved(s: string): string {
  return arabicOrPlaceholder(s, getLocale(), TYPE_UNRESOLVED_AR);
}

function locationLines(q: SearchQuery): string[] {
  const lm = q.locationMatch;
  if (!lm || lm.kind === 'none') {
    return q.location.trim() ? [`${t('City')}: ${arabicOrUnresolved(tPlace(q.location.trim()))}`] : [];
  }
  const join = (xs: string[]) => xs.map(arabicOrUnresolved).join(getLocale() === 'ar' ? '، ' : ', ');
  // lm.city is canonical English (engine-facing); localize it for display via the catalog-backed
  // cityDisplay (knows e.g. Dhahran→الظهران) so a district's City line isn't shown in English.
  const cityLabel = lm.city ? arabicOrUnresolved(cityDisplay(lm.city, getLocale())) : '';
  const regionLabel = lm.region ? arabicOrUnresolved(tPlace(lm.region)) : '';
  // Reassure the user ONLY when we corrected a typo'd place name. Suppress when the difference is just
  // localization (the resolver returns a localized label while the raw was the other script — e.g. the
  // agent extracted English "Riyadh" and we show "الرياض"), which is a translation, not a correction.
  const simp = (s: string) => s.toLowerCase().replace(/[^a-zء-ي]/gu, '');
  const hasAr = (s: string) => /[ء-ي]/.test(s);
  const sameScript = hasAr(lm.raw) === hasAr(lm.label);
  // In the English UI, transliterate an Arabic district/place name to clean English so the summary
  // never shows raw Arabic. (user: translate Arabic → English; "the Arabic is a mess".)
  const dispP = (s: string) => (getLocale() === 'en' ? translitPlace(s) : s);
  const out: string[] = [];
  if ((lm.kind === 'district' || lm.kind === 'city') && simp(lm.raw) && simp(lm.raw) !== simp(lm.label) && sameScript) {
    out.push(`${t('You typed')}: ${lm.raw}`);
  }
  switch (lm.kind) {
    case 'city':
      out.push(`${t('City')}: ${arabicOrUnresolved(tPlace(lm.label))}`);
      // Region disambiguates same-named cities/districts across the Kingdom. (user: include the region.)
      if (regionLabel) out.push(`${t('Region')}: ${regionLabel}`);
      break;
    case 'region':
      out.push(`${t('Region')}: ${arabicOrUnresolved(lm.label)}`);
      break;
    case 'district':
      out.push(`${t('Neighborhood')}: ${arabicOrUnresolved(dispP(lm.label))}`);
      if (lm.ambiguous && lm.cities && lm.cities.length) {
        // The district name exists in several cities → show them all (we searched all), not one.
        out.push(`${t('Cities')}: ${join(lm.cities.map((c) => cityDisplay(c, getLocale())))}`);
      } else {
        // Same district name exists in different cities → always show City + Region so the user knows
        // WHICH one we matched (e.g. Al Olaya → Riyadh vs Khobar). (user request.)
        if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
        if (regionLabel) out.push(`${t('Region')}: ${regionLabel}`);
      }
      break;
    case 'area':
      // The nickname phrase ("North Riyadh") is already echoed in the request bubble; here we show the
      // city it maps to and the districts it covers.
      if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
      if (lm.districts.length) out.push(`${t('Districts')}: ${join(lm.districts.map(dispP))}`);
      break;
    case 'landmark':
      out.push(`${t('Landmark')}: ${arabicOrUnresolved(lm.landmark ?? lm.label)}`);
      if (lm.districts.length) out.push(`${t('Nearby Districts')}: ${join(lm.districts.map(dispP))}`);
      if (lm.cities.length) out.push(`${t('Nearby Cities')}: ${join(lm.cities.map((c) => cityDisplay(c, getLocale())))}`);
      else if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
      break;
    case 'geography':
    case 'lifestyle':
      if (cityLabel) out.push(`${t('City')}: ${cityLabel}`);
      if (lm.districts.length) out.push(`${t('Districts')}: ${join(lm.districts.map(dispP))}`);
      break;
  }
  return out;
}

// Structured "Search Summary" panel shown right before the search runs, so the user sees EXACTLY what
// Ezhalah understood and can spot a mistake before results (user spec: Search Understanding Panel).
// Only fields that were actually identified are included. District / lifestyle / landmark / property-age
// aren't captured in the query yet (they need the richer scraped listing schema), so they're omitted.
// Platform table-prefix → human display name, for the Search Summary's "Platform" line.
// Values are the i18n KEYS (full display forms, same as the card's sourceName) so searchSummary can t()
// them → Arabic. (owner 2026-07-08: no English platform names anywhere in the UI.)
const SOURCE_LABELS: Record<string, string> = {
  aqar: 'AQAR', wasalt: 'Wasalt', aldarim: 'Aldarim Real Estate', aqargate: 'Aqar Gate', alhoshan: 'Al Hoshan',
  hajer: 'Hajer Houses Real Estate', sanadak: 'Sanadak', eastabha: 'East Abha Real Estate', aqarcity: 'Aqar City', raghdan: 'Raghdan Real Estate',
  eaqartabuk: 'Eqar Tabuk', satel: 'Satel', sadin: 'Sadin for Real Estate', toor: 'TOOR', mustqr: 'Mustaqarr Real Estate',
  ramzalqasim: 'Ramz Al Qassim Real Estate Investment', fursaghyr: 'Fursa Ghyr Real Estate', jazwtn: 'Jazan Watan', mizlaj: 'Mizlaj Real Estate',
  muktamel: 'Muktamel', aqaratikom: 'Nawait', awal: 'Awal United for Real Estate', alkhaas: 'Al Khaas',
  abeea: 'Abeea Real Estate', jurash: 'Jurash Real Estate', alnokhba: 'Al Nokhba', dealapp: 'Deal App',
  erapulse: 'Era Pulse', nowaisiry: 'Al Nowaisiry Real Estate', october: '1 October Real Estate', gathern: 'Gathern',
};

export function searchSummary(q: SearchQuery): string {
  const lines: string[] = [];
  // English keeps the canonical capitalized type ("Villa", "Rest House"); Arabic uses the translation.
  // If the user didn't pick a SPECIFIC type, fall back to the CATEGORY they have selected (Residential/
  // Commercial — always one or the other), so a default-button "Search" still shows what they chose.
  // (user request: "if user just clicks search by default, it shows what the button clicked at.")
  const summaryTypes = effectiveTypes(q);
  if (summaryTypes.length) lines.push(`• ${t('Property Type')}: ${summaryTypes.map((x) => getLocale() === 'ar' ? arabicOrTypeUnresolved(tWord(x)) : x).join('، ')}`);
  else if (q.typeGroup) lines.push(`• ${t('Property Type')}: ${arabicOrTypeUnresolved(t(q.typeGroup))}`);
  else if (q.category) lines.push(`• ${t('Property Type')}: ${arabicOrTypeUnresolved(t(q.category))}`);
  lines.push(`• ${t('Transaction Type')}: ${q.bothDeals ? t('Rent or Buy') : t(q.deal === 'Rent' ? 'For Rent' : 'For Sale')}`);
  // Platform filter line — when the user restricted to specific platforms ("Aqar only"), show which,
  // so the filter is visibly confirmed. (user: "when I type alkhaas it must be al khaas, not aqar".)
  if (q.sources && q.sources.length) {
    const names = q.sources.map((s) => t(SOURCE_LABELS[s] ?? s)).join('، ');
    lines.push(`• ${t('Platform')}: ${names}`);
  }
  // Always show a location line. If nothing was typed/inferred, the search covers the whole Kingdom,
  // so the summary says "City: Saudi Arabia". (user request: empty region → Saudi Arabia.)
  const locLines = locationLines(q);
  if (locLines.length) for (const l of locLines) lines.push(`• ${l}`);
  else lines.push(`• ${t('City')}: ${t('Saudi Arabia')}`);
  for (const b of budgetLines(q)) lines.push(`• ${b}`);
  // Category/group-level refinements (filter UI). Each has its own field, so the labels are unambiguous.
  const summaryBeds = effectiveBeds(q);
  if (summaryBeds.length) lines.push(`• ${t('Bedrooms')}: ${summaryBeds.join('، ')}`);
  const aLo = numOrNull(q.areaMin), aHi = numOrNull(q.areaMax);
  if (aLo != null || aHi != null) {
    const r = aLo != null && aHi != null ? `${t('From')} ${grouped(aLo)} ${t('To')} ${grouped(aHi)}`
      : aLo != null ? `${t('From')} ${grouped(aLo)}` : `${t('To')} ${grouped(aHi!)}`;
    lines.push(`• ${t('Size')}: ${r} ${t('m²')}`);
  } else if (q.contextSize) lines.push(`• ${t('Size')}: ${q.contextSize} ${t('m²')}`);
  if (q.detail) {
    // Type/agent path shares ONE detail field for BEDROOM count OR SIZE. Label by VALUE: a bedroom-
    // shaped value (1–4 or "5+") → Bedrooms; a size band ("100–300 m²") or any larger number → Size.
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
  const lineTypes = effectiveTypes(q);
  if (lineTypes.length) parts.push(lineTypes.map((x) => arabicOrTypeUnresolved(tWord(x))).join('، '));
  else if (q.typeGroup) parts.push(arabicOrTypeUnresolved(t(q.typeGroup)));
  else if (q.category) parts.push(arabicOrTypeUnresolved(tWord(q.category)));
  parts.push(t(q.deal === 'Rent' ? 'Rent' : 'Buy'));
  if (q.location.trim()) parts.push(arabicOrUnresolved(tPlace(q.location.trim())));
  const qpLo = numOrNull(q.priceMin), qpHi = numOrNull(q.priceMax);
  if (qpLo != null || qpHi != null) {
    const r = qpLo != null && qpHi != null ? `${grouped(qpLo)}–${grouped(qpHi)}`
      : qpLo != null ? `${t('From')} ${grouped(qpLo)}` : `${t('To')} ${grouped(qpHi!)}`;
    parts.push(`${t('SAR')} ${r}`);
  } else if (q.priceBand) {
    parts.push(tPriceTab(q.priceBand));
  } else {
    const amount = parseInt((q.priceInput.match(/\d/g) ?? []).join(''), 10) || 0;
    if (amount) parts.push(`${t('SAR')} ${grouped(amount)}`);
  }
  const lineBeds = effectiveBeds(q);
  if (lineBeds.length) parts.push(t('{n} beds', { n: lineBeds.join('، ') }));
  const qaLo = numOrNull(q.areaMin), qaHi = numOrNull(q.areaMax);
  if (qaLo != null || qaHi != null) {
    const r = qaLo != null && qaHi != null ? `${grouped(qaLo)}–${grouped(qaHi)}`
      : qaLo != null ? `${t('From')} ${grouped(qaLo)}` : `${t('To')} ${grouped(qaHi!)}`;
    parts.push(`${r} ${t('m²')}`);
  } else if (q.contextSize) parts.push(t('{n} m²', { n: q.contextSize }));
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

export type SearchResult = { heading: string; notes: string[]; listings: Listing[]; sortNote?: string; count?: number; suggestion?: string; query?: SearchQuery; total?: number; pageOffset?: number; hasMore?: boolean; matchTotal?: number };

function pickPool(q: SearchQuery, pools: Pools): Listing[] {
  // A clean TYPE or subcategory GROUP is selected → the server fetch already scoped the rows, so run
  // over the whole fetched set and let matchesType decide. (The old keyword→mock-pool buckets only
  // covered a few residential types and would silently drop Shop/Office/Residential Building/etc.)
  if (q.type || (q.types && q.types.length) || q.typeGroup) return allRows(pools);
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
  // Explicit price RANGE (filter UI): min only → ≥, max only → ≤, both → between. The bounds are in the
  // SAME unit as the displayed price (Buy total; Rent annual or monthly per the chosen period), so they
  // compare directly. Wins over the legacy band / single ceiling. HARD (enforced in runSearch).
  const lo = numOrNull(q.priceMin), hi = numOrNull(q.priceMax);
  if (lo != null || hi != null) {
    const min = lo ?? 0, max = hi ?? Infinity;
    return (l) => withinValue(l.price, min, max);
  }
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
  // Explicit area RANGE (filter UI): min only → ≥, max only → ≤, both → between. Wins over the legacy
  // single contextSize / detail. Area = 0 (unknown) is always excluded once any area bound is set.
  const lo = numOrNull(q.areaMin), hi = numOrNull(q.areaMax);
  if (lo != null || hi != null) {
    const min = lo ?? 0, max = hi ?? Infinity;
    return (l) => l.area > 0 && l.area >= min && l.area <= max;
  }
  // Legacy single value (back-compat / agent): contextSize (own field), else the shared detail field.
  const raw = q.contextSize ?? (q.detail && !bedroomSpec(q) ? q.detail : null);
  if (!raw) return null;
  const r = parseSizeRange(raw);
  if (!r) return null;
  return (l) => l.area > 0 && l.area >= r.min && l.area <= r.max;
}

// The listing's CLEAN property type (normalized at read-time in remote.finalize). Falls back to the
// raw `type` for the bundled mock catalog (which has no cleanType).
const cleanOf = (l: Listing): string => l.cleanType ?? l.type;

// Does a listing satisfy the query's TYPE selection? CLEAN type (`q.type`) = EXACT match (a kept
// "Apartment" never shows a Floor/Building sibling). A subcategory GROUP (`q.typeGroup`) = any clean
// type in that group (broad). Macro only (`q.category`, no type) = same macro_category — this is what
// excludes a Commercial-Land row (macro=Commercial) from a Residential search even though it lives in
// a residential table. Nothing kept → match all. (clean-type filter; strict-contract preserved.)
// The selected clean types as a list: the filter's multi-select (`q.types`), else the single `q.type`
// (agent path) as a 1-element list, else empty. One code path covers single + multi everywhere.
export function effectiveTypes(q: SearchQuery): string[] {
  if (q.types && q.types.length) return q.types;
  return q.type ? [q.type] : [];
}

function matchesType(l: Listing, q: SearchQuery): boolean {
  const c = cleanOf(l);
  const sel = effectiveTypes(q);
  if (sel.length) return sel.some((s) => s === c || (SUBGROUPS[s]?.includes(c) ?? false)); // OR across selected clean types; a subgroup box (مرافق خدمية) matches any of its member types
  if (q.typeGroup) return groupMembers(q.typeGroup).includes(c);
  if (q.category) return (l.macro ?? CLEAN_MACRO[c] ?? 'Residential') === q.category;
  return true;
}

// Every fetched row, deduped by id. The server fetch already scoped rows to the selected clean type's
// raw set + tables, so when a type/group is chosen we run matchesType over the WHOLE fetched set
// rather than a single mock "pool" (which buckets by old raw type and could drop e.g. Shop/Building).
function allRows(pools: Pools): Listing[] {
  const seen = new Set<number>();
  const out: Listing[] = [];
  for (const arr of Object.values(pools)) for (const l of arr) if (!seen.has(l.id)) { seen.add(l.id); out.push(l); }
  return out;
}

// The bedroom counts selected at the filter's category/group level: the multi-select list
// (`contextBedsList`), else the single `contextBeds` as a 1-element list, else empty. One path
// covers single + multi everywhere (mirrors effectiveTypes). (multi-select bedrooms.)
export function effectiveBeds(q: SearchQuery): string[] {
  if (q.contextBedsList && q.contextBedsList.length) return q.contextBedsList;
  return q.contextBeds ? [q.contextBeds] : [];
}

// ALL bedroom tokens the query implies (bare "1".."4"/"5+"). Two sources: (1) the filter's
// category/group beds (effectiveBeds), used only when no specific type is selected; (2) the shared
// `detail` field — the agent path + type-level chip. A non-bedroom type (e.g. Office, where "3" is a
// size) is excluded. (audit: bedroom type-null hole; multi-select.)
export function bedroomTokens(q: SearchQuery): string[] {
  if (!q.type) {
    const fb = effectiveBeds(q).map((d) => (d || '').trim()).filter((d) => /^([1-4]|5\+?)$/.test(d));
    if (fb.length) return fb;
  }
  if (q.detail) {
    const d = q.detail.trim();
    if (/^([1-4]|5\+?)$/.test(d) && (!q.type || detailFor(q.type).isBedrooms)) return [d];
  }
  return [];
}

// The PRIMARY bedroom constraint (first selected) — or null when there's no bedroom filter. "5+" →
// { n: 5, atLeast: true }; "1".."4" → exact. Kept for the size/summary guards that only need to know
// "is `detail` a bedroom count?". The full multi-select set drives bedroomFilter below.
export function bedroomSpec(q: SearchQuery): { n: number; atLeast: boolean } | null {
  const toks = bedroomTokens(q);
  if (!toks.length) return null;
  const d = toks[0];
  return { n: parseInt(d, 10), atLeast: d.startsWith('5') }; // "5"/"5+" is the top bucket → 5 or more
}

// Bedroom predicate: keep ONLY listings whose count matches ANY selected bucket (OR across the chosen
// counts; "5+" → 5 or more, else exact). Unlike price/size, bedrooms is NEVER substituted with a
// "closest" value — a 6-bedroom house is a different property, not a near-match for a 3-bedroom
// request. Unknown counts (beds = 0) are excluded. (user: filter shows ONLY what I kept, period.)
function bedroomFilter(q: SearchQuery): ((l: Listing) => boolean) | null {
  const matchers = bedroomTokens(q).map((d) => {
    const n = parseInt(d, 10);
    return d.startsWith('5') ? (l: Listing) => l.beds >= n : (l: Listing) => l.beds === n;
  });
  if (!matchers.length) return null;
  return (l) => matchers.some((m) => m(l));
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
  const raw = q.contextSize ?? (q.detail && !bedroomSpec(q) ? q.detail : null);
  if (!raw) return null;
  const d = raw.replace(/,/g, '').trim();
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
    const r = l.regionAr || CITY_TO_REGION[l.city] || 'Other';
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

// The price/size relevance bonus (0..2): how close a listing is to the user's budget/size. 0 when no
// price or size was given (a broad search → every listing is equally relevant).
function closenessBonus(l: Listing, q: SearchQuery, cap: number | null): number {
  let bonus = 0;
  if (cap && cap > 0) {
    const v = listingPriceValue(l.price);
    if (!Number.isNaN(v) && v > 0) bonus += 1 - Math.min(1, Math.max(0, v - cap) / cap);
  }
  const target = exactSizeTarget(q);
  if (target && l.area > 0) bonus += 1 - Math.min(1, Math.abs(l.area - target) / target);
  return bonus;
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

// Greedy de-cluster: avoid two listings with the same key back-to-back WHEN an alternative exists — but
// NEVER skip, cap, or reserve a slot (if one group is all that's left, it just continues). Gives a
// NATURAL, proportional spread, not a forced equal split. (user: diversity is a bonus, never forced;
// never hide a listing to show more variety.)
function naturalSpread<T>(items: T[], key: (x: T) => string): T[] {
  const pool = [...items];
  const out: T[] = [];
  let prev: string | null = null;
  while (pool.length) {
    let i = pool.findIndex((x) => key(x) !== prev);
    if (i < 0) i = 0;
    const [pick] = pool.splice(i, 1);
    out.push(pick);
    prev = key(pick);
  }
  return out;
}

// THE result-display rule (user, UPDATED 2026-07-13 — see below): RELEVANCE / intent first; filters
// (Rule 1) always win. Platform diversity (Rule 2) is no longer merely "a bonus that survives if it's
// already there" — it is now enforced structurally in remote.ts's orderByScope (platform is the outermost
// diversity key for every scope) plus a page-0 candidate-pool diversity seed, specifically BECAUSE the
// prior "if the best matches are all one platform, that's fine" stance (still true for a genuinely
// single-platform result — Rule 2 never invents a platform that has no match) was found, live, to let one
// platform crowd out a LARGER platform's real matches on a SPECIFIC (non-broad) search — the exact
// scenario this comment used to say was fine. This function's own job is unchanged: never re-shuffle or
// undo the diversity order the upstream step already produced.
function rankResults(listings: Listing[], q: SearchQuery, cap: number | null): Listing[] {
  // Coarse relevance tiers (closer price/size ranks higher). No price/size → one tier (all equal). WITHIN
  // each tier we PRESERVE the order the server diversity step already produced (orderByScope:
  // platform→region→city→district per scope, owner 2026-07-13), so platform/district/city diversity
  // SURVIVES to the displayed top-25 — we no longer random-shuffle here (that used to drop platform
  // diversity on broad searches).
  // Repeat-visit variety now comes from the deterministic rotation in runSearch, not randomness. (diversity fix.)
  const tiers = new Map<number, Listing[]>();
  for (const l of listings) {
    const k = Math.round(closenessBonus(l, q, cap) * 50);
    if (!tiers.has(k)) tiers.set(k, []);
    tiers.get(k)!.push(l);
  }
  const out: Listing[] = [];
  for (const k of [...tiers.keys()].sort((a, b) => b - a)) out.push(...tiers.get(k)!);  // closest tier first; diversity order kept
  return out;
}

export function runSearch(q: SearchQuery, pools: Pools = POOLS, opts?: { fetchFailed?: boolean; visitOffset?: number }): SearchResult {
  let eligible = pickPool(q, pools)
    // bothDeals (agent searched without knowing rent/buy) → show BOTH; otherwise filter to the deal.
    .filter((l) => q.bothDeals || l.deal === q.deal)
    .filter((l) => supports(l.source, q.deal))
    // Clean-type match — exact for a kept type, group-member for a subcategory, macro for category. (audit.)
    .filter((l) => matchesType(l, q))
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
  // Multi-city ambiguity notice — when the typed location matched several cities, we searched ALL of
  // them and surface this so the user knows + can refine. (user: prefer results + notice over asking.)
  if (q.locationMatch?.ambiguous && q.locationMatch.cities && q.locationMatch.cities.length > 1) {
    ns.unshift(t('We found multiple locations matching "{name}". Showing the closest matches from our database.', { name: q.locationMatch.raw || q.location }));
  }
  let listings = eligible;
  // Apply the price filter HARD — like size/bedrooms, NEVER substitute "closest above". A kept max means
  // the user must not see anything priced above it; zero in-range → show none and let the 0-results path
  // offer to relax the budget. (user 2026-06-28: price is a hard filter, honest zero, no closest-above.)
  const fits = priceFilter(q);
  if (fits != null) listings = listings.filter(fits);
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

  // Street / "near X" / facade text search (Q3). When the user asked about a street, a facade, a
  // landmark, or proximity ("near a mosque/school/park"), match the term against each listing's OWN
  // text — street name, title, description, facade, project, additional-info. If real matches exist,
  // show ONLY them; if not enough platforms publish that detail, keep the area's listings and say so.
  // We never invent that a listing is near something — only what the listing itself says. (user spec.)
  if (q.keywords && q.keywords.length && listings.length) {
    // Text-search a street/keyword ONLY for a GENUINE street/proximity ask — never when the term is just
    // part of the place the user already picked. ~31 real districts ARE named after a street (e.g. «شارع
    // الملك عبدالله», «الطريق الدائري الغربي»); for those the location filter already handles it, so we do
    // NOT layer a street/title/description text search on top. A free-typed street that ISN'T a structured
    // place (kind 'none') keeps its keyword. (audit fix: those fields are checked only when truly asked.)
    const structured = ['district', 'city', 'region', 'area'].includes(q.locationMatch?.kind ?? 'none');
    const locText = `${q.location ?? ''} ${q.locationMatch?.label ?? ''} ${(q.districts ?? []).join(' ')}`.toLowerCase();
    const kws = q.keywords
      .map((k) => k.toLowerCase())
      .filter(Boolean)
      .filter((k) => !(structured && locText.includes(k)));
    if (kws.length) {
      const matched = listings.filter((l) => {
        const blob = [l.street_name, l.title, l.description, l.direction, l.project_name, l.road, l.district,
          ...((l.additional_info ?? []).map((a) => a.value))].filter(Boolean).join(' ').toLowerCase();
        return kws.some((k) => blob.includes(k));
      });
      if (matched.length) {
        listings = matched;
        ns.push(t('Showing listings whose details mention what you searched for — street and nearby info is published by only some platforms.'));
      } else {
        ns.push(t('Only some platforms provide street or nearby information, so showing listings from the same district instead.'));
      }
    }
  }

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
    // Relevance / intent FIRST (Rule 1, filters, already applied above); platform diversity (Rule 2,
    // owner PERMANENT 2026-07-13) is enforced upstream in remote.ts's orderByScope and preserved here
    // within each relevance tier — see rankResults' own comment for the full rule. Only real listings.
    listings = rankResults(listings, q, cap);
  }
  // Location-RELATIONSHIP ranking — applies to BOTH branches above. A proximity intent («قريب من مسجد» /
  // «يطل على البحر») is the user's PRIMARY ask, so the listings that actually express that relationship
  // (evidence in their own title/description/source_capture, precomputed into l.proximityBoost by
  // fetchListingsForQuery) MUST lead — even when the agent attached a DEFAULT sort like 'newest' (shown as
  // «مرتّبة من الأحدث»). STABLE: equal-boost listings keep whatever order the branch above produced
  // (an objective sort OR relevance→diversity→recency), so a real "cheapest/biggest" sort still orders
  // WITHIN the boosted matches. (live-path fix 2026-06-27: the boost previously sat ONLY in the
  // no-explicit-sort branch, so the agent's default 'newest' sort skipped it and proximity searches came
  // back recency-ranked instead of relationship-ranked.)
  if (q.proximity && q.proximity.length && listings.length) {
    listings = listings
      .map((l, i) => ({ l, i, s: l.proximityBoost ?? 0 }))
      .sort((a, b) => (b.s - a.s) || (a.i - b.i))
      .map((x) => x.l);
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
  // ONE display rule for EVERY search (incl. country-wide): the best 25 ranked closest→least. (The
  // Show-More-to-200 paging is a UI increment on top; the engine returns the ranked set.) (user.)
  // TOTAL matches (before any display cap) — drives the «more than 25» message + the show-all button.
  const total = listings.length;
  // QUALITY-PRESERVING repeat-visit rotation (user 2026-06-27): on a repeat search of the SAME filter
  // (visitOffset advances per visit, persisted by the caller), rotate a 25-window over the TOP-quality
  // pool so a return visitor sees DIFFERENT high-quality listings — deterministic, never random, always
  // inside the same filters. First visit (offset 0) shows the top 25 as usual.
  if (opts?.visitOffset && total > 25) {
    const POOL = Math.min(total, 100);
    const off = (opts.visitOffset * 25) % POOL;
    if (off > 0) listings = [...listings.slice(off, POOL), ...listings.slice(0, off), ...listings.slice(POOL)];
  }
  // Return up to the system max (200) so "show all" reveals beyond the first 25 with NO refetch; the UI
  // shows the first 25 and only reveals the rest when the user taps «عرض جميع النتائج». (user: first 25 + show-all.)
  // Reveal cap raised 200→1500 (owner 2026-07-08): with filter-first the fetched candidates are already
  // the MATCHING set, so «عرض جميع النتائج» must be able to reveal ALL of them (progressively), not just
  // the first 200. Matches the fetch cap so no matching listing is unreachable. [[filter-candidate-cap-underreturn-2026-07-08]]
  const SHOW_ALL_MAX = 1500;
  return { heading: heading(q), notes: ns, listings: listings.slice(0, SHOW_ALL_MAX), sortNote, count, suggestion, total };
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
      .filter((l) => matchesType(l, q2));
    if (q2.districts && q2.districts.length) {
      list = list.filter((l) => listingInDistricts(l.district || '', q2.districts!));
    }
    const pf = priceFilter(q2); if (pf) list = list.filter(pf);
    const sf = sizeFilter(q2); if (sf) list = list.filter(sf);
    const bf = bedroomFilter(q2); if (bf) list = list.filter(bf);
    return list.length;
  };
  // Filter location policy: an EXPLICIT catalog place (region/city/district) that genuinely has ZERO
  // listings for the chosen deal+category → say so plainly. NEVER "did you mean", never substitute a
  // nearby place. (The filter catalog ≠ the listing DB; some real places correctly return zero.)
  const lm = q.locationMatch;
  // EXACT = a real catalog/inventory place the user clearly named or picked (district/city/region), NOT a
  // fuzzy typo guess. Only an exact-but-empty place gets the honest zero-state; a misspelled near-miss
  // («القرص») falls through to the «هل تقصد الرس؟» suggestion below. (user: typo = ask/did-you-mean.)
  const explicitPlace = !!lm && lm.exact === true && (lm.kind === 'district' || lm.kind === 'city' || lm.kind === 'region');
  if (explicitPlace && countWith({ priceInput: '', priceBand: null, priceMin: null, priceMax: null, detail: null, contextBeds: null, contextBedsList: null, contextSize: null, areaMin: null, areaMax: null, type: null, types: null, typeGroup: null }) === 0) {
    return t('No listings in this location right now.');
  }
  // "Did you mean X?" — fires for: (a) a free-typed unresolved place (typo/obscure town) whose lm has
  // NO live inventory and a close city exists, OR (b) bug-fix #9: a fuzzy-corrected city (lm.fuzzy)
  // REGARDLESS of whether the corrected city has inventory — the locked rule is never to silently
  // swap cities, so the user must see «هل تقصد X؟» before accepting the substitute. (user request.)
  const lmCity = q.locationMatch?.city || '';
  const isFuzzy = q.locationMatch?.fuzzy === true;
  if (!explicitPlace && q.location.trim() && (isFuzzy || !lmCity || !cityHasListings(lmCity))) {
    const alt = isFuzzy && lmCity
      ? { cityEn: lmCity, region: q.locationMatch?.region || '', n: 0 }
      : nearbyCityWithListings(q.locationMatch?.raw || q.location, lmCity);
    if (alt) {
      return t('We couldn’t find listings in "{place}". Did you mean {alt}?', { place: q.locationMatch?.label || q.location, alt: arabicOrUnresolved(cityDisplay(alt.cityEn, getLocale())) });
    }
  }
  if ((q.priceInput || q.priceMin || q.priceMax) && countWith({ priceInput: '', priceMin: null, priceMax: null }) > 0) {
    return t("No listings in that price range — there are matches outside it. Want me to remove the price filter?");
  }
  if (q.districts?.length && countWith({ districts: undefined }) > 0) {
    return t("No matches in that specific area — but I can find some elsewhere in the same city. Want me to widen the area?");
  }
  if ((q.detail || q.contextBeds || q.contextBedsList?.length || q.contextSize || q.areaMin || q.areaMax) && countWith({ detail: null, contextBeds: null, contextBedsList: null, contextSize: null, areaMin: null, areaMax: null }) > 0) {
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
