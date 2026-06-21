import type { Deal } from './taxonomy';

// A normalized listing. (PRD §8.2) In production the ingestion pipeline maps every partner feed
// onto this shape; here we ship curated placeholders ported from the prototype.
export type Listing = {
  id: number;
  type: string;
  deal: Deal;
  city: string;
  district: string;
  road: string;
  price: string; // pre-formatted display string
  area: number; // m²
  beds: number; // 0 = not a dwelling
  source: string; // platform name
  // Rent billing period: 'monthly' | 'annual' (null for Buy / mock data). When 'monthly', `price` is
  // the per-month figure; otherwise yearly. Drives the per-month filter + the /mo vs /yr label. (user.)
  rentPeriod?: string | null;
  listed: string; // human recency
  photo: string;
  // Real URL on the source platform — when present, the in-app browser redirects the
  // user OUT to this page. Absent for the bundled mock catalog (synthetic preview only).
  source_url?: string;
  // Rich extras for the new residential card design — all optional. Mock listings don't carry them;
  // real Aqar listings populate them from the rich `aqar_residential_listings` table. (user request.)
  ad_number?: string;
  bathrooms?: number;
  master_bedrooms?: number;
  halls?: number;
  reception_rooms_majlis?: number;
  property_age?: string | null;
  direction?: string | null;
  street_name?: string | null;
  residence_type?: string | null;
  project_name?: string | null;
  driver_room?: boolean;
  rega_location_verified?: boolean;
  // Wasalt-only "Additional Information" panel — label/value pairs rendered on the card.
  // Aqar rows leave this null and skip the panel. (user: rich Wasalt facts on the card.)
  additional_info?: { key: string; label: string; value: string }[] | null;
  photos?: string[];
  rent_now_pay_later?: boolean;
  rent_now_pay_later_monthly?: number | null;
  features?: {
    parking?: boolean;
    elevator?: boolean;
    kitchen?: boolean;
    maid_room?: boolean;
    master_bedrooms?: boolean;
    halls?: boolean;
    air_conditioner?: boolean;
    water_supply?: boolean;
    electricity?: boolean;
    sanitation?: boolean;
    private_entrance?: boolean;
    optical_fibers?: boolean;
    laundry_room?: boolean;
    balcony_terrace?: boolean;
  };
};

export const LISTED_SEQ = ['today', '2 days ago', '2 months ago', '8 months ago', '1 year ago'];
const PQ = '?w=600&h=420&q=70&auto=format&fit=crop';

type Row = [type: string, deal: Deal, city: string, district: string, price: string, area: number, beds: number, source: string];

function pool(rows: Row[], roads: string[], photos: string[], idBase: number): Listing[] {
  return rows.map((r, i) => ({
    id: idBase + i,
    type: r[0], deal: r[1], city: r[2], district: r[3], price: r[4], area: r[5], beds: r[6], source: r[7],
    road: roads[i] ?? '',
    listed: LISTED_SEQ[i] ?? 'recently',
    photo: (photos[i] ?? '') + PQ,
  }));
}

