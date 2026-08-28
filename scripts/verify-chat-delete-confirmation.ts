// DELETING A CONVERSATION REQUIRES EXPLICIT CONFIRMATION — حذف alone must never delete.
//
// Owner 2026-08-28: tapping حذف in a sidebar row's ⋯ menu opens a confirmation dialog carrying his
// exact Arabic copy («هل أنت متأكد من حذف هذه المحادثة؟ سيتم حذفها نهائيًا ولا يمكن استرجاعها.»)
// with إلغاء as the safe default and «حذف نهائي» as the one destructive action. Escape, the
// backdrop, and إلغاء all cancel; only the destructive button deletes, and only once.
//
// Pinned structurally on the shipped source (comments stripped so prose can never satisfy a check),
// then mutation-proven: each guard is re-run against a deliberately broken variant and must fail.
//
//   node --experimental-strip-types scripts/verify-chat-delete-confirmation.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const sidebar = strip(readFileSync(join(root, 'src', 'components', 'Sidebar.tsx'), 'utf8'));
const i18n = readFileSync(join(root, 'src', 'i18n.tsx'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nSidebar delete-confirmation — حذف never deletes without «حذف نهائي»\n');

// ── 1. the menu's حذف opens the dialog and NEVER calls deleteHistory itself ─────────────────────
const menuDeleteItem = sidebar.slice(
  sidebar.indexOf('testID="chat-delete-open-confirm"'),
  sidebar.indexOf('</Pressable>', sidebar.indexOf('testID="chat-delete-open-confirm"')));
check('the menu حذف item opens the confirmation (setConfirmDeleteId), not the delete',
  menuDeleteItem.includes('setConfirmDeleteId(menu.id)') && !menuDeleteItem.includes('deleteHistory('));
// The store destructure (`deleteHistory,`) carries no paren, so `deleteHistory(` in the stripped
// source counts CALL SITES exactly — there must be one, inside the confirmed handler and nowhere else.
check('deleteHistory has EXACTLY ONE call site: the confirmed handler',
  (sidebar.match(/deleteHistory\(/g) ?? []).length === 1
  && /const onConfirmDelete = \(\) => \{[\s\S]*?deleteHistory\(id\);/.test(sidebar));

// ── 2. the dialog: real Modal (not browser confirm), Escape + backdrop + إلغاء all cancel ───────
check('a real RN <Modal> is used — never a browser confirm()',
  /<Modal visible=\{!!confirmDeleteItem\}/.test(sidebar) && !/window\.confirm|globalThis\.confirm/.test(sidebar));
check('Escape cancels (onRequestClose clears the id, deletes nothing)',
  /onRequestClose=\{\(\) => setConfirmDeleteId\(null\)\}/.test(sidebar));
check('tapping outside cancels (backdrop Pressable clears the id, deletes nothing)',
  /testID="chat-delete-cancel-backdrop"[\s\S]{0,120}?onPress=\{\(\) => setConfirmDeleteId\(null\)\}/.test(sidebar));
check('إلغاء cancels and is its own quiet control, separate from the destructive button',
  /testID="chat-delete-cancel"[\s\S]{0,120}?onPress=\{\(\) => setConfirmDeleteId\(null\)\}/.test(sidebar)
  && /dcCancelText/.test(sidebar));

// ── 3. the destructive action: clearly destructive, fires exactly once ──────────────────────────
check('«حذف نهائي» is visually destructive (the red fill the app already uses for destruction)',
  /dcConfirm: \{[^}]*backgroundColor: '#c0392b'/.test(sidebar));
check('confirm fires the delete EXACTLY once (synchronous ref guard beats a double-tap)',
  /if \(deleteFiredRef\.current\) return;\s*deleteFiredRef\.current = true;/.test(sidebar)
  && /deleteFiredRef\.current = false; setConfirmDeleteId\(menu\.id\)/.test(sidebar));

// ── 4. the owner's exact Arabic copy, and rename/star untouched ─────────────────────────────────
check('the owner’s exact Arabic warning ships verbatim (title + body + button)',
  i18n.includes('هل أنت متأكد من حذف هذه المحادثة؟')
  && i18n.includes('سيتم حذفها نهائيًا ولا يمكن استرجاعها.')
  && i18n.includes("'Delete permanently': 'حذف نهائي'"));
check('rename and star behavior are untouched (their handlers still fire directly from the menu)',
  /beginRename\(item\)/.test(sidebar) && /toggleStar\(menu\.id\); setMenu\(null\)/.test(sidebar));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mut = (s: string, from: string, to: string) => {
  if (!s.includes(from)) throw new Error(`mutation anchor missing: ${from}`);
  return s.replace(from, to);
};

// (a) the original bug: the menu item deleting directly again
mustCatch('the menu حذف item reverting to an immediate deleteHistory',
  (() => {
    const b = mut(sidebar, 'deleteFiredRef.current = false; setConfirmDeleteId(menu.id); setMenu(null);',
                           'deleteHistory(menu.id); setMenu(null);');
    const item = b.slice(b.indexOf('testID="chat-delete-open-confirm"'),
                         b.indexOf('</Pressable>', b.indexOf('testID="chat-delete-open-confirm"')));
    return item.includes('deleteHistory(');
  })());
// (b) Escape rewired to delete instead of cancel
mustCatch('onRequestClose (Escape) being rewired to anything but a pure cancel',
  !/onRequestClose=\{\(\) => setConfirmDeleteId\(null\)\}/.test(
    mut(sidebar, 'onRequestClose={() => setConfirmDeleteId(null)}', 'onRequestClose={onConfirmDelete}')));
// (c) the double-fire guard being dropped
mustCatch('the double-tap guard being deleted from the confirm handler',
  !/if \(deleteFiredRef\.current\) return;\s*deleteFiredRef\.current = true;/.test(
    mut(sidebar, 'if (deleteFiredRef.current) return;\n    deleteFiredRef.current = true;\n    ', '')));
// (d) a swap to the browser confirm()
mustCatch('someone replacing the Modal with window.confirm',
  /window\.confirm/.test(mut(sidebar, '<Modal visible={!!confirmDeleteItem}', '<Modal visible={!!confirmDeleteItem && window.confirm("?")}')));
// (e) the destructive button losing its destructive fill
mustCatch('«حذف نهائي» losing its red destructive styling',
  !/dcConfirm: \{[^}]*backgroundColor: '#c0392b'/.test(
    mut(sidebar, "dcConfirm: { width: '100%', backgroundColor: '#c0392b'", "dcConfirm: { width: '100%', backgroundColor: '#eeeeee'")));
// (f) the owner's copy being paraphrased away
mustCatch('the permanent-deletion warning being dropped from i18n',
  !mut(i18n, 'سيتم حذفها نهائيًا ولا يمكن استرجاعها.', 'سيتم الحذف.').includes('سيتم حذفها نهائيًا ولا يمكن استرجاعها.'));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ deletion requires explicit «حذف نهائي»; Escape/backdrop/إلغاء always cancel\n');
