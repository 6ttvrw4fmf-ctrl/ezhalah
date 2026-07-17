// TRIPWIRE + REGRESSION TEST — the null-category leak (residential-commercial-isolation-audit-2026-07-17).
//
// WHY THIS EXISTS: an 8-agent evidence audit (owner request, 2026-07-17) proved that deselecting the
// Home/Filter category pill (tapping the already-selected pill → q.category becomes null, with no type
// or group selected either) sent p_category:null to location_search_candidates_ar. That makes the RPC's
// own purity predicate `(p_category IS NULL OR EXISTS(...))` an unconditional no-op for that call, AND
// search.ts's client-side matchesType() safety net short-circuited to `return true` in the same state —
// so BOTH layers meant to enforce Residential/Commercial purity were simultaneously disabled. Since
// kindsFor() already only reads residential-KIND tables in this exact state ("Default Residential"),
// and ~14.4k Commercial-macro rows are physically misfiled into residential-kind tables (mostly Aqar's
// أرض تجارية), those misfiled rows sailed straight through unfiltered. Live-quantified: 1,202
// Commercial-macro rows leaking into a realistic Riyadh+Buy+no-type search.
//
// THE FIX: remote.ts's impliedCategory(q) resolves the query's EFFECTIVE macro instead of using raw
// q.category — 'Residential' when nothing at all is selected (mirrors kindsFor's own documented
// default), unchanged otherwise. search.ts's matchesType() enforces the same default in its final
// fallback instead of accepting everything. Neither the RPC SQL, cards, nor filter UI change.
//
// This script: (a) replicates the exact new logic as pure functions and genuinely EXECUTES it against
// concrete cases (not just string-matching), and (b) asserts via source-text that the shipped files
// actually call these code paths — remote.ts and search.ts pull in heavy React Native / Supabase-client
// imports that can't be live-imported by a plain node script (same constraint documented in
// verify-type-and-attribute-fallback.ts), so the source-text check ties the executed replica back to
// what's actually shipped.
//
//   node --experimental-strip-types scripts/verify-null-category-purity.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

// ── faithful replica of remote.ts's impliedCategory (real logic, genuinely executed) ──
type Macro = 'Residential' | 'Commercial';
type Q = { category?: Macro | null; type?: string | null; types?: string[] | null; typeGroup?: string | null };
const effectiveTypes = (q: Q): string[] => (q.types && q.types.length ? q.types : (q.type ? [q.type] : []));
function effectiveCleanQuery(q: Q): { kinds: string[] } | null {
  // A real clean-type/group lookup isn't reproducible offline (needs propertyTypes' full taxonomy), but
  // impliedCategory only cares whether SOMETHING was selected — so a non-null sentinel is faithful here.
  if (effectiveTypes(q).length) return { kinds: [] };
  if (q.typeGroup) return { kinds: [] };
  return null;
}
function impliedCategory(q: Q): Macro | null {
  if (q.category) return q.category;
  return effectiveCleanQuery(q) ? null : 'Residential';
}

// ── faithful replica of search.ts's matchesType tail (the client-side safety net) ──
type Listing = { macro?: Macro | null; cleanType?: string; type: string };
const CLEAN_MACRO: Record<string, Macro> = { Villa: 'Residential', 'Commercial Land': 'Commercial' };
function matchesTypeTail(l: Listing, q: Q): boolean {
  const c = l.cleanType ?? l.type;
  const sel = effectiveTypes(q);
  if (sel.length) return sel.some((s) => s === c);
  if (q.typeGroup) return false; // group membership not reproducible offline; irrelevant to this tail
  if (q.category) return (l.macro ?? CLEAN_MACRO[c] ?? 'Residential') === q.category;
  return (l.macro ?? CLEAN_MACRO[c] ?? 'Residential') === 'Residential';
}

// ── EXECUTED tests: impliedCategory ──
eq('nothing selected (category pill deselected) implies Residential', impliedCategory({}), 'Residential');
eq('nothing selected, all fields explicitly null, implies Residential', impliedCategory({ category: null, type: null, types: null, typeGroup: null }), 'Residential');
eq('explicit category is passed through unchanged (Residential)', impliedCategory({ category: 'Residential' }), 'Residential');
eq('explicit category is passed through unchanged (Commercial)', impliedCategory({ category: 'Commercial' }), 'Commercial');
eq('a specific type selected with no category stays null (already scoped by raw type_ar, untouched by this fix)', impliedCategory({ type: 'Villa' }), null);
eq('a multi-select types list with no category stays null', impliedCategory({ types: ['Villa', 'Apartment'] }), null);
eq('a typeGroup with no category stays null', impliedCategory({ typeGroup: 'مرافق خدمية' }), null);

// ── EXECUTED tests: matchesType's nothing-selected fallback ──
check('a Residential-macro listing is KEPT when nothing is selected', matchesTypeTail({ macro: 'Residential', type: 'Villa' }, {}));
check(
  'THE LEAK, closed: a Commercial-macro listing (misfiled into a residential-kind table) is now EXCLUDED when nothing is selected',
  !matchesTypeTail({ macro: 'Commercial', type: 'Commercial Land' }, {}),
);
check(
  'same, resolved via CLEAN_MACRO fallback when the row has no explicit .macro (mirrors real Listing shape)',
  !matchesTypeTail({ type: 'Commercial Land' }, {}),
);
check('an explicit Commercial category search still keeps a Commercial-macro listing (unchanged behavior)', matchesTypeTail({ macro: 'Commercial', type: 'Commercial Land' }, { category: 'Commercial' }));
check('a specific-type search ignores macro entirely (unchanged behavior — already exactly scoped by type)', matchesTypeTail({ macro: 'Commercial', type: 'Villa' }, { type: 'Villa' }));

// ── source-text ties: the shipped files actually wire in this exact fix ──
const remoteSrc = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
const searchSrc = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');

check('remote.ts defines impliedCategory()', /function impliedCategory\(q: SearchQuery\): Macro \| null/.test(remoteSrc));
check("impliedCategory's nothing-selected branch resolves to 'Residential', not null", /return effectiveCleanQuery\(q\) \? null : 'Residential';/.test(remoteSrc));
check(
  'the RPC scope actually calls impliedCategory(q) for p_category (not the old bare `q.category ?? null`)',
  /p_category:\s*impliedCategory\(q\),/.test(remoteSrc),
);
check(
  'the old unguarded `p_category: q.category ?? null,` is GONE (would silently re-open the leak if reintroduced)',
  !/p_category:\s*q\.category\s*\?\?\s*null,/.test(remoteSrc),
);

check(
  "search.ts's matchesType no longer unconditionally returns true when nothing is selected",
  !/if \(q\.category\) return \(l\.macro \?\? CLEAN_MACRO\[c\] \?\? 'Residential'\) === q\.category;\s*\n\s*return true;/.test(searchSrc),
);
check(
  "matchesType's final fallback now enforces macro === 'Residential' instead of accepting everything",
  /return \(l\.macro \?\? CLEAN_MACRO\[c\] \?\? 'Residential'\) === 'Residential';\s*\n\}/.test(searchSrc),
);

console.log(
  failed === 0
    ? '\n✓ null-category purity fix verified — the 1,202-row leak path is closed and pinned against regression'
    : `\n✗ ${failed} null-category purity check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
