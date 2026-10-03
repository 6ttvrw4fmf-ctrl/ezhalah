// THE IN-APP AD VIEWER OPENS ONLY ALLOWLISTED HOSTS — executed, and the wiring checked.
//
// Owner 2026-10-03 (practice version, two sites): a dealapp.sa or gathern.co listing opens inside
// Ezhalah; every other site keeps today's behaviour (new tab on web, system browser on native).
// The decision is one pure function (src/lib/inAppViewer.ts) so this check RUNS it. It also pins
// the wiring, because a correct helper nothing calls is decoration: the agent screen must route
// through it, and the old open path must still exist unchanged for everyone else.

import { readFileSync } from 'node:fs';
import { IN_APP_VIEWER_HOSTS, MAX_AD_TABS, addAdTab, inAppViewerHost } from '../src/lib/inAppViewer.ts';

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

// The tab model (owner revision 2026-10-03): every allowed click opens a NEW tab; the same listing
// refronts its tab instead of duplicating; the strip caps at MAX_AD_TABS with the oldest evicted.
{
  const L = (id: number) => ({ source: 'Deal App', id });
  const a = addAdTab([], L(1));
  check('first click opens tab 0, active, no eviction', a.tabs.length === 1 && a.active === 0 && !a.evicted);
  const b = addAdTab(a.tabs, L(2));
  check('a second listing appends and activates', b.tabs.length === 2 && b.active === 1 && !b.evicted);
  const c = addAdTab(b.tabs, L(1));
  check('clicking an open card REFRONTS its tab (no duplicate)', c.tabs.length === 2 && c.active === 0 && !c.evicted);
  const full = addAdTab(Array.from({ length: MAX_AD_TABS }, (_, i) => L(i + 1)), L(99));
  check(`the strip caps at ${MAX_AD_TABS}: oldest evicted, flag raised, newest active`,
    full.tabs.length === MAX_AD_TABS && full.evicted && full.tabs[0].id === 2
    && full.tabs[full.tabs.length - 1].id === 99 && full.active === MAX_AD_TABS - 1);
}

// Wiring.
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const open = readFileSync(new URL('../src/lib/openListing.ts', import.meta.url), 'utf8');
check('agent.tsx decides via inAppViewerHost()', /inAppViewerHost\(/.test(agent));
check('agent.tsx still tracks the open before either path', /trackOpen\(l\);\s*(?:if|openAd)/.test(agent));
check('agent.tsx still calls openListing() for everyone else', /openListing\(l\)/.test(agent));
check('openListing.ts web path is still window.open (new tab)', /window\.open\(url, '_blank', 'noopener,noreferrer'\)/.test(open));
check('openListing.ts native path is still expo-web-browser', /WebBrowser\.openBrowserAsync\(url/.test(open));
check('openListing.ts never imports the allowlist (native stays untouched)', !/inAppViewer/.test(open));
// Closing must never go through history.back(): after the user acts inside an ad (Gathern «اختر»),
// the frame's navigation is on top of the joint session history, so back() steps the AD back instead
// of closing — measured live 2026-10-03 (✕ undid the booking step and the pane stayed open).
const viewer = readFileSync(new URL('../src/components/AdViewer.tsx', import.meta.url), 'utf8');
const viewerCode = viewer.replace(/\/\/.*$/gm, '');
check('AdViewer never closes via history.back()', !/history\.back\(/.test(viewerCode));
check('AdViewer frame delegates payment (checkout can continue inside)', /allow="[^"]*\bpayment\b/.test(viewer));

// Mutation proof — each of these broken worlds must be CAUGHT by the checks above, or the barrier
// is decoration (scripts/verify-new-barriers-are-mutation-proven.ts).
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? '✓' : '✗'} (mutation) catches ${label}`);
  if (!caught) failed++;
};
// A decision that lets EVERY host in (the "forgot the allowlist" mutant).
const letsEveryoneIn = (url: string | null | undefined) => { try { return new URL(url ?? '').hostname; } catch { return null; } };
mustCatch('a decision that opens every site in-app', letsEveryoneIn('https://sa.aqar.fm/x') !== null);
// A suffix match without the dot boundary (the lookalike mutant).
const sloppySuffix = (url: string) => IN_APP_VIEWER_HOSTS.find((h) => new URL(url).hostname.endsWith(h)) ?? null;
mustCatch('a host match without the dot boundary', sloppySuffix('https://notdealapp.sa/x') !== null);
// A third host slipped into the list without an embed proof.
mustCatch('an allowlist grown without proof', [...IN_APP_VIEWER_HOSTS, 'sa.aqar.fm'].join(',') !== 'dealapp.sa,gathern.co');
// The wiring regexes against mutated sources.
mustCatch('an agent screen that bypasses the allowlist', !/inAppViewerHost\(/.test(agent.replace(/inAppViewerHost\(/g, 'alwaysInApp(')));
mustCatch('a card open that skips trackOpen', !/trackOpen\(l\);\s*(?:if|openAd)/.test(agent.replace(/trackOpen\(l\);\s*/g, '')));
mustCatch('a web path that no longer opens a new tab', !/window\.open\(url, '_blank', 'noopener,noreferrer'\)/.test(open.replace("window.open(url, '_blank', 'noopener,noreferrer')", 'location.assign(url)')));
mustCatch('a native path that no longer uses the system browser', !/WebBrowser\.openBrowserAsync\(url/.test(open.replace('WebBrowser.openBrowserAsync(url', 'Linking.openURL(url')));
mustCatch('openListing importing the allowlist (native drift)', /inAppViewer/.test(open + "\nimport { inAppViewerHost } from './inAppViewer';"));
// Naive tab mutants: a bare push never evicts; a bare push duplicates a reopened card.
{
  const L = (id: number) => ({ source: 'Deal App', id });
  const naivePush = (tabs: { source: string; id: number }[], l: { source: string; id: number }) => [...tabs, l];
  mustCatch('a tab list that never evicts at the cap',
    naivePush(Array.from({ length: MAX_AD_TABS }, (_, i) => L(i + 1)), L(99)).length > MAX_AD_TABS);
  mustCatch('a tab opener that duplicates an already-open card', naivePush([L(1)], L(1)).length !== 1);
}

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ in-app viewer allowlist: decision + wiring verified, mutation-proven');
