// DRAG-TO-FAVORITES (owner 2026-08-25: «I tried adding a normal chat to Favorites, including
// trying to drag it there, and I couldn't. Fix Favorites so chats can actually be saved there in an
// intuitive way»). This SUPERSEDES the 2026-08-24 "a drag can never change Starred state" rule for
// exactly one gesture: deliberately carrying a row past its bucket edge into the other section.
//
// The pure rules (dragCrossIntent / applyStarMove in src/lib/sidebarReorder.ts) are EXECUTED here;
// the component wiring (commit path, drop target, announcements) is pinned by source shape.
import { readFileSync } from 'node:fs';
import { dragCrossIntent, applyStarMove, CROSS_EDGE_ROWS, ORDER_GAP, orderOf } from '../src/lib/sidebarReorder.ts';
import type { HistoryItem } from '../src/store.tsx';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

console.log('\ndrag-to-Favorites (owner 2026-08-25)\n');

const ROW = 40;

// ── dragCrossIntent, executed ───────────────────────────────────────────────────────────────────
check('a Recent row carried up past the bucket top (beyond the threshold) means STAR',
  dragCrossIntent('Recent', 0, -(CROSS_EDGE_ROWS + 0.1) * ROW, ROW, 3) === 'star');
check('a Recent row dropped AT its bucket top is a position drop, never a surprise star',
  dragCrossIntent('Recent', 1, -1 * ROW, ROW, 3) === null);
check('a Starred row carried down past the bucket bottom means UNSTAR',
  dragCrossIntent('Starred', 2, (CROSS_EDGE_ROWS + 0.1) * ROW, ROW, 3) === 'unstar');
check('a Starred row dropped AT its bucket bottom is a position drop',
  dragCrossIntent('Starred', 1, 1 * ROW, ROW, 3) === null);
check('the wrong directions never cross (up out of Starred / down out of Recent lead nowhere)',
  dragCrossIntent('Starred', 0, -5 * ROW, ROW, 3) === null
  && dragCrossIntent('Recent', 2, 5 * ROW, ROW, 3) === null);
check('crossing from the MIDDLE of Recent still stars (threshold measured from the bucket edge, not the row)',
  dragCrossIntent('Recent', 2, -(2 + CROSS_EDGE_ROWS + 0.1) * ROW, ROW, 4) === 'star');
check('degenerate geometry (no row height / empty bucket) never crosses',
  dragCrossIntent('Recent', 0, -100, 0, 3) === null && dragCrossIntent('Recent', 0, -100, ROW, 0) === null);
check('the threshold is a deliberate overshoot (more than half a row)', CROSS_EDGE_ROWS > 0.5);

// ── applyStarMove, executed ─────────────────────────────────────────────────────────────────────
const items: HistoryItem[] = [
  { id: 'a', label: '', query: {} as any, ts: 3000, starred: true, order: 9000 },
  { id: 'b', label: '', query: {} as any, ts: 2000 },
  { id: 'c', label: '', query: {} as any, ts: 1000, title: 'كذا', snapshot: {} as any },
];
const starred = applyStarMove(items, 'c', true);
const c2 = starred.find((it) => it.id === 'c')!;
check('starring sets the flag and lands the row at the TOP of Favorites',
  c2.starred === true && orderOf(c2) >= 9000 + ORDER_GAP);
check('star/position ONLY — every other field byte-identical, same ids, same length',
  starred.length === 3
  && c2.title === 'كذا' && c2.snapshot === items[2].snapshot && c2.ts === 1000
  && starred.find((it) => it.id === 'a') === items[0]
  && starred.find((it) => it.id === 'b') === items[1]);
const unstarred = applyStarMove(items, 'a', false);
const a2 = unstarred.find((it) => it.id === 'a')!;
check('unstarring lands the row at the TOP of Recent', a2.starred === false && orderOf(a2) >= orderOf(items[1]) + ORDER_GAP);
check('unknown id and no-op state change return the list untouched',
  applyStarMove(items, 'zzz', true) === items && applyStarMove(items, 'a', true) === items);

// mutation-style: the intent thresholds genuinely gate (flip the inequality direction and it breaks)
check('mutation: exactly at the threshold does NOT cross (strict inequality)',
  dragCrossIntent('Recent', 0, -CROSS_EDGE_ROWS * ROW, ROW, 3) === null);

// ── component + store wiring ────────────────────────────────────────────────────────────────────
const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
check('the drag transform computes cross intent from the PURE rule (no inline math)',
  /dragCrossIntent\(d\.bucket, d\.from, dy, d\.rowH, d\.count\)/.test(sidebar));
check('overshoot room opens ONLY toward the other bucket (Recent up, Starred down)',
  /d\.bucket === 'Recent' \? crossRoom : 6/.test(sidebar) && /d\.bucket === 'Starred' \? crossRoom : 6/.test(sidebar));
check('a crossing drop commits star/unstar (starHistory), an in-bucket drop still commits position (reorderHistory)',
  /if \(commit && cross\) \{[\s\S]{0,400}starHistory\(id, cross === 'star'\);/.test(sidebar)
  && /\} else if \(commit\) \{[\s\S]{0,300}reorderHistory\(id, prevId, nextId\);/.test(sidebar));
check('the drop announces the star change to screen readers (both directions, Arabic-translated)',
  /t\('Added to favorites'\)/.test(sidebar) && /t\('Removed from favorites'\)/.test(sidebar));
const i18n = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
check('i18n: both announcements exist in Arabic',
  /'Added to favorites': 'أُضيفت إلى المفضلة'/.test(i18n) && /'Removed from favorites': 'أُزيلت من المفضلة'/.test(i18n));
check('i18n: the section and menu speak the user’s language — المفضلة',
  /'Starred': 'المفضلة'/.test(i18n) && /'Star': 'أضف إلى المفضلة'/.test(i18n) && /'Unstar': 'أزل من المفضلة'/.test(i18n));
check('an empty Favorites section renders its header as a drop target DURING a Recent drag only',
  /drag && drag\.bucket === 'Recent' && !searchMatches && !baseGroups\.some\(\(g\) => g\.key === 'Starred'\)/.test(sidebar));
check('the target section glows while the row is past the edge (visible meaning before the drop)',
  /drag\?\.cross === 'star' && g\.key === 'Starred'/.test(sidebar) && /groupHeadTarget/.test(sidebar));
check('store: starHistory routes through the pure applyStarMove with the same synchronous persist',
  /const next = applyStarMove\(h, id, starred\);/.test(store) && /starHistory: \(id, starred\) =>/.test(store));
check('the ⋯ menu star path is untouched (tap-to-star still works alongside drag)',
  /toggleStar\(menu\.id\)/.test(sidebar));

console.log(failed ? `\n✗ ${failed} check(s) FAILED — drag-to-Favorites contract broken` : '\n✓ drag-to-Favorites: crossing stars/unstars deliberately, position drops stay position-only');
process.exit(failed ? 1 : 0);
