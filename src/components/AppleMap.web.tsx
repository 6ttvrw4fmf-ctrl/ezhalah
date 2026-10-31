// AppleMap (web) — the «خريطة» tab's map: Apple Maps (MapKit JS) over Saudi Arabia. Owner 2026-10-30: «start first
// by putting the map only — don't put the pins or anything». So this is the map and nothing on it; pins, the list
// beside it and draw-an-area come later, one at a time.
//
// ALWAYS FAST: MapKit JS is Apple's own ~200 KB script, loaded from Apple's CDN only when this component mounts
// (i.e. only when someone opens the Map tab) — nothing is added to the entry bundle. The token comes from
// /api/mapkit-token (the private key stays on the server); MapKit asks for a fresh one itself when it expires.
//
// Failure is shown, never faked: a script that doesn't load, a token the server can't mint, or a map Apple refuses
// → «تعذّر تحميل الخريطة» in the same box, not an empty beige rectangle (A FAILED FETCH IS NOT AN EMPTY ANSWER).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '@/theme/tokens';
import { useI18n } from '@/i18n';

const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
const TOKEN_URL = '/api/mapkit-token';
const TOKEN_TIMEOUT_MS = 8000;

// The Kingdom, whole, on first open: centre near Riyadh's longitude / the country's middle latitude, span wide enough
// for Tabuk to Jazan and Jeddah to Dammam at once. Later steps zoom to the user's search.
const KSA_CENTER = { latitude: 24.0, longitude: 45.0 };
const KSA_SPAN = { latitudeDelta: 16, longitudeDelta: 18 };

type MapKit = {
  init: (o: { authorizationCallback: (done: (token: string) => void) => void; language?: string }) => void;
  Map: new (el: HTMLElement, o?: object) => { destroy: () => void; region: unknown };
  Coordinate: new (lat: number, lng: number) => unknown;
  CoordinateSpan: new (lat: number, lng: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
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
  const r = await fetch(TOKEN_URL, { signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS), cache: 'no-store' });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = (await r.json()) as { token?: unknown };
  if (typeof j.token !== 'string' || !j.token) throw new Error('token missing');
  return j.token;
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

export default function AppleMap() {
  const { locale, t } = useI18n();
  const hostRef = useRef<View>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: { destroy: () => void } | null = null;
    let gone = false;
    const onError = (e: { status?: string }) => { if (e.status === 'Unauthorized' || e.status === 'Too Many Requests') setFailed(true); };
    loadMapKit().then((mk) => {
      if (gone) return;
      const el = hostRef.current as unknown as HTMLElement | null;
      if (!el) return;
      initOnce(mk, locale);
      mk.addEventListener('error', onError);
      map = new mk.Map(el, {
        region: new mk.CoordinateRegion(
          new mk.Coordinate(KSA_CENTER.latitude, KSA_CENTER.longitude),
          new mk.CoordinateSpan(KSA_SPAN.latitudeDelta, KSA_SPAN.longitudeDelta),
        ),
        showsMapTypeControl: false,
        showsPointsOfInterest: false,
      });
    }).catch(() => { if (!gone) setFailed(true); });
    return () => {
      gone = true;
      const mk = mapkitOf();
      if (mk) mk.removeEventListener('error', onError);
      map?.destroy();
    };
    // locale only affects init, which runs once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={s.frame}>
      <View ref={hostRef} style={s.host} />
      {failed ? <View style={s.failed} pointerEvents="none"><Text style={s.failedT}>{t('The map could not load')}</Text></View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine },
  host: { flex: 1 },
  failed: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  failedT: { fontFamily: font.family.medium, fontSize: 14, color: colors.muted },
});
