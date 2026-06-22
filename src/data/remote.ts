import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';
import { type Deal, CATEGORY_TYPES } from './taxonomy';
import type { SearchQuery } from './search';
import { REGIONS, isCountryWideQuery, interleave } from './regions';
import { translitPlace } from '@/lib/translitPlace';

// Session cache of every listing we've fetched (by id) — lets the in-app browser open any listing
// the user has seen without a refetch, even though we no longer hold the whole table in memory.
const LISTING_CACHE = new Map<number, Listing>();
function cacheListings(rows: Listing[]): void { for (const r of rows) LISTING_CACHE.set(r.id, r); }
export function getCachedListing(id: number): Listing | undefined { return LISTING_CACHE.get(id); }

// Canonical Saudi city names as stored in the DB (English). Used to decide whether q.location is a
// CITY we can push to a server-side filter, vs a district/landmark phrase (which the client resolves
// fuzzily against the fetched subset). Substring match both ways so "Riyadh"/"al riyadh" both hit.
// MUST mirror the scraper's canonical city labels (scrapers/common/normalize.CITY_MAP_AR values) —
// these are the exact `city` strings stored in the DB, so a user searching any of these scopes the
// server-side fetch to it. Adding a town here is what makes it findable. (~90 towns, all 13 regions.)
const KNOWN_CITIES = [
  // Riyadh region
  'Riyadh', 'Al Kharj', 'Al Majmaah', 'Dawadmi', 'Al Zulfi', 'Afif', 'Al Quwayiyah', 'Shaqra',
  'Diriyah', 'Al Muzahimiyah', 'Thadiq', 'Hawtat Bani Tamim', 'Al Ghat', 'Rumah', 'Al Dalam',
  'Al Hariq', 'As Sulayyil', 'Al Hayathim',
  // Makkah region
  'Jeddah', 'Mecca', 'Taif', 'Rabigh', 'Al Qunfudhah', 'KAEC', 'Thuwal', 'Al Jumum', 'Al Kamil',
  'Al Lith', 'Turabah', 'Raniyah', 'Al Khurma',
  // Madinah region
  'Medina', 'Yanbu', 'Al Ula', 'Badr', 'Al Hanakiyah', 'Umluj', 'Khaybar', 'Mahd adh Dhahab',
  // Qassim region
  'Buraidah', 'Unaizah', 'Ar Rass', 'Al Bukayriyah', 'Al Mithnab', 'Al Badai', 'Riyadh Al Khabra',
  'An Nabhaniyah', 'Ash Shamasiyah',
  // Eastern region
  'Dammam', 'Khobar', 'Dhahran', 'Hofuf', 'Jubail', 'Qatif', 'Hafar Al Batin', 'Ras Tanura',
  'Abqaiq', 'An Nairyah', 'Khafji', 'Sayhat', 'Safwa', 'Tarout', 'Anak', 'Al Uyun',
  // Asir region
  'Abha', 'Khamis Mushait', 'Bisha', 'Mahayel', 'Ahad Rafidah', 'Al Majardah', 'Balsamar', 'Tathlith',
  // Tabuk region
  'Tabuk', 'Duba', 'Al Wajh', 'Tayma',
  // Hail region
  'Hail', 'Baqaa', 'Al Ghazalah', 'Ash Shanan',
  // Northern Borders region
  'Arar', 'Rafha', 'Turaif',
  // Jazan region
  'Jazan', 'Sabya', 'Abu Arish', 'Samtah', 'Baysh', 'Ahad Al Masarihah',
  // Najran region
  'Najran', 'Sharurah',
  // Al Bahah region
  'Al Baha',
  // Al Jouf region
  'Sakaka', 'Qurayyat', 'Dawmat Al Jandal',
];
// Alternate spellings → the canonical DB label. Two jobs: (1) human typos/synonyms (Al Ahsa's
// listings live under Hofuf); (2) CANONICALIZE the AI agent's output — the agent transliterates
// town names differently than the scraper labels them ("AlUla" vs DB "Al Ula"), so without this
// the agent's reply scopes to a city with 0 rows and silently returns nothing despite live data.
// Keys are lowercase (cityFilterFor lowercases before lookup). Audited agent↔DB drift, June 2026.
const CITY_ALIASES: Record<string, string> = {
  // Al Ahsa region → its city label Hofuf
  'al ahsa': 'Hofuf', 'al hasa': 'Hofuf', 'alahsa': 'Hofuf', 'hasa': 'Hofuf', 'ahsa': 'Hofuf',
  'al khobar': 'Khobar', 'al qatif': 'Qatif',
  // Agent transliteration variants → canonical DB labels
  'alula': 'Al Ula', 'al ula': 'Al Ula',
  'al henakiyah': 'Al Hanakiyah',
  'al mahd': 'Mahd adh Dhahab', 'mahd al dhahab': 'Mahd adh Dhahab',
  'muhayil aseer': 'Mahayel', 'muhayil': 'Mahayel', 'mahayil': 'Mahayel', 'mahail': 'Mahayel',
  'nairiyah': 'An Nairyah', 'al nairyah': 'An Nairyah', 'nairyah': 'An Nairyah',
  'al majaridah': 'Al Majardah', 'al-majaridah': 'Al Majardah', 'majaridah': 'Al Majardah',
  'tathleeth': 'Tathlith',
  'al shimasiyah': 'Ash Shamasiyah', 'al shamasiyah': 'Ash Shamasiyah', 'shamasiyah': 'Ash Shamasiyah',
  'ash shinan': 'Ash Shanan', 'al shinan': 'Ash Shanan', 'shinan': 'Ash Shanan',
  'al nabhaniyah': 'An Nabhaniyah', 'nabhaniyah': 'An Nabhaniyah',
  'al badayea': 'Al Badai', 'badayea': 'Al Badai', 'al badai': 'Al Badai',
  'dumat al jandal': 'Dawmat Al Jandal',
  'al qurayyat': 'Qurayyat', 'qurayyat': 'Qurayyat',
  'al dawadmi': 'Dawadmi',
  'zulfi': 'Al Zulfi',
  'al dilam': 'Al Dalam', 'dilam': 'Al Dalam', 'al delam': 'Al Dalam',
  'hotat bani tamim': 'Hawtat Bani Tamim', 'hawtat bani tameem': 'Hawtat Bani Tamim',
  'al sulayyil': 'As Sulayyil', 'sulayyil': 'As Sulayyil', 'al sulayil': 'As Sulayyil',
  'buraydah': 'Buraidah',
  'uyun al jiwa': 'Al Uyun', 'oyun al jiwa': 'Al Uyun',
};
function cityFilterFor(location: string): string | null {
  const loc = location.trim().toLowerCase();
  if (!loc) return null;
  if (CITY_ALIASES[loc]) return CITY_ALIASES[loc];
  // Exact match first — avoids a short city name (e.g. "Badr", "Duba") substring-matching a longer
  // unrelated location phrase before the intended city is reached.
  for (const c of KNOWN_CITIES) if (loc === c.toLowerCase()) return c;
  for (const c of KNOWN_CITIES) {
    const cl = c.toLowerCase();
    if (loc.includes(cl) || cl.includes(loc)) return c;
  }
  return null; // not a recognized city → don't constrain server-side; client narrows by district
}

