// The Filter home's personal headline for a signed-in user (owner 2026-10-17). One line is HELD for
// 2 hours (HOLD_MS, owner 2026-10-20) on this device — «not every refresh … every now and then, hours» — then the next
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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  welcomeForNow, chooseWelcomeLine, renderWelcome, instantWelcome, fillName, NAME_SLOT, PREPARED_MAX_MS,
  WELCOME_LINES, lineFitsTime, greetingFor,
  type HeldWelcome, type WelcomeCache, type WelcomeLine, type WelcomeFacts,
} from '@/lib/filterWelcome';
import { loadWelcomeFacts } from '@/data/welcomeFacts';
import { sentenceName } from '@/lib/nameSync';
import {
  pickGreeting, fillGreeting, chooseInsightLine, isInsightLineId, INSIGHT_ID_BASE, SEEN_DAYS, type Seen,
} from '@/lib/insightWelcome';
import { fetchWelcomeInsights } from '@/data/welcomeInsights';
import { cityNameEnOfficial, districtNameEnOfficial } from '@/data/locations';
import { hasJustSignedIn, takeJustSignedIn, SIGNED_IN_EVENT, isFreshSignUp } from '@/lib/loginWelcome';

// v2: remembered lines hold NAME_SLOT, not a name. v1 entries had the name baked in (a Latin name
// inside the Arabic line, owner 2026-10-17) and are ignored.
const CACHE_KEY = 'ezhalah:filterWelcome:shown:v2';
// The NEXT period's line, prepared in the background and not yet seen (lib/filterWelcome.ts `next`).
const NEXT_KEY = 'ezhalah:filterWelcome:next:v1';
const readKey = (key: string): WelcomeCache | null => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null');
    return v && Number.isFinite(v.id) && Number.isFinite(v.at) && typeof v.ar === 'string' && typeof v.en === 'string'
      ? { id: Number(v.id), at: Number(v.at), ar: v.ar, en: v.en } : null;
  } catch { return null; }
};
const writeKey = (key: string, c: WelcomeCache | null) => {
  try { if (c) globalThis.localStorage?.setItem(key, JSON.stringify(c)); else globalThis.localStorage?.removeItem(key); } catch { /* per-device nicety only */ }
};
// The facts this device has been shown, by key, with when — so one fact is never repeated within a week,
// across the nightly rebuilds (lib/insightWelcome.ts insightKey).
const SEEN_KEY = 'ezhalah:welcomeInsight:seen:v1';
const readSeen = (now: number): Seen => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? '{}');
    const out: Seen = {};
    if (v && typeof v === 'object') for (const [k, t] of Object.entries(v)) if (typeof t === 'number' && now - t <= SEEN_DAYS * 86_400_000) out[k] = t;
    return out;
  } catch { return {}; }
};
const writeSeen = (s: Seen) => { try { globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* per-device nicety only */ } };
/** How long the sign-in welcome stays before the market insight takes its place. */
export const WELCOME_TO_INSIGHT_MS = 5000;
const readCache = () => readKey(CACHE_KEY);
const writeCache = (c: WelcomeCache) => writeKey(CACHE_KEY, c);

// A stored Supabase session = this device is signed in (the restore only confirms it a moment later).
// Same key shape src/lib/authStorageGuard.ts and src/i18n.tsx read: `sb-<ref>-auth-token`.
// The name in BOTH spellings, by the same pickName() the sidebar and account menu use — so the
// Arabic line gets «يوسف», never «yusuf».
type StoredSession = { present: boolean; nameAr: string; nameEn: string; uid: string; awaitingName?: boolean };
function readStoredSession(): StoredSession {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return { present: false, nameAr: '', nameEn: '', uid: '' };
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      const raw = ls.getItem(k);
      if (!raw) continue;
      const u = JSON.parse(raw)?.user;
      const m = u?.user_metadata ?? {};
      const base = String(m.full_name || m.name || m.nameEn || m.nameAr || '').trim(); // never the email (see mapSupabaseUser)
      const spelled = !!base && String(m.name_spellings_for ?? '') === base; // stored spellings belong to THIS name
      const names = { name: base, nameAr: spelled ? m.nameAr : undefined, nameEn: spelled ? m.nameEn : undefined };
      // A fresh sign-up whose «وش نناديك؟» box is still open: its welcome waits for «حفظ» (NamePrompt fires it).
      const awaitingName = isFreshSignUp(u?.created_at, u?.last_sign_in_at, Date.now()) && m.name_prompt_seen !== true;
      // No name, and «وش نناديك؟» was answered with «تخطي»: the account is «ضيف إزهله» / Ezhalah Guest, so it is still
      // greeted and still gets its facts by that name (owner 2026-10-26). The same words the sidebar shows (i18n).
      if (!base && m.name_prompt_seen === true) return { present: true, nameAr: 'ضيف إزهله', nameEn: 'Ezhalah Guest', uid: String(u?.id ?? ''), awaitingName: false };
      return { present: true, nameAr: sentenceName(names, 'ar'), nameEn: sentenceName(names, 'en'), uid: String(u?.id ?? ''), awaitingName };
    }
  } catch { /* fall through */ }
  return { present: false, nameAr: '', nameEn: '', uid: '' };
}

