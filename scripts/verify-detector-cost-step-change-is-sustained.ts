// Barrier: A DETECTOR COST STEP CHANGE MUST BE SUSTAINED, NEVER A ONE-SWEEP SPIKE.
// Senior Production Engineer (routine-2-production), 2026-09-26. Offline, deterministic,
// discovered into `npm test` by scripts/lib/testRegistry.ts.
//
// WHAT THIS GUARDS. mon_detect_detector_sweep_budget() LIMB 5 names the detector whose cost has
// "stepped far above its OWN baseline". Until 2026-09-26 it decided that from the PEAK of the last
// three sweeps -- max(elapsed_ms) filter (where rn <= 3) -- so a single sweep in which the detector
// merely WAITED on a lock satisfied it in full, and the payload then asserted the detector "now
// costs many times what it used to" and sent the responder to root-cause its query.
//
// MEASURED ON PRODUCTION THE DAY THIS SHIPPED:
//   * 71 detector_cost_step_change alerts since the limb shipped on 2026-09-15. SEVENTY resolved
//     within 1-3 sweeps -- inside the limb's own lookback, i.e. transients. Exactly one was real:
//     alert 3146, mon_detect_card_label_contract, p50 10.2s -> 460s sustained, open three days.
//   * Replayed over 11 days of ops_detector_timing at every sweep:
//       peak-of-3 rule:  204 detector-sweeps raise across 13 detectors
//       2nd-of-3 rule:     3 detector-sweeps raise across  1 detector  <- and it is the real one.
//   * The cost is not only noise. mon_raise() dedups on an open key, so while a transient sat open
//     under detector_cost_step_change:<detector>, a GENUINE regression in that same detector raised
//     NOTHING. mon_detect_phasea_offregion_pick held that key open 11 times.
//
// THE PROOF IS EXECUTED, NOT DESCRIBED. This file does not carry its own copy of the rule. It
// PARSES the three numbers that decide it -- the array index, the ratio multiplier and the absolute
// floor -- out of the real migration's real function body, builds the decision from those, and runs
// it against real production series. Change [2] to [1], or 60000 to 600, or drop the null guard,
// and the extracted decision changes and the executed cases fail. A copy would measure a copy, and
// a text match would be satisfied by a comment; AGENTS.md records both failure shapes.
//
// §MUTATIONS at the bottom re-breaks the REAL migration source IN MEMORY and asserts problems()
// speaks up. Nothing is written to disk: a mutant that cannot be left behind cannot be committed by
// a concurrent session in this shared working directory.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const PREDICATE = 'mon_detector_cost_step_is_sustained';

// The limb's two calibrated constants. LOWERING EITHER IS THE WIDENING THIS BARRIER EXISTS TO STOP.
// The 5x ratio keeps an expensive-but-steady detector quiet; the 60s floor keeps a cheap detector
// quiet (8ms -> 60ms is 7.5x and costs nothing). Both predate this change and are untouched by it.
const MIN_RATIO = 5;
const MIN_FLOOR_MS = 60000;
// >= 2 of the last 3 sweeps must be elevated. Index 1 would be the peak -- the defect.
const REQUIRED_INDEX = 2;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
}

console.log('\nA detector cost step change must be sustained, never a one-sweep spike\n');

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

// Resolve by CONTENT and take the NEWEST, never a hardcoded filename: the server mints migration
// versions, so a pinned name breaks the moment the object is redefined.
function newestDefining(symbol: string): { file: string; sql: string } | null {
  const owning = files
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))
    .filter(({ sql }) =>
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${symbol}\\b`, 'i').test(sql))
    .sort((a, b) => a.file.localeCompare(b.file));
  return owning.length > 0 ? owning[owning.length - 1] : null;
}

// Executable SQL only. These migrations quote their own clauses in the rationale constantly, so a
// raw-text match would be satisfied by a COMMENT describing the fix while the code no longer does
// it -- the "a pointer reads as coverage" shape. The strip is load-bearing, not tidiness.
function executable(sql: string): string {
  return sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
}

// Read the closing dollar tag rather than assuming `$function$`: an unreadable body returns '',
// which fails every assertion, instead of leaking the rest of the file into the match.
function bodyOf(sql: string, symbol: string): string {
  const start = sql.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${symbol}\\b`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const tag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
  if (!tag) return '';
  const openAt = tag.index + tag[0].length;
  const closeAt = rest.indexOf(tag[0], openAt);
  if (closeAt < 0) return '';
  return executable(rest.slice(0, closeAt + tag[0].length));
}

/** The decision, as the migration's own source defines it — parsed, never re-typed. */
type Decision = { index: number; ratio: number; floor: number; guardsNull: boolean };