// Map a SearchQuery's type → the DB property_type values the client pool needs. MUST mirror
// buildPools' TYPE_TO_POOL grouping (listings.ts) so the server returns exactly the rows the chosen
// client pool draws from — e.g. asking for "Apartment" must also return House/Floor/Building/etc
// because they share the apartment pool. Returns null = don't constrain (whole category).
function dbTypesFor(q: SearchQuery): string[] | null {
  // A kept type must match EXACTLY — no sibling grouping. Keeping "Apartment" used to also pull Floor/
  // Building/Rest House/Chalet/Camp (and the 1500-row cap could starve out every Apartment so ZERO were
  // reachable); keeping "Residential Land" pulled Commercial Land. The fetch now constrains to the one
  // canonical kept type, so the 1500-row budget is spent on it. (user: cards must match the kept type.)
  if (q.type) return [q.type];
  // No specific type kept → whole category. We no longer need to constrain by the category's type
  // list, because Residential and Commercial now live in SEPARATE tables (see tableFor) — selecting
  // the right table already scopes the category. Return null = the whole (correct) table.
  return null;
}

// Residential and Commercial are stored in two tables with identical schema. Pick the right one so a
// Commercial search reads real commercial inventory instead of an honest-but-empty residential 0.
// Route by category OR by a commercial TYPE — the agent often returns type:"Shop" without setting
// category:"Commercial", and the two type lists never overlap, so the type alone is decisive.
function isCommercialQuery(q: SearchQuery): boolean {
  return q.category === 'Commercial' || (!!q.type && CATEGORY_TYPES.Commercial.includes(q.type));
}
// Convert a listing's `additional_info` into the {key,label,value} rows the card's
// AdditionalInformationPanel renders. Two shapes exist in the DB:
//   • LEGACY (Wasalt/Aqar Gate): already an array of {label,value} → pass through.
//   • NEW (Aqarcity/Eastabha/Sanadak/Raghdan/Candles/Satel/Sadin): a JSON object of rich fields
//     (REGA license, amenities, services, furnishing, parcel/plan, facade, …) — whitelist the
//     user-valuable keys here, in priority order, with i18n-able labels. Internal/raw keys
//     (city_ar, lat/lng, *_ar, dates, ids) are intentionally excluded. (user: the valuable
//     fields in "additional features" weren't showing for the new sources.)
const ADDL_FIELDS: Array<[string, string]> = [
  ['features', 'Amenities'],
  ['features_ar', 'Amenities'],
  ['services', 'Property services'],
  ['furnishing', 'Furnishing'],
  ['property_age', 'Building age (years)'],
  ['age_text', 'Building age (years)'],
  ['facade', 'Facade'],
  ['floors', 'Total Floors'],
  ['kitchens', 'Kitchens'],
  ['halls', 'Majlis / Halls'],
  ['property_use', 'Property usage'],
  ['usage', 'Property usage'],
  ['street_width', 'Street width'],
  ['parking_type', 'Parking type'],
  ['parking_spots', 'Number of Parkings'],
  ['air_conditioning_type', 'AC type'],
  ['kitchen', 'Kitchen'],
  ['rega_ad_license_number', 'Ad license number'],
  ['rega_license_status', 'License status'],
  ['rega_license_issue_date', 'License Issuance Date'],
  ['rega_license_expiry_date', 'License expiry'],
  ['broker_fal_license', 'FAL license'],
  ['parcel_number', 'Parcel number'],
  ['plan_number', 'Plan number'],
  ['postal_code', 'Postal Code'],
  ['building_code_compliant', 'Building code compliant'],
  ['warranties', 'Warranties'],
  ['deed_location_text', 'Deed location'],
  ['status_ar', 'Status'],
  ['availability_status', 'Status'],
  ['address', 'Address'],
  ['street_address', 'Address'],
];
function buildAdditionalInfo(raw: any): Array<{ key: string; label: string; value: string }> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const rows = raw.filter((r: any) => r && r.label && r.value);
    return rows.length ? rows : null;
  }
  if (typeof raw !== 'object') return null;
  const out: Array<{ key: string; label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const [key, label] of ADDL_FIELDS) {
    if (seen.has(label)) continue;
    let v: any = raw[key];
    if (v === null || v === undefined || v === '' || v === '0' || v === false) continue;
    if (Array.isArray(v)) { v = v.filter(Boolean).join('، '); if (!v) continue; }
    else if (typeof v === 'boolean') v = 'Yes';
    else if (typeof v === 'object') continue;
    else v = String(v).trim();
    if (!v || v === '0') continue;
    if (v.length > 120) v = v.slice(0, 117) + '…';
    seen.add(label);
    out.push({ key, label, value: v });
  }
  return out.length ? out : null;
}

