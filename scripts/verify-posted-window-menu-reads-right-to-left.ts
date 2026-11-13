// «نُشر خلال» READS RIGHT-TO-LEFT IN ARABIC (owner 2026-11-11: «اي وقت should be far right not left in Arabic»).
// Measured live that day on the map filter: «أي وقت» sat on the LEFT of its box and the chevron on the right. The web page
// is already right-to-left in Arabic (src/i18n.tsx sets document.documentElement.dir = 'rtl'; native uses I18nManager),
// so a plain 'row' already puts the first child on the right. PostedWindowMenu added `isRTL ? 'row-reverse' : 'row'` on
// top of that, which flipped the field and every menu row back to left-to-right.
//
// This check reads the field and the menu rows' flexDirection out of the component and resolves what a user sees under
// an RTL page: the label must land on the RIGHT. Mutations below put the old double flip back and must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = readFileSync(join(root, 'src/components/PostedWindowMenu.tsx'), 'utf8');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

/** Which side the FIRST child (the label) lands on in an Arabic (RTL) page, per the component's source; null = unreadable. */
function labelSideInArabic(code: string): 'right' | 'left' | null {
  const decl = code.match(/const row = ([^;\n]+);/)?.[1]?.trim();
  if (!decl) return null;
  // Evaluate the declaration the way the component does, with Arabic on.
  let dir: unknown;
  try { dir = new Function('isRTL', `return (${decl});`)(true); } catch { return null; }
  // Both the field and every menu row must take that direction, not a literal of their own.
  const uses = code.match(/flexDirection: ([^ }]+)/g) ?? [];
  if (uses.length < 2 || uses.some((u) => u !== 'flexDirection: row')) return null;
  if (dir === 'row') return 'right';          // RTL page: 'row' starts at the right edge
  if (dir === 'row-reverse') return 'left';   // RTL page: 'row-reverse' starts at the left edge
  return null;
}

check('the page itself is right-to-left in Arabic (the premise this check relies on)', /document\.documentElement\.dir = rtl \? 'rtl' : 'ltr'/.test(i18n));
check('«أي وقت» sits on the RIGHT of its box in Arabic', labelSideInArabic(src) === 'right');

const mutants: [string, string][] = [
  ["the old double flip (isRTL ? 'row-reverse' : 'row')", src.replace("const row = 'row';", "const row = isRTL ? 'row-reverse' : 'row';")],
  ["a plain 'row-reverse'", src.replace("const row = 'row';", "const row = 'row-reverse';")],
  ['a menu row with its own reversed direction', src.replace('style={({ hovered }: any) => [s.opt, { flexDirection: row }', "style={({ hovered }: any) => [s.opt, { flexDirection: 'row-reverse' }")],
];
for (const [name, code] of mutants) mustCatch(name, code !== src && labelSideInArabic(code) !== 'right');

// The picked row is FILLED, not just ticked (owner 2026-11-11: «make it clearly when it's on the tick»).
function pickedRowIsFilled(code: string): boolean {
  return /on && s\.optPicked\]/.test(code)
    && /optPicked: \{[^}]*backgroundColor: colors\.selFill/.test(code)
    && /optOn: \{[^}]*color: colors\.onFill/.test(code);
}
check('the picked period is a filled plum row with white text', pickedRowIsFilled(src));
mustCatch('a picked row that is only ticked again', !pickedRowIsFilled(src.replace(', on && s.optPicked]', ']')));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\n«نُشر خلال» reads right-to-left in Arabic: OK');
