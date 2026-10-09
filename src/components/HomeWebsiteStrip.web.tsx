import { Image } from 'expo-image';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { colors } from '@/theme/tokens';

const names = Object.keys(PLATFORM_PICKER_PROFILES);
const duration = names.length * 68 / 22;

/** CSS keeps the steady ticker on the compositor; every original logo loads eagerly. */
export default function HomeWebsiteStrip() {
  return <div data-testid="home-website-strip" aria-hidden="true" dir="ltr" style={{ width: '100%', maxWidth: 340, height: 32, alignSelf: 'center', marginTop: 8, marginBottom: 12, overflow: 'hidden' }}>
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
          return <div key={name} data-website={name} style={{ flex: '0 0 68px', height: 32, display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: 56, height: 32, overflow: 'hidden' }}>
              <Image source={profile.logo} loading="eager" priority={names.indexOf(name) < 5 ? 'high' : 'normal'} transition={0} style={{ position: 'absolute', width: profile.layout.width, height: profile.layout.height, left: profile.layout.left, top: profile.layout.top }} contentFit="contain" tintColor={profile.layout.dark ? colors.ink : undefined} accessible={false} />
            </div>
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}
