// The Filter home's personal headline for a signed-in user (owner 2026-10-17). One line is HELD for
// 4 hours (HOLD_MS) on this device — «not every refresh … every now and then, hours» — then the next
// one comes; a signed-in user always sees a personal line. Switching language re-renders the SAME line.
//
// NEVER A VISIBLE SWAP (owner 2026-10-17: «make sure it never happens, never ever»). `settled` tells
// the screen when the headline may make its entrance: not before the session restore says who the
// visitor is, and for a signed-in visitor not before the line's live numbers are in (or SETTLE_CAP_MS
// passed). Once settled, the text is final for this page load — headlineReduce() ignores anything
// that arrives later (lib/filterWelcome.ts). `line` is null for guests, or when the facts never came.
//
// Hydration: the first client render is always { line: null, settled: false }, matching the static
// export's server HTML (React #418 — see lib/responsive.ts); the decision arrives after mount.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  welcomeForNow, fallbackLine, renderWelcome, headlineReduce, HEADLINE_UNSETTLED, SETTLE_CAP_MS,
  type HeadlineState, type HeldWelcome,
} from '@/lib/filterWelcome';
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
  signedIn: boolean, authChecked: boolean, name: string, locale: 'ar' | 'en',
  lastLocation: string | null | undefined, lastDistrict?: string | null,
): { line: string | null; settled: boolean } {
  const [state, setState] = useState<HeadlineState>(HEADLINE_UNSETTLED);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatch = (ev: Parameters<typeof headlineReduce>[1]) => {
    const next = headlineReduce(stateRef.current, ev);
    if (next !== stateRef.current) { stateRef.current = next; setState(next); }
  };

  useEffect(() => {
    if (!authChecked) return; // who is this? — the headline waits for the answer
    if (!signedIn) { dispatch({ type: 'guest' }); return; }
    let live = true;
    const now = new Date();
    const held = readHeld();
    const choice = welcomeForNow(now, held, Math.random, !!lastDistrict);
    if (!choice) { dispatch({ type: 'guest' }); return; }
    // The cap: a slow network shows the normal headline — and then KEEPS it (late facts are ignored).
    const cap = setTimeout(() => { if (live) dispatch({ type: 'timeout' }); }, SETTLE_CAP_MS);
    loadWelcomeFacts(choice.line, lastLocation, lastDistrict).then((facts) => {
      if (!live || stateRef.current.settled) return;
      let line = choice.line;
      // A line whose fact is unknown right now is never shown; a factless line stands in for this load.
      if (renderWelcome(line, name || 'x', facts, locale) === null) line = fallbackLine(held?.id ?? null);
      if (!choice.keep || line.id !== choice.line.id) writeHeld({ id: line.id, at: choice.keep && held ? held.at : now.getTime() });
      dispatch({ type: 'facts', line, facts });
    }).catch(() => {});
    return () => { live = false; clearTimeout(cap); };
    // Once per (restore, sign-in) per page load — never per keystroke, per locale switch or per history change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, signedIn]);

  const line = useMemo(
    () => (signedIn && state.line && state.facts ? renderWelcome(state.line, name, state.facts, locale) : null),
    [signedIn, state, name, locale],
  );
  return { line, settled: state.settled };
}
