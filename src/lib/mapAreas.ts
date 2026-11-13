// AREA LABELS — CITY AND DISTRICT NAMES WITH THEIR COUNTS (owner's father, relayed 2026-11-03: «show only the number of
// listings in the area at such low zoom, and place marks only when the user zooms in further»; «at this zoom level
// show the names of the districts only and the number of listings»). Pure rules, import-free, so the barrier can
// execute them: which level a zoom shows, a label's words, and where a tap on a label takes the map.

export type AreaLevel = 'country' | 'region' | 'city' | 'district';
/** One label. At region level `city` holds the region's name; at country level, the country's. */
/** `at`: where a region's label is drawn (REGION_LABEL_AT); `lat`/`lng` stay the count-weighted centre a tap zooms to.
 *  `offLabel`: the label point is outside the view (not drawn, still counted); `offCount`: the weighted centre is outside
 *  the view (drawn, not counted) — the count and the labels are decided separately (review of #11608). */
/** The place the pill names at area-label zoom, its own count, and (city or district only) the key of its prepared facts
 *  (map_place_facts_ar — the map box from city level to district level, owner 2026-11-13). */
/** Which prepared facts belong to the pill's place: one city, one district, or — when the pill names a city but counts only
 *  the districts on screen — exactly those districts (summed on the server, so the facts are the same ads as the count). */
export type PlaceFactsKey = { level: 'city' | 'district' | 'districts'; city: string; district: string; districts?: string[] };
export type AreaPlace = { name: string; n: number; facts?: PlaceFactsKey };
export type AreaRow = { city: string; district: string; lat: number; lng: number; n: number; at?: { lat: number; lng: number }; offLabel?: true; offCount?: true };

// ZOOM GOES COUNTRY → REGION → CITY → DISTRICT → PINS (owner 2026-11-05: «when the user zooms in, first thing Saudi, the
// total number, then region, then city, and then district»). The map opens on the whole Kingdom (latitude span 17-18°),
// so the first view is one «السعودية» label with the total; each zoom step (about ×2) moves one level down.
/** Wider than this (latitude span, degrees): ONE label for the whole country, with the total. */
export const COUNTRY_LABELS_ABOVE = 12;
/** Wider than this: one label per REGION (the 13 administrative regions). */
export const REGION_LABELS_ABOVE = 5;
/** Wider than this: one label per CITY. */
export const CITY_LABELS_ABOVE = 2.5;
/** Wider than this: one label per DISTRICT. At or below it the price pins show. */
export const DISTRICT_LABELS_ABOVE = 0.06;

/** The level a view shows; null = close enough for price pins. */
export function areaLevelFor(latitudeDelta: number): AreaLevel | null {
  if (latitudeDelta > COUNTRY_LABELS_ABOVE) return 'country';
  if (latitudeDelta > REGION_LABELS_ABOVE) return 'region';
  if (latitudeDelta > CITY_LABELS_ABOVE) return 'city';
  if (latitudeDelta > DISTRICT_LABELS_ABOVE) return 'district';
  return null;
}

/** THE MAP OPENS ON THE REGIONS — NO «السعودية» BUBBLE (owner 2026-11-09: «no need Saudi Arabia, we just show the
 *  regions, then from the region to cities, district»; it replaced 2026-11-05's one-country-label opening). The
 *  whole-Kingdom zoom shows the 13 region labels; the pill below still names the country and its total. */
export function areaLevelShown(latitudeDelta: number): AreaLevel | null {
  const level = areaLevelFor(latitudeDelta);
  return level === 'country' ? 'region' : level;
}

/** A count, exact (owner 2026-11-09: the bubble said «300 ألف» over a pill saying 299,996 — «how come map says 300,000
 *  and the number below isn't accurate»): 245, 3,412, 299,996 — the same digits the pill prints. */
export function areaCount(n: number, _loc: 'ar' | 'en'): string {
  return Math.round(n).toLocaleString('en-US');
}

/** A box holding the whole Kingdom: the country total is read over it, never over the view — a pan at the opening zoom
 *  leaves some regions off screen, and the pill must not call their remainder «السعودية» (review of #11592). */
