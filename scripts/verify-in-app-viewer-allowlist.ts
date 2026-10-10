// THE IN-APP AD VIEWER OPENS ONLY ALLOWLISTED HOSTS — executed, and the wiring checked.
//
// Owner 2026-10-03 (practice version, two sites): a dealapp.sa or gathern.co listing opens inside
// Ezhalah; every other site keeps today's behaviour (new tab on web, system browser on native).
// The decision is one pure function (src/lib/inAppViewer.ts) so this check RUNS it. It also pins
// the wiring, because a correct helper nothing calls is decoration: the agent screen must route
// through it, and the old open path must still exist unchanged for everyone else.

import ts from 'typescript';
import { liftSymbols } from './lib/liftSymbols.ts';
import * as arabicText from '../src/lib/arabicText.ts';
import { stripTypeScriptTypes } from 'node:module';
import { arabicOrPlaceholderForFreeText, translateTrailingPeriodWord } from '../src/lib/arabicText.ts';
import { readFileSync } from 'node:fs';
import { stripComments as codeOnly } from './lib/stripComments.ts';
import { windowBetween } from './lib/sourceWindow.ts';
import {
  EMPTY_AD_PANE, EMPTY_FRAME_NAV, IN_APP_VIEWER_HOSTS, IN_APP_PREVIEW_HOSTS, MAX_AD_TABS, adTabKey, canFrameBack, canFrameForward,
  closeAdTab, frameDropped, frameNavigated, frameStepped, hideAdPane, inAppPreviewHost, inAppViewerHost, openAdTab,
  showAdPane, splitUrlForDisplay, type AdPane, type FrameNav,
} from '../src/lib/inAppViewer.ts';
import { localizeAdUrl } from '../src/lib/adLocale.ts';

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

// The tab model (owner 2026-10-03: «I click Deal again, a new tab happens to Deal … as many tabs as
// possible»): EVERY allowed click opens a NEW tab, even for a listing that is already open; the strip
// caps at MAX_AD_TABS with the oldest evicted; ids only count up.
{
  const L = (id: number) => ({ source: 'Deal App', id });
  const a = openAdTab(EMPTY_AD_PANE, L(1));
  check('first click opens tab 0, active, no eviction', a.tabs.length === 1 && a.active === 0 && !a.evicted && a.tabs[0].tid === 1);
  const b = openAdTab(a, L(2));
  check('a second listing appends and activates', b.tabs.length === 2 && b.active === 1 && !b.evicted);
  const c = openAdTab(b, L(1));
  check('the SAME listing again opens a THIRD tab (no dedupe)', c.tabs.length === 3 && c.active === 2 && c.tabs[2].id === 1);
  check('two tabs of the same listing have different keys', adTabKey(c.tabs[0]) !== adTabKey(c.tabs[2]));
  let full: ReturnType<typeof openAdTab<{ source: string; id: number; tid?: number }>> = { ...EMPTY_AD_PANE, evicted: false };
  for (let i = 1; i <= MAX_AD_TABS + 1; i++) full = openAdTab(full, L(i));
  check(`the strip caps at ${MAX_AD_TABS}: oldest evicted, flag raised, newest active`,
    full.tabs.length === MAX_AD_TABS && full.evicted && full.tabs[0].id === 2
    && full.tabs[full.tabs.length - 1].id === MAX_AD_TABS + 1 && full.active === MAX_AD_TABS - 1);
  check('the cap is generous («as many tabs as possible»)', MAX_AD_TABS >= 12);
}

// ── THE BROWSER PANE (owner 2026-10-03). Each contract below is a predicate over an IMPLEMENTATION,
// so the mutation proofs at the bottom run the very same predicate against a broken one.

