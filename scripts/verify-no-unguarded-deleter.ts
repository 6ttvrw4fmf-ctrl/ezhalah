// No-unguarded-deleter static guard (Data Integrity run #39, 2026-08-23): make it impossible for a
// future script, scraper, or workflow to HARD-DELETE listing rows without routing through the
// unified retention engine (scrapers/common/cleanup.py), which is the only path that re-fetches a
// listing's own URL immediately before deleting it, freezes on inconclusive source health, caps the
// batch, and writes a per-row audit trail to cleanup_deletion_log BEFORE the delete.
//
// WHY THIS EXISTS. The legacy scrapers/aqar/cleanup.py deleted on age + strike count alone, with no
// re-check and no ledger. It removed 21,371 rows that way across 20 runs (2026-06-21 .. 2026-08-23),
// and because it wrote no per-row evidence, which listings those were is unrecoverable. gathern's
// own 18-day engine pilot measured 14 of 50 (28%) age+strike-eligible rows as STILL LIVE at the
// final re-check, so that rule is known to remove live listings rather than merely risk it.
// mon_detect_deletion_spike could not see any of it either: that detector reads cleanup_runs, a
// table the legacy path never wrote. Both entrypoints are now loud refusals — this guard is what
// stops a third one appearing.
//
// It scans every TRACKED file for a Supabase/PostgREST hard-delete against a listings table and
// fails if one appears outside the sanctioned engine.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Two shapes of hard delete, both scoped to SOURCE listing rows:
//   1. the PostgREST/supabase-py client delete — `.delete()`. As of 2026-08-23 there is exactly ONE
//      in the whole tracked tree, in the engine, so any second one is worth a deliberate review.
//   2. raw SQL against a source listings table, i.e. `<platform>_{residential,commercial}_listings`.
//
// `search_listings_ar` is deliberately NOT matched by (2). Deleting from the search INDEX is
// routine maintenance performed by sync_search_listings_ar — the row is re-derivable from the
// canonical table on the next sync, so it is not a hard delete of a listing and four migrations do
// it legitimately. Scoping the pattern to the source-table naming keeps this guard about the thing
// that is actually unrecoverable.
const PATTERNS = [
  String.raw`\.delete\(\)`,
  String.raw`delete[[:space:]]+from[[:space:]]+(public\.)?[a-z0-9_]+_(residential|commercial)_listings`,
];

// Only the engine may hard-delete listing rows. Everything else here either documents the ban,
// enforces it, or deletes something that is not a listing.
const SANCTIONED = new Set([
  'scrapers/common/cleanup.py',              // THE engine: re-probe → evidence → capped delete
  'scripts/verify-no-unguarded-deleter.ts',  // this file (contains the patterns themselves)
]);

// Files that legitimately contain `.delete()` against something that is NOT a listings table
// (ops bookkeeping, alert rows, test doubles). Each is an explicit, reviewed decision.
const NON_LISTING_DELETES = new Set([
  'scrapers/common/tests/test_cleanup.py',   // fake client asserting the engine's own behaviour
  'scrapers/common/tests/test_verify_deletions.py',
]);

const r = spawnSync('git', ['grep', '-nIE', PATTERNS.join('|')], { encoding: 'utf8' });
if (r.status !== 0 && r.status !== 1) {
  console.error(`❌ no-unguarded-deleter: git grep failed (status ${r.status}). ${r.stderr || ''}`);
  process.exit(1);
}

const offenders: string[] = [];
for (const line of (r.stdout || '').split('\n')) {
  if (!line.trim()) continue;
  const file = line.split(':')[0];
  if (SANCTIONED.has(file) || NON_LISTING_DELETES.has(file)) continue;
  offenders.push(line);
}

let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? '✓' : '❌'} ${msg}`);
  if (!ok) failed = true;
};

check(offenders.length === 0,
  'no hard-delete of listing rows outside scrapers/common/cleanup.py');
for (const o of offenders) console.error(`     ${o}`);

// The two retired entrypoints must STAY retired. They are kept as loud refusals rather than deleted
// so an external crontab still calling them fails visibly — but a future edit could quietly restore
// the deleter, which is exactly the regression this pins.
const legacy = readFileSync('scrapers/aqar/cleanup.py', 'utf8');
check(/RETIRED/.test(legacy) && /REFUSED/.test(legacy),
  'scrapers/aqar/cleanup.py is still a refusal stub');
check(!/\.delete\(\)/.test(legacy),
  '  …and contains no delete call at all');

const sh = readFileSync('scripts/wasalt-cleanup.sh', 'utf8');
check(/RETIRED/.test(sh) && /REFUSED/.test(sh),
  'scripts/wasalt-cleanup.sh is still a refusal stub');
// Comments and the refusal heredoc both NAME the retired module on purpose — that is the whole
// point of keeping the file. Only an EXECUTABLE line matters, so strip comments before testing.
// (Matching the raw text flagged the file's own explanation of what it used to do.)
const shCode = sh
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');
check(!/^[^#\n]*\bpython\b[^\n]*scrapers\.aqar\.cleanup/m.test(shCode),
  '  …and no executable line invokes the legacy deleter');

// The engine's own irreducible guarantees. If any of these disappear, the sanctioned path stops
// being safe and this guard's allowlist entry stops being justified.
const engine = readFileSync('scrapers/common/cleanup.py', 'utf8');
check(/def _probe\(/.test(engine),
  'the engine still re-fetches the source before deleting (_probe)');
check(/cleanup_deletion_log/.test(engine),
  'the engine still writes a per-row audit trail');
check(/_platform_health_ok/.test(engine),
  'the engine still gates on platform health');
check(/_FREEZE_MAX_INCONCLUSIVE_RATE/.test(engine),
  'the engine still freezes on inconclusive source health');
check(/max_delete_per_run/.test(engine),
  'the engine still caps the batch');

console.log(failed
  ? '\n❌ verify-no-unguarded-deleter: failed.'
  : '\n✓ no-unguarded-deleter: passed.');
process.exit(failed ? 1 : 0);