export const COUNTRY_BOX = { s: 16, w: 34, n: 33, e: 56 };
/** The country label's place and name. */
export const COUNTRY_CENTER = { lat: 23.9, lng: 45.1 };
export const COUNTRY_NAME = { ar: 'السعودية', en: 'Saudi Arabia' } as const;
/** The 13 regions as the index stores them → their English names (the English UI never shows Arabic letters on a label). */
export const REGION_EN: Record<string, string> = {
  'منطقة الرياض': 'Riyadh Region', 'منطقة مكة المكرمة': 'Makkah Region', 'المنطقة الشرقية': 'Eastern Province',
  'منطقة القصيم': 'Qassim Region', 'منطقة المدينة المنورة': 'Madinah Region', 'منطقة عسير': 'Asir Region',
  'منطقة جازان': 'Jazan Region', 'منطقة حائل': 'Hail Region', 'منطقة تبوك': 'Tabuk Region', 'منطقة الباحة': 'Al Bahah Region',
  'منطقة الحدود الشمالية': 'Northern Borders Region', 'منطقة نجران': 'Najran Region', 'منطقة الجوف': 'Al Jouf Region',
};
/** WHERE EACH REGION'S LABEL SITS (owner 2026-11-09: the map opens on the regions). At a region's count-weighted centre
 *  the labels pile up — measured live 2026-11-09 on a 390×844 phone, 5 of 13 were hidden behind bigger neighbours
 *  (المنطقة الشرقية's 35,775 behind الرياض). So each label sits at a fixed point inside its region, spread apart; a
 *  tap still zooms to the count-weighted centre (`lat`/`lng`), where the listings are. */
export const REGION_LABEL_AT: Record<string, { lat: number; lng: number }> = {
  'منطقة الرياض': { lat: 23.6, lng: 45.6 }, 'المنطقة الشرقية': { lat: 21.6, lng: 50.6 }, 'منطقة القصيم': { lat: 25.9, lng: 43.3 },
  'منطقة حائل': { lat: 27.8, lng: 41.6 }, 'منطقة الحدود الشمالية': { lat: 30.0, lng: 42.6 }, 'منطقة الجوف': { lat: 29.6, lng: 37.9 },
  'منطقة تبوك': { lat: 27.4, lng: 36.9 }, 'منطقة المدينة المنورة': { lat: 24.6, lng: 38.6 }, 'منطقة مكة المكرمة': { lat: 22.4, lng: 40.2 },
  'منطقة الباحة': { lat: 20.6, lng: 41.4 }, 'منطقة عسير': { lat: 18.8, lng: 42.8 }, 'منطقة جازان': { lat: 17.0, lng: 42.4 },
  'منطقة نجران': { lat: 18.6, lng: 47.5 },
};
/**
 * The label's name in the UI language (owner 2026-11-05: «I switched to English — why does it show Arabic in here? It
 * should change automatically»): the country, the region, the city, or the district (without a leading «حي »). In
 * English a city or district goes through `latin` (src/lib/translitPlace.ts — its dictionary, then a letter mapping),
 * a region through REGION_EN; Arabic is the stored name.
 */
export function areaName(a: Pick<AreaRow, 'city' | 'district'>, level: AreaLevel, loc: 'ar' | 'en' = 'ar', latin: (s: string) => string = (s) => s): string {
  if (level === 'country') return COUNTRY_NAME[loc];
  if (level === 'region') return loc === 'en' ? (REGION_EN[a.city] ?? latin(a.city.replace(/^منطقة\s+/, ''))) : a.city;
  const name = level === 'city' || !a.district ? a.city : a.district.replace(/^حي\s+/, '');
  return loc === 'en' ? latin(name) : name;
}

/** Where a tap on a label takes the map: one level closer — country → regions, region → cities, city → districts,
 *  district → pins. MapKit WIDENS a requested span to the screen's shape: measured live 2026-11-05 on a 390×844 phone,
 *  a region tap asking 4° landed at 5.17° — still the region band — so the user tapped and nothing changed. Each target
 *  therefore sits deep enough inside the next band that up to TAP_WIDEN × the request still lands there. */
export const TAP_WIDEN = 1.6;
export function areaZoomSpan(level: AreaLevel): number {
  return level === 'country' ? 7 : level === 'region' ? 3 : level === 'city' ? 0.3 : 0.015;
}

/** A view too crowded for price pins shows district names while two or more districts share it; once one district
 *  fills the screen, names would only repeat that one district, so the fine count grid takes over. */
export const denseShowsDistricts = (labelsInView: number, latitudeDelta: number): boolean =>
  labelsInView >= 2 && latitudeDelta > DENSE_DISTRICTS_ABOVE;
/** Inside a district (a tap lands at 0.015°) names never come back — only the counted bubbles and the pins. */
export const DENSE_DISTRICTS_ABOVE = 0.02;

/** A label whose position is on screen (the padded read box also holds labels just off the edge). */
export function inView(a: Pick<AreaRow, 'lat' | 'lng'>, center: { latitude: number; longitude: number }, span: { latitudeDelta: number; longitudeDelta: number }): boolean {
  return Math.abs(a.lat - center.latitude) <= span.latitudeDelta / 2 && Math.abs(a.lng - center.longitude) <= span.longitudeDelta / 2;
}

