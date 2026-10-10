// ModeSwitch — the top-nav control that presents Ezhalah's TWO ways to search as one premium,
// compact segmented control:
//   [ ⚟ تصفية | 💬 الوسيط الذكي ]  (English: Filter | Smart Broker)
// One shared component owns 100% of this control's design (same philosophy as the Advanced Filter
// Design Contract): the two screens (home = filter, /agent = AI) just mount it with `active` and a
// navigation callback.
//
// Design intent (owner redesign 2026-07-24, round 2 — "Apple / Linear / Perplexity, calm & premium"):
// this is NOT a settings toggle — it must read at a glance as two DIFFERENT experiences. It stays a
// single compact control (no cards, no captions), but earns that read through craft:
//   • Generous size + spacing: 46-tall track, larger 17px icons, an 8px icon↔label gap, 13.5px type.
//   • A luxurious raised-white active indicator (soft green-tinted shadow) that GLIDES between halves
//     on a gentle, slightly-overshooting spring — never a hard switch.
//   • The two sides are a matched pair: each has one thin outline icon (funnel / chat bubble) that turns
//     brand-green when its side is active. (Owner 2026-10-09: the breathing green sparkle «doesn't look
//     professional enough» — replaced by the plain outline sibling of the funnel, in both languages.)
//   • Cross-screen continuity: the control sits at the same top-bar spot on both screens, and a
//     module-level `lastMode` remembers where the indicator was when you tapped — the arriving
//     screen's control animates the indicator FROM that side into place, so navigation reads as one
//     continuous control, not two separate headers. Fresh loads start settled (no animation).
// JS driver on web (native driver only off-web), same as the rest of the codebase. Tokens only.
import { useCallback, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, cardShadow, font, radius } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';
import { useI18n } from '@/i18n';

const IS_WEB = Platform.OS === 'web';

export type SearchMode = 'filter' | 'agent';

// Where the indicator last was, across route changes (module state survives SPA navigation on web
// and screen swaps on native). Lets the destination screen slide the indicator in from the side the
// user just left. null = fresh load → render settled, no entrance animation.
let lastMode: SearchMode | null = null;

// Fixed LTR visual order, matching the approved mock: تصفية on the left, المساعد الذكي on the right.
// The top bars that host this control are already LTR-pinned on both screens; we pin the control
// itself too so the halves never mirror under the Arabic locale (labels themselves render RTL fine).
const setLtr = (node: any) => {
  if (IS_WEB && node?.setAttribute) node.setAttribute('dir', 'ltr');
};

const SEG_W = 106;   // each half — wider than the old 98 for a more generous, premium footprint
const SEG_W_EN = 116; // English: «Smart Broker» is wider than «الوسيط الذكي» and must not truncate
// Poppins is not loaded on the web, so its English glyphs fell back to a serif. English labels use the same system
// stack as the rest of the page there; Arabic keeps what it has (owner: «the Arabic is perfect»).
const SYSTEM_FONT = IS_WEB ? 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif' : undefined;
const PAD = 4;       // track inner padding — the indicator floats inside the hairline
const H = 46;        // track height (was 40) — compact but no longer a tiny iOS toggle

// Premium glide: a gentle, slightly-overshooting spring so the indicator GLIDES rather than snaps.
const GLIDE = { stiffness: 190, damping: 22, mass: 0.9 } as const;

