// ⋯ IS A MENU AFFORDANCE, NOT A DRAG HANDLE (ops_incident hunt-2026-09-04:sidebar:02).
//
// The press-hold-drag reorder binds `pointerdown` on the OUTER row node, and beginHold's only entry
// guard asked about the BUTTON (`e.button !== 0`) and the pointer TYPE — never about WHAT was
// pressed. So a mouse-down on a row's ⋯ that drifted ~25px down lifted the row, reordered it one
// slot, announced «تم تغيير ترتيب المحادثات», and persisted it through reorderHistory. The user was
// opening a menu; the app rearranged their chat list.
//
// The fix is one entry guard in beginHold — the single place every row's gesture starts — plus a
// `data-nodrag` marker on the controls that own their own pointer. This barrier proves BOTH halves:
// the guard's real expression is extracted from Sidebar.tsx and EXECUTED against a row tree shaped
// like the rendered one, and the marker in the JSX is matched against the selector the guard uses,
// so a rename of one without the other fails here rather than in production.
//
// The intended gesture is pinned in the same run: a press on the row body, its label or the row host
// must still start the drag (scripts/verify-sidebar-reorder.ts and verify-sidebar-drag-star.ts own
// the rest of that contract — commit path, drop target, announcements).
//
//   node --experimental-strip-types scripts/verify-sidebar-drag-handle-scope.ts   (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = readFileSync(join(root, 'src/components/Sidebar.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failed++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

console.log('\nSidebar press-hold-drag — a press on ⋯ opens the menu, it never reorders\n');

// ── the REAL predicate, lifted out of the component (never a re-typed copy) ─────────────────────
const SEL = /const NO_DRAG_SEL = '([^']+)';/.exec(src)?.[1] ?? '';
const GUARD = /const startsOnControl = \([^)]*\)[^=]*=> ([^;]+);/.exec(src)?.[1] ?? '';
check('Sidebar declares the no-drag selector and the guard expression', !!SEL && !!GUARD,
  `selector=${SEL || '(missing)'} guard=${GUARD || '(missing)'}`);
const startsOnControl = new Function('target', 'NO_DRAG_SEL', `return (${GUARD || 'undefined'});`) as
  (target: unknown, sel: string) => boolean;

// A row tree shaped like the rendered one: the host <View> carries the pointerdown, the row body
// Pressable and the ⋯ Pressable are siblings inside it, and each has a glyph child — the node a real
// pointerdown actually reports as its target. `closest` walks ancestors and matches the selector's
// `[attr]` and bare-tag clauses, which is all NO_DRAG_SEL uses.
type El = { tag: string; attrs: Record<string, string>; parent: El | null; closest: (sel: string) => El | null };
const el = (tag: string, attrs: Record<string, string> = {}, parent: El | null = null): El => {
  const node = { tag, attrs, parent } as El;
  node.closest = (sel: string) => {
    const clauses = sel.split(',').map((s) => s.trim()).filter(Boolean);
    for (let n: El | null = node; n; n = n.parent) {
      for (const c of clauses) {
        const attr = /^\[([^\]=]+)\]$/.exec(c);
        if (attr ? n.attrs[attr[1]!] !== undefined : n.tag === c) return n;
      }
    }
    return null;
  };
  return node;
};
const rowHost = el('div');
const rowBody = el('div', {}, rowHost);              // the histItem Pressable — the drag surface
const rowLabel = el('div', {}, rowBody);             // the chat title
const dots = el('div', { 'data-nodrag': '1' }, rowHost);
const dotsGlyph = el('span', {}, dots);              // the ellipsis glyph the pointer really hits
const renameField = el('input', {}, rowHost);        // the inline rename TextInput