// The sign-in welcome for THIS device's session, if a sign-in was just marked (lib/loginWelcome.ts).
// Takes the mark, so one sign-in greets once.
function takeGreeting(session: StoredSession, now: number): { id: number; ar: string; en: string } | null {
  if (!session.present || session.awaitingName || !(session.nameAr || session.nameEn) || !hasJustSignedIn(now)) return null;
  const t = takeJustSignedIn(now);
  return t ? greetingFor(session.uid, t.count, NAME_SLOT) : null;
}

type Shown = { settled: boolean; id: number | null; ar: string | null; en: string | null; nameAr: string; nameEn: string; greet?: number | null };
const UNSETTLED: Shown = { settled: false, id: null, ar: null, en: null, nameAr: '', nameEn: '', greet: null };

export function useFilterWelcome(
  signedIn: boolean, name: string, locale: 'ar' | 'en',
  lastLocation: string | null | undefined, lastDistrict?: string | null,
): { line: string | null; settled: boolean; swapKey: number; isInsight: boolean } {
  const [shown, setShown] = useState<Shown>(UNSETTLED);
  // Bumped when the sign-in welcome hands over to a market insight, so the screen can show the change.
  const [swapKey, setSwapKey] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // AFTER THE SIGN-IN WELCOME, ON THE SPOT, A MARKET INSIGHT (owner 2026-10-22: «show the first message with
  // 🥳, then change it to a market insight» — so the user sees the line change). The insight is the one
  // already prepared for this device, or one picked now from the day's facts; the welcome stays if none can
  // be had (a failed read is not an empty answer). It then becomes the shown line for its 2 hours.
  const welcomeThenInsight = () => {
    const start = Date.now();
    const pick = (async () => {
      const pend = readKey(NEXT_KEY);
      if (pend && isInsightLineId(pend.id) && start - pend.at < PREPARED_MAX_MS) return { line: pend, fromNext: true };
      const pack = await fetchWelcomeInsights(lastLocation, lastDistrict);
      if (!pack) return null;
      const seen = readSeen(start);
      const c = chooseInsightLine(pack, seen, start, { city: (id) => cityNameEnOfficial(id), district: districtNameEnOfficial }, { district: lastDistrict, city: lastLocation });
      if (!c) return null;
      writeSeen({ ...seen, [c.key]: start });
      return { line: { id: INSIGHT_ID_BASE + c.templateId, at: start, ar: c.ar, en: c.en }, fromNext: false };
    })();
    const wait = new Promise<void>((r) => setTimeout(r, WELCOME_TO_INSIGHT_MS));
    Promise.all([pick, wait]).then(([r]) => {
      if (!alive.current || !r) return;
      const t = Date.now();
      writeCache({ id: r.line.id, at: t, ar: r.line.ar, en: r.line.en });
      if (r.fromNext) writeKey(NEXT_KEY, null);
      setShown((s) => ({ ...s, settled: true, id: r.line.id, ar: r.line.ar, en: r.line.en, greet: pickGreeting(new Date(t)) }));
      setSwapKey((k) => k + 1);
    }).catch(() => {});
  };

  // ONCE PER PAGE LOAD, synchronously from device state: settle the headline now.
  useEffect(() => {
    const now = new Date();
    const session = readStoredSession();
    let cache = readCache();
    const next = readKey(NEXT_KEY);
    // Names are fixed here, once, so the line on screen never changes in this page load. The store's
    // name (passed in) is preferred when it is already restored; else the stored session's.
    const nameAr = (locale === 'ar' && name) || session.nameAr;
    const nameEn = (locale === 'en' && name) || session.nameEn;
    // Right after a sign-in or sign-up the welcome line takes the place of the rotation (owner
    // 2026-10-22); otherwise the rotation as before.
    const greet = (nameAr || nameEn) ? takeGreeting(session, now.getTime()) : null;
    const inst = greet ? { ...greet, fromCache: false, promoted: false }
      : (nameAr || nameEn) ? instantWelcome({ hasSession: session.present, cache, next, now, name: NAME_SLOT }) : null;
    // The greeting is chosen NOW, from the user's own local time (lib/insightWelcome.ts), kept for this page load.
    const greetIdx = pickGreeting(now);
    setShown(inst ? { settled: true, id: inst.id, ar: inst.ar, en: inst.en, nameAr, nameEn, greet: greetIdx } : { settled: true, id: null, ar: null, en: null, nameAr, nameEn, greet: greetIdx });
    if (!session.present) return;
    if (greet) welcomeThenInsight();
    // What is on screen now is the SHOWN line, and its 2 hours start now when it is new to this device
    // (a prepared line seen for the first time, or the no-numbers line used when nothing was ready).
    if (inst && (!inst.fromCache || inst.promoted)) {
      cache = { id: inst.id, at: now.getTime(), ar: inst.ar, en: inst.en };
      writeCache(cache);
      if (inst.promoted) writeKey(NEXT_KEY, null);
    }
    // BACKGROUND, for later visits. Nothing here touches the screen.
    let live = true;
    const nm = NAME_SLOT;
    const render = (line: WelcomeLine, facts: WelcomeFacts) => {
      const ar = renderWelcome(line, nm, facts, 'ar');
      const en = renderWelcome(line, nm, facts, 'en');
      return ar && en ? { ar, en } : null;
    };
    // 1. Refresh the shown line's live numbers for a reload inside its 2 hours (same line, same start).
    const held: HeldWelcome | null = cache ? { id: cache.id, at: cache.at } : null;
    const choice = welcomeForNow(now, held, Math.random, !!lastDistrict);
    if (choice?.keep && held) {
      loadWelcomeFacts(choice.line, lastLocation, lastDistrict).then((facts) => {
        const r = live ? render(choice.line, facts) : null;
        if (r) writeCache({ id: choice.line.id, at: held.at, ...r });
      }).catch(() => {});
    }
    // 2. Prepare the NEXT period's line: a «تدري إن …» fact from TODAY's insights (owner 2026-10-22; these
    //    replace the old rotating lines), never one this device saw in the past week. Its greeting is put
    //    in when it is shown. Kept as long as it is still usable (a day).
    const shownId = cache?.id ?? null;
    const pending = readKey(NEXT_KEY);
    const pendingOk = !!pending && isInsightLineId(pending.id) && pending.id !== shownId && now.getTime() - pending.at < PREPARED_MAX_MS;
    if (!pendingOk) {
      fetchWelcomeInsights(lastLocation, lastDistrict).then((pack) => {
        if (!live || !pack) return;
        const seen = readSeen(now.getTime());
        const pick = chooseInsightLine(pack, seen, now.getTime(), { city: (id) => cityNameEnOfficial(id), district: districtNameEnOfficial }, { district: lastDistrict, city: lastLocation });
        if (!pick) return;
        writeKey(NEXT_KEY, { id: INSIGHT_ID_BASE + pick.templateId, at: now.getTime(), ar: pick.ar, en: pick.en });
        writeSeen({ ...seen, [pick.key]: now.getTime() });
      }).catch(() => {});
    }
    return () => { live = false; };
    // Deliberately once: the headline is decided at mount and never re-decided in this page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE ONE EXCEPTION to "never re-decided": a sign-in that completes while this screen is up (Google
  // One Tap, or a Google/Apple return whose session lands after the home mounted). Signing in is the
  // user's own act, and the owner asked for the welcome right then (2026-10-22). Nothing else changes
  // the headline after it appears.
  useEffect(() => {
    const greetNow = () => {
      const now = Date.now();
      const session = readStoredSession();
      const g = takeGreeting(session, now);
      if (!g) return;
      writeCache({ id: g.id, at: now, ar: g.ar, en: g.en });
      setShown({ settled: true, id: g.id, ar: g.ar, en: g.en, nameAr: session.nameAr, nameEn: session.nameEn });
      welcomeThenInsight();
    };
    if (signedIn) greetNow();
    const onSignedIn = () => greetNow();
    globalThis.addEventListener?.(SIGNED_IN_EVENT, onSignedIn);
    return () => globalThis.removeEventListener?.(SIGNED_IN_EVENT, onSignedIn);
  }, [signedIn]);

  return useMemo(() => {
    // The restore may finish after the instant decision; a signed-out restore still never swaps the
    // text (owner rule) — the line simply stays for this load. Guests (no session stored) get null.
    void signedIn;
    // The greeting (the user's local time, chosen once at mount) first, then the name for the language on screen.
    // The name is the account's CURRENT name for that language when the store has it (owner 2026-10-22: a user
    // who changes their name sees it at once, يوسف in Arabic and Yusuf in English); the device's copy otherwise.
    const live = (name ?? '').trim();
    const text = locale === 'ar'
      ? fillName(fillGreeting(shown.ar, shown.greet ?? null, 'ar'), live || shown.nameAr, 'ar')
      : fillName(fillGreeting(shown.en, shown.greet ?? null, 'en'), live || shown.nameEn, 'en');
    // A market fact (not the sign-in welcome or an older line) can be tapped for «كيف تشتغل؟».
    return { line: text, settled: shown.settled, swapKey, isInsight: shown.id != null && isInsightLineId(shown.id) };
  }, [shown, locale, signedIn, name, swapKey]);
}
