// AppleMap (web) — the «خريطة» tab's map: Apple Maps (MapKit JS) over Saudi Arabia, divided into its 13
// administrative regions, each clickable (owner 2026-10-30: «Saudi Arabia divided into 13 clickable regions, just
// like Zillow displays US states» — no property pins yet).
//
// What is on the map, and nothing more:
//   • Apple's own map (cities, districts, roads appear as you zoom — Apple draws them IN THE UI LANGUAGE: owner
//     2026-10-31, «inside Apple Maps is English but outside is Arabic — they must be the same language». One MapKit
//     setting drives both the place names and the  Maps mark Apple draws inside the map image: Arabic puts that
//     mark bottom-right in Arabic, English bottom-left in English — so the layers button lifts above it in Arabic).
//   • Tap the map (compact) → it opens full screen (owner: «when the user clicks on the map take him inside»).
//   • «رسم» → Zillow's Draw Search: Cancel / draw an area / Apply, a freehand shape dragged on the map.
//   • The 13 region boundaries (public/ksa-regions.json — geoBoundaries ADM1, ODbL, simplified to ~2 km / 24 KB)
//     drawn as quiet polygon overlays in the brand colour. The region NAMES are Apple's own (it labels every
//     region in the app's language): we draw none (owner 2026-10-31: «Apple Maps already has names for those
//     regions, why are we adding both — remove our names, just the polygon drawing»). The file's `label` / `rot`
//     / `len` fields are kept for a day they are wanted again.
//   • The neighbours around the Kingdom (Yemen, Oman, the Emirates, Jordan, Egypt…) are in the first view, plain —
//     only Saudi Arabia is split into regions (owner: «like you see Dubai, Yemen beside, but Saudi is split»).
//   • Click a region → the map glides to it. Pinch / scroll zooms back out, as on any map (no «كل المملكة» button:
//     owner 2026-10-31, «remove this whole kingdom»).
//
// ALWAYS FAST: MapKit JS (Apple's ~200 KB script) and the 23 KB regions file load only when this component mounts,
// i.e. only when someone opens the Map tab — nothing is added to the entry bundle. The token comes from
// /api/mapkit-token (the private key stays on the server); MapKit asks for a fresh one itself when it expires.
//
// Failure is shown, never faked: a script that doesn't load, a token the server can't mint, or a map Apple refuses
// → «تعذّر تحميل الخريطة» in the same box, not an empty beige rectangle (A FAILED FETCH IS NOT AN EMPTY ANSWER).
// Regions that fail to load leave the plain map (still usable) and are reported in the console.
import { useEffect, useRef, useState } from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '@/theme/tokens';
import { lightColors } from '@/theme/palette';
import { fetchMapAreas, fetchAreasFeed, CROWD_ESTIMATE, visibleAreas, areaLevelFor, areaLevelShown, COUNTRY_BOX, areaCount, areaName, areaZoomSpan, areasTotal, denseShowsDistricts, bubbleTapSpan, inView, areaPlace, type AreaLevel, type AreaRow } from '@/data/mapAreas';
import { translitPlace } from '@/lib/translitPlace';
import { fetchMapDots, bubblesFromDots, dotsInView, dotsTotal, dotsEstimateInBox, projectorFrom, dotRadius, nearestDot, type MapDot } from '@/data/mapDots';
import { fetchMapPins, fetchViewPlace, cellForSpan, fineCellForSpan, bubblesCanZoomIn, PIN_LIMIT, PIN_SHOW_MAX, PIN_COLOR, PIN_PAD_PX, paddedBox, pinColor, dotColor, pinHead, polygonOf, placeApart, pinAnchorOffset, pinStemTo, pinWidthGuess, viewPlaceName, viewCountText, type PinFilter, type PinRow } from '@/data/mapPins';
import { fetchMapNoPin, noPinPinRow, noPinKey, isNoPinKey, noPinHead, noPinTag, showNoPin, NO_PIN_COLOR, type NoPinRow } from '@/data/mapNoPin';
import { classifyPlace, placeSubtitle, dedupePlaces, dropAreaShadows, sortByKind, isAreaKind, isNoiseName, type PlaceKind, type PlaceFacts } from '@/lib/placeKind';
import { useI18n } from '@/i18n';
import { onSurface } from '@/lib/mapSurface';
import { pillCount, type PillCount } from '@/lib/flowState';
import { RESOLVE_BUDGET_MS, makeSuggestCache, suggestKey } from '@/lib/placeSearch';

// The soil mascot (assets/images/soil-mascot.svg) wore this button for a day; owner 2026-11-03: «hide the mascot,
// will add it later, not the priority» — the ground-layers icon is back until the soil layer itself is built.
const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
const TOKEN_URL = '/api/mapkit-token';
const REGIONS_URL = '/ksa-regions.json';
// The Kingdom's outer border, one ring per land piece (mainland + Farasan), built from ksa-regions.json by merging the 13
// regions and growing the result ~4 km outwards, so no Saudi coast or border town is ever faded (built by
// scripts/build-ksa-outline.py; scripts/verify-saudi-only-map.ts checks it against the regions and 15 cities).
const OUTLINE_URL = '/ksa-outline.json';
// Each request gets a few tries with a growing wait before it counts as failed. Measured on production (first
// visit after the 2026-10-31 deploy): the token and the regions file both timed out at 8 s once, the next visit
// answered in ~150 ms — and MapKit never retries a token, so one slow first answer left the map blank for the
// whole session. A retry turns that into a short delay.
const FETCH_TIMEOUTS_MS = [8000, 12000, 15000];

// The Kingdom, whole, on first open, with its neighbours around it: centre near the country's middle, span wide
// enough for Tabuk to Jazan and Jeddah to Dammam with Yemen, Oman, the Gulf and Jordan showing at the edges.
const KSA_CENTER = { latitude: 23.5, longitude: 45.5 };
// A touch closer than before (owner 2026-10-31: «I want the map to feel zoomed in a bit, eliminate those extra
// spaces»): 20×24 → 18×21.5, the neighbours still at the edges.
const KSA_SPAN = { latitudeDelta: 18, longitudeDelta: 21.5 };
// A phone held upright is taller than wide: the same span would leave the Kingdom small in the middle, so there the
// first view fits the country to the screen's width instead (the neighbours still show above and below).
const KSA_SPAN_PORTRAIT = { latitudeDelta: 17, longitudeDelta: 19.5 };
// SAUDI ARABIA ONLY (owner 2026-11-11). The map's centre may move only inside this box around KSA_CENTER: ±6° north–south
// (Najran 17.5° to Tabuk 28.4°, with room) and ±7° east–west (Jeddah 39.2° to Dammam 50.1°).
const SAUDI_CENTRE_BOX = { latitudeDelta: 12, longitudeDelta: 14 };
// How far out the user may zoom: this many times the home view's camera distance.
const MAX_ZOOM_OUT = 1.3;
// The fade over the countries around: a rectangle well past every neighbour, with the Kingdom cut out ([lat, lng]).
const MASK_BOX: [number, number][] = [[0, 20], [0, 75], [45, 75], [45, 20]];
const MASK_COLOR = '#eef3f8';
const MASK_FADE = 0.82;
// The fade is full at the home view and down to nothing by MASK_GONE of its span (a region's size, ~4°).
const MASK_FULL = 0.45;
const MASK_GONE = 0.2;
/** 1 = full fade, 0 = none, for a view `ratio` times the home view's span. */
export const maskStrength = (ratio: number) => Math.max(0, Math.min(1, (ratio - MASK_GONE) / (MASK_FULL - MASK_GONE)));

type Region = {
  id: number; iso: string; en: string; ar: string;
  bbox: [number, number, number, number]; rings: [number, number][][];
  /** [lng, lat] of the inside point farthest from the border — where the name goes. */
  label: [number, number];
  /** mainland area in square degrees. */
  area: number;
  /** on-screen tilt of the name in degrees (0 = horizontal): long regions are written along their own direction. */
  rot: number;
  /** the region's extent along that direction, in longitude-degree units — what the name must fit into. */
  len: number;
};

type MKMap = {
  element: HTMLElement;
  destroy: () => void;
  mapType: string;
  isScrollEnabled: boolean;
  isZoomEnabled: boolean;
  isRotationEnabled: boolean;
  cameraBoundary: unknown;
  cameraZoomRange: unknown;
  cameraDistance: number;
  region: { center: Coord; span: { latitudeDelta: number; longitudeDelta: number } };
  addOverlay: (o: unknown) => void;
  removeOverlay: (o: unknown) => void;
  addAnnotation: (a: unknown) => void;
  removeAnnotation: (a: unknown) => void;
  convertPointOnPageToCoordinate: (p: DOMPoint) => Coord;
  setRegionAnimated: (r: unknown, animate?: boolean) => void;
  addEventListener: (name: string, fn: (e: { overlay?: { data?: Region }; annotation?: { data?: { pin?: PinRow } } }) => void) => void;
  removeEventListener: (name: string, fn: (e: unknown) => void) => void;
};
type Coord = { latitude: number; longitude: number };
type Shape = { style: { fillOpacity: number; strokeOpacity: number; lineWidth: number }; data: Region; points: unknown[] };
/** An Apple autocomplete row, plus what suggestPlaces() learned about it: its kind (city / district / mosque …),
 *  a clean subtitle and the name Apple's Place carries. `kind` is absent when the row could not be resolved in time. */
export type PlaceSuggestion = { displayLines: string[]; coordinate?: Coord; kind?: PlaceKind; subtitle?: string; name?: string; locality?: string; apple?: unknown };
/** What Search.search() accepts: Apple's OWN autocomplete result (an instance it type-checks), never a copy of it. A row
 *  suggestPlaces() built by spreading keeps the original under `apple`; without it MapKit throws «`query` passed to
 *  `Search.search()` is neither a string nor SearchAutocompleteResult» and the map never moves (seen live 2026-11-01). */
