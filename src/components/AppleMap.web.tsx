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
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '@/theme/tokens';
import { lightColors } from '@/theme/palette';
import { classifyPlace, placeSubtitle, dedupePlaces, dropAreaShadows, sortByKind, isAreaKind, isNoiseName, type PlaceKind, type PlaceFacts } from '@/lib/placeKind';
import { useI18n } from '@/i18n';

const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
const TOKEN_URL = '/api/mapkit-token';
const REGIONS_URL = '/ksa-regions.json';
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
  destroy: () => void;
  mapType: string;
  isScrollEnabled: boolean;
  isZoomEnabled: boolean;
  isRotationEnabled: boolean;
  region: { center: Coord; span: { latitudeDelta: number; longitudeDelta: number } };
  addOverlay: (o: unknown) => void;
  removeOverlay: (o: unknown) => void;
  addAnnotation: (a: unknown) => void;
  removeAnnotation: (a: unknown) => void;
  convertPointOnPageToCoordinate: (p: DOMPoint) => Coord;
  setRegionAnimated: (r: unknown, animate?: boolean) => void;
  addEventListener: (name: string, fn: (e: { overlay?: { data?: Region } }) => void) => void;
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
  Style: new (o: { strokeColor?: string; strokeOpacity?: number; fillColor?: string; fillOpacity?: number; lineWidth?: number }) => unknown;
  PolygonOverlay: new (points: unknown[] | unknown[][], o?: { style?: unknown; data?: unknown; enabled?: boolean }) => Shape;
  PolylineOverlay: new (points: unknown[], o?: { style?: unknown; enabled?: boolean }) => Shape;
  CircleOverlay: new (center: unknown, radius: number, o?: { style?: unknown; enabled?: boolean }) => unknown;
  Directions: (new (o?: { language?: string }) => { route: (req: { origin: unknown; destination: unknown; transportType?: unknown }, cb: (err: unknown, data: { routes: { polyline: { points: Coord[] }; distance: number }[] }) => void) => number }) & { Transport: { Automobile: unknown } };
  MarkerAnnotation: new (coord: unknown, o?: { title?: string; color?: string; glyphColor?: string; animates?: boolean }) => unknown;
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

async function fetchToken(): Promise<string> {
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
const live: { map: MKMap | null; search: MKSearch | null; lang: string; history: unknown[]; mark: { overlay?: unknown; pin?: unknown }; route: unknown[]; onRoute?: (on: boolean) => void } = { map: null, search: null, lang: '', history: [], mark: {}, route: [] };

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
  live.mark = {};
}

