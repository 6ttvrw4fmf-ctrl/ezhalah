// THE UNLOCATED FALLBACK MAY ONLY EVER RESCUE GENUINELY-UNLOCATED ROWS.
//
// THE PROMISE THIS FINALLY KEEPS. Migration 20260810123000 ends with: "Regression barrier:
// scripts/verify-unlocated-fallback-scope.ts (wired into `npm test`) plus monitor
// mon_located_row_visible_only_unfiltered (must stay 0 rows)." This file did not exist. It was a
// KNOWN_GAPS entry in scripts/verify-ops-remediation-scripts-exist.ts, routed to
// routine-3-data-integrity (ops_incident #50), and a reader who trusted that sentence would have
// concluded the PR-time protection was already in place.
//
// THE DEFECT IT GUARDS (audit 2026-08-10, issue #1). The three read RPCs
// (location_search_candidates_ar, apartment_guided_counts_ar, property_age_option_counts_ar) gate
// rows with `production_ready OR (<no location filter> AND NOT search_row_price_gated(...))`. The
// second disjunct exists for the product rule "unresolved-location countrywide" — a row whose
// location never resolved still belongs in a countrywide search, because no location filter could
// ever reach it. Correct, and it must KEEP working.
//
// But `production_ready` is not a pure location gate: enforce_price_size_sanity() also clears it for
// price_size_impossible() rows (the owner-approved PR#298 safety gate). Keying the fallback off
// "the USER supplied no location filter" instead of "the ROW is unlocated" therefore leaked every
// LOCATED-but-withheld row into unfiltered search, where it vanished the moment a city was picked.
// Live before the fix: dealapp/5696027 (جدة, 22,002,786,078,000 SAR over 564,174 m²) was returned by
// p_deal='بيع' with no location filter and absent from the same call with p_cities=['جدة'] — the
// same row, the same query, two different answers depending on an unrelated filter.
//
// The fix appends `and (s.region_id is null or s.city_id is null)` to that disjunct, so the rescue
// keys off the ROW.
//
// WHY THIS ONE IS OFFLINE, AND WHAT IT ADDS TO THE LIVE TWIN. scripts/verify-unlocated-fallback-
// scope-live.ts already differences the RPC's answer against the base table through the anon path —
// it is the behavioural proof, and it is the authority on what production is doing right now. It
// cannot, however, run at PR time (no network in `npm test`, and a live check there would fail
// unrelated PRs whenever production hiccuped), so it only ever sees a regression AFTER it has been
// applied to production. This is the half that runs BEFORE: the recurrence shape here is a
// CREATE OR REPLACE that re-emits the disjunct from a pre-fix snapshot — the documented
// full-body-replace revert hazard, which is why 20260810123000 itself needle-edits rather than
// retyping the bodies. That regression is visible in the migration text at review time, and this
// catches it there.
//
// THE PREDICATE, over every migration from 20260810123000 onward: no SQL (comments stripped) may
// contain a `not public.search_row_price_gated(...)` fallback disjunct that is not immediately
// followed by the unlocated guard. Migrations BEFORE the fix are the pre-fix era by definition and
// are out of scope; the fix migration itself carries the pre-fix text as its own needle constant,
// so the window opens strictly after it.
//
// It matches on the FUNCTION NAME, not on the 2026-08-10 argument list. `search_row_price_gated`'s
// arguments have already changed once (price_total → price_total_effective, PR of 2026-09-03); a
// barrier pinned to the old literal would have gone quietly blind at that moment while still
// reporting green, which is the failure mode this whole incident is about.
//
// Comments are stripped AT THE READER, trailing ones included — a guard that a `--` line can
// satisfy is a guard a `--` line can also defeat.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

/** The migration that introduced the guard. The window is everything strictly after it. */
export const FIX_VERSION = '20260810123000';

/** The fallback disjunct, matched by function name so an argument-list change cannot blind this. */
const FALLBACK = /not\s+public\.search_row_price_gated\s*\([^)]*\)/g;

/** The row-keyed guard the fix appends to it. */
const GUARD = /^\s*and\s*\(\s*s\.region_id\s+is\s+null\s+or\s+s\.city_id\s+is\s+null\s*\)/;

