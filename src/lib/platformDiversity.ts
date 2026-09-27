// Pure helpers for the page-0 platform-diversity seed (owner PERMANENT rule 2026-07-13, Rule 2:
// the first page must show the widest platform mix; a platform with more matches must never be
// invisible just because another platform's rows dominate the recency-ordered candidate window).
// Zero-dependency (no supabase/react-native imports) so it can be unit-tested directly — mirrors
// src/lib/searchDefaults.ts / src/lib/arabicText.ts's design. The one import below is the platform
// REGISTRY, which is itself a plain array with only a type import — relative + extensioned so a
// bare `node --experimental-strip-types` run can still load this module.
import { PLATFORMS } from '../data/platforms.ts';

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

// Fold platform entries that are THE SAME WEBSITE into one diversity identity — the platform twin
// of normLocKey() above. Aqar and Aqar Monthly are two PLATFORMS rows and two DB source strings,
// but they are one site (sa.aqar.fm) rendering one logo, one name and one link. So the first screen
// showed «عقار» twice and "one listing per platform" was broken — reported from production on a
// الرياض search that filled 21 slots from 21 slugs but only 20 distinct websites.
// Keyed on the registry's DOMAIN rather than a hardcoded pair, so any future vertical of an existing
// site folds automatically and a genuinely new site never does. Display is untouched: each card
// still renders its own source exactly, just as normLocKey leaves the city spelling alone.
// Compared on letters+digits only: the RPC hands us the DB SLUG ('aqarmonthly', 'therc'), the
// hydrated listing carries the registry NAME ('Aqar Monthly', 'THE RC'), and both must resolve to the
// same identity — an exact-string map missed the slug side and «عقار» still showed twice (live,
// 2026-09-04, after the first fix). A slug the registry cannot resolve stays itself, so it remains a
// distinct identity rather than colliding with anything.
// AN ARABIC PLATFORM NAME IS A NAME, NOT NOISE (owner P0, 2026-09-26; fleet rule: Arabic notation
// parity in every deterministic parser).
//
// This used to be `s.toLowerCase().replace(/[^a-z0-9]/g, '')` — a LATIN-ONLY filter. Every Arabic
// character is outside `a-z0-9`, so a platform whose stored `source` is Arabic tokenised to the
// EMPTY STRING. Two things broke, both silently and both against the platforms least able to absorb
// it — the smaller, Arabic-named ones:
//   1. distinctPlatformCount() skips empty identities by design ("a blank source must not invent a
//      platform slot"), so those platforms were NOT COUNTED. initialReveal() sizes the first screen
//      from that count, so they got NO FIRST-SCREEN SLOT AT ALL and surfaced only after «عرض المزيد».
//   2. DOMAIN_BY_PLATFORM is keyed by this token, so all 47 Arabic-named registry rows collapsed
//      onto ONE `""` key (last write wins) — and rankedKey('platform') gave them all one identity,
//      making the five-dimension round-robin treat 47 different websites as a single platform.
//
// Measured on production 2026-09-26, الرياض / تجاري / بيع: the RPC returned 21 platforms and all 21
// were already in the page-0 buffer (no further fetch happened), 21 distinct `source` values, of
// which 11 were Arabic — «أبعاد», «نفوذ», «دويليو», «عقاريون», «منصات», «القاسم العقارية»,
// «آي باكس», «ري إنفست», «علم الريادة الإدارية», «أحمد المحيسني العقارية», «العجلان للتسويق
// العقاري». Surviving identities: 10. Cards on the first screen: 10. Those are the same number
// because they are the same bug. The owner's rule is that every matching platform gets exactly one
// first-screen card; hiding 11 of 21 behind a tap is the opposite of it.
//
// The fix keeps the folding this file already does for locations (normLocKey: hamza أإآٱ→ا,
// ة→ه, ى→ي, tatweel + directional marks dropped) and then strips only what is genuinely not a
// letter or a digit — keeping Arabic letters. Arabic-Indic digits fold to ASCII so «٢٤» and «24»
// are one token, the same parity every other deterministic parser in this repo holds to.
const ARABIC_INDIC_ZERO = 0x0660;
const rawPlatformToken = (s: string): string =>
  // NFKC FIRST. Arabic reaches us in more than one encoding of the same letters: a scraper that
  // lifts a name out of rendered HTML can hand us Arabic Presentation Forms (U+FE70–U+FEFF — the
  // contextual glyph shapes), and «رﺍﻛﺰ» is the same word as «راكز». Those code points are outside
  // the letter ranges kept below, so without this they would be STRIPPED — leaving «ر», a fragment
  // that could collide with another platform. NFKC folds them onto the base letters, and also folds
  // full-width Latin, so the ranges below only ever see canonical characters.
  normLocKey(s.normalize('NFKC'))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    // Latin letters/digits and Arabic LETTERS only. ء-غ and ف-ي are the letters;
    // ـ (tatweel) and ً-ْ (harakat) are deliberately excluded so a vocalised spelling
    // and a bare one are the same platform — the same reason normLocKey drops them for cities.
    .replace(/[^a-z0-9ء-غف-ي]/g, '');

