import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';
import { type Deal, CATEGORY_TYPES } from './taxonomy';
import type { SearchQuery } from './search';
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
  'Abqaiq', 'An Nairyah', 'Khafji', 'Sayhat', 'Safwa', 'Tarout', 'Al Uyun',
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
// Alternate spellings a user might type → the canonical DB label. (Al Ahsa's listings are stored
// under its main city Hofuf; without this an "Al Ahsa" search would scope to a city with 0 rows.)
const CITY_ALIASES: Record<string, string> = {
  'al ahsa': 'Hofuf', 'al hasa': 'Hofuf', 'alahsa': 'Hofuf', 'hasa': 'Hofuf', 'ahsa': 'Hofuf',
  'al khobar': 'Khobar', 'al qatif': 'Qatif',
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
  // No specific type kept. This table is residential-only, so a Commercial category genuinely has zero
  // inventory — constrain to commercial types (none exist here) to return an honest 0, never the whole
  // residential table under a "Commercial" header. (audit: category leak.)
  if (q.category === 'Commercial') return CATEGORY_TYPES.Commercial;
  return null; // Residential / unset → whole residential table
}

const QUERY_LIMIT = 1500; // newest N matching rows — plenty for the 25-card display + load-more

// Server-side per-search fetch — the heart of the scale fix. Instead of downloading the whole 21k+
// row table (which now times out → app got zero listings), we push the cheap exact filters
// (transaction_type, property_type group, city) to Postgres and pull only the matching rows WITH
// photos. The client's runSearch then applies the intricate price/size/district/sort/suggestion
// logic on this small subset. Ordered newest-first (cheap on the indexed, filtered set). Returns
// null on backend error (so the caller can show a retry message), [] when there genuinely are no
// matches. (user-reported: search broken / "Loading listings" because the whole-table load timed out.)
export async function fetchListingsForQuery(q: SearchQuery): Promise<Listing[] | null> {
  if (!supabase) return null;
  let req = supabase.from('aqar_residential_listings').select(LIST_SELECT).eq('active', true);
  // Deal: bothDeals (agent unsure rent/buy) → no filter, return both; else exact.
  if (!q.bothDeals) req = req.eq('transaction_type', q.deal === 'Buy' ? 'Buy' : 'Rent');
  // Type group (or whole category if type is null).
  const types = dbTypesFor(q);
  if (types && types.length) req = req.in('property_type', types);
  // City — scope to a recognized city. Prefer a city named in the raw text; otherwise fall back to the
  // resolver's canonical city, so a kept DISTRICT/landmark/Arabic-city ("Al Olaya", "العليا، الرياض",
  // "near KAFD") scopes to its city instead of leaking all 21 cities. (audit: location leak.) The
  // client then narrows to the exact district WITHIN that city via q.districts.
  const city = cityFilterFor(q.location || '')
    || (q.locationMatch?.city ? cityFilterFor(q.locationMatch.city) : null);
  if (city) req = req.eq('city', city);
  // Rent period — the filter's monthly/annual toggle is a HARD segment, pushed to the DB. "per month"
  // → only true monthly rentals; "per year" (or untagged) → annual listings. The agent path leaves
  // q.rentPeriod undefined → no period filter (it shows whatever matches). (user: per month = charged
  // monthly only, not yearly converted.)
  if (q.deal === 'Rent' && q.rentPeriod === 'monthly') req = req.eq('rent_period', 'monthly');
  else if (q.deal === 'Rent' && q.rentPeriod === 'annual') req = req.or('rent_period.eq.annual,rent_period.is.null');
  // Bedrooms is filtered CLIENT-side (runSearch), NOT here — same as price/size. Pushing it to the DB
  // would empty the pool on a 0-match search, so the "want me to drop the bedroom count?" relaxation
  // could no longer see that other counts exist. Keeping it client-side preserves that suggestion.
  // Newest-first is cheap here because the filters above shrink the set and it's indexed.
  req = req.order('id', { ascending: false }).limit(QUERY_LIMIT);
  const { data, error } = await req;
  if (error || !data) return null;
  const rows = finalize(data);
  cacheListings(rows);
  return rows;
}

// Resolve a single listing by id (in-app browser deep-links / a listing not in the current subset).
export async function fetchListingById(id: number): Promise<Listing | null> {
  const hit = LISTING_CACHE.get(id);
  if (hit) return hit;
  if (!supabase) return null;
  const { data, error } = await supabase.from('aqar_residential_listings').select(LIST_SELECT).eq('id', id).limit(1);
  if (error || !data || !data.length) return null;
  const [row] = finalize(data);
  if (row) LISTING_CACHE.set(row.id, row);
  return row ?? null;
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
  'master_bedrooms', 'halls',
  'parking', 'elevator', 'kitchen', 'maid_room',
  'air_conditioner', 'water_supply', 'electricity', 'sanitation',
  'private_entrance', 'optical_fibers', 'laundry_room', 'balcony_terrace',
  'photo_urls',
  'date_added',
  'rent_now_pay_later', 'rent_now_pay_later_monthly',
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
      road: '',
      price: priceStr,
      area: r.area_m2 ?? 0,
      beds: r.bedrooms ?? 0,
      source: 'Aqar',
      rentPeriod: deal === 'Rent' ? (r.rent_period ?? 'annual') : null,
      listed: r.date_added ?? 'recently',
      photo,
      source_url: r.listing_url,
      // Rich extras for the new card design — all optional, fall back to safe defaults.
      ad_number: r.ad_number,
      bathrooms: r.bathrooms ?? 0,
      master_bedrooms: r.master_bedrooms ?? 0,
      halls: r.halls ?? 0,
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
