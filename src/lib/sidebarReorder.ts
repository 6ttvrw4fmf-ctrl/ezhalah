// Pure, testable logic for MANUAL SIDEBAR REORDERING (owner 2026-08-24: press-and-hold a saved
// chat, drag it vertically, release it in a new position — ChatGPT-style).
//
// Why a separate module: the permanent rules — reorder changes POSITION ONLY, never duplicates,
// never loses a chat, is disabled while renaming or while chat-search filters the list — must be
// provable by EXECUTING the logic from a plain Node test, not by regexing the component. Same
// pattern as src/lib/rowClick.ts (single-click vs double-click) and src/lib/afCohorts.ts.
//
// THE ORDERING MODEL. Every HistoryItem carries an optional `order` number; display sorts by
// `orderOf(item) = item.order ?? item.ts`, descending, within each sidebar bucket (Starred /
// Recent). This gives the owner's exact semantics with ONE field:
//   • Legacy items (no `order`) sort by timestamp — existing sidebars look identical today.
//   • A NEW or re-run chat is stamped `order = Date.now()`, which is larger than every existing
//     order, so it lands on top WITHOUT touching any other row — a manual arrangement underneath
//     survives (owner: "do not completely resort everything by timestamp after the user manually
//     rearranges").
//   • A manual MOVE assigns the dragged item the midpoint between its new neighbours' orders — one
//     row changes, everything else is untouched. Repeated midpoints between the same two rows
//     eventually exhaust float precision; `applyMove` detects that and renormalizes the bucket's
//     orders (position only — no other field) instead of silently colliding.

import type { HistoryItem } from '@/store';

/** The display rank of an item — manual order when set, else its activity timestamp. */
export const orderOf = (it: Pick<HistoryItem, 'order' | 'ts'>): number => it.order ?? it.ts;

/** Newest/manually-highest first — the sidebar bucket sort. Stable for equal ranks. */
export function sortByOrder<T extends Pick<HistoryItem, 'order' | 'ts'>>(items: T[]): T[] {
  return [...items].sort((a, b) => orderOf(b) - orderOf(a));
}

// Gap used when an order value must be invented next to a neighbour (top/bottom placement) and when
// renormalizing. One minute in ms: big enough that midpoints stay clean for thousands of drags,
// small enough that a chat re-run seconds later (order = Date.now()) still lands above.
export const ORDER_GAP = 60_000;

/**
 * The order value for an item dropped between two neighbours (prev = the row now ABOVE it, i.e.
 * higher rank; next = the row BELOW). Returns null when the midpoint has collapsed into a
 * neighbour — the caller must renormalize instead of writing a duplicate rank.
 */
export function computeMovedOrder(prevOrder: number | null, nextOrder: number | null): number | null {
  if (prevOrder == null && nextOrder == null) return Date.now();
  if (prevOrder == null) return nextOrder! + ORDER_GAP;   // dropped at the top of the bucket
  if (nextOrder == null) return prevOrder - ORDER_GAP;    // dropped at the bottom
  const mid = (prevOrder + nextOrder) / 2;
  return mid > nextOrder && mid < prevOrder ? mid : null; // precision exhausted → renormalize
}

/**
 * Move `id` so it sits between `prevId` (above) and `nextId` (below) — POSITION ONLY.
 *
 * Structural guarantees, relied on by the barrier that executes this:
 *   • returns the same items — same length, same ids, and every field except `order` byte-identical
 *     (the spread carries query/snapshot/title/starred/ts through untouched);
 *   • never navigates, never touches the active chat, never creates or deletes anything;
 *   • unknown ids are a no-op (the caller's list can lag a delete by a frame).
 */
export function applyMove(
  items: HistoryItem[], id: string, prevId: string | null, nextId: string | null,
): HistoryItem[] {
  const moved = items.find((it) => it.id === id);
  if (!moved) return items;
  const prev = prevId ? items.find((it) => it.id === prevId) ?? null : null;
  const next = nextId ? items.find((it) => it.id === nextId) ?? null : null;
  if ((prevId && !prev) || (nextId && !next)) return items; // stale neighbour → change nothing
  const order = computeMovedOrder(prev ? orderOf(prev) : null, next ? orderOf(next) : null);
  if (order != null) return items.map((it) => (it.id === id ? { ...it, order } : it));

  // Midpoint collapsed: renormalize THE MOVED ITEM'S BUCKET (same starred flag) with fresh evenly-
  // spaced orders in its current visual sequence, with the moved item in its new slot. Order only.
  const inBucket = sortByOrder(items.filter((it) => it.starred === moved.starred && it.id !== id));
  const at = next ? inBucket.findIndex((it) => it.id === next!.id) : inBucket.length;
  inBucket.splice(at < 0 ? inBucket.length : at, 0, moved);
  const top = Math.max(Date.now(), ...inBucket.map(orderOf)) + ORDER_GAP;
  const ranks = new Map(inBucket.map((it, i) => [it.id, top - i * ORDER_GAP]));
  return items.map((it) => (ranks.has(it.id) ? { ...it, order: ranks.get(it.id)! } : it));
}

/**
 * May a drag begin right now? Renaming a title and chat-search mode both disable reordering:
 * search shows a FILTERED list, where "drop above that row" doesn't mean what the user sees
 * (owner: "search is for finding conversations; normal sidebar mode is where ordering happens").
 */
export function canReorder(state: { editing: boolean; searchActive: boolean }): boolean {
  return !state.editing && !state.searchActive;
}

/** How far a hold may wander (px) before it's a scroll, not a long-press. */
export const HOLD_SLOP_PX = 8;
/** Long-press activation delay — inside the owner's 350–500ms window. */
export const HOLD_MS = 380;

/**
 * Which slot the dragged row currently occupies, from its vertical travel. Pure math so the
 * "dragging C up one row makes it land above B" contract is unit-testable. Clamped to the bucket —
 * a drag can never leave its section (that would change starred state, which reorder must not).
 */
export function dragTargetIndex(fromIndex: number, dy: number, rowH: number, count: number): number {
  if (!(rowH > 0) || !(count > 0)) return fromIndex;
  const raw = fromIndex + Math.round(dy / rowH);
  return Math.max(0, Math.min(count - 1, raw));
}

/**
 * The neighbours of slot `to` once the dragged row is dropped there, expressed as ids from the
 * bucket's CURRENT visual order (without the dragged row). prev = above, next = below.
 */
export function neighboursAt(
  visibleIdsWithoutDragged: string[], to: number,
): { prevId: string | null; nextId: string | null } {
  const ids = visibleIdsWithoutDragged;
  const at = Math.max(0, Math.min(ids.length, to));
  return { prevId: at > 0 ? ids[at - 1] : null, nextId: at < ids.length ? ids[at] : null };
}
