// A LISTENER ON THE MAP'S DOM SURFACE OUTLIVES THE MAP (🔧 2026-11-03, page-probe run 41650814458 on /map, phone).
//
// MapKit's `Map.destroy()` drops the map's `element`; React runs an unmounting component's effect cleanups in the order
// the effects were declared, so the effect that CREATES the map (and destroys it on cleanup) runs before the effect that
// put a listener on `map.element`. That later cleanup then read `element` from a destroyed map and threw
// «TypeError: Cannot read properties of null (reading 'removeEventListener')» — uncaught, on every fast tab switch away
// from the map (measured 11-03: 2 of 12 quick taps). The listener must be removed from the element it was ADDED to,
// held here, never re-read from the map at cleanup time.
// Barrier: scripts/verify-map-surface-listener-survives-destroy.ts (executes this against a map whose destroy() nulls
// `element`, with the mutation that re-reads the map).

export type SurfaceMap = { element: HTMLElement | null };

/** Add `fn` to the map's surface now; the returned cleanup removes it from that same element, even after `destroy()`. */
export function onSurface<E extends Event>(map: SurfaceMap, name: string, fn: (e: E) => void): () => void {
  const el = map.element;
  if (!el) return () => {};
  el.addEventListener(name, fn as EventListener);
  return () => { el.removeEventListener(name, fn as EventListener); };
}
