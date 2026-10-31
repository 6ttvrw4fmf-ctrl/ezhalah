// AppleMap (web) — the «خريطة» tab's map: Apple Maps (MapKit JS) over Saudi Arabia, divided into its 13
// administrative regions, each clickable (owner 2026-10-30: «Saudi Arabia divided into 13 clickable regions, just
// like Zillow displays US states» — no property pins yet).
//
// What is on the map, and nothing more:
//   • Apple's own map (cities, districts, roads appear as you zoom — Apple draws them, in the app's language).
//   • The 13 region boundaries (public/ksa-regions.json — geoBoundaries ADM1, ODbL, simplified to ~2 km / 24 KB)
//     drawn as quiet polygon overlays in the brand colour. The region NAMES are Apple's own (it labels every
//     region in the app's language): we draw none (owner 2026-10-31: «Apple Maps already has names for those
//     regions, why are we adding both — remove our names, just the polygon drawing»). The file's `label` / `rot`
//     / `len` fields are kept for a day they are wanted again.
//   • The neighbours around the Kingdom (Yemen, Oman, the Emirates, Jordan, Egypt…) are in the first view, plain —
//     only Saudi Arabia is split into regions (owner: «like you see Dubai, Yemen beside, but Saudi is split»).
//   • Click a region → the map glides to it. «كل المملكة» (top corner) glides back out to the whole country.
//     Pinch / scroll / the +− control zoom freely, as on any map.
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
  region: { span: { latitudeDelta: number; longitudeDelta: number } };
  addOverlay: (o: unknown) => void;
  setRegionAnimated: (r: unknown, animate?: boolean) => void;
  addEventListener: (name: string, fn: (e: { overlay?: { data?: Region } }) => void) => void;
};
type MapKit = {
  init: (o: { authorizationCallback: (done: (token: string) => void) => void; language?: string }) => void;
  Map: (new (el: HTMLElement, o?: object) => MKMap) & { MapTypes: { Standard: string; MutedStandard: string; Hybrid: string; Satellite: string } };
  Coordinate: new (lat: number, lng: number) => unknown;
  CoordinateSpan: new (lat: number, lng: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
  Style: new (o: { strokeColor?: string; strokeOpacity?: number; fillColor?: string; fillOpacity?: number; lineWidth?: number }) => unknown;
  PolygonOverlay: new (points: unknown[] | unknown[][], o?: { style?: unknown; data?: unknown; enabled?: boolean }) => { style: { fillOpacity: number; strokeOpacity: number; lineWidth: number }; data: Region };
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

export default function AppleMap() {
  const { locale, t } = useI18n();
  const hostRef = useRef<View>(null);
  const mapRef = useRef<MKMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  // Map style (owner 2026-10-31, Zillow's layers button): the modes Apple's web MapKit offers — standard, satellite
  // with labels (hybrid), and muted. Driving / transit / traffic exist only in Apple's own apps, not on the web.
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapType, setMapType] = useState<'standard' | 'hybrid' | 'muted'>('standard');
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
      initOnce(mk, locale);
      mk.addEventListener('error', onError);
      map = new mk.Map(el, {
        region: ksaRegion(mk, el),
        showsMapTypeControl: false,
        showsPointsOfInterest: false,
        // The bottom-right corner belongs to our layers button (owner 2026-10-31: «put that thing far right below»);
        // Apple's +/− would sit under it. Pinch, scroll and double-tap still zoom.
        showsZoomControl: false,
      });
      mapRef.current = map;

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
          map.setRegionAnimated(regionView(mk, r), true);
        });
        // The «whole Kingdom» button only while zoomed in — "in" measured against the home view MapKit actually
        // settled on (it widens the requested span to the box's shape, so comparing with the requested numbers left
        // the button showing after «كل المملكة» — seen on production 2026-10-31).
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
      map?.destroy();
    };
    // locale only affects init, which runs once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showWholeKingdom = () => {
    const mk = mapkitOf();
    const el = hostRef.current as unknown as HTMLElement | null;
    if (mk && el && mapRef.current) mapRef.current.setRegionAnimated(ksaRegion(mk, el), true);
  };

  return (
    <View style={s.frame}>
      <View ref={hostRef} style={s.host} />
      {zoomed && !failed ? (
        <Pressable style={s.wholeBtn} onPress={showWholeKingdom} accessibilityRole="button" accessibilityLabel={t('Whole Kingdom')}>
          <Text style={s.wholeT}>{t('Whole Kingdom')}</Text>
        </Pressable>
      ) : null}
      {/* «رسم» top-right, like Zillow's Draw (owner 2026-10-31: «draw, like the screenshot»). Design only: drawing an
          area to search inside it is the next step; the button does nothing yet. */}
      {!failed ? (
        <Pressable style={s.drawBtn} accessibilityRole="button" accessibilityLabel={t('Draw')} testID="map-draw-btn">
          <Ionicons name="pencil-outline" size={15} color={colors.ink} />
          <Text style={s.wholeT}>{t('Draw')}</Text>
        </Pressable>
      ) : null}
      {/* Layers, bottom-right, lifted just above Apple's mark strip (Apple's zoom control is off so nothing else is there). */}
      {!failed ? (
        <Pressable style={s.layersBtn} onPress={() => setLayersOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={t('Map layers')} testID="map-layers-btn">
          <Ionicons name="layers-outline" size={20} color={colors.ink} />
        </Pressable>
      ) : null}
      {layersOpen && !failed ? (
        <View style={s.layersCard} testID="map-layers-popup">
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
  wholeBtn: {
    position: 'absolute', top: 12, left: 12, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 14, height: 36,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  wholeT: { fontFamily: font.family.bold, fontSize: 13, color: colors.ink },
  drawBtn: {
    position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 999,
    paddingHorizontal: 14, height: 36, borderWidth: 1, borderColor: colors.tintLine,
  },
  layersBtn: {
    position: 'absolute', right: 12, bottom: 44, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.tintLine,
  },
  layersCard: {
    position: 'absolute', right: 12, bottom: 90, minWidth: 160, backgroundColor: colors.surface, borderRadius: 14, padding: 6,
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
