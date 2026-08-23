// PRESS-HOLD-DRAG SIDEBAR REORDER — the permanent contract (owner 2026-08-24).
//
//   hold a saved chat → drag it vertically → release → THAT ORDER STICKS.
//   A reorder changes POSITION ONLY. It must never rename, delete, duplicate, open the wrong chat,
//   create history junk, or touch search/navigation state — and it is disabled while a title is
//   being renamed or while chat-search is filtering the list.
//
// The load-bearing rules are proved by EXECUTING src/lib/sidebarReorder.ts (the same functions the
// store and Sidebar call), not by regexing the component; source checks below cover only the wiring
// that cannot be executed headlessly (pointer bindings, persistence plumbing).
//
//   node --experimental-strip-types scripts/verify-sidebar-reorder.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyMove, canReorder, computeMovedOrder, dragTargetIndex, neighboursAt, orderOf, sortByOrder,
  HOLD_MS, HOLD_SLOP_PX, ORDER_GAP,
} from '../src/lib/sidebarReorder.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nSidebar press-hold-drag reorder — position only, provable by execution\n');

// A realistic three-chat bucket, newest first (the owner's own example).
// Deliberately IN THE PAST: a mutated applyMove that stamps Date.now() onto any non-order field
// (ts, titleUpdatedAt, …) must differ from these, never coincide within the same millisecond.
const T = Date.now() - 3_600_000;
const mk = (id: string, ts: number, extra: object = {}): any =>
  ({ id, label: id, query: { q: id }, ts, title: 't-' + id, snapshot: { big: 'blob-' + id }, ...extra });
const A = mk('riyadh', T);            // عقارات الرياض (top)
const B = mk('jeddah', T - 1000);     // فلل جدة
const C = mk('khobar', T - 2000);     // شقق الخبر
const hist = [A, B, C];

// ── 1. the owner's example: drag the first chat below the last ──────────────────────────────────
{
  const after = applyMove(hist, 'riyadh', 'khobar', null);   // now sits under شقق الخبر
  const order = sortByOrder(after).map((x) => x.id);
  check('Journey A — dragging chat #1 below #3 yields #2/#3/#1', order.join(',') === 'jeddah,khobar,riyadh',
    `got ${order.join(',')}`);
  check('…same chats, same count — nothing duplicated or lost',
    after.length === 3 && new Set(after.map((x) => x.id)).size === 3);
  const moved = after.find((x) => x.id === 'riyadh')!;
  const { order: _o1, ...movedRest } = moved;
  const { order: _o2, ...origRest } = A;
  check('…the moved chat changed in POSITION ONLY (query/title/snapshot/ts byte-identical)',
    JSON.stringify(movedRest) === JSON.stringify(origRest));
  check('…untouched chats are the SAME OBJECTS (no rewrite, no field churn)',
    after.find((x) => x.id === 'jeddah') === B && after.find((x) => x.id === 'khobar') === C);
}

// ── 2. persistence model: the order survives a JSON round-trip (what localStorage stores) ───────
{
  const after = applyMove(hist, 'riyadh', 'khobar', null);
  const revived = sortByOrder(JSON.parse(JSON.stringify(after))).map((x: any) => x.id);
  check('Journey B/C — the manual order survives serialize → parse (refresh / sidebar reopen)',
    revived.join(',') === 'jeddah,khobar,riyadh');
}

// ── 3. new activity still tops the list WITHOUT wrecking the manual arrangement ─────────────────
{
  const arranged = applyMove(hist, 'riyadh', 'khobar', null);          // jeddah, khobar, riyadh
  const fresh = mk('new-chat', Date.now() + 5000);                      // recordHistory: no `order`
  const order = sortByOrder([fresh, ...arranged]).map((x) => x.id);
  check('a NEW chat lands on top while the arrangement underneath survives',
    order.join(',') === 'new-chat,jeddah,khobar,riyadh', `got ${order.join(',')}`);
}

// ── 4. degenerate & hostile inputs are no-ops, never corruption ─────────────────────────────────
check('unknown id is a no-op (returns the identical array)', applyMove(hist, 'ghost', null, 'riyadh') === hist);
check('stale neighbour id is a no-op', applyMove(hist, 'riyadh', 'deleted-row', null) === hist);
{
  // Midpoint exhaustion: force two adjacent orders so close a midpoint can't sit between them.
  const near = [mk('p', T, { order: 1000 }), mk('q', T - 1, { order: 1000 + Number.MIN_VALUE }), mk('r', T - 2, { order: 999 })];
  const out = applyMove(near, 'r', 'q', 'p'); // impossible midpoint → renormalize, never a duplicate rank
  const ranks = out.map(orderOf);
  check('exhausted midpoints renormalize — every rank stays unique', new Set(ranks).size === ranks.length);
  check('…and renormalizing still changes no field but `order`',
    out.every((x) => { const { order: _o, ...rest } = x as any; const orig: any = near.find((n) => n.id === x.id); const { order: _p, ...origRest } = orig; return JSON.stringify(rest) === JSON.stringify(origRest); }));
}
check('computeMovedOrder: between two ranks = strict midpoint', computeMovedOrder(200, 100) === 150);
check('computeMovedOrder: top placement outranks the old top', computeMovedOrder(null, 500)! > 500);
check('computeMovedOrder: bottom placement ranks under the old bottom', computeMovedOrder(500, null)! < 500);
check('computeMovedOrder: collapsed midpoint returns null (renormalize signal)', computeMovedOrder(100, 100) === null);

