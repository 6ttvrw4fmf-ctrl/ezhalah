// SIDEBAR INTERACTION COLOR — light green at rest, dark green ONLY on interaction.
//
// Owner 2026-08-24: «I want the sidebar to feel lighter... The dark green should be an interaction
// color, not the permanent background color for everything.» Supersedes the 2026-08-14 solid-green
// New Chat. The rules:
//   * «محادثة جديدة»: LIGHT green fill + dark-green text at rest → DARK green fill + white text on
//     hover/keyboard-focus/press, ~160ms restrained transition, no bounce.
//   * Chat rows: light/neutral at rest → dark-green fill + white label on hover (web) / press
//     (touch). The feedback must always REVERT (leave/press-out clears), never stick.
//   * The SELECTED chat keeps its persistent light-green highlight and never takes the hover fill —
//     current vs hovered must stay visually distinct.
//   * Contrast is computed here from the actual token hexes (WCAG), not eyeballed.
//
//   node --experimental-strip-types scripts/verify-sidebar-light-green-interaction.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const SELECTED = '#dcefe1'; // histRowActive — the persistent current-chat highlight

console.log('\nSidebar interaction color — light at rest, dark green on interaction\n');

// ── 1. New Chat: light default, dark interaction, text flips with the fill ──────────────────────
check('New Chat DEFAULT fill is the light tint (never primary/dark at rest)',
  /newChat: \{[^}]*backgroundColor: colors\.tint/.test(sidebar)
  && !/newChat: \{[^}]*backgroundColor: colors\.(primary|dark)/.test(sidebar));
check('New Chat hover/focus/press fill is the dark green',
  /newChatHover: \{ backgroundColor: colors\.dark/.test(sidebar));
check('New Chat text is dark-green at rest and flips to white with the fill (children-as-function)',
  /newChatText: \{[^}]*color: colors\.dark/.test(sidebar)
  && /newChatTextOn: \{ color: colors\.surface \}/.test(sidebar)
  && /on \? colors\.surface : colors\.dark/.test(sidebar));
check('the hover state also covers keyboard focus',
  /state\.pressed \|\| \(\(state as \{ focused\?: boolean \}\)\.focused/.test(sidebar)
  || /focused/.test(sidebar.slice(sidebar.indexOf('s.newChat,'), sidebar.indexOf('onPress={onNewChat}'))));

// ── 2. rows: neutral rest → dark hover/press that always reverts; selected stays distinct ──────
check('row hover/press fill is dark green with a white label',
  /histRowHot: \{ backgroundColor: colors\.dark \}/.test(sidebar)
  && /histLabelHot: \{ color: colors\.surface \}/.test(sidebar));
check('web hover reverts on mouseleave; touch press ALWAYS clears on pressOut (never sticks)',
  /onMouseEnter: \(\) => setHotRowId\(c\.id\)/.test(sidebar)
  && /onMouseLeave: \(\) => setHotRowId\(\(h\) => \(h === c\.id \? null : h\)\)/.test(sidebar)
  && /onPressOut=\{\(\) => \{ if \(Platform\.OS !== 'web'\) setHotRowId\(\(h\) => \(h === c\.id \? null : h\)\); \}\}/.test(sidebar));
// 2026-08-29: the expression evolved with route-aware active state — the guarantee is identical
// wherever the selected highlight actually renders (the agent screen): a visually-selected row
// never takes the hover fill. On the Filter home no row is selected, so hover may darken freely.
check('the SELECTED chat never takes the hover fill (current ≠ hovered, structurally)',
  /!\(onAgentScreen && activeChatId === c\.id\)/.test(sidebar)
  && /histRowActive: \{ backgroundColor: '#dcefe1' \}/.test(sidebar));
check('selected and hover are different colors entirely (light persistent vs dark interactive)',
  SELECTED.toLowerCase() !== DARK.toLowerCase());

// ── 3. header search button follows the same philosophy ─────────────────────────────────────────
check('header 🔍 is neutral at rest with a soft tint wash on hover — never permanently dark',
  /searchTopBtnHover: \{ backgroundColor: colors\.tint \}/.test(sidebar)
  && !/searchTopBtn: \{[^}]*backgroundColor: colors\.(dark|primary)/.test(sidebar));

// ── 4. motion: restrained web transition, no bounce ─────────────────────────────────────────────
check('New Chat and rows ride the shared 160ms background transition (no spring/bounce)',
  (sidebar.match(/WEB_SMOOTH/g) ?? []).length >= 4
  && /transitionDuration: '160ms'/.test(sidebar)
  && !/withSpring[^)]*newChat/i.test(sidebar));

// ── 5. contrast, computed from the shipped hexes ────────────────────────────────────────────────
const pairs: Array<[string, string, string, number]> = [
  ['New Chat rest: dark-green text on tint', INK && DARK, TINT, 4.5] as any,
  ['New Chat hover: white text on dark green', SURFACE, DARK, 4.5],
  ['row hover: white label on dark green', SURFACE, DARK, 4.5],
  ['selected row: ink label on light highlight', INK, SELECTED, 4.5],
];
pairs[0] = ['New Chat rest: dark-green text on tint', DARK, TINT, 4.5];
for (const [label, fg, bg, min] of pairs) {
  const r = contrast(fg, bg);
  check(`CONTRAST ${label} — ${r.toFixed(2)}:1 (≥ ${min})`, r >= min);
}

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

mustCatch('New Chat going permanently dark again (the exact regression the owner rejected)',
  /newChat: \{[^}]*backgroundColor: colors\.(primary|dark)/.test(
    mut(sidebar, 'newChat: { flexDirection: \'row\', alignItems: \'center\', gap: 9, backgroundColor: colors.tint',
                 'newChat: { flexDirection: \'row\', alignItems: \'center\', gap: 9, backgroundColor: colors.primary')));
mustCatch('the hover state being deleted',
  !/newChatHover: \{ backgroundColor: colors\.dark/.test(
    mut(sidebar, 'newChatHover: { backgroundColor: colors.dark', 'newChatHover: { backgroundColor: colors.tint')));
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
console.log('\n✓ light at rest, dark green on interaction — hierarchy + contrast pinned\n');
