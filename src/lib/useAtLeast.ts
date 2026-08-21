// The React half of the SSR-safe viewport gate. The DECISION lives in lib/responsive.ts (pure, and
// therefore executable by the barrier); this file only supplies the two inputs React owns — the
// current width and whether we have mounted yet.
//
// Every width-gated layout flag in the app must come from here. Reading `useWindowDimensions().width`
// and comparing it inline is the P0 of 2026-08-21 (React #418 on every desktop visit); the fleet-wide
// scan in scripts/verify-ssr-hydration-parity.ts fails the build if that pattern comes back.

import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { atLeast } from '@/lib/responsive';

export function useAtLeast(min: number): boolean {
  const { width } = useWindowDimensions();
  // Deliberately starts false so the first client render matches the server (which has no window).
  // The effect runs only after that first render has been committed, so flipping it here can never
  // change what React compares against the served HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return atLeast({ mounted, isWeb: Platform.OS === 'web', width, min });
}
