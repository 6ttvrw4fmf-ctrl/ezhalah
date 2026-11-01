import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors } from '@/theme/tokens';
import { useReducedMotion } from '@/lib/useReducedMotion';

const IS_WEB = Platform.OS === 'web';
const BURST_MS = 2200;
const PER_CANNON = 56; // two party poppers, one in each bottom corner
const CENTRE = 40;     // plus a burst from the middle of the screen → 152 pieces

// THE SCREEN-LEVEL PARTY (owner 2026-10-17: «whenever a user clicks on a listing I want this party
// confetti to appear … on everything», «make it attractive … my goal is sending traffic to those
// sites»). The card's own BuzzLayer flashes the card gold, but on a phone the ad sheet slides up over
// the card within the first frames, and on a laptop the pane can cover it. This layer sits ABOVE
// everything — the sheet, the pane, the results — so the party is always seen: two party poppers, one
// in each bottom corner, fan big gold / green / white ribbons and dots up across the screen, a burst
// erupts from the middle, and everything tumbles, flutters and falls away. Nothing is drawn at random:
// the same party every press.
//
// Wiring is a one-line bus, not a prop chain: ResultCard's press handler calls `partyConfetti()` right
// after it opens the ad; the single overlay mounted at the screen root listens. DECORATION ONLY:
// nothing here can stop or delay the open, reduced motion draws nothing, and the layer is removed by
// a timer (never by an animation callback, which a frozen rAF could strand).
let listeners: Array<() => void> = [];
export function partyConfetti(): void { for (const l of listeners) { try { l(); } catch { /* decoration */ } } }

// side: -1 left popper, 1 right popper, 0 the centre burst.
type Piece = { side: -1 | 0 | 1; ux: number; uy: number; v: number; rot: number; w: number; h: number; color: string; round: boolean; delay: number };

const PALETTE = [colors.goldLight, colors.goldDeep, colors.primary, colors.goldLightHover, colors.onFill, colors.selFill, colors.goldLight, colors.primary, colors.goldLightHover];