function extractDecision(predCode: string): Decision | null {
  // ... p_recent_desc[N] is not null and p_recent_desc[N] > greatest(M * coalesce(p_p50_ms,0), F)
  const idx = [...predCode.matchAll(/p_recent_desc\[\s*(\d+)\s*\]/g)].map((m) => Number(m[1]));
  const cmp = predCode.match(
    /p_recent_desc\[\s*\d+\s*\]\s*>\s*greatest\(\s*([0-9.]+)\s*\*\s*coalesce\(\s*p_p50_ms\s*,\s*0\s*\)\s*,\s*([0-9]+)\s*\)/);
  if (idx.length === 0 || cmp === null) return null;
  if (new Set(idx).size !== 1) return null;            // the guard and the comparison must agree
  return {
    index: idx[0],
    ratio: Number(cmp[1]),
    floor: Number(cmp[2]),
    guardsNull: /p_recent_desc\[\s*\d+\s*\]\s+is\s+not\s+null/.test(predCode),
  };
}

/** Run the extracted decision. `series` is a detector's last 3 real elapsed_ms, any order. */
function decide(d: Decision, p50: number | null, series: number[] | null): boolean {
  if (series === null) return false;
  const desc = [...series].sort((a, b) => b - a);
  const v = desc[d.index - 1];
  if (d.guardsNull && v === undefined) return false;
  if (v === undefined) return false;
  return v > Math.max(d.ratio * (p50 ?? 0), d.floor);
}

// Real production series. Each is a measured fact, cited, not an invented example.
const CASES: ReadonlyArray<{ name: string; p50: number | null; series: number[] | null; raise: boolean }> = [
  // The two raises of 2026-09-26: one elevated sweep bracketed by baseline, both times.
  { name: 'phasea_offregion_pick 05:31 isolated spike (12599/65845/12686)',
    p50: 11903, series: [65845, 12686, 12599], raise: false },
  { name: 'phasea_offregion_pick 01:29 isolated spike (13730/62299/12704)',
    p50: 11867, series: [62299, 13730, 12704], raise: false },
  // The one true positive the limb was built for: alert 3146, 2026-09-15 11:29.
  { name: 'card_label_contract 2026-09-15 sustained regression (45x, three days open)',
    p50: 10214, series: [466338, 460308, 459997], raise: true },
  // The 60s absolute floor: a cheap detector at 7.5x costs nothing.
  { name: 'cheap detector 8ms -> 60ms (7.5x, under the floor)',
    p50: 8, series: [60, 60, 60], raise: false },
  // Really measured at 7.43x on 2026-09-26 and correctly silent: never crossed 60s.
  { name: 'rent_period_inferred_when_source_silent 7.43x but 36.6s',
    p50: 4932, series: [36647, 36647, 4900], raise: false },
  // The 5x ratio: expensive-but-steady must stay quiet.
  { name: 'expensive but steady (60s p50 at 100s = 1.7x)',
    p50: 60000, series: [100000, 100000, 100000], raise: false },
  { name: 'two of three elevated at the same magnitude',
    p50: 11903, series: [65845, 65000, 12599], raise: true },
  // Persistence unprovable => abstain, never raise.
  { name: 'a single sample cannot demonstrate persistence',
    p50: 11903, series: [65845], raise: false },
  { name: 'a null series raises nothing', p50: 11903, series: null, raise: false },
  // A null baseline is not a free pass: the floor still governs, in both directions.
  { name: 'null p50 above the floor still raises', p50: null, series: [61000, 61000, 61000], raise: true },
  { name: 'null p50 below the floor stays quiet', p50: null, series: [59000, 59000, 59000], raise: false },
];

/**
 * THE RULE, as one pure function over the migration's source text. Returns the labels of every
 * property VIOLATED — empty means the limb requires persistence and keeps both calibrated
 * constants. §MUTATIONS re-runs this SAME function against deliberately broken source, so the
 * proof is a statement about the code that decides, not about a copy of it.
 */
