// «مسح الكل» THEN X LEAVES THE MAP CLEARED (owner 2026-11-11: «when I click clear all then x it doesn't show doesn't get
// reset … we need that fixed»). Measured live that day: filter «تجاري» applied (13,058 pins), reopen, «مسح الكل», X →
// the map still showed 13,058 commercial pins. «مسح الكل» only reset the popup's own boxes, and X closes without
// applying, so the reset was thrown away.
//
// The fix: «مسح الكل» calls clearAll(), which resets the boxes AND calls onClear(); the map's onClear resets the map's
// own filter at once. This check EXECUTES the real arrows lifted from the two files against stub state — the user's
// path (applied filter → open → clear all → X) — and fails on the old code (mutations below).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const cardSrc = readFileSync(join(root, 'src/components/MapFilterCard.tsx'), 'utf8');
const mapSrc = readFileSync(join(root, 'src/app/map.tsx'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

const EMPTY = { __empty: true };
const NARROWED = { category: 'تجاري' };

/** The user's path against the given sources; returns the map's filter after X (or a reason it could not run). */
function journey(card: string, map: string): unknown {
  const clearBody = card.match(/const clearAll = \(\) => \{([^}]*)\};/)?.[1];
  const tag = map.match(/<MapFilterCard [^\n]*\/>/)?.[0] ?? '';
  const onClearBody = tag.match(/onClear=\{\(\) => \{([^}]*)\}\}/)?.[1];
  const onCloseBody = tag.match(/onClose=\{\(\) => ([^}]*)\}/)?.[1];
  if (clearBody == null || onClearBody == null || onCloseBody == null) return 'not wired';
  // Every «مسح الكل» button presses clearAll, never a bare local reset.
  if (/onPress=\{\(\) => setF\(EMPTY_MAP_FILTER\)\}/.test(card) || (card.match(/onPress=\{clearAll\}/g) ?? []).length < 2) return 'a clear button bypasses clearAll';
  const state = { mapFilter: NARROWED as unknown, draft: NARROWED as unknown, open: true, pinRow: 'row' as unknown };
  const setMapFilter = (v: unknown) => { state.mapFilter = v; };
  const setPinRow = (v: unknown) => { state.pinRow = v; };
  const setFilterOpen = (v: boolean) => { state.open = v; };
  const setF = (v: unknown) => { state.draft = v; };
  const onClear = new Function('setMapFilter', 'setPinRow', 'EMPTY_MAP_FILTER', onClearBody).bind(null, setMapFilter, setPinRow, EMPTY);
  const clearAll = new Function('setF', 'onClear', 'EMPTY_MAP_FILTER', clearBody).bind(null, setF, onClear, EMPTY);
  const onClose = new Function('setFilterOpen', onCloseBody).bind(null, setFilterOpen);
  clearAll();          // «مسح الكل»
  onClose();           // X
  return state.open ? 'popup still open' : state.mapFilter;
}

check('applied filter → «مسح الكل» → X leaves the map with NO filter', journey(cardSrc, mapSrc) === EMPTY);
// Clear stays on while the MAP still has a filter, even when every box was un-ticked by hand (review of #11818).
const clearGate = (card: string) => /const canClear = isNarrowed\(f\) \|\| isNarrowed\(value\);/.test(card)
  && /\{!phone && canClear \? \(/.test(card) && /disabled=\{!canClear\}/.test(card) && !/isNarrowed\(f\) \? \(|disabled=\{!isNarrowed\(f\)\}/.test(card);
check('«مسح الكل» stays available while the map still has a filter (boxes un-ticked by hand)', clearGate(cardSrc));
mustCatch('the clear button gated on the draft boxes only', !clearGate(cardSrc.replace('const canClear = isNarrowed(f) || isNarrowed(value);', 'const canClear = isNarrowed(f);')));

// Mutations: each is the old behaviour or a plausible regression, executed through the same journey.
const mutants: [string, string, string][] = [
  ['clearAll no longer tells the map (the shipped bug)', cardSrc.replace(/setF\(EMPTY_MAP_FILTER\); onClear\(\);/, 'setF(EMPTY_MAP_FILTER);'), mapSrc],
  ['a «مسح الكل» button back to a local-only reset', cardSrc.replace('onPress={clearAll}', 'onPress={() => setF(EMPTY_MAP_FILTER)}'), mapSrc],
  ["the map's onClear forgets its own filter", cardSrc, mapSrc.replace('onClear={() => { setMapFilter(EMPTY_MAP_FILTER); setPinRow(null); }}', 'onClear={() => { setPinRow(null); }}')],
];
for (const [name, card, map] of mutants) {
  const moved = card !== cardSrc || map !== mapSrc;
  mustCatch(name, moved && journey(card, map) !== EMPTY);
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nmap «مسح الكل» → X resets the map: OK');
