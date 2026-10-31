// /map — the THIRD way to search (owner 2026-10-30: «just add the button, that's the first goal»).
//
// This screen exists so the new «خريطة» tab in the ModeSwitch pill has somewhere to land. It mounts the
// SAME pill at the same spot as the Filter home and the Smart Broker screen (so the indicator glides
// into its third slot), and says the map is on its way. The map itself — price pins, the list beside it,
// draw-an-area — is planned separately and lands here when it is built.
//
// Navigation is a peer toggle, exactly like the other two halves: REPLACE, never push, so switching
// between the three modes costs no history entries (scripts/verify-mode-switch-costs-no-history.ts).
import { useRef, useState } from 'react';
import { Animated as RNAnimated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ModeSwitch from '@/components/ModeSwitch';
import AppleMap from '@/components/AppleMap';
import MapDealRow, { MapSearchBar } from '@/components/MapDealRow';
import HeroBackground from '@/components/HeroBackground';
import HomeWebsiteStrip from '@/components/HomeWebsiteStrip';
import ShareSheet from '@/components/ShareSheet';
import TopBarLanguage from '@/components/TopBarLanguage';
import { colors, radius, cardShadow } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';
import { useI18n } from '@/i18n';
import { useApp } from '@/store';
import { shareNative } from '@/lib/share';
import { useAtLeast } from '@/lib/useAtLeast';
import { SHARE_LABEL_BREAKPOINT } from '@/lib/responsive';
import Sidebar, { useDocked } from '@/components/Sidebar';
import { noTranslateRef } from '@/noTranslate';

// Pinned left-to-right like Home's top bar (src/app/index.tsx setLtr): «مشاركة» on the physical RIGHT, the
// sign-in pill to its left, in both languages (owner 2026-10-31: «share and the sign up are on the opposite
// side, flip it»).
const setLtr = (node: any) => {
  if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('dir', 'ltr');
};

export default function MapRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, openAuth, authChecked } = useApp();
  const docked = useDocked();
  const topBarRoomy = useAtLeast(SHARE_LABEL_BREAKPOINT);
  const [shareOpen, setShareOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Full-screen map (owner 2026-10-31: «when the user clicks on the map take him inside the map»): a tap on the
  // compact box lifts the SAME map over the whole screen (no remount: the map, its zoom and any drawing stay);
  // its X brings the page back.
  const [full, setFull] = useState(false);
  const shareScale = useRef(new RNAnimated.Value(1)).current;
  const shareSpring = (toValue: number) =>
    RNAnimated.spring(shareScale, { toValue, useNativeDriver: false, speed: 40, bounciness: 6 }).start();
  const onShare = async () => {
    const shared = await shareNative();
    if (!shared) setShareOpen(true);
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 12 }]}>
      {/* The same sky and website strip as the Filter home and the Smart Broker landing, above the pill
          (owner 2026-10-31: «include this cloud thing on top, above it»). */}
      <HeroBackground />
      {/* The top-right of the Filter home, same controls, same rules (owner 2026-10-31: «add on the top right the
          sign up / log in for a user not signed in, with a share button»): the sign-in pill only for a guest and
          only once the session is known (never for a signed-in user, not even for a moment — owner 2026-10-18),
          and «مشاركة» always labelled. */}
      <View ref={setLtr} style={s.top}>
        {/* Mobile: the hamburger + brand on the physical LEFT, opening the same Sidebar drawer as Home (owner
            2026-10-31: «this side thing must show, that's important»). On desktop the docked sidebar is mounted
            by the app layout, so nothing here. */}
        {!docked ? (
          <View style={s.topLeft}>
            <Pressable
              style={s.hamb}
              hitSlop={8}
              // @ts-expect-error web-only DOM props on the RNW host node
              dataSet={{ ...TAP44, consentKeep: '1' }}
              onPress={() => setSidebarOpen(true)}
            >
              <Ionicons name="menu" size={22} color={colors.ink} />
            </Pressable>
            <Text ref={noTranslateRef} style={s.topBrand}>{t('Ezhalah')}</Text>
          </View>
        ) : null}
        <View style={s.topRight}>
          {authChecked && !user && !docked && (
            <Pressable
              style={s.topSignIn}
              onPress={openAuth}
              hitSlop={6}
              // @ts-expect-error web-only DOM props on the RNW host node
              dataSet={{ ...TAP44 }}
            >
              <Ionicons name="person-outline" size={15} color="#fff" />
              <Text style={s.topSignInText}>{t(topBarRoomy ? 'Sign up / Log in' : 'Sign in')}</Text>
            </Pressable>
          )}
          {/* Language for a guest — between sign-in and share, all three screens (owner 2026-10-31). */}
          <TopBarLanguage />
          <Pressable
            style={({ pressed, hovered }: any) => [s.shareBtn, hovered && s.shareBtnHover, pressed && s.shareBtnPressed]}
            hitSlop={8}
            onPress={onShare}
            onPressIn={() => shareSpring(0.94)}
            onPressOut={() => shareSpring(1)}
            accessibilityRole="button"
            accessibilityLabel={t('Share')}
          >
            <RNAnimated.View style={[s.shareInner, { transform: [{ scale: shareScale }] }]}>
              <Ionicons name="share-social-outline" size={17} color={colors.primary} />
              <Text style={s.shareBtnText}>{t('Share')}</Text>
            </RNAnimated.View>
          </Pressable>
        </View>
      </View>
      <View style={s.strip}><HomeWebsiteStrip /></View>
      <View style={s.modeWrap}>
        <ModeSwitch active="map" onSwitch={(to) => router.replace(to === 'filter' ? '/' : '/agent')} t={t} />
      </View>
      {/* Transaction + filter row above the map (owner 2026-10-31, Zillow's «For sale ▾ | Filters», Ezhalah-themed). */}
      <View style={s.dealWrap}><MapSearchBar /><MapDealRow /></View>
      <View style={full ? [s.bodyFull, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 8) }] : [s.body, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <AppleMap full={full} onTap={full ? undefined : () => setFull(true)} onClose={full ? () => setFull(false) : undefined} />
      </View>
      {sidebarOpen && <Sidebar onClose={() => setSidebarOpen(false)} />}
      {shareOpen && <ShareSheet onClose={() => setShareOpen(false)} />}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, zIndex: 2 },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hamb: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  topBrand: { fontSize: 22, fontWeight: '800', color: colors.ink }, // same size as الوسيط الذكي's title (owner 2026-10-31: «ezhalah must all be the same size, big»)
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginStart: 'auto' },
  topSignIn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.selFill, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 13, marginRight: 8 },
  topSignInText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  shareBtn: { minWidth: 46, paddingHorizontal: 15, height: 46, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine, ...cardShadow, shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  shareBtnPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  shareBtnHover: { backgroundColor: colors.tintFill, borderColor: colors.primary },
  shareInner: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  shareBtnText: { fontSize: 13.5, fontWeight: '700', color: colors.primary, includeFontPadding: false },
  strip: { marginHorizontal: -10, zIndex: 1 },
  modeWrap: { alignSelf: 'center', marginTop: 8, zIndex: 1 },
  dealWrap: { zIndex: 1 },
  body: { flex: 1, marginTop: 6, zIndex: 1 }, // tight under the row (owner 2026-10-31: «eliminate those extra spaces»)
  bodyFull: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: colors.paper, paddingHorizontal: 8 },
});
