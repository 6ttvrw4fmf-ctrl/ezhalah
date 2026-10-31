// AppleMap (web) — the «خريطة» tab's map: Apple Maps (MapKit JS) over Saudi Arabia, divided into its 13
// administrative regions, each clickable (owner 2026-10-30: «Saudi Arabia divided into 13 clickable regions, just
// like Zillow displays US states» — no property pins yet).
//
// What is on the map, and nothing more:
//   • Apple's own map (cities, districts, roads appear as you zoom — Apple draws them, in the app's language).
//   • The 13 region boundaries (public/ksa-regions.json — geoBoundaries ADM1, ODbL, simplified to ~2 km / 23 KB)
//     drawn as polygon overlays in the brand colour, with the region's name at its centre while zoomed out.
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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '@/theme/tokens';
import { lightColors } from '@/theme/palette';
import { useI18n } from '@/i18n';

const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
const TOKEN_URL = '/api/mapkit-token';
const REGIONS_URL = '/ksa-regions.json';
const FETCH_TIMEOUT_MS = 8000;

// The Kingdom, whole, on first open: centre near the country's middle, span wide enough for Tabuk to Jazan and
// Jeddah to Dammam at once.
const KSA_CENTER = { latitude: 24.0, longitude: 45.0 };
const KSA_SPAN = { latitudeDelta: 16, longitudeDelta: 18 };
// Region names show while the view is wider than this (country / a few regions); they leave as you zoom in so
// they never sit on top of a city.
const LABELS_HIDE_BELOW_SPAN = 5;

type Region = { id: number; iso: string; en: string; ar: string; bbox: [number, number, number, number]; rings: [number, number][][] };

