// THE IN-APP AD VIEWER OPENS ONLY ALLOWLISTED HOSTS — executed, and the wiring checked.
//
// Owner 2026-10-03 (practice version, two sites): a dealapp.sa or gathern.co listing opens inside
// Ezhalah; every other site keeps today's behaviour (new tab on web, system browser on native).
// The decision is one pure function (src/lib/inAppViewer.ts) so this check RUNS it. It also pins
// the wiring, because a correct helper nothing calls is decoration: the agent screen must route
// through it, and the old open path must still exist unchanged for everyone else.

import { readFileSync } from 'node:fs';
import { IN_APP_VIEWER_HOSTS, inAppViewerHost } from '../src/lib/inAppViewer.ts';

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
};

check('allowlist is exactly the two proven sites', IN_APP_VIEWER_HOSTS.join(',') === 'dealapp.sa,gathern.co');

// Allowed → in-app (returns the host).
check('dealapp ad → in-app', inAppViewerHost('https://dealapp.sa/ar/ad-details/530440') === 'dealapp.sa');
check('gathern ad → in-app', inAppViewerHost('https://gathern.co/view/193264/unit/270328') === 'gathern.co');
check('www. prefix still matches', inAppViewerHost('https://www.dealapp.sa/ar/ad-details/1') === 'dealapp.sa');
check('host match is case-insensitive', inAppViewerHost('https://Gathern.CO/view/1/unit/2') === 'gathern.co');

// Everyone else → unchanged (null).
for (const u of [
  'https://sa.aqar.fm/شقق-للإيجار/الرياض/123',
  'https://sa.aqar.fm/en/apartments/1',
  'https://wasalt.sa/ar/property/1',
  'https://aldarim.com/listing/1',
  'https://notdealapp.sa/x',          // suffix lookalike
  'https://dealapp.sa.evil.com/x',     // allowlisted host as a subdomain of another
  'https://evil.com/?u=https://dealapp.sa/x',
  '', null, undefined, 'not a url',
]) check(`${JSON.stringify(u)} → new tab (unchanged)`, inAppViewerHost(u) === null);

// Wiring.
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const open = readFileSync(new URL('../src/lib/openListing.ts', import.meta.url), 'utf8');
check('agent.tsx decides via inAppViewerHost()', /inAppViewerHost\(/.test(agent));
check('agent.tsx still tracks the open before either path', /trackOpen\(l\);\s*(?:if|openAd)/.test(agent));
check('agent.tsx still calls openListing() for everyone else', /openListing\(l\)/.test(agent));
check('openListing.ts web path is still window.open (new tab)', /window\.open\(url, '_blank', 'noopener,noreferrer'\)/.test(open));
check('openListing.ts native path is still expo-web-browser', /WebBrowser\.openBrowserAsync\(url/.test(open));
check('openListing.ts never imports the allowlist (native stays untouched)', !/inAppViewer/.test(open));

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ in-app viewer allowlist: decision + wiring verified');