// All LAND lives in the residential table — Aqar treats land as ONE category (أراضي), which we scrape
// there, then split by zoning (Residential/Commercial/Industrial/Agriculture) from the listing text.
// So a "Commercial Land" search must read the residential table even though it's a Commercial-category
// type — otherwise it hits the (land-less) commercial table and returns 0. (user: split the land.)
const LAND_TYPES = new Set(['Residential Land', 'Commercial Land', 'Industrial Land', 'Agriculture Plot']);
function tableFor(q: SearchQuery): string {
  if (q.type && LAND_TYPES.has(q.type)) return 'aqar_residential_listings';
  return isCommercialQuery(q) ? 'aqar_commercial_listings' : 'aqar_residential_listings';
}

// Multi-source: which Aqar+Wasalt+Aldarim tables to read for this query. Residential queries hit all
// three residential tables; commercial queries hit all three commercial tables; land types read the
// residential tables (where land lives). Each card renders its own SourceBadge so users see the
// platform. (user request: mix all sources.)
function tablesFor(q: SearchQuery): string[] {
  if (q.type && LAND_TYPES.has(q.type))
    return ['aqar_residential_listings', 'wasalt_residential_listings', 'aldarim_residential_listings', 'aqargate_residential_listings', 'alhoshan_residential_listings', 'hajer_residential_listings', 'sanadak_residential_listings', 'eastabha_residential_listings', 'aqarcity_residential_listings', 'raghdan_residential_listings', 'eaqartabuk_residential_listings', 'satel_residential_listings', 'sadin_residential_listings', 'toor_residential_listings', 'mustqr_residential_listings', 'ramzalqasim_residential_listings', 'fursaghyr_residential_listings', 'jazwtn_residential_listings', 'mizlaj_residential_listings', 'muktamel_residential_listings', 'semsar_residential_listings', 'aqaratikom_residential_listings', 'awal_residential_listings', 'alkhaas_residential_listings', 'abeea_residential_listings', 'jurash_residential_listings', 'alnokhba_residential_listings'];
  return isCommercialQuery(q)
    ? ['aqar_commercial_listings', 'wasalt_commercial_listings', 'aldarim_commercial_listings', 'aqargate_commercial_listings', 'alhoshan_commercial_listings', 'hajer_commercial_listings', 'sanadak_commercial_listings', 'eastabha_commercial_listings', 'aqarcity_commercial_listings', 'raghdan_commercial_listings', 'eaqartabuk_commercial_listings', 'satel_commercial_listings', 'sadin_commercial_listings', 'toor_commercial_listings', 'mustqr_commercial_listings', 'ramzalqasim_commercial_listings', 'fursaghyr_commercial_listings', 'jazwtn_commercial_listings', 'mizlaj_commercial_listings', 'muktamel_commercial_listings', 'semsar_commercial_listings', 'aqaratikom_commercial_listings', 'awal_commercial_listings', 'alkhaas_commercial_listings', 'abeea_commercial_listings', 'jurash_commercial_listings', 'alnokhba_commercial_listings']
    : ['aqar_residential_listings', 'wasalt_residential_listings', 'aldarim_residential_listings', 'aqargate_residential_listings', 'alhoshan_residential_listings', 'hajer_residential_listings', 'sanadak_residential_listings', 'eastabha_residential_listings', 'aqarcity_residential_listings', 'raghdan_residential_listings', 'eaqartabuk_residential_listings', 'satel_residential_listings', 'sadin_residential_listings', 'toor_residential_listings', 'mustqr_residential_listings', 'ramzalqasim_residential_listings', 'fursaghyr_residential_listings', 'jazwtn_residential_listings', 'mizlaj_residential_listings', 'muktamel_residential_listings', 'semsar_residential_listings', 'aqaratikom_residential_listings', 'awal_residential_listings', 'alkhaas_residential_listings', 'abeea_residential_listings', 'jurash_residential_listings', 'alnokhba_residential_listings'];
}