export default function ModeSwitch({
  active,
  onSwitch,
  t,
}: {
  active: SearchMode;
  /** Called when the OTHER mode is tapped — the screen navigates; the control handles the motion. */
  onSwitch: (to: SearchMode) => void;
  t: (s: string) => string;
}) {
  const en = useI18n().locale === 'en';
  const segW = en ? SEG_W_EN : SEG_W;
  const toX = active === 'filter' ? 0 : segW;
  // Start from where the user left the indicator on the previous screen (cross-screen glide);
  // settled if this is a fresh load or we're already there.
  const from = lastMode && lastMode !== active ? (lastMode === 'filter' ? 0 : segW) : toX;
  const x = useRef(new Animated.Value(from)).current;
  // The indicator settles on `active` EVERY TIME this control is the one on screen — not just on
  // mount. `active` is the committed truth (which screen you are actually on); the animated value is
  // only a picture of it and must always be made to agree.
  //
  // Mount-only was a real bug (2026-08-23): `press()` below optimistically glides the indicator to
  // the tab you are navigating TO, but the screen you are leaving normally STAYS MOUNTED in the
  // stack. Tap «المساعد الذكي», then press browser Back: the Filter screen comes back with its
  // indicator parked over «المساعد الذكي», and it can never recover — `press` early-returns for the
  // already-active tab, so tapping «تصفية» does nothing. Re-settling on focus is also what plays the
  // cross-screen entrance glide from `lastMode`, so this one effect owns the whole motion.
  useFocusEffect(
    useCallback(() => {
      lastMode = active;
      const anim = Animated.spring(x, { toValue: toX, ...GLIDE, useNativeDriver: !IS_WEB });
      anim.start();
      return () => anim.stop();
    }, [active, toX, x]),
  );

  const aiSteady = active === 'agent';

  const press = (to: SearchMode) => {
    if (to === active) return;
    // Begin the glide immediately so the tap answers instantly, then let the screen navigate; the
    // destination control picks the motion up from `lastMode` and settles it.
    Animated.spring(x, { toValue: to === 'filter' ? 0 : segW, ...GLIDE, useNativeDriver: !IS_WEB }).start();
    onSwitch(to);
  };

  return (
    <View ref={setLtr} style={s.track} accessibilityRole="tablist">
      <Animated.View style={[s.indicator, { width: segW, transform: [{ translateX: x }] }]} />

      {/* تصفية — utilitarian: the funnel goes brand-green only when this side is active. */}
      <Pressable
        style={[s.seg, { width: segW }]}
        onPress={() => press('filter')}
        hitSlop={6}
        // These two tabs TOUCH (gapX = 0, measured on production), which is exactly why
        // TAP_TARGET_CSS uses min-width rather than width: at 106px wide the horizontal floor is
        // inert here and only the short 36px axis grows, so neither tab can take the other's
        // edge presses (ops_incident #17).
        // @ts-expect-error web-only DOM props on the RNW host node
        dataSet={{ ...TAP44 }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active === 'filter' }}
        accessibilityLabel={t('Filter')}
      >
        <Ionicons name="funnel-outline" size={17} color={active === 'filter' ? colors.primary : colors.muted} />
        <Text style={[s.segT, active === 'filter' ? s.segTOn : null, en && { fontFamily: SYSTEM_FONT, fontWeight: active === 'filter' ? '600' : '500' }]} numberOfLines={1}>{t('Filter')}</Text>
      </Pressable>

      {/* الوسيط الذكي / Smart Broker — the chat side: a thin outline bubble, the funnel's sibling. */}
      <Pressable
        style={[s.seg, { width: segW }]}
        onPress={() => press('agent')}
        hitSlop={6}
        // @ts-expect-error web-only DOM props on the RNW host node
        dataSet={{ ...TAP44 }}
        accessibilityRole="tab"
        accessibilityState={{ selected: aiSteady }}
        accessibilityLabel={t('Smart Assistant')}
      >
        <Ionicons name="chatbubble-outline" size={17} color={aiSteady ? colors.primary : colors.muted} />
        <Text style={[s.segT, aiSteady ? s.segTOn : null, en && { fontFamily: SYSTEM_FONT, fontWeight: aiSteady ? '600' : '500' }]} numberOfLines={1}>{t('Smart Assistant')}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderColor: colors.tintLine,
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: PAD,
    height: H,
  },
  // Luxurious raised indicator: white surface, hairline tint border, and a soft green-tinted shadow
  // (the codebase's cardShadow, softened) so the active half feels lifted off the track.
  indicator: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    width: SEG_W,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.tintLine,
    ...cardShadow,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  seg: {
    width: SEG_W,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8, // generous icon↔label breathing room (was 4)
    borderRadius: radius.pill,
  },
  segT: { fontFamily: font.family.medium, fontSize: 13.5, color: colors.body },
  segTOn: { fontFamily: font.family.bold, color: colors.ink },
});
