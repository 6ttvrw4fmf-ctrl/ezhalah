// «PLEASE TURN OFF YOUR VPN» (owner 2026-10-21: «aqar and those websites also don't work with VPN»).
// When the network guard refuses a visitor on a VPN, Tor or server network (robot_gate, migration 20261021224031),
// src/lib/supabase.ts fires NETWORK_BLOCKED_EVENT and this card explains it once, instead of the search looking empty
// or broken. Web only (the guard sits behind the web front door). Mounted at the root in src/app/_layout.tsx.
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme/tokens';
import { NETWORK_BLOCKED_EVENT } from '@/lib/supabase';

export default function NetworkBlockedNotice() {
  const { t, isRTL } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const show = () => setOpen(true);
    window.addEventListener(NETWORK_BLOCKED_EVENT, show);
    return () => window.removeEventListener(NETWORK_BLOCKED_EVENT, show);
  }, []);
  if (!open) return null;
  const align = { textAlign: (isRTL ? 'right' : 'left') as 'right' | 'left' };
  return (
    <View style={s.backdrop} accessibilityRole="alert" testID="network-blocked-notice">
      <View style={s.card}>
        <Text style={[s.title, align]}>{t('Please turn off your VPN')}</Text>
        <Text style={[s.body, align]}>{t('Ezhalah is not available over VPN, Tor or server networks. Turn off your VPN and try again.')}</Text>
        <Pressable onPress={() => setOpen(false)} style={s.button} accessibilityRole="button">
          <Text style={s.buttonText}>{t('Try again')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', padding: 16 },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.card, padding: 22, gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  body: { fontSize: 15, lineHeight: 22, color: colors.muted },
  button: { marginTop: 6, alignSelf: 'stretch', backgroundColor: colors.selFill, borderRadius: radius.field, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.onFill, fontSize: 15, fontWeight: '700' },
});