// Round-robin interleave so cards alternate between Aqar and Wasalt instead of front-loading one.
function interleaveSources<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

const QUERY_LIMIT = 1500; // newest N matching rows — plenty for the 25-card display + load-more

// Apply the kept NON-location filters (deal, type, rent period) to a fresh query on the right table.
// Location scoping is added by the caller (city / region / country-wide). Keeps every branch identical
// on the strict-contract fields. (filter contract.)
function keptFiltersReq(q: SearchQuery, table?: string) {
  let req = supabase!.from(table ?? tableFor(q)).select(LIST_SELECT).eq('active', true);
  if (!q.bothDeals) req = req.eq('transaction_type', q.deal === 'Buy' ? 'Buy' : 'Rent');
  const types = dbTypesFor(q);
  if (types && types.length) req = req.in('property_type', types);
  if (q.deal === 'Rent' && q.rentPeriod === 'monthly') req = req.eq('rent_period', 'monthly');
  else if (q.deal === 'Rent' && q.rentPeriod === 'annual') req = req.or('rent_period.eq.annual,rent_period.is.null');
  return req;
}

// Server-side per-search fetch — the heart of the scale fix. Instead of downloading the whole 21k+
// row table (which now times out → app got zero listings), we push the cheap exact filters
// (transaction_type, property_type group, city) to Postgres and pull only the matching rows WITH
// photos. The client's runSearch then applies the intricate price/size/district/sort/suggestion
// logic on this small subset. Ordered newest-first (cheap on the indexed, filtered set). Returns
// null on backend error (so the caller can show a retry message), [] when there genuinely are no
// matches. (user-reported: search broken / "Loading listings" because the whole-table load timed out.)
export async function fetchListingsForQuery(q: SearchQuery): Promise<Listing[] | null> {
  if (!supabase) return null;
  // City — scope to a recognized city. Prefer a city named in the raw text; otherwise fall back to the
  // resolver's canonical city, so a kept DISTRICT/landmark/Arabic-city ("Al Olaya", "العليا، الرياض",
  // "near KAFD") scopes to its city instead of leaking all 21 cities. (audit: location leak.) The
  // client then narrows to the exact district WITHIN that city via q.districts.
  const city = cityFilterFor(q.location || '')
    || (q.locationMatch?.city ? cityFilterFor(q.locationMatch.city) : null);

  // COUNTRY-WIDE ("Saudi"): no specific city → diversify across all 13 regions. Pull the newest K from
  // each region's cities IN PARALLEL, then round-robin them, so the results span the Kingdom instead
  // of being dominated by Riyadh/Jeddah's freshest. The kept strict filters (deal/type/period) still
  // apply to every per-region query; bedrooms/price/size stay client-side as always. (user request.)
  if (!city && isCountryWideQuery(q)) {
    const regionKeys = Object.keys(REGIONS);
    const tables = tablesFor(q);
    // Quota split across (region × source) so all 13 regions × both sources are represented in
    // the pool, and at display time interleave puts an Aqar then a Wasalt then an Aqar… (user.)
    const perBucket = Math.ceil(QUERY_LIMIT / (regionKeys.length * tables.length));
    const lists = await Promise.all(
      regionKeys.flatMap((rk) => tables.map(async (tbl) => {
        const { data } = await keptFiltersReq(q, tbl).in('city', REGIONS[rk]).order('id', { ascending: false }).limit(perBucket);
        return data ? finalize(data) : [];
      })),
    );
    const rows = interleave(lists);
    cacheListings(rows);
    return rows;
  }

  // A place was NAMED but resolves to NO city we carry (e.g. a typo / unknown like "Rwam"), and it's
  // not a district narrow within a city → return NONE so the UI says "couldn't find that place",
  // instead of dumping nationwide cards under a label that doesn't match them. (user: match what I
  // wrote to the cards, or tell me you couldn't find it — never show the wrong cities.)
  if (!city && (q.location || '').trim() && !(q.districts && q.districts.length)) {
    return [];
  }

  // City-scoped path — query BOTH the Aqar table AND the Wasalt table in parallel, then interleave
  // so cards alternate sources (Aqar, Wasalt, Aqar, Wasalt…). Bedrooms is filtered CLIENT-side
  // (runSearch), NOT here — same as price/size — so a 0-match search can still see other counts
  // exist for the "drop the bedroom count?" relaxation. (user: mix both sources in results.)
  const tables = tablesFor(q);
  const perTable = Math.ceil(QUERY_LIMIT / tables.length);
  const lists = await Promise.all(tables.map(async (tbl) => {
    let req = keptFiltersReq(q, tbl);
    if (city) req = req.eq('city', city);
    req = req.order('id', { ascending: false }).limit(perTable);
    const { data } = await req;
    return data ? finalize(data) : [];
  }));
  // If BOTH queries errored (no data anywhere) return null so the UI shows the retry message,
  // not an empty-result message. Otherwise interleave whatever each side returned.
  if (lists.every((l) => l.length === 0)) {
    // Distinguish "real empty" from "all errored" — re-query one table to confirm.
    const probe = await keptFiltersReq(q, tables[0]).limit(1);
    if (probe.error) return null;
  }
  const rows = interleaveSources(lists);
  cacheListings(rows);
  return rows;
}

