// Property taxonomy. Mirrors Aqar structure. (PRD §5.2)

export type Deal = 'Rent' | 'Buy';
export const DEALS: Deal[] = ['Rent', 'Buy'];

export type Category = 'Residential' | 'Commercial';
export const CATEGORIES: Category[] = ['Residential', 'Commercial'];

export const CATEGORY_TYPES: Record<Category, string[]> = {
  Residential: [
    'Apartment', 'Villa', 'Floor', 'House', 'Room', 'Building',
    'Rest House', 'Chalet', 'Camp', 'Residential Land',
  ],
  Commercial: [
    'Office', 'Warehouse', 'Shop', 'Showroom', 'Workshop', 'Factory',
    'Commercial Land', 'Industrial Land', 'Farm', 'Agriculture Plot',
    'Hotel', 'Commercial Building', 'Gas Station', 'Health Center',
    'Kiosk', 'Cinema', 'Parking', 'Bank', 'School', 'Telecom Tower',
  ],
};

// Types measured by bedrooms (dwellings); everything else by size in m².
const BEDROOM_TYPES = new Set([
  'Apartment', 'Villa', 'Floor', 'House', 'Room', 'Rest House', 'Chalet',
  // New clean dwelling types (2-macro filter): measured by bedrooms like their siblings.
  'Duplex', 'Palace',
]);

// Size ranges per type — exactly 4 tabs each, labelled in m² (product-defined ladders). Canonical
// strings are English with the unit ("Under 100 m²", "100–300 m²", "600+ m²"); tDetailOption only
// swaps the Arabic words, digits + unit stay. Commas are display-only — every parser strips them.
const SIZE_BY_TYPE: Record<string, string[]> = {
  Office: ['Under 100 m²', '100–300 m²', '300–600 m²', '600+ m²'],
  Warehouse: ['Under 500 m²', '500–2,000 m²', '2,000–5,000 m²', '5,000+ m²'],
  Shop: ['Under 50 m²', '50–100 m²', '100–250 m²', '250+ m²'],
  Showroom: ['Under 150 m²', '150–300 m²', '300–700 m²', '700+ m²'],
  Workshop: ['Under 300 m²', '300–600 m²', '600–1,500 m²', '1,500+ m²'],
  Factory: ['Under 1,000 m²', '1,000–3,000 m²', '3,000–10,000 m²', '10,000+ m²'],
  'Commercial Land': ['Under 500 m²', '500–1,500 m²', '1,500–5,000 m²', '5,000+ m²'],
  'Industrial Land': ['Under 1,000 m²', '1,000–5,000 m²', '5,000–20,000 m²', '20,000+ m²'],
  Farm: ['Under 5,000 m²', '5,000–20,000 m²', '20,000–100,000 m²', '100,000+ m²'],
  'Agriculture Plot': ['Under 1,000 m²', '1,000–5,000 m²', '5,000–20,000 m²', '20,000+ m²'],
  Hotel: ['Under 1,000 m²', '1,000–3,000 m²', '3,000–10,000 m²', '10,000+ m²'],
  'Commercial Building': ['Under 500 m²', '500–1,500 m²', '1,500–5,000 m²', '5,000+ m²'],
  'Gas Station': ['Under 1,000 m²', '1,000–2,500 m²', '2,500–5,000 m²', '5,000+ m²'],
  'Health Center': ['Under 200 m²', '200–500 m²', '500–1,500 m²', '1,500+ m²'],
  Kiosk: ['Under 10 m²', '10–25 m²', '25–50 m²', '50+ m²'],
  Cinema: ['Under 500 m²', '500–1,500 m²', '1,500–3,000 m²', '3,000+ m²'],
  Parking: ['Under 200 m²', '200–500 m²', '500–1,500 m²', '1,500+ m²'],
  Bank: ['Under 100 m²', '100–250 m²', '250–500 m²', '500+ m²'],
  School: ['Under 1,000 m²', '1,000–3,000 m²', '3,000–8,000 m²', '8,000+ m²'],
  'Telecom Tower': ['Under 50 m²', '50–150 m²', '150–400 m²', '400+ m²'],
  // Residential (non-bedroom) types — same 4-tab + m² style for consistency.
  Building: ['Under 300 m²', '300–600 m²', '600–1,000 m²', '1,000+ m²'],
  'Residential Land': ['Under 300 m²', '300–600 m²', '600–1,000 m²', '1,000+ m²'],
  Camp: ['Under 5,000 m²', '5,000–10,000 m²', '10,000–20,000 m²', '20,000+ m²'],
};

export type Detail = { label: string; options: string[]; isBedrooms: boolean };

