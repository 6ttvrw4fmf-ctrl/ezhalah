// AppleMap (native) — no shipped native app (src/theme/tokens.ts), and MapKit JS is web-only. The web build resolves
// AppleMap.web.tsx instead; this file only keeps the import valid on iOS/Android.
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

export default function AppleMap(_: { full?: boolean; onTap?: () => void; onClose?: () => void }) {
  return <View style={s.frame} />;
}

const s = StyleSheet.create({
  frame: { flex: 1, borderRadius: 16, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine },
});
