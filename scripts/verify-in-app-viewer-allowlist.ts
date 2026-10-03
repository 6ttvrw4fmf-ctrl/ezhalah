// THE IN-APP AD VIEWER OPENS ONLY ALLOWLISTED HOSTS — executed, and the wiring checked.
//
// Owner 2026-10-03 (practice version, two sites): a dealapp.sa or gathern.co listing opens inside
// Ezhalah; every other site keeps today's behaviour (new tab on web, system browser on native).
// The decision is one pure function (src/lib/inAppViewer.ts) so this check RUNS it. It also pins
// the wiring, because a correct helper nothing calls is decoration: the agent screen must route
// through it, and the old open path must still exist unchanged for everyone else.

import { readFileSync } from 'node:fs';
import {
  EMPTY_AD_PANE, EMPTY_FRAME_NAV, IN_APP_VIEWER_HOSTS, MAX_AD_TABS, addAdTab, canFrameBack, canFrameForward,
  closeAdTab, frameDropped, frameNavigated, frameStepped, hideAdPane, inAppViewerHost, openAdTab,
  resolveAddressInput, showAdPane, splitUrlForDisplay, type AdPane, type AddressAction, type FrameNav,
} from '../src/lib/inAppViewer.ts';

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

// ── THE BROWSER PANE (owner 2026-10-03). Each contract below is a predicate over an IMPLEMENTATION,
// so the mutation proofs at the bottom run the very same predicate against a broken one.

// HIDE IS NOT CLOSE: the pane's ✕ hides (every tab kept); a tab's ✕ closes that tab; the last tab's
// ✕ clears the pane — no tabs and not hidden, so no «التبويبات (N)» chip with nothing behind it.
type Tab = { source: string; id: number };
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
  if (!(!back.hidden && back.tabs.length === 2 && back.active === 1)) bad.push('the chip shows the pane exactly as it was');
  const reopened = m.open(h, T(3));
  if (!(!reopened.hidden && reopened.tabs.length === 3 && reopened.active === 2)) bad.push('a card click on a hidden pane shows it, new tab fronted');
  const one = m.close(two, 0);
  if (!(one.tabs.length === 1 && one.tabs[0].id === 2 && one.active === 0 && !one.hidden)) bad.push('a tab ✕ closes THAT tab only');
  const mid = m.close({ tabs: [T(1), T(2), T(3)], active: 2, hidden: false }, 0);
  if (!(mid.tabs[mid.active]?.id === 3)) bad.push('closing a tab left of the active one keeps the same tab active');
  const none = m.close(one, 0);
  if (!(none.tabs.length === 0 && !none.hidden)) bad.push('the LAST tab ✕ clears the pane (no tabs, not hidden → no chip)');
  const hiddenLast = m.close(m.hide(one), 0);
  if (!(hiddenLast.tabs.length === 0 && !hiddenLast.hidden)) bad.push('an emptied pane is never left hidden');
  if (m.hide(EMPTY_AD_PANE).hidden) bad.push('an empty pane cannot be hidden');
  return bad;
};
const realPane: PaneImpl = { open: openAdTab, close: closeAdTab, hide: hideAdPane, show: showAdPane };
{ const bad = paneFails(realPane); check(`hide ≠ close: pane ✕ keeps tabs, tab ✕ removes one, last ✕ clears${bad.length ? ' — ' + bad.join('; ') : ''}`, bad.length === 0); }

