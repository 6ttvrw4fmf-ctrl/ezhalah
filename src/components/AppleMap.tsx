// AppleMap (native) — no shipped native app (src/theme/tokens.ts), and MapKit JS is web-only. The web build resolves
// AppleMap.web.tsx instead; this file only keeps the import valid on iOS/Android.
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

export type PlaceSuggestion = { displayLines: string[]; coordinate?: { latitude: number; longitude: number } };
export async function suggestPlaces(_q: string, _language: string): Promise<PlaceSuggestion[]> { return []; }
export function flyToPlace(_p: PlaceSuggestion) {}
export function clearPlaceMark() {}

export default function AppleMap(_: { full?: boolean; onExpand?: () => void; onClose?: () => void }) {
  return <View style={s.frame} />;
}

const s = StyleSheet.create({
  frame: { flex: 1, borderRadius: 16, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine },
});