// Memoised because the ordering walks the whole page (1500 rows) and every row's platform is one of
// ~21 strings, so the same handful of names is tokenised thousands of times. Measured on the
// production page-0 shape: the Arabic-aware token costs 1.43 ms per 1500 rows against the old
// Latin-only one's 0.42 ms — a real but trivial +1 ms on a ~400 ms search. The cache removes even
// that, so correctness here is not paid for in latency.
// Keys come from OUR OWN registry and `source` column, a set bounded by the platform roster (~120),
// never from user input — but the cap makes that a property of the code rather than an assumption
// about the data, so a future caller passing something unbounded cannot grow this without limit.
const TOKEN_CACHE_MAX = 4096;
const tokenCache = new Map<string, string>();
const platformToken = (s: string): string => {
  const hit = tokenCache.get(s);
  if (hit !== undefined) return hit;
  const out = rawPlatformToken(s);
  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.clear();
  tokenCache.set(s, out);
  return out;
};

// ONE WEBSITE, ONE IDENTITY — WHICHEVER OF ITS THREE SPELLINGS ARRIVES.
// The same platform reaches this function under different names depending on the call site: the RPC
// hands a DB slug ('aqarmonthly', 'therc'), a hydrated listing carries the stored `source` (which may
// be Latin 'Muktamel' or Arabic «أبعاد»), and some rows carry the domain itself. Keying only on the
// registry NAME left the other spellings unresolved — they fell through to themselves, so one website
// could hold two identities and take two "one per platform" slots.
// Keyed by name AND by domain, both tokenised, so every spelling lands on the domain — the one
// canonical value. A name key is never overwritten by a domain key (first write wins per key), so
// the deliberate Aqar / Aqar Monthly fold onto sa.aqar.fm is untouched. A spelling the registry
// genuinely does not know still stays itself: a distinct identity, never a collision.
const DOMAIN_BY_PLATFORM: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const p of PLATFORMS) m.set(platformToken(p.name), p.domain);
  for (const p of PLATFORMS) { const k = platformToken(p.domain); if (!m.has(k)) m.set(k, p.domain); }
  return m;
})();
export function platformIdentity(platform: string | null | undefined): string {
  const p = platformToken(platform ?? '');
  if (!p) return '';
  return DOMAIN_BY_PLATFORM.get(p) ?? p;
}

// PERMANENT DIVERSITY RULE (owner, 2026-09-14). The first «عرض المزيد» batch (up to 100 shown) must
// spread across FIVE dimensions to feel curated rather than dumped, in this priority order:
//   1. Platform  (already the outermost key since 2026-07-13 — a big platform can never crowd out a
//                 smaller one that also matched).
//   2. Deal      (buy vs rent) — only meaningful when the user asked for BOTH; opts.mixDeals turns it
//                 on. Placed right after platform so a "buy-only" or "rent-only" search is unchanged.
//   3. Property type (cleanType) — apartment/villa/land alternate WITHIN each platform's slots. Was
//                 previously multiType-only (kicked in only when the user picked 2+ types); the owner
//                 extended it to always-on (2026-09-14) — same rule for a broad search too.
//   4. District (+ city/region for broader scopes) — spread across the districts of the chosen city.
//                 Sits BETWEEN property type and photos ("between the third and the fourth", owner
//                 2026-09-14); it used to be nested directly under platform, ABOVE property type.
//   5. Photos    — a leaf preference, not a hard filter. Within an otherwise-identical group, listings
//                 that carry photos come first; no-photo listings are still shown, just later.
// docs/ARCHITECTURE.md §20 carries the canonical statement. MATCH FIRST still binds — this is only
// reordering, never adding.
function listingHasPhoto(l: unknown): boolean {
  return !!l && typeof l === 'object' && Array.isArray((l as { photos?: unknown[] }).photos)
    && (l as { photos: unknown[] }).photos.length > 0;
}
function listingDeal(l: unknown): string {
  return !!l && typeof l === 'object' && typeof (l as { deal?: unknown }).deal === 'string'
    ? (l as { deal: string }).deal : '';
}
function rankedKey<L extends { cleanType?: string | null; rentPeriod?: string | null }>(r: RankedRow<L>, k: string): string {
  return k === 'platform' ? platformIdentity(r.platform)
    : k === 'city' ? normLocKey(r.city)
    : k === 'region' ? normLocKey(r.region)
    : k === 'district' ? normLocKey(r.district)
    : k === 'cleanType' ? (r.l.cleanType ?? '')
    : k === 'period' ? (r.l.rentPeriod ?? '')
    : k === 'deal' ? listingDeal(r.l) : '';
}