const appleQuery = (p: PlaceSuggestion): PlaceSuggestion => (p.apple ?? p) as PlaceSuggestion;
type MKRegion = { center: Coord; span: { latitudeDelta: number; longitudeDelta: number } };
type MKPlace = {
  coordinate: Coord; name?: string; pointOfInterestCategory?: string;
  locality?: string; subLocality?: string; administrativeArea?: string; thoroughfare?: string; region?: MKRegion;
};
type MKSearch = {
  region?: unknown;
  autocomplete: (q: string, cb: (err: unknown, data: { results: PlaceSuggestion[] }) => void) => number;
  search: (q: string | PlaceSuggestion, cb: (err: unknown, data: { boundingRegion?: MKRegion; places: MKPlace[] }) => void) => number;
};
type MapKit = {
  init: (o: { authorizationCallback: (done: (token: string) => void) => void; language?: string }) => void;
  language: string;
  Map: (new (el: HTMLElement, o?: object) => MKMap) & { MapTypes: { Standard: string; MutedStandard: string; Hybrid: string; Satellite: string } };
  Coordinate: new (lat: number, lng: number) => unknown;
  CoordinateSpan: new (lat: number, lng: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
  CameraZoomRange: new (minCameraDistance: number, maxCameraDistance: number) => unknown;
  Style: new (o: { strokeColor?: string; strokeOpacity?: number; fillColor?: string; fillOpacity?: number; lineWidth?: number }) => unknown;
  PolygonOverlay: new (points: unknown[] | unknown[][], o?: { style?: unknown; data?: unknown; enabled?: boolean }) => Shape;
  PolylineOverlay: new (points: unknown[], o?: { style?: unknown; enabled?: boolean }) => Shape;
  CircleOverlay: new (center: unknown, radius: number, o?: { style?: unknown; enabled?: boolean }) => unknown;
  Directions: (new (o?: { language?: string }) => { route: (req: { origin: unknown; destination: unknown; transportType?: unknown }, cb: (err: unknown, data: { routes: { polyline: { points: Coord[] }; distance: number }[] }) => void) => number }) & { Transport: { Automobile: unknown } };
  MarkerAnnotation: new (coord: unknown, o?: { title?: string; color?: string; glyphColor?: string; animates?: boolean }) => unknown;
  Annotation: (new (coord: unknown, factory: (coord: unknown, o: { data?: unknown }) => HTMLElement, o?: { data?: unknown; anchorOffset?: unknown; calloutEnabled?: boolean; size?: { width: number; height: number }; displayPriority?: number; collisionMode?: unknown }) => unknown)
    & { CollisionMode?: { Rectangle?: unknown } };
  DOMPoint?: unknown;
  Search: new (o: { region?: unknown; language?: string; limitToCountries?: string; includePointsOfInterest?: boolean }) => MKSearch;
  addEventListener: (name: string, fn: (e: { status?: string }) => void) => void;
  removeEventListener: (name: string, fn: (e: { status?: string }) => void) => void;
};
const mapkitOf = () => (window as unknown as { mapkit?: MapKit }).mapkit;

let scriptLoad: Promise<MapKit> | null = null;
/** Load Apple's script once per page; every later mount reuses the same promise. */
function loadMapKit(): Promise<MapKit> {
  const have = mapkitOf();
  if (have) return Promise.resolve(have);
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<MapKit>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MAPKIT_SRC;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => { const mk = mapkitOf(); mk ? resolve(mk) : reject(new Error('mapkit missing after load')); };
    s.onerror = () => { scriptLoad = null; reject(new Error('mapkit script failed')); };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

/** `fetch` with a bounded wait, tried again (longer wait) on a timeout or a network failure; a definite answer
 *  from the server (any status) is returned at once. */
async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  let last: unknown;
  for (const ms of FETCH_TIMEOUTS_MS) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error(`fetch failed: ${url}`);
}

// A key fetched ahead of time by prewarmMap() is used once if it is still young (keys last TOKEN_SECONDS on the server;
// a warm key is used only within WARM_TOKEN_MS of being minted, far inside that), then every later call mints afresh.
const WARM_TOKEN_MS = 5 * 60_000;
let warmToken: { at: number; p: Promise<string> } | null = null;
async function fetchToken(): Promise<string> {
  const w = warmToken; warmToken = null;
  if (w && Date.now() - w.at < WARM_TOKEN_MS) {
    try { return await w.p; } catch { /* a failed warm-up is no answer — mint a fresh one below */ }
  }
  const r = await fetchWithRetry(TOKEN_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = (await r.json()) as { token?: unknown };
  if (typeof j.token !== 'string' || !j.token) throw new Error('token missing');
  return j.token;
}

let regionsLoad: Promise<Region[]> | null = null;
/** The 13 regions, fetched once per page. A failed fetch is an error, never an empty list. */
function loadRegions(): Promise<Region[]> {
  if (regionsLoad) return regionsLoad;
  regionsLoad = fetchWithRetry(REGIONS_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error(`regions ${r.status}`);
      const j = (await r.json()) as Region[];
      if (!Array.isArray(j) || j.length !== 13) throw new Error('regions file is not the 13 regions');
      return j;
    })
    .catch((e) => { regionsLoad = null; throw e; });
  return regionsLoad;
}

let outlineLoad: Promise<[number, number][][]> | null = null;
/** Saudi Arabia's outline ([lng, lat] rings), fetched once per page. A failed fetch is an error: the map then simply
 *  shows no fading (never a wrong one). */
function loadOutline(): Promise<[number, number][][]> {
  if (outlineLoad) return outlineLoad;
  outlineLoad = fetchWithRetry(OUTLINE_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error(`outline ${r.status}`);
      const j = (await r.json()) as [number, number][][];
      if (!Array.isArray(j) || !j.length || !j.every((ring) => Array.isArray(ring) && ring.length >= 4)) throw new Error('outline file is not rings');
      return j;
    })
    .catch((e) => { outlineLoad = null; throw e; });
  return outlineLoad;
}

/** INSTANT FIRST MAP (owner 2026-11-04: «why does it feel slow moving between tabs»). Measured on ezhalah.com: the first
 *  visit to «خريطة» downloaded Apple's script (~230 KB), the region outlines, a map key and the labels/dots feeds only
 *  after the tap. Called quietly a few seconds after any page settles (src/lib/mapWarmup.ts): everything the map needs is
 *  already here when the user taps it. Every failure is swallowed — the map's own load path still runs and retries. */
export function prewarmMap(): void {
  void loadMapKit().catch(() => {});
  void loadRegions().catch(() => {});
  void loadOutline().catch(() => {});
  if (!warmToken) { const p = (async () => { const r = await fetchWithRetry(TOKEN_URL, { cache: 'no-store' }); if (!r.ok) throw new Error(`token ${r.status}`); const j = (await r.json()) as { token?: unknown }; if (typeof j.token !== 'string' || !j.token) throw new Error('token missing'); return j.token; })(); p.catch(() => {}); warmToken = { at: Date.now(), p }; }
  void fetchMapDots();
  void fetchAreasFeed();
}

// THE MAP IS KEPT BETWEEN VISITS (owner 2026-11-04: «why does it feel slow moving between tabs»). Measured on ezhalah.com:
// our code put the 26 city labels on a NEW map 0.25 s after the tab opened, but Apple's map drew them only ~3 s later,
// after its own first satellite render — on EVERY visit, because the map was destroyed on leaving and rebuilt on return.
// Now the map lives in its own box: leaving the tab takes the box out of the page (the map keeps its view, its region
// outlines and its rendered tiles), coming back puts the same box back, so the labels draw at once and the user is where
// they left off. The map-wide listeners (region outlines, zoom state) were attached once, on the first map; they reach
// the CURRENT screen through mapSinks, which every mount points at its own state.
type ParkedMap = { map: MKMap; box: HTMLDivElement };
let parked: ParkedMap | null = null;
const mapSinks: { setZoomed: (z: boolean) => void } = { setZoomed: () => {} };

let initialized = false;
function initOnce(mk: MapKit, language: string) {
  if (initialized) return;
  initialized = true;
  mk.init({
    language,
    authorizationCallback: (done) => {
      // A token the server could not mint is reported through MapKit's own 'error' event (below); handing MapKit an
      // empty string is what makes it raise that event rather than wait forever.
      fetchToken().then(done, () => done(''));
    },
  });
}

// ── The page's search field talks to the map through this (MapDealRow's MapSearchBar) ─────────────────────────
// One map per page, so one handle: the mounted map registers itself; the field asks Apple for places and flies there.
// `history`: the views left behind by a jump (a search pick, a region tap) so «رجوع» can return to them.
const live: { map: MKMap | null; search: MKSearch | null; lang: string; history: unknown[]; mark: { overlay?: unknown; pin?: unknown; shapes?: unknown[] }; markSeq: number; route: unknown[]; onRoute?: (on: boolean) => void } = { map: null, search: null, lang: '', history: [], mark: {}, markSeq: 0, route: [] };

/** Remove the drawn route (band, line, end pins). */
export function clearRoute() {
  const m = live.map;
  if (m) for (const o of live.route) { if ((o as { coordinate?: unknown }).coordinate) m.removeAnnotation(o); else m.removeOverlay(o); }
  live.route = [];
  live.onRoute?.(false);
}

const resolvePlace = (p: PlaceSuggestion): Promise<Coord | null> => new Promise((resolve) => {
  if (!live.search) return resolve(p.coordinate ?? null);
  live.search.search(appleQuery(p), (err, data) => resolve((!err && data?.places?.[0]?.coordinate) || p.coordinate || null));
});

/** «مسار» — Apple's driving route from one place to another, drawn in the brand colour with a soft band around it
 *  (the search area along the way), end pins, and the map fitted to it. Resolves false when Apple has no route. */
export async function routeBetween(from: PlaceSuggestion, to: PlaceSuggestion): Promise<boolean> {
  const mk = mapkitOf(); const m = live.map;
  if (!mk || !m) return false;
  const [a, b] = await Promise.all([resolvePlace(from), resolvePlace(to)]);
  if (!a || !b) return false;
  const directions = new mk.Directions({ language: mk.language });
  return new Promise((resolve) => {
    directions.route({ origin: new mk.Coordinate(a.latitude, a.longitude), destination: new mk.Coordinate(b.latitude, b.longitude), transportType: mk.Directions.Transport.Automobile }, (err, data) => {
      const route = !err && data?.routes?.[0];
      if (!route || !route.polyline?.points?.length) return resolve(false);
      clearRoute();
      clearPlaceMark();
      const pts = route.polyline.points.map((c) => new mk.Coordinate(c.latitude, c.longitude));
      const band = new mk.PolylineOverlay(pts, { style: new mk.Style({ strokeColor: lightColors.primary, strokeOpacity: 0.18, lineWidth: 28 }), enabled: false });
      const line = new mk.PolylineOverlay(pts, { style: new mk.Style({ strokeColor: lightColors.primary, strokeOpacity: 0.95, lineWidth: 4 }), enabled: false });
      const pinA = new mk.MarkerAnnotation(new mk.Coordinate(a.latitude, a.longitude), { title: from.displayLines[0], color: lightColors.primary });
      const pinB = new mk.MarkerAnnotation(new mk.Coordinate(b.latitude, b.longitude), { title: to.displayLines[0], color: '#c84646' });
      m.addOverlay(band); m.addOverlay(line); m.addAnnotation(pinA); m.addAnnotation(pinB);
      live.route = [band, line, pinA, pinB];
      const lats = route.polyline.points.map((c) => c.latitude), lngs = route.polyline.points.map((c) => c.longitude);
      const s0 = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lngs), e = Math.max(...lngs);
      live.history.push(m.region);
      m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate((s0 + n) / 2, (w + e) / 2), new mk.CoordinateSpan(Math.max((n - s0) * 1.3, 0.02), Math.max((e - w) * 1.3, 0.02))), true);
      live.onRoute?.(true);
      resolve(true);
    });
  });
}

/** Remove the highlight of the last searched place (the field's ✕, or a new search). */
export function clearPlaceMark() {
  const m = live.map;
  if (m && live.mark.overlay) m.removeOverlay(live.mark.overlay);
  if (m && live.mark.pin) m.removeAnnotation(live.mark.pin);
  if (m) for (const o of live.mark.shapes ?? []) m.removeOverlay(o);
  live.mark = {};
  live.markSeq++;
}

/** Apple Maps' own place suggestions (owner 2026-10-31: «this search connected to Apple Maps, like how a user
 *  searches in Apple Maps»), limited to Saudi Arabia, in the UI language. Resolves [] when MapKit is unavailable:
 *  the field then simply shows nothing (never a fake "no places"). */