// Context-level detail config: which optional filters to surface at the category/group level,
// BEFORE the user picks a specific type. Land groups and Commercial → size only (no bedrooms).
// All dwelling groups and bare Residential → show both. (user: show filters without forcing a type.)
export type ContextDetail = { showBeds: boolean; showSize: boolean };
export function detailForContext(category: string | null, typeGroup: string | null): ContextDetail | null {
  if (!category) return null;
  if (category === 'Commercial') return { showBeds: false, showSize: true };
  // Residential land → area only; all other Residential groups (or none) → beds + area.
  const isLandGroup = typeGroup === 'Residential Plots';
  return { showBeds: !isLandGroup, showSize: true };
}

export function detailFor(type: string): Detail {
  // A Room / Studio is single-occupancy — always exactly 1 bedroom, never a range. (user request.)
  if (type === 'Room' || type === 'Studio') {
    return { label: 'Bedrooms', options: ['1'], isBedrooms: true };
  }
  if (BEDROOM_TYPES.has(type)) {
    return { label: 'Bedrooms', options: ['1', '2', '3', '4', '5+'], isBedrooms: true };
  }
  return {
    label: 'Size in meters',
    options: SIZE_BY_TYPE[type] ?? ['Under 500 m²', '500–1,000 m²', '1,000–2,000 m²', '2,000+ m²'],
    isBedrooms: false,
  };
}

// ── Price tabs ──────────────────────────────────────────────────────────────────────────────
// Preset price bands (SAR) shown once a type + size is chosen. Bands vary by deal AND by the size
// band the chosen size falls into. Only types with a defined ladder show tabs; the rest keep the
// free-type price box. Values are canonical English ("Under SAR 75k", "SAR 75k–150k", "SAR 3M+");
// the UI localizes them (tPriceTab). Numbers stay Western, "k"/"M" abbreviations stay.
//
// Keyed: type → exact size-band string (must match SIZE_BY_TYPE) → { Rent[], Buy[] }. Each list is
// the 4 price tabs for that size band. Data sourced from the Saudi commercial price matrix.
type PriceBands = { Rent: string[]; Buy: string[] };