export const POOLS = {
  villa: pool(
    [
      ['Villa', 'Rent', 'Riyadh', 'North Riyadh', 'SAR 95,000/year', 250, 5, 'Aqar'],
      ['Villa', 'Rent', 'Riyadh', 'Al Malqa', 'SAR 120,000/year', 320, 6, 'Bayut'],
      ['Villa', 'Buy', 'Riyadh', 'Hittin', 'SAR 2.9M', 400, 6, 'Bayut'],
      ['Villa', 'Rent', 'Riyadh', 'Al Narjis', 'SAR 85,000/year', 280, 5, 'Aqar'],
      ['Villa', 'Buy', 'Riyadh', 'Al Yasmin', 'SAR 3.4M', 450, 7, 'Property Finder'],
    ],
    ['Prince Mohammed bin Saeed Road', 'King Fahd Road', 'Prince Turki Al Awwal Road', 'King Salman Road', 'Anas Ibn Malik Road'],
    ['https://images.unsplash.com/photo-1568605114967-8130f3a36994', 'https://images.unsplash.com/photo-1570129477492-45c003edd2be', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811'],
    1000,
  ),
  apartment: pool(
    [
      ['Apartment', 'Rent', 'Riyadh', 'Al Narjis', 'SAR 42,000/year', 140, 3, 'Bayut'],
      ['Apartment', 'Rent', 'Riyadh', 'Al Narjis', 'SAR 36,000/year', 120, 2, 'Aqar'],
      ['Apartment', 'Buy', 'Riyadh', 'Al Narjis', 'SAR 850,000', 160, 3, 'Bayut'],
      ['Apartment', 'Rent', 'Riyadh', 'Al Narjis', 'SAR 48,000/year', 150, 3, 'Aqar'],
      ['Apartment', 'Buy', 'Riyadh', 'Al Narjis', 'SAR 1,100,000', 175, 4, 'Aldarim'],
    ],
    ['King Salman Road', 'Othman Ibn Affan Road', 'Al Imam Saud Road', 'King Abdulaziz Road', 'Abu Bakr Al Siddiq Road'],
    ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688', 'https://images.unsplash.com/photo-1493809842364-78817add7ffb', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2', 'https://images.unsplash.com/photo-1556912173-3bb406ef7e77'],
    2000,
  ),
  land: pool(
    [
      ['Commercial Land', 'Buy', 'Jeddah', 'Al Hamra', 'SAR 920,000', 600, 0, 'Aqar'],
      ['Commercial Land', 'Buy', 'Jeddah', 'Al Rawdah', 'SAR 780,000', 500, 0, 'Bayut'],
      ['Commercial Land', 'Buy', 'Jeddah', 'Al Shati', 'SAR 990,000', 720, 0, 'Bayut'],
      ['Commercial Land', 'Buy', 'Jeddah', 'Al Salamah', 'SAR 640,000', 420, 0, 'Property Finder'],
      ['Commercial Land', 'Buy', 'Jeddah', 'Al Naeem', 'SAR 870,000', 560, 0, 'Wasalt'],
    ],
    ['Prince Sultan Road', 'Malik Road', 'Corniche Road', 'Al Madinah Road', 'King Abdullah Road'],
    ['https://images.unsplash.com/photo-1500382017468-9049fed747ef', 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b', 'https://images.unsplash.com/photo-1444858345149-2eded8bd6f8a', 'https://images.unsplash.com/photo-1500076656116-558758c991c1', 'https://images.unsplash.com/photo-1485470733090-0aae1788d5af'],
    3000,
  ),
  budget: pool(
    [
      ['Apartment', 'Buy', 'Riyadh', 'Al Suwaidi', 'SAR 480,000', 110, 3, 'Aqar'],
      ['Apartment', 'Buy', 'Riyadh', 'Al Olaya', 'SAR 520,000', 70, 1, 'Bayut'],
      ['Apartment', 'Buy', 'Riyadh', 'Al Aziziyah', 'SAR 450,000', 120, 3, 'Aqar'],
      ['House', 'Buy', 'Riyadh', 'Al Shifa', 'SAR 510,000', 130, 3, 'Aqar'],
      ['Apartment', 'Buy', 'Riyadh', 'Al Dar Al Baida', 'SAR 495,000', 115, 3, 'Aldarim'],
    ],
    ['Dirab Road', 'Olaya Road', 'As Sahafah Road', 'Al Hair Road', 'Khurais Road'],
    ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688', 'https://images.unsplash.com/photo-1493809842364-78817add7ffb', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2', 'https://images.unsplash.com/photo-1556912173-3bb406ef7e77'],
    4000,
  ),
  mixRent: pool(
    [
      ['Villa', 'Rent', 'Riyadh', 'Al Malqa', 'SAR 120,000/year', 320, 6, 'Bayut'],
      ['Apartment', 'Rent', 'Jeddah', 'Al Shati', 'SAR 55,000/year', 150, 3, 'Aqar'],
      ['Chalet', 'Rent', 'Riyadh', 'Al Narjis', 'SAR 70,000/year', 200, 4, 'Property Finder'],
      ['Apartment', 'Rent', 'Khobar', 'Al Olaya', 'SAR 48,000/year', 130, 2, 'Property Finder'],
      ['Villa', 'Rent', 'Riyadh', 'Hittin', 'SAR 140,000/year', 380, 6, 'Wasalt'],
    ],
    ['King Fahd Road', 'Corniche Road', 'King Salman Road', 'Prince Faisal Bin Fahd Road', 'Prince Turki Al Awwal Road'],
    ['https://images.unsplash.com/photo-1570129477492-45c003edd2be', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511', 'https://images.unsplash.com/photo-1493809842364-78817add7ffb', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994'],
    5000,
  ),
  mixBuy: pool(
    [
      ['Villa', 'Buy', 'Riyadh', 'Hittin', 'SAR 2.9M', 400, 6, 'Bayut'],
      ['Apartment', 'Buy', 'Jeddah', 'Al Hamra', 'SAR 1,250,000', 175, 4, 'Bayut'],
      ['Commercial Land', 'Buy', 'Riyadh', 'Al Yasmin', 'SAR 1,400,000', 500, 0, 'Aqar'],
      ['House', 'Buy', 'Khobar', 'Al Aqrabiyah', 'SAR 980,000', 210, 4, 'Property Finder'],
      ['Villa', 'Buy', 'Riyadh', 'Al Yasmin', 'SAR 3.4M', 450, 7, 'Wasalt'],
    ],
    ['Prince Turki Al Awwal Road', 'Al Madinah Road', 'Anas Ibn Malik Road', 'King Abdullah Road', 'King Fahd Road'],
    ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688', 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811'],
    6000,
  ),
  // A single room is, by definition, 1 bedroom — and priced at the real market rate for rooms
  // (a furnished room runs far cheaper than a whole apartment, roughly SAR 12k–30k/year), NOT the
  // apartment prices it used to inherit. Small areas, beds always 1. (user request.)
  room: pool(
    [
      ['Room', 'Rent', 'Riyadh', 'Al Narjis', 'SAR 18,000/year', 24, 1, 'Aqar'],
      ['Room', 'Rent', 'Riyadh', 'Al Malqa', 'SAR 24,000/year', 28, 1, 'Bayut'],
      ['Room', 'Rent', 'Jeddah', 'Al Salamah', 'SAR 14,000/year', 20, 1, 'Property Finder'],
      ['Room', 'Rent', 'Khobar', 'Al Olaya', 'SAR 16,000/year', 22, 1, 'Wasalt'],
      ['Room', 'Rent', 'Riyadh', 'Al Sahafah', 'SAR 12,000/year', 16, 1, 'Aldarim'],
    ],
    ['King Salman Road', 'Prince Turki Al Awwal Road', 'Al Madinah Road', 'Prince Faisal Bin Fahd Road', 'As Sahafah Road'],
    ['https://images.unsplash.com/photo-1505693416388-ac5ce068fe85', 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af', 'https://images.unsplash.com/photo-1560185007-cde436f6a4d0', 'https://images.unsplash.com/photo-1598928506311-c55ded91a20c', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511'],
    7000,
  ),
};

export const ALL_LISTINGS: Listing[] = Object.values(POOLS).flat();

export type PoolKey = keyof typeof POOLS;
export type Pools = Record<PoolKey, Listing[]>;

// The listing id encodes its pool (1xxx villa, 2xxx apartment, …) so a flat set fetched from the
// backend regroups into the same curated pools the search logic expects.
const POOL_BY_BASE: Record<number, PoolKey> = {
  1: 'villa', 2: 'apartment', 3: 'land', 4: 'budget', 5: 'mixRent', 6: 'mixBuy', 7: 'room',
};

// Bucket the freshly-fetched rows into the pools the search engine speaks. We now bucket
// by the listing's own `type` field (real data from the scraper) instead of the old magic
// id-encoded scheme — those id ranges only made sense for the curated mock catalogue.
// Each row goes into multiple pools (per-type AND per-deal AND budget if cheap) so it's
// discoverable however the engine searches.
export function buildPools(rows: Listing[]): Pools {
  const out: Pools = { villa: [], apartment: [], land: [], budget: [], mixRent: [], mixBuy: [], room: [] };
  const TYPE_TO_POOL: Record<string, PoolKey> = {
    Villa: 'villa',
    Apartment: 'apartment',
    House: 'apartment',
    Floor: 'apartment',
    Building: 'apartment',
    'Rest House': 'apartment',
    Chalet: 'apartment',
    Camp: 'apartment',
    'Residential Land': 'land',
    'Commercial Land': 'land',
    'Industrial Land': 'land',
    'Agriculture Plot': 'land',
    Room: 'room',
  };
  // Crude "is this cheap?" heuristic — the search engine uses `budget` as its low-price bucket.
  const BUDGET_THRESHOLD_SAR = 40_000;
  const priceAmount = (p: string): number => parseInt((p.match(/\d/g) ?? []).join(''), 10) || 0;
  for (const l of rows) {
    const typePool = TYPE_TO_POOL[l.type];
    if (typePool) out[typePool].push(l);
    // Every listing also feeds the per-deal "mix" pool the engine pulls from.
    if (l.deal === 'Rent') out.mixRent.push(l);
    else out.mixBuy.push(l);
    if (priceAmount(l.price) <= BUDGET_THRESHOLD_SAR && priceAmount(l.price) > 0) out.budget.push(l);
  }
  // No fake fallback: Ezhalah is a pure aggregator now — empty pools stay empty so the user
  // sees "no exact matches" instead of stale mock listings. (user request: real listings only.)
  for (const key of Object.keys(out) as PoolKey[]) {
    out[key].sort((a, b) => b.id - a.id); // newest first
  }
  return out;
}
