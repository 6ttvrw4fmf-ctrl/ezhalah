// Pure helpers for the page-0 platform-diversity seed (owner PERMANENT rule 2026-07-13, Rule 2:
// the first page must show the widest platform mix; a platform with more matches must never be
// invisible just because another platform's rows dominate the recency-ordered candidate window).
// Zero-dependency (no supabase/react-native imports) so it can be unit-tested directly — mirrors
// src/lib/searchDefaults.ts / src/lib/arabicText.ts's design.

export type DiversityCand = {
  source_table: string;
  listing_id: number;
  last_updated?: string | null;
  [key: string]: unknown;
};

export function candKey(c: DiversityCand): string {
  return `${c.source_table}:${c.listing_id}`;
}

// Merge a small per-platform-capped "seed" fetch into the main recency-window candidate pool,
// deduping by (source_table, listing_id) and re-deriving order to match the RPC's own
// `ORDER BY last_updated DESC NULLS LAST, source_table, listing_id` — so the merged pool's
// position still means "true recency rank" for interleaveRanked's freshness tiebreaks.
// NULLS LAST (owner 2026-07-16, "newest first" fix): a row with an unknown last_updated has no
// evidence it is the newest, so it must never sort to the top (that would fabricate recency it
// doesn't have). Unknown-date rows go LAST here, mirroring the RPC's matching NULLS LAST.
export function mergeDiversitySeed<T extends DiversityCand>(
  mainCands: T[],
  seedCands: T[],
): { merged: T[]; boostedKeys: Set<string> } {
  const known = new Set(mainCands.map(candKey));
  const boostedKeys = new Set<string>();
  const fresh: T[] = [];
  for (const c of seedCands) {
    const key = candKey(c);
    if (!known.has(key)) {
      known.add(key);
      fresh.push(c);
      boostedKeys.add(key);
    }
  }
  if (!fresh.length) return { merged: mainCands, boostedKeys };
  const dateVal = (c: T) => (c.last_updated ? Date.parse(c.last_updated) : -Infinity);
  const merged = [...mainCands, ...fresh].sort((a, b) => {
    const da = dateVal(a), db = dateVal(b);
    if (da !== db) return db - da; // last_updated DESC (unknown date → -Infinity, sorts LAST — never claim an unknown-date row is newest)
    if (a.source_table !== b.source_table) return a.source_table < b.source_table ? -1 : 1;
    return a.listing_id - b.listing_id;
  });
  return { merged, boostedKeys };
}

// Drop any candidate already shown via a prior page-0 diversity seed, so a Load-More page (which
// walks the main recency window by its own true rank) never re-shows the same card once the window
// naturally reaches that platform's real position.
export function filterBoosted<T extends DiversityCand>(cands: T[], boostedKeys: Set<string>): T[] {
  if (!boostedKeys.size) return cands;
  return cands.filter((c) => !boostedKeys.has(candKey(c)));
}

// ── Diversity-order hierarchy (orderByScope / interleaveRanked) ─────────────────────────────────────
// Extracted from src/data/remote.ts (zero behavioral change beyond the owner 2026-07-13 key reorder
// below) so the exact reordering algorithm is unit-testable without the react-native import chain that
// blocks importing remote.ts directly (it pulls in @/i18n → react-native, Flow syntax, no plain runner
// can parse it outside Metro/Babel). `L` is generic over the listing payload — only `cleanType` is ever
// read from it (the multi-type diversity tier), so no dependency on the real `Listing` type is needed.

export type Scope = 'district' | 'city' | 'region' | 'country';

export type RankedRow<L extends { cleanType?: string | null } = { cleanType?: string | null }> = {
  l: L;
  platform: string;
  city: string;
  region: string;
  district: string;
  rank: number;
  source_table: string;
};

// Fold Arabic spelling variants (hamza أإآٱ→ا, ta-marbuta ة→ه, alef-maqsura ى→ي, drop tatweel +
// directional marks, collapse whitespace) — mirrors the DB's normalize_ar(). Used ONLY to build the
// diversification GROUPING key so spelling twins of one city (المدينة المنورة / المدينه المنوره,
// أبها / ابها) count as a single city when balancing result order. It NEVER touches the display value —
// the property card still renders the exact scraped spelling. (owner: Option B canonicalization, 2026-07-06.)
function normLocKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ـ‌‍‎‏‪‫‬‭‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rankedKey<L extends { cleanType?: string | null }>(r: RankedRow<L>, k: string): string {
  return k === 'platform' ? r.platform
    : k === 'city' ? normLocKey(r.city)
    : k === 'region' ? normLocKey(r.region)
    : k === 'district' ? normLocKey(r.district)
    : k === 'cleanType' ? (r.l.cleanType ?? '') : '';
}

// Hierarchical round-robin: group by the first key, order groups by size (densest first) then freshness,
// take one card per group per pass, and recurse with the remaining keys. At the leaf (no keys), it is
// pure newest-first by the RPC recency rank.
export function interleaveRanked<L extends { cleanType?: string | null }>(rows: RankedRow<L>[], keys: string[]): RankedRow<L>[] {
  if (!keys.length) return [...rows].sort((a, b) => a.rank - b.rank);
  const [k, ...rest] = keys;
  const groups = new Map<string, RankedRow<L>[]>();
  for (const r of rows) {
    const g = rankedKey(r, k) || '∅';
    let a = groups.get(g);
    if (!a) { a = []; groups.set(g, a); }
    a.push(r);
  }
  const lists = [...groups.values()].map((g) => interleaveRanked(g, rest));
  // Densest group leads (Riyadh before a tiny town); ties broken by the freshest listing in the group.
  lists.sort((a, b) => b.length - a.length || a[0].rank - b[0].rank);
  const out: RankedRow<L>[] = [];
  for (let i = 0; out.length < rows.length; i++) {
    let progressed = false;
    for (const g of lists) { if (i < g.length) { out.push(g[i]); progressed = true; } }
    if (!progressed) break;
  }
  return out;
}

export function orderByScope<L extends { cleanType?: string | null }>(rows: RankedRow<L>[], scope: Scope, multiType = false): RankedRow<L>[] {
  // Diversity hierarchy per scope — SUPERSEDES the 2026-06-27 geography-first order (Region → cities →
  // districts → platforms) per owner PERMANENT rule 2026-07-13: "Rule 1 filters always win; Rule 2,
  // platform diversity, is the highest-priority tie-break after that — a platform with many matches must
  // never crowd out other platforms with real matches." Platform is now the OUTERMOST key for every scope
  // (geography still varies WITHIN each platform's own share via the nested keys, so paging deeper still
  // spans districts/cities/regions as before — only the FRONT of the list changes). This also brings the
  // code in line with the already-LOCKED 2026-06-28 rule (filters → platform second → property-type third)
  // which this geography-first order had never actually matched. Live-verified: without this, a
  // Rent+Apartment+Riyadh search rendered 100% one platform on the first page despite a larger platform
  // having more real matches.
  const base = scope === 'country' ? ['platform', 'region', 'city', 'district']
    : scope === 'region' ? ['platform', 'city', 'district']
    : scope === 'city' ? ['platform', 'district']
    : scope === 'district' ? ['platform']
    : [];
  // Tier 3 (user rule 2026-06-28): when the user picked MULTIPLE exact types, spread across THOSE types
  // LAST — after platform. This only re-orders the already-matched set; it never introduces an unpicked
  // type (the rows were already constrained to the selected types by the raw fetch + matchesType).
  const keys = multiType ? [...base, 'cleanType'] : base;
  return interleaveRanked(rows, keys);
}
