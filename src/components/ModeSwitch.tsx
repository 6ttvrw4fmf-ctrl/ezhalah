// ModeSwitch — the top-nav segmented pill that shows BOTH search modes at once:
//   [ تصفية ▽ | المساعد الذكي ✦ ]
// One shared component owns 100% of this control's design (same philosophy as the Advanced Filter
// Design Contract): the two screens (home = filter, /agent = AI) just mount it with `active` and a
// navigation callback. It replaces the old swap-badge pair (home's breathing "Ezhalah AI Agent"
// badge / agent's small "تصفية" text button), which showed only the OTHER mode — users had to
// already know two modes existed. Now both are always visible, and the raised white indicator says
// where you are. (owner redesign request 2026-07-24; reference = prototype ezhalah-mobile.jsx
// m-agent-mini evolved into a proper two-tab control.)
//
// Design language: tokens only — tint track + tintLine hairline, raised white indicator with the
// soft green card shadow, primary-green icons. Compact height, no subtitles: premium and minimal.
//
// Motion (deliberately subtle):
//   • The white indicator SLIDES between halves with a quick, softly-damped spring.
//   • Cross-screen continuity: the control sits at the same top-bar spot on both screens, and a
//     module-level `lastMode` remembers where the indicator was when you tapped — the arriving
//     screen's pill animates the indicator FROM that side into place, so navigation reads as one
//     continuous control, not two separate headers. Fresh loads start settled (no animation).
//   • The unselected AI sparkle keeps an extremely gentle twinkle — the old badge's "come try the
//     AI" draw, turned way down. JS driver on web (native driver only off-web), same as the rest
//     of the codebase.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, cardShadow } from '@/theme/tokens';

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

const SEG_W = 98; // each half; sized so [☰ إزهله][pill][share] fits a 375pt row (≈205pt available)
const PAD = 3;     // track inner padding — the indicator floats inside the hairline

export default function ModeSwitch({
  active,
  onSwitch,
  t,
}: {
  active: SearchMode;
  /** Called when the OTHER mode is tapped — the screen navigates; the pill handles the motion. */
  onSwitch: (to: SearchMode) => void;
  t: (s: string) => string;
}) {
  const toX = active === 'filter' ? 0 : SEG_W;
  // Start from where the user left the indicator on the previous screen (cross-screen slide);
  // settled if this is a fresh load or we're already there.
  const from = lastMode && lastMode !== active ? (lastMode === 'filter' ? 0 : SEG_W) : toX;
  const x = useRef(new Animated.Value(from)).current;
  useEffect(() => {
    lastMode = active;
    if (from === toX) return;
    const anim = Animated.spring(x, { toValue: toX, stiffness: 260, damping: 26, mass: 0.7, useNativeDriver: !IS_WEB });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The old badge's attention-draw, turned way down: the unselected sparkle drifts 0.55→1 opacity.
  const twinkle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (active === 'agent') return; // selected AI needs no draw
    const half = (v: number) =>
      Animated.timing(twinkle, { toValue: v, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: !IS_WEB });
    const loop = Animated.loop(Animated.sequence([half(1), half(0)]));
    loop.start();
    return () => loop.stop();
  }, [twinkle, active]);
  const sparkleOpacity = active === 'agent' ? 1 : twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  const press = (to: SearchMode) => {
    if (to === active) return;
    // Begin the slide immediately so the tap answers instantly, then let the screen navigate; the
    // destination pill picks the motion up from `lastMode` and settles it.
    Animated.spring(x, { toValue: to === 'filter' ? 0 : SEG_W, stiffness: 260, damping: 26, mass: 0.7, useNativeDriver: !IS_WEB }).start();
    onSwitch(to);
  };

  const Seg = ({
    mode, icon, label, iconNode,
  }: { mode: SearchMode; icon?: any; label: string; iconNode?: React.ReactNode }) => {
    const on = active === mode;
    return (
      <Pressable
        style={s.seg}
        onPress={() => press(mode)}
        hitSlop={6}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
      >
        {iconNode ?? <Ionicons name={icon} size={13} color={on ? colors.primary : colors.muted} />}
        <Text style={[s.segT, on ? s.segTOn : null]} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View ref={setLtr} style={s.track} accessibilityRole="tablist">
      <Animated.View style={[s.indicator, { transform: [{ translateX: x }] }]} />
      <Seg mode="filter" icon="funnel-outline" label={t('Filter')} />
      <Seg
        mode="agent"
        label={t('Smart Assistant')}
        iconNode={
          <Animated.View style={{ opacity: sparkleOpacity }}>
            <Ionicons name="sparkles" size={13} color={colors.primary} />
          </Animated.View>
        }
      />
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
    borderRadius: 999,
    padding: PAD,
    height: 40,
  },
  indicator: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    width: SEG_W,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.tintLine,
    ...cardShadow,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  seg: {
    width: SEG_W,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 999,
  },
  segT: { fontSize: 11.5, fontWeight: '600', color: colors.body },
  segTOn: { fontWeight: '800', color: colors.ink },
});
