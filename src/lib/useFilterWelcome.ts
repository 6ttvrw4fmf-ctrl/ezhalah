// The Filter home's personal headline for a signed-in user (owner 2026-10-17). One line is HELD for
// 4 hours (HOLD_MS) on this device — «not every refresh … every now and then, hours» — then the next
// one comes; a signed-in user always sees a personal line. Switching language re-renders the SAME line.
// Returns null — keep the normal headline — for guests and until the line's live facts have loaded.
//
// Hydration: the first client render always returns null, matching the static export's server HTML
// (React #418 — see lib/responsive.ts); the line arrives after mount.
import { useEffect, useMemo, useState } from 'react';
import { welcomeForNow, fallbackLine, renderWelcome, type HeldWelcome, type WelcomeFacts, type WelcomeLine } from '@/lib/filterWelcome';
import { loadWelcomeFacts } from '@/data/welcomeFacts';

const HELD_KEY = 'ezhalah:filterWelcome:held';
const readHeld = (): HeldWelcome | null => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(HELD_KEY) ?? 'null');
    return v && Number.isFinite(v.id) && Number.isFinite(v.at) ? { id: Number(v.id), at: Number(v.at) } : null;
  } catch { return null; }
};
const writeHeld = (h: HeldWelcome) => { try { globalThis.localStorage?.setItem(HELD_KEY, JSON.stringify(h)); } catch { /* per-device nicety only */ } };

export function useFilterWelcome(
  signedIn: boolean, name: string, locale: 'ar' | 'en', lastLocation: string | null | undefined,
  lastDistrict?: string | null,
): string | null {
  const [picked, setPicked] = useState<{ line: WelcomeLine; facts: WelcomeFacts } | null>(null);

  useEffect(() => {
    if (!signedIn) { setPicked(null); return; }
    let live = true;
    const now = new Date();
    const held = readHeld();
    const choice = welcomeForNow(now, held, Math.random, !!lastDistrict);
    if (!choice) return;
    loadWelcomeFacts(choice.line, lastLocation, lastDistrict).then((facts) => {
      if (!live) return;
      let line = choice.line;
      // A line whose fact is unknown right now is never shown; a factless line stands in for this load.
      if (renderWelcome(line, name || 'x', facts, locale) === null) line = fallbackLine(held?.id ?? null);
      if (!choice.keep || line.id !== choice.line.id) writeHeld({ id: line.id, at: choice.keep && held ? held.at : now.getTime() });
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
