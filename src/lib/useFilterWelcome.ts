// The Filter home's personal headline for a signed-in user (owner 2026-10-17). One line is HELD for
// 4 hours (HOLD_MS) on this device — «not every refresh … every now and then, hours» — then the next
// one comes; a signed-in user always sees a personal line. Switching language re-renders the SAME line.
//
// INSTANT AND NEVER A VISIBLE SWAP (owner 2026-10-17: «make sure it never happens, never ever» and
// «could we make it built in, like it doesn't load?»). The decision is taken ONCE, synchronously, right
// after mount, from what the device already has: is a Supabase session stored here, and what did this
// device show last (lib/filterWelcome.ts instantWelcome). No network is in the way of the headline;
// `settled` is true in the same tick, so the title rises at once. The line's live numbers are then
// refreshed in the background and written back for the NEXT visit — the text on screen is final.
//
// Hydration: the first client render is always { line: null, settled: false }, matching the static
// export's server HTML (React #418 — see lib/responsive.ts); the decision lands in the mount effect.
import { useEffect, useMemo, useState } from 'react';
import {
  welcomeForNow, fallbackLine, renderWelcome, instantWelcome,
  type HeldWelcome, type WelcomeCache, type WelcomeLine, type WelcomeFacts,
} from '@/lib/filterWelcome';
import { loadWelcomeFacts } from '@/data/welcomeFacts';

const CACHE_KEY = 'ezhalah:filterWelcome:shown';
const readCache = (): WelcomeCache | null => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? 'null');
    return v && Number.isFinite(v.id) && Number.isFinite(v.at) && typeof v.ar === 'string' && typeof v.en === 'string'
      ? { id: Number(v.id), at: Number(v.at), ar: v.ar, en: v.en } : null;
  } catch { return null; }
};
const writeCache = (c: WelcomeCache) => { try { globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* per-device nicety only */ } };

// A stored Supabase session = this device is signed in (the restore only confirms it a moment later).
// Same key shape src/lib/authStorageGuard.ts and src/i18n.tsx read: `sb-<ref>-auth-token`.
function readStoredSession(): { present: boolean; name: string } {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return { present: false, name: '' };
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      const raw = ls.getItem(k);
      if (!raw) continue;
      const u = JSON.parse(raw)?.user;
      const m = u?.user_metadata ?? {};
      const name = String(m.nameAr || m.full_name || m.name || m.nameEn || (u?.email ? String(u.email).split('@')[0] : '')).trim();
      return { present: true, name };
    }
  } catch { /* fall through */ }
  return { present: false, name: '' };
}

type Shown = { settled: boolean; id: number | null; ar: string | null; en: string | null };
const UNSETTLED: Shown = { settled: false, id: null, ar: null, en: null };

export function useFilterWelcome(
  signedIn: boolean, name: string, locale: 'ar' | 'en',
  lastLocation: string | null | undefined, lastDistrict?: string | null,
): { line: string | null; settled: boolean } {
  const [shown, setShown] = useState<Shown>(UNSETTLED);

  // ONCE PER PAGE LOAD, synchronously from device state: settle the headline now.
  useEffect(() => {
    const now = new Date();
    const session = readStoredSession();
    const cache = readCache();
    const inst = instantWelcome({ hasSession: session.present, cache, now, name: session.name || name });
    setShown(inst ? { settled: true, id: inst.id, ar: inst.ar, en: inst.en } : { settled: true, id: null, ar: null, en: null });
    if (!session.present) return;
    // BACKGROUND, for the NEXT visit: keep (or pick) the held line, load its live numbers, render both
    // languages and remember them. Nothing here touches the screen.
    let live = true;
    const held: HeldWelcome | null = cache ? { id: cache.id, at: cache.at } : null;
    const choice = welcomeForNow(now, held, Math.random, !!lastDistrict);
    if (!choice) return;
    loadWelcomeFacts(choice.line, lastLocation, lastDistrict).then((facts: WelcomeFacts) => {
      if (!live) return;
      const nm = session.name || name || 'x';
      let line: WelcomeLine = choice.line;
      if (renderWelcome(line, nm, facts, 'ar') === null || renderWelcome(line, nm, facts, 'en') === null) line = fallbackLine(held?.id ?? null);
      const ar = renderWelcome(line, nm, facts, 'ar');
      const en = renderWelcome(line, nm, facts, 'en');
      if (!ar || !en) return;
      const at = choice.keep && held && line.id === held.id ? held.at : now.getTime();
      writeCache({ id: line.id, at, ar, en });
    }).catch(() => {});
    return () => { live = false; };
    // Deliberately once: the headline is decided at mount and never re-decided in this page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(() => {
    // The restore may finish after the instant decision; a signed-out restore still never swaps the
    // text (owner rule) — the line simply stays for this load. Guests (no session stored) get null.
    void signedIn;
    const text = locale === 'ar' ? shown.ar : shown.en;
    return { line: text, settled: shown.settled };
  }, [shown, locale, signedIn]);
}
