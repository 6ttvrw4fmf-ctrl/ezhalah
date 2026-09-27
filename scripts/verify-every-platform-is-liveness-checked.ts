// EVERY WEBSITE GETS CHECKED — AND A WEBSITE ADDED TOMORROW INHERITS IT WITHOUT ANYONE ENABLING IT.
//
// THE STATE THIS EXISTS TO END (measured 2026-09-24, owner directive)
// -------------------------------------------------------------------
//   67 platforms · 234,748 active listings · 92,650 verified inside their own SLA
//   …of which 92,439 were aqar. Every other platform combined: 211. Sixty-two sat at exactly zero.
//   wasalt  56,643 active → 0.0% verified-in-SLA, declared DIRECT_REVISIT
//   gathern 28,639 active → 0.4% verified-in-SLA, declared DIRECT_REVISIT
//
// The owner's words: "I do not want Aqar to be the only website getting proper listing checks… New
// websites added in the future must automatically use the same checking system. I should not have
// to manually enable it for each website."
//
// A list of platforms someone must remember to extend is exactly how that promise breaks, so
// nothing here is a list. Every check below DISCOVERS its cohort by shape, and a new scraper or a
// new sweep written next month is RED until it complies.
//
// WHAT IS GUARDED, AND WHERE THE EXECUTED PROOF LIVES
// ---------------------------------------------------
//  1. The stamp law is EXECUTED, not grepped: `decide_direct_alive` is lifted out of the real
//     module and run, including against mutated copies of its own source.
//  2. The transient marker is consumed on EVERY write path into a listing table — the shared
//     `_wasalt_batch` and all three single-row upserts that bypass it. A leaked `_direct_alive_*`
//     key is not a cosmetic bug: it is not a column, so PostgREST would reject the whole batch and
//     a monitoring feature would have broken ingestion.
//  3. Rotation fairness: a sweep that records a verdict must also record that it LOOKED
//     (`last_liveness_probe_at`). Discovered by shape over scrapers/*/liveness*.py, so the next
//     platform's sweep cannot quietly reintroduce the bug that starved 27,102 gathern rows.
//
// This file is OFFLINE and hermetic — it reads committed source only and never touches production,
// so it belongs in the required suite (AGENTS.md, "The required suite is HERMETIC").
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';

const ROOT = join(import.meta.dirname, '..');
const SCRAPERS = join(ROOT, 'scrapers');
const DB = join(SCRAPERS, 'common', 'db.py');

const problems: string[] = [];
const dbSrc = existsSync(DB) ? readFileSync(DB, 'utf8') : '';

if (!dbSrc) problems.push('scrapers/common/db.py is missing — the shared write path has no home');