// HIDE IS NOT CLOSE: the pane's ✕ hides (every tab kept); a tab's ✕ closes that tab; the last tab's
// ✕ clears the pane — no tabs and not hidden. There is no on-screen reopen button (owner 2026-10-03):
// a hidden pane comes back with the next card click, or the browser's Forward.
type Tab = { source: string; id: number; tid?: number };
type PaneImpl = {
  open: (p: AdPane<Tab>, l: Tab) => AdPane<Tab>;
  close: (p: AdPane<Tab>, i: number) => AdPane<Tab>;
  hide: (p: AdPane<Tab>) => AdPane<Tab>;
  show: (p: AdPane<Tab>) => AdPane<Tab>;
};
const T = (id: number): Tab => ({ source: 'Deal App', id });
const paneFails = (m: PaneImpl): string[] => {
  const bad: string[] = [];
  const two = m.open(m.open(EMPTY_AD_PANE, T(1)), T(2));
  if (!(two.tabs.length === 2 && two.active === 1 && !two.hidden)) bad.push('two card clicks → two tabs, the second fronted, pane shown');
  const h = m.hide(two);
  if (!(h.hidden && h.tabs.length === 2 && h.active === 1 && h.tabs[0] === two.tabs[0])) bad.push('pane ✕ HIDES: every tab kept, same tab active');
  const back = m.show(h);
  if (!(!back.hidden && back.tabs.length === 2 && back.active === 1)) bad.push('a hidden pane shown again (browser Forward) is exactly as it was');
  const reopened = m.open(h, T(3));
  if (!(!reopened.hidden && reopened.tabs.length === 3 && reopened.active === 2)) bad.push('a card click on a hidden pane shows it, new tab fronted');
  const one = m.close(two, 0);
  if (!(one.tabs.length === 1 && one.tabs[0].id === 2 && one.active === 0 && !one.hidden)) bad.push('a tab ✕ closes THAT tab only');
  const mid = m.close({ tabs: [T(1), T(2), T(3)], active: 2, hidden: false, seq: 3 }, 0);
  if (!(mid.tabs[mid.active]?.id === 3)) bad.push('closing a tab left of the active one keeps the same tab active');
  const none = m.close(one, 0);
  if (!(none.tabs.length === 0 && !none.hidden)) bad.push('the LAST tab ✕ clears the pane (no tabs, not hidden → no chip)');
  const hiddenLast = m.close(m.hide(one), 0);
  if (!(hiddenLast.tabs.length === 0 && !hiddenLast.hidden)) bad.push('an emptied pane is never left hidden');
  if (m.hide(EMPTY_AD_PANE).hidden) bad.push('an empty pane cannot be hidden');
  // EVERY CLICK = A NEW TAB (owner 2026-10-03: «I go back and click on Deal again, a new tab happens»).
  const again = m.open(two, T(1));
  if (!(again.tabs.length === 3 && again.active === 2 && again.tabs[2].id === 1 && !again.hidden))
    bad.push('clicking an already-open listing opens a SECOND tab for it, fronted (no dedupe, no refront)');
  if (again.tabs[0] !== two.tabs[0] || again.tabs[1] !== two.tabs[1]) bad.push('the older tabs are left exactly as they were');
  if (new Set(again.tabs.map(adTabKey)).size !== 3) bad.push('two tabs of the SAME listing have different keys');
  const rch = m.open(m.hide(two), T(2));
  if (!(!rch.hidden && rch.active === 2 && rch.tabs.length === 3)) bad.push('clicking a card while the pane is hidden shows it with a NEW tab');
  const reopened2 = m.open(m.close(again, 2), T(1));
  const keyOf = (t?: Tab) => (t ? adTabKey(t) : 'none'); // a broken opener may not have a third tab at all
  if (keyOf(reopened2.tabs[2]) === keyOf(again.tabs[2])) bad.push('a tab id is never reused after its tab is closed');
  let many = EMPTY_AD_PANE as AdPane<Tab>;
  for (let i = 0; i < MAX_AD_TABS + 3; i++) many = m.open(many, T(1));
  if (!(many.tabs.length === MAX_AD_TABS && new Set(many.tabs.map(adTabKey)).size === MAX_AD_TABS && many.active === MAX_AD_TABS - 1))
    bad.push('many clicks of one card stay at the cap with unique keys, newest fronted');
  return bad;
};
const realPane: PaneImpl = { open: openAdTab, close: closeAdTab, hide: hideAdPane, show: showAdPane };
{ const bad = paneFails(realPane); check(`hide ≠ close: pane ✕ keeps tabs, tab ✕ removes one, last ✕ clears${bad.length ? ' — ' + bad.join('; ') : ''}`, bad.length === 0); }

{
  const d = splitUrlForDisplay('https://www.gathern.co/view/39851/unit/67245');
  check('address bar: host and path split, scheme and www dropped', d.host === 'gathern.co' && d.rest === '/view/39851/unit/67245');
  check('address bar: a bare origin shows the host alone', splitUrlForDisplay('https://dealapp.sa/').rest === '');
}