// Fixed fans (computed from the index): the poppers sweep from straight up to ~75° inward with varied
// speeds; the centre burst radiates all around. Every 4th piece a dot, every piece its own tumble.
function makePieces(): Piece[] {
  const out: Piece[] = [];
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < PER_CANNON; i++) {
      const a = (Math.PI / 2) - (i / (PER_CANNON - 1)) * (Math.PI * 0.42) * side * -1; // up → inward
      out.push({
        side,
        ux: Math.cos(a) * side * -1, // pointing toward the screen's middle
        uy: -Math.sin(a),
        v: 0.38 + ((i * 37) % 100) / 100 * 0.5, // 0.38–0.88 × the screen's height: the fan stays in view on a phone
        rot: ((i * 131) % 1440) - 720,
        w: 8 + (i % 4) * 3,
        h: 14 + (i % 5) * 4,
        color: PALETTE[(i + (side > 0 ? 4 : 0)) % PALETTE.length],
        round: i % 4 === 0,
        delay: (i % 7) * 0.012,
      });
    }
  }
  for (let i = 0; i < CENTRE; i++) {
    const a = (i / CENTRE) * Math.PI * 2 + (i % 3) * 0.17;
    out.push({
      side: 0,
      ux: Math.cos(a),
      uy: Math.sin(a) - 0.35, // a touch upward, so it blooms before it falls
      v: 0.22 + ((i * 53) % 100) / 100 * 0.3,
      rot: ((i * 97) % 1080) - 540,
      w: 9 + (i % 3) * 3,
      h: 12 + (i % 4) * 4,
      color: PALETTE[(i + 2) % PALETTE.length],
      round: i % 3 === 0,
      delay: 0.03 + (i % 5) * 0.01,
    });
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

  // WEB: THE BROWSER ANIMATES THE PARTY (speed, owner 2026-10-27: «it takes time, doesn't feel smooth»). Animated on
  // web has no native driver, so 152 pieces × 5 interpolations were recomputed in JavaScript every frame for 2.2 s —
  // right while the tapped listing's pane was rendering. Here each piece is handed to the Web Animations API once
  // (translate / rotate / scale / opacity run on the compositor): same pieces, same paths, same easing, zero work per
  // frame. Native keeps the Animated path below. Guard: scripts/verify-listing-tap-is-instant.ts
  const nodes = useRef<Array<HTMLElement | null>>([]);
  useEffect(() => {
    if (!IS_WEB || !live || reduced) return;
    const reach = Math.min(height, 900);
    const timing = { duration: BURST_MS, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' as const };
    const anims: Array<{ cancel: () => void }> = [];
    pieces.forEach((p, i) => {
      const el = nodes.current[i];
      if (!el || typeof el.animate !== 'function') return;
      const dx = p.ux * p.v * reach * (p.side === 0 ? 1 : 0.95);
      const peakY = p.uy * p.v * reach;
      const start = p.delay, mid = start + (1 - start) * 0.42;
      try {
        anims.push(el.animate([
          { offset: 0, translate: '0px 0px' }, { offset: start, translate: '0px 0px' },
          { offset: mid, translate: `${dx * 0.8}px ${peakY}px` },
          { offset: 1, translate: `${dx * (1.05 + (i % 3) * 0.06)}px ${peakY * 0.25 + 60}px` },
        ], timing));
        anims.push(el.animate([{ offset: 0, opacity: 0 }, { offset: start, opacity: 1 }, { offset: 0.72, opacity: 1 }, { offset: 1, opacity: 0 }], timing));
        anims.push(el.animate([{ rotate: '0deg' }, { rotate: `${p.rot}deg` }], timing));
        anims.push(el.animate([1, 0.25, 1, 0.25, 1, 0.4].map((v, k) => ({ offset: k / 5, scale: `${v} 1` })), timing));
      } catch { /* decoration only */ }
    });
    return () => { for (const a of anims) { try { a.cancel(); } catch { /* ignore */ } } };
  }, [live, burst, reduced, width, height, pieces]);

  if (!live || reduced) return null;
  const reach = Math.min(height, 900);
  if (IS_WEB) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.top]} testID="confetti-overlay">
        {pieces.map((p, i) => {
          const anchor = p.side === 0
            ? { left: width / 2, top: height * 0.45 }
            : { bottom: -20, left: p.side < 0 ? -10 : undefined, right: p.side > 0 ? -10 : undefined };
          return (
            <View
              key={i}
              ref={(n) => { nodes.current[i] = n as unknown as HTMLElement | null; }}
              style={{ position: 'absolute', ...anchor, width: p.w, height: p.h, borderRadius: p.round ? p.w : 2, backgroundColor: p.color, opacity: 0 }}
            />
          );
        })}
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.top]} testID="confetti-overlay">
      {pieces.map((p, i) => {
        const dx = p.ux * p.v * reach * (p.side === 0 ? 1 : 0.95);
        const peakY = p.uy * p.v * reach; // negative = up
        const start = p.delay, mid = start + (1 - start) * 0.42;
        const anchor = p.side === 0
          ? { left: width / 2, top: height * 0.45 }
          : { bottom: -20, left: p.side < 0 ? -10 : undefined, right: p.side > 0 ? -10 : undefined };
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              ...anchor,
              width: p.w,
              height: p.h,
              borderRadius: p.round ? p.w : 2,
              backgroundColor: p.color,
              opacity: t.interpolate({ inputRange: [0, start, 0.72, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                // the throw: fast out of the popper, then gravity takes over
                { translateX: t.interpolate({ inputRange: [0, start, mid, 1], outputRange: [0, 0, dx * 0.8, dx * (1.05 + (i % 3) * 0.06)] }) },
                { translateY: t.interpolate({ inputRange: [0, start, mid, 1], outputRange: [0, 0, peakY, peakY * 0.25 + 60] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rot}deg`] }) },
                // a ribbon flutters: it narrows and widens as it tumbles
                { scaleX: t.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [1, 0.25, 1, 0.25, 1, 0.4] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  // Above the ad sheet / pane and every hint pill.
  top: { zIndex: 100000, elevation: 100000 },
});