/** Strip `--` line comments, trailing ones included, so commented-out SQL neither trips nor saves. */
export function stripComments(sql: string): string {
  return sql.split('\n').map((line) => {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "'") inQuote = !inQuote;
      else if (!inQuote && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

/** Every fallback disjunct in `sql` that is NOT immediately followed by the unlocated guard. */
export function unguardedFallbacks(sql: string): string[] {
  const body = stripComments(sql);
  const out: string[] = [];
  FALLBACK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FALLBACK.exec(body)) !== null) {
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 160);
    if (!GUARD.test(after)) out.push(m[0].replace(/\s+/g, ' '));
  }
  return out;
}

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) { failures++; console.error(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`);
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

console.log('unlocated fallback — the rescue disjunct must key off the ROW, never off the filter');

// ── MUTATION PROOFS — the predicate executed against fabricated SQL, both directions ────────────
const PRE_FIX = 'where (s.production_ready or (p_cities is null\n'
  + '  and not public.search_row_price_gated(s.deal_ar, s.price_total)))';
const POST_FIX = 'where (s.production_ready or (p_cities is null\n'
  + '  and not public.search_row_price_gated(s.deal_ar, s.price_total)\n'
  + '  and (s.region_id is null or s.city_id is null)))';
// The argument list already changed once. The barrier must still see the disjunct.
const POST_FIX_NEW_ARGS = 'and not public.search_row_price_gated(s.deal_ar, s.price_total_effective)\n'
  + '  and (s.region_id is null or s.city_id is null)';
const PRE_FIX_NEW_ARGS = 'and not public.search_row_price_gated(s.deal_ar, s.price_total_effective)\n'
  + '  and s.production_ready';

mustCatch('a re-emitted pre-fix disjunct is DETECTED (the full-body-replace revert hazard)',
  unguardedFallbacks(PRE_FIX).length === 1);
mustCatch('the SAME revert under a CHANGED argument list is still DETECTED',
  unguardedFallbacks(PRE_FIX_NEW_ARGS).length === 1);
mustCatch('a guard that only appears in a comment does NOT save an unguarded disjunct',
  unguardedFallbacks(PRE_FIX + '\n-- and (s.region_id is null or s.city_id is null)').length === 1);
mustCatch('a guard placed somewhere else in the file does NOT count as attached',
  unguardedFallbacks(PRE_FIX + '\nwhere x and (s.region_id is null or s.city_id is null)').length === 1);

// NEGATIVE CONTROLS. Without these a predicate that simply always flagged would satisfy every proof
// above, and the barrier would be worthless.
mustCatch('the guarded disjunct is NOT flagged',
  unguardedFallbacks(POST_FIX).length === 0);
mustCatch('the guarded disjunct under the CURRENT argument list is NOT flagged',
  unguardedFallbacks(POST_FIX_NEW_ARGS).length === 0);
mustCatch('SQL with no fallback disjunct at all is NOT flagged',
  unguardedFallbacks('select 1 from public.search_listings_ar s where s.production_ready').length === 0);
mustCatch('a commented-out pre-fix disjunct is NOT flagged',
  unguardedFallbacks('-- ' + PRE_FIX.replace(/\n/g, '\n-- ')).length === 0);

// ── THE CORPUS ──────────────────────────────────────────────────────────────────────────────────
const migDir = join(root, 'supabase/migrations');
const all = readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort();
const inWindow = all.filter((n) => n.slice(0, 14) > FIX_VERSION);

// The window must not be empty, and the fix itself must still be in the corpus — otherwise this
// barrier would pass by having nothing to look at, which is the state it exists to make impossible.
check(`the fix migration ${FIX_VERSION} is still in the corpus`,
  all.some((n) => n.startsWith(FIX_VERSION)));
check(`there are migrations after the fix to police (${inWindow.length})`, inWindow.length > 0);

const offenders: string[] = [];
for (const f of inWindow) {
  for (const hit of unguardedFallbacks(readFileSync(join(migDir, f), 'utf8'))) {
    offenders.push(`${f}: ${hit}`);
  }
}
check('no migration re-emits the unlocated fallback without the row-keyed guard', offenders.length === 0);
for (const o of offenders) console.error(`      ${o}`);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — a located-but-withheld row can answer differently`);
  console.error('  with and without a location filter, which is the audit-2026-08-10 defect.');
  console.error('  FIX: append `and (s.region_id is null or s.city_id is null)` to the fallback');
  console.error('  disjunct, and needle-edit the live body rather than replacing it wholesale.');
  console.error('  Do NOT relax this predicate: the countrywide rule is served by the guard, not by');
  console.error('  dropping it. scripts/verify-unlocated-fallback-scope-live.ts is the behavioural');
  console.error('  half and answers what production is doing right now.');
  process.exit(1);
}
console.log('\n✓ every post-fix migration keeps the unlocated fallback keyed to the ROW');
