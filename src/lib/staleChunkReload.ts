// 🔧 2026-11-02 — A DEPLOY MUST NOT BREAK AN OPEN TAB (Sentry REACT-NATIVE-J, REACT-NATIVE-K).
//
// Since the web bundle is split per route (app.json `asyncRoutes`, #9956, deployed 11-02), a tab that loaded
// BEFORE a deploy holds an entry that names the OLD route chunks (`agent-<hash>.js`, `index-<hash>.js` …).
// The next deploy serves a new set under new names, the old names answer 404, Metro throws
// `AsyncRequireError: Loading module … failed` and the screen never renders — the customer sees nothing and
// nothing recovers. Measured 13:10 UTC 11-02: two customers on /agent; 13:53: one more on /. One deploy
// breaks every tab that was open, and the robot now deploys several times an hour.
//
// The honest repair is the one every split bundle uses: reload the page ONCE for that URL, so the fresh entry
// names the fresh chunks. A second failure of the same URL inside the window is REPORTED, never reloaded again
// (no loop when a chunk is truly missing), and without session storage nothing is reloaded (a loop could not
// be guarded). Pure decisions here; `app/_layout.tsx` wires them into the global handlers.
// Barrier: scripts/verify-stale-chunk-reload.ts (executes these against a planted AsyncRequireError).

export const STALE_CHUNK_KEY = 'ezhalah:stale-chunk-reload';
export const RELOAD_WINDOW_MS = 5 * 60 * 1000;

export type MiniStore = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export type StaleChunkEnv = { store: MiniStore | null; reload: () => void; now: () => number };

const CHUNK_RE =
  /Loading (?:module|chunk) (\S+?) failed|Failed to fetch dynamically imported module:? ?(\S+)|Importing a module script failed|ChunkLoadError/i;

/** The failed module URL ('' when the text names none) when `err` is a chunk-load failure, else null. */
export function staleChunkUrl(err: unknown): string | null {
  const e: any = err;
  const name = typeof e?.name === 'string' ? e.name : '';
  const msg = typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : '';
  const m = CHUNK_RE.exec(msg);
  if (name === 'AsyncRequireError' || name === 'ChunkLoadError' || m) {
    return String(m?.[1] ?? m?.[2] ?? '').replace(/[.,;)]+$/, '');
  }
  return null;
}

/** true → reload now (first failure of this URL in the window); false → already reloaded for it: report instead. */
export function shouldReload(url: string, store: MiniStore | null, now: number): boolean {
  if (!store) return false;
  let prev: { url?: unknown; at?: unknown } | null = null;
  try {
    const raw = store.getItem(STALE_CHUNK_KEY);
    prev = raw ? JSON.parse(raw) : null;
  } catch {
    prev = null;
  }
  if (prev && prev.url === url && typeof prev.at === 'number' && now - prev.at < RELOAD_WINDOW_MS) return false;
  try {
    store.setItem(STALE_CHUNK_KEY, JSON.stringify({ url, at: now }));
  } catch {
    return false; // the guard could not be written → a reload could loop → report instead
  }
  return true;
}

/** One global error / rejection. true ⇒ the page is being reloaded and the caller must NOT report it as an error. */
export function handleStaleChunk(err: unknown, env: StaleChunkEnv): boolean {
  const url = staleChunkUrl(err);
  if (url === null) return false;
  if (!shouldReload(url || 'unknown-chunk', env.store, env.now())) return false;
  env.reload();
  return true;
}

/** The browser's own store / reload / clock; every read is guarded (private mode, blocked storage, SSR). */
export function browserStaleChunkEnv(): StaleChunkEnv {
  const g: any = globalThis as any;
  let store: MiniStore | null = null;
  try {
    const s = g.sessionStorage;
    if (s) { s.getItem(STALE_CHUNK_KEY); store = s; }
  } catch {
    store = null;
  }
  return {
    store,
    reload: () => { try { g.location?.reload(); } catch { /* nothing to do */ } },
    now: () => Date.now(),
  };
}
