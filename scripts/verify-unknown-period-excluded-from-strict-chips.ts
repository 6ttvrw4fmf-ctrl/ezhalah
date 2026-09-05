// AN HONEST UNKNOWN RENT PERIOD IS EXCLUDED FROM THE STRICT CHIPS — AND THAT IS NOT A FAILURE.
//
// THE OWNER RULE (2026-09-05, permanent). Keep the strict period behaviour. If the source does not
// truthfully establish the rent period, rent_period stays NULL. A NULL/UNKNOWN-period rental MAY
// remain searchable when the user applies NO period filter, but it must NOT appear under شهري,
// سنوي, or كلاهما. No fallback. Never infer the period from price, description tokens, or
// neighbouring listings.
//
// The rule therefore has TWO halves that pull in opposite directions, and a barrier that only pins
// one of them is worse than useless — it makes the other half look optional:
//
//   EXCLUSION — the three strict chips must never surface an unpublished period. The way that
//     breaks is not a wrong token, it is a MISSING one: `p_rent_period = NULL` means "apply no
//     period filter", so a client that sends null for a period selection sweeps every UNKNOWN row
//     into a chip the user believes is strict. 'كلاهما' exists precisely so "both" is the union of
//     two KNOWN periods rather than "no filter".
//   DISCOVERABILITY — the no-period path must keep those same rows. Excluding an UNKNOWN row from a
//     period chip is correct; dropping it from search altogether is data loss.
//
// WHY THIS FILE EXISTS ALONGSIDE verify-rent-period-both.ts. That barrier pins the same mapping with
// REGEXES over the source text. This one EXECUTES the real rentPeriodParam() through liftSymbols and
// asserts what it RETURNS. The distinction is the one this repo keeps re-learning: a source-text
// tripwire passes for exactly as long as the defect is live (2026-09-04: five confirmed defects,
// every one with a green text barrier over the offending line; two of them pinned the broken line as
// correct). A regex proves a shape; only a call proves a behaviour.
//
// THE THIRD HALF, and the reason the owner asked for this barrier at all: a MONITOR must not read
// the rule as a bug. mon_searchability_now.pct_period_searchable used to divide reachable-by-chip
// rows by ALL rent apartments held, so every honest UNKNOWN sat in the denominator. When the سنوي
// fallback was retired on 2026-09-03 those rows reverted to their truthful NULL and seven platforms
// went ~100% → 0% overnight, raising seven P1 SEARCHABILITY_COLLAPSE alerts that described the
// product rule working correctly. Worse, mon_raise() dedups on an open key, so while those seven sat
// open a REAL collapse on those platforms could not raise at all. The denominator is now the
// source-established cohort, which makes the metric era-proof: an UNKNOWN row leaves the numerator
// AND the denominator together, so no future decision about UNKNOWN handling can move it.
//
// Run: node --experimental-strip-types scripts/verify-unknown-period-excluded-from-strict-chips.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const MIGRATIONS = join(root, 'supabase', 'migrations');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// ── HALF 1: EXECUTED. What does the client actually send for each period selection? ──────────────
//
// rentPeriodParam() closes over nothing but its argument, so it lifts cleanly.
const { rentPeriodParam } = (await liftSymbols(
  join(root, 'src', 'data', 'remote.ts'),
  [{ header: 'function rentPeriodParam(' }],
  ['rentPeriodParam'],
  'type SearchQuery = any;\n',
)) as { rentPeriodParam: (q: unknown) => string | null };

const rent = (rentPeriod?: string, extra: Record<string, unknown> = {}) =>
  rentPeriodParam({ deal: 'Rent', rentPeriod, ...extra });

check("EXECUTED: 'monthly' → «شهري»", rent('monthly') === 'شهري', String(rent('monthly')));
check("EXECUTED: 'annual' → «سنوي»", rent('annual') === 'سنوي', String(rent('annual')));

// The load-bearing one. null here would silently widen "both" into "no period filter" and pull every
// UNKNOWN-period rental into a chip the user reads as strict.
check("EXECUTED: 'both' → «كلاهما», never null", rent('both') === 'كلاهما', String(rent('both')));

check(
  'EXECUTED: no period selection sends null (the no-period path keeps UNKNOWN rows discoverable)',
  rent(undefined) === null,
  String(rent(undefined)),
);

