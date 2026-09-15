// THE DRAG MACHINERY both sign-in surfaces share (owner 2026-08-28, kept by the 2026-08-29
// revision — "the drag is owner-loved"). Extracted verbatim from AuthModal's in-component effect
// so the small SignInCard and the large modal run ONE implementation, not two drifting copies.
//
// MOTION (Apple, WWDC 2018 «Designing Fluid Interfaces»): 1:1 pointer tracking from the grab
// offset via Pointer Events with capture, a 120ms-recency velocity window (drag → pause → release
// drops in place; a live flick still throws), momentum projection, rubber-band past the clamp
// bounds, a critically damped settle spring (damping 1.0 / response 0.4 — Apple's own
// "move/reposition" pair), reduced-motion snap, a resize re-clamp, and a timer safety-net so a
// hidden tab (rAF fully suspended) still ends at the clamped target. Position memory lives in
// sessionStorage under the caller's key.
//
// The caller decides WHAT the painted vector means (the modal paints an OFFSET from its
// flex-centered rest; the card paints its ABSOLUTE position) by supplying `clamp` — the same
// clampAuthPopupOffset either way, closed over the right base rect.

import { clampAuthPopupOffset } from './authPopupBehavior';

export type CardDragOpts = {
  /** sessionStorage key for this surface's position memory. OMIT it and the surface has no memory:
   *  every open starts where flex centering rests it (owner 2026-09-03 for the centered popups —
   *  "dragging only changes its position AFTER the user moves it"); the small SignInCard keeps its. */
  posKey?: string;
  /** Clamp a candidate painted vector fully on-screen. Called fresh per event (live geometry). */
  clamp: (p: { x: number; y: number }) => { x: number; y: number };
  /** The vector to paint before any saved position is restored (default {0,0}). */
  initial?: () => { x: number; y: number };
};

/** OFFSET-MODE clamp for a flex-centered surface: the painted translate is an offset from wherever
 *  centering rests the card, so the clamp derives the UNTRANSLATED base rect per call — live rect
 *  minus the currently painted offset — and viewport resizes / content growth are always measured
 *  fresh, never cached stale. Shared by the sign-in popup and «من نحن». */
export function clampOffsetOnScreen(node: HTMLElement): CardDragOpts['clamp'] {
  const painted = () => {
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(node.style.transform || '');
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  };
  return (p) => {
    const r = node.getBoundingClientRect();
    const o = painted();
    return clampAuthPopupOffset(
      p,
      { left: r.left - o.x, top: r.top - o.y, width: r.width, height: r.height },
      { w: innerWidth, h: innerHeight },
    );
  };
}

/** Attach the drag to `node` (painted) via `grip` (grabbed). Returns a cleanup function. */
export function attachCardDrag(node: HTMLElement, grip: HTMLElement, opts: CardDragOpts): () => void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let off = opts.initial ? opts.initial() : { x: 0, y: 0 };
  const paint = () => { node.style.transform = `translate3d(${off.x}px, ${off.y}px, 0)`; };
  paint();

  // Restore this session's moved position (owner: "preserve if safe/easy"), re-clamped so a
  // narrower window since then can never restore the surface off-screen.
  try {
    const saved = opts.posKey ? sessionStorage.getItem(opts.posKey) : null;
    if (saved) {
      const p = JSON.parse(saved);
      if (typeof p?.x === 'number' && typeof p?.y === 'number') { off = opts.clamp(p); paint(); }
    }
  } catch { /* private mode / blocked storage — the default position is always fine */ }

  let raf = 0;
  let safety: ReturnType<typeof setTimeout> | undefined;
  let dragging = false, moved = false, id = -1;
  let grabX = 0, grabY = 0;
  let hist: Array<{ x: number; y: number; t: number }> = [];
  const THRESHOLD = 6; // px before a press on the grip commits to a drag

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true; moved = false; id = e.pointerId;
    grip.setPointerCapture(id);
    cancelAnimationFrame(raf);
    clearTimeout(safety);
    grabX = e.clientX - off.x; grabY = e.clientY - off.y;   // respect WHERE they grabbed
    hist = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    grip.style.cursor = 'grabbing';
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const nx = e.clientX - grabX, ny = e.clientY - grabY;
    if (!moved && Math.hypot(nx - off.x, ny - off.y) > THRESHOLD) moved = true;
    if (!moved) return;
    // Rubber-band past the bounds: resistance, never a hard stop — and never fully off-screen.
    const c = opts.clamp({ x: nx, y: ny });
    const band = (v: number, cl: number) => cl + (v - cl) * 0.35;
    off = { x: band(nx, c.x), y: band(ny, c.y) };
    paint();
    hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (hist.length > 6) hist.shift();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    grip.style.cursor = 'grab';
    try { grip.releasePointerCapture(id); } catch { /* already released */ }
    if (!moved) return;   // a press that never moved is nothing — the grip is not a button
    // Velocity from the RECENT history only (last ~120ms): drag → pause → release drops the
    // surface in place; a live flick projects the throw. Settle INSIDE the bounds.
    const now = performance.now();
    const recent = hist.filter((p2) => now - p2.t < 120);
    let vx = 0, vy = 0;
    if (recent.length >= 2) {
      const a = recent[0], b = recent[recent.length - 1];
      const dt = Math.max(1, b.t - a.t);
      vx = ((b.x - a.x) / dt) * 1000; vy = ((b.y - a.y) / dt) * 1000;
    }
    const project = (v: number, rate = 0.998) => (v / 1000) * rate / (1 - rate);
    const target = opts.clamp({ x: off.x + project(vx), y: off.y + project(vy) });
    if (opts.posKey) { try { sessionStorage.setItem(opts.posKey, JSON.stringify(target)); } catch { /* non-fatal */ } }
    if (reduced) { off = target; paint(); return; }
    // SAFETY NET: rAF is fully suspended in a hidden/occluded tab, which would strand the surface
    // at its rubber-banded release position — possibly past the bounds — until the next grab.
    // Timers still fire there, so if the spring hasn't settled shortly, snap to the target.
    safety = setTimeout(() => { cancelAnimationFrame(raf); off = target; paint(); }, 1200);
    // Critically damped spring (damping 1.0, response 0.4), seeded with the release velocity so
    // there is no seam between the pointer and the animation.
    const k = (2 * Math.PI / 0.4) ** 2, c2 = 2 * (2 * Math.PI / 0.4);
    let px = off.x, py = off.y, vX = vx, vY = vy, last = performance.now();
    const step = (nowT: number) => {
      const h = Math.min(0.032, (nowT - last) / 1000); last = nowT;
      vX += (-k * (px - target.x) - c2 * vX) * h; px += vX * h;
      vY += (-k * (py - target.y) - c2 * vY) * h; py += vY * h;
      off = { x: px, y: py }; paint();
      if (Math.hypot(px - target.x, py - target.y) < 0.5 && Math.hypot(vX, vY) < 12) {
        off = target; paint(); clearTimeout(safety); return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  // A resized window re-clamps: the surface never ends up stranded outside the new viewport.
  const onResize = () => { off = opts.clamp(off); paint(); };

  grip.addEventListener('pointerdown', onDown);
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onUp);
  addEventListener('resize', onResize);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(safety);
    grip.removeEventListener('pointerdown', onDown);
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.removeEventListener('pointercancel', onUp);
    removeEventListener('resize', onResize);
  };
}