// Hierarchical round-robin: group by the first key, order groups by size (densest first) then freshness,
// take one card per group per pass, and recurse with the remaining keys. At the leaf (no keys), it is
// pure newest-first by the RPC recency rank — with a photo-preference tie-break when the caller opts
// in (owner 2026-09-14: within an otherwise-identical group, photo'd listings come first so the page
// doesn't lead with empty-frame cards. No-photo listings are still shown, just later — MATCH FIRST.)
export function interleaveRanked<L extends { cleanType?: string | null; rentPeriod?: string | null }>(rows: RankedRow<L>[], keys: string[], opts?: { preferPhotos?: boolean }): RankedRow<L>[] {
  if (!keys.length) {
    if (opts?.preferPhotos) {
      return [...rows].sort((a, b) => {
        const ap = listingHasPhoto(a.l) ? 0 : 1;
        const bp = listingHasPhoto(b.l) ? 0 : 1;
        return ap - bp || a.rank - b.rank;
      });
    }
    return [...rows].sort((a, b) => a.rank - b.rank);
  }
  const [k, ...rest] = keys;
  const groups = new Map<string, RankedRow<L>[]>();
  for (const r of rows) {
    const g = rankedKey(r, k) || '∅';
    let a = groups.get(g);
    if (!a) { a = []; groups.set(g, a); }
    a.push(r);
  }
  const lists = [...groups.values()].map((g) => interleaveRanked(g, rest, opts));
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

export function orderByScope<L extends { cleanType?: string | null; rentPeriod?: string | null }>(rows: RankedRow<L>[], scope: Scope, multiType = false, mixPeriods = false, opts?: { mixDeals?: boolean; preferPhotos?: boolean }): RankedRow<L>[] {
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
  // THE OWNER'S FIVE-DIMENSION ORDER (2026-09-14, restated with district): the first «عرض المزيد»
  // batch diversifies in this exact PRIORITY, outermost → innermost:
  //   1. platform  2. deal (buy/rent)  3. property type  4. DISTRICT (+ city/region)  5. photos (leaf)
  //
  // KEY CHANGE FROM THE 2026-07-13 layout: geography (region/city/district) used to be nested
  // directly under platform — ABOVE property type. The owner moved it to sit BETWEEN property type
  // and photos (district is 4th, "between the third and the fourth"). So a الرياض search now leads
  // platform → type → then spreads across districts, instead of platform → district → type.
  const head = base.length ? [base[0]] : [];   // ['platform'] (or [] for an unscoped set)
  const geo = base.slice(1);                    // region/city/district — everything after platform
  // Coarse deal/period splitter, right after platform. mixDeals (both buy+rent) and mixPeriods
  // (rent-only, both monthly+annual) are mutually exclusive by construction, so at most one fires;
  // neither can introduce a deal/period the user didn't ask for (both are gated on the user's own
  // request upstream). Deal is coarser than period, so when both were ever set it leads.
  const coarse: string[] = [];
  if (opts?.mixDeals && head.length) coarse.push('deal');
  if (mixPeriods && head.length) coarse.push('period');
  // Property-type diversity is now ALWAYS ON (owner 2026-09-14). Was previously only added when the
  // user picked multiple types; a single-type or broad search still benefits — apartment/villa/studio
  // alternate within each platform's slots. `multiType` stays as documented context but no longer
  // gates cleanType inclusion; a single-cleanType set collapses cleanType to a no-op group, so this
  // change never widens the eligible set (MATCH FIRST holds by construction).
  void multiType;
  const keys = [...head, ...coarse, 'cleanType', ...geo];
  return interleaveRanked(rows, keys, { preferPhotos: opts?.preferPhotos });
}

// ── HOW MANY PLATFORMS GENUINELY MATCH THIS SEARCH ────────────────────────────────────────────
// Owner PERMANENT rule 2026-09-25 (reversing 2026-09-02's `max(10, ...)` floor — see
// src/lib/initialReveal.ts for the full history): the initial batch is
//   min(genuine matches, max(1, distinct matching platforms))
// so the first screen carries EXACTLY one listing per platform that has a real match — no more,
// no fewer, and never padded up to a fixed floor from whichever platform has the most inventory.
// This function supplies the "distinct matching platforms" term.
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
    const p = platformIdentity(r?.source);
    if (p) seen.add(p);          // a blank/unknown source must not invent a platform slot
  }
  return seen.size;
}