// ── EXECUTED: what the guard says about each real press target ──────────────────────────────────
check('a press on the ⋯ glyph is NOT a drag', startsOnControl(dotsGlyph, SEL) === true);
check('a press on the ⋯ button itself is NOT a drag', startsOnControl(dots, SEL) === true);
check('a press on the inline rename field is NOT a drag', startsOnControl(renameField, SEL) === true);
check('a press on the row body STILL starts the drag', startsOnControl(rowBody, SEL) === false);
check('a press on the chat title STILL starts the drag', startsOnControl(rowLabel, SEL) === false);
check('a press on the row host itself STILL starts the drag', startsOnControl(rowHost, SEL) === false);
check('a missing/native target never throws (guard is optional-chained)',
  startsOnControl(null, SEL) === false && startsOnControl({}, SEL) === false);

// mutation — the guard as it shipped (it never asked what was pressed), and a selector that has
// drifted away from the marker the JSX renders.
mustCatch('the old guard that ignores WHAT was pressed',
  (new Function('target', 'NO_DRAG_SEL', 'return false;') as typeof startsOnControl)(dotsGlyph, SEL) === false);
mustCatch('a selector that no longer matches the ⋯ marker',
  startsOnControl(dotsGlyph, '[data-no-drag], input, textarea') === false);
mustCatch('a guard that swallows the row body too (the reorder gesture would be dead)',
  startsOnControl(rowBody, '[data-nodrag], input, textarea, div') === true);

// ── the wiring the execution above assumes: guard placement + the marker in the JSX ─────────────
const begin = src.slice(src.indexOf('const beginHold ='), src.indexOf('const bindRowHost'));
const guardInEntry = /const beginHold = [\s\S]{0,600}?if \(startsOnControl\(e\.target\)\) return;/;
check('beginHold refuses in its ENTRY GUARDS, before any drag state is created',
  guardInEntry.test(begin) && begin.indexOf('startsOnControl(e.target)') < begin.indexOf('dragRef.current = {'));
mustCatch('the unguarded beginHold coming back',
  !guardInEntry.test(begin.replace(/\n\s*if \(startsOnControl\(e\.target\)\) return;[^\n]*/, '')));

// The ⋯ Pressable, taken from the JSX by its own style key so reformatting cannot blind this.
const dotsAt = src.indexOf('style={s.dots}');
const dotsBlock = dotsAt < 0 ? '' : src.slice(dotsAt - 200, dotsAt + 300);
const MARKER = /dataSet=\{\{ (\w+): '[^']*' \}\}/;
check('the ⋯ button is a Pressable', dotsBlock.includes('<Pressable'));
const markerKey = MARKER.exec(dotsBlock)?.[1] ?? '';
check('the ⋯ button carries a dataSet marker', !!markerKey, markerKey || '(missing)');
// react-native-web renders dataSet keys as data-<hyphenated key>; an all-lowercase key rules the
// conversion out entirely, so the attribute name is literally the key.
check('the marker key is all-lowercase (no camelCase → hyphen surprise in the rendered attribute)',
  markerKey === markerKey.toLowerCase());
check('the selector the guard runs matches the attribute the ⋯ actually renders',
  SEL.includes(`[data-${markerKey}]`), `selector=${SEL} rendered=data-${markerKey}`);
mustCatch('the ⋯ marker being dropped from the JSX',
  !MARKER.test(dotsBlock.replace(MARKER, '')));

// The row host must stay the drag surface — marking IT would kill the gesture the owner asked for.
check('the row host is NOT marked no-drag (the intended press-hold-drag survives)',
  !/ref=\{bindRowHost\([\s\S]{0,400}?dataSet=/.test(src));
check('the hold is still bound on the row host (pointerdown wiring untouched)',
  /node\.addEventListener\('pointerdown', hold\)/.test(src));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
console.log(failed === 0
  ? '\n✓ ⋯ opens its menu; only the row itself can be dragged\n'
  : `\n✗ ${failed} check(s) FAILED — a press on ⋯ can reorder the chat list\n`);
process.exit(failed === 0 ? 0 : 1);
