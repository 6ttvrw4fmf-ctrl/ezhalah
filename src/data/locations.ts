// City-first autocomplete. Typing a letter surfaces that city's areas only; only falls through
// to district, then road, when no higher tier matches. (PRD §5.1, prototype matchLocations)

export type Place = { city: string; district: string; road: string };

export const LOCATIONS: Place[] = [
  { city: 'Riyadh', district: 'Al Malqa District', road: 'Prince Mohammed bin Saeed Road' },
  { city: 'Riyadh', district: 'Hittin District', road: 'Prince Turki Al Awwal Road' },
  { city: 'Riyadh', district: 'Al Narjis District', road: 'King Salman Road' },
  { city: 'Riyadh', district: 'Al Olaya District', road: 'King Fahd Road' },
  { city: 'Jeddah', district: 'Al Hamra District', road: 'Prince Sultan Road' },
  { city: 'Jeddah', district: 'Al Rawdah District', road: 'Malik Road' },
  { city: 'Jeddah', district: 'Al Shati District', road: 'Corniche Road' },
  { city: 'Khobar', district: 'Al Aqrabiyah District', road: 'King Abdullah Road' },
  { city: 'Khobar', district: 'Al Olaya District', road: 'Prince Faisal Bin Fahd Road' },
  { city: 'Khobar', district: 'Corniche District', road: 'Corniche Road' },
  { city: 'Dammam', district: 'Al Faisaliyah District', road: 'King Fahd Road' },
  { city: 'Mecca', district: 'Al Aziziyah District', road: 'Ibrahim Al Khalil Road' },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function matchLocations(query: string): Place[] {
  const q = norm(query.trim());
  if (!q) return [];
  const city: Place[] = [];
  const dist: Place[] = [];
  const road: Place[] = [];
  for (const loc of LOCATIONS) {
    if (norm(loc.city).startsWith(q)) city.push(loc);
    else if (norm(loc.district).startsWith(q)) dist.push(loc);
    else if (norm(loc.road).startsWith(q)) road.push(loc);
  }
  const tier = city.length ? city : dist.length ? dist : road;
  return tier.slice(0, 6);
}

export const placeField = (p: Place) => `${p.city}, ${p.district}`;