// A period selection must NEVER resolve to null: null is the no-filter sentinel, so any period
// selection that produces it silently includes unpublished-period rows in a strict chip. Stated as
// its own assertion rather than left implicit in the three above, because this is the invariant —
// the specific tokens are just how it is currently satisfied.
check(
  'EXECUTED: every period selection yields a real token (none collapses to the no-filter sentinel)',
  (['monthly', 'annual', 'both'] as const).every((p) => typeof rent(p) === 'string' && rent(p) !== null),
);

// Buy and the combined modes legitimately apply no period filter — pinned so a future "make it
// strict everywhere" refactor cannot quietly change what Buy searches return.
check('EXECUTED: Buy sends null (no period filter, unchanged)',
  rentPeriodParam({ deal: 'Buy', rentPeriod: 'monthly' }) === null);
check('EXECUTED: bothDeals sends null (Rent∪Buy spans unpublished periods by design)',
  rent('monthly', { bothDeals: true }) === null);

// ── HALF 2: the MONITOR must not count an honest UNKNOWN as unreachable. ─────────────────────────
//
// The rule lives in SQL, so this half is structural — but its predicate is mutation-proven below, so
// a rewrite that reintroduces the old denominator fails here rather than passing on a loose match.
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

// The denominator of pct_period_searchable must be the source-established cohort.
const DENOMINATOR_IS_PERIOD_KNOWN =
  /nullif\(count\(\*\) filter \(where s\.rent_period_ar = any \(array\['سنوي','شهري'\]\)\), 0\)/;
check(
  'the searchability ratio divides by the SOURCE-ESTABLISHED cohort, not by everything held',
  DENOMINATOR_IS_PERIOD_KNOWN.test(sql),
  'an honest UNKNOWN must leave the numerator and the denominator together',
);

// Raise and resolve must share ONE predicate (§25a). Two phrasings of "is it still broken?" always
// eventually disagree, and the disagreement is invisible: here it would have made the new healthy
// verdict OK_NO_SOURCE_ESTABLISHED_PERIOD raise (it is <> 'OK') and never clear (it is not = 'OK').
check(
  "the collapse detector's healthy test is the single predicate NOT LIKE 'OK%'",
  /verdict not like 'OK%'/.test(sql),
);
check(
  'a verdict naming the no-period-established case exists (so "nothing to measure" is not "measured and broken")',
  /OK_NO_SOURCE_ESTABLISHED_PERIOD/.test(sql),
);

// The evidence-based replacement for the statistical coverage the denominator change gives up.
check(
  'a detector fires when a SOURCE-PROVEN period is served as NULL (a period we lost, not one withheld)',
  /create or replace function public\.mon_detect_source_proven_period_unreachable/.test(sql),
);

// ── MUTATION PROOF: the predicates above must REJECT the shapes they exist to catch. ─────────────
const mut = (label: string, sample: string, re: RegExp, shouldMatch: boolean) =>
  check(`MUTATION: ${label}`, re.test(sample) === shouldMatch);

mut(
  'the OLD "everything held" denominator is rejected',
  'round(100.0 * count(*) filter (...) / nullif(count(*) filter (where sl.listing_id is null), 0)::numeric, 1)',
  DENOMINATOR_IS_PERIOD_KNOWN,
  false,
);
mut(
  'a bare nullif(count(*),0) denominator is rejected',
  'round(100.0 * count(*) filter (...) / nullif(count(*), 0)::numeric, 1)',
  DENOMINATOR_IS_PERIOD_KNOWN,
  false,
);
mut(
  'the real period_known denominator is accepted',
  "nullif(count(*) filter (where s.rent_period_ar = any (array['سنوي','شهري'])), 0)",
  DENOMINATOR_IS_PERIOD_KNOWN,
  true,
);
mut(
  "the old two-predicate healthy test (verdict <> 'OK') does not satisfy the one-predicate rule",
  "select * from public.mon_searchability_alerts where verdict <> 'OK' order by held desc",
  /verdict not like 'OK%'/,
  false,
);

// Wiring, asked of the registry rather than string-matched out of package.json (the registry guard
// rejects that pattern outright, and it is false for every check now).
check('this barrier runs in `npm test`', npmTestRuns(root, 'verify-unknown-period-excluded-from-strict-chips'));

console.log(
  failed === 0
    ? '\n✅ verify-unknown-period-excluded-from-strict-chips: strict chips exclude UNKNOWN, the no-period path keeps it, and the monitor does not call that a failure.'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
