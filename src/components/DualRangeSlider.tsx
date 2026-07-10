// Custom dual-handle range slider — no external dependency. Works on web + iOS + Android via a
// SINGLE PanResponder on the track. The parent owns state (so the typed min/max boxes and the slider
// stay in sync — both read/write the same query fields).
//
// Value semantics (matches the Area/Price filter contract):
//   • low at the MIN bound  → reported as null  (no minimum filter).
//   • high at the MAX bound → reported as null  (no maximum filter — "and up").
//   • a `high` typed BEYOND `max` is pinned visually at the max end; the box keeps the exact value.
//   • the handles can never cross (min ≤ max enforced).
//
// One responder (not one-per-thumb) is deliberate: stacked per-thumb responders made the top thumb
// swallow touches when both handles collapsed to the same spot, and made an open `high` handle slide
// down to a literal 0. Here a touch picks the NEAREST handle; when the two coincide the first drag
// DIRECTION decides (drag left → move the low handle, drag right → move the high handle), so a
// collapsed pair can always re-separate either way. Capture is gated on horizontal intent so a
// vertical swipe that starts on the bar still scrolls the page.
import { useRef, useState } from 'react';
import { PanResponder, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { colors } from '@/theme/tokens';

type Props = {
  min: number;
  max: number;
  step: number;
  low: number | null;   // current minimum (null = open at the min bound)
  high: number | null;  // current maximum (null = open at the max bound); values > max pin at max
  onChange: (low: number | null, high: number | null) => void;
};

export default function DualRangeSlider({ min, max, step, low, high, onChange }: Props) {
  const [, setW] = useState(0); // re-render once measured so the thumbs position correctly
  const widthRef = useRef(0);

  // Visual positions (clamped into the track); a high beyond `max` pins at the right edge.
  const loVal = low == null ? min : Math.max(min, Math.min(max, low));
  const hiVal = high == null ? max : Math.max(min, Math.min(max, high));

  // Live ref so the single PanResponder always reads current props (no stale closures mid-drag).
  const ref = useRef({ min, max, step, loVal, hiVal, low, high, onChange });
  ref.current = { min, max, step, loVal, hiVal, low, high, onChange };
  const active = useRef<'lo' | 'hi' | null>(null); // which handle the current gesture drives
  const startLo = useRef(0);
  const startHi = useRef(0);

  const snap = (v: number, p: typeof ref.current) =>
    Math.max(p.min, Math.min(p.max, Math.round((v - p.min) / p.step) * p.step + p.min));

  // Map a touch x within the track to a value, then pick the nearer handle.
  const pickHandle = (lx: number, p: typeof ref.current, w: number) => {
    const frac = w > 0 ? Math.max(0, Math.min(1, lx / w)) : 0;
    const touchVal = p.min + frac * (p.max - p.min);
    const dLo = Math.abs(touchVal - p.loVal);
    const dHi = Math.abs(touchVal - p.hiVal);
    if (dLo === dHi) return null;            // coincident handles → decide on first drag direction
    return dLo < dHi ? 'lo' : 'hi';
  };

  const moveLo = (dx: number, p: typeof ref.current, w: number) => {
    let v = snap(startLo.current + (dx / w) * (p.max - p.min), p);
    v = Math.min(v, p.hiVal);                       // can't cross the high handle
    p.onChange(v <= p.min ? null : v, p.high);      // min edge → null; leave high untouched
  };
  const moveHi = (dx: number, p: typeof ref.current, w: number) => {
    let v = snap(startHi.current + (dx / w) * (p.max - p.min), p);
    const floor = p.low == null ? p.min : p.loVal;  // an open low must not trap the high handle
    v = Math.max(v, floor);                         // can't cross the low handle
    // null at the max edge ("and up"); also null if it slides down onto an open (null) low.
    p.onChange(p.low, v >= p.max || (p.low == null && v <= p.min) ? null : v);
  };

  const pan = useRef(
    PanResponder.create({
      // Don't grab on touch-down (would steal the ScrollView's vertical scroll); wait for a clearly
      // horizontal drag. This also means a plain tap never mutates a value (protects a typed
      // beyond-max value from being wiped by an incidental touch on the pinned thumb).
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const p = ref.current;
        startLo.current = p.loVal;
        startHi.current = p.hiVal;
        active.current = pickHandle(e.nativeEvent.locationX ?? 0, p, widthRef.current);
      },
      onPanResponderMove: (_e, g) => {
        const p = ref.current; const w = widthRef.current; if (!w) return;
        if (active.current == null) {                 // coincident handles: direction decides
          if (g.dx === 0) return;
          active.current = g.dx < 0 ? 'lo' : 'hi';
        }
        if (active.current === 'lo') moveLo(g.dx, p, w);
        else moveHi(g.dx, p, w);
      },
      onPanResponderRelease: () => { active.current = null; },
      onPanResponderTerminate: () => { active.current = null; },
    }),
  ).current;

  const pct = (v: number) => (max > min ? ((v - min) / (max - min)) * 100 : 0);
  const loPct = pct(loVal);
  const hiPct = pct(hiVal);

  const onLayout = (e: LayoutChangeEvent) => { widthRef.current = e.nativeEvent.layout.width; setW(e.nativeEvent.layout.width); };

  // Still a SUPPORTING control (the typed من/إلى boxes stay primary), but restyled premium
  // (2026-07-02): slightly thicker rounded track, the SELECTED range highlighted in primary
  // green, and larger white iOS-style thumbs with a soft shadow + a taller touch area.
  return (
    <View {...pan.panHandlers} onLayout={onLayout} style={{ height: 30, justifyContent: 'center', marginHorizontal: 12, marginTop: 12 }}>
      <View style={{ height: 4, borderRadius: 999, backgroundColor: colors.line }} />
      <View style={{ position: 'absolute', height: 4, borderRadius: 999, backgroundColor: colors.primary, left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: `${loPct}%`, marginLeft: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 2.5, borderColor: colors.primary, shadowColor: '#1d4a37', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: `${hiPct}%`, marginLeft: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 2.5, borderColor: colors.primary, shadowColor: '#1d4a37', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
    </View>
  );
}
