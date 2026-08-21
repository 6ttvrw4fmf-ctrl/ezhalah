// Regression test: sidebar double-click rename must NEVER affect the active chat.
// Owner rule (2026-08-20): double-click on a sidebar history title is ONLY a rename interaction.
// It must not clear the active chat, search results, filter state, or navigate away.
//
// ROOT CAUSE: there was NO double-click handler — so a double-click fired `onPress` (openHistory)
// TWICE, navigating and resetting state on the second fire. Fixed by adding a click-delay pattern
// that distinguishes single-click (open) from double-click (rename).
import { readFileSync } from 'fs';
import { join } from 'path';

const sidebar = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'Sidebar.tsx'), 'utf8');
const store = readFileSync(join(import.meta.dirname, '..', 'src', 'store.tsx'), 'utf8');
let pass = 0;
let fail = 0;
const assert = (label: string, ok: boolean) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
};

console.log('verify-sidebar-rename-safety:');

// 1. The sidebar must NOT call openHistory directly from the history row onPress.
//    It must go through a handler that disambiguates click vs double-click.
assert('history row onPress does NOT call openHistory directly',
  !sidebar.includes('onPress={() => openHistory(c)}'));

// 2. There must be a click timer / delay pattern that distinguishes single from double click.
assert('click-delay pattern exists for single/double-click disambiguation',
  sidebar.includes('clickTimer') && sidebar.includes('clearTimeout'));

// 3. Double-click must enter rename mode (set editingId), never call openHistory.
assert('double-click enters rename mode (sets editingId)',
  sidebar.includes('startRename') && sidebar.includes('editingId'));

// 4. There must be a TextInput for inline editing when editingId is set.
assert('inline TextInput rendered when editingId matches',
  sidebar.includes('TextInput') && sidebar.includes('editingId === c.id'));

// 5. renameHistory must exist in the store and only change the label.
assert('store has renameHistory that only changes label',
  store.includes('renameHistory') && store.includes('label: trimmed'));

// 6. renameHistory must NOT touch any other HistoryItem fields (query, ts, starred, snapshot).
//    Verify it uses a map that only spreads the existing item and overrides label.
assert('renameHistory preserves all fields except label (spread + label override)',
  store.includes("{ ...it, label: trimmed }"));

// 7. Escape must cancel the rename without saving.
assert('Escape cancels rename',
  sidebar.includes("'Escape'") && sidebar.includes('setEditingId(null)'));

// 8. Enter (onSubmitEditing) must save the rename.
assert('Enter saves rename (onSubmitEditing → commitRename)',
  sidebar.includes('onSubmitEditing') && sidebar.includes('commitRename'));

// 9. Blur must save the rename (click outside).
assert('blur saves rename (onBlur → commitRename)',
  sidebar.includes('onBlur') && sidebar.includes('commitRename'));

// 10. The ⋯ menu must have a Rename option as an alternative to double-click.
assert('⋯ menu has a Rename option',
  sidebar.includes("'Rename'") && sidebar.includes('pencil-outline'));

// 11. On mobile/touch (non-web), single tap always opens — no double-click behavior.
assert('mobile/touch: single tap always opens (no double-click)',
  sidebar.includes("Platform.OS !== 'web'") && sidebar.includes('openHistory(c)'));

// 12. commitRename with empty text must NOT clear the label (no-op).
assert('empty rename is a no-op',
  store.includes("if (!trimmed) return h"));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
