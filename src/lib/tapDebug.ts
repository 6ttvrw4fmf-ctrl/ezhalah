// On-device tap diagnostics, OFF unless the page URL carries ?debug=tap (owner 2026-10-04: on his real
// iPhone, tapping the AI-chat composer never opened the keyboard, and no emulator — WebKit iPhone 13
// at the real Safari viewport — reproduced it). With the flag, a small fixed log at the top of the
// screen prints what each touch actually hit and whether the textarea gained focus, so one screenshot
// from the affected phone names the cause. Plain DOM, no React: it must observe the page, not be part
// of what it observes. Without the flag this module does nothing at all.

const MAX_LINES = 8;

function describe(el: EventTarget | null): string {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return String(el);
  const id = e.getAttribute('data-testid') || e.id || '';
  const label = e.getAttribute('aria-label') || (e.innerText || '').trim().slice(0, 14);
  return `${e.tagName.toLowerCase()}${id ? '#' + id : ''}${label ? ` «${label}»` : ''}`;
}

export function isTapDebugOn(): boolean {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'tap';
  } catch {
    return false;
  }
}

/** Install the overlay once. Returns a cleanup. No-op (and no DOM) unless ?debug=tap. */
export function installTapDebug(): () => void {
  if (!isTapDebugOn() || typeof document === 'undefined') return () => {};
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none;'
    + 'background:rgba(0,0,0,.78);color:#7CFC9A;font:11px/1.35 ui-monospace,Menlo,monospace;'
    + 'padding:4px 6px;direction:ltr;text-align:left;white-space:pre-wrap;max-height:40vh;overflow:hidden';
  document.body.appendChild(box);
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    while (lines.length > MAX_LINES) lines.shift();
    box.textContent = lines.join('\n');
  };
  const at = (ev: Event) => {
    const t = (ev as TouchEvent).changedTouches?.[0];
    if (!t) return '';
    const hit = document.elementFromPoint(t.clientX, t.clientY);
    return ` @${Math.round(t.clientX)},${Math.round(t.clientY)} hit=${describe(hit)}`;
  };
  const onTouchStart = (ev: Event) => log(`touchstart ${describe(ev.target)}${at(ev)}`);
  const onTouchEnd = (ev: Event) => {
    log(`touchend ${describe(ev.target)} prevented=${ev.defaultPrevented}`);
    setTimeout(() => log(`  → active=${describe(document.activeElement)}`), 350);
  };
  const onClick = (ev: Event) => log(`click ${describe(ev.target)} prevented=${ev.defaultPrevented}`);
  const onFocusIn = (ev: Event) => log(`focusin ${describe(ev.target)}`);
  const onFocusOut = (ev: Event) => log(`focusout ${describe(ev.target)}`);
  // Capture for the touch/click (who was hit), bubble-end check for defaultPrevented via a late
  // window listener so a handler anywhere on the path is already reflected.
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('click', onClick);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  const vv = window.visualViewport;
  log(`tap debug on · ${navigator.userAgent.slice(0, 60)} · vv=${vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : 'none'}`);
  return () => {
    document.removeEventListener('touchstart', onTouchStart, true);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('click', onClick);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    box.remove();
  };
}