// THE "+" INPUT: allowlisted site → in-app tab; any other URL → a real browser tab; words → a Google
// search in a real browser tab; only http(s) is ever opened.
const G = 'https://www.google.com/search?q=';
const addressFails = (f: (raw: string) => AddressAction | null): string[] => {
  const got = (x: string) => { const a = f(x); return a ? `${a.kind} ${a.url}` : 'null'; };
  const cases: Array<[string, string]> = [
    ['https://dealapp.sa/ar/ad-details/530440', 'in-app https://dealapp.sa/ar/ad-details/530440'],
    ['gathern.co/view/1/unit/2', 'in-app https://gathern.co/view/1/unit/2'],           // bare host gets https
    ['http://www.dealapp.sa/x', 'in-app https://www.dealapp.sa/x'],                    // no mixed-content frame
    ['https://sa.aqar.fm/x', 'new-tab https://sa.aqar.fm/x'],
    ['wasalt.sa', 'new-tab https://wasalt.sa/'],
    ['https://dealapp.sa.evil.com/x', 'new-tab https://dealapp.sa.evil.com/x'],        // lookalike stays out
    ['شقق للإيجار في الرياض', `search ${G}${encodeURIComponent('شقق للإيجار في الرياض')}`],
    ['villa riyadh', `search ${G}villa%20riyadh`],
    ['gathern', `search ${G}gathern`],                                                 // one word is a search
    ['javascript:alert(1)', `search ${G}${encodeURIComponent('javascript:alert(1)')}`],
    ['data:text/html,<b>x</b>', `search ${G}${encodeURIComponent('data:text/html,<b>x</b>')}`],
    ['   ', 'null'],
  ];
  return cases.filter(([input, want]) => got(input) !== want).map(([input]) => JSON.stringify(input));
};
{ const bad = addressFails(resolveAddressInput); check(`"+" input: allowlisted → in-app, other URL → new tab, words → Google in a new tab${bad.length ? ' — wrong for ' + bad.join(', ') : ''}`, bad.length === 0); }
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
  && /\{adPane\.hidden && adPane\.tabs\.length > 0 && \(/.test(src);
check('AdViewer: history.back() exists only as the gated toolbar ← step', backOnlyAsGatedStep(viewer));
check('AdViewer: close and hide retire the history marker in place, never by going back', closeAndHideDropTheMark(viewer));
check('AdViewer: a hidden pane stays mounted (frames alive, display none)', hiddenPaneStaysMounted(viewer));
check('AdViewer: the "+" input acts only on resolveAddressInput()', /const a = resolveAddressInput\(text\);/.test(viewer));
check('agent.tsx: pane ✕ → hideAdPane, tab ✕ → closeAdTab, reopen chip only while hidden with tabs', paneWiring(agent));
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

// The browser pane: every mutant below is run through the SAME contract predicate as the real code.
mustCatch('a pane ✕ that deletes the tabs', paneFails({ ...realPane, hide: () => ({ tabs: [], active: 0, hidden: true }) }).length > 0);
mustCatch('a tab ✕ that only hides the pane', paneFails({ ...realPane, close: (p) => ({ ...p, hidden: true }) }).length > 0);
mustCatch('a last-tab ✕ that leaves an empty hidden pane (chip over nothing)',
  paneFails({ ...realPane, close: (p, i) => ({ ...p, tabs: p.tabs.filter((_, x) => x !== i), active: 0 }) }).length > 0);
mustCatch('a card click that leaves the pane hidden', paneFails({ ...realPane, open: (p, l) => ({ ...openAdTab(p, l), hidden: p.hidden }) }).length > 0);
mustCatch('a "+" input that frames every URL',
  addressFails((raw) => { try { const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); return { kind: 'in-app', url: u.href, host: u.hostname }; } catch { return null; } }).length > 0);
mustCatch('a "+" input that opens any parsable URL (javascript:, data:)',
  addressFails((raw) => { try { return { kind: 'new-tab', url: new URL(raw.trim()).href }; } catch { return resolveAddressInput(raw); } }).length > 0);
mustCatch('a "+" input that treats words as a host', addressFails((raw) => (raw.trim() ? { kind: 'new-tab', url: `https://${raw.trim()}` } : null)).length > 0);
mustCatch('a "+" host match without the allowlist boundary',
  addressFails((raw) => { const a = resolveAddressInput(raw); return a && a.kind === 'new-tab' && a.url.includes('dealapp.sa') ? { kind: 'in-app', url: a.url, host: 'dealapp.sa' } : a; }).length > 0);
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

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ in-app viewer allowlist: decision + wiring verified, mutation-proven');
