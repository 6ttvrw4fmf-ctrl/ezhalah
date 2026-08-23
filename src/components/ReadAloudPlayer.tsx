// Floating Read Aloud playback controller (owner 2026-08-22) — a ChatGPT-audio-popup-style compact
// pill, used as an INTERACTION reference only (not pixel-copied): tap استماع للرد → this pill appears
// → pause/resume/seek/close while the Arabic reading continues. Ezhalah-branded (soft white surface,
// a hint of the app's green only as an active-state accent, generous pill radius, soft low-opacity
// shadow) — never a full-screen modal, never blocks the result cards underneath.
//
// ONE instance, mounted once near the top of the results screen (src/app/agent.tsx) — not per
// FeedbackRow — because there is only ever one active reading session (src/lib/readAloud.ts's single
// shared sessionId), so one floating controller is the correct cardinality, not one per card/response.
// FeedbackRow's own 🔊/⏹ button is UNCHANGED (still just starts/stops); this is the richer transport
// that layers on top of that same session.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import {
  subscribeReadAloudPlayback, pauseReadAloud, resumeReadAloud, seekReadAloud,
  cycleReadAloudRate, stopReadAloud, type ReadAloudSnapshot,
} from '@/lib/readAloud';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { runAfterAnimation } from '@/lib/afterAnimation';

const SEEK_MS = 15000;
const ANIM_MS = 180; // owner spec: "around 150-200ms", no bounce/spring — a plain calm fade+scale.

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function ReadAloudPlayer() {
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  // `snap` holds the LAST known snapshot even while fading out, so the pill doesn't go blank for the
  // ~180ms it takes to disappear; `visible` alone drives the animation and eventual unmount.
  const [snap, setSnap] = useState<ReadAloudSnapshot | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribeReadAloudPlayback((s) => {
    if (s.state === 'idle') { setVisible(false); return; }
    setSnap(s);
    setVisible(true);
  }), []);

  useEffect(() => {
    const duration = reducedMotion ? 0 : ANIM_MS;
    if (visible) {
      // Appearing: purely decorative — nothing the user is waiting on depends on this finishing, so
      // a bare .start() (no callback) is fine on its own.
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      return;
    }
    // Disappearing: unmounting IS a hand-off the user is implicitly waiting on (closing the pill) —
    // it must never depend solely on the animation completing (rAF freezes in a backgrounded/
    // minimised tab; owner permanent rule, 2026-08-07 Search-navigation bug — see afterAnimation.ts).
    runAfterAnimation(
      (done) => Animated.timing(anim, { toValue: 0, duration, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(done),
      () => setMounted(false),
      duration + 50,
    );
  }, [visible, reducedMotion]);

  if (!mounted || !snap) return null;

  const playing = snap.state === 'playing';
  const onPlayPause = () => (playing ? pauseReadAloud() : resumeReadAloud());
  const onSeekBack = () => snap.canSeekBack && seekReadAloud(-SEEK_MS);
  const onSeekForward = () => snap.canSeekForward && seekReadAloud(SEEK_MS);
  const onClose = () => stopReadAloud(); // stops speech AND dismisses (single source of truth)

  return (
    <View pointerEvents="box-none" style={[pl.wrap, { top: insets.top + 12 }]}>
      <Animated.View
        style={[
          pl.pill,
          // Ezhalah's document is dir="rtl" whenever Arabic is active (Read Aloud is Arabic-only,
          // so this is effectively always). Plain 'row' ALREADY flows right-to-left in an RTL
          // document — it follows the ambient inline direction, not literal screen-left-to-right —
          // so it's what places the primary play/pause control (first in DOM) at the right (the
          // Arabic reading-start side) and Close (last in DOM) at the left, a genuine RTL-native
          // mirror rather than a copy of the LTR reference screenshot's left-to-right order.
          // Verified live on production: 'row-reverse' here double-reversed it back to an
          // LTR-looking layout (play on the left) — confirmed empirically, not assumed.
          { flexDirection: isRTL ? 'row' : 'row-reverse' },
          { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }, { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] },
        ]}
      >
        <PillButton
          primary
          icon={playing ? 'pause-circle' : 'play-circle'}
          size={30}
          onPress={onPlayPause}
          label={t(playing ? 'Pause reading' : 'Resume reading')}
        />
        <Text style={pl.time}>{formatElapsed(snap.elapsedMs)}</Text>
        <Pressable
          onPress={cycleReadAloudRate}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('Playback speed')}
          style={({ pressed }) => [pl.speedChip, pressed && pl.speedChipPressed]}
        >
          <Text style={pl.speedTx}>{snap.rate}x</Text>
        </Pressable>
        <SeekButton mirrored onPress={onSeekBack} disabled={!snap.canSeekBack} label={t('Back 15 seconds')} />
        <SeekButton onPress={onSeekForward} disabled={!snap.canSeekForward} label={t('Forward 15 seconds')} />
        <PillButton icon="close" size={20} onPress={onClose} label={t('Close')} />
      </Animated.View>
    </View>
  );
}

