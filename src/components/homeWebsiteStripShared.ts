// The website strip's shared contract (web + native variants of HomeWebsiteStrip import from here).
//
// PHASE FROM THE WALL CLOCK (owner 2026-10-09: «when I refresh, Aqar shows — not nice; it should always
// have that rotation» · «when the user changes to الوسيط الذكي it should feel like a continuation»).
// The loop's position is a pure function of the clock, so a refresh lands mid-rotation and any two
// mounts at the same moment — the Filter home and the AI landing — show the same logos at the same
// place: switching screens reads as ONE strip that never stopped. Pinned by
// scripts/verify-website-strip-clock-phase-and-live-sites.ts.
import { useEffect, useMemo, useState } from 'react';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { livePickerNames, loadLivePickerNames, pickerMayOffer } from '@/data/pickerLivePlatforms';
import { hiddenPlatformNames } from '@/data/loaderActivePlatforms';

/** Steady scroll speed, px per second. */
export const STRIP_SPEED = 36;
/** One logo slot, px (96px frame + 2×6 padding). cycleWidth = names × STRIP_SLOT. */
export const STRIP_SLOT = 108;

/** How far into one cycle the loop is at `nowMs`, in px: 0 ≤ phase < cycleWidth. */
export function stripPhase(nowMs: number, cycleWidth: number): number {
  return cycleWidth > 0 ? ((nowMs / 1000) * STRIP_SPEED) % cycleWidth : 0;
}

const ALL_NAMES = Object.keys(PLATFORM_PICKER_PROFILES);

/** The sites the strip may show — the picker's own rule (never a down or empty site), re-filtered
 *  once the live list lands. Until then: everything the down-status list does not name. */
export function useStripNames(): string[] {
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadLivePickerNames().then(() => { if (alive) setLiveTick((n) => n + 1); });
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    const liveNames = livePickerNames();
    const downNames = hiddenPlatformNames();
    return ALL_NAMES.filter((name) => pickerMayOffer(name, liveNames, downNames));
  }, [liveTick]);
}
