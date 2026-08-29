// MOBILE UX POLISH PASS (owner 2026-08-29) — the four interaction contracts this pass introduced,
// pinned together because they shipped together and regress together:
//
//   1. SELECTOR ICON VISIBILITY: an option icon must NEVER derive its visibility from an ANIMATED
//      tintColor — Reanimated writes it per-frame and WebKit resolves RN-web tintColor through an
//      SVG filter, a combination Safari applies unreliably (the شراء icon vanished on a real iPhone
//      while Chromium looked fine). Icons crossfade two STATIC-tint layers by opacity instead.
//   2. CHAT OPENS AT LATEST: a sidebar conversation lands the viewport at its newest content, with
//      a bounded settle window that survives late card/image layout and is cancelled the instant
//      the user scrolls — never a jump loop.
//   3. SIDEBAR ROW TRUTH: the ⋯ context row takes the dark-green interaction state while its menu
//      is open; the active-chat highlight renders ONLY on the agent screen (the Filter home may
//      never highlight an old chat).
//   4. DIALOG DISMISSAL: every centered dialog carries a physical top-right ×.
//
//   node --experimental-strip-types scripts/verify-mobile-ux-polish-contract.ts   (runs by existence)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const ui = strip(readFileSync(join(root, 'src', 'components', 'ui.tsx'), 'utf8'));
const agent = strip(readFileSync(join(root, 'src', 'app', 'agent.tsx'), 'utf8'));
const sidebar = strip(readFileSync(join(root, 'src', 'components', 'Sidebar.tsx'), 'utf8'));
const account = strip(readFileSync(join(root, 'src', 'components', 'AccountMenu.tsx'), 'utf8'));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nMobile UX polish pass — interaction contracts\n');

// ── 1. selector icons ───────────────────────────────────────────────────────────────────────────
check('no ANIMATED tintColor exists anywhere in the selector system',
  !/tintColor:\s*interpolateColor/.test(ui));
check('both selector families render icons through the ONE crossfade component',
  /function CrossfadeTintIcon\(/.test(ui) && (ui.match(/<CrossfadeTintIcon /g) ?? []).length === 2);
check('the crossfade layers carry STATIC tints and animate OPACITY only',
  /\{ tintColor: off \}/.test(ui) && /\{ tintColor: on \}/.test(ui)
  && /opacity: 1 - p\.value/.test(ui) && /opacity: p\.value/.test(ui));

// ── 2. chat opens at latest ─────────────────────────────────────────────────────────────────────
check('openSaved lands at the latest content (both transcript and snapshot paths)',
  (agent.match(/landAtLatest\(\);/g) ?? []).length >= 2);
check('the settle window is BOUNDED and releases the pin at its end',
  /for \(const ms of \[150, 450, 900, 1600\]\)/.test(agent)
  && /setTimeout\(\(\) => \{ landTimersRef\.current = \[\]; pinModeRef\.current = 'none'; \}, 1900\)/.test(agent));
check('user scroll/touch cancels the landing immediately (their intent wins, no jump loop)',
  /document\.addEventListener\('wheel', stop, \{ passive: true, capture: true \}\)/.test(agent)
  && /document\.addEventListener\('touchstart', stop, \{ passive: true, capture: true \}\)/.test(agent)
  && /const cancelLanding = \(\) => \{/.test(agent));

// ── 3. sidebar row truth ────────────────────────────────────────────────────────────────────────
check('the ⋯ context row shares the dark-green interaction treatment while its menu is open',
  /const ctx = menu\?\.id === c\.id; const hot = ctx \|\|/.test(sidebar));
check('the active-chat highlight renders ONLY on the agent screen',
  /const onAgentScreen = pathname\?\.startsWith\('\/agent'\) \?\? false;/.test(sidebar)
  && /onAgentScreen && activeChatId === c\.id &&/.test(sidebar)
  && !/\[s\.histRow,[^\]]*[^t]activeChatId === c\.id && \(dark/.test(sidebar.replace(/onAgentScreen && activeChatId/g, 'GATED')));

// ── 4. dialog dismissal ─────────────────────────────────────────────────────────────────────────
check('every centered account dialog carries the top-right × (account / logout / delete)',
  /'account-popup-close' : view === 'signout' \? 'logout-popup-close' : 'delete-popup-close'/.test(account));
check('the chat-delete dialog carries the top-right × — PHYSICAL right under RTL',
  /testID="chat-delete-close"/.test(sidebar)
  && /dcClose: \{ position: 'absolute', top: 12, \.\.\.\(I18nManager\.isRTL \? \{ left: 12 \} : \{ right: 12 \}\)/.test(sidebar));
// The class rule across all three dialog files: a centered dialog's × must never use a bare
// direction-flipped `right:` — Arabic's forced RTL would land it on the physical LEFT.
check('every centered dialog × is direction-aware (AccountMenu + Sidebar + InfoModal)',
  /centerClose: \{ position: 'absolute', top: 12, \.\.\.\(I18nManager\.isRTL/.test(account)
  && /\.\.\.\(I18nManager\.isRTL \? \{ left: CLOSE_INSET \} : \{ right: CLOSE_INSET \}\)/.test(strip(readFileSync(join(root, 'src', 'components', 'InfoModal.tsx'), 'utf8'))));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mut = (src: string, from: string, to: string) => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from}`);
  return src.replace(from, to);
};

mustCatch('an animated tintColor creeping back into a selector',
  /tintColor:\s*interpolateColor/.test(
    mut(ui, '{ tintColor: off }', '{ tintColor: interpolateColor(p.value, [0,1], [off, on]) }')
      .replace('{ tintColor: interpolateColor(p.value, [0,1], [off, on]) }', 'tintColor: interpolateColor(x)')));
mustCatch('one selector family quietly dropping the crossfade component',
  (mut(ui, '<CrossfadeTintIcon source={icon}', '<AnimatedImage source={icon}').match(/<CrossfadeTintIcon /g) ?? []).length !== 2);
mustCatch('the landing losing its user-scroll cancellation',
  !/document\.addEventListener\('wheel', stop, \{ passive: true, capture: true \}\)/.test(
    mut(agent, "document.addEventListener('wheel', stop, { passive: true, capture: true });", '')));
mustCatch('the settle window becoming unbounded (pin never released)',
  !/setTimeout\(\(\) => \{ landTimersRef\.current = \[\]; pinModeRef\.current = 'none'; \}, 1900\)/.test(
    mut(agent, "landTimersRef.current.push(setTimeout(() => { landTimersRef.current = []; pinModeRef.current = 'none'; }, 1900));", '')));
mustCatch('the Filter home highlighting an old chat again (route gate removed)',
  !/onAgentScreen && activeChatId === c\.id &&/.test(
    mut(sidebar, 'onAgentScreen && activeChatId === c.id &&', 'activeChatId === c.id &&')));
mustCatch('the ⋯ context row losing its dark-green state',
  !/const ctx = menu\?\.id === c\.id; const hot = ctx \|\|/.test(
    mut(sidebar, 'const ctx = menu?.id === c.id; const hot = ctx ||', 'const hot =')));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ polish-pass contracts hold: icons visible, chats land at latest, sidebar truthful, dialogs dismissible\n');