// ← / → mirror the browser's JOINT session history: history.back() moves whichever frame navigated
// last, so only that tab may be offered ←. Offering it to any other tab would step a hidden ad — or
// pop our own history marker and hide the pane.
type NavImpl = {
  navigated: (n: FrameNav, key: string) => FrameNav;
  dropped: (n: FrameNav, key: string) => FrameNav;
  canBack: (n: FrameNav, key: string) => boolean;
  canForward: (n: FrameNav, key: string) => boolean;
};
const navFails = (m: NavImpl): string[] => {
  const bad: string[] = [];
  const A = 'Deal App:1', B = 'Gathern:2';
  if (m.canBack(EMPTY_FRAME_NAV, A) || m.canForward(EMPTY_FRAME_NAV, A)) bad.push('a fresh tab has no ← / →');
  const a1 = m.navigated(EMPTY_FRAME_NAV, A);
  if (!(m.canBack(a1, A) && !m.canBack(a1, B) && !m.canForward(a1, A))) bad.push('after a navigation inside A: ← for A only');
  const stepped = frameStepped(a1, -1);
  if (!(m.canForward(stepped, A) && !m.canBack(stepped, A))) bad.push('after ←: → is on, ← is off');
  const ab = m.navigated(a1, B);
  if (!(m.canBack(ab, B) && !m.canBack(ab, A))) bad.push('only the tab that navigated LAST gets ←');
  const afterStepThenB = m.navigated(stepped, B);
  if (!(m.canBack(afterStepThenB, B) && !m.canForward(afterStepThenB, A) && !m.canForward(afterStepThenB, B))) bad.push('a new navigation replaces the forward entries');
  const closedB = m.dropped(ab, B);
  if (!(m.canBack(closedB, A) && !m.canBack(closedB, B))) bad.push('closing/reloading B puts A back on top');
  if (m.canBack(m.dropped(a1, A), A)) bad.push('⟳ on the only navigated tab turns ← off');
  return bad;
};
const realNav: NavImpl = { navigated: frameNavigated, dropped: frameDropped, canBack: canFrameBack, canForward: canFrameForward };
{ const bad = navFails(realNav); check(`← / → follow the joint session history${bad.length ? ' — ' + bad.join('; ') : ''}`, bad.length === 0); }

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
// The toolbar's ← is the ONE sanctioned back(): it steps the ad's own frame, and only behind the
// canFrameBack gate — without the gate it would pop our history marker instead.
const viewer = readFileSync(new URL('../src/components/AdViewer.tsx', import.meta.url), 'utf8');
const stripComments = (src: string) => src.replace(/\/\/.*$/gm, '');
const backOnlyAsGatedStep = (src: string) => {
  const code = stripComments(src);
  return (code.match(/history\.back\(/g) ?? []).length === 1 && !/history\.go\(/.test(code)
    && /const step = \(dir: -1 \| 1\) => \{\s*if \(!IS_WEB \|\| !\(dir < 0 \? canFrameBack : canFrameForward\)\(navRef\.current, curKey\)\) return;[\s\S]*?if \(dir < 0\) window\.history\.back\(\); else window\.history\.forward\(\);\s*\};/.test(code);
};
const closeAndHideDropTheMark = (src: string) => {
  const code = stripComments(src);
  return /const requestClose = \(\) => \{ dropMark\(\); dismiss\(\); \};/.test(code)
    && /const requestHide = \(\) => \{ dropMark\(\); hide\(\); \};/.test(code);
};
const hiddenPaneStaysMounted = (src: string) => /style=\{\[s\.split, motion, hidden && s\.pageHidden\]\}/.test(src);
const paneWiring = (src: string) => /onHide=\{\(\) => commitAdPane\(hideAdPane\(adPaneRef\.current\)\)\}/.test(src)
  && /onCloseTab=\{\(i\) => commitAdPane\(closeAdTab\(adPaneRef\.current, i\)\)\}/.test(src)
 ;
check('AdViewer: history.back() exists only as the gated toolbar ← step', backOnlyAsGatedStep(viewer));
check('AdViewer: close and hide retire the history marker in place, never by going back', closeAndHideDropTheMark(viewer));
check('AdViewer: a hidden pane stays mounted (frames alive, display none)', hiddenPaneStaysMounted(viewer));
check('agent.tsx: pane ✕ → hideAdPane, tab ✕ → closeAdTab', paneWiring(agent));
check('agent.tsx: no on-screen «التبويبات (N)» reopen button (owner: no need)', !/ad-tabs-chip|tabsChip/.test(agent));
check('agent.tsx: laptop cards use the wider grid', /<ResultCardGrid wide=\{viewerSplit\}>/.test(agent));
const grid = readFileSync(new URL('../src/components/ResultCardGrid.tsx', import.meta.url), 'utf8');
check('ResultCardGrid: wide stays inside the 940px chat column', /gridWide: \{ maxWidth: (\d+) \}/.test(grid) && Number(/gridWide: \{ maxWidth: (\d+) \}/.exec(grid)![1]) > 640 && Number(/gridWide: \{ maxWidth: (\d+) \}/.exec(grid)![1]) <= 940);
// Each tab's frame is keyed by its own unique tab id (adTabKey), so a second tab of the SAME listing is
// a second frame, not the first one revived.
const frameKeyUsesTabKey = (src: string) => /const k = adTabKey\(tab\);\s*return <TabFrame key=\{`\$\{k\}#\$\{reloads\[k\] \?\? 0\}`\}/.test(src);
check('AdViewer: every tab is its own frame, keyed by its unique tab id', frameKeyUsesTabKey(viewer));
check('no «+» tab, no start page, no address input anywhere (owner: no need)', !/ad-tab-new|onNewTab|StartPage|resolveAddressInput|ad-start-input/.test(viewer + agent));
check('agent.tsx: every card click goes through openAdTab', /openAdTab\(adPaneRef\.current, tab\)/.test(agent));
// THE AD OPENS IN THE APP'S LANGUAGE (owner 2026-10-03).
const D = 'https://dealapp.sa/ar/ad-details/541315', DE = 'https://dealapp.sa/en/ad-details/541315';
const G1 = 'https://gathern.co/view/193264/unit/270328', GE = 'https://gathern.co/en/view/193264/unit/270328';
const localeFails = (f: (u: string, l: string) => string | undefined): string[] => {
  const bad: string[] = [];
  const eq = (got: unknown, want: unknown, what: string) => { if (got !== want) bad.push(`${what} (got ${String(got)})`); };
  eq(f(D, 'ar'), D, 'Arabic app keeps a Deal App /ar/ ad');
  eq(f(DE, 'ar'), D, 'Arabic app turns a /en/ Deal App ad into /ar/');
  eq(f(D, 'en'), DE, 'English app turns a Deal App /ar/ ad into /en/');
  eq(f(G1, 'ar'), G1, 'Arabic app keeps the unprefixed (Arabic) Gathern ad');
  eq(f(GE, 'ar'), G1, 'Arabic app strips /en from a Gathern ad');
  eq(f(G1, 'en'), GE, 'English app adds /en to a Gathern ad');
  eq(f(GE, 'en'), GE, 'English app does not double the /en');
  eq(f('https://sa.aqar.fm/x/1', 'en'), 'https://sa.aqar.fm/x/1', 'other sites are untouched');
  eq(f('', 'ar'), undefined, 'empty in, undefined out');
  return bad;
};
{ const bad = localeFails(localizeAdUrl); check(`Arabic app → Arabic ad (Deal App /ar, Gathern bare), English app → /en${bad.length ? ' — ' + bad.join('; ') : ''}`, bad.length === 0); }
check('openListing.ts builds ONE ad URL in the app language for the frame and the new tab', /localizeAdUrl\(url, getLocale\(\)\)/.test(open));
// LOADING (owner 2026-10-03: «it takes so long … make sure we never have this issue»): the page is
// visible from its first paint — no opaque cover waiting for the frame's `load` (all images and
// trackers), and a slow page is never removed; a slow page only gets a dismissible «new window» pill.
const frameNeverCoveredOrRemoved = (src: string) => {
  const tf = windowBetween(src, 'function TabFrame', 'function TabIcon', 'AdViewer.tsx');
  return /\{\/\* Always mounted[^\n]*\*\/\}\s*\{\(\s*<Frame/.test(tf)      // the frame is unconditional
    && !/\{!\w+ && \(\s*<Frame/.test(tf)                                      // nothing gates it
    && !/s\.cover\b/.test(tf)                                                   // no full-page cover
    && /testID="ad-load-bar"/.test(tf) && /testID="ad-slow-hint"/.test(tf);
};
check('AdViewer: a loading page is visible at once (thin bar), never covered, never removed when slow', frameNeverCoveredOrRemoved(viewer));
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
// Tab-model mutants, run through the same contract predicate as the real code.
// The browser pane: every mutant below is run through the SAME contract predicate as the real code.
mustCatch('a card click that refronts an open listing instead of opening a new tab',
  paneFails({ ...realPane, open: (p, l) => { const i = p.tabs.findIndex((t) => t.id === l.id && t.source === l.source); return i >= 0 ? { ...p, active: i, hidden: false } : openAdTab(p, l); } }).length > 0);
mustCatch('a tab id that is reused after a close',
  paneFails({ ...realPane, open: (p, l) => { const o = openAdTab(p, l); const tid = Math.max(0, ...p.tabs.map((t) => t.tid ?? 0)) + 1; return { ...o, tabs: o.tabs.map((t, i) => (i === o.tabs.length - 1 ? { ...t, tid } : t)) }; } }).length > 0);
mustCatch('a strip that never evicts at the cap',
  paneFails({ ...realPane, open: (p, l) => ({ tabs: [...p.tabs, { ...l, tid: p.seq + 1 }], active: p.tabs.length, hidden: false, seq: p.seq + 1 }) }).length > 0);
mustCatch('two tabs of one listing sharing a key (ids ignored)', paneFails({ ...realPane, open: (p, l) => { const o = openAdTab(p, l); return { ...o, tabs: o.tabs.map((t) => ({ ...t, tid: 1 })) }; } }).length > 0);
mustCatch('a frame keyed by the listing only (a second tab would revive the first frame)',
  !frameKeyUsesTabKey(viewer.replace('const k = adTabKey(tab);', 'const k = `${tab.source}:${tab.id}`;')));
mustCatch('a frame removed when the page is slow', !frameNeverCoveredOrRemoved(viewer.replace('{(\n        <Frame', '{!failed && (\n        <Frame')));
mustCatch('an opaque cover over a loading page', !frameNeverCoveredOrRemoved(viewer.replace('testID="ad-load-bar"', 'testID="ad-load-bar" style={s.cover}')));
mustCatch('a loading page with no slow-page way out', !frameNeverCoveredOrRemoved(viewer.replace('testID="ad-slow-hint"', 'testID="x"')));
mustCatch('a «+» tab coming back', /ad-tab-new/.test(viewer + 'testID="ad-tab-new"'));
mustCatch('an ad language that ignores the app language', localeFails((u) => u).length > 0);
mustCatch('an English app that doubles Gathern /en', localeFails((u, l) => (l === 'en' && u.includes('gathern.co') ? u.replace('gathern.co', 'gathern.co/en') : localizeAdUrl(u, l))).length > 0);
mustCatch('an Arabic app that leaves Deal App on /en', localeFails((u, l) => localizeAdUrl(u, 'en')).length > 0);
mustCatch('a pane ✕ that deletes the tabs', paneFails({ ...realPane, hide: () => ({ tabs: [], active: 0, hidden: true }) }).length > 0);
mustCatch('a tab ✕ that only hides the pane', paneFails({ ...realPane, close: (p) => ({ ...p, hidden: true }) }).length > 0);
mustCatch('a last-tab ✕ that leaves an empty hidden pane (chip over nothing)',
  paneFails({ ...realPane, close: (p, i) => ({ ...p, tabs: p.tabs.filter((_, x) => x !== i), active: 0 }) }).length > 0);
mustCatch('a card click that leaves the pane hidden', paneFails({ ...realPane, open: (p, l) => ({ ...openAdTab(p, l), hidden: p.hidden }) }).length > 0);
// A per-tab load counter (the naive design): any tab that ever navigated is offered ←.
mustCatch('a per-tab ← that ignores which frame navigated last',
  navFails({ ...realNav, canBack: (n, key) => n.stack.slice(0, n.pos).includes(key) }).length > 0);
mustCatch('a tab close that leaves its history entries behind', navFails({ ...realNav, dropped: (n) => n }).length > 0);
mustCatch('a navigation that keeps stale forward entries',
  navFails({ ...realNav, navigated: (n, key) => ({ stack: [...n.stack, key], pos: n.pos + 1 }) }).length > 0);
mustCatch('a hide that goes back in history',
  !backOnlyAsGatedStep(viewer.replace('const requestHide = () => { dropMark(); hide(); };', 'const requestHide = () => { window.history.back(); };')));
mustCatch('a ← step without the canFrameBack gate',
  !backOnlyAsGatedStep(viewer.replace('!(dir < 0 ? canFrameBack : canFrameForward)(navRef.current, curKey)', 'false')));
mustCatch('a hide that skips dropMark', !closeAndHideDropTheMark(viewer.replace('const requestHide = () => { dropMark(); hide(); };', 'const requestHide = () => { hide(); };')));
mustCatch('a hidden pane that is unmounted instead of hidden', !hiddenPaneStaysMounted(viewer.replace('hidden && s.pageHidden]}>', ']}>')));
mustCatch('a pane ✕ wired to closing every tab', !paneWiring(agent.replace('commitAdPane(hideAdPane(adPaneRef.current))', 'commitAdPane(EMPTY_AD_PANE)')));


// Aqar uses already-loaded data, never an iframe. Keep these predicates over code only so a
// comment describing the intended behaviour cannot make a broken implementation pass.
const previewUrls: Array<[string | null | undefined, string | null]> = [
  ['https://sa.aqar.fm/شقق-للبيع/الرياض/غرب-الرياض/حي-المهدية/شارع-عفيف-الدين-الثقفي-حي-المهدية-مدينة-الرياض-منطقة-الرياض-6580954', 'sa.aqar.fm'],
  ['https://sa.aqar.fm/DailyRenting/1', 'sa.aqar.fm'],
  ...['https://dealapp.sa/x', 'https://gathern.co/x', 'https://sanadak.sa/x',
    'https://notsa.aqar.fm/x', 'https://sa.aqar.fm.evil.com/x',
    'https://evil.com/?u=https://sa.aqar.fm/x', 'https://sub.sa.aqar.fm/x', '', 'not a url', null, undefined]
    .map((u): [typeof u, null] => [u, null]),
];
const previewHostsPass = (f: typeof inAppPreviewHost) => previewUrls.every(([u, host]) => f(u) === host);
check('Aqar and Monthly preview; other hosts and lookalikes do not', previewHostsPass(inAppPreviewHost));
mustCatch('preview missing for Aqar', !previewHostsPass(() => null));
mustCatch('preview accepts a suffix lookalike', !previewHostsPass((u) => u?.includes('sa.aqar.fm') ? 'sa.aqar.fm' : null));
mustCatch('iframe sources rerouted to previews', !previewHostsPass((u) => inAppPreviewHost(u) ?? inAppViewerHost(u)));

// Independent owner-approved host contract: each positive/negative is executed, including www,
// lookalike and unapproved-subdomain cases. Each site's missing route is mutation-proven.
const additionalPreviewHosts = [
  'wasalt.sa',
  'sa.sakan.co',
  'abralosol.com',
  'nofodh.sa',
  'arkaanalaqar.com',
  'bossbihoffice.com.sa',
  'ksaaqar.com',
  'mustqr.sa',
  'aqalemhajer.com',
  'alshawaf.com.sa',
  'rightcompound.com',
  'reinvest.sa',
  'marketplace.sirdab.co',
  'therc.aqar.digital',
  'app.abaadapp.sa',
  'sokok.sa',
  'raghdan.sa',
  'alsaedan.com',
  'nufouth.com',
  'akariyoun.sa',
  'sakani.sa',
  'sukna.app',
  'goldendeal.sa',
  'aqargate.com',
  'aldarim.sa',
  'shomoalaqar.com.sa',
  'abwbna.com',
  'jazwtn.sa',
  'alobidoffice.com',
  '1000.com.sa',
  'aljassimaqar.com',
  'maqrat.com',
  'sa.opensooq.com',
  'manafe.com.sa',
  'map.earthapp.com.sa',
  'senanrealestate.sa',
  'bahadhabab-res.com',
  'property.maqamco.sa',
  'erapulse.sa',
  'jawher2030.com',
  'm3tmd.com',
  'mizlaj.com.sa',
  'azure.sa',
  'app.holoul.io',
  'arshglobal.com.sa',
  'superoffice.sa',
  'flow.life',
  'hasaadestate.com',
  'yameen.sa',
  'maktab.sa',
];
const hostPass = (host: string, previewHost: typeof inAppPreviewHost, frameHost = inAppViewerHost) =>
  [`https://${host}/ad/1`, `https://www.${host}/ad/1`, `https://${host.toUpperCase()}/ad/1`]
    .every((url) => previewHost(url) === host && frameHost(url) === null)
  && [`https://evil.${host}/ad/1`, `https://${host}.evil.test/ad/1`, `https://not${host}/ad/1`]
    .every((url) => previewHost(url) === null);
for (const host of additionalPreviewHosts) {
  check(`${host}: exact + www preview, never iframe or lookalike`, hostPass(host, inAppPreviewHost));
  mustCatch(`${host}: missing preview route`, !hostPass(host, (u) => inAppPreviewHost(u) === host ? null : inAppPreviewHost(u)));
  mustCatch(`${host}: accidentally framed`, !hostPass(host, inAppPreviewHost, (u) => inAppPreviewHost(u)));
  mustCatch(`${host}: unapproved subdomain`, !hostPass(host, (u) => u === `https://evil.${host}/ad/1` ? host : inAppPreviewHost(u)));
}
const disjoint = (previews: readonly string[], frames: readonly string[]) =>
  previews.every((p) => frames.every((f) => p !== f && !p.endsWith('.' + f)));
check('preview and iframe allowlists never overlap', disjoint(IN_APP_PREVIEW_HOSTS, IN_APP_VIEWER_HOSTS));
mustCatch('same host added to both lists', !disjoint([...IN_APP_PREVIEW_HOSTS, 'dealapp.sa'], IN_APP_VIEWER_HOSTS));
mustCatch('preview is a framed subdomain', !disjoint([...IN_APP_PREVIEW_HOSTS, 'sub.gathern.co'], IN_APP_VIEWER_HOSTS));

const previewRoute = (src: string) => {
  const route = windowBetween(codeOnly(src), 'const openAd =', 'pushAdTab({ source: l.source, id: l.id, title: listingLocationAr(l), url: url ?? \'\' });', 'agent.tsx');
  return /if \(IS_WEB && inAppPreviewHost\(url\)\) \{\s*pushAdTab\(\{[^}]*listing: l\s*\}\);\s*return;\s*\}\s*if \(!\(IS_WEB && inAppViewerHost\(url\)\)\) \{ void openListing\(l\); return; \}/.test(route);
};
check('preview precedes external fallback and carries the card Listing', previewRoute(agent));
const previewBranch = windowBetween(agent, '    if (IS_WEB && inAppPreviewHost(url))', '    if (!(IS_WEB && inAppViewerHost(url)))', 'agent preview route');
const externalFallback = '    if (!(IS_WEB && inAppViewerHost(url))) { void openListing(l); return; }';
mustCatch('preview branch after external fallback', !previewRoute(agent.replace(previewBranch + externalFallback, externalFallback + '\n' + previewBranch)));
mustCatch('preview drops the card data', !previewRoute(agent.replace(', listing: l', '')));

const previewRender = (src: string) => {
  const body = windowBetween(codeOnly(src), 'const body =', 'if (split)', 'AdViewer.tsx');
  const branch = windowBetween(body, 'if (tab.listing)', 'return <TabFrame', 'AdViewer preview branch');
  return /if \(tab.listing\) return \(/.test(branch)
    && /<ListingPreview listing=\{tab.listing\} url=\{tab.url\}/.test(branch)
    && /reloads\[adTabKey\(tab\)\]/.test(branch) && /i !== active && s.pageHidden/.test(branch)
    && !/<(?:iframe|Frame|TabFrame)\b|ad-load-bar|ad-slow-hint/.test(branch);
};
check('preview tabs render only native content, stay mounted, and reload by key', previewRender(viewer));
mustCatch('preview renders an iframe', !previewRender(viewer.replace('<ListingPreview listing=', '<iframe listing=')));
mustCatch('preview also renders a loading frame', !previewRender(viewer.replace('<ListingPreview listing=', '<TabFrame /><ListingPreview listing=')));
const previewNav = (src: string) => ['Back', 'Forward'].every((d) => codeOnly(src).includes(`disabled={!!current?.listing || !canFrame${d}(nav, curKey)}`));
check('preview back and forward are disabled', previewNav(viewer));
mustCatch('preview back enabled', !previewNav(viewer.replace('!!current?.listing || !canFrameBack', '!canFrameBack')));

const preview = readFileSync(new URL('../src/components/ListingPreview.tsx', import.meta.url), 'utf8');
// The price is the shared listingPrice() string, split into numeral / unit runs for the type only
// (priceRuns keeps the text byte-identical) — never the raw price fields.
const previewPrice = (src: string) => {
  const code = codeOnly(src);
  return /priceRuns\(listingPrice\(l, locale\)\)/.test(code) && !/\bl\.(?:price|priceAnnual|pricePerMeter)\b/.test(code);
};
// window.open with 'noopener' always returns null, so the page opens plainly and severs the opener by
// hand — that is what lets a blocked tab be told apart from an opened one (and never navigates us away).
const previewContact = (src: string) => /const w = window\.open\(url, '_blank'\);\s*if \(w\) w\.opener = null;/.test(codeOnly(src)) && !/window\.location/.test(codeOnly(src));
const previewPhotos = (src: string) => {
  const code = codeOnly(src);
  return /l\.photos\?\.length \? l\.photos : \[l\.photo\]/.test(code)
    && /priority="high" loading="eager"/.test(code) && /priority="low" loading="lazy"/.test(code);
};
check('preview price only uses the shared price contract', previewPrice(preview));
check('contact opens the original URL in a new tab with the opener severed, never by navigating this tab', previewContact(preview));
check('source-ordered gallery prioritizes the shown photo and lazy-loads the rest', previewPhotos(preview));
mustCatch('preview formats its own price', !previewPrice(preview.replace('listingPrice(l, locale)', 'l.price')));
mustCatch('contact drops opener protection', !previewContact(preview.replace('if (w) w.opener = null;', '')));
mustCatch('a blocked tab navigates Ezhalah away', !previewContact(preview.replace("if (!open()) blockedOnce.current = true;\n      busy.current = false;", "if (!open()) window.location.assign(url);\n      busy.current = false;")));
mustCatch('90 photos load eagerly', !previewPhotos(preview.replaceAll('loading="lazy"', 'loading="eager"')));


// Execute the actual facts block (the key line's stats + the details rows) against real-world raw-field
// shapes: Aqar's age is numeric even though Listing types it as a string. The live browser caught
// .trim() crashing the whole screen. A field the source left silent must stay ABSENT — never «0».
const factsPass = (src: string) => {
  const block = windowBetween(codeOnly(src), 'const facts:', 'const place =', 'ListingPreview facts');
  const facts = new Function('l', 't', 'locale', 'arabicOrPlaceholderForFreeText', 'translateTrailingPeriodWord', 'DIRECTION_LABEL', 'ATTRIBUTE_UNRESOLVED_AR', stripTypeScriptTypes(block) + '\nreturn { facts, stats };');
  const run = (l: object) => facts(l, (s: string) => s, 'en', arabicOrPlaceholderForFreeText, translateTrailingPeriodWord, {}, 'unknown') as { facts: string[][]; stats: string[] };
  try {
    const empty = run({ area: 0, beds: 0, bathrooms: null });
    const numeric = run({ area: 147, beds: 4, property_age: 0, direction: null });
    const text = run({ property_age: '2', rentPeriod: 'monthly' });
    return empty.facts.length === 0 && empty.stats.length === 0
      && numeric.stats.length === 2 && numeric.facts.length === 1 && numeric.facts.some(([k, v]) => k === 'Age' && v === 'New construction')
      && text.facts.some(([k, v]) => k === 'Age' && v === '2') && text.facts.some(([k, v]) => k === 'Rent period' && v === 'Monthly');
  } catch { return false; }
};
check('missing facts stay absent; numeric age never crashes and zero age means new', factsPass(preview));
mustCatch('raw numeric age crashes on string trim', !factsPass(preview.replace("String(l.property_age ?? '').trim()", "l.property_age?.trim()")));
mustCatch('missing area becomes a zero stat', !factsPass(preview.replace('if (l.area > 0)', 'if (true)')));

// Execute the actual TSX render with host components represented as inspectable nodes. Real
// sourceName and AR dictionary/translation run unchanged; no replica of preview render logic.
const display = await liftSymbols(new URL('../src/lib/listingDisplay.ts', import.meta.url).pathname,
  [{ header: 'export function sourceName' }], ['sourceName']);
const i18n = await liftSymbols(new URL('../src/i18n.tsx', import.meta.url).pathname,
  [{ header: 'const AR:' }, { header: 'function fill' }, { header: 'const EN:' }, { header: 'export function translate' }], ['translate']);
const translate = i18n.translate as (locale: string, key: string, vars?: Record<string, string | number>) => string;
type Node = { type: string; props: Record<string, any> };
const renderPreview = (src: string, source: string, locale: string, photos: string[] = []) => {
  const jsx = (type: string, props: Record<string, any>) => ({ type, props });
  const output = ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useState: (value: unknown) => [value, () => {}], useEffect: () => {}, useRef: (value: unknown) => ({ current: value }) },
    'react-native': { Platform: { OS: 'web' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (x: unknown) => x } },
    'expo-image': { Image: 'Image' }, '@expo/vector-icons/Ionicons': { default: 'Ionicons' },
    '@/theme/tokens': { colors: {}, radius: {}, font: { family: {} }, lightColors: {} }, '@/theme/palette': { TAP44: {}, BUZZER_GOLD: {} },
    '@/i18n': { useI18n: () => ({ locale, isRTL: locale === 'ar', t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars) }) },
    '@/lib/listingDisplay': { ...display, listingPrice: () => 'shared-price' },
    '@/lib/arabicText': arabicText,
    '@/lib/translitPlace': { translitPlace: (x: string) => x }, '@/lib/afEvidence': { DIRECTION_LABEL: {} },
    '@/lib/useAtLeast': { useAtLeast: () => false }, '@/lib/responsive': { PICKER_SHEET_BREAKPOINT: 768 }, '@/lib/useReducedMotion': { useReducedMotion: () => true },
    '@/components/ResultCard': { SourceBadge: 'SourceBadge', FEATURE_META: [], arAttrValue: (_l: string, v: string) => v },
    '@/data/adPageData': { fetchAdPin: () => Promise.resolve(null), mapEmbedUrl: () => '' },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', output)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected preview dependency: ${name}`);
    return modules[name];
  }, exports);
  return exports.default({ listing: { source, photos, photo: null, city: 'Riyadh', district: '', type: 'Apartment', area: 0, beds: 0 }, url: 'https://example.com/ad/1' }) as Node;
};
const nodes = (root: any): Node[] => !root || typeof root !== 'object' ? [] : Array.isArray(root)
  ? root.flatMap(nodes) : [root, ...nodes(root.props?.children)];
const textOf = (root: any): string => root == null || root === false ? '' : typeof root !== 'object'
  ? String(root) : Array.isArray(root) ? root.map(textOf).join('') : textOf(root.props?.children);
// The places the page names the site — the top-bar pill and the button to the real ad — all use the
// card's source name (Aqar = عقار), in AR and EN alike.
const namingPass = (src: string) => ['AQAR', 'Wasalt', 'Abr Alosol', 'THE RC', 'عقاريون', 'Sakan'].every((source) =>
  ['ar', 'en'].every((locale) => {
    const tree = renderPreview(src, source, locale);
    const name = translate(locale, (display.sourceName as (s: string) => string)(source));
    const texts = nodes(tree).filter((n) => n.type === 'Text').map(textOf);
    const contact = nodes(tree).find((n) => n.props.testID === 'listing-preview-contact');
    return !!contact && textOf(contact) === translate(locale, 'Tap here to contact') + translate(locale, "and to confirm it's still on {siteName}", { siteName: name }) + '👈'
      && contact.props.accessibilityLabel === translate(locale, 'Open the ad on {name} to contact', { name })
      && texts.some((x) => x.startsWith(`${name} · `))
      && (source !== 'AQAR' || locale !== 'ar' || name === 'عقار');
  }));
check('rendered pill and the open button use the card source name in AR + EN (Aqar = عقار)', namingPass(preview));
mustCatch('contact hardcodes Aqar', !namingPass(preview.replace(`{t("and to confirm it's still on {siteName}", { siteName: name })}`, `{t("and to confirm it's still on {siteName}", { siteName: t('AQAR') })}`)));
mustCatch('contact loses its spoken name', !namingPass(preview.replace(/accessibilityLabel=\{t\('Open the ad on \{name\} to contact', \{ name \}\)\}(\s+accessibilityElementsHidden=\{!live\})/, '$1')));
mustCatch('raw source bypasses translated card name', !namingPass(preview.replace('t(sourceName(l.source))', 'l.source')));
const noPhotoPass = (src: string) => {
  const empty = nodes(renderPreview(src, 'Wasalt', 'ar'));
  const single = nodes(renderPreview(src, 'Wasalt', 'en', ['https://example.com/photo.jpg']));
  return !empty.some((n) => n.type === 'Image' || n.props.testID === 'listing-preview-gallery')
    && empty.some((n) => n.props.testID === 'listing-preview-contact') && empty.some((n) => textOf(n) === 'shared-price')
    && single.filter((n) => n.type === 'Image').length === 1 && single.some((n) => n.props.testID === 'listing-preview-gallery');
};
// The host badge beside the price is a second door to the same ad: the SAME handler as the sticky bar.
const hostBadgePass = (src: string) => ['ar', 'en'].every((locale) => {
  const all = nodes(renderPreview(src, 'AQAR', locale));
  const host = all.find((n) => n.props.testID === 'listing-preview-host');
  const contact = all.find((n) => n.props.testID === 'listing-preview-contact');
  return !!host && !!contact && host.props.onPress === contact.props.onPress && host.props.accessibilityLabel === contact.props.accessibilityLabel;
});
check('the host badge opens the ad through the contact handler, with the same spoken name', hostBadgePass(preview));
// The tap moment delays the real open behind a pop-up — it must stay inside the browser's user-activation
// window (≤ 1s) or Safari blocks the tab; and the open is still the one window.open.
const tapMomentPass = (src: string) => {
  const code = codeOnly(src);
  const delay = Number((/const OPEN_DELAY_MS = (\d+);/.exec(code) ?? [])[1]);
  return delay > 0 && delay <= 1000 && /later\(fire, OPEN_DELAY_MS\);/.test(code) && /const fire = \(\) => \{\s*if \(!open\(\)\) blockedOnce\.current = true;/.test(code)
    && /if \(reduced \|\| blockedOnce\.current \|\| !IS_WEB\) \{ if \(!open\(\)\) blockedOnce\.current = true; return; \}/.test(code);
};
check('the delayed open stays inside the user-activation window and goes through open()', tapMomentPass(preview));
mustCatch('the open drifts past the activation window', !tapMomentPass(preview.replace('const OPEN_DELAY_MS = 950;', 'const OPEN_DELAY_MS = 2000;')));
mustCatch('the party opens the ad some other way', !tapMomentPass(preview.replace('const fire = () => {', "const fire = () => {\n      window.location.assign(url); return;")));
mustCatch('reduced motion still waits for the party', !tapMomentPass(preview.replace('if (reduced || blockedOnce.current || !IS_WEB)', 'if (blockedOnce.current || !IS_WEB)')));
mustCatch('host badge opens something else', !hostBadgePass(preview.replace(/testID="listing-preview-host"\s+onPress=\{goOpen\}/, 'testID="listing-preview-host" onPress={openMap}')));
check('zero photos renders complete details without image/empty gallery; one photo renders one image', noPhotoPass(preview));
mustCatch('no-photo listing gets an empty gallery/broken image', !noPhotoPass(preview.replace('photos.length > 0 &&', 'true &&')));
mustCatch('single-photo listing loses its gallery', !noPhotoPass(preview.replace('photos.length > 0 &&', 'photos.length > 1 &&')));

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ in-app viewer allowlist: decision + wiring verified, mutation-proven');