/** A tap on a grid bubble always zooms IN: the bubble's own neighbourhood, never wider than a third of the view. */
export function bubbleTapSpan(cell: number, latitudeDelta: number): number {
  return Math.min(cell * 2.2, latitudeDelta / 3);
}

/** The labels' total — the count pill's number. */
export const areasTotal = (rows: AreaRow[]): number => rows.reduce((a, r) => a + (r.offCount ? 0 : r.n), 0);

/** ONLY THE PLACES THAT MATTER AT THIS ZOOM (owner 2026-11-03, a country-view screenshot: «the numbers 1 … look a bit
 *  weird»). «الحزم 1», «يدمة 2», «طبرجل 8» sat beside «الرياض 98 ألف» and, by taking the space, hid Makkah, Buraidah
 *  and Taif. Like Zillow, a label shows only when it holds at least LABEL_SHARE of the biggest label in view (and never
 *  fewer than LABEL_MIN listings); smaller places appear as the user zooms in and the biggest in view gets smaller.
 *  Every listing still counts in the pill (areasTotal of ALL the areas, not just the drawn ones). */
export const LABEL_SHARE = 0.005;
export const LABEL_MIN = 10;
export function visibleAreas(rows: AreaRow[], level: AreaLevel = 'district'): AreaRow[] {
  // The country label and the 13 regions always show: a region is an administrative area, not a crowd of small towns
  // (Al Jouf's ~400 listings are 0.2% of Riyadh Region's — the share rule would hide it).
  if (level === 'country' || level === 'region') return rows.filter((r) => !r.offLabel);
  const max = rows.reduce((m, r) => Math.max(m, r.n), 0);
  // A SMALL TOWN SHOWS ITS PLACES (owner 2026-11-05, Umluj: «0 listings» — its districts hold 1-2 listings each, so the
  // LABEL_MIN floor hid every one of them and the map over Umluj was empty while the pill counted 6). The floor exists
  // to hide tiny places BESIDE big ones; when nothing in view reaches LABEL_MIN there is nothing to hide them beside.
  const floor = max < LABEL_MIN ? 1 : Math.max(LABEL_MIN, max * LABEL_SHARE);
  return rows.filter((r) => r.n >= floor);
}

// ── THE LABELS FEED, FILTERED ON THE PHONE (owner 2026-11-03: «I want it to feel smooth»). Measured: each zoom waited
//    ~300-420 ms for the network although map_areas_ar() ran in 1 ms; map_areas_feed_ar() hands over every label once
//    ([is_city, city, district, lat, lng, n_buy, n_rent, n_short]) and these rules pick the ones in view.
export type AreaFeedRow = { isCity: boolean; city: string; district: string; lat: number; lng: number; buy: number; rent: number; short: number; region: string };

/** The feed's rows → labels. Anything that is not a well-formed row is dropped, never invented. */
export function parseAreasFeed(raw: unknown): AreaFeedRow[] {
  if (!Array.isArray(raw)) return [];
  const out: AreaFeedRow[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 8) continue;
    const [isCity, city, district, lat, lng, b, re, sh, region] = r as unknown[];
    if (typeof city !== 'string' || !city || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) continue;
    out.push({ isCity: isCity === true, city, district: typeof district === 'string' ? district : '', lat: Number(lat), lng: Number(lng),
      buy: Number(b) || 0, rent: Number(re) || 0, short: Number(sh) || 0, region: typeof region === 'string' ? region : '' });
  }
  return out;
}

