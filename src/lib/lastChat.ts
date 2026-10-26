// «Show the last thing he did» (owner 2026-10-26): a signed-in user who comes back lands in the chat they
// had open last, instead of the home page. The id is kept per account on this device; the jump happens
// once per tab (the first time the home page shows), so pressing «home» afterwards still goes home.
const KEY = 'ez:lastChat:v1:';
const TAB_KEY = 'ez:lastChatResumed:v1';
const FIRST_HOME_KEY = 'ez:firstHomeAt:v1';
/** The jump only happens this soon after the tab first showed the home page: a history that loads later, or a
 *  later visit to home in the same tab, never yanks the user away from what they are doing. */
export const RESUME_WINDOW_MS = 5000;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const local = (): Store | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};
const session = (): Store | null => {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
};

/** Remember the chat this account has open now (null clears it: the user started a fresh one). */
export function rememberLastChat(account: string | null | undefined, chatId: string | null, s: Store | null = local()): void {
  if (!account) return;
  try {
    if (chatId) s?.setItem(KEY + account, chatId);
    else s?.removeItem(KEY + account);
  } catch { /* no storage: the user just lands on home */ }
}

/** The chat to reopen for this account, ONCE per tab — or null (none saved, gone from the history, or done). */
export function takeLastChatToResume(
  account: string | null | undefined,
  historyIds: readonly string[],
  now = Date.now(),
  s: Store | null = local(),
  tab: Store | null = session(),
): string | null {
  if (!account) return null;
  try {
    if (tab?.getItem(TAB_KEY)) return null;
    const first = Number(tab?.getItem(FIRST_HOME_KEY) ?? '');
    if (!Number.isFinite(first) || first <= 0 || now - first > RESUME_WINDOW_MS) return null;
    const id = s?.getItem(KEY + account) ?? null;
    if (!id || !historyIds.includes(id)) return null;
    tab?.setItem(TAB_KEY, '1');
    return id;
  } catch { return null; }
}

/** Stamp the first time this tab showed the home page (kept for the tab's life). */
export function markFirstHomeView(now = Date.now(), tab: Store | null = session()): void {
  try { if (!tab?.getItem(FIRST_HOME_KEY)) tab?.setItem(FIRST_HOME_KEY, String(now)); } catch { /* no storage: no jump */ }
}
