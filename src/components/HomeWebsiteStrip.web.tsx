import { useLayoutEffect, useState } from 'react';
import { Image } from 'expo-image';
import { useResolvedTheme } from '@/lib/appearance';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { STRIP_SLOT, STRIP_SPEED, stripPhase, useStripNames } from './homeWebsiteStripShared';

/** CSS keeps the steady ticker on the compositor; every original logo loads eagerly.
 *  The loop's phase comes from the wall clock (homeWebsiteStripShared.ts): a negative animation-delay
 *  starts the keyframes mid-cycle. The static export pre-renders this markup, so the phase is read on
 *  the client AFTER mount (a build-time clock would be baked into the HTML); until then the strip stays
 *  invisible rather than flashing the first logos, then fades in already at the right place. */
export default function HomeWebsiteStrip() {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const names = useStripNames();
  const cycleWidth = names.length * STRIP_SLOT;
  const duration = cycleWidth / STRIP_SPEED;
  const [phase, setPhase] = useState<number | null>(null);
  useLayoutEffect(() => { setPhase(stripPhase(Date.now(), cycleWidth)); }, [cycleWidth]);
  const track = phase === null
    ? { animationPlayState: 'paused' as const, visibility: 'hidden' as const }
    : reduced
      ? { animation: 'none', transform: `translateX(${-phase}px)` }
      : { animationDelay: `${-phase / STRIP_SPEED}s` };
  return <div data-testid="home-website-strip" aria-hidden="true" dir="ltr" style={{ width: '100%', maxWidth: 560, height: 48, alignSelf: 'center', marginTop: 8, marginBottom: 12, overflow: 'hidden', opacity: phase === null ? 0 : 1, transition: reduced ? undefined : 'opacity 240ms ease-out' }}>
    <style>{`
      @keyframes ezhalah-website-ticker {
        from { transform: translateX(0); }
        to { transform: translateX(-50%); }
      }
      .ezhalah-website-ticker {
        display: flex; width: max-content; will-change: transform;
        animation: ezhalah-website-ticker ${duration}s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .ezhalah-website-ticker { animation: none; will-change: auto; }
      }
    `}</style>
    <div className="ezhalah-website-ticker" data-testid="home-website-track" data-phase={phase === null ? undefined : Math.round(phase)} style={track}>
      {[0, 1].map(copy => <div key={copy} data-testid={`home-website-cycle-${copy}`} style={{ display: 'flex', flexShrink: 0 }}>
        {names.map(name => {
          const profile = PLATFORM_PICKER_PROFILES[name];
          return <div key={name} data-website={name} style={{ flex: `0 0 ${STRIP_SLOT}px`, height: 48, display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: 96, height: 48, backgroundColor: 'transparent', overflow: 'hidden' }}>
              <Image source={profile.logo} tintColor={profile.layout.monochrome ? (theme === 'dark' ? '#F3F5F3' : '#253831') : undefined} loading="eager" priority={names.indexOf(name) < 5 ? 'high' : 'normal'} transition={0} style={{ position: 'absolute', width: profile.layout.width, height: profile.layout.height, left: profile.layout.left, top: profile.layout.top }} contentFit="contain" accessible={false} />
            </div>
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}
