// «PLEASE TURN OFF YOUR VPN» (owner 2026-10-21: «aqar and those websites also don't work with VPN»).
// When the network guard refuses a visitor on a VPN, Tor or server network (robot_gate, migration 20261021224031),
// src/lib/supabase.ts fires NETWORK_BLOCKED_EVENT — the home page's own first reads already do, so it shows on open.
// A FULL BLOCK, NOT A CARD (owner 2026-11-13: «vpn detected blue screen behind user has to close vpn to continue»): the
// whole page is covered by a plain blue screen, there is no ✕ and no way past it; the one button reloads the page,
// so with the VPN still on the block simply comes back. A plain solid blue screen (owner 2026-11-13: «keep it plain blue»). Web only (the guard sits behind the web front door).
// Mounted at the root in src/app/_layout.tsx. Guard: scripts/verify-network-block.ts.
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { radius } from '@/theme/tokens';
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
  // The only way on: reload. A VPN still switched on is refused again and this screen returns.
  const retry = () => { if (typeof window !== 'undefined') window.location.reload(); };
  const align = { textAlign: 'center' as const };
  return (
    <View style={s.screen} accessibilityRole="alert" accessibilityViewIsModal testID="network-blocked-notice">
      <View style={s.inner}>
        <Text style={[s.title, align]}>{t('Please turn off your VPN')}</Text>
        <Text style={[s.body, align, isRTL && { writingDirection: 'rtl' }]}>{t('Ezhalah cannot be used while a VPN is on. Turn off the VPN, then try again.')}</Text>
        <Pressable onPress={retry} style={s.button} accessibilityRole="button" testID="network-blocked-retry">
          <Text style={s.buttonText}>{t('Try again')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const BLUE = '#1f3a8a';
const s = StyleSheet.create({
  // ONE PLAIN BLUE SCREEN over everything (owner 2026-11-13: «keep it plain blue, don't let it look vibe coded»): solid
  // colour, no blur, no card, no icon. fixed (not absolute) so a scrolled page is covered too.
  screen: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 99999,
    alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: BLUE,
  },
  inner: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#ffffff' },
  body: { fontSize: 16, lineHeight: 24, color: '#dbe4ff' },
  button: { marginTop: 12, minWidth: 180, backgroundColor: '#ffffff', borderRadius: radius.field, paddingVertical: 12, paddingHorizontal: 28, alignItems: 'center' },
  buttonText: { color: BLUE, fontSize: 16, fontWeight: '700' },
});