function problems(migrationSql: string): string[] {
  const out: string[] = [];
  const bad = (s: string) => out.push(s);

  const predCode = bodyOf(migrationSql, PREDICATE);
  if (predCode.length === 0) { bad(`${PREDICATE}() is not defined here`); return out; }

  const d = extractDecision(predCode);
  if (d === null) {
    bad('the decision (index, ratio, floor) is readable from the predicate body');
    return out;
  }

  if (d.index !== REQUIRED_INDEX) {
    bad(`the decision reads p_recent_desc[${REQUIRED_INDEX}] (>= 2 of 3 sweeps elevated), `
      + `not [${d.index}] — index 1 is the PEAK, which is the 2026-09-26 defect`);
  }
  if (!(d.ratio >= MIN_RATIO)) bad(`the ${MIN_RATIO}x ratio survives (found ${d.ratio}x)`);
  if (!(d.floor >= MIN_FLOOR_MS)) bad(`the ${MIN_FLOOR_MS}ms floor survives (found ${d.floor}ms)`);
  if (!d.guardsNull) {
    bad('fewer than 2 real runs ABSTAINS — a null sustained value must never be a raise');
  }

  // EXECUTE the extracted decision against every real series. This is the half a text match cannot
  // do: it is the only assertion that fails when the constants are individually plausible but the
  // combination no longer separates a spike from a step.
  for (const c of CASES) {
    const got = decide(d, c.p50, c.series);
    if (got !== c.raise) {
      bad(`executed: ${c.name} — expected ${c.raise ? 'RAISE' : 'quiet'}, got ${got ? 'RAISE' : 'quiet'}`);
    }
  }

  // The limb must keep delegating to the predicate. A needle-edit that silently stopped applying
  // would leave the pure function defined, correct, and called by nobody — coverage on paper only.
  const exec = executable(migrationSql);
  if (!new RegExp(`if\\s+public\\.${PREDICATE}\\(r_rec\\.p50_ms,\\s*r_rec\\.recent_desc\\)\\s+then`)
        .test(exec)) {
    bad('LIMB 5 calls the predicate (the needle-edited condition is present in this migration)');
  }
  // ... and the needle edit must stay FAIL-CLOSED, so a moved body aborts instead of no-opping.
  const needleGuards = (exec.match(/raise exception 'needle [ABC]/g) ?? []).length;
  if (needleGuards < 3) {
    bad(`all three needles abort if not found exactly once (found ${needleGuards} guards)`);
  }
  // The apply-time executed proof must survive: it is what makes the migration self-checking.
  if (!exec.includes('proof FAILED')) {
    bad('the migration still executes its own both-directions proof at apply time');
  }

  return out;
}

const owner = newestDefining(PREDICATE);
check(`a migration defines ${PREDICATE}()`, owner !== null);

if (owner !== null) {
  console.log(`      newest definition: ${owner.file}`);
  const found = problems(owner.sql);
  check('the limb requires a SUSTAINED step change and keeps both calibrated constants',
    found.length === 0, found.join('\n      '));

  const d = extractDecision(bodyOf(owner.sql, PREDICATE));
  if (d !== null) {
    console.log(`      decision as the source defines it: p_recent_desc[${d.index}] > `
      + `greatest(${d.ratio} * p50, ${d.floor}ms), null-abstains=${d.guardsNull}`);
    console.log(`      ${CASES.length} real production series executed against it`);
  }

  // ── §MUTATIONS ───────────────────────────────────────────────────────────────────────────────
  // Each re-breaks the REAL source in memory. A mutant that survives is a hole in this barrier.
  const MUTANTS: ReadonlyArray<{ label: string; apply: (s: string) => string }> = [
    { label: 'M1 the peak is restored (index 2 -> 1) — the 2026-09-26 defect itself',
      apply: (s) => s.replace(/p_recent_desc\[2\]/g, 'p_recent_desc[1]') },
    { label: 'M2 the 60s absolute floor is widened away (60000 -> 600)',
      apply: (s) => s.replace(/,\s*60000\s*\)/, ', 600)') },
    { label: 'M3 the 5x ratio is dropped to 1x',
      apply: (s) => s.replace(/5\s*\*\s*coalesce\(\s*p_p50_ms/, '1 * coalesce(p_p50_ms') },
    { label: 'M4 the abstain-on-unprovable guard is deleted',
      apply: (s) => s.replace(/p_recent_desc\[2\] is not null\s*\n\s*and /, '') },
    { label: 'M5 the predicate is defined but LIMB 5 no longer calls it',
      apply: (s) => s.replace(
        /if public\.mon_detector_cost_step_is_sustained\(r_rec\.p50_ms, r_rec\.recent_desc\) then/,
        'if r_rec.recent_ms > 0 then') },
    { label: 'M6 a needle stops failing closed (its abort is removed)',
      apply: (s) => s.replace(/raise exception 'needle A/, "raise notice 'needle A") },
    { label: 'M7 the apply-time executed proof is removed',
      apply: (s) => s.replace(/proof FAILED/, 'proof noted') },
    // M8 is the one that caught an earlier draft of this file: mutating ONLY the comparison while
    // leaving the null guard at [2] makes the two indexes disagree. A barrier that read just the
    // first match would have called that healthy.
    { label: 'M8 the guard and the comparison are made to disagree ([2] guard, [1] compared)',
      apply: (s) => s.replace(/and p_recent_desc\[2\] >/, 'and p_recent_desc[1] >') },
  ];

  for (const m of MUTANTS) {
    const mutated = m.apply(owner.sql);
    const changed = mutated !== owner.sql;
    const caught = problems(mutated).length > 0;
    check(`${m.label} → caught`, changed && caught,
      !changed ? 'the mutation did not alter the source — this mutant proves nothing'
               : 'the mutant SURVIVED: this barrier has a hole');
  }
}

console.log(failures === 0
  ? '\nAll checks passed.\n'
  : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
