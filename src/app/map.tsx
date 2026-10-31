// /map — the THIRD way to search (owner 2026-10-30: «just add the button, that's the first goal»).
//
// This screen exists so the new «خريطة» tab in the ModeSwitch pill has somewhere to land. It mounts the
// SAME pill at the same spot as the Filter home and the Smart Broker screen (so the indicator glides
// into its third slot), and says the map is on its way. The map itself — price pins, the list beside it,
// draw-an-area — is planned separately and lands here when it is built.
//
// Navigation is a peer toggle, exactly like the other two halves: REPLACE, never push, so switching
// between the three modes costs no history entries (scripts/verify-mode-switch-costs-no-history.ts).
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import ModeSwitch from '@/components/ModeSwitch';
import { colors, font, space } from '@/theme/tokens';
import { useI18n } from '@/i18n';

export default function MapRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <View style={[s.screen, { paddingTop: insets.top + 12 }]}>
      <View style={s.modeWrap}>
        <ModeSwitch active="map" onSwitch={(to) => router.replace(to === 'filter' ? '/' : '/agent')} t={t} />
      </View>
      <View style={s.body}>
        <Ionicons name="map-outline" size={40} color={colors.primary} />
        <Text style={s.title}>{t('Map search is coming soon')}</Text>
        <Text style={s.sub}>{t('Browse listings on a map of Saudi Arabia, with prices on every pin.')}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: space.screenSide },
  modeWrap: { alignSelf: 'center', marginTop: 8 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 80 },
  title: { fontFamily: font.family.bold, fontSize: 18, color: colors.ink, textAlign: 'center' },
  sub: { fontFamily: font.family.medium, fontSize: 13.5, color: colors.muted, textAlign: 'center', maxWidth: 320, lineHeight: 20 },
});