// Recent answers (src/lib/placeSearch.ts): backspace or the same words again shows the list at once.
const suggestCache = makeSuggestCache<PlaceSuggestion[]>();
export async function suggestPlaces(q: string, uiLanguage: string): Promise<PlaceSuggestion[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  let mk: MapKit;
  try { mk = await loadMapKit(); } catch { return []; }
  initOnce(mk, uiLanguage);
  // THE MAP SPEAKS THE LANGUAGE THE USER TYPES (owner 2026-10-31: «if the user types English or Arabic make sure the
  // map turns that language»): Arabic letters → Arabic labels and suggestions, Latin letters → English. A query with
  // neither (digits only) keeps whatever the map has. The UI-language effect in AppleMap resets it on a UI switch.
  const language = /[\u0600-\u06FF]/.test(query) ? 'ar' : /[A-Za-z]/.test(query) ? 'en' : mk.language || uiLanguage;
  if (mk.language !== language) mk.language = language;
  if (!live.search || live.lang !== language) {
    live.search = new mk.Search({ language, limitToCountries: 'SA', includePointsOfInterest: true });
    live.lang = language;
  }
  const search = live.search!;
  // NEAR WHERE THE USER IS LOOKING (walked live 2026-11-01: «ماكدونالدز» with the map on Riyadh gave ONE row, in
  // Madinah, because a country-limited autocomplete with no region picks nationally; with the map's region it gave
  // fifteen Riyadh branches). Apple ranks around `region`, so the search follows the map: a chain or a common name
  // lists the nearby ones first, and a city or region name is still found wherever it is.
  if (live.map) search.region = live.map.region;
  const key = suggestKey(query, language, live.map?.region);
  const cached = suggestCache.get(key);
  if (cached) return cached;
  const rows = await new Promise<PlaceSuggestion[]>((resolve) => {
    // Only real PLACES: Apple also returns query completions («adidas · Search Nearby») that carry no coordinate and
    // land nowhere (owner 2026-11-01 saw one in the route fields).
    search.autocomplete(query, (err, data) => resolve(err || !data ? [] : data.results.filter((r) => r.displayLines?.length && r.coordinate)));
  });
  // SAY WHAT KIND OF PLACE EACH ROW IS (owner 2026-11-01: «identify between landmarks, cities and like this»): the
  // autocomplete row carries two lines and nothing else, so each of the top rows is resolved to Apple's Place (one
  // round trip, in parallel, ~200 ms measured) and classified in src/lib/placeKind.ts — then duplicates (the same
  // mall's hotel, cafés and restaurants) collapse, places sort city → region → district → street → landmark, and the
  // subtitle names WHERE it is instead of a plus-code address. A row Apple does not resolve within the budget keeps
  // its two lines and no tag — never dropped, never a fake kind.
  const country = language === 'ar' ? 'المملكة العربية السعودية' : 'Saudi Arabia';
  const resolve1 = (r: PlaceSuggestion) => new Promise<PlaceSuggestion>((resolve) => {
    const timer = setTimeout(() => resolve(r), RESOLVE_BUDGET_MS);   // was 1,500 ms: the list waited for the slowest row
    search.search(r, (err, data) => {
      clearTimeout(timer);
      const p = !err && data?.places?.[0];
      if (!p) return resolve(r);
      const facts: PlaceFacts = {
        name: p.name ?? r.displayLines[0], locality: p.locality, subLocality: p.subLocality, administrativeArea: p.administrativeArea,
        thoroughfare: p.thoroughfare, poi: p.pointOfInterestCategory, span: p.region?.span?.latitudeDelta,
      };
      const kind = classifyPlace(facts);
      resolve({ ...r, apple: r.apple ?? r, name: facts.name, kind, subtitle: placeSubtitle(facts, kind, country), locality: p.locality, coordinate: p.coordinate ?? r.coordinate });
    });
  });
  const resolved = await Promise.all(rows.slice(0, 8).map(resolve1));
  const named = resolved.map((r) => ({ ...r, apple: r.apple ?? r, name: r.name ?? r.displayLines[0] }));
  // A user-written description («طريق الملك فهد اللي دايم زحمه») is not a place; what was typed sorts first.
  const places = named.filter((r) => !isNoiseName(r.name));
  const out = sortByKind(dropAreaShadows(dedupePlaces(places.length ? places : named)), query).slice(0, 6);
  if (rows.length) suggestCache.set(key, out);   // an empty answer may be a failed call: never remembered
  return out;
}

/** HOW MANY PINS A FILTER LEAVES IN THE CURRENT VIEW (the popup's button): one coarse count-cell read over the
 *  visible rectangle, summed. null when the fetch failed or no map is up — the button then shows no number. */
export async function countPinsInView(filter: PinFilter): Promise<number | null> {
  const m = live.map;
  if (!m) return null;
  const { center, span } = m.region;
  const rows = await fetchMapPins(paddedBox(center, span), Math.max(0.01, span.latitudeDelta / 4), filter, 5000);
  if (rows === 'unknown') return null;
  return rows.reduce((a, r) => a + r.n, 0);
}

/** Glide the map to a suggestion: Apple's bounding region for it when it has one, else a town-sized view around it. */
export function flyToPlace(p: PlaceSuggestion) {
  const mk = mapkitOf(); const m = live.map;
  if (!mk || !m || !live.search) return;
  live.search.search(appleQuery(p), (err, data) => {
    const place = !err && data?.places?.[0];
    const c = place ? place.coordinate : p.coordinate;
    live.history.push(m.region);
    const region = data?.boundingRegion;
    // An area's outline must be SEEN: the view is a quarter wider than Apple's bounding region, so the outline sits
    // inside the screen instead of on its edges (walked live 2026-11-01: «حي النرجس» flew right but showed no frame).
    if (region) m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(region.center.latitude, region.center.longitude), new mk.CoordinateSpan(region.span.latitudeDelta * 1.3, region.span.longitudeDelta * 1.3)), true);
    else if (c) m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(c.latitude, c.longitude), new mk.CoordinateSpan(0.08, 0.08)), true);
    // MARK WHAT WAS SEARCHED (owner 2026-10-31: «create something around it so they know the landmark or district
    // they searched»). One mark at a time.
    clearPlaceMark();
    if (!c) return;
    // NO BOUNDARY DRAWING (owner 2026-11-02: «remove this boundary drawing, keep it how it is»): a landmark gets a brand
    // pin with its name and a small 120 m circle so the user sees what they searched; a district, city, region or
    // street just comes into view — Apple's own labels say where it is. The place_shapes lookup stays in src/data for
    // a future use; nothing here calls it.
    const landmark = p.kind ? !isAreaKind(p.kind) && p.kind !== 'street' : !!(place && place.pointOfInterestCategory);
    if (!landmark) return;
    live.mark.pin = new mk.MarkerAnnotation(new mk.Coordinate(c.latitude, c.longitude), { title: (place ? place.name : undefined) ?? p.name ?? p.displayLines[0], color: lightColors.primary, animates: true });
    m.addAnnotation(live.mark.pin);
    live.mark.overlay = new mk.CircleOverlay(new mk.Coordinate(c.latitude, c.longitude), 120, { style: new mk.Style({ strokeColor: lightColors.primary, strokeOpacity: 0.85, lineWidth: 1.5, fillColor: lightColors.primary, fillOpacity: 0.12 }), enabled: false });
    m.addOverlay(live.mark.overlay);
  });
}

const ksaRegion = (mk: MapKit, el: HTMLElement) => {
  const span = el.clientHeight > el.clientWidth ? KSA_SPAN_PORTRAIT : KSA_SPAN;
  return new mk.CoordinateRegion(
    new mk.Coordinate(KSA_CENTER.latitude, KSA_CENTER.longitude),
    new mk.CoordinateSpan(span.latitudeDelta, span.longitudeDelta),
  );
};

/** The view that shows one region whole, with a little air around it. */
const regionView = (mk: MapKit, r: Region) => {
  const [w, s, e, n] = r.bbox;
  return new mk.CoordinateRegion(
    new mk.Coordinate((s + n) / 2, (w + e) / 2),
    new mk.CoordinateSpan((n - s) * 1.25, (e - w) * 1.25),
  );
};

/** `onExpand` (compact box): the ⤢ button top-left opens the map full screen; the box itself pans and zooms in place
 *  (owner 2026-10-31: «zoom in within his screen without leaving»). `full` + `onClose`: the full-screen map, with its
 *  close button top-left. */