// ── 5. gating: rename and chat-search both disable reordering ───────────────────────────────────
check('reorder allowed in the normal sidebar', canReorder({ editing: false, searchActive: false }));
check('reorder DISABLED while renaming a title', !canReorder({ editing: true, searchActive: false }));
check('reorder DISABLED while chat-search filters the list', !canReorder({ editing: false, searchActive: true }));

// ── 6. drag geometry: slots, clamping, neighbours ───────────────────────────────────────────────
check('dragging one row-height down moves one slot', dragTargetIndex(0, 37, 37, 3) === 1);
check('half a row is not a slot change', dragTargetIndex(1, 15, 37, 3) === 1);
check('a drag can never leave its bucket (clamped)', dragTargetIndex(0, 9999, 37, 3) === 2 && dragTargetIndex(2, -9999, 37, 3) === 0);
check('neighboursAt: dropping at the top has only a next', JSON.stringify(neighboursAt(['b', 'c'], 0)) === '{"prevId":null,"nextId":"b"}');
check('neighboursAt: dropping at the bottom has only a prev', JSON.stringify(neighboursAt(['b', 'c'], 2)) === '{"prevId":"c","nextId":null}');
check('hold window matches the owner spec (350–500ms) and slop is small', HOLD_MS >= 350 && HOLD_MS <= 500 && HOLD_SLOP_PX <= 10 && ORDER_GAP > 0);

// ── 7. wiring that cannot be executed headlessly — pinned in source ─────────────────────────────
const sidebar = read('src/components/Sidebar.tsx');
const store = read('src/store.tsx');
check('a quick tap still ONLY arms the delayed open (drag never calls openHistory)',
  /onPress=\{\(\) => armOpenRow\(c\)\}/.test(sidebar)
  && !/beginHold[\s\S]{0,3000}openHistory\(/.test(sidebar.slice(sidebar.indexOf('const beginHold'), sidebar.indexOf('const bindRowHost'))));
check('the landed hold cancels the armed open (a long-press can never open a chat)',
  /d\.active = true;[\s\S]{0,200}cancelArmedOpen\(\);/.test(sidebar));
check('a landed hold cannot rename, and a double-click mid-hold cannot fire rename',
  /const dbl = \(\) => \{ if \(!dragRef\.current\?\.active\) beginRename\(c\); \};/.test(sidebar));
check('touch long-press rename is gone from the row (hold belongs to reorder now)',
  !/onLongPress=\{\(\) => beginRename/.test(sidebar));
check('touch rename lives in the ⋯ menu instead', /pencil-outline/.test(sidebar) && /\{t\('Rename'\)\}/.test(sidebar));
check('the drag gate is the executable canReorder, fed by editing AND the LIVE search mode',
  /canReorder\(\{ editing: !!editingId, searchActive: searching \}\)/.test(sidebar));
{
  // Scoped to the DRAG ENGINE (beginHold → siblingShift): the drawer's own slide-in legitimately
  // uses translateX; the reorder itself must be vertical-only so RTL rows never move sideways.
  const engine = sidebar.slice(sidebar.indexOf('const applyDragTransform'), sidebar.indexOf('const openMenu'));
  check('drag transforms are translateY-only (vertical reorder; RTL rows never move sideways)',
    /translateY\(\$\{dy\}px\) scale\(1\.02\)/.test(engine) && !/translateX/.test(engine));
}
check('the drop hand-off runs on a TIMER, never an animation callback (hidden-tab rule)',
  /setTimeout\(\(\) => \{[\s\S]{0,400}reorderHistory\(id, prevId, nextId\);/.test(sidebar));
check('the drop announces «تم تغيير ترتيب المحادثة» to screen readers',
  /setDropAnnounce\(t\('Conversation order changed'\)\)/.test(sidebar));
check('the store reorder is applyMove + the same synchronous persist as toggleStar',
  /reorderHistory: \(id, prevId, nextId\) =>[\s\S]{0,400}applyMove\(h, id, prevId, nextId\)[\s\S]{0,400}localStorage\.setItem\(historyKey\(user\.sub\)/.test(store));
check('re-activated chats drop a stale manual slot (Note #9 activity contract)',
  /order: undefined,/.test(store));
check('buckets render by the manual rank (sortByOrder), not raw ts',
  /const starred = sortByOrder\(/.test(sidebar) && /const recent = sortByOrder\(/.test(sidebar));

// Arabic accessibility strings exist and are Arabic.
const i18n = read('src/i18n.tsx');
for (const [k, ar] of [
  ['Hold to reorder the conversation', 'اضغط مطولًا لإعادة ترتيب المحادثة'],
  ['Move conversation', 'نقل المحادثة'],
  ['Conversation order changed', 'تم تغيير ترتيب المحادثة'],
  ['Rename', 'إعادة تسمية'],
] as const) {
  check(`i18n: «${k}» → Arabic`, i18n.includes(`'${k}': '${ar}'`));
}

console.log(failures === 0
  ? '\n✓ hold-drag reorder changes position only, persists, and never collides with open/rename/search\n'
  : `\n✗ ${failures} check(s) FAILED — the reorder contract is broken\n`);
process.exit(failures === 0 ? 0 : 1);