// Resolve a single listing by id (in-app browser deep-links / a listing not in the current subset).
export async function fetchListingById(id: number): Promise<Listing | null> {
  const hit = LISTING_CACHE.get(id);
  if (hit) return hit;
  if (!supabase) return null;
  // All four tables share one id sequence, so an id is unique across them. Try residential first
  // (far larger), then commercial; try Aqar before Wasalt only because Aqar is bigger.
  for (const table of [
    'aqar_residential_listings', 'aqar_commercial_listings',
    'wasalt_residential_listings', 'wasalt_commercial_listings',
    'aldarim_residential_listings', 'aldarim_commercial_listings',
    'aqargate_residential_listings', 'aqargate_commercial_listings',
    'alhoshan_residential_listings', 'alhoshan_commercial_listings',
    'hajer_residential_listings', 'hajer_commercial_listings',
    'sanadak_residential_listings', 'sanadak_commercial_listings',
    'eastabha_residential_listings', 'eastabha_commercial_listings',
    'aqarcity_residential_listings', 'aqarcity_commercial_listings',
    'raghdan_residential_listings', 'raghdan_commercial_listings',
    'eaqartabuk_residential_listings', 'eaqartabuk_commercial_listings',
    'satel_residential_listings', 'satel_commercial_listings',
    'sadin_residential_listings', 'sadin_commercial_listings',
    'toor_residential_listings', 'toor_commercial_listings',
    'mustqr_residential_listings', 'mustqr_commercial_listings',
    'ramzalqasim_residential_listings', 'ramzalqasim_commercial_listings',
    'fursaghyr_residential_listings', 'fursaghyr_commercial_listings',
    'jazwtn_residential_listings', 'jazwtn_commercial_listings',
    'mizlaj_residential_listings', 'mizlaj_commercial_listings',
    'muktamel_residential_listings', 'muktamel_commercial_listings',
    'semsar_residential_listings', 'semsar_commercial_listings',
    'aqaratikom_residential_listings', 'aqaratikom_commercial_listings',
    'awal_residential_listings', 'awal_commercial_listings',
    'alkhaas_residential_listings', 'alkhaas_commercial_listings',
    'abeea_residential_listings', 'abeea_commercial_listings',
    'jurash_residential_listings', 'jurash_commercial_listings',
    'alnokhba_residential_listings', 'alnokhba_commercial_listings',
  ]) {
    const { data, error } = await supabase.from(table).select(LIST_SELECT).eq('id', id).limit(1);
    if (error || !data || !data.length) continue;
    const [row] = finalize(data);
    if (row) { LISTING_CACHE.set(row.id, row); return row; }
  }
  return null;
}

