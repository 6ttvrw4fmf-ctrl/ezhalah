import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { makeBits } from './CardBuzzer';
import { useReducedMotion } from '@/lib/useReducedMotion';

const IS_WEB = Platform.OS === 'web';
const BURST_MS = 1350;

// THE SCREEN-LEVEL PARTY (owner 2026-10-17: «whenever a user clicks on a listing I want this party
// confetti to appear … on everything»). The card's own BuzzLayer flashes the card gold, but on a phone
// the ad sheet slides up over the card within the first frames, and on a laptop the pane can cover it.
// This layer sits ABOVE everything — the sheet, the pane, the results — so the confetti is always seen.
//
// Wiring is a one-line bus, not a prop chain: ResultCard's press handler calls `partyConfetti()` right
// after it opens the ad; the single overlay mounted at the screen root listens. DECORATION ONLY:
// nothing here can stop or delay the open, reduced motion draws nothing, and the layer is removed by
// a timer (never by an animation callback, which a frozen rAF could strand).
let listeners: Array<() => void> = [];
export function partyConfetti(): void { for (const l of listeners) { try { l(); } catch { /* decoration */ } } }

export function ConfettiOverlay() {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  const [burst, setBurst] = useState(0);
  const [live, setLive] = useState(false);
  const bits = useMemo(makeBits, []);

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
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.top]} testID="confetti-overlay">
      <View style={s.origin}>
        {bits.map((b, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: b.w * 1.5,
              height: b.h * 1.5,
              borderRadius: b.round ? b.w * 1.5 : 2,
              backgroundColor: b.color,
              opacity: t.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx * 2.2] }) },
                // gravity: the bit rises with its throw, then falls away
                { translateY: t.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, b.dy * 1.4, b.dy * 2 + 420] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${b.rot}deg`] }) },
              ],
            }}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Above the ad sheet / pane and every hint pill.
  top: { zIndex: 100000, elevation: 100000 },
  // The burst erupts from the middle of the screen.
  origin: { position: 'absolute', left: '50%', top: '42%', width: 0, height: 0 },
});