const PRICE_BY_TYPE: Record<string, Record<string, PriceBands>> = {
  Office: {
    'Under 100 m²': { Rent: ['Under SAR 75k', 'SAR 75k–150k', 'SAR 150k–250k', 'SAR 250k+'], Buy: ['Under SAR 1M', 'SAR 1M–2M', 'SAR 2M–3.5M', 'SAR 3.5M+'] },
    '100–300 m²': { Rent: ['Under SAR 150k', 'SAR 150k–300k', 'SAR 300k–600k', 'SAR 600k+'], Buy: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–9M', 'SAR 9M+'] },
    '300–600 m²': { Rent: ['Under SAR 300k', 'SAR 300k–700k', 'SAR 700k–1.2M', 'SAR 1.2M+'], Buy: ['Under SAR 5M', 'SAR 5M–10M', 'SAR 10M–20M', 'SAR 20M+'] },
    '600+ m²': { Rent: ['Under SAR 600k', 'SAR 600k–1.5M', 'SAR 1.5M–3M', 'SAR 3M+'], Buy: ['Under SAR 10M', 'SAR 10M–25M', 'SAR 25M–50M', 'SAR 50M+'] },
  },
  Warehouse: {
    'Under 500 m²': { Rent: ['Under SAR 100k', 'SAR 100k–200k', 'SAR 200k–350k', 'SAR 350k+'], Buy: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'] },
    '500–2,000 m²': { Rent: ['Under SAR 250k', 'SAR 250k–500k', 'SAR 500k–1M', 'SAR 1M+'], Buy: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–15M', 'SAR 15M+'] },
    '2,000–5,000 m²': { Rent: ['Under SAR 500k', 'SAR 500k–1.2M', 'SAR 1.2M–2M', 'SAR 2M+'], Buy: ['Under SAR 5M', 'SAR 5M–15M', 'SAR 15M–30M', 'SAR 30M+'] },
    '5,000+ m²': { Rent: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'], Buy: ['Under SAR 15M', 'SAR 15M–35M', 'SAR 35M–70M', 'SAR 70M+'] },
  },
  Shop: {
    'Under 50 m²': { Rent: ['Under SAR 50k', 'SAR 50k–100k', 'SAR 100k–180k', 'SAR 180k+'], Buy: ['Under SAR 500k', 'SAR 500k–1M', 'SAR 1M–2M', 'SAR 2M+'] },
    '50–100 m²': { Rent: ['Under SAR 80k', 'SAR 80k–150k', 'SAR 150k–300k', 'SAR 300k+'], Buy: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–4M', 'SAR 4M+'] },
    '100–250 m²': { Rent: ['Under SAR 150k', 'SAR 150k–350k', 'SAR 350k–700k', 'SAR 700k+'], Buy: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–8M', 'SAR 8M+'] },
    '250+ m²': { Rent: ['Under SAR 300k', 'SAR 300k–750k', 'SAR 750k–1.5M', 'SAR 1.5M+'], Buy: ['Under SAR 4M', 'SAR 4M–10M', 'SAR 10M–20M', 'SAR 20M+'] },
  },
  Showroom: {
    'Under 150 m²': { Rent: ['Under SAR 120k', 'SAR 120k–250k', 'SAR 250k–450k', 'SAR 450k+'], Buy: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'] },
    '150–300 m²': { Rent: ['Under SAR 200k', 'SAR 200k–400k', 'SAR 400k–700k', 'SAR 700k+'], Buy: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–9M', 'SAR 9M+'] },
    '300–700 m²': { Rent: ['Under SAR 350k', 'SAR 350k–800k', 'SAR 800k–1.5M', 'SAR 1.5M+'], Buy: ['Under SAR 4M', 'SAR 4M–10M', 'SAR 10M–20M', 'SAR 20M+'] },
    '700+ m²': { Rent: ['Under SAR 700k', 'SAR 700k–1.5M', 'SAR 1.5M–3M', 'SAR 3M+'], Buy: ['Under SAR 8M', 'SAR 8M–20M', 'SAR 20M–40M', 'SAR 40M+'] },
  },
  Workshop: {
    'Under 300 m²': { Rent: ['Under SAR 120k', 'SAR 120k–250k', 'SAR 250k–450k', 'SAR 450k+'], Buy: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'] },
    '300–600 m²': { Rent: ['Under SAR 200k', 'SAR 200k–400k', 'SAR 400k–700k', 'SAR 700k+'], Buy: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–9M', 'SAR 9M+'] },
    '600–1,500 m²': { Rent: ['Under SAR 350k', 'SAR 350k–800k', 'SAR 800k–1.5M', 'SAR 1.5M+'], Buy: ['Under SAR 4M', 'SAR 4M–10M', 'SAR 10M–20M', 'SAR 20M+'] },
    '1,500+ m²': { Rent: ['Under SAR 700k', 'SAR 700k–1.5M', 'SAR 1.5M–3M', 'SAR 3M+'], Buy: ['Under SAR 8M', 'SAR 8M–20M', 'SAR 20M–40M', 'SAR 40M+'] },
  },
  Factory: {
    'Under 1,000 m²': { Rent: ['Under SAR 250k', 'SAR 250k–500k', 'SAR 500k–900k', 'SAR 900k+'], Buy: ['Under SAR 3M', 'SAR 3M–8M', 'SAR 8M–15M', 'SAR 15M+'] },
    '1,000–3,000 m²': { Rent: ['Under SAR 500k', 'SAR 500k–1.2M', 'SAR 1.2M–2M', 'SAR 2M+'], Buy: ['Under SAR 6M', 'SAR 6M–15M', 'SAR 15M–30M', 'SAR 30M+'] },
    '3,000–10,000 m²': { Rent: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'], Buy: ['Under SAR 15M', 'SAR 15M–35M', 'SAR 35M–70M', 'SAR 70M+'] },
    '10,000+ m²': { Rent: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–10M', 'SAR 10M+'], Buy: ['Under SAR 30M', 'SAR 30M–80M', 'SAR 80M–150M', 'SAR 150M+'] },
  },
  'Commercial Land': {
    'Under 500 m²': { Rent: ['Under SAR 100k', 'SAR 100k–250k', 'SAR 250k–500k', 'SAR 500k+'], Buy: ['Under SAR 1M', 'SAR 1M–3M', 'SAR 3M–6M', 'SAR 6M+'] },
    '500–1,500 m²': { Rent: ['Under SAR 200k', 'SAR 200k–500k', 'SAR 500k–1M', 'SAR 1M+'], Buy: ['Under SAR 2M', 'SAR 2M–6M', 'SAR 6M–15M', 'SAR 15M+'] },
    '1,500–5,000 m²': { Rent: ['Under SAR 400k', 'SAR 400k–1M', 'SAR 1M–2M', 'SAR 2M+'], Buy: ['Under SAR 5M', 'SAR 5M–15M', 'SAR 15M–35M', 'SAR 35M+'] },
    '5,000+ m²': { Rent: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'], Buy: ['Under SAR 15M', 'SAR 15M–40M', 'SAR 40M–80M', 'SAR 80M+'] },
  },
  'Industrial Land': {
    'Under 1,000 m²': { Rent: ['Under SAR 100k', 'SAR 100k–300k', 'SAR 300k–600k', 'SAR 600k+'], Buy: ['Under SAR 1M', 'SAR 1M–3M', 'SAR 3M–7M', 'SAR 7M+'] },
    '1,000–5,000 m²': { Rent: ['Under SAR 250k', 'SAR 250k–700k', 'SAR 700k–1.5M', 'SAR 1.5M+'], Buy: ['Under SAR 3M', 'SAR 3M–10M', 'SAR 10M–25M', 'SAR 25M+'] },
    '5,000–20,000 m²': { Rent: ['Under SAR 700k', 'SAR 700k–2M', 'SAR 2M–4M', 'SAR 4M+'], Buy: ['Under SAR 10M', 'SAR 10M–30M', 'SAR 30M–70M', 'SAR 70M+'] },
    '20,000+ m²': { Rent: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–10M', 'SAR 10M+'], Buy: ['Under SAR 30M', 'SAR 30M–80M', 'SAR 80M–150M', 'SAR 150M+'] },
  },
  Farm: {
    'Under 5,000 m²': { Rent: ['Under SAR 50k', 'SAR 50k–150k', 'SAR 150k–300k', 'SAR 300k+'], Buy: ['Under SAR 500k', 'SAR 500k–1.5M', 'SAR 1.5M–3M', 'SAR 3M+'] },
    '5,000–20,000 m²': { Rent: ['Under SAR 100k', 'SAR 100k–300k', 'SAR 300k–700k', 'SAR 700k+'], Buy: ['Under SAR 1M', 'SAR 1M–3M', 'SAR 3M–8M', 'SAR 8M+'] },
    '20,000–100,000 m²': { Rent: ['Under SAR 300k', 'SAR 300k–800k', 'SAR 800k–2M', 'SAR 2M+'], Buy: ['Under SAR 3M', 'SAR 3M–10M', 'SAR 10M–25M', 'SAR 25M+'] },
    '100,000+ m²': { Rent: ['Under SAR 800k', 'SAR 800k–2M', 'SAR 2M–5M', 'SAR 5M+'], Buy: ['Under SAR 10M', 'SAR 10M–30M', 'SAR 30M–70M', 'SAR 70M+'] },
  },
  'Agriculture Plot': {
    'Under 1,000 m²': { Rent: ['Under SAR 30k', 'SAR 30k–80k', 'SAR 80k–150k', 'SAR 150k+'], Buy: ['Under SAR 300k', 'SAR 300k–800k', 'SAR 800k–1.5M', 'SAR 1.5M+'] },
    '1,000–5,000 m²': { Rent: ['Under SAR 50k', 'SAR 50k–150k', 'SAR 150k–300k', 'SAR 300k+'], Buy: ['Under SAR 500k', 'SAR 500k–1.5M', 'SAR 1.5M–3M', 'SAR 3M+'] },
    '5,000–20,000 m²': { Rent: ['Under SAR 150k', 'SAR 150k–400k', 'SAR 400k–1M', 'SAR 1M+'], Buy: ['Under SAR 1.5M', 'SAR 1.5M–4M', 'SAR 4M–10M', 'SAR 10M+'] },
    '20,000+ m²': { Rent: ['Under SAR 500k', 'SAR 500k–1.5M', 'SAR 1.5M–3M', 'SAR 3M+'], Buy: ['Under SAR 5M', 'SAR 5M–15M', 'SAR 15M–35M', 'SAR 35M+'] },
  },
  Hotel: {
    'Under 1,000 m²': { Rent: ['Under SAR 500k', 'SAR 500k–1M', 'SAR 1M–2M', 'SAR 2M+'], Buy: ['Under SAR 10M', 'SAR 10M–20M', 'SAR 20M–40M', 'SAR 40M+'] },
    '1,000–3,000 m²': { Rent: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'], Buy: ['Under SAR 20M', 'SAR 20M–50M', 'SAR 50M–100M', 'SAR 100M+'] },
    '3,000–10,000 m²': { Rent: ['Under SAR 2M', 'SAR 2M–5M', 'SAR 5M–10M', 'SAR 10M+'], Buy: ['Under SAR 50M', 'SAR 50M–120M', 'SAR 120M–250M', 'SAR 250M+'] },
    '10,000+ m²': { Rent: ['Under SAR 5M', 'SAR 5M–12M', 'SAR 12M–25M', 'SAR 25M+'], Buy: ['Under SAR 100M', 'SAR 100M–250M', 'SAR 250M–500M', 'SAR 500M+'] },
  },
  'Commercial Building': {
    'Under 500 m²': { Rent: ['Under SAR 250k', 'SAR 250k–500k', 'SAR 500k–900k', 'SAR 900k+'], Buy: ['Under SAR 3M', 'SAR 3M–7M', 'SAR 7M–12M', 'SAR 12M+'] },
    '500–1,500 m²': { Rent: ['Under SAR 400k', 'SAR 400k–1M', 'SAR 1M–2M', 'SAR 2M+'], Buy: ['Under SAR 5M', 'SAR 5M–15M', 'SAR 15M–30M', 'SAR 30M+'] },
    '1,500–5,000 m²': { Rent: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'], Buy: ['Under SAR 15M', 'SAR 15M–35M', 'SAR 35M–70M', 'SAR 70M+'] },
    '5,000+ m²': { Rent: ['Under SAR 2.5M', 'SAR 2.5M–6M', 'SAR 6M–12M', 'SAR 12M+'], Buy: ['Under SAR 40M', 'SAR 40M–90M', 'SAR 90M–180M', 'SAR 180M+'] },
  },
  'Gas Station': {
    'Under 1,000 m²': { Rent: ['Under SAR 300k', 'SAR 300k–600k', 'SAR 600k–1M', 'SAR 1M+'], Buy: ['Under SAR 5M', 'SAR 5M–10M', 'SAR 10M–18M', 'SAR 18M+'] },
    '1,000–2,500 m²': { Rent: ['Under SAR 500k', 'SAR 500k–1M', 'SAR 1M–2M', 'SAR 2M+'], Buy: ['Under SAR 8M', 'SAR 8M–20M', 'SAR 20M–35M', 'SAR 35M+'] },
    '2,500–5,000 m²': { Rent: ['Under SAR 1M', 'SAR 1M–2.5M', 'SAR 2.5M–5M', 'SAR 5M+'], Buy: ['Under SAR 15M', 'SAR 15M–35M', 'SAR 35M–70M', 'SAR 70M+'] },
    '5,000+ m²': { Rent: ['Under SAR 2.5M', 'SAR 2.5M–6M', 'SAR 6M–12M', 'SAR 12M+'], Buy: ['Under SAR 35M', 'SAR 35M–80M', 'SAR 80M–150M', 'SAR 150M+'] },
  },
  'Health Center': {
    'Under 200 m²': { Rent: ['Under SAR 100k', 'SAR 100k–250k', 'SAR 250k–450k', 'SAR 450k+'], Buy: ['Under SAR 2M', 'SAR 2M–4M', 'SAR 4M–7M', 'SAR 7M+'] },
    '200–500 m²': { Rent: ['Under SAR 200k', 'SAR 200k–500k', 'SAR 500k–900k', 'SAR 900k+'], Buy: ['Under SAR 3M', 'SAR 3M–7M', 'SAR 7M–15M', 'SAR 15M+'] },
    '500–1,500 m²': { Rent: ['Under SAR 500k', 'SAR 500k–1.2M', 'SAR 1.2M–2.5M', 'SAR 2.5M+'], Buy: ['Under SAR 7M', 'SAR 7M–18M', 'SAR 18M–35M', 'SAR 35M+'] },
    '1,500+ m²': { Rent: ['Under SAR 1.2M', 'SAR 1.2M–3M', 'SAR 3M–6M', 'SAR 6M+'], Buy: ['Under SAR 18M', 'SAR 18M–40M', 'SAR 40M–80M', 'SAR 80M+'] },
  },
  // ── Residential, size-based (Building, Residential Land, Camp) ──
  Building: {
    'Under 300 m²': { Rent: ['Under SAR 100k', 'SAR 100k–200k', 'SAR 200k–350k', 'SAR 350k+'], Buy: ['Under SAR 1M', 'SAR 1M–2M', 'SAR 2M–3.5M', 'SAR 3.5M+'] },
    '300–600 m²': { Rent: ['Under SAR 150k', 'SAR 150k–300k', 'SAR 300k–500k', 'SAR 500k+'], Buy: ['Under SAR 1.5M', 'SAR 1.5M–3M', 'SAR 3M–5M', 'SAR 5M+'] },
    '600–1,000 m²': { Rent: ['Under SAR 250k', 'SAR 250k–500k', 'SAR 500k–800k', 'SAR 800k+'], Buy: ['Under SAR 2.5M', 'SAR 2.5M–5M', 'SAR 5M–8M', 'SAR 8M+'] },
    '1,000+ m²': { Rent: ['Under SAR 500k', 'SAR 500k–900k', 'SAR 900k–1.5M', 'SAR 1.5M+'], Buy: ['Under SAR 4M', 'SAR 4M–8M', 'SAR 8M–15M', 'SAR 15M+'] },
  },
  // Residential land: buy-only (no rent ladder → free-type box for Rent).
  'Residential Land': {
    'Under 300 m²': { Rent: [], Buy: ['Under SAR 150k', 'SAR 150k–300k', 'SAR 300k–600k', 'SAR 600k+'] },
    '300–600 m²': { Rent: [], Buy: ['Under SAR 250k', 'SAR 250k–600k', 'SAR 600k–1.2M', 'SAR 1.2M+'] },
    '600–1,000 m²': { Rent: [], Buy: ['Under SAR 500k', 'SAR 500k–1.2M', 'SAR 1.2M–2.5M', 'SAR 2.5M+'] },
    '1,000+ m²': { Rent: [], Buy: ['Under SAR 1M', 'SAR 1M–2M', 'SAR 2M–4M', 'SAR 4M+'] },
  },
  // Camp: 4 size tabs map positionally to small / medium / large / premium scale bands.
  Camp: {
    'Under 5,000 m²': { Rent: ['Under SAR 20k', 'SAR 20k–50k', 'SAR 50k–90k', 'SAR 90k+'], Buy: ['Under SAR 300k', 'SAR 300k–700k', 'SAR 700k–1.2M', 'SAR 1.2M+'] },
    '5,000–10,000 m²': { Rent: ['Under SAR 40k', 'SAR 40k–90k', 'SAR 90k–160k', 'SAR 160k+'], Buy: ['Under SAR 500k', 'SAR 500k–1M', 'SAR 1M–1.8M', 'SAR 1.8M+'] },
    '10,000–20,000 m²': { Rent: ['Under SAR 80k', 'SAR 80k–150k', 'SAR 150k–250k', 'SAR 250k+'], Buy: ['Under SAR 800k', 'SAR 800k–1.5M', 'SAR 1.5M–2.5M', 'SAR 2.5M+'] },
    '20,000+ m²': { Rent: ['Under SAR 150k', 'SAR 150k–300k', 'SAR 300k–500k', 'SAR 500k+'], Buy: ['Under SAR 1.2M', 'SAR 1.2M–2M', 'SAR 2M–3.5M', 'SAR 3.5M+'] },
  },
};

// Bedroom-keyed price ladders for residential dwellings. Inner key = bedroom option from detailFor
// ('1'..'5+'). Types omit bedroom counts that don't apply (e.g. villas start at 2). For "4+ bedroom"
// source rows the same bands fill both '4' and '5+'. Room is single-occupancy: only '1', rent-only.
const PRICE_BY_BEDROOMS: Record<string, Record<string, PriceBands>> = {
  Apartment: {
    '1': { Rent: ['Under SAR 20k', 'SAR 20k–35k', 'SAR 35k–55k', 'SAR 55k+'], Buy: ['Under SAR 250k', 'SAR 250k–450k', 'SAR 450k–700k', 'SAR 700k+'] },
    '2': { Rent: ['Under SAR 25k', 'SAR 25k–45k', 'SAR 45k–70k', 'SAR 70k+'], Buy: ['Under SAR 400k', 'SAR 400k–700k', 'SAR 700k–1M', 'SAR 1M+'] },
    '3': { Rent: ['Under SAR 40k', 'SAR 40k–70k', 'SAR 70k–100k', 'SAR 100k+'], Buy: ['Under SAR 600k', 'SAR 600k–900k', 'SAR 900k–1.3M', 'SAR 1.3M+'] },
    '4': { Rent: ['Under SAR 70k', 'SAR 70k–110k', 'SAR 110k–180k', 'SAR 180k+'], Buy: ['Under SAR 900k', 'SAR 900k–1.4M', 'SAR 1.4M–2.2M', 'SAR 2.2M+'] },
    '5+': { Rent: ['Under SAR 70k', 'SAR 70k–110k', 'SAR 110k–180k', 'SAR 180k+'], Buy: ['Under SAR 900k', 'SAR 900k–1.4M', 'SAR 1.4M–2.2M', 'SAR 2.2M+'] },
  },
  Villa: {
    '2': { Rent: ['Under SAR 60k', 'SAR 60k–90k', 'SAR 90k–140k', 'SAR 140k+'], Buy: ['Under SAR 800k', 'SAR 800k–1.4M', 'SAR 1.4M–2.2M', 'SAR 2.2M+'] },
    '3': { Rent: ['Under SAR 80k', 'SAR 80k–120k', 'SAR 120k–180k', 'SAR 180k+'], Buy: ['Under SAR 1.2M', 'SAR 1.2M–2M', 'SAR 2M–3M', 'SAR 3M+'] },
    '4': { Rent: ['Under SAR 100k', 'SAR 100k–160k', 'SAR 160k–250k', 'SAR 250k+'], Buy: ['Under SAR 1.8M', 'SAR 1.8M–2.8M', 'SAR 2.8M–4M', 'SAR 4M+'] },
    '5+': { Rent: ['Under SAR 150k', 'SAR 150k–250k', 'SAR 250k–400k', 'SAR 400k+'], Buy: ['Under SAR 2.5M', 'SAR 2.5M–4M', 'SAR 4M–6M', 'SAR 6M+'] },
  },
  Floor: {
    '2': { Rent: ['Under SAR 30k', 'SAR 30k–55k', 'SAR 55k–80k', 'SAR 80k+'], Buy: ['Under SAR 450k', 'SAR 450k–750k', 'SAR 750k–1.1M', 'SAR 1.1M+'] },
    '3': { Rent: ['Under SAR 45k', 'SAR 45k–75k', 'SAR 75k–110k', 'SAR 110k+'], Buy: ['Under SAR 650k', 'SAR 650k–1M', 'SAR 1M–1.5M', 'SAR 1.5M+'] },
    '4': { Rent: ['Under SAR 70k', 'SAR 70k–110k', 'SAR 110k–160k', 'SAR 160k+'], Buy: ['Under SAR 900k', 'SAR 900k–1.3M', 'SAR 1.3M–2M', 'SAR 2M+'] },
    '5+': { Rent: ['Under SAR 100k', 'SAR 100k–150k', 'SAR 150k–220k', 'SAR 220k+'], Buy: ['Under SAR 1.2M', 'SAR 1.2M–2M', 'SAR 2M–3M', 'SAR 3M+'] },
  },
  House: {
    '2': { Rent: ['Under SAR 35k', 'SAR 35k–60k', 'SAR 60k–90k', 'SAR 90k+'], Buy: ['Under SAR 500k', 'SAR 500k–850k', 'SAR 850k–1.3M', 'SAR 1.3M+'] },
    '3': { Rent: ['Under SAR 50k', 'SAR 50k–85k', 'SAR 85k–130k', 'SAR 130k+'], Buy: ['Under SAR 700k', 'SAR 700k–1.2M', 'SAR 1.2M–2M', 'SAR 2M+'] },
    '4': { Rent: ['Under SAR 80k', 'SAR 80k–130k', 'SAR 130k–200k', 'SAR 200k+'], Buy: ['Under SAR 1M', 'SAR 1M–1.8M', 'SAR 1.8M–3M', 'SAR 3M+'] },
    '5+': { Rent: ['Under SAR 120k', 'SAR 120k–200k', 'SAR 200k–300k', 'SAR 300k+'], Buy: ['Under SAR 1.8M', 'SAR 1.8M–3M', 'SAR 3M–5M', 'SAR 5M+'] },
  },
  Room: {
    '1': { Rent: ['Under SAR 6k', 'SAR 6k–10k', 'SAR 10k–15k', 'SAR 15k+'], Buy: [] },
  },
  'Rest House': {
    '1': { Rent: ['Under SAR 20k', 'SAR 20k–40k', 'SAR 40k–70k', 'SAR 70k+'], Buy: ['Under SAR 400k', 'SAR 400k–700k', 'SAR 700k–1.2M', 'SAR 1.2M+'] },
    '2': { Rent: ['Under SAR 30k', 'SAR 30k–60k', 'SAR 60k–100k', 'SAR 100k+'], Buy: ['Under SAR 500k', 'SAR 500k–900k', 'SAR 900k–1.5M', 'SAR 1.5M+'] },
    '3': { Rent: ['Under SAR 50k', 'SAR 50k–90k', 'SAR 90k–150k', 'SAR 150k+'], Buy: ['Under SAR 700k', 'SAR 700k–1.2M', 'SAR 1.2M–2M', 'SAR 2M+'] },
    '4': { Rent: ['Under SAR 80k', 'SAR 80k–140k', 'SAR 140k–250k', 'SAR 250k+'], Buy: ['Under SAR 1M', 'SAR 1M–1.8M', 'SAR 1.8M–3M', 'SAR 3M+'] },
    '5+': { Rent: ['Under SAR 80k', 'SAR 80k–140k', 'SAR 140k–250k', 'SAR 250k+'], Buy: ['Under SAR 1M', 'SAR 1M–1.8M', 'SAR 1.8M–3M', 'SAR 3M+'] },
  },
  Chalet: {
    '1': { Rent: ['Under SAR 25k', 'SAR 25k–50k', 'SAR 50k–90k', 'SAR 90k+'], Buy: ['Under SAR 500k', 'SAR 500k–900k', 'SAR 900k–1.5M', 'SAR 1.5M+'] },
    '2': { Rent: ['Under SAR 40k', 'SAR 40k–80k', 'SAR 80k–140k', 'SAR 140k+'], Buy: ['Under SAR 700k', 'SAR 700k–1.2M', 'SAR 1.2M–2M', 'SAR 2M+'] },
    '3': { Rent: ['Under SAR 60k', 'SAR 60k–120k', 'SAR 120k–200k', 'SAR 200k+'], Buy: ['Under SAR 1M', 'SAR 1M–1.8M', 'SAR 1.8M–3M', 'SAR 3M+'] },
    '4': { Rent: ['Under SAR 100k', 'SAR 100k–180k', 'SAR 180k–300k', 'SAR 300k+'], Buy: ['Under SAR 1.5M', 'SAR 1.5M–2.5M', 'SAR 2.5M–4M', 'SAR 4M+'] },
    '5+': { Rent: ['Under SAR 100k', 'SAR 100k–180k', 'SAR 180k–300k', 'SAR 300k+'], Buy: ['Under SAR 1.5M', 'SAR 1.5M–2.5M', 'SAR 2.5M–4M', 'SAR 4M+'] },
  },
};

// Resolve a chosen size detail (an exact size-band string OR a free-typed number) to the matching
// size-band key for the given type. Exact match wins; otherwise the typed number is placed into the
// band whose numeric range contains it. Returns null if the type has no ladder.
function resolveSizeBand(type: string, sizeDetail: string | null): string | null {
  if (!sizeDetail) return null;
  const ladder = PRICE_BY_TYPE[type];
  if (!ladder) return null;
  const bands = Object.keys(ladder);
  if (bands.includes(sizeDetail)) return sizeDetail; // exact band tab selected
  // Free-typed number → find the band whose numeric range contains it.
  const v = parseInt(sizeDetail.replace(/,/g, '').match(/\d+/)?.[0] ?? '', 10);
  if (Number.isNaN(v)) return null;
  for (const band of bands) {
    const clean = band.replace(/,/g, '');
    const nums = clean.match(/\d+/g)?.map(Number) ?? [];
    if (!nums.length) continue;
    if (/^under/i.test(clean)) { if (v < nums[0]) return band; }
    else if (/\+/.test(clean)) { if (v >= nums[0]) return band; }
    else if (nums.length >= 2) { if (v >= nums[0] && v < nums[1]) return band; }
  }
  return bands[bands.length - 1]; // above all defined ranges → top band
}

// Price tabs for the current type + deal + chosen detail (bedroom count OR size). Null → show the
// free-type price box only (no ladder for this type/deal, or no detail chosen yet).
export function priceTabsFor(type: string | null, deal: Deal, sizeDetail: string | null): string[] | null {
  if (!type || !sizeDetail) return null;
  let tabs: string[] | undefined;
  if (BEDROOM_TYPES.has(type)) {
    // Bedroom dwellings: exact bedroom-key match only (no numeric-range fallback).
    tabs = PRICE_BY_BEDROOMS[type]?.[sizeDetail]?.[deal];
  } else {
    const band = resolveSizeBand(type, sizeDetail);
    tabs = band ? PRICE_BY_TYPE[type]?.[band]?.[deal] : undefined;
  }
  return tabs && tabs.length ? tabs : null; // empty ladder (e.g. land Rent, room Buy) → free box
}

// Parse a price band label into an inclusive SAR [min, max] range. max = Infinity for an open "…+"
// band. Handles "k"/"M" suffixes and both hyphen and en-dash separators.
export function priceBandRange(band: string): { min: number; max: number } | null {
  const parse = (tok: string): number => {
    const m = tok.match(/([\d.]+)\s*([kKmM]?)/);
    if (!m) return NaN;
    let n = parseFloat(m[1]);
    const s = m[2].toLowerCase();
    if (s === 'k') n *= 1_000;
    else if (s === 'm') n *= 1_000_000;
    return n;
  };
  if (/^under/i.test(band)) {
    const max = parse(band.replace(/^under/i, ''));
    return Number.isNaN(max) ? null : { min: 0, max };
  }
  if (/\+\s*$/.test(band)) {
    const min = parse(band);
    return Number.isNaN(min) ? null : { min, max: Infinity };
  }
  const parts = band.split(/[–-]/);
  if (parts.length === 2) {
    const min = parse(parts[0]);
    const max = parse(parts[1]);
    if (Number.isNaN(min) || Number.isNaN(max)) return null;
    return { min, max };
  }
  return null;
}
