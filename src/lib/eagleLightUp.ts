// The sidebar eagle lights up ONCE per log-in / sign-up (owner 2026-10-24: «he sees his eagle color changing … just
// happens once … every he registers, signs up, logs in — doesn't show every time»). The store marks a fresh sign-in
// (signed-out → signed-in in this tab); the sidebar eagle takes the mark the first time it is on screen — at once on
// the laptop's docked sidebar, at the first burger-menu open on the phone — and plays the light-up there.
const KEY = 'ez:eagleLightUp:v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // a mark nobody saw within a day is stale, never a surprise later

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const store = (): Store | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

export function markEagleLightUp(now = Date.now(), s: Store | null = store()): void {
  try { s?.setItem(KEY, String(now)); } catch { /* no storage: the logo just shows lit */ }
}

/** True once per mark: reads AND clears it, so the next open shows the settled lit logo. */
export function takeEagleLightUp(now = Date.now(), s: Store | null = store()): boolean {
  try {
    const v = s?.getItem(KEY);
    if (!v) return false;
    s?.removeItem(KEY);
    const at = Number(v);
    return Number.isFinite(at) && now - at >= 0 && now - at < MAX_AGE_MS;
  } catch { return false; }
}