/** The labels of one level inside a box, counted for the chosen deals, biggest first — what map_areas_ar() returned. */
export function areasFromFeed(feed: AreaFeedRow[], level: AreaLevel, deals: string[], box: { s: number; w: number; n: number; e: number }, limit = 400): AreaRow[] {
  const want = { buy: deals.includes('buy'), rent: deals.includes('rent'), short: deals.includes('short') };
  const count = (a: AreaFeedRow) => (want.buy ? a.buy : 0) + (want.rent ? a.rent : 0) + (want.short ? a.short : 0);
  if (level === 'country' || level === 'region') {
    // Summed from the CITY labels (each carries its region since 20261105…_map_labels_carry_region): every city counts
    // in the country label; a region label sits at the count-weighted centre of its cities.
    const cities = feed.filter((a) => a.isCity);
    if (level === 'country') {
      const n = cities.reduce((t, a) => t + count(a), 0);
      const inBox = COUNTRY_CENTER.lat >= box.s && COUNTRY_CENTER.lat <= box.n && COUNTRY_CENTER.lng >= box.w && COUNTRY_CENTER.lng <= box.e;
      return n > 0 && inBox ? [{ city: COUNTRY_NAME.ar, district: '', lat: COUNTRY_CENTER.lat, lng: COUNTRY_CENTER.lng, n }] : [];
    }
    const by = new Map<string, { n: number; la: number; lo: number }>();
    for (const a of cities) {
      const n = count(a); if (!a.region || n <= 0) continue;
      const g = by.get(a.region) ?? { n: 0, la: 0, lo: 0 };
      g.n += n; g.la += a.lat * n; g.lo += a.lng * n; by.set(a.region, g);
    }
    // A feed built before regions were stored has none: show the cities rather than an empty map.
    if (!by.size) return areasFromFeed(feed, 'city', deals, box, limit);
    const regions: AreaRow[] = [];
    for (const [name, g] of by) {
      const lat = g.la / g.n, lng = g.lo / g.n;
      // Drawn by where the LABEL is, counted by where the LISTINGS are (review of #11608): a view over Dammam counts the
      // Eastern Province even when its label point is off screen, and a label on screen shows even when its weighted
      // centre is not. A tap still zooms to the weighted centre.
      const at = REGION_LABEL_AT[name]; const p = at ?? { lat, lng };
      const inside = (q: { lat: number; lng: number }) => q.lat >= box.s && q.lat <= box.n && q.lng >= box.w && q.lng <= box.e;
      const drawn = inside(p), counted = inside({ lat, lng });
      if (drawn || counted) regions.push({ city: name, district: '', lat, lng, n: g.n, ...(at ? { at } : {}), ...(drawn ? {} : { offLabel: true as const }), ...(counted ? {} : { offCount: true as const }) });
    }
    return regions.sort((x, y) => y.n - x.n).slice(0, limit);
  }
  const out: AreaRow[] = [];
  for (const a of feed) {
    if (a.isCity !== (level === 'city')) continue;
    if (a.lat < box.s || a.lat > box.n || a.lng < box.w || a.lng > box.e) continue;
    const n = (want.buy ? a.buy : 0) + (want.rent ? a.rent : 0) + (want.short ? a.short : 0);
    if (n > 0) out.push({ city: a.city, district: level === 'city' ? '' : a.district, lat: a.lat, lng: a.lng, n });
  }
  return out.sort((x, y) => y.n - x.n).slice(0, limit);
}

/** A close view estimated (from the dots feed) to hold more listings than this skips the exact read: it is crowded. */
export const CROWD_ESTIMATE = 1500;

/** THE COUNT NAMES WHERE THE VIEW IS, AT EVERY ZOOM (owner 2026-11-05: «when the user zooms in this needs to change —
 *  it shows the city name, then the district, depending where the user is»; it said «… in Saudi Arabia» at every
 *  label zoom below the country). From the labels on screen: the country view is the country; otherwise the label
 *  holding at least AREA_PLACE_SHARE of the listings in view — a region, a city, a district; at district zoom, failing
 *  one district, the city most of those districts are in; else null, the plain «في هذه المنطقة». Never a name most of
 *  the view is not in. */
export const AREA_PLACE_SHARE = 0.6;
export function areaPlaceName(rows: AreaRow[], level: AreaLevel, loc: 'ar' | 'en', latin: (s: string) => string,
  center: { latitude: number; longitude: number }, span: { latitudeDelta: number; longitudeDelta: number }): string | null {
  return areaPlace(rows, level, loc, latin, center, span)?.name ?? null;
}
/** The named place AND its own count. The pill prints THIS count beside the name — measured live 2026-11-05 it said
 *  «14,531 إعلان في حي النرجس» (every district in view) where النرجس alone holds ~5,900, and «127,013 … في منطقة
 *  الرياض» where the region holds 108K. A number beside a name is that place's number. */
/** The district the user just searched (owner 2026-11-13: «it shows later … it's not true» — after a district search the
 *  pill said «13,528 إعلان للبيع في الرياض» for the whole screen): its name, where Apple put it, and how tall the view was
 *  when the map landed on it. While its label is on screen and the view is no more than 1.5× that tall, the pill and its
 *  box are about THAT district — its own count, its own facts. */
