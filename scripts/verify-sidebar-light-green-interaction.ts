// Sidebar presentation, owner 2026-10-01: neutral hover/menu fills and stable ink labels.
// Supersedes the dark-green hover rule for Sidebar.tsx. Account-menu/guest-auth colours stay unchanged.
// Pins hover reset, selected/hover distinction, reduced-motion wiring, contrast and mutation detection.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const sidebar = stripComments(read('src/components/Sidebar.tsx'));
// Token VALUES live in palette.ts since full-app theming (tokens.ts serves CSS variables on web);
// the lightColors block comes first, so the first regex match is the light literal these
// light-mode contrast floors were written against.
const tokens = read('src/theme/palette.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── WCAG contrast, computed from the real token values ──────────────────────────────────────────
const hex = (name: string): string => {
  const m = tokens.match(new RegExp(`${name}: '(#[0-9a-fA-F]{6})'`));
  if (!m) throw new Error(`token ${name} not found`);
  return m[1];
};
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TINT = hex('tint'), DARK = hex('dark'), SURFACE = hex('surface'), INK = hex('ink');
const HOVER = hex('hoverRow'), ONFILL = hex('onFill');
// The dark block follows the light one; read its literals from that slice.
const darkBlock = tokens.slice(tokens.indexOf('export const darkColors'));
const hexDark = (name: string): string => {
  const m = darkBlock.match(new RegExp(`${name}: '(#[0-9a-fA-F]{6})'`));
  if (!m) throw new Error(`dark token ${name} not found`);
  return m[1];
};
const HOVER_D = hexDark('hoverRow'), PAPER_D = hexDark('paper'), ONFILL_D = hexDark('onFill'), DARK_D = hexDark('dark');
const SELECTED = hex('line');
const QUIET = hex('segTrack'), QUIET_D = hexDark('segTrack'), INK_D = hexDark('ink'); // histRowActive — the persistent current-chat highlight
const menu = stripComments(read('src/components/AccountMenu.tsx'));

console.log('\nSidebar interaction color — neutral feedback and stable text\n');

// ── 1. New Chat: light default, neutral interaction, stable text ──────────────────────
check('New Chat DEFAULT fill is the light tint (never primary/dark at rest)',
  /newChat: \{[^}]*backgroundColor: colors\.tint/.test(sidebar)
  && !/newChat: \{[^}]*backgroundColor: colors\.(primary|dark)/.test(sidebar));
check('New Chat hover uses the neutral track, distinct from selection',
  /newChatHover: \{ backgroundColor: colors\.segTrack/.test(sidebar) && QUIET.toLowerCase() !== SELECTED.toLowerCase());
check('New Chat remains readable with ink on the neutral hover fill',
  /newChatText: \{[^}]*color: colors\.dark/.test(sidebar)
  && /newChatTextOn: \{ color: colors\.ink \}/.test(sidebar)
  && /on \? colors\.ink : colors\.dark/.test(sidebar));
check('the hover state also covers keyboard focus',
  /state\.pressed \|\| \(\(state as \{ focused\?: boolean \}\)\.focused/.test(sidebar)
  || /focused/.test(sidebar.slice(sidebar.indexOf('s.newChat,'), sidebar.indexOf('onPress={onNewChat}'))));

// ── 2. rows: neutral rest → quiet hover/press that always reverts; selected stays distinct ──────
check('row hover/press uses neutral track and ink label',
  /histRowHot: \{ backgroundColor: colors\.segTrack \}/.test(sidebar)
  && /histLabelHot: \{ color: colors\.ink \}/.test(sidebar));
check('web hover reverts on mouseleave; touch press ALWAYS clears on pressOut (never sticks)',
  /onMouseEnter: \(\) => setHotRowId\(c\.id\)/.test(sidebar)
  && /onMouseLeave: \(\) => setHotRowId\(\(h\) => \(h === c\.id \? null : h\)\)/.test(sidebar)
  && /onPressOut=\{\(\) => \{ if \(Platform\.OS !== 'web'\) setHotRowId\(\(h\) => \(h === c\.id \? null : h\)\); \}\}/.test(sidebar));
// 2026-08-29: the expression evolved with route-aware active state — the guarantee is identical
// wherever the selected highlight actually renders (the agent screen): a visually-selected row
// never takes the hover fill. On the Filter home no row is selected, so hover remains available.
check('the SELECTED chat never takes the hover fill (current ≠ hovered, structurally)',
  /!\(onAgentScreen && activeChatId === c\.id\)/.test(sidebar)
  && /histRowActive: \{ backgroundColor: colors\.line \}/.test(sidebar));
check('selected and hover use distinct neutral fills',
  SELECTED.toLowerCase() !== QUIET.toLowerCase());

// ── 3. EVERY clickable row follows the same philosophy (owner 2026-09-03) ───────────────────────
check('header 🔍 is neutral at rest and takes the SAME interaction fill on hover — never permanently dark',
  /searchTopBtnHover: \{ backgroundColor: colors\.segTrack \}/.test(sidebar)
  && !/searchTopBtn: \{[^}]*backgroundColor: colors\.(dark|primary)/.test(sidebar)
  && /isOn\(st\) \? colors\.ink : dark \? '#a9c9b4' : colors\.dark/.test(sidebar));
check('nav links (اللغة / الإعدادات / المساعدة / من نحن), the profile row, the guest CTA and the ⋯ menu items use neutral feedback (guest auth CTA retains its fill)',
  /navLinkHover: \{ backgroundColor: colors\.segTrack \}/.test(sidebar)
  && /userRowHover: \{ backgroundColor: colors\.segTrack \}/.test(sidebar)
  && /ctaHover: \{ backgroundColor: colors\.hoverRow \}/.test(sidebar)
  && /rowMenuItemHover: \{ backgroundColor: colors\.segTrack \}/.test(sidebar));
// Count bumped 3 → 4 (owner 2026-09-11): the guest-reachable language-toggle row
// (testID="sidebar-language-toggle") joins الإعدادات/المساعدة/من نحن as a fourth nav link riding
// the exact same navTextOn pattern — see verify-sidebar-language-toggle.ts for its own wiring proof.
check('…their labels remain ink and the Delete icon remains red',
  /navTextOn: \{ color: colors\.ink \}/.test(sidebar) && (sidebar.match(/isOn\(st\) && s\.navTextOn/g) ?? []).length === 4
  && /userTextOn: \{ color: colors\.ink \}/.test(sidebar) && /on && s\.userTextOn/.test(sidebar)
  && /rowMenuTextOn: \{ color: colors\.ink \}/.test(sidebar) && (sidebar.match(/isOn\(st\) && s\.rowMenuTextOn/g) ?? []).length === 2
  && /name="trash-outline" size=\{15\} color="#c0392b"/.test(sidebar));
check('the hover signal is hover OR keyboard focus OR press on every row (one helper, no per-row drift)',
  /const isOn = \(st: \{ hovered\?: boolean; pressed\?: boolean; focused\?: boolean \}\) => !!\(st\.hovered \|\| st\.pressed \|\| st\.focused\);/.test(sidebar)
  && (sidebar.match(/isOn\(st\) && s\.\w+Hover/g) ?? []).length >= 8);
check('dark mode has NO per-theme hover overrides — the token carries both themes',
  !/Hover: \{/.test(sidebar.slice(sidebar.indexOf('const dks = StyleSheet.create'))));
check('the unchanged account menu retains its own dark hover and white text',
  /rowHover: \{ backgroundColor: C\.hoverRow \}/.test(menu) && /rowOn: \{ color: C\.onFill \}/.test(menu)
  && (menu.match(/s\.rowHover/g) ?? []).length === 3 && /quietHover: \{ backgroundColor: dark \?/.test(menu));
check(`DARK hoverRow is the owner's muted deep green-gray (${HOVER_D}), not the bright interaction green (${DARK_D})`,
  HOVER_D.toLowerCase() === '#26483f' && HOVER_D.toLowerCase() !== DARK_D.toLowerCase());

// ── 4. motion: restrained web transition, no bounce ─────────────────────────────────────────────
check('New Chat and rows ride the shared 160ms background transition (no spring/bounce)',
  (sidebar.match(/WEB_SMOOTH/g) ?? []).length >= 4
  && /transitionDuration: '160ms'/.test(sidebar)
  && !/withSpring|ncScale|newChatAnim/.test(sidebar)
  && /docked \|\| reducedMotion/.test(sidebar)
  && /entering=\{reducedMotion \? undefined : FadeIn\.duration\(140\)\}/.test(sidebar));

// ── 5. contrast, computed from the shipped hexes ────────────────────────────────────────────────
const pairs: Array<[string, string, string, number]> = [
  ['New Chat rest: dark-green text on tint', DARK, TINT, 4.5],
  ['LIGHT hover: ink on neutral track', INK, QUIET, 4.5],
  ['LIGHT selected: ink on neutral selection', INK, SELECTED, 4.5],
  ['selected row: ink label on light highlight', INK, SELECTED, 4.5],
  ['DARK hover: ink on neutral track', INK_D, QUIET_D, 4.5],
  ['DARK hover fill is visible against the charcoal panel (non-text)', HOVER_D, PAPER_D, 1.5],
];
for (const [label, fg, bg, min] of pairs) {
  const r = contrast(fg, bg);
  check(`CONTRAST ${label} — ${r.toFixed(2)}:1 (≥ ${min})`, r >= min);
}

// Execute the actual UI handlers with in-memory callbacks; no account or database writes.
const handler = (name: string, source = sidebar) => {
  const start = source.indexOf(`  const ${name} =`);
  const end = source.indexOf('\n  };', start);
  if (start < 0 || end < 0) throw new Error(`missing handler: ${name}`);
  return stripTypeScriptTypes(source.slice(start, end + 5));
};
const exercise = (name: string, args: unknown[], overrides = {}, source = sidebar) => {
  const calls: Array<[string, unknown?]> = [];
  const record = (name: string) => (value?: unknown) => calls.push([name, value]);
  const env = {
    closeSearch: record('closeSearch'), setMenu: record('menu'), setHotRowId: record('hover'),
    onAgentScreen: true, activeChatId: 'current', close: record('close'),
    setQuery: record('query'), sanitizeForFilterRestore: (q: unknown) => q,
    setActiveChat: record('active'), animateOut: (next: () => void) => next(),
    onClose: record('close'), router: { replace: record('route') },
    menu: null, panelRef: { current: null }, cancelArmedOpen: record('cancelPending'), ...overrides,
  };
  const fn = new Function(...Object.keys(env), `${handler(name, source)}; return ${name};`)(...Object.values(env));
  fn(...args);
  return calls;
};
const sameChat = exercise('openHistory', [{ id: 'current', query: {} }]);
check('reopening the current chat closes UI without changing query, active chat, route or scroll',
  sameChat.some(([name]) => name === 'close') && !sameChat.some(([name]) => ['query', 'active', 'route'].includes(name)));
for (const [label, id, onAgentScreen] of [['another saved chat', 'other', true], ['saved chat from home', 'current', false]] as const) {
  const calls = exercise('openHistory', [{ id, query: { location: 'الرياض' } }], { onAgentScreen });
  const route = calls.find(([name]) => name === 'route')?.[1] as any;
  check(`${label} still uses the existing saved transcript route without replay`,
    route?.pathname === '/agent' && route.params.hid === id && route.params.replay === '0');
}
const menuCalls = exercise('openMenu', ['other', {}]);
check('opening the menu cancels a pending row navigation before displaying it',
  menuCalls[0]?.[0] === 'cancelPending' && menuCalls.some(([name]) => name === 'menu'));
check('Escape dismisses the menu and removes its listener on close',
  /event.key === 'Escape'\) setMenu\(null\)/.test(sidebar)
  && /removeEventListener\('keydown', dismiss\)/.test(sidebar));

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

const replayMutation = sidebar.replace('if (onAgentScreen && activeChatId === c.id) { close(); return; }', '');
mustCatch('re-selecting the active chat restarting navigation',
  exercise('openHistory', [{ id: 'current', query: {} }], {}, replayMutation).some(([name]) => name === 'route'));
const menuMutation = sidebar.replace('const openMenu = (id: string, e: any) => {\n    cancelArmedOpen();', 'const openMenu = (id: string, e: any) => {');
mustCatch('a menu leaving the delayed row navigation armed',
  !exercise('openMenu', ['other', {}], {}, menuMutation).some(([name]) => name === 'cancelPending'));

mustCatch('New Chat going permanently dark again (the exact regression the owner rejected)',
  /newChat: \{[^}]*backgroundColor: colors\.(primary|dark)/.test(
    mut(sidebar, 'newChat: { flexDirection: \'row\', alignItems: \'center\', gap: 9, backgroundColor: colors.tint',
                 'newChat: { flexDirection: \'row\', alignItems: \'center\', gap: 9, backgroundColor: colors.primary')));
mustCatch('the hover state being deleted',
  !/newChatHover: \{ backgroundColor: colors\.segTrack/.test(
    mut(sidebar, 'newChatHover: { backgroundColor: colors.segTrack', 'newChatHover: { backgroundColor: colors.tint')));
mustCatch('the dark hover drifting to the bright interaction green (owner: never bright/neon)',
  !/hoverRow: '#26483f'/.test(mut(darkBlock, "hoverRow: '#26483f'", `hoverRow: '${DARK_D}'`)));
mustCatch('hover text going back to colors.surface (dark-on-dark in dark mode)',
  !/histLabelHot: \{ color: colors\.ink \}/.test(mut(sidebar, 'histLabelHot: { color: colors.ink }', 'histLabelHot: { color: colors.surface }')));
mustCatch('a per-theme hover override sneaking back into dks',
  /Hover: \{/.test(mut(sidebar, 'const dks = StyleSheet.create({', "const dks = StyleSheet.create({\n  navLinkHover: { backgroundColor: '#1d2620' },").slice(sidebar.indexOf('const dks = StyleSheet.create'))));
mustCatch('mouseleave no longer reverting the row hover',
  !/onMouseLeave: \(\) => setHotRowId\(\(h\) => \(h === c\.id \? null : h\)\)/.test(
    mut(sidebar, 'onMouseLeave: () => setHotRowId((h) => (h === c.id ? null : h))', 'onMouseLeave: () => {}')));
mustCatch('a sticky mobile press (pressOut no longer clearing)',
  !/onPressOut=\{\(\) => \{ if \(Platform\.OS !== 'web'\) setHotRowId\(\(h\) => \(h === c\.id \? null : h\)\); \}\}/.test(
    mut(sidebar, "onPressOut={() => { if (Platform.OS !== 'web') setHotRowId((h) => (h === c.id ? null : h)); }}",
                 'onPressOut={() => {}}')));
mustCatch('the selected row taking the hover fill (current == hovered confusion)',
  !/!\(onAgentScreen && activeChatId === c\.id\)/.test(
    mut(sidebar, '!(onAgentScreen && activeChatId === c.id)', 'true')));
mustCatch('an unreadable pair slipping past the contrast math (tint-on-tint)',
  contrast(TINT, SELECTED) < 4.5);
mustCatch('the contrast function itself being broken (white-on-dark must be high, not ~1)',
  contrast('#ffffff', DARK) > 7 && Math.abs(contrast('#ffffff', '#ffffff') - 1) < 0.01);

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ neutral sidebar feedback, stable labels, fast motion, both themes — hierarchy + contrast pinned\n');
