import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors } from '@/theme/tokens';
import { useReducedMotion } from '@/lib/useReducedMotion';

const IS_WEB = Platform.OS === 'web';
const BURST_MS = 1900;
const PER_CANNON = 42; // two party poppers, one in each bottom corner → 84 pieces

// THE SCREEN-LEVEL PARTY (owner 2026-10-17: «whenever a user clicks on a listing I want this party
// confetti to appear … on everything», «make it attractive … my goal is sending traffic to those
// sites»). The card's own BuzzLayer flashes the card gold, but on a phone the ad sheet slides up over
// the card within the first frames, and on a laptop the pane can cover it. This layer sits ABOVE
// everything — the sheet, the pane, the results — so the party is always seen: two party poppers, one
// in each bottom corner, fire a fan of gold / green / white ribbons and dots up across the screen,
// which tumble and fall away. Nothing is drawn at random: the same fan every press.
//
// Wiring is a one-line bus, not a prop chain: ResultCard's press handler calls `partyConfetti()` right
// after it opens the ad; the single overlay mounted at the screen root listens. DECORATION ONLY:
// nothing here can stop or delay the open, reduced motion draws nothing, and the layer is removed by
// a timer (never by an animation callback, which a frozen rAF could strand).
let listeners: Array<() => void> = [];
export function partyConfetti(): void { for (const l of listeners) { try { l(); } catch { /* decoration */ } } }

type Piece = { side: -1 | 1; ux: number; uy: number; v: number; rot: number; w: number; h: number; color: string; round: boolean; delay: number };

// A fixed fan per popper (computed from the index): angles sweep from straight up to ~70° inward,
// speeds vary in a repeating pattern, every 4th piece a dot, every piece its own tumble.
function makePieces(): Piece[] {
  const palette = [colors.goldLight, colors.goldDeep, colors.primary, colors.goldLightHover, colors.onFill, colors.selFill, colors.goldLight, colors.primary];
  const out: Piece[] = [];
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < PER_CANNON; i++) {
      const a = (Math.PI / 2) - (i / (PER_CANNON - 1)) * (Math.PI * 0.42) * side * -1; // up → inward
      out.push({
        side,
        ux: Math.cos(a) * side * -1, // pointing toward the screen's middle
        uy: -Math.sin(a),
        v: 0.55 + ((i * 37) % 100) / 100 * 0.55, // 0.55–1.1 × the screen's height
        rot: ((i * 131) % 1080) - 540,
        w: 7 + (i % 4) * 2,
        h: 11 + (i % 5) * 3,
        color: palette[(i + (side > 0 ? 3 : 0)) % palette.length],
        round: i % 4 === 0,
        delay: (i % 7) * 0.012,
      });
    }
  }
  return out;
}

export function ConfettiOverlay() {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const [burst, setBurst] = useState(0);
  const [live, setLive] = useState(false);
  const pieces = useMemo(makePieces, []);

  useEffect(() => {
    const l = () => setBurst((b) => b + 1);
    listeners.push(l);
    return () => { listeners = listeners.filter((x) => x !== l); };
  }, []);

  useEffect(() => {
    if (burst === 0 || reduced) return;
    setLive(true);
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: BURST_MS, easing: Easing.out(Easing.cubic), useNativeDriver: !IS_WEB }).start();
    const id = setTimeout(() => setLive(false), BURST_MS + 150);
    return () => clearTimeout(id);
  }, [burst, reduced, t]);

  if (!live || reduced) return null;
  const reach = Math.min(height, 900);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.top]} testID="confetti-overlay">
      {pieces.map((p, i) => {
        const dx = p.ux * p.v * reach * 0.95;
        const peakY = p.uy * p.v * reach; // negative = up
        const start = p.delay, mid = start + (1 - start) * 0.42;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              bottom: -20,
              left: p.side < 0 ? -10 : undefined,
              right: p.side > 0 ? -10 : undefined,
              width: p.w,
              height: p.h,
              borderRadius: p.round ? p.w : 2,
              backgroundColor: p.color,
              opacity: t.interpolate({ inputRange: [0, start, 0.7, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                // the throw: fast out of the popper, then gravity takes over
                { translateX: t.interpolate({ inputRange: [0, start, mid, 1], outputRange: [0, 0, dx * 0.8, dx * (1.05 + (i % 3) * 0.06)] }) },
                { translateY: t.interpolate({ inputRange: [0, start, mid, 1], outputRange: [0, 0, peakY, peakY * 0.25 + 40] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rot}deg`] }) },
                // a ribbon flutters: it narrows and widens as it tumbles
                { scaleX: t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.3, 1, 0.3, 1] }) },
              ],
            }}
          />
        );
      })}
      {/* keeps `width` in the render so a rotation re-lays out the fan */}
      <View style={{ width: 0, height: 0, left: width }} />
    </View>
  );
}

const s = StyleSheet.create({
  // Above the ad sheet / pane and every hint pill.
  top: { zIndex: 100000, elevation: 100000 },
});
