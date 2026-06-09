import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { emptyQuery, runSearch, type SearchQuery, type SearchResult } from '@/data/search';
import { POOLS, buildPools, type Pools } from '@/data/listings';
import { fetchListings } from '@/data/remote';

type DataSource = 'local' | 'supabase';

type AppState = {
  query: SearchQuery;
  setQuery: (updater: (q: SearchQuery) => SearchQuery) => void;
  resetQuery: () => void;
  result: SearchResult | null;
  search: () => SearchResult;
  dataSource: DataSource;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [query, setQueryState] = useState<SearchQuery>(emptyQuery());
  const [result, setResult] = useState<SearchResult | null>(null);
  const [pools, setPools] = useState<Pools>(POOLS);
  const [dataSource, setDataSource] = useState<DataSource>('local');

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

  const value = useMemo<AppState>(
    () => ({
      query,
      setQuery: (updater) => setQueryState((q) => updater(q)),
      resetQuery: () => setQueryState(emptyQuery()),
      result,
      dataSource,
      search: () => {
        const r = runSearch(query, pools);
        setResult(r);
        return r;
      },
    }),
    [query, result, pools, dataSource],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}
