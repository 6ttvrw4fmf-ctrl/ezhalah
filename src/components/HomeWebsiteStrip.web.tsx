import { Image } from 'expo-image';
import { useResolvedTheme } from '@/lib/appearance';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';

const names = Object.keys(PLATFORM_PICKER_PROFILES);
const duration = names.length * 108 / 36;

/** CSS keeps the steady ticker on the compositor; every original logo loads eagerly. */
export default function HomeWebsiteStrip() {
  const theme = useResolvedTheme();
  return <div data-testid="home-website-strip" aria-hidden="true" dir="ltr" style={{ width: '100%', maxWidth: 560, height: 48, alignSelf: 'center', marginTop: 8, marginBottom: 12, overflow: 'hidden' }}>
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
    <div className="ezhalah-website-ticker" data-testid="home-website-track">
      {[0, 1].map(copy => <div key={copy} data-testid={`home-website-cycle-${copy}`} style={{ display: 'flex', flexShrink: 0 }}>
        {names.map(name => {
          const profile = PLATFORM_PICKER_PROFILES[name];
          return <div key={name} data-website={name} style={{ flex: '0 0 108px', height: 48, display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: 96, height: 48, backgroundColor: 'transparent', overflow: 'hidden', transform: 'scale(0.9)' }}>
              <Image source={profile.logo} tintColor={profile.layout.monochrome ? (theme === 'dark' ? '#F3F5F3' : '#253831') : undefined} loading="eager" priority={names.indexOf(name) < 5 ? 'high' : 'normal'} transition={0} style={{ position: 'absolute', width: profile.layout.width, height: profile.layout.height, left: profile.layout.left, top: profile.layout.top }} contentFit="contain" accessible={false} />
            </div>
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}
