// Property taxonomy. Mirrors Aqar/Bayut structure. (PRD §5.2)

export type Deal = 'Rent' | 'Buy';
export const DEALS: Deal[] = ['Rent', 'Buy'];

export type Category = 'Residential' | 'Commercial';
export const CATEGORIES: Category[] = ['Residential', 'Commercial'];

export const CATEGORY_TYPES: Record<Category, string[]> = {
  Residential: [
    'Apartment', 'Villa', 'Floor', 'House', 'Room', 'Building',
    'Residential Land', 'Rest House', 'Chalet',
  ],
  Commercial: [
    'Office', 'Warehouse', 'Shop', 'Showroom', 'Factory', 'Workshop',
    'Commercial Land', 'Industrial Land', 'Farm', 'Agriculture Plot', 'Camp',
  ],
};

// Types measured by bedrooms (dwellings); everything else by size in m².
const BEDROOM_TYPES = new Set([
  'Apartment', 'Villa', 'Floor', 'House', 'Room', 'Building', 'Rest House', 'Chalet',
]);

// Realistic size ranges per type (m²). Falls back to a generic ladder.
const SIZE_BY_TYPE: Record<string, string[]> = {
  Office: ['Under 100m', '100–300m', '300–500m', '500m+'],
  Shop: ['Under 100m', '100–200m', '200–400m', '400m+'],
  Showroom: ['Under 200m', '200–500m', '500–1000m', '1000m+'],
  Workshop: ['Under 200m', '200–500m', '500–1000m', '1000m+'],
  Warehouse: ['Under 500m', '500–1000m', '1000–3000m', '3000m+'],
  Factory: ['Under 1000m', '1000–3000m', '3000–10000m', '10000m+'],
  'Residential Land': ['Under 500m', '500–1000m', '1000–2000m', '2000m+'],
  'Commercial Land': ['Under 1000m', '1000–3000m', '3000–5000m', '5000m+'],
  'Industrial Land': ['Under 5000m', '5000–10000m', '10000–20000m', '20000m+'],
  'Rest House': ['Under 1000m', '1000–2000m', '2000–4000m', '4000m+'],
  Chalet: ['Under 500m', '500–1000m', '1000–2000m', '2000m+'],
  Camp: ['Under 5000m', '5000–10000m', '10000–20000m', '20000m+'],
  Farm: ['Under 10000m', '10000–30000m', '30000–60000m', '60000m+'],
  'Agriculture Plot': ['Under 20000m', '20000–50000m', '50000–100000m', '100000m+'],
};

export type Detail = { label: string; options: string[]; isBedrooms: boolean };

export function detailFor(type: string): Detail {
  if (BEDROOM_TYPES.has(type)) {
    return { label: 'Bedrooms', options: ['1', '2', '3', '4', '5+'], isBedrooms: true };
  }
  return {
    label: 'Size in meters',
    options: SIZE_BY_TYPE[type] ?? ['Under 500m', '500–1000m', '1000–2000m', '2000m+'],
    isBedrooms: false,
  };
}