// Fetches the REAL Aqar listings + every column the new card design needs (rank/photo/title/
// All columns the rich card design needs (rank/photo/title/price/RNPL badge/stat row/features grid).
// Shared by every fetch so the row shape is consistent.
const LIST_SELECT = [
  'id', 'ad_number', 'listing_url',
  'property_type', 'transaction_type',
  'city', 'neighborhood',
  'price_annual', 'price_total', 'rent_period',
  'area_m2', 'bedrooms', 'bathrooms',
  'master_bedrooms', 'halls', 'reception_rooms_majlis',
  'property_age', 'direction', 'street_name', 'residence_type', 'project_name',
  'parking', 'elevator', 'kitchen', 'maid_room', 'driver_room',
  'air_conditioner', 'water_supply', 'electricity', 'sanitation',
  'private_entrance', 'optical_fibers', 'laundry_room', 'balcony_terrace',
  'photo_urls',
  'date_added',
  'rent_now_pay_later', 'rent_now_pay_later_monthly',
  // CRITICAL: source must come from the DB row (rows in wasalt_* tables have source='Wasalt'),
  // not hardcoded — otherwise the card lies about "Hosted on AQAR" while linking to wasalt.sa.
  'source', 'rega_location_verified',
  // Wasalt's "Additional Information" panel (Property usage / Age / Facade / Street / Ad source /
  // Plan number / Land number / ...) — jsonb of {key,label,value}[]. Aqar rows leave it NULL.
  'additional_info',
].join(', ');

