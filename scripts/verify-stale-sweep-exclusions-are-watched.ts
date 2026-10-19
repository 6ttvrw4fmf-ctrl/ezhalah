// PERMANENT BARRIER — a table the stale sweep skips BY NAME must still be watched by something
// (2026-09-21, routine-3-data-integrity).
//
// THE DEFECT THIS GENERALISES. `mark_stale_listings_inactive()` is the only path that reports a
// listing table's stale-active backlog — it raises `stale_listings_detected`, `stale_active` and
// `stale_breaker_escape`. It skips three tables by name:
//
//     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
//       and tablename not like 'wasalt_%'
//       and tablename <> 'aqar_residential_listings'
//
// The intent is right: those platforms have their own DIRECT_REVISIT sweep, which is a better
// oracle than a clock. Nothing, anywhere, checked that the substitute mechanism actually reaches
// every row. That is the "a pointer reads as coverage" shape AGENTS.md already names.
//
// It was live for 55 days. Measured 2026-09-21: 169 `aqar_residential_listings` rows were active
// with `missing_count = 0` and `last_seen_at` frozen in 2026-07-25..28, against a declared SLA of
// 48h. No strike could ever accrue to them, so `served_after_source_gone` and `prune_unseen` were
// structurally blind; and at 169/93,030 = 0.18% every platform-level percentage read aqar as
// 99.4% healthy. A direct probe of 25 of them against sa.aqar.fm, through the repo's own
// `looks_dead()` lifted out of scrapers/aqar/liveness.py, returned LIVE 25/25 — so nothing wrong
// was being served. The defect was that had they died, nothing would ever have noticed.
//
// WHAT IS ASSERTED HERE, and why it is this and not something easier. The live half — how many
// rows are actually stranded right now — belongs to `mon_detect_liveness_rotation_stranded()`,
// which runs on the detector roster; a check that has to reach production must not sit in the
// required suite (AGENTS.md, "The required suite is HERMETIC"). What IS hermetic, and what the
// whole design rests on, is that the detector DISCOVERS the exclusion list by parsing the live
// source of `mark_stale_listings_inactive()` instead of restating it. If that parse silently stops
// matching, the detector keeps returning 0 and reads as a clean bill of health — the exact
// nine-dark-detectors failure this repo has already had once.
//
// So this file lifts the two regexes OUT OF THE COMMITTED MIGRATION (never a retyped copy) and
// EXECUTES them against real sweep sources: the committed one, mutated ones, and shapes designed
// to fool them. A barrier nobody has watched fail is a comment that runs.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const readMigration = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');

// ── The detector, and the exclusion lifter, each judged at its LATEST committed definition ──────
// `create or replace` means the last migration to define a function is the one production runs, so
// that is the one to judge. Reading the first definition instead would have declared a fixed
// predicate still broken — and, in the other direction, would let a later migration quietly
// reintroduce a defect behind a green check.
const latestDefining = (needle: string) =>
  migrationFiles.filter((f) => readMigration(f).includes(needle)).pop();

const detectorFile = latestDefining(
  'create or replace function public.mon_detect_liveness_rotation_stranded',
);
const lifterFile = latestDefining(
  'create or replace function public.ops_stale_sweep_excluded_tables',
);
if (!detectorFile || !lifterFile) {
  fail('no committed migration defines the liveness-rotation-stranded detector and its lifter');
  console.log('\n❌ 1 check(s) failed.');
  process.exit(1);
}
const detectorSql = readMigration(detectorFile);
const lifterSql = readMigration(lifterFile);

/** Lift a `regexp_matches(src, '<pattern>', 'g')` pattern out of the shipped SQL by its shape. */
const liftPattern = (needle: string): RegExp => {
  const m = lifterSql.match(
    new RegExp(`regexp_matches\\(src,\\s*'((?:[^']|'')*${needle}(?:[^']|'')*)'`),
  );
  if (!m) throw new Error(`the shipped lifter no longer carries a ${needle} exclusion pattern`);
  // PostgreSQL doubles a quote inside a literal; JavaScript does not.
  return new RegExp(m[1].replace(/''/g, "'"), 'g');
};

