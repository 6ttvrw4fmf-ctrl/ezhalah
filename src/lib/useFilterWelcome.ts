// Picks the Filter home's welcome line ONCE per page load for a signed-in user (owner 2026-10-17:
// «they rotate sometimes not always whenever user refresh»), then renders it in the current UI
// language. Switching language re-renders the SAME line; it never re-rolls. Returns null — keep the
// normal subtitle — for guests, on half of loads, while facts load, and whenever a fact is unknown.
//
// Hydration: the first client render always returns null, matching the static export's server HTML
// (React #418 — see lib/responsive.ts); the line arrives after mount.
import { useEffect, useMemo, useState } from 'react';
import { chooseWelcomeLine, renderWelcome, type WelcomeFacts, type WelcomeLine } from '@/lib/filterWelcome';
import { loadWelcomeFacts } from '@/data/welcomeFacts';

const LAST_KEY = 'ezhalah:filterWelcome:last';
const readLast = (): number | null => {
  try { const v = Number(globalThis.localStorage?.getItem(LAST_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
};
const writeLast = (id: number) => { try { globalThis.localStorage?.setItem(LAST_KEY, String(id)); } catch { /* per-device nicety only */ } };

export function useFilterWelcome(
  signedIn: boolean, name: string, locale: 'ar' | 'en', lastLocation: string | null | undefined,
): string | null {
  const [picked, setPicked] = useState<{ line: WelcomeLine; facts: WelcomeFacts } | null>(null);

  useEffect(() => {
    if (!signedIn) { setPicked(null); return; }
    let live = true;
    const line = chooseWelcomeLine(new Date(), readLast());
    if (!line) return;
    loadWelcomeFacts(line, lastLocation).then((facts) => {
      if (!live) return;
      // Only a line that can actually be shown counts as "the last one", so a skipped line can return.
      if (renderWelcome(line, name || 'x', facts, locale) !== null) writeLast(line.id);
      setPicked({ line, facts });
    }).catch(() => {});
    return () => { live = false; };
    // Once per sign-in state per page load — never per keystroke, per locale switch or per history change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  return useMemo(
    () => (signedIn && picked ? renderWelcome(picked.line, name, picked.facts, locale) : null),
    [signedIn, picked, name, locale],
  );
}