// Map raw DB rows → in-app `Listing` shape.
function finalize(rows: any[]): Listing[] {
  return rows.map((r: any): Listing => {
    const deal: Deal = r.transaction_type === 'Buy' ? 'Buy' : 'Rent';
    // A genuinely MONTHLY rental → show its monthly figure (price_annual was stored as monthly×12, so
    // dividing back gives the exact monthly rent). Annual rentals keep the yearly figure. (user request.)
    const isMonthlyRent = deal === 'Rent' && r.rent_period === 'monthly' && typeof r.price_annual === 'number';
    const amount = deal === 'Rent'
      ? (isMonthlyRent ? Math.round(r.price_annual / 12) : r.price_annual)
      : r.price_total;
    const priceStr =
      typeof amount === 'number'
        ? `SAR ${amount.toLocaleString('en-US')}${deal === 'Rent' ? (isMonthlyRent ? '/mo' : '/yr') : ''}`
        : 'Price on request';
    const photo = Array.isArray(r.photo_urls) && r.photo_urls.length > 0 ? r.photo_urls[0] : '';
    return {
      id: Number(r.id),
      type: r.property_type ?? 'Apartment',
      deal,
      city: r.city ?? '',
      district: r.neighborhood ?? '',
      road: r.street_name ?? '',
      price: priceStr,
      area: r.area_m2 ?? 0,
      beds: r.bedrooms ?? 0,
      // CRITICAL: source comes from the DB row, never hardcoded — the card's logo, "Hosted on X",
      // and click-through hostname all derive from it. Wasalt rows have source='Wasalt'.
      source: r.source ?? 'Aqar',
      rentPeriod: deal === 'Rent' ? (r.rent_period ?? 'annual') : null,
      listed: r.date_added ?? 'recently',
      photo,
      source_url: r.listing_url,
      // Rich extras for the new card design — all optional, fall back to safe defaults.
      ad_number: r.ad_number,
      bathrooms: r.bathrooms ?? 0,
      master_bedrooms: r.master_bedrooms ?? 0,
      halls: r.halls ?? 0,
      reception_rooms_majlis: r.reception_rooms_majlis ?? 0,
      property_age: r.property_age ?? null,
      direction: r.direction ?? null,
      street_name: r.street_name ?? null,
      residence_type: r.residence_type ?? null,
      project_name: r.project_name ?? null,
      driver_room: !!r.driver_room,
      rega_location_verified: !!r.rega_location_verified,
      additional_info: buildAdditionalInfo(r.additional_info),
      photos: Array.isArray(r.photo_urls) ? r.photo_urls : [],
      rent_now_pay_later: !!r.rent_now_pay_later,
      rent_now_pay_later_monthly: r.rent_now_pay_later_monthly ?? null,
      features: {
        parking: !!r.parking,
        elevator: !!r.elevator,
        kitchen: !!r.kitchen,
        maid_room: !!r.maid_room,
        master_bedrooms: (r.master_bedrooms ?? 0) > 0,
        halls: (r.halls ?? 0) > 0,
        air_conditioner: !!r.air_conditioner,
        water_supply: !!r.water_supply,
        electricity: !!r.electricity,
        sanitation: !!r.sanitation,
        private_entrance: !!r.private_entrance,
        optical_fibers: !!r.optical_fibers,
        laundry_room: !!r.laundry_room,
        balcony_terrace: !!r.balcony_terrace,
      },
    };
  });
}