// ── 1. The marker is consumed on EVERY path into a listing table ─────────────────────────────────
// Discovered, not listed: any function in db.py that upserts a listing table must consume the
// marker, because that is the only thing that strips it before PostgREST sees it.
const upsertFns = [...dbSrc.matchAll(/\ndef (upsert_[a-z0-9_]+|_wasalt_batch)\(/g)].map(m => m[1]);
if (upsertFns.length < 100) {
  problems.push(
    `discovered only ${upsertFns.length} upsert entry points in db.py — the discovery predicate is ` +
    'broken, and a barrier that covers nothing reads exactly like a barrier with nothing to report');
}
const bodyOf = (fn: string): string => {
  const i = dbSrc.indexOf(`\ndef ${fn}(`);
  if (i < 0) return '';
  const next = dbSrc.indexOf('\ndef ', i + 1);
  return dbSrc.slice(i, next < 0 ? dbSrc.length : next);
};
for (const fn of upsertFns) {
  const body = bodyOf(fn);
  // Only functions that write to a table directly need to consume it; the ~138 thin wrappers
  // delegate to _wasalt_batch and are covered by it.
  // Only the per-platform tables matter. `public.listings` is the deprecated prototype table
  // (13 rows, no scheduled callers, unread by search) and no scraper marks rows bound for it.
  // Key on the TABLE THE CALL ACTUALLY TARGETS, never on prose: an earlier version of this
  // predicate matched upsert_listing() because its docstring mentions the per-platform tables
  // while the call writes `public.listings` — the deprecated prototype (13 rows, no scheduled
  // callers, unread by search), which no scraper ever marks rows for.
  const target = body.match(/\.table\((table|"([a-z0-9_]+)")\)[\s\S]{0,80}?\.upsert\(/);
  if (!target) continue;
  const writesListingTable = target[1] === 'table'
    || /_(residential|commercial)_listings$/.test(target[2] ?? '');
  if (!writesListingTable) continue;
  if (!body.includes('_apply_direct_alive')) {
    problems.push(
      `db.py:${fn}() writes a listing table directly but never calls _apply_direct_alive() — the ` +
      'transient direct-alive marker would reach PostgREST as an unknown column and reject the ' +
      'whole batch, so a monitoring feature could break ingestion');
  }
}

// ── 2. The law, EXECUTED ─────────────────────────────────────────────────────────────────────────
type Decision = [Record<string, string>, string];
const run = (calls: unknown[][], mutated?: string): Decision[] =>
  pyCall(ROOT, 'scrapers.common.db', 'decide_direct_alive', calls, mutated) as Decision[];

const NOW = '2026-09-24T02:00:00+00:00';
const MARK = '_direct_alive_oracle';

let real: Decision[];
try {
  real = run([
    [{ [MARK]: 'gathern.detail_fetch.unit_payload', active: true }, NOW],   // stamp
    [{ [MARK]: 'satel.detail_fetch.property', active: false }, NOW],        // sold pin wins
    [{ active: true }, NOW],                                                // no marker → nothing
    [{ [MARK]: 'x.y', active: null }, NOW],                                 // no claim → nothing
  ]);
} catch (e) {
  console.error(`RED  verify-every-platform-is-liveness-checked: could not EXECUTE decide_direct_alive — ${e}`);
  process.exit(1);
}
const [stamped, inactive, noMarker, noClaim] = real;

if (stamped[1] !== 'stamped' || !stamped[0]?.last_verified_alive_at) {
  problems.push('EXECUTED decide_direct_alive(): a row built from a DIRECT fetch of its own page ' +
    'was NOT stamped — this is the entire mechanism by which 66 non-aqar platforms get checked');
}
if (inactive[1] !== 'dropped-inactive' || Object.keys(inactive[0] ?? {}).length !== 0) {
  problems.push('EXECUTED decide_direct_alive(): a row the pipeline concluded is INACTIVE was ' +
    'still certified alive — a sold/rented listing would carry a fresh proof-of-life stamp, which ' +
    'is forged freshness and the worst failure this column can have');
}
if (noMarker[1] !== 'no-marker' || Object.keys(noMarker[0] ?? {}).length !== 0) {
  problems.push('EXECUTED decide_direct_alive(): a row with NO marker was stamped — mere crawler ' +
    'presence would become proof of life (LISTING_LIVENESS.md §3)');
}
if (Object.keys(noClaim[0] ?? {}).length !== 0) {
  problems.push('EXECUTED decide_direct_alive(): a row making no `active` claim was stamped — the ' +
    'single-row upserts set no default, so this must fail closed');
}

// ── The mutations ────────────────────────────────────────────────────────────────────────────────
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) problems.push(`MUTATION NOT CAUGHT: ${label}`);
};
const mutate = (from: string, to: string): string => {
  if (!dbSrc.includes(from)) {
    problems.push(`mutation target vanished from db.py: ${from.slice(0, 70)}…`);
    return dbSrc;
  }
  return dbSrc.split(from).join(to);
};

