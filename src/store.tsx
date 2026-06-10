import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { emptyQuery, runSearch, queryLabel, type SearchQuery, type SearchResult } from '@/data/search';
import { POOLS, buildPools, type Listing, type Pools } from '@/data/listings';
import { fetchListings } from '@/data/remote';
import { trackClick } from '@/data/clicks';
import { supabase } from '@/lib/supabase';
import { mapSupabaseUser, signOutBackend } from '@/lib/auth';

type DataSource = 'local' | 'supabase';

export type AuthUser = {
  method: 'phone' | 'google' | 'apple';
  name: string;
  initials: string;
  sub: string; // phone or email
};

export type HistoryItem = { id: string; label: string; query: SearchQuery; ts: number; starred?: boolean };

type AppState = {
  query: SearchQuery;
  setQuery: (updater: (q: SearchQuery) => SearchQuery) => void;
  resetQuery: () => void;
  runQuery: (q: SearchQuery) => SearchResult;
  dataSource: DataSource;
  // Auth + the post-first-search gate (PRD §9): the first search is free; anything beyond it
  // requires sign-in. `gated` is true once a guest has used their one free search.
  user: AuthUser | null;
  signIn: (u: AuthUser) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
  signOut: () => void;
  searchCount: number;
  gated: boolean;
  // CPC tracking (PRD §13): log a click-through whenever the user opens a partner listing.
  trackOpen: (listing: Listing) => void;
  // Resolve a listing by id from the live (Supabase-hydrated) catalog, so the in-app
  // browser opens real ingested listings — not just the bundled seed ids.
  findListing: (id: number) => Listing | undefined;
  // Search history (PRD §13: retained until account deletion). Most-recent first.
  history: HistoryItem[];
  clearHistory: () => void;
  toggleStar: (id: string) => void;
  deleteHistory: (id: string) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [query, setQueryState] = useState<SearchQuery>(emptyQuery());
  const [pools, setPools] = useState<Pools>(POOLS);
  const [dataSource, setDataSource] = useState<DataSource>('local');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [searchCount, setSearchCount] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Record a search into history, de-duping consecutive identical labels.
  const recordHistory = (q: SearchQuery) =>
    setHistory((h) => {
      const label = queryLabel(q);
      const rest = h.filter((it) => it.label !== label);
      return [{ id: 'h' + Date.now(), label, query: q, ts: Date.now() }, ...rest].slice(0, 50);
    });

  // Hydrate the catalog from Supabase once; the bundled POOLS stay in place if the fetch fails.
  useEffect(() => {
    let cancelled = false;
    fetchListings().then((rows) => {
      if (cancelled || !rows || rows.length === 0) return;
      setPools(buildPools(rows));
      setDataSource('supabase');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real auth: adopt an existing Supabase session on launch and keep `user` in sync
  // with the backend (covers OAuth redirects bouncing back to /auth and token refresh).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      const su = data.session?.user;
      if (!cancelled && su) {
        const method = (su.app_metadata?.provider as AuthUser['method']) ?? 'phone';
        setUser(mapSupabaseUser(su, method === 'google' || method === 'apple' ? method : 'phone'));
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const su = session?.user;
      if (su) {
        const method = (su.app_metadata?.provider as AuthUser['method']) ?? 'phone';
        setUser(mapSupabaseUser(su, method === 'google' || method === 'apple' ? method : 'phone'));
      } else {
        setUser(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AppState>(
    () => ({
      query,
      setQuery: (updater) => setQueryState((q) => updater(q)),
      resetQuery: () => setQueryState(emptyQuery()),
      dataSource,
      user,
      searchCount,
      gated: !user && searchCount >= 1,
      signIn: (u) => setUser(u),
      updateUser: (patch) => setUser((u) => (u ? { ...u, ...patch } : u)),
      signOut: () => {
        setUser(null);
        void signOutBackend();
      },
      runQuery: (q) => {
        const r = runSearch(q, pools);
        setSearchCount((c) => c + 1);
        recordHistory(q);
        return r;
      },
      trackOpen: (listing) => {
        void trackClick(listing, user?.sub ?? null);
      },
      findListing: (id) => {
        for (const key of Object.keys(pools) as (keyof Pools)[]) {
          const hit = pools[key].find((l) => l.id === id);
          if (hit) return hit;
        }
        return undefined;
      },
      history,
      clearHistory: () => setHistory([]),
      toggleStar: (id) =>
        setHistory((h) => h.map((it) => (it.id === id ? { ...it, starred: !it.starred } : it))),
      deleteHistory: (id) => setHistory((h) => h.filter((it) => it.id !== id)),
    }),
    [query, pools, dataSource, user, searchCount, history],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}