// Pulls a varied sample of REAL (type, deal, city, district) combos from the active scraped data,
// and formats them as natural-language prompt strings the user can tap. Both language variants are
// built from the same row so the EN and AR pools stay in sync — Arabic district stays Arabic,
// English UI gets it transliterated ("حي العليا" → "Al Olaya"). Diversified across property types
// so the chips don't all read "apartment, apartment, apartment". Returns null on any failure → the
// caller falls back to the static EN_POOL/AR_POOL in examplePrompts.ts. (user request: pull example
// prompts from the database, include unique things.)
export type PromptIdea = { en: string; ar: string };
export async function fetchPromptIdeas(): Promise<PromptIdea[] | null> {
  if (!supabase) return null;
  // Limit ~600 — wide enough for a good cross-section of types/cities/districts without hammering
  // the DB. We then de-dupe by (type, city, district) and round-robin across types so the final
  // sample isn't dominated by the most common combo.
  const { data, error } = await supabase
    .from('aqar_residential_listings')
    .select('property_type, transaction_type, city, neighborhood')
    .eq('active', true)
    .not('neighborhood', 'is', null)
    .order('id', { ascending: false })
    .limit(600);
  if (error || !data) return null;

  // De-dupe and bucket by property_type so we can round-robin for diversity.
  const seen = new Set<string>();
  const byType = new Map<string, Array<{ type: string; deal: string; city: string; district: string }>>();
  for (const r of data as any[]) {
    const type = String(r.property_type ?? '').trim();
    const deal = r.transaction_type === 'Buy' ? 'Buy' : 'Rent';
    const city = String(r.city ?? '').trim();
    const district = String(r.neighborhood ?? '').trim();
    if (!type || !city || !district) continue;
    const key = `${type}|${deal}|${city}|${district}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = byType.get(type) ?? [];
    bucket.push({ type, deal, city, district });
    byType.set(type, bucket);
  }
  // Shuffle inside each bucket, then round-robin take one from each until exhausted — this gives
  // type-diverse output instead of 20 apartments + 1 villa.
  const shuffled = Array.from(byType.values()).map((arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
  const out: PromptIdea[] = [];
  let added = true;
  while (added && out.length < 80) {
    added = false;
    for (const bucket of shuffled) {
      const next = bucket.shift();
      if (!next) continue;
      added = true;
      const dEN = next.deal === 'Buy' ? 'for sale' : 'for rent';
      const dAR = next.deal === 'Buy' ? 'للبيع' : 'للإيجار';
      const districtEN = translitPlace(next.district);
      const cityEN = translitPlace(next.city);
      // Avoid the "حي" prefix doubling — translitPlace already strips it in the dict path.
      const districtARStripped = next.district.replace(/^حي\s+/, '');
      out.push({
        en: `${next.type} ${dEN} in ${districtEN}, ${cityEN}`,
        ar: `${typeToArabic(next.type)} ${dAR} في ${districtARStripped}، ${next.city}`,
      });
      if (out.length >= 80) break;
    }
  }
  return out;
}

// Arabic labels for our canonical residential property types. Used to build the AR prompt half.
function typeToArabic(t: string): string {
  switch (t) {
    case 'Apartment': return 'شقة';
    case 'Villa': return 'فيلا';
    case 'Floor': return 'دور';
    case 'House': return 'بيت';
    case 'Room': return 'غرفة';
    case 'Building': return 'عمارة';
    case 'Rest House': return 'استراحة';
    case 'Chalet': return 'شاليه';
    case 'Camp': return 'مخيم';
    case 'Residential Land': return 'أرض سكنية';
    case 'Commercial Land': return 'أرض تجارية';
    default: return t;
  }
}