/** Apple Maps' own place suggestions (owner 2026-10-31: «this search connected to Apple Maps, like how a user
 *  searches in Apple Maps»), limited to Saudi Arabia, in the UI language. Resolves [] when MapKit is unavailable:
 *  the field then simply shows nothing (never a fake "no places"). */
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
    const timer = setTimeout(() => resolve(r), 1500);
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
  return sortByKind(dropAreaShadows(dedupePlaces(places.length ? places : named)), query).slice(0, 6);
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
    if (region) m.setRegionAnimated(region, true);
    else if (c) m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(c.latitude, c.longitude), new mk.CoordinateSpan(0.08, 0.08)), true);
    // MARK WHAT WAS SEARCHED (owner 2026-10-31: «create something around it so they know the landmark or district
    // they searched»). A landmark (Apple gives it a point-of-interest category) gets a brand pin with its name and a
    // soft circle; a district / city / region (no category) gets a quiet outline of the area Apple returns, in the
    // same brand tone as the region outlines. One mark at a time.
    clearPlaceMark();
    if (!c) return;
    const style = (fillOpacity: number, lineWidth: number) => new mk.Style({ strokeColor: lightColors.primary, strokeOpacity: 0.85, lineWidth, fillColor: lightColors.primary, fillOpacity });
    const landmark = p.kind ? !isAreaKind(p.kind) && p.kind !== 'street' : !!(place && place.pointOfInterestCategory);
    if (landmark) {
      const radius = region ? Math.max(120, Math.min(600, region.span.latitudeDelta * 111_000 * 0.35)) : 250;
      live.mark.overlay = new mk.CircleOverlay(new mk.Coordinate(c.latitude, c.longitude), radius, { style: style(0.12, 1.5), enabled: false });
      live.mark.pin = new mk.MarkerAnnotation(new mk.Coordinate(c.latitude, c.longitude), { title: (place ? place.name : undefined) ?? p.name ?? p.displayLines[0], color: lightColors.primary, animates: true });
      m.addOverlay(live.mark.overlay);
      m.addAnnotation(live.mark.pin);
    } else if (region) {
      const { center, span } = region;
      const n = center.latitude + span.latitudeDelta / 2, s0 = center.latitude - span.latitudeDelta / 2;
      const e = center.longitude + span.longitudeDelta / 2, w = center.longitude - span.longitudeDelta / 2;
      live.mark.overlay = new mk.PolygonOverlay([[n, w], [n, e], [s0, e], [s0, w]].map(([la, lo]) => new mk.Coordinate(la, lo)), { style: style(0.06, 1.6), enabled: false });
      m.addOverlay(live.mark.overlay);
    }
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
export default function AppleMap({ full = false, onExpand, onClose, onRoute }: { full?: boolean; onExpand?: () => void; onClose?: () => void; onRoute?: () => void }) {
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
  const [hasShape, setHasShape] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [routeOn, setRouteOn] = useState(false);
  useEffect(() => { live.onRoute = setRouteOn; return () => { if (live.onRoute === setRouteOn) live.onRoute = undefined; }; }, []);
  const [failed, setFailed] = useState(false);
  // Map style (owner 2026-10-31, Zillow's layers button): the modes Apple's web MapKit offers — standard, satellite
  // with labels (hybrid), and muted. Driving / transit / traffic exist only in Apple's own apps, not on the web.
  const [layersOpen, setLayersOpen] = useState(false);
  // Satellite with labels by default (owner 2026-10-31: «keep the default satellite»).
  const [mapType, setMapType] = useState<'standard' | 'hybrid' | 'muted'>('hybrid');
  const applyMapType = (k: 'standard' | 'hybrid' | 'muted') => {
    const mk = mapkitOf();
    const m = mapRef.current;
    if (mk && m) m.mapType = k === 'hybrid' ? mk.Map.MapTypes.Hybrid : k === 'muted' ? mk.Map.MapTypes.MutedStandard : mk.Map.MapTypes.Standard;
    setMapType(k);
  };

  useEffect(() => {
    let map: MKMap | null = null;
    let gone = false;
    const onError = (e: { status?: string }) => { if (e.status === 'Unauthorized' || e.status === 'Too Many Requests') setFailed(true); };
    loadMapKit().then((mk) => {
      if (gone) return;
      const el = hostRef.current as unknown as HTMLElement | null;
      if (!el) return;
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
          if (!r || !map) return;
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
          setZoomed(lat < homeLatDelta * 0.85);
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
      map?.destroy();
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
  const startDrawing = () => { setSketch(null); setDrawing(true); gestures(false); };
  const cancelDrawing = () => {
    const m = mapRef.current;
    if (m && sketchRef.current) m.removeOverlay(sketchRef.current);
    sketchRef.current = null; setSketch(null); setDrawing(false); gestures(true);
  };
  // Apply keeps the boundary and leaves the map exactly where it is — like Zillow, it does NOT fly to the shape
  // (owner 2026-10-31: «drawing just creates a boundary, it doesn't take you there»).
  const applyDrawing = () => {
    const m = mapRef.current;
    const shape = sketchRef.current;
    if (!m || !shape) return;
    if (shapeRef.current) m.removeOverlay(shapeRef.current);
    shapeRef.current = shape; sketchRef.current = null;
    setHasShape(true); setSketch(null); setDrawing(false); gestures(true);
  };
  const removeDrawing = () => {
    const m = mapRef.current;
    if (m && shapeRef.current) m.removeOverlay(shapeRef.current);
    shapeRef.current = null; setHasShape(false);
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

  return (
    <View style={s.frame}>
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
        <Pressable style={s.closeBtn} onPress={onExpand} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Full screen')} testID="map-open-full">
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
        <Pressable style={s.closeBtn} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Close')} testID="map-close-full">
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      ) : null}
      <View style={s.topRight} pointerEvents="box-none">
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
      </View>
      {/* + / − above the layers button, same column. */}
      {!failed && !drawing ? (
        <View style={[s.zoomCol, locale === 'ar' && s.zoomColAr]} testID="map-zoom">
          <Pressable style={s.zoomBtn} onPress={() => zoomBy(0.5)} accessibilityRole="button" accessibilityLabel={t('Zoom in')}><Ionicons name="add" size={22} color={colors.ink} /></Pressable>
          <View style={s.zoomRule} />
          <Pressable style={s.zoomBtn} onPress={() => zoomBy(2)} accessibilityRole="button" accessibilityLabel={t('Zoom out')}><Ionicons name="remove" size={22} color={colors.ink} /></Pressable>
        </View>
      ) : null}
      {/* Layers, far bottom-right (owner 2026-10-31: «far down right»). In English Apple's mark is bottom-LEFT and the
          corner is free; in Arabic the mark sits bottom-RIGHT, inside the map image, so the button lifts above it. */}
      {!failed && !drawing ? (
        <Pressable style={[s.layersBtn, locale === 'ar' && s.layersBtnAr]} onPress={() => setLayersOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={t('Map layers')} testID="map-layers-btn">
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
      {failed ? <View style={s.failed} pointerEvents="none"><View style={s.failedPill}><Text style={s.failedT}>{t('The map could not load')}</Text></View></View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine },
  host: { flex: 1 },
  wholeT: { fontFamily: font.family.bold, fontSize: 13, color: colors.ink },
  topRight: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 },
  drawBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 999,
    paddingHorizontal: 14, height: 36, borderWidth: 1, borderColor: colors.tintLine,
  },
  zoomCol: { position: 'absolute', right: 12, bottom: 62, width: 40, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.tintLine, alignItems: 'center', overflow: 'hidden' },
  zoomColAr: { bottom: 94 },
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
    position: 'absolute', top: 12, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  boundaryBtn: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.tintFill },
  boundaryT: { color: colors.primary },
  layersBtn: {
    position: 'absolute', right: 12, bottom: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  layersBtnAr: { bottom: 44 },
  layersCardAr: { bottom: 90 },
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
