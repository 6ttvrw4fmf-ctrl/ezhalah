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

// ── Diversity-order hierarchy (orderByScope / interleaveRanked) ─────────────────────────────────────
// Extracted from src/data/remote.ts (zero behavioral change beyond the owner 2026-07-13 key reorder
// below) so the exact reordering algorithm is unit-testable without the react-native import chain that
// blocks importing remote.ts directly (it pulls in @/i18n → react-native, Flow syntax, no plain runner
// can parse it outside Metro/Babel). `L` is generic over the listing payload — only `cleanType` is ever
// read from it (the multi-type diversity tier), so no dependency on the real `Listing` type is needed.

export type Scope = 'district' | 'city' | 'region' | 'country';

export type RankedRow<L extends { cleanType?: string | null; rentPeriod?: string | null } = { cleanType?: string | null }> = {
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

function rankedKey<L extends { cleanType?: string | null; rentPeriod?: string | null }>(r: RankedRow<L>, k: string): string {
  return k === 'platform' ? r.platform
    : k === 'city' ? normLocKey(r.city)
    : k === 'region' ? normLocKey(r.region)
    : k === 'district' ? normLocKey(r.district)
    : k === 'cleanType' ? (r.l.cleanType ?? '')
    : k === 'period' ? (r.l.rentPeriod ?? '') : '';
}

// Hierarchical round-robin: group by the first key, order groups by size (densest first) then freshness,
// take one card per group per pass, and recurse with the remaining keys. At the leaf (no keys), it is
// pure newest-first by the RPC recency rank.
export function interleaveRanked<L extends { cleanType?: string | null; rentPeriod?: string | null }>(rows: RankedRow<L>[], keys: string[]): RankedRow<L>[] {
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

export function orderByScope<L extends { cleanType?: string | null; rentPeriod?: string | null }>(rows: RankedRow<L>[], scope: Scope, multiType = false, mixPeriods = false): RankedRow<L>[] {
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
  // Rent period (owner feature 2026-08-14): when the user asked for BOTH monthly and annual, spread across
  // the two periods so the answer visibly contains both instead of whichever period happens to dominate the
  // recency window (annual outnumbers monthly ~43k:32k fleet-wide, so an un-mixed list can open all-annual).
  // MATCH FIRST, DIVERSIFY SECOND: this only re-orders rows the period filter already matched — it can never
  // introduce a period the user didn't ask for. Placed AFTER platform, never before: platform is the
  // outermost diversity key by the owner's PERMANENT rule (2026-07-13), and nesting period inside it still
  // alternates both periods within every platform's own share.
  const withPeriod = mixPeriods && base.length ? [base[0], 'period', ...base.slice(1)] : base;
  // Tier 3 (user rule 2026-06-28): when the user picked MULTIPLE exact types, spread across THOSE types
  // LAST — after platform. This only re-orders the already-matched set; it never introduces an unpicked
  // type (the rows were already constrained to the selected types by the raw fetch + matchesType).
  const keys = multiType ? [...withPeriod, 'cleanType'] : withPeriod;
  return interleaveRanked(rows, keys);
}

// ── HOW MANY PLATFORMS GENUINELY MATCH THIS SEARCH ────────────────────────────────────────────
// Owner PERMANENT rule 2026-09-02: the initial batch is
//   min(genuine matches, max(10, distinct matching platforms))
// so the first screen carries one listing from EVERY platform that has a real match, instead of a
// fixed ten. This function supplies the "distinct matching platforms" term.
//
// DERIVED, NEVER LISTED. The count is read from the eligible rows themselves — no allowlist, no
// array of platform names, no number to bump. A new scraper participates the moment it contributes
// one genuine matching listing; a platform that is disabled, retired, or simply has no match for
// THIS search contributes nothing. («therc» entered the Riyadh villa set during this work with no
// ranking code edited — that is the intended behaviour.)
//
// COUNTING THE FETCHED PAGE IS EXACT, NOT APPROXIMATE. Both ordering layers emit one row per
// platform before any platform repeats — the RPC's div_rank is a per-platform row_number(), and
// interleaveRanked() above round-robins with `platform` as the OUTERMOST key — so a page of 1,500
// already contains every platform that has a match.
//
// IT CANNOT HARM MATCHING. This only sizes a PREFIX of an array the RPC has already filtered to the
// true eligible set. It cannot add a row, widen a predicate, or reach outside the set; the only
// thing it can change is how much of what already matched is revealed. MATCH stays absolute by
// construction rather than by promise.
export function distinctPlatformCount(rows: ReadonlyArray<{ source?: string | null }> | null | undefined): number {
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    const p = (r?.source ?? '').trim();
    if (p) seen.add(p);          // a blank/unknown source must not invent a platform slot
  }
  return seen.size;
}