// THE DANGEROUS DIRECTION: drop the inactive guard and a sold listing gets certified alive.
mustCatch('an INACTIVE row being certified alive once the active guard is removed',
  run([[{ [MARK]: 'x.y', active: false }, NOW]],
    mutate('    if row.get("active") is not True:\n        # The caller claimed a direct live read',
           '    if False:\n        # The caller claimed a direct live read'))[0][1] === 'stamped');

// THE SHIPPED DEFECT: the stamp stops being produced at all, and the fleet stays at aqar-only.
mustCatch('the stamp silently never being produced (the pre-2026-09-24 state)',
  run([[{ [MARK]: 'x.y', active: true }, NOW]],
    mutate('    return direct_alive_patch(now_iso=now_iso), "stamped"',
           '    return {}, "stamped"'))[0][0]?.last_verified_alive_at === undefined);

// Presence becoming proof: the marker requirement removed.
mustCatch('a row with no marker being stamped once the marker check is removed',
  run([[{ active: true }, NOW]],
    mutate('    if not oracle:\n        return {}, "no-marker"',
           '    if False:\n        return {}, "no-marker"'))[0][1] === 'stamped');

// A blank oracle: an unfalsifiable stamp.
// A blank/absent oracle must never produce a stamp: an evidence claim that cannot say WHAT was
// read is unfalsifiable, which is the 2026-08-26 aqarcity lesson (254 kills nobody could adjudicate).
mustCatch('a blank oracle producing a stamp',
  run([[{ [MARK]: '', active: true }, NOW]])[0][1] === 'no-marker'
  && Object.keys(run([[{ [MARK]: '', active: true }, NOW]])[0][0] ?? {}).length === 0);

// ── 3. Rotation fairness, discovered by shape ────────────────────────────────────────────────────
// A sweep that records a verdict must also record that it LOOKED. Without that, a row it probes and
// finds dead moves no column, keeps its stale last_seen_at, and outranks never-looked-at rows in
// the next worklist forever — the bug that left 27,102 gathern listings untouched while the same
// ~1,500 were re-probed every single run.
const sweeps: string[] = [];
for (const d of readdirSync(SCRAPERS, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  for (const f of readdirSync(join(SCRAPERS, d.name)).filter(x => /liveness.*\.py$/.test(x))) {
    const src = readFileSync(join(SCRAPERS, d.name, f), 'utf8');
    // A sweep is a module that records strikes or deactivations against a listing table.
    const recordsVerdicts = /"missing_count"\s*:/.test(src) && /\.update\(/.test(src);
    if (!recordsVerdicts) continue;
    sweeps.push(`${d.name}/${f}`);
    // Must be a real WRITE, not a mention. Strip comments first and require the dict-key form:
    // the first version of this check used src.includes('last_liveness_probe_at') and passed on a
    // COMMENT naming the column while every actual write had been deleted — a source-text tripwire
    // asserting nothing, caught only by mutating it (AGENTS.md's hardest-won rule).
    const code = src.replace(/(^|\n)\s*#[^\n]*/g, '$1');
    if (!/["']last_liveness_probe_at["']\s*:/.test(code)) {
      problems.push(
        `scrapers/${d.name}/${f} records liveness verdicts but never writes ` +
        'last_liveness_probe_at — a row it probes and finds dead will move no column, stay at the ' +
        'head of its staleness-ordered worklist forever, and starve every row behind it ' +
        '(migration 20260924; gathern 0.4%)');
    }
  }
}
if (sweeps.length === 0) {
  problems.push('discovered ZERO liveness sweeps — the discovery predicate is broken');
}

if (problems.length) {
  console.error('RED  verify-every-platform-is-liveness-checked\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(
  `PASS verify-every-platform-is-liveness-checked — ${upsertFns.length} upsert entry points ` +
  `discovered and every direct writer consumes the marker; decide_direct_alive() executed, ` +
  `3 mutations caught + the blank-oracle refusal; ${sweeps.length} liveness sweeps (${sweeps.join(', ')}) all record that ` +
  'they looked');