let EQ_PATTERN: RegExp | null = null;
let LIKE_PATTERN: RegExp | null = null;
try {
  EQ_PATTERN = liftPattern('<>');
  LIKE_PATTERN = liftPattern('not');
  ok(`lifted both exclusion patterns out of ${lifterFile} (no retyped copy)`);
} catch (e) {
  fail((e as Error).message);
}

// `pg_get_functiondef()` hands the detector the body verbatim, comments included, so it strips
// line comments before matching — otherwise a clause someone commented out reads as a live
// exclusion. Lifted from the shipped SQL rather than retyped, same as the patterns above.
const STRIPS_COMMENTS = /regexp_replace\(src,\s*'--\[\^'\s*\|\|\s*chr\(10\)\s*\|\|\s*'\]\*'/.test(lifterSql);
if (STRIPS_COMMENTS) ok('the detector strips SQL line comments before lifting exclusions');
else fail('the detector parses pg_get_functiondef() output WITHOUT stripping comments — a '
  + 'commented-out clause would be lifted as a live exclusion');

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

/**
 * The detector's discovery step, executed: given a sweep's source, which table names does it
 * exclude? `=name` is an exact exclusion, `~pat` a LIKE pattern — the same two shapes the SQL
 * builds into its `excl` array.
 */
const exclusionsIn = (rawSweepSrc: string): string[] => {
  if (!EQ_PATTERN || !LIKE_PATTERN) return [];
  const sweepSrc = STRIPS_COMMENTS ? stripComments(rawSweepSrc) : rawSweepSrc;
  const out: string[] = [];
  for (const m of sweepSrc.matchAll(new RegExp(EQ_PATTERN.source, 'g'))) out.push(`=${m[1]}`);
  for (const m of sweepSrc.matchAll(new RegExp(LIKE_PATTERN.source, 'g'))) out.push(`~${m[1]}`);
  return out.sort();
};

/** Does an excluded-table spec cover this table name? Mirrors the SQL's `exists (...)` clause. */
const covers = (spec: string, table: string): boolean =>
  spec[0] === '='
    ? table === spec.slice(1)
    : new RegExp(`^${spec.slice(1).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`)
      .test(table);

const watched = (sweepSrc: string, table: string) =>
  exclusionsIn(sweepSrc).some((s) => covers(s, table));

// ── The real sweep, as committed ────────────────────────────────────────────────────────────────
const sweepFile = migrationFiles.filter((f) => readMigration(f).includes(
  'create or replace function public.mark_stale_listings_inactive',
)).pop();

if (!sweepFile) fail('no committed migration defines mark_stale_listings_inactive()');
else {
  const sweepSql = readMigration(sweepFile);
  const found = exclusionsIn(sweepSql);

  // The three tables production reports today. This is a FLOOR on what must be discovered, not a
  // ceiling: a fourth exclusion added tomorrow is discovered automatically and needs no edit here.
  const MUST_DISCOVER = [
    'aqar_residential_listings',
    'wasalt_residential_listings',
    'wasalt_commercial_listings',
  ];
  for (const t of MUST_DISCOVER) {
    if (watched(sweepSql, t)) ok(`${t} is discovered as stale-sweep-excluded → the detector watches it`);
    else fail(`${t} is skipped by the stale sweep and the detector's parse does NOT find it — `
      + 'it would be watched by nothing at all');
  }

  // A table the sweep does cover must NOT be claimed by this detector, or the two disagree and
  // one platform gets two alerts for one condition.
  if (!watched(sweepSql, 'aqar_commercial_listings')) {
    ok('aqar_commercial_listings is NOT claimed (the stale sweep really does cover it)');
  } else {
    fail('aqar_commercial_listings is claimed by the strand detector although the stale sweep '
      + 'covers it — duplicate alerting on one condition');
  }

  if (found.length >= 2) ok(`${found.length} exclusion(s) lifted from ${sweepFile}: ${found.join(' ')}`);
  else fail(`only ${found.length} exclusion(s) lifted from ${sweepFile} — the parse has gone blind, `
    + 'and a blind parse returns 0 findings, which reads exactly like health');
}

// ── Mutation proofs: each feeds the REAL patterns an input that must flip the verdict ────────────
const mustCatch = (what: string, run: () => boolean) => {
  if (run()) ok(`mutation caught: ${what}`);
  else fail(`MUTATION SURVIVED: ${what}`);
};

const SWEEP = (...clauses: string[]) => `
create or replace function public.mark_stale_listings_inactive(stale_days integer default 7)
returns integer language plpgsql as $function$
begin
  for t in select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      ${clauses.join('\n      ')}
  loop null; end loop;
end $function$;`;

mustCatch('a NEW by-name exclusion is discovered without anyone editing a list',
  () => watched(SWEEP("and tablename <> 'gathern_residential_listings'"),
    'gathern_residential_listings'));

mustCatch('a NEW pattern exclusion is discovered without anyone editing a list',
  () => watched(SWEEP("and tablename not like 'dealapp_%'"), 'dealapp_commercial_listings'));

mustCatch('a sweep that excludes nothing yields nothing to watch (no phantom coverage)',
  () => exclusionsIn(SWEEP()).length === 0
     && !watched(SWEEP(), 'aqar_residential_listings'));

mustCatch('dropping the aqar exclusion stops claiming aqar (the detector follows the sweep, '
  + 'it does not out-vote it)',
  () => !watched(SWEEP("and tablename not like 'wasalt_%'"), 'aqar_residential_listings'));

mustCatch('a LIKE pattern is not read as an exact name',
  () => !watched(SWEEP("and tablename not like 'wasalt_%'"), 'wasalt_%'.replace('%', 'x_y')
    .replace('wasalt_x_y', 'nowasalt_residential_listings')));

mustCatch('an exclusion named only in a COMMENT does not count',
  () => !watched(`-- we should probably add: tablename <> 'sanadak_residential_listings'\n`
    + SWEEP().replace(/tablename <>[^\n]*/g, ''), 'sanadak_residential_listings'));

mustCatch('a `like` (not `not like`) clause is not mistaken for an exclusion — that shape SELECTS '
  + 'tables in, and reading it as an exclusion would silently stop watching everything else',
  () => exclusionsIn(SWEEP("and tablename like 'aqar_%'")).length === 0);

// ── The detector must be registered where something actually runs it ────────────────────────────
if (/mon_run_all_detectors/.test(detectorSql)
    && /mon_detect_liveness_rotation_stranded/.test(detectorSql)) {
  ok('the detector is added to the mon_run_all_detectors roster in the SAME migration');
} else {
  fail('the detector migration does not register it on the mon_run_all_detectors roster — '
    + 'a detector nothing reaches is decoration');
}

if (/raise exception[^\n]*roster anchor not found/.test(detectorSql)) {
  ok('the roster edit fails LOUD if its anchor ever moves (never silently unregistered)');
} else {
  fail('the roster edit can silently no-op if its anchor moves — the registration would be lost '
    + 'with no error, and the detector would run nowhere');
}

// The repair must never be "make the alert go away".
if (/do_not/.test(detectorSql) && /UNKNOWN, never dead/.test(detectorSql)
    && /backdate last_seen_at/.test(detectorSql)) {
  ok('the alert names the two forbidden repairs (deactivate; backdate last_seen_at)');
} else {
  fail('the alert does not forbid clearing itself by deactivating the rows or backdating '
    + 'last_seen_at — the two ways to turn this finding into forged freshness');
}

console.log(failures === 0
  ? '\n✅ every table the stale sweep skips by name is watched by something.'
  : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