export type AreaFocus = { district: string; lat: number; lng: number; latitudeDelta: number; landed?: boolean };
// `latitudeDelta` is the height of the view the map ACTUALLY landed on (recorded at the first read after the flight —
// MapKit widens a requested span to the screen's shape, so on a tall phone the landing is ~2× the request: measured live
// 2026-11-13, the owner's «it shows later» bug came back as «13,673 في الرياض» after searching الملقا).
/** Record where the search flight LANDED (review of #12129): only at the end of a map move, only while the focus still
 *  waits for its landing, and only when the view is centred on the searched place — a read during the flight, or a move
 *  that ends somewhere else, never sets the height the «zoomed well out» rule is measured from. */
export function landFocus(focus: AreaFocus | null | undefined, center: { latitude: number; longitude: number },
  span: { latitudeDelta: number }): AreaFocus | null {
  if (!focus) return null;
  if (focus.landed) return focus;
  const near = Math.abs(center.latitude - focus.lat) <= focus.latitudeDelta && Math.abs(center.longitude - focus.lng) <= focus.latitudeDelta * 2;
  return near ? { ...focus, latitudeDelta: span.latitudeDelta, landed: true } : focus;
}
const FOCUS_NAME_NEAR_DEG = 0.05;   // a same-named district within ~5 km of Apple's point is the one searched
const FOCUS_POINT_NEAR_DEG = 0.015; // no name match (e.g. an English suggestion): only a label within ~1.5 km of the point
const plainDistrict = (d: string) => d.replace(/^حي\s+/, '').trim();
export function focusedArea(rows: AreaRow[], focus: AreaFocus | null | undefined,
  center: { latitude: number; longitude: number }, span: { latitudeDelta: number; longitudeDelta: number }): AreaRow | null {
  if (!focus || span.latitudeDelta > focus.latitudeDelta * 1.5) return null;
  const want = plainDistrict(focus.district);
  let named: AreaRow | null = null; let nd = Infinity; let near: AreaRow | null = null; let pd = Infinity;
  for (const a of rows) {
    if (!a.district || !inView(a, center, span)) continue;
    const d = Math.hypot(a.lat - focus.lat, (a.lng - focus.lng) * Math.cos((focus.lat * Math.PI) / 180));
    if (plainDistrict(a.district) === want && d < nd) { nd = d; named = a; }
    if (d < pd) { pd = d; near = a; }
  }
  if (named && nd <= FOCUS_NAME_NEAR_DEG) return named;
  return near && pd <= FOCUS_POINT_NEAR_DEG ? near : null;
}

export function areaPlace(rows: AreaRow[], level: AreaLevel, loc: 'ar' | 'en', latin: (s: string) => string,
  center: { latitude: number; longitude: number }, span: { latitudeDelta: number; longitudeDelta: number }, focus?: AreaFocus | null): AreaPlace | null {
  if (level === 'country') { const n = rows.reduce((t, a) => t + a.n, 0); return n > 0 ? { name: COUNTRY_NAME[loc], n } : null; }
  const searched = level === 'district' ? focusedArea(rows, focus, center, span) : null;
  if (searched) {
    const name = areaName(searched, 'district', loc, latin);
    return { name: loc === 'ar' ? `حي ${name}` : name, n: searched.n, facts: { level: 'district', city: searched.city, district: searched.district } };
  }
  // A region is on screen where its label is drawn OR where its listings are (review of #11608); anything else by its
  // own point.
  const onScreen = rows.filter((a) => (!a.offLabel && a.at && inView(a.at, center, span)) || inView(a, center, span));
  const seen = onScreen.length ? onScreen : rows;
  const total = seen.reduce((t, a) => t + a.n, 0);
  if (!total) return null;
  const top = seen.reduce((b, a) => (a.n > b.n ? a : b));
  if (top.n / total >= AREA_PLACE_SHARE) {
    const name = areaName(top, level, loc, latin);
    const facts = level === 'district' ? { level: 'district' as const, city: top.city, district: top.district }
      : level === 'city' ? { level: 'city' as const, city: top.city, district: '' } : undefined;
    const named: AreaPlace = { name: level === 'district' && loc === 'ar' ? `حي ${name}` : name, n: top.n };
    return facts ? { ...named, facts } : named;
  }
  if (level === 'district') {
    const byCity = new Map<string, number>();
    for (const a of seen) byCity.set(a.city, (byCity.get(a.city) ?? 0) + a.n);
    const [city, n] = [...byCity].reduce((b, x) => (x[1] > b[1] ? x : b));
    if (city && n / total >= AREA_PLACE_SHARE) {
      return { name: areaName({ city, district: '' }, 'city', loc, latin), n: rows.filter((a) => a.city === city).reduce((t, a) => t + a.n, 0),
               facts: { level: 'districts', city, district: '', districts: rows.filter((a) => a.city === city).map((a) => a.district) } };
    }
  }
  return null;
}