type MKMap = {
  destroy: () => void;
  region: { span: { latitudeDelta: number } };
  addOverlay: (o: unknown) => void;
  addAnnotation: (a: unknown) => void;
  setRegionAnimated: (r: unknown, animate?: boolean) => void;
  addEventListener: (name: string, fn: (e: { overlay?: { data?: Region } }) => void) => void;
};
type MapKit = {
  init: (o: { authorizationCallback: (done: (token: string) => void) => void; language?: string }) => void;
  Map: new (el: HTMLElement, o?: object) => MKMap;
  Coordinate: new (lat: number, lng: number) => unknown;
  CoordinateSpan: new (lat: number, lng: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
  Style: new (o: { strokeColor?: string; fillColor?: string; fillOpacity?: number; lineWidth?: number }) => unknown;
  PolygonOverlay: new (points: unknown[] | unknown[][], o?: { style?: unknown; data?: unknown; enabled?: boolean }) => { style: { fillOpacity: number; lineWidth: number }; data: Region };
  Annotation: new (coord: unknown, factory: () => HTMLElement, o?: { data?: unknown; anchorOffset?: unknown; enabled?: boolean }) => { visible: boolean };
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

async function fetchToken(): Promise<string> {
  const r = await fetch(TOKEN_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = (await r.json()) as { token?: unknown };
  if (typeof j.token !== 'string' || !j.token) throw new Error('token missing');
  return j.token;
}

let regionsLoad: Promise<Region[]> | null = null;
/** The 13 regions, fetched once per page. A failed fetch is an error, never an empty list. */
function loadRegions(): Promise<Region[]> {
  if (regionsLoad) return regionsLoad;
  regionsLoad = fetch(REGIONS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
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

const ksaRegion = (mk: MapKit) => new mk.CoordinateRegion(
  new mk.Coordinate(KSA_CENTER.latitude, KSA_CENTER.longitude),
  new mk.CoordinateSpan(KSA_SPAN.latitudeDelta, KSA_SPAN.longitudeDelta),
);

/** The view that shows one region whole, with a little air around it. */
const regionView = (mk: MapKit, r: Region) => {
  const [w, s, e, n] = r.bbox;
  return new mk.CoordinateRegion(
    new mk.Coordinate((s + n) / 2, (w + e) / 2),
    new mk.CoordinateSpan((n - s) * 1.25, (e - w) * 1.25),
  );
};

/** A region's name, in a small pill, as a DOM element MapKit positions at the region's centre. */
function labelElement(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'font: 600 12.5px ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif; color: ' + lightColors.ink
    + '; background: rgba(255,255,255,0.86); padding: 3px 9px; border-radius: 999px; border: 1px solid ' + lightColors.tintLine
    + '; white-space: nowrap; pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,0.08);';
  return el;
}

export default function AppleMap() {
  const { locale, t } = useI18n();
  const hostRef = useRef<View>(null);
  const mapRef = useRef<MKMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let map: MKMap | null = null;
    let gone = false;
    const onError = (e: { status?: string }) => { if (e.status === 'Unauthorized' || e.status === 'Too Many Requests') setFailed(true); };
    loadMapKit().then((mk) => {
      if (gone) return;
      const el = hostRef.current as unknown as HTMLElement | null;
      if (!el) return;
      initOnce(mk, locale);
      mk.addEventListener('error', onError);
      map = new mk.Map(el, {
        region: ksaRegion(mk),
        showsMapTypeControl: false,
        showsPointsOfInterest: false,
      });
      mapRef.current = map;

      // The 13 regions: boundaries + names, and click-to-zoom.
      const ar = locale === 'ar';
      const stroke = lightColors.primary;
      loadRegions().then((regions) => {
        if (gone || !map) return;
        const overlays = regions.map((r) => {
          const rings = r.rings.map((ring) => ring.map(([lng, lat]) => new mk.Coordinate(lat, lng)));
          return new mk.PolygonOverlay(rings.length === 1 ? rings[0] : rings, {
            style: new mk.Style({ strokeColor: stroke, lineWidth: 1.5, fillColor: stroke, fillOpacity: 0.07 }),
            data: r,
          });
        });
        overlays.forEach((o) => map!.addOverlay(o));
        const labels = regions.map((r) => {
          const [w, s, e, n] = r.bbox;
          return new mk.Annotation(new mk.Coordinate((s + n) / 2, (w + e) / 2), () => labelElement(ar ? r.ar : r.en), { data: r, enabled: false });
        });
        labels.forEach((a) => map!.addAnnotation(a));

        // Click a region → glide to it; the chosen one is tinted a little stronger until another is chosen.
        let chosen: { style: { fillOpacity: number; lineWidth: number } } | null = null;
        map.addEventListener('select', (e) => {
          const r = e.overlay?.data;
          if (!r || !map) return;
          if (chosen) { chosen.style.fillOpacity = 0.07; chosen.style.lineWidth = 1.5; }
          chosen = e.overlay as typeof chosen;
          if (chosen) { chosen.style.fillOpacity = 0.16; chosen.style.lineWidth = 2.5; }
          map.setRegionAnimated(regionView(mk, r), true);
        });
        // Names only while zoomed out; the «whole Kingdom» button only while zoomed in.
        const onRegion = () => {
          if (!map) return;
          const wide = map.region.span.latitudeDelta >= LABELS_HIDE_BELOW_SPAN;
          labels.forEach((a) => { a.visible = wide; });
          setZoomed(map.region.span.latitudeDelta < KSA_SPAN.latitudeDelta * 0.8);
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
    if (mk && mapRef.current) mapRef.current.setRegionAnimated(ksaRegion(mk), true);
  };

  return (
    <View style={s.frame}>
      <View ref={hostRef} style={s.host} />
      {zoomed && !failed ? (
        <Pressable style={s.wholeBtn} onPress={showWholeKingdom} accessibilityRole="button" accessibilityLabel={t('Whole Kingdom')}>
          <Text style={s.wholeT}>{t('Whole Kingdom')}</Text>
        </Pressable>
      ) : null}
      {failed ? <View style={s.failed} pointerEvents="none"><Text style={s.failedT}>{t('The map could not load')}</Text></View> : null}
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
  failed: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  failedT: { fontFamily: font.family.medium, fontSize: 14, color: colors.muted },
});
