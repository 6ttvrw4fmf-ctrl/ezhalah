import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import CloudWisp from './CloudWisp';
import { cloudVariant, skyScene } from '@/theme/skyScene';
import { useResolvedTheme } from '@/lib/appearance';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { STRIP_SLOT, stripPhase, useStripNames } from './homeWebsiteStripShared';

/** Logos mounted at once: enough to cover the 560 px strip plus the one sliding in from the right. */
export const STRIP_WINDOW = Math.ceil(560 / STRIP_SLOT) + 1;

/** Where the window starts and how far it has slid, for a given clock phase. Pure (barrier-executed). */
export function stripWindow(phase: number, count: number): { start: number; offset: number } {
  if (!(count > 0) || !Number.isFinite(phase)) return { start: 0, offset: 0 };
  return { start: Math.floor(phase / STRIP_SLOT) % count, offset: phase % STRIP_SLOT };
}

/** A SMALL window, not the whole loop (owner iPhone screenshot 2026-10-22: the home page's lower half
 *  painted white). The track used to hold every logo twice — ~150 × 2 × 108 px ≈ 32,000 px wide — as ONE
 *  `will-change: transform` layer, the shape iOS Safari drops tiles for under memory pressure. Now only
 *  STRIP_WINDOW logos are mounted. Every frame reads the wall clock (homeWebsiteStripShared.ts stripPhase,
 *  same 12 px/s, same place on both screens) and slides the small track; when a logo has fully left, the
 *  window steps to the next one and the slide restarts from 0 in the same commit (useLayoutEffect), so the
 *  step is invisible. The static export pre-renders this markup; the phase is read on the client AFTER
 *  mount and the strip stays invisible until then. Reduced motion: static at the clock's position. */
export default function HomeWebsiteStrip() {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const names = useStripNames();
  const n = names.length;
  const cycleWidth = n * STRIP_SLOT;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const [phase, setPhase] = useState<number | null>(null);
  const [start, setStart] = useState(0);
  useLayoutEffect(() => {
    const p = stripPhase(Date.now(), cycleWidth);
    const w = stripWindow(p, n);
    offsetRef.current = w.offset;
    setPhase(p);
    setStart(w.start);
  }, [cycleWidth, n]);
  // Apply the slide in the same commit as the window step, so the swap never shows.
  useLayoutEffect(() => {
    if (trackRef.current) trackRef.current.style.transform = `translateX(${-offsetRef.current}px)`;
  }, [start, phase]);
  useEffect(() => {
    if (phase === null || reduced || !n) return;
    let raf = 0;
    let shown = start;
    const tick = () => {
      const w = stripWindow(stripPhase(Date.now(), cycleWidth), n);
      offsetRef.current = w.offset;
      if (w.start !== shown) { shown = w.start; setStart(w.start); }
      else if (trackRef.current) trackRef.current.style.transform = `translateX(${-w.offset}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `start` is read once to seed `shown`; the loop owns it from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduced, n, cycleWidth]);
  const slots = n === 0 ? [] : Array.from({ length: STRIP_WINDOW }, (_, j) => {
    const at = start + j;
    return { name: names[at % n], key: `${names[at % n]}-${Math.floor(at / n)}` };
  });
  return <div data-testid="home-website-strip" aria-hidden="true" dir="ltr" style={{ width: '100%', maxWidth: 560, height: skyScene.stripHeight, alignSelf: 'center', marginTop: 8, marginBottom: 12, overflow: 'hidden', opacity: phase === null ? 0 : 1, transition: reduced ? undefined : 'opacity 240ms ease-out' }}>
    <div ref={trackRef} data-testid="home-website-track" data-phase={phase === null ? undefined : Math.round(phase)} style={{ display: 'flex', width: 'max-content', visibility: phase === null ? 'hidden' : undefined }}>
      {slots.map(({ name, key }) => {
        const profile = PLATFORM_PICKER_PROFILES[name];
        return <div key={key} data-website={name} style={{ flex: `0 0 ${STRIP_SLOT}px`, position: 'relative', height: skyScene.stripHeight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CloudWisp variant={cloudVariant(name)} width={112} height={44} opacity={0.8} style={{ left: -4, bottom: 0 }} />
          {/* clipPath + contain, not overflow alone: 17 logos are laid out LARGER than this frame and rely on
              the clip. iOS Safari skips an overflow:hidden clip inside the animated (composited) track, so
              those logos spilled across their neighbours — owner iPhone screenshot 2026-10-17. */}
          <div style={{ position: 'relative', width: 96, height: 48, backgroundColor: 'transparent', overflow: 'hidden', clipPath: 'inset(0)', WebkitClipPath: 'inset(0)', contain: 'paint' } as any}>
            <Image source={profile.logo} tintColor={profile.layout.monochrome ? (theme === 'dark' ? '#F3F5F3' : '#253831') : undefined} loading="eager" priority="high" transition={0} style={{ position: 'absolute', width: profile.layout.width, height: profile.layout.height, left: profile.layout.left, top: profile.layout.top }} contentFit="contain" accessible={false} />
          </div>
        </div>;
      })}
    </div>
  </div>;
}