export default function AppleMap({ full = false, onExpand, onClose, onRoute, pins, onPinSelect }: { full?: boolean; onExpand?: () => void; onClose?: () => void; onRoute?: () => void; pins?: PinFilter; onPinSelect?: (row: PinRow) => void }) {
  const { t, locale } = useI18n();
  const hostRef = useRef<View>(null);
  const localeRef = useRef(locale);
  const padRef = useRef<View>(null);
  const mapRef = useRef<MKMap | null>(null);
  const sketchRef = useRef<Shape | null>(null);
  const shapeRef = useRef<Shape | null>(null);
  const ptsRef = useRef<Coord[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [sketch, setSketch] = useState<Shape | null>(null);
  const [poly, setPoly] = useState<PinFilter['poly']>(null);  // the applied drawn boundary, as the pin query's polygon
  const [hasShape, setHasShape] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [routeOn, setRouteOn] = useState(false);
  useEffect(() => { live.onRoute = setRouteOn; return () => { if (live.onRoute === setRouteOn) live.onRoute = undefined; }; }, []);
  const [failed, setFailed] = useState(false);
  // Bumped once the MapKit map object exists: the pin layer below mounts before MapKit has loaded, and an effect that
  // returned early then must run again (measured live 2026-11-02: a fresh /map load drew no pin or bubble until the
  // deal changed, because nothing re-ran the layer once the map was there).
  const [mapReady, setMapReady] = useState(0);
  // Map style (owner 2026-10-31, Zillow's layers button): the modes Apple's web MapKit offers — standard, satellite
  // with labels (hybrid), and muted. Driving / transit / traffic exist only in Apple's own apps, not on the web.
  const [layersOpen, setLayersOpen] = useState(false);
  // GROUND TYPE (owner 2026-11-02, «the soil thing on the map»): a second round button beside the layers button —
  // its own button, not a row inside layers (owner: «make another button, so he can select like he wants»). DESIGN
  // ONLY today, like «رسم» was on 2026-10-31: the card lists the five ground types the planned layer will colour
  // (sand, rock, sabkha, gravel, clay) and says «قريباً»; nothing is ticked and nothing is drawn, because the data
  // (Saudi Geological Survey + USGS Arabia bedrock, one saved type per listing) does not exist yet. Failure is shown,
  // never faked: no toggle pretends to work.
  const [groundOpen, setGroundOpen] = useState(false);
  // Satellite with labels by default (owner 2026-10-31: «keep the default satellite»).
  const [mapType, setMapType] = useState<'standard' | 'hybrid' | 'muted'>('hybrid');
  // THE MAP'S POP-UP CARDS CLOSE WHEN THE USER DOES SOMETHING ELSE (owner 2026-11-03: «if the user selects something
  // else it goes away — I clicked the satellite photo and the ground-type card stayed»). Layers and ground type are one
  // family of cards: opening one closes the other, choosing a map style closes both, and so does touching or moving the
  // map, a pin, a zoom button, the draw button or the full-screen button.
  const closePanels = () => { setLayersOpen(false); setGroundOpen(false); };
  const applyMapType = (k: 'standard' | 'hybrid' | 'muted') => {
    const mk = mapkitOf();
    const m = mapRef.current;
    if (mk && m) m.mapType = k === 'hybrid' ? mk.Map.MapTypes.Hybrid : k === 'muted' ? mk.Map.MapTypes.MutedStandard : mk.Map.MapTypes.Standard;
    setMapType(k);
    closePanels();
  };

  useEffect(() => {
    let map: MKMap | null = null;
    let gone = false;
    const onError = (e: { status?: string }) => { if (e.status === 'Unauthorized' || e.status === 'Too Many Requests') setFailed(true); };
    mapSinks.setZoomed = setZoomed;
    // A RETURN VISIT: the same map, put back — no new map, no 3 s wait for Apple's first render.
    const kept = parked; const mkKept = mapkitOf();
    const hostEl = hostRef.current as unknown as HTMLElement | null;
    if (kept && mkKept && hostEl) {
      parked = null;
      hostEl.appendChild(kept.box);
      mkKept.addEventListener('error', onError);
      mapRef.current = kept.map;
      live.map = kept.map;
      const lat = kept.map.region.span.latitudeDelta;
      const home = hostEl.clientHeight > hostEl.clientWidth ? KSA_SPAN_PORTRAIT : KSA_SPAN;
      setZoomed(lat < home.latitudeDelta * 0.85);
      const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));   // the box may be a new size
      setMapReady((n) => n + 1);
      return () => {
        cancelAnimationFrame(id);
        mkKept.removeEventListener('error', onError);
        mapRef.current = null;
        live.map = null;
        kept.box.remove();
        parked = kept;
      };
    }
    loadMapKit().then((mk) => {
      if (gone) return;
      const host = hostRef.current as unknown as HTMLElement | null;
      if (!host) return;
      // The map's own box (kept between visits, see ParkedMap): fills the host exactly like the host did.
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0';
      host.appendChild(el);
      // Apple's  Maps mark and «معلومات قانونية» are drawn INSIDE the map image, bottom-right in Arabic, and no
      // page direction or style moves them (measured live 2026-10-31: no DOM node carries them). Our corner controls
      // keep clear of that strip instead.
      initOnce(mk, localeRef.current);
      // A language switched while MapKit was still loading: init() took the first one; set the current one now.
      if (mk.language !== localeRef.current) mk.language = localeRef.current;
      mk.addEventListener('error', onError);
      map = new mk.Map(el, {
        region: ksaRegion(mk, el),
        mapType: mk.Map.MapTypes.Hybrid,
        showsMapTypeControl: false,
        // Apple's landmarks ON — mosques, malls, hospitals (owner 2026-10-31: «we want it on; the user can search
        // landmarks, mosques, malls and hospitals»). The search field already suggests them; the map now shows them.
        showsPointsOfInterest: true,
        // The bottom-right corner belongs to our layers button (owner 2026-10-31: «put that thing far right below»);
        // Apple's +/− would sit under it. Pinch, scroll and double-tap still zoom.
        showsZoomControl: false,
      });
      mapRef.current = map;
      live.map = map;
      setMapReady((n) => n + 1);

      // SAUDI ARABIA ONLY (owner 2026-11-11: «just Saudi Arabia focus … not everything shows»). Three things:
      //  • the map cannot be dragged far from the Kingdom: its CENTRE stays inside SAUDI_CENTRE_BOX;
      //  • it cannot be zoomed out past a little wider than the home view (set once the home view has settled, below);
      //  • every country around it is faded by MASK_FADE: one polygon over the region with Saudi Arabia cut out of it.
      // The fade disappears as the user zooms in (MASK_GONE): the outline is simplified (~1.5 km), so close up it could
      // fog an ad standing on the coast or the border. Close up there is no neighbour on screen to hide anyway.
      map.cameraBoundary = new mk.CoordinateRegion(new mk.Coordinate(KSA_CENTER.latitude, KSA_CENTER.longitude), new mk.CoordinateSpan(SAUDI_CENTRE_BOX.latitudeDelta, SAUDI_CENTRE_BOX.longitudeDelta));
      loadOutline().then((rings) => {
        if (gone || !map) return;
        const world = MASK_BOX.map(([lat, lng]) => new mk.Coordinate(lat, lng));
        const holes = rings.map((ring) => ring.map(([lng, lat]) => new mk.Coordinate(lat, lng)));
        const mask = new mk.PolygonOverlay([world, ...holes], {
          enabled: false,
          style: new mk.Style({ fillColor: MASK_COLOR, fillOpacity: MASK_FADE, strokeColor: lightColors.primary, strokeOpacity: 0.9, lineWidth: 1.6 }),
        });
        map.addOverlay(mask);
        let home = 0;
        let homeDistance = 0;
        const onView = () => {
          if (!map) return;
          const lat = map.region.span.latitudeDelta;
          if (!home) { home = lat; homeDistance = map.cameraDistance; map.cameraZoomRange = new mk.CameraZoomRange(0, homeDistance * MAX_ZOOM_OUT); }
          const k = maskStrength(lat / home);
          mask.style.fillOpacity = MASK_FADE * k;
          mask.style.strokeOpacity = 0.9 * k;
        };
        map.addEventListener('region-change-end', onView);
        onView();
      }).catch((e) => { console.error('[map] outline did not load', e); });

      // The 13 regions: boundaries + names, and click-to-zoom. Drawn QUIETLY so they blend into Apple's map rather
      // than sit on top of it (owner 2026-10-30: «blending in with Apple Maps, I don't want it very bright»): thin,
      // half-transparent brand-coloured lines and a barely-there fill; the chosen region only a touch stronger.
      const stroke = lightColors.primary;
      const REST = { strokeOpacity: 0.55, fillOpacity: 0.035, lineWidth: 1.1 };
      const CHOSEN = { strokeOpacity: 0.7, fillOpacity: 0.1, lineWidth: 1.8 };
      // Zoomed out past the country view the outlines FADE, down to a whisper, so Apple's map takes over (owner
      // 2026-10-31: «when the user zooms out those drawings become so light»). At the country view they are at
      // full (quiet) strength. Zoomed IN they fade again, to NOTHING: Apple draws its own region boundaries from
      // about a quarter of the country view inwards, and ours (a simplified shape from another dataset) can never sit
      // exactly on Apple's line, so the user saw two lines running side by side (owner 2026-10-31: «still there are
      // lines, so I'm confused»). One line at a time: ours at the country view, Apple's close up. The polygons stay
      // on the map, invisible, so a region is still clickable. Measured on ezhalah.com 2026-10-31: Apple's region
      // boundaries and names appear between 42% and 35% of the country view's span, so ours hands over in that band.
      const FADE_FLOOR = 0.18;
      const IN_FADE_START = 0.42; // of the home span: ours starts to fade here …
      const IN_FADE_END = 0.34; //   … and is gone here, where Apple's boundaries are already drawn
      loadRegions().then((regions) => {
        if (gone || !map) return;
        const overlays = regions.map((r) => {
          const rings = r.rings.map((ring) => ring.map(([lng, lat]) => new mk.Coordinate(lat, lng)));
          return new mk.PolygonOverlay(rings.length === 1 ? rings[0] : rings, {
            style: new mk.Style({ strokeColor: stroke, strokeOpacity: REST.strokeOpacity, lineWidth: REST.lineWidth, fillColor: stroke, fillOpacity: REST.fillOpacity }),
            data: r,
          });
        });
        overlays.forEach((o) => map!.addOverlay(o));
        // Click a region → glide to it; the chosen one is tinted a little stronger until another is chosen.
        let chosen: (typeof overlays)[number] | null = null;
        // How strong the outlines are at the current zoom: 1 at the country view and closer, fading towards
        // FADE_FLOOR as the view widens beyond it.
        let fade = 1;
        const paint = () => overlays.forEach((o) => {
          const base = o === chosen ? CHOSEN : REST;
          o.style.strokeOpacity = base.strokeOpacity * fade;
          o.style.fillOpacity = base.fillOpacity * fade;
          o.style.lineWidth = base.lineWidth;
        });
        map.addEventListener('select', (e) => {
          const r = e.overlay?.data;
          // An outline that has faded to nothing (zoomed in past IN_FADE_END) is not there for the user, so it must
          // not be clickable either: measured live 2026-11-02 on a phone, a tap between two price pins in central
          // Riyadh flew the map out to the whole region (the invisible polygon took the tap).
          if (!r || !map || fade <= 0) return;
          chosen = (e.overlay as typeof chosen) ?? null;
          paint();
          live.history.push(map.region);
          map.setRegionAnimated(regionView(mk, r), true);
        });
        // The home view MapKit actually settled on (it widens the requested span to the box's shape).
        let homeLatDelta = 0;
        const onRegion = () => {
          if (!map) return;
          const lat = map.region.span.latitudeDelta;
          if (!homeLatDelta) homeLatDelta = lat;
          mapSinks.setZoomed(lat < homeLatDelta * 0.85);
          const ratio = lat / homeLatDelta;
          // Zooming out: squared so the drop is quick: 1.2× out → ~70%, 2× out → ~25%, then the floor.
          // Zooming in: linear from IN_FADE_START down to 0 at IN_FADE_END — Apple's own lines take over.
          fade = ratio >= 1
            ? Math.max(FADE_FLOOR, Math.min(1, (1 / ratio) ** 2))
            : Math.max(0, Math.min(1, (ratio - IN_FADE_END) / (IN_FADE_START - IN_FADE_END)));
          paint();
        };
        map.addEventListener('region-change-end', onRegion);
        onRegion();
      }).catch((e) => { console.error('[map] regions did not load', e); });
    }).catch(() => { if (!gone) setFailed(true); });
    return () => {
      gone = true;
      const mk = mapkitOf();
      if (mk) mk.removeEventListener('error', onError);
      mapRef.current = null;
      live.map = null;
      // Kept for the next visit, not destroyed: its box leaves the page with this screen.
      const box = (map as unknown as { element?: HTMLElement } | null)?.element as HTMLDivElement | undefined;
      if (map && box) { box.remove(); parked = { map, box }; } else map?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE MAP FOLLOWS THE UI LANGUAGE. `mapkit.language` is live: setting it re-renders Apple's labels and mark in the
  // new language; the outlines and any drawn boundary stay (measured live on ezhalah.com/map, 2026-10-31).
  useEffect(() => {
    localeRef.current = locale;
    const mk = mapkitOf();
    if (mk && initialized && mk.language !== locale) mk.language = locale;
  }, [locale]);

  // EVERY PROPERTY PIN (owner 2026-11-02: «display all property pins … always show the price as the head of the
  // pin»). One bounded read of map_pins_ar() per settled view, for the padded visible rectangle only: exact points
  // from city zoom inward (a shared spot = one gold head with its count), count bubbles when zoomed out. The
  // answer replaces the layer whole; a view that moved on before the answer came is dropped (sequence number); a
  // failed fetch keeps what is on screen (A FAILED FETCH IS NOT AN EMPTY ANSWER — an empty map must never read as
  // «no listings here»). Tapping a bubble zooms into it; tapping a pin hands its row up (the card sheet).
  const pinFilter: PinFilter | undefined = pins ? { ...pins, poly: poly ?? pins.poly ?? null } : undefined;
  const pinsKey = JSON.stringify(pinFilter ?? null);
  // A number, 'failed' (the read for the view on screen failed — «try again» is shown), or null (nothing read yet).
  const [pinCount, setPinCount] = useState<PillCount | null>(null);
  const retryPinsRef = useRef<(() => void) | null>(null);
  // The district (or city) most of the view sits in, for the count pill (owner 2026-11-05); null = «في هذه المنطقة».
  const [viewPlace, setViewPlace] = useState<string | null>(null);
  // The named place's OWN count (owner 2026-11-05): beside «في حي النرجس» the pill prints النرجس's number, not the view's.
  const [placeCount, setPlaceCount] = useState<number | null>(null);
  // The deals NOT chosen that do have listings in view — so an empty deal says where the listings are (owner 2026-11-05).
  const [otherDeals, setOtherDeals] = useState<string[]>([]);
  const onPinSelectRef = useRef(onPinSelect); onPinSelectRef.current = onPinSelect;
  useEffect(() => {
    const mk = mapkitOf(); const m = mapRef.current;
    if (!mk || !m || !pinFilter) return;
    const pins = pinFilter;
    let seq = 0; let timer: ReturnType<typeof setTimeout> | null = null; let mine: unknown[] = [];
    // Both one-time feeds start downloading as the map opens, so the first zooms already answer on the phone.
    void fetchAreasFeed(); void fetchMapDots();
    const keyed = new Map<string, unknown>();   // the annotations on the map, by what they show — a pan keeps what stays
    const loc = localeRef.current === 'ar' ? 'ar' : 'en';
    // ONE PIN = ONE PLACE, NEIGHBOURS SIDE BY SIDE (owner 2026-11-10, src/lib/mapPins.ts placeApart): heads are measured with the
    // font they are drawn in and placed through MapKit's own projection, so «touching» means touching on this screen.
    const measure = document.createElement('canvas').getContext('2d');
    if (measure) measure.font = '600 11px -apple-system,system-ui,sans-serif';
    const headWidth = (r: PinRow) => { const tx = pinHead(r, loc); return measure ? Math.ceil(measure.measureText(tx).width) + PIN_PAD_PX : pinWidthGuess(tx); };
    const onScreen = (lat: number, lng: number): [number, number] => {
      const conv = (m as unknown as { convertCoordinateToPointOnPage?: (c: unknown) => { x: number; y: number } }).convertCoordinateToPointOnPage;
      if (conv) { const p = conv.call(m, new mk.Coordinate(lat, lng)); return [p.x, p.y]; }
      const { center, span } = m.region; const r = (hostRef.current as unknown as HTMLElement | null)?.getBoundingClientRect();
      const w = r?.width ?? 390, h = r?.height ?? 600;
      return [((lng - center.longitude) / span.longitudeDelta + 0.5) * w, ((center.latitude - lat) / span.latitudeDelta + 0.5) * h];
    };
    // What a tap does: a bubble zooms into its cell, a pin hands its row up (the card sheet). Called from the element's
    // OWN pointer handlers — on a phone MapKit's `select` never fired for a touch on a custom annotation (owner
    // 2026-11-02: «when I click it doesn't show»; reproduced with a synthetic touch tap: no sheet) — and from
    // MapKit's `select` for a mouse, deduped by time so one tap is never two picks.
    let lastPick = 0;
    const pick = (row: PinRow, cell: number) => {
      lastPick = Date.now();
      closePanels();
      if (cell > 0) {
        live.history.push(m.region);
        // Always IN (measured live 2026-11-03: a street-zoom bubble's fixed 2.2-cell span was wider than the view it sat
        // in, so a tap zoomed OUT and flipped back to district names): at most a third of the current view.
        const sp = bubbleTapSpan(cell, m.region.span.latitudeDelta);
        m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(row.lat, row.lng), new mk.CoordinateSpan(sp, sp)), true);
      } else onPinSelectRef.current?.(row);
    };
    // SMALL heads (owner 2026-11-02: «the pin is so so big»): 11 px text, a slim pill. ZOOMED OUT, A CELL IS A DOT
    // (owner 2026-11-02, Zillow: «pins don't show the price unless you zoom in»): a 14 px deal-coloured dot, no number;
    // the count of what is in view sits in the pill at the bottom of the map instead.
    // `counted`: the close-in crowded fallback, where a bubble holds many listings at street zoom — it shows its count.
    // Zoomed-out dots stay plain (owner 2026-11-02, Zillow).
    const element = (row: PinRow, cell: number, counted = false) => {
      const el = document.createElement('div');
      const color = cell > 0 ? dotColor(row) : pinColor(row);
      el.setAttribute('data-testid', cell > 0 ? 'map-bubble' : 'map-pin');
      el.style.cssText = `font:600 11px/1 -apple-system,system-ui,sans-serif;color:#fff;background:${color};border:1.5px solid #fff;cursor:pointer;touch-action:none;` +
        (cell > 0
          ? (counted && row.n > 1
            // A close-in bubble holding many listings says how many (measured live 2026-11-03: a tap on «النعيم» showed
            // 5,399 listings as three blank dots, which read as an almost empty map).
            ? 'border-radius:12px;min-width:16px;padding:4px 7px;text-align:center;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4)'
            : 'border-radius:50%;width:14px;height:14px;box-shadow:0 1px 3px rgba(0,0,0,.4)')
          : 'border-radius:10px;padding:4px 7px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35);position:relative');
      el.textContent = cell > 0 ? '' : pinHead(row, loc);
      if (counted && cell > 0 && row.n > 1) el.textContent = areaCount(row.n, loc);
      // A head on its own spot points at it with a tip; a head drawn beside its neighbour gets a line back to its spot
      // instead, drawn under every head by drawStems() below.
      if (cell === 0 && !row.shift) {
        const tip = document.createElement('div');
        tip.style.cssText = `position:absolute;left:50%;bottom:-5px;width:0;height:0;margin-left:-4px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid ${color}`;
        el.appendChild(tip);
      }
      // A tap = pointer down and up within 10 px (a drag that starts on a head still pans the map).
      let down: { x: number; y: number } | null = null;
      el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
      el.addEventListener('pointerup', (e) => {
        const d = down; down = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) { e.stopPropagation(); pick(row, cell); }
      });
      return el;
    };
    // THE DISTRICT MARKER (owner 2026-11-09, src/lib/mapNoPin.ts): the listings of one district that have no exact
    // location, as ONE pin-sized pill at the district's centre — the app's dark purple with a white edge, a crossed-out
    // pin, the count, and the tag «موقع غير محدد» under it, so it never reads as a house's spot. A tap opens the same
    // card sheet a pin opens (pick with cell 0).
    const noPinElement = (row: PinRow) => {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'map-no-pin');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;touch-action:none;font-family:-apple-system,system-ui,sans-serif';
      const pill = document.createElement('div');
      pill.style.cssText = `display:flex;align-items:center;gap:5px;direction:ltr;background:${NO_PIN_COLOR};border:2px solid #fff;border-radius:14px;padding:0 9px 0 7px;height:22px;color:#fff;font-weight:700;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.35)`;
      pill.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><path d="M4 4l16 16"/></svg>';
      pill.appendChild(document.createTextNode(noPinHead(row.n)));
      const tag = document.createElement('div');
      tag.style.cssText = `margin-top:-2px;background:#fff;color:${NO_PIN_COLOR};font-size:9.5px;font-weight:600;border-radius:7px;padding:1px 6px;box-shadow:0 1px 2px rgba(0,0,0,.25);white-space:nowrap`;
      tag.textContent = noPinTag(loc);
      el.append(pill, tag);
      let down: { x: number; y: number } | null = null;
      el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
      el.addEventListener('pointerup', (e) => {
        const d = down; down = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) { e.stopPropagation(); pick(row, 0); }
      });
      return el;
    };
    const clear = () => { for (const a of mine) m.removeAnnotation(a); mine = []; keyed.clear(); clearStems(); };
    // THE LINE BACK TO THE AD'S OWN SPOT (owner 2026-11-10, src/lib/mapPins.ts pinStemTo): a head drawn beside its
    // neighbour never claims the place it was moved to. MapKit overlays are drawn on the map itself, under every
    // annotation, so a line or its dot never crosses another head's text. Never a tap target (enabled: false).
    let stems: unknown[] = [];
    const clearStems = () => { for (const o of stems) m.removeOverlay(o); stems = []; };
    const drawStems = (rows: PinRow[]) => {
      clearStems();
      const box = (hostRef.current as unknown as HTMLElement | null)?.getBoundingClientRect();
      const metresPerPx = m.region.span.latitudeDelta * 111_320 / Math.max(1, box?.height ?? 600);
      for (const row of rows) {
        const to = row.noPin ? null : pinStemTo(row.shift, headWidth(row) / 2);
        if (!to) continue;
        const [x, y] = onScreen(row.lat, row.lng);
        const spot = new mk.Coordinate(row.lat, row.lng);
        const head = m.convertPointOnPageToCoordinate(new DOMPoint(x + to[0], y + to[1]));
        const color = pinColor(row);
        const halo = new mk.PolylineOverlay([spot, head], { style: new mk.Style({ strokeColor: '#ffffff', strokeOpacity: 0.9, lineWidth: 4 }), enabled: false });
        const line = new mk.PolylineOverlay([spot, head], { style: new mk.Style({ strokeColor: color, strokeOpacity: 1, lineWidth: 2 }), enabled: false });
        const dot = new mk.CircleOverlay(spot, 3 * metresPerPx, { style: new mk.Style({ strokeColor: '#ffffff', strokeOpacity: 1, lineWidth: 1.5, fillColor: color, fillOpacity: 1 }), enabled: false });
        for (const o of [halo, line, dot]) { m.addOverlay(o); stems.push(o); }
      }
    };
    // EVERY SPOT, AT ANY ZOOM (owner 2026-11-02: «even when I am zoomed out they all show»): zoomed out with no
    // narrowing (deal only), the dots feed — every pinned listing's 1 km cell, downloaded once — is painted on a canvas
    // over the map: all 23k spots in a few ms, where 23k annotations would freeze a phone. The canvas is hidden while
    // the map moves and repainted when it settles, projected through two points MapKit itself placed on the page.
    const host = hostRef.current as unknown as HTMLElement | null;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-testid', 'map-dots-canvas');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;opacity:0;transition:opacity .15s';
    host?.appendChild(canvas);
    let shown: MapDot[] = []; let project: ((lat: number, lng: number) => [number, number]) | null = null;
    const narrowed = !!(pins.category || pins.scope || pins.furnished != null || pins.types?.length || pins.beds?.length || pins.areaMin != null || pins.areaMax != null
      || pins.priceMin != null || pins.priceMax != null || pins.poly);
    const paint = (dots: MapDot[]) => {
      const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d'); if (!ctx) return false;
      const { center, span } = m.region;
      const conv = (m as unknown as { convertCoordinateToPointOnPage: (c: unknown) => { x: number; y: number } }).convertCoordinateToPointOnPage.bind(m);
      const ref = (lat: number, lng: number) => { const p = conv(new mk.Coordinate(lat, lng)); return { lat, lng, x: p.x - rect.left - window.scrollX, y: p.y - rect.top - window.scrollY }; };
      project = projectorFrom(ref(center.latitude + span.latitudeDelta / 4, center.longitude - span.longitudeDelta / 4), ref(center.latitude - span.latitudeDelta / 4, center.longitude + span.longitudeDelta / 4));
      if (!project) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
      const r = dotRadius(span.latitudeDelta);
      ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(255,255,255,.85)';
      for (const deal of ['buy', 'rent', 'short'] as const) {
        ctx.fillStyle = PIN_COLOR[deal]; ctx.beginPath();
        for (const d of dots) { if (d.deal !== deal) continue; const [x, y] = project(d.lat, d.lng); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
        ctx.fill(); ctx.stroke();
      }
      shown = dots; canvas.style.opacity = '1';
      setViewPlace(null); setPlaceCount(null);   // zoomed-out dots: the pill keeps «في هذه المنطقة»
      return true;
    };
    const hideCanvas = () => { canvas.style.opacity = '0'; };
    const onCanvasTap = (e: MouseEvent) => {
      if (!shown.length || !project) return;
      const rect = canvas.getBoundingClientRect();
      const d = nearestDot(shown, project, e.clientX - rect.left, e.clientY - rect.top);
      if (d) pick({ lat: d.lat, lng: d.lng, n: d.n, deal: d.deal, type_ar: null, platforms: 0, ids: null, price: null, platform: null } as PinRow, cellForSpan(m.region.span.latitudeDelta) || 0.01);
    };
    // AREA LABELS (owner's father, relayed 2026-11-03: «show only the number of listings in the area at such low zoom,
    // and place marks only when the user zooms in further»; «at this zoom level show the names of the districts only
    // and the number of listings»): far out, one label per city; at city zoom, one per district; pins only closer in.
    // A tap on a label zooms into it. Keyed like the pins, so a pan keeps the labels that stay.
    const pickArea = (a: AreaRow, level: AreaLevel) => {
      live.history.push(m.region);
      const sp = areaZoomSpan(level);
      // SHAPED LIKE THE SCREEN (measured live 2026-11-05, 390×844): a square span on a tall map is widened by MapKit to
      // fit the width — a 3° region tap landed at 5.17°, still the region band, so the tap changed nothing. Asking a
      // longitude span no wider than the screen's width/height share keeps the latitude span what areaZoomSpan says.
      const box = (hostRef.current as unknown as HTMLElement | null)?.getBoundingClientRect();
      const aspect = box && box.height > 0 ? Math.min(1, box.width / box.height) : 1;
      m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(a.lat, a.lng), new mk.CoordinateSpan(sp, sp * aspect)), true);
    };
    const areaElement = (a: AreaRow, level: AreaLevel) => {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'map-area');
      el.style.cssText = 'font:700 12px/1.15 -apple-system,system-ui,sans-serif;color:#24232B;background:rgba(255,255,255,.96);'
        + 'border:1px solid rgba(36,35,43,.18);border-radius:12px;padding:5px 9px;white-space:nowrap;text-align:center;'
        + 'box-shadow:0 1px 4px rgba(0,0,0,.28);cursor:pointer;touch-action:none';
      const name = document.createElement('div'); name.textContent = areaName(a, level, loc, translitPlace);   // English UI → English names (owner 2026-11-05)
      const count = document.createElement('div'); count.textContent = areaCount(a.n, loc);
      count.style.cssText = `font-weight:800;font-size:11px;color:${PIN_COLOR.buy};margin-top:1px`;
      el.append(name, count);
      let down: { x: number; y: number } | null = null;
      el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
      el.addEventListener('pointerup', (e) => {
        const d = down; down = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) { e.stopPropagation(); pickArea(a, level); }
      });
      return el;
    };
    const drawAreas = (areas: AreaRow[], level: AreaLevel, whole: AreaRow[] | null = null) => {
      // The pill names where the view is at every zoom (owner 2026-11-05): the country, then the region, the city, the
      // district most of the view's listings are in — «في هذه المنطقة» only when no one place holds most of them.
      // The whole-Kingdom view shows regions (owner 2026-11-09): the pill keeps the country and its WHOLE total, read
      // over COUNTRY_BOX, so a pan that leaves a region off screen never shrinks «… في السعودية».
      const place = whole ? areaPlace(whole, 'country', loc, translitPlace, m.region.center, m.region.span) : areaPlace(areas, level, loc, translitPlace, m.region.center, m.region.span);
      setViewPlace(place?.name ?? null); setPlaceCount(place?.n ?? null);
      clearStems();   // area labels replace the pins: no line may outlive the head it belonged to
      const next = new Map<string, AreaRow>();
      for (const a of areas) next.set(`A|${level}|${a.city}|${a.district}|${a.n}`, a);
      for (const [k, ann] of keyed) if (!next.has(k)) { m.removeAnnotation(ann); keyed.delete(k); }
      // NO PILE-UPS: MapKit hides a label that collides with a higher-priority one, and priority follows the count, so
      // the biggest districts show and a smaller neighbour appears as the user zooms in (Jeddah alone has 107).
      const maxN = Math.max(1, ...areas.map((a) => a.n));
      for (const [k, a] of next) {
        if (keyed.has(k)) continue;
        const ann = new mk.Annotation(new mk.Coordinate((a.at ?? a).lat, (a.at ?? a).lng), () => areaElement(a, level), {
          calloutEnabled: false, collisionMode: mk.Annotation.CollisionMode?.Rectangle, displayPriority: 250 + Math.round(499 * a.n / maxN),
        });
        keyed.set(k, ann); m.addAnnotation(ann);
      }
      mine = [...keyed.values()];
      bridgeAreas([...next.values()], level);
    };
    // BRIDGE LABELS (owner 2026-11-04: «we need to make sure it's never ever slow»). Measured on ezhalah.com: a NEW map
    // draws its first annotation ~3.0 s after it is created, whatever the map type (standard 3,046 ms, hybrid 3,053,
    // satellite 3,065) and wherever it was built (off-screen or transparent pre-drawing did not shorten it), while
    // map.convertCoordinateToPointOnPage answers at once. So until Apple's own labels appear, the same labels are drawn
    // by us in a plain layer over the map, placed through that projection with the same anchor (bottom-centre) and the
    // same count priority (biggest first, a label overlapping a bigger one left out). The layer goes the moment Apple's
    // labels are on the map, the moment the map starts moving (its positions would go stale), and after 6 s at most.
    let bridge: HTMLDivElement | null = null;
    let bridgeTimer: ReturnType<typeof setInterval> | null = null;
    const clearBridge = () => { if (bridgeTimer) clearInterval(bridgeTimer); bridgeTimer = null; bridge?.remove(); bridge = null; };
    const bridgeAreas = (areas: AreaRow[], level: AreaLevel) => {
      clearBridge();
      const box = (m as unknown as { element?: HTMLElement }).element;
      const hostEl = hostRef.current as unknown as HTMLElement | null;
      if (!box || !hostEl || box.querySelector('[data-testid=map-area]')) return;   // Apple already draws labels here
      const toPage = (m as unknown as { convertCoordinateToPointOnPage: (c: unknown) => { x: number; y: number } }).convertCoordinateToPointOnPage.bind(m);
      const layer = document.createElement('div');
      layer.setAttribute('data-testid', 'map-area-bridge');
      layer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2;overflow:hidden';
      hostEl.appendChild(layer);
      const hr = hostEl.getBoundingClientRect();
      const ox = hr.left + window.scrollX; const oy = hr.top + window.scrollY;
      const placed: DOMRect[] = [];
      for (const a of [...areas].sort((x, y) => y.n - x.n)) {
        let pt: { x: number; y: number };
        try { pt = toPage(new mk.Coordinate((a.at ?? a).lat, (a.at ?? a).lng)); } catch { continue; }
        const el = areaElement(a, level);
        el.style.position = 'absolute';
        el.style.left = `${pt.x - ox}px`;
        el.style.top = `${pt.y - oy}px`;
        el.style.transform = 'translate(-50%, -100%)';
        el.style.pointerEvents = 'auto';
        layer.appendChild(el);
        const r = el.getBoundingClientRect();
        const outside = r.right < hr.left || r.left > hr.right || r.bottom < hr.top || r.top > hr.bottom;
        if (outside || placed.some((q) => !(r.right < q.left || r.left > q.right || r.bottom < q.top || r.top > q.bottom))) { el.remove(); continue; }
        placed.push(r);
      }
      bridge = layer;
      const born = Date.now();
      bridgeTimer = setInterval(() => {
        if (box.querySelector('[data-testid=map-area]') || Date.now() - born > 6000) clearBridge();
      }, 50);
    };
    // Which other deals have pinned listings in the visible view (the dots feed, already on the phone, every deal).
    const noteOtherDeals = async (center: { latitude: number; longitude: number }, span: { latitudeDelta: number; longitudeDelta: number }, my: number) => {
      const all = await fetchMapDots();
      if (all === 'unknown' || my !== seq || mapRef.current !== m) return;
      const box = { s: center.latitude - span.latitudeDelta / 2, n: center.latitude + span.latitudeDelta / 2, w: center.longitude - span.longitudeDelta / 2, e: center.longitude + span.longitudeDelta / 2 };
      setOtherDeals((['buy', 'rent', 'short'] as const).filter((d) => !pins.deals.includes(d) && dotsTotal(dotsInView(all, [d], box)) > 0));
    };
    const load = async () => {
      const my = ++seq;
      const { center, span } = m.region;
      void noteOtherDeals(center, span, my);
      const cell = cellForSpan(span.latitudeDelta);
      const level = narrowed ? null : areaLevelShown(span.latitudeDelta);
      if (level) {
        const areas = await fetchMapAreas(paddedBox(center, span), level, pins.deals);
        if (my !== seq || mapRef.current !== m) return;
        if (areas !== 'unknown') {
          hideCanvas(); shown = [];
          // The opening zoom: the country's own total for the pill (the feed is already on the phone; a failed read
          // leaves the pill to the labels in view, never a partial count named «السعودية»).
          const wholeRead = areaLevelFor(span.latitudeDelta) === 'country' ? await fetchMapAreas(COUNTRY_BOX, 'country', pins.deals) : 'unknown';
          if (my !== seq || mapRef.current !== m) return;
          const whole = Array.isArray(wholeRead) && wholeRead.length ? wholeRead : null;
          drawAreas(visibleAreas(areas, level), level, whole);
          setPinCount(whole ? areasTotal(whole) : areasTotal(areas));
          return;
        }
        // The labels failed to load: the dots below, never an empty map.
      }
      if (cell > 0 && !narrowed) {
        const all = await fetchMapDots();
        if (my !== seq || mapRef.current !== m) return;
        if (all !== 'unknown') {
          const inView = dotsInView(all, pins.deals, paddedBox(center, span));
          clear();
          if (paint(inView)) { setPinCount(dotsTotal(inView)); return; }
        }
        // The feed failed (or the projection could not be calibrated): the live grid path below, never an empty map.
      }
      hideCanvas(); shown = [];
      // SMOOTH (owner 2026-11-03: «I want it to feel smooth»): a close view the dots feed (already on the phone) says holds
      // more than CROWD_ESTIMATE listings is crowded without asking the network; only a view that may fit as pins reads.
      // The place for the count pill, read alongside the pins (a few ms on the pin index) for the visible view only.
      // The district markers for listings with no exact location, read alongside the pins (src/lib/mapNoPin.ts).
      const noPinRead: Promise<NoPinRow[] | 'unknown'> = showNoPin(cell, pins) ? fetchMapNoPin(paddedBox(center, span), pins) : Promise.resolve([]);
      const placeRead = cell === 0 ? fetchViewPlace({ s: center.latitude - span.latitudeDelta / 2, n: center.latitude + span.latitudeDelta / 2, w: center.longitude - span.longitudeDelta / 2, e: center.longitude + span.longitudeDelta / 2 }) : Promise.resolve(null);
      const dots = cell === 0 && !narrowed ? await fetchMapDots() : 'unknown';
      if (my !== seq || mapRef.current !== m) return;
      // Weighted by how much of each 1 km cell is in view (src/lib/mapDots.ts dotsEstimateInBox): a whole-cell count
      // read a 280 m view as 1,501 listings (177 real) and drew bubbles over the حي البوادي scheme (🔧 2026-11-06).
      const crowdedByDots = dots !== 'unknown' && dotsEstimateInBox(dots, pins.deals, { s: center.latitude - span.latitudeDelta / 2, n: center.latitude + span.latitudeDelta / 2, w: center.longitude - span.longitudeDelta / 2, e: center.longitude + span.longitudeDelta / 2 }) > CROWD_ESTIMATE;
      // Exact points are read with a small cap: one row over PIN_SHOW_MAX is enough to know the view is too dense.
      let rows: PinRow[] | 'unknown' = crowdedByDots ? [] : await fetchMapPins(paddedBox(center, span), cell, pins, cell === 0 ? PIN_SHOW_MAX + 1 : PIN_LIMIT);
      // The read FAILED for the view on screen (a pan, a zoom or a FILTER change — all of them run this load): its count
      // is unknown, so the pill becomes «couldn't load — try again» (pillCount → 'failed') instead of keeping the
      // previous view's number over this one. The drawn layer is still kept, as before.
      if (my === seq && mapRef.current === m && rows === 'unknown') setPinCount(pillCount(rows));
      if (my !== seq || rows === 'unknown' || mapRef.current !== m) return;
      // DENSE VIEW: the exact-point read hit its cap, so pins would silently show a PART of the listings (downtown
      // Riyadh holds thousands in one city-zoom view). Never a partial set — read the same view again as a fine bubble
      // grid, where every listing is counted, and draw bubbles until the user zooms closer.
      let drawCell = cell;
      // DEEPEST ZOOM (🔧 2026-11-06, owner 2026-11-05 «user cannot select what he wants»): where a bubble would be bigger
      // than the view, a tap on it cannot zoom closer, so the listings would stay hidden behind a number. Read every
      // exact point of the view instead; placeApart sets them side by side (a pile with no room left joins as a counted head).
      let dense = cell === 0 && (crowdedByDots || rows.length > PIN_SHOW_MAX);
      if (dense && !bubblesCanZoomIn(span.latitudeDelta)) {
        const every = await fetchMapPins(paddedBox(center, span), 0, pins, PIN_LIMIT);
        if (my !== seq || mapRef.current !== m) return;
        if (every !== 'unknown' && every.length < PIN_LIMIT) { rows = every; dense = false; }
      }
      if (dense) {
        // Too crowded for price pins (owner's father, 2026-11-03: «at this zoom level show the names of the districts
        // only and the number of listings»): district names while two or more districts share the view; once one
        // district fills the screen, the fine count grid until the user zooms closer.
        if (!narrowed) {
          const areas = await fetchMapAreas(paddedBox(center, span), 'district', pins.deals);
          if (my !== seq || mapRef.current !== m) return;
          if (areas !== 'unknown' && denseShowsDistricts(areas.filter((a) => inView(a, center, span)).length, span.latitudeDelta)) {
            drawAreas(visibleAreas(areas), 'district');
            setPinCount(areasTotal(areas));
            return;
          }
        }
        drawCell = fineCellForSpan(span.latitudeDelta);
        if (dots !== 'unknown' && drawCell === 0.01) {
          // The bubbles from the dots feed itself (it is the same 0.01° grid) — no second network read.
          rows = bubblesFromDots(dotsInView(dots, pins.deals, paddedBox(center, span))).map((b) => ({ ...b, type_ar: null, platforms: 0, ids: null, price: null, platform: null }) as PinRow);
        } else {
          rows = await fetchMapPins(paddedBox(center, span), drawCell, pins);
          if (my === seq && mapRef.current === m && rows === 'unknown') setPinCount(pillCount(rows));
          if (my !== seq || rows === 'unknown' || mapRef.current !== m) return;
        }
      }
      // A head whose spot is taken is drawn beside its neighbour, never on it and never joined to it (src/lib/mapPins.ts).
      if (drawCell === 0) rows = placeApart(rows, onScreen, headWidth);
      // Smallest first, so the biggest count (or the gold shared spot) is added last and sits on top of its neighbours.
      rows.sort((a, b) => a.n - b.n);
      setPinCount(pillCount(rows));
      setPlaceCount(null);
      void placeRead.then((p) => { if (my === seq && mapRef.current === m) setViewPlace(viewPlaceName(p, loc, translitPlace)); });
      // KEEP WHAT STAYS (owner 2026-11-02: «so slow and glitchy»): a pan used to remove every pin and add them all back,
      // a visible flicker on every move. Only the pins that left the view go and only the new ones come; a pin whose
      // head would change (count, deal, price, cell size) is replaced.
      const keyOf = (r: PinRow) => `${drawCell}|${r.lat}|${r.lng}|${r.n}|${r.deal}|${r.price ?? ''}|${r.shift ? r.shift.join(',') : ''}`;
      const next = new Map<string, PinRow>(); for (const row of rows) next.set(keyOf(row), row);
      // The district markers join the same diff. A FAILED marker read keeps the markers already on the map (A FAILED
      // FETCH IS NOT AN EMPTY ANSWER: a marker that vanished after an error would read as «no such listings here»).
      const noPin = await noPinRead;
      if (my !== seq || mapRef.current !== m) return;
      if (noPin !== 'unknown') for (const r of noPin) next.set(noPinKey(r), noPinPinRow(r));
      else for (const [k, a] of keyed) if (isNoPinKey(k)) next.set(k, (a as { data: { pin: PinRow } }).data.pin);
      for (const [k, a] of keyed) if (!next.has(k)) { m.removeAnnotation(a); keyed.delete(k); }
      for (const [k, row] of next) {
        if (keyed.has(k)) continue;
        // A district marker is its own annotation: centred on the district's centre, cell 0 (a tap opens the sheet),
        // drawn above its neighbours.
        const a = row.noPin
          ? new mk.Annotation(new mk.Coordinate(row.lat, row.lng), () => noPinElement(row), { data: { pin: row, cell: 0 }, calloutEnabled: false, displayPriority: 1000 })
          : new mk.Annotation(new mk.Coordinate(row.lat, row.lng), () => element(row, drawCell, cell === 0 && drawCell > 0), {
            data: { pin: row, cell: drawCell }, calloutEnabled: false, anchorOffset: drawCell > 0 ? undefined : new (window as unknown as { DOMPoint: new (x: number, y: number) => unknown }).DOMPoint(...pinAnchorOffset(row.shift)),
          });
        keyed.set(k, a); m.addAnnotation(a);
      }
      mine = [...keyed.values()];
      drawStems(drawCell === 0 ? rows : []);
    };
    const onRegion = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void load(); }, 120); };
    const onSelect = (e: { annotation?: { data?: { pin?: PinRow; cell?: number } } }) => {
      const d = e.annotation?.data; if (!d?.pin) return;
      if (Date.now() - lastPick < 600) return;   // the element's own tap handler already picked it
      pick(d.pin, d.cell ?? 0);
    };
    m.addEventListener('region-change-end', onRegion);
    m.addEventListener('region-change-start', hideCanvas);
    m.addEventListener('select', onSelect);
    // Held on the element it was added to: on unmount the map effect above destroys the map (nulling `element`)
    // BEFORE this cleanup runs (src/lib/mapSurface.ts; measured 11-03, an uncaught TypeError on a fast tab switch).
    const offCanvasTap = onSurface(m, 'click', onCanvasTap);
    const offPanelsClose = onSurface(m, 'pointerdown', closePanels);
    m.addEventListener('region-change-start', closePanels);
    m.addEventListener('region-change-start', clearBridge);
    void load();
    retryPinsRef.current = () => { void load(); };
    return () => {
      retryPinsRef.current = null;
      seq++; if (timer) clearTimeout(timer);
      m.removeEventListener('region-change-end', onRegion as unknown as (e: unknown) => void);
      m.removeEventListener('region-change-start', hideCanvas as unknown as (e: unknown) => void);
      m.removeEventListener('select', onSelect as unknown as (e: unknown) => void);
      offCanvasTap();
      offPanelsClose();
      clearBridge();
      m.removeEventListener('region-change-start', clearBridge as unknown as (e: unknown) => void);
      m.removeEventListener('region-change-start', closePanels as unknown as (e: unknown) => void);
      canvas.remove();
      if (mapRef.current === m) clear();
    };
    // `locale`: a language switch redraws every label and pin head in the new language (owner 2026-11-05).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey, failed, mapReady, locale]);

  // Full screen ⇄ compact: MapKit sizes its canvas on window resize; nudge it once the box has changed.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(id);
  }, [full]);

  // ── Draw (Zillow's «Draw Search», owner 2026-10-31: «see how drawing is, copy it like Zillow») ──────────────
  // Enter: the map stops panning/zooming and a transparent layer takes the pointer; a drag paints a freehand
  // polygon that grows under the finger; lifting closes it; a new drag replaces it. «تطبيق» keeps the shape where
  // it was drawn (the map does not move); «إلغاء» discards the sketch (an earlier applied shape stays). «إزالة الرسم» clears it.
  // Design only for now: nothing searches inside the shape yet.
  // + / − (owner 2026-10-31: «click to zoom»): halve or double the visible span around the same centre.
  const zoomBy = (f: number) => {
    closePanels();
    const mk = mapkitOf(); const m = mapRef.current;
    if (!mk || !m) return;
    const { center, span } = m.region;
    m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(center.latitude, center.longitude), new mk.CoordinateSpan(span.latitudeDelta * f, span.longitudeDelta * f)), true);
  };
  const goBack = () => {
    const mk = mapkitOf(); const m = mapRef.current;
    const el = hostRef.current as unknown as HTMLElement | null;
    if (!mk || !m || !el) return;
    const prev = live.history.pop();
    m.setRegionAnimated(prev ?? ksaRegion(mk, el), true);
  };
  const gestures = (on: boolean) => {
    const m = mapRef.current;
    if (m) { m.isScrollEnabled = on; m.isZoomEnabled = on; m.isRotationEnabled = on; }
  };
  const startDrawing = () => { closePanels(); setSketch(null); setDrawing(true); gestures(false); };
  const cancelDrawing = () => {
    const m = mapRef.current;
    if (m && sketchRef.current) m.removeOverlay(sketchRef.current);
    sketchRef.current = null; setSketch(null); setDrawing(false); gestures(true);
  };
  // Apply keeps the boundary and leaves the map exactly where it is — like Zillow, it does NOT fly to the shape
  // (owner 2026-10-31: «drawing just creates a boundary, it doesn't take you there»).
  // THE DRAWN SHAPE FILTERS THE PINS (owner 2026-11-02: «when I draw then I click apply … show me listings inside
  // that area … strictly inside what the user draws»): Apply turns the sketch into a GeoJSON polygon the pin query
  // keeps points strictly inside of (point-in-polygon in the database); Remove drops it and every pin returns.
  const applyDrawing = () => {
    const m = mapRef.current;
    const shape = sketchRef.current;
    if (!m || !shape) return;
    if (shapeRef.current) m.removeOverlay(shapeRef.current);
    shapeRef.current = shape; sketchRef.current = null;
    setHasShape(true); setSketch(null); setDrawing(false); gestures(true);
    setPoly(polygonOf(shape.points as { latitude: number; longitude: number }[]));
  };
  const removeDrawing = () => {
    const m = mapRef.current;
    if (m && shapeRef.current) m.removeOverlay(shapeRef.current);
    shapeRef.current = null; setHasShape(false); setPoly(null);
  };
  useEffect(() => {
    if (!drawing) return;
    const el = padRef.current as unknown as HTMLElement | null;
    const m = mapRef.current; const mk = mapkitOf();
    if (!el || !m || !mk) return;
    let down = false; let last: { x: number; y: number } | null = null;
    // The PENCIL LINE while the finger moves (owner 2026-10-31: «like a pencil, like Zillow»): a stroke that follows
    // the finger; the filled shape appears only when the finger lifts.
    let line: Shape | null = null;
    const dropLine = () => { if (line) { m.removeOverlay(line); line = null; } };
    const onDown = (e: PointerEvent) => {
      e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
      down = true; last = { x: e.pageX, y: e.pageY };
      if (sketchRef.current) m.removeOverlay(sketchRef.current);
      // MapKit accepts ONLY a real DOMPoint here (a plain {x,y} throws — measured live 2026-10-31: nothing drew).
      ptsRef.current = [m.convertPointOnPageToCoordinate(new DOMPoint(e.pageX, e.pageY))];
      sketchRef.current = null; setSketch(null);
    };
    const onMove = (e: PointerEvent) => {
      if (!down || !last) return;
      if (Math.hypot(e.pageX - last.x, e.pageY - last.y) < 4) return;
      last = { x: e.pageX, y: e.pageY };
      ptsRef.current.push(m.convertPointOnPageToCoordinate(new DOMPoint(last.x, last.y)));
      const coords = ptsRef.current.map((p) => new mk.Coordinate(p.latitude, p.longitude));
      if (line) line.points = coords;
      else {
        line = new mk.PolylineOverlay(coords, { style: new mk.Style({ strokeColor: lightColors.primary, strokeOpacity: 0.95, lineWidth: 3 }), enabled: false });
        m.addOverlay(line);
      }
    };
    const onUp = () => {
      if (!down) return;
      down = false; dropLine();
      const pts = ptsRef.current;
      if (pts.length >= 3) {
        const coords = pts.map((p) => new mk.Coordinate(p.latitude, p.longitude));
        sketchRef.current = new mk.PolygonOverlay(coords, { style: new mk.Style({ strokeColor: lightColors.primary, strokeOpacity: 0.95, lineWidth: 2.5, fillColor: lightColors.primary, fillOpacity: 0.14 }), enabled: false });
        m.addOverlay(sketchRef.current);
      }
      setSketch(sketchRef.current);
    };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
    return () => {
      dropLine();
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
    };
  }, [drawing]);

  // A SHORT COMPACT BOX KEEPS ONLY ⤢ AND ↶ (owner 2026-11-02, phone: «doesn't look nice on a phone»): with the
  // keyboard up the box is ~120 px tall and «رسم», + / − and the layers button piled on top of each other. Under
  // 280 px those three hide; the full-screen map never is that short.
  const [short, setShort] = useState(false);
  const roomy = full || !short;
  return (
    <View style={s.frame} onLayout={(e) => { const boxPx = e.nativeEvent.layout.height; setShort(boxPx < 280); }}>
      <View ref={hostRef} style={s.host} />
      {/* Compact: ⤢ top-left opens the map full screen; the box itself pans and zooms in place. */}
      {/* «رجوع» under the top-left button, only once zoomed in (owner 2026-10-31: «a button that allows the user to go
          back»): returns to the view before the last jump, and with none left, to the whole Kingdom. */}
      {zoomed && !failed && !drawing ? (
        <Pressable style={s.backBtn} onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Back')} testID="map-back">
          <Ionicons name="arrow-undo-outline" size={19} color={colors.ink} />
        </Pressable>
      ) : null}
      {onExpand && !failed && !drawing ? (
        <Pressable style={[s.closeBtn, s.closeBtnLeft]} onPress={() => { closePanels(); onExpand(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Full screen')} testID="map-open-full">
          <Ionicons name="expand-outline" size={20} color={colors.ink} />
        </Pressable>
      ) : null}
      {/* Drawing: this layer takes the pointer instead of the map. */}
      {drawing ? <View ref={padRef} style={s.drawPad} testID="map-draw-pad" /> : null}
      {drawing ? (
        <View style={s.drawBar} testID="map-draw-bar">
          <Pressable style={s.drawBarBtn} onPress={cancelDrawing} hitSlop={8} accessibilityRole="button"><Text style={s.drawBarT}>{t('Cancel')}</Text></Pressable>
          <Text style={s.drawBarTitle}>{t('Draw an area')}</Text>
          <Pressable style={s.drawBarBtn} onPress={applyDrawing} disabled={!sketch} hitSlop={8} accessibilityRole="button" accessibilityState={{ disabled: !sketch }} testID="map-draw-apply">
            <Text style={[s.drawBarT, s.drawBarApply, !sketch && s.drawBarOff]}>{t('Apply')}</Text>
          </Pressable>
        </View>
      ) : null}
      {drawing && !sketch ? <View style={s.hint} pointerEvents="none"><Text style={s.hintT}>{t('Drag on the map to draw an area')}</Text></View> : null}
      {onClose && !drawing ? (
        // The X is top RIGHT, always, in both languages (owner 2026-11-10: «x for everything must always be on the top right
        // no matter what, even if it's in English»); «رسم» / «مسار» move to the top left while it shows. `left`/`right`
        // are physical here (measured live 2026-11-10: left: 12 sat at the physical left under Arabic RTL).
        <Pressable style={[s.closeBtn, s.closeBtnRight]} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Close')} testID="map-close-full">
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      ) : null}
      {roomy ? <View style={[s.topRight, onClose && !drawing ? s.topRightAsLeft : s.topRightAt]} pointerEvents="box-none">
      {/* «مسار» beside «رسم» (owner 2026-10-31: from here to here, visible before anyone types). With a route drawn it
          becomes «إزالة المسار ✕». */}
      {onRoute && !failed && !drawing ? (
        <Pressable style={[s.drawBtn, routeOn && s.boundaryBtn]} onPress={routeOn ? clearRoute : onRoute} accessibilityRole="button" accessibilityLabel={t(routeOn ? 'Remove route' : 'Route')} testID="map-route-btn">
          {routeOn ? null : <Ionicons name="navigate-outline" size={15} color={colors.ink} />}
          <Text style={[s.wholeT, routeOn && s.boundaryT]}>{t(routeOn ? 'Remove route' : 'Route')}</Text>
          {routeOn ? <Ionicons name="close" size={17} color={colors.primary} /> : null}
        </Pressable>
      ) : null}
      {/* «رسم» top-right, like Zillow's Draw. Once a boundary is applied it becomes Zillow's «Remove Boundary ✕»
          (owner 2026-10-31: «see how it shows remove boundary»). No «كل المملكة» button any more (owner: «remove
          this whole kingdom»): pinch / scroll zooms back out, as on any map. */}
      {!failed && !drawing ? (
        <Pressable style={[s.drawBtn, hasShape && s.boundaryBtn]} onPress={hasShape ? removeDrawing : startDrawing} accessibilityRole="button" accessibilityLabel={t(hasShape ? 'Remove boundary' : 'Draw')} testID="map-draw-btn">
          {hasShape ? null : <Ionicons name="pencil-outline" size={15} color={colors.ink} />}
          <Text style={[s.wholeT, hasShape && s.boundaryT]}>{t(hasShape ? 'Remove boundary' : 'Draw')}</Text>
          {hasShape ? <Ionicons name="close" size={17} color={colors.primary} /> : null}
        </Pressable>
      ) : null}
      </View> : null}
      {/* + / − above the layers button, same column. */}
      {roomy && !failed && !drawing ? (
        <View style={[s.zoomCol, locale === 'ar' && s.zoomColAr]} testID="map-zoom">
          <Pressable style={s.zoomBtn} onPress={() => zoomBy(0.5)} accessibilityRole="button" accessibilityLabel={t('Zoom in')}><Ionicons name="add" size={22} color={colors.ink} /></Pressable>
          <View style={s.zoomRule} />
          <Pressable style={s.zoomBtn} onPress={() => zoomBy(2)} accessibilityRole="button" accessibilityLabel={t('Zoom out')}><Ionicons name="remove" size={22} color={colors.ink} /></Pressable>
        </View>
      ) : null}
      {/* Layers, far bottom-right (owner 2026-10-31: «far down right»). In English Apple's mark is bottom-LEFT and the
          corner is free; in Arabic the mark sits bottom-RIGHT, inside the map image, so the button lifts above it. */}
      {roomy && !failed && !drawing ? (
        <Pressable style={[s.layersBtn, locale === 'ar' && s.layersBtnAr]} onPress={() => { setLayersOpen((o) => !o); setGroundOpen(false); }} accessibilityRole="button" accessibilityLabel={t('Map layers')} testID="map-layers-btn">
          <Ionicons name="layers-outline" size={20} color={colors.ink} />
        </Pressable>
      ) : null}
      {layersOpen && !failed && !drawing ? (
        <View style={[s.layersCard, locale === 'ar' && s.layersCardAr]} testID="map-layers-popup">
          {([['standard', 'Explore', 'map-outline'], ['hybrid', 'Satellite', 'earth-outline'], ['muted', 'Quiet', 'contrast-outline']] as const).map(([k, label, icon]) => (
            <Pressable key={k} style={({ hovered }: any) => [s.layerRow, hovered && s.layerRowHover, mapType === k && s.layerRowOn]} onPress={() => { applyMapType(k); setLayersOpen(false); }} accessibilityRole="radio" accessibilityState={{ checked: mapType === k }}>
              <Ionicons name={icon} size={17} color={mapType === k ? colors.primary : colors.ink} />
              <Text style={[s.layerT, mapType === k && s.layerTOn]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {/* Ground type, beside the layers button (owner 2026-11-02: «add it beside it»). Same circle, same lift in Arabic. */}
      {!failed && !drawing ? (
        <Pressable style={[s.groundBtn, locale === 'ar' && s.layersBtnAr]} onPress={() => { setGroundOpen((o) => !o); setLayersOpen(false); }} accessibilityRole="button" accessibilityLabel={t('Ground type')} testID="map-ground-btn">
          <MaterialCommunityIcons name="waves" size={21} color={colors.ink} />
        </Pressable>
      ) : null}
      {groundOpen && !failed && !drawing ? (
        <View style={[s.layersCard, locale === 'ar' && s.layersCardAr]} testID="map-ground-popup">
          <Text style={s.groundTitle}>{t('Ground type')} <Text style={s.groundHint}>({t('approximate')})</Text></Text>
          {([['Sand', '#e9d98e'], ['Rock', '#b89b7a'], ['Sabkha', '#e4a96b'], ['Gravel', '#cfcac0'], ['Clay', '#c9a27e']] as const).map(([label, color]) => (
            <View key={label} style={[s.layerRow, s.groundRow]} accessibilityRole="text">
              <View style={[s.groundDot, { backgroundColor: color }]} />
              <Text style={[s.layerT, s.groundRowT]}>{t(label)}</Text>
            </View>
          ))}
          <Text style={s.groundSoon}>{t('Coming soon')}</Text>
        </View>
      ) : null}
      {/* Zillow's «Only N matching results»: what the view (or the drawn boundary) holds, since the dots carry no number. */}
      {!drawing && pinCount === 'failed' ? (
        <Pressable style={s.countPill} onPress={() => retryPinsRef.current?.()} accessibilityRole="button" testID="map-pin-retry"><Text style={s.countPillT}>{t('Couldn’t load the listings here. Try again')}</Text></Pressable>
      ) : null}
      {!drawing && typeof pinCount === 'number' ? (
        <View style={s.countPill} pointerEvents="none" testID="map-pin-count"><Text style={s.countPillT}>{hasShape ? t('{n} listings inside the boundary', { n: pinCount.toLocaleString('en-US') }) : viewCountText(placeCount ?? pinCount, viewPlace, locale === 'ar' ? 'ar' : 'en', pins?.deals, otherDeals)}</Text></View>
      ) : null}
      {failed ? <View style={s.failed} pointerEvents="none"><View style={s.failedPill}><Text style={s.failedT}>{t('The map could not load')}</Text></View></View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  countPill: { position: 'absolute', left: 12, bottom: 12, backgroundColor: 'rgba(36,35,43,0.86)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  countPillT: { color: '#fff', fontSize: 13, fontWeight: '700' },
  frame: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine },
  host: { flex: 1 },
  wholeT: { fontFamily: font.family.bold, fontSize: 13, color: colors.ink },
  // Each side is its OWN style (review of #11614): React Native Web drops a style value set to undefined, so clearing `left` that way
  // would have left the base `left: 12` in place next to `right: 12`.
  topRight: { position: 'absolute', top: 12, flexDirection: 'row', gap: 8 },
  topRightAt: { right: 12 },
  topRightAsLeft: { left: 12 },
  closeBtnLeft: { left: 12 },
  closeBtnRight: { right: 12 },
  drawBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 999,
    paddingHorizontal: 14, height: 36, borderWidth: 1, borderColor: colors.tintLine,
  },
  zoomCol: { position: 'absolute', right: 12, bottom: 62, width: 40, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.tintLine, alignItems: 'center', overflow: 'hidden' },
  zoomColAr: { bottom: 82 },
  zoomBtn: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center' },
  zoomRule: { width: 22, height: 1, backgroundColor: colors.tintLine },
  drawPad: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, touchAction: 'none', cursor: 'crosshair' } as any,
  drawBar: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.tintLine,
  },
  drawBarBtn: { minWidth: 56, height: 36, justifyContent: 'center' },
  drawBarT: { fontFamily: font.family.medium, fontSize: 15, color: colors.ink },
  drawBarTitle: { fontFamily: font.family.bold, fontSize: 15, color: colors.ink },
  drawBarApply: { fontFamily: font.family.bold, color: colors.primary, textAlign: 'right' },
  drawBarOff: { opacity: 0.35 },
  hint: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' },
  hintT: { fontFamily: font.family.medium, fontSize: 13, color: colors.ink, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, overflow: 'hidden', borderWidth: 1, borderColor: colors.tintLine },
  backBtn: {
    position: 'absolute', top: 56, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  closeBtn: {
    position: 'absolute', top: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  boundaryBtn: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.tintFill },
  boundaryT: { color: colors.primary },
  layersBtn: {
    position: 'absolute', right: 12, bottom: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  layersBtnAr: { bottom: 32 },
  groundBtn: {
    position: 'absolute', right: 60, bottom: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  groundMascot: { width: 30, height: 34 }, // portrait, like the figure; fills the 40 px circle (owner 2026-11-02: no white box)
  groundTitle: { fontFamily: font.family.bold, fontSize: 13.5, color: colors.ink, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  groundHint: { fontFamily: font.family.medium, fontSize: 12, color: colors.muted },
  groundRow: { paddingVertical: 7, opacity: 0.55 },
  groundRowT: { fontFamily: font.family.medium },
  groundDot: { width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: colors.tintLine },
  groundSoon: { fontFamily: font.family.medium, fontSize: 12, color: colors.primary, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 6 },
  layersCardAr: { bottom: 78 },
  layersCard: {
    position: 'absolute', right: 12, bottom: 58, minWidth: 160, backgroundColor: colors.surface, borderRadius: 14, padding: 6,
    borderWidth: 1, borderColor: colors.tintLine,
  },
  layerRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10 },
  layerRowHover: { backgroundColor: colors.tint },
  layerRowOn: { backgroundColor: colors.tint },
  layerT: { fontFamily: font.family.medium, fontSize: 13.5, color: colors.ink },
  layerTOn: { fontFamily: font.family.bold, color: colors.primary },
  failed: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  failedPill: { backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: colors.tintLine },
  failedT: { fontFamily: font.family.medium, fontSize: 14, color: colors.ink },
});
