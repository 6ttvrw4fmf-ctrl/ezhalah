import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';
import type { Deal } from './taxonomy';
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
const KNOWN_CITIES = [
  'Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Taif', 'Tabuk',
  'Buraidah', 'Unaizah', 'Hail', 'Abha', 'Khamis Mushait', 'Najran', 'Jazan', 'Yanbu',
  'Al Kharj', 'Al Ahsa', 'Hofuf', 'Qatif', 'Jubail', 'Arar', 'Sakaka', 'Al Baha', 'Hafar Al Batin',
];
function cityFilterFor(location: string): string | null {
  const loc = location.trim().toLowerCase();
  if (!loc) return null;
  for (const c of KNOWN_CITIES) {
    const cl = c.toLowerCase();
    if (loc === cl || loc.includes(cl) || cl.includes(loc)) return c;
  }
  return null; // not a recognized city → don't constrain server-side; client narrows by district
}

// Map a SearchQuery's type → the DB property_type values the client pool needs. MUST mirror
// buildPools' TYPE_TO_POOL grouping (listings.ts) so the server returns exactly the rows the chosen
// client pool draws from — e.g. asking for "Apartment" must also return House/Floor/Building/etc
// because they share the apartment pool. Returns null = don't constrain (whole category).
function dbTypesFor(q: SearchQuery): string[] | null {
  const t = q.type?.toLowerCase();
  if (!t) return null;
  if (t.includes('villa')) return ['Villa'];
  if (t === 'room') return ['Room'];
  if (t.includes('apartment') || t === 'floor')
    return ['Apartment', 'House', 'Floor', 'Building', 'Rest House', 'Chalet', 'Camp'];
  if (t.includes('land')) return ['Residential Land', 'Commercial Land'];
  return [q.type as string];
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
  // City — only when location is a recognized city; districts/landmarks are narrowed client-side.
  const city = cityFilterFor(q.location || '');
  if (city) req = req.eq('city', city);
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
  'price_annual', 'price_total',
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
    const amount = deal === 'Rent' ? r.price_annual : r.price_total;
    const priceStr =
      typeof amount === 'number'
        ? `SAR ${amount.toLocaleString('en-US')}${deal === 'Rent' ? '/yr' : ''}`
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
