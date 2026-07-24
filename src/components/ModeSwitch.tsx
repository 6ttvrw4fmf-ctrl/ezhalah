// ModeSwitch — the top-nav control that presents Ezhalah's TWO ways to search as one premium,
// compact segmented control:
//   [ ⚟ تصفية | ✦ المساعد الذكي ]
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
//   • The two sides are deliberately asymmetric in feeling: تصفية is utilitarian (funnel goes brand-
//     green only when active), while المساعد الذكي is quietly ALIVE — its sparkle always carries the
//     brighter «leaf» accent and, when that side is NOT selected, breathes softly (scale + opacity)
//     to invite conversation without ever being flashy.
//   • Cross-screen continuity: the control sits at the same top-bar spot on both screens, and a
//     module-level `lastMode` remembers where the indicator was when you tapped — the arriving
//     screen's control animates the indicator FROM that side into place, so navigation reads as one
//     continuous control, not two separate headers. Fresh loads start settled (no animation).
// JS driver on web (native driver only off-web), same as the rest of the codebase. Tokens only.
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, cardShadow, font, radius } from '@/theme/tokens';

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
  const toX = active === 'filter' ? 0 : SEG_W;
  // Start from where the user left the indicator on the previous screen (cross-screen glide);
  // settled if this is a fresh load or we're already there.
  const from = lastMode && lastMode !== active ? (lastMode === 'filter' ? 0 : SEG_W) : toX;
  const x = useRef(new Animated.Value(from)).current;
  useEffect(() => {
    lastMode = active;
    if (from === toX) return;
    const anim = Animated.spring(x, { toValue: toX, ...GLIDE, useNativeDriver: !IS_WEB });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The AI side is quietly "alive": when it is NOT the selected mode, its sparkle breathes — a soft,
  // slow scale+opacity swell that reads as "come talk to me" without any flash. Selected AI is calm
  // and steady (no need to draw attention to where you already are).
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (active === 'agent') return;
    const half = (v: number) =>
      Animated.timing(breath, { toValue: v, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: !IS_WEB });
    const loop = Animated.loop(Animated.sequence([half(1), half(0)]));
    loop.start();
    return () => loop.stop();
  }, [breath, active]);
  const aiSteady = active === 'agent';
  const sparkleOpacity = aiSteady ? 1 : breath.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const sparkleScale = aiSteady ? 1 : breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });

  const press = (to: SearchMode) => {
    if (to === active) return;
    // Begin the glide immediately so the tap answers instantly, then let the screen navigate; the
    // destination control picks the motion up from `lastMode` and settles it.
    Animated.spring(x, { toValue: to === 'filter' ? 0 : SEG_W, ...GLIDE, useNativeDriver: !IS_WEB }).start();
    onSwitch(to);
  };

  return (
    <View ref={setLtr} style={s.track} accessibilityRole="tablist">
      <Animated.View style={[s.indicator, { transform: [{ translateX: x }] }]} />

      {/* تصفية — utilitarian: the funnel goes brand-green only when this side is active. */}
      <Pressable
        style={s.seg}
        onPress={() => press('filter')}
        hitSlop={6}
        accessibilityRole="tab"
        accessibilityState={{ selected: active === 'filter' }}
        accessibilityLabel={t('Filter')}
      >
        <Ionicons name="funnel-outline" size={17} color={active === 'filter' ? colors.primary : colors.muted} />
        <Text style={[s.segT, active === 'filter' ? s.segTOn : null]} numberOfLines={1}>{t('Filter')}</Text>
      </Pressable>

      {/* المساعد الذكي — the "alive" side: its sparkle always carries the brighter leaf accent and
          breathes when unselected, subtly suggesting conversation. */}
      <Pressable
        style={s.seg}
        onPress={() => press('agent')}
        hitSlop={6}
        accessibilityRole="tab"
        accessibilityState={{ selected: aiSteady }}
        accessibilityLabel={t('Smart Assistant')}
      >
        <Animated.View style={{ opacity: sparkleOpacity, transform: [{ scale: sparkleScale }] }}>
          <Ionicons name="sparkles" size={17} color={colors.accentLeaf} />
        </Animated.View>
        <Text style={[s.segT, aiSteady ? s.segTOn : null]} numberOfLines={1}>{t('Smart Assistant')}</Text>
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