function PillButton({ icon, size, onPress, label, primary }: { icon: any; size: number; onPress: () => void; label: string; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: any) => [pl.iconBtn, (hovered || pressed) && pl.iconBtnHover]}
    >
      <Ionicons name={icon} size={size} color={primary ? colors.primary : colors.muted} />
    </Pressable>
  );
}

// One glyph (a circular arrow), mirrored for "back" vs. plain for "forward" — a natural, honest pair
// without a second icon asset. The "15" badge makes the seek amount explicit either way.
function SeekButton({ onPress, mirrored, disabled, label }: { onPress: () => void; mirrored?: boolean; disabled: boolean; label: string }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ hovered, pressed }: any) => [pl.iconBtn, !disabled && (hovered || pressed) && pl.iconBtnHover, disabled && pl.disabled]}
    >
      <View style={pl.seekStack}>
        <Ionicons name="refresh-outline" size={20} color={colors.muted} style={mirrored ? pl.mirror : undefined} />
        <Text style={pl.seekLabel}>15</Text>
      </View>
    </Pressable>
  );
}

const pl = StyleSheet.create({
  // Fixed on web so the pill stays put while the results scroll underneath it (absolute would scroll
  // away with the page); RN's own StyleSheet types don't list 'fixed', but react-native-web accepts
  // it, matching the "remain fixed while the user scrolls" requirement.
  wrap: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    left: 0, right: 0, alignItems: 'center', zIndex: 500,
    paddingHorizontal: 16,
  },
  pill: {
    alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radius.sheet + 4, // ~26 — generous pill radius per spec (22-28px)
    paddingVertical: 9, paddingHorizontal: 14,
    maxWidth: 420,
    ...cardShadow,
    // Soft frosted-glass feel on web only (native RN has no backdrop-filter) — subtle, not a heavy border.
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' as any, WebkitBackdropFilter: 'blur(16px)' as any, cursor: 'default' as any } : {}),
  },
  // 44×44 touch target (owner spec) even though the visual icon is smaller — hitSlop alone would be
  // asymmetric near the pill edge, so the Pressable itself reserves the full box.
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  iconBtnHover: { backgroundColor: colors.tint },
  disabled: { opacity: 0.35 },
  seekStack: { alignItems: 'center', justifyContent: 'center' },
  seekLabel: { fontSize: 8, fontWeight: '700', color: colors.muted, marginTop: -3 },
  mirror: { transform: [{ scaleX: -1 }] },
  time: {
    fontSize: 12.5, fontWeight: '600', color: colors.body, minWidth: 30, textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontVariantNumeric: 'tabular-nums' as any } : {}),
  },
  speedChip: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5, ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  speedChipPressed: { backgroundColor: colors.tint },
  speedTx: { fontSize: 12, fontWeight: '700', color: colors.body },
});
