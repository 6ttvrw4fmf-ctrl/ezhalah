import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// True when the OS "reduce motion" accessibility setting is on. Used to skip non-essential animations
// (card fade/slide, the reveal stagger, image cross-fade) for users who prefer reduced motion. Works on
// web too — react-native-web maps this to the prefers-reduced-motion media query.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (on) setReduced(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduced(!!v));
    return () => { on = false; (sub as any)?.remove?.(); };
  }, []);
  return reduced;
}
