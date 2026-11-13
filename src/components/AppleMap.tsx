// AppleMap (native) — no shipped native app (src/theme/tokens.ts), and MapKit JS is web-only. The web build resolves
import type { PinRow } from '@/lib/mapPins';
// AppleMap.web.tsx instead; this file only keeps the import valid on iOS/Android.
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

import type { PlaceKind } from '@/lib/placeKind';
export type PlaceSuggestion = { displayLines: string[]; coordinate?: { latitude: number; longitude: number }; kind?: PlaceKind; subtitle?: string; name?: string; locality?: string; apple?: unknown };
export async function suggestPlaces(_q: string, _language: string): Promise<PlaceSuggestion[]> { return []; }
// No map search outside the web build: an honest «could not search», never «no places».
export async function suggestPlacesResult(_q: string, _language: string): Promise<{ rows: PlaceSuggestion[]; failed: boolean }> { return { rows: [], failed: true }; }
export function flyToPlace(_p: PlaceSuggestion) {}
export function clearPlaceMark() {}
export async function routeBetween(_a: PlaceSuggestion, _b: PlaceSuggestion): Promise<boolean> { return false; }
export function clearRoute() {}

export default function AppleMap(_: { full?: boolean; onExpand?: () => void; onClose?: () => void; onRoute?: () => void; pins?: unknown; onPinSelect?: (row: PinRow) => void }) {
  return <View style={s.frame} />;
}

const s = StyleSheet.create({
  frame: { flex: 1, borderRadius: 16, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine },
});
export async function countPinsInView(_f: unknown): Promise<number | null> { return null; }
export async function countPostedWindowsInView(_f: unknown): Promise<Record<string, number> | null> { return null; }
export function prewarmMap(): void {}
