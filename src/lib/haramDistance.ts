// How far a short stay is from the Haram (owner 2026-11-05: «Yes, build it» — Gathern + Aqar Monthly).
//
// Straight-line (haversine) distance from the SOURCE's own map pin — Gathern / Aqar Monthly carry it in
// additional_info.latitude / longitude — to Masjid al-Haram (Makkah) or al-Masjid an-Nabawi (Madinah). It is shown
// as an approximation («≈ 1.2 كم من الحرم»), never as a walking time: a street route is longer than a straight
// line and we do not know it. A pin more than 40 km from either is not in Makkah or Madinah (or is a bad pin) and
// shows nothing. Measured 2026-11-05: 1,597 short stays in the two cities, nearest 663 m, ~240 within 3 km.
export type Haram = 'makkah' | 'madinah';

export const HARAMS: Record<Haram, { lat: number; lng: number }> = {
  makkah: { lat: 21.422487, lng: 39.826206 },   // the Kaaba, Masjid al-Haram
  madinah: { lat: 24.467228, lng: 39.61114 },   // al-Masjid an-Nabawi
};
export const HARAM_MAX_M = 40_000;

export type HaramDistance = { haram: Haram; meters: number };

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The nearest Haram within 40 km of the pin, or null (no pin, a 0/0 pin, or not in Makkah / Madinah). */
export function haramDistance(lat: unknown, lng: unknown): HaramDistance | null {
  const la = typeof lat === 'string' ? Number(lat) : (lat as number);
  const lo = typeof lng === 'string' ? Number(lng) : (lng as number);
  if (typeof la !== 'number' || typeof lo !== 'number' || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la === 0 || lo === 0 || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  let best: HaramDistance | null = null;
  for (const k of Object.keys(HARAMS) as Haram[]) {
    const m = haversineM({ lat: la, lng: lo }, HARAMS[k]);
    if (m <= HARAM_MAX_M && (!best || m < best.meters)) best = { haram: k, meters: Math.round(m) };
  }
  return best;
}

/** «650 م» / «1.2 كم» / «12 كم» (en: «650 m» / «1.2 km») — under 1 km to the nearest 50 m, under 10 km to 0.1 km. */
export function haramDistanceText(meters: number, locale: 'ar' | 'en'): string {
  const m = Math.max(0, meters);
  if (m < 1000) {
    const r = Math.max(50, Math.round(m / 50) * 50);
    return locale === 'ar' ? `${r} م` : `${r} m`;
  }
  const km = m < 10_000 ? (Math.round(m / 100) / 10).toFixed(1) : String(Math.round(m / 1000));
  return locale === 'ar' ? `${km} كم` : `${km} km`;
}
