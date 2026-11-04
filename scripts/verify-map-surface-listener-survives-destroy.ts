// A LISTENER ON THE MAP'S DOM SURFACE SURVIVES THE MAP (🔧 2026-11-03, page-probe run 41650814458, /map on a phone).
//
// MapKit's Map.destroy() nulls `element`; React runs an unmounting component's effect cleanups in declaration order,
// so the map-creating effect destroyed the map BEFORE the pins effect removed its click listener from `m.element`:
// «TypeError: Cannot read properties of null (reading 'removeEventListener')», uncaught, 2 of 12 quick tab taps.
// This EXECUTES src/lib/mapSurface.ts against a map whose destroy() nulls `element`, plants the old shape as a mutant
// that must throw, and pins the wiring: the component attaches the canvas tap through onSurface() and never re-reads
// `m.element` at cleanup time.
//
//   node --experimental-strip-types scripts/verify-map-surface-listener-survives-destroy.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onSurface, type SurfaceMap } from '../src/lib/mapSurface.ts';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

/** A MapKit-shaped map: a surface that records listeners, and a destroy() that drops the surface like Apple's does. */
const fakeMap = () => {
  const listeners = new Map<string, Set<unknown>>();
  const element = {
    addEventListener: (n: string, f: unknown) => { (listeners.get(n) ?? listeners.set(n, new Set()).get(n)!).add(f); },
    removeEventListener: (n: string, f: unknown) => { listeners.get(n)?.delete(f); },
  } as unknown as HTMLElement;
  const map: SurfaceMap & { destroy: () => void } = { element, destroy: () => { map.element = null; } };
  return { map, listeners, element };
};
const noop = () => {};

console.log('── the listener is added to the surface and removed from the SAME surface ──');
{
  const { map, listeners, element } = fakeMap();
  const off = onSurface(map, 'click', noop);
  check('onSurface adds the listener to the map surface', listeners.get('click')?.has(noop) === true);
  off();
  check('the cleanup removes it while the map is alive', listeners.get('click')?.has(noop) === false && map.element === element);
}

console.log('── the measured order: the map is destroyed BEFORE the cleanup runs ──');
{
  const { map, listeners } = fakeMap();
  const off = onSurface(map, 'click', noop);
  map.destroy();
  let threw: unknown = null;
  try { off(); } catch (e) { threw = e; }
  check('cleanup after destroy() does not throw', threw === null, String(threw));
  check('… and still removes the listener from the element it was added to', listeners.get('click')?.has(noop) === false);
  check('a map with no surface yet yields a cleanup that is a no-op, not a throw', (() => { try { onSurface({ element: null }, 'click', noop)(); return true; } catch { return false; } })());
}

console.log('── mutation: the old shape (re-read map.element at cleanup) ──');
{
  const { map } = fakeMap();
  const oldShape = (m: SurfaceMap) => { m.element!.addEventListener('click', noop); return () => { m.element!.removeEventListener('click', noop); }; };
  const off = oldShape(map);
  map.destroy();
  let caught = false;
  try { off(); } catch (e) { caught = /removeEventListener/.test(String(e)); }
  mustCatch('a cleanup that re-reads a destroyed map\'s element (the 11-03 TypeError)', caught);
}

console.log('── wiring: src/components/AppleMap.web.tsx ──');
{
  const src = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
  check('the canvas tap is attached through onSurface()', /onSurface\(m, 'click', onCanvasTap\)/.test(src) && /from '@\/lib\/mapSurface'/.test(src));
  check('no cleanup re-reads m.element to remove a listener', !/m\.element\.removeEventListener/.test(src));
  check('the drawing pad effect keeps its own captured element for removal', /const el = padRef\.current[\s\S]*?el\.removeEventListener\('pointerdown'/.test(src));
}

if (failed) { console.error(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log('\nOK — a map-surface listener is removed from the element it was added to, destroyed map or not.');
