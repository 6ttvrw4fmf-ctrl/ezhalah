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
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';

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
  // user_chats = the signed-in user's OWN saved conversations (owner 2026-08-25, ChatGPT-grade
  // persistence), never a listing row. Deletes here are the user deleting/clearing their own chats,
  // RLS-scoped to auth.uid() — the server cannot even see another user's rows to delete.
  'src/lib/chatSync.ts',
]);

// A COMMENT CANNOT DELETE ANYTHING. This guard's own barrier-14 migration explains the failure it
// prevents, and quoting `delete from <platform>_residential_listings` in that explanation tripped it
// (CI, 2026-08-24) — the same false positive the wasalt-cleanup.sh check already had to solve by
// stripping comments before testing. The rule is the one that was already established there: only an
// EXECUTABLE occurrence counts. Documentation of the ban is not a violation of it, and a guard that
// punishes writing the rule down teaches people to describe the danger vaguely.
//
// This does NOT narrow what the guard catches: stripping is per file type and removes only comment
// syntax, so any real statement — including one on the same line as a comment — still matches.
// codeOnly() is exercised in both directions by the self-test at the bottom of this file.
export function codeOnly(path: string, text: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  // Markdown is prose by definition: nothing in a .md file executes, so a fenced example of the
  // banned statement is documentation, not a deleter.
  if (ext === '.md') return '';
  let out = text;
  if (ext === '.sql' || ext === '.ts' || ext === '.js') {
    out = out.replace(/\/\*[\s\S]*?\*\//g, ' ');            // /* block */
  }
  const lineComment = ext === '.sql' ? /--.*$/gm
    : (ext === '.ts' || ext === '.js') ? /\/\/.*$/gm
    : /#.*$/gm;                                            // .py .sh .yml .yaml and friends
  return out.replace(lineComment, ' ');
}

const CODE_PATTERNS = PATTERNS.map((p) =>
  new RegExp(p.replace(/\[\[:space:\]\]/g, '\\s'), 'i'));

const r = spawnSync('git', ['grep', '-nIE', PATTERNS.join('|')], { encoding: 'utf8' });
if (r.status !== 0 && r.status !== 1) {
  console.error(`❌ no-unguarded-deleter: git grep failed (status ${r.status}). ${r.stderr || ''}`);
  process.exit(1);
}

const offenders: string[] = [];
const commentOnly: string[] = [];
for (const line of (r.stdout || '').split('\n')) {
  if (!line.trim()) continue;
  const file = line.split(':')[0];
  if (SANCTIONED.has(file) || NON_LISTING_DELETES.has(file)) continue;
  // git grep found the text; the file's code, with comments removed, decides whether it can run.
  const code = codeOnly(file, readFileSync(file, 'utf8'));
  if (!CODE_PATTERNS.some((re) => re.test(code))) { commentOnly.push(line); continue; }
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
if (commentOnly.length) {
  console.log(`     (${commentOnly.length} occurrence(s) in comments/docs — explanation, not code)`);
}

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
//
// Extracted as a PURE function so it can be fed a deliberately broken engine and watched to fail.
// Until 2026-09-13 these were five inline regexes: correct, but never once watched to go red, so a
// typo that made one of them unfalsifiable would have read as five guarantees holding. That is the
// grandfather-list backlog this routine exists to drain (BARRIER_ENGINEER.md PART 3, R1).
export function engineGuaranteeProblems(src: string): string[] {
  const REQUIRED: [RegExp, string][] = [
    [/def _probe\(/, 're-fetches the source before deleting (_probe)'],
    [/cleanup_deletion_log/, 'writes a per-row audit trail'],
    [/_platform_health_ok/, 'gates on platform health'],
    [/_FREEZE_MAX_INCONCLUSIVE_RATE/, 'freezes on inconclusive source health'],
    [/max_delete_per_run/, 'caps the batch'],
  ];
  return REQUIRED.filter(([re]) => !re.test(src)).map(([, what]) => `the engine no longer ${what}`);
}

const engine = readFileSync('scrapers/common/cleanup.py', 'utf8');
const engineProblems = engineGuaranteeProblems(engine);
check(engineProblems.length === 0,
  'the engine keeps all five irreducible guarantees (probe · ledger · health · freeze · cap)');
for (const p of engineProblems) console.error(`     ${p}`);

// ── Barrier 14: the runtime half. ───────────────────────────────────────────────────────────────
// Everything above is static: it proves no TRACKED FILE hard-deletes a listings table outside the
// engine. It cannot see a `delete from aqar_residential_listings` typed into psql, run through an
// MCP session, or buried in a migration — and neither could the two runtime barriers that existed,
// because mon_detect_deletion_spike reads cleanup_runs and mon_detect_cleanup_evidence_gap limb B
// reads scrape_runs, and a raw statement writes neither. Barrier 14 closes that by taking the
// evidence at the table itself. Pinned here so the migration cannot be reverted or hollowed out
// without CI going red — a barrier nobody can see disappear is not a barrier.
const barrier14 = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ f, sql: readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8') }))
  .find(({ sql }) => /create\s+trigger\s+trg_archive_hard_delete/i.test(sql));

// Extracted as a PURE function, same reason as engineGuaranteeProblems above: five inline regexes
// over a migration nobody had ever watched this check reject. A `null` migration — none found —
// is a PROBLEM, never a skip: "the barrier-14 migration is absent" must not read as "barrier 14 is
// fine", which is the shape an `if (barrier14)` guard silently produces.
export function barrier14Problems(sql: string | null): string[] {
  if (sql === null) return ['no migration arms trg_archive_hard_delete on the listings tables'];
  const out: string[] = [];
  // The arming must be a PATTERN LOOP over the listings tables, never a hand-listed set: a new
  // platform's table would otherwise ship unaudited, and nothing would say so.
  if (!(/table_name\s+like\s+'%\\_residential\\_listings'/i.test(sql)
     && /table_name\s+like\s+'%\\_commercial\\_listings'/i.test(sql))) {
    out.push('the trigger is not armed over every *_{residential,commercial}_listings table by pattern');
  }
  if (!/create\s+or\s+replace\s+function\s+public\.mon_detect_unledgered_hard_delete/i.test(sql)) {
    out.push('mon_detect_unledgered_hard_delete() is not defined');
  }
  if (!(/cleanup_deletion_log/.test(sql) && /purged_listings_archive/.test(sql))) {
    out.push('the detector does not compare what vanished against the engine ledger');
  }
  // The detector must never key on deletion_reason: a bypass path can set that GUC as easily as it
  // can skip the ledger, so trusting it would let the caught actor silence its own alarm.
  const detectorBody = sql.slice(sql.indexOf('mon_detect_unledgered_hard_delete'));
  if (/deletion_reason\s*(=|<>|!=|like|in\b)/i.test(detectorBody)) {
    out.push('the detector TRUSTS deletion_reason, which the deleter itself writes');
  }
  if (!(/pg_get_functiondef/i.test(sql) && /mon_run_all_detectors/i.test(sql))) {
    out.push('the detector is not wired into the roster by a guarded needle-edit');
  }
  return out;
}

const b14Problems = barrier14Problems(barrier14 ? barrier14.sql : null);
check(b14Problems.length === 0,
  'barrier 14 is armed by pattern, defined, ledger-comparing, unspoofable and rostered');
for (const p of b14Problems) console.error(`     ${p}`);

// ── Self-test: the comment-stripping must not become a way through. ─────────────────────────────
// Both directions, because only one of them is obvious. If codeOnly() ever over-strips, the guard
// goes quiet on a real deleter and nothing else in the suite would notice.
const REAL = 'delete from aqar_residential_listings where id = 1;';
const hits = (path: string, body: string) =>
  CODE_PATTERNS.some((re) => re.test(codeOnly(path, body)));

// ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────────
// Every predicate this guard owns is fed a deliberately broken world and watched to FAIL. Before
// 2026-09-13 this file was on scripts/mutation-proof-grandfathered.txt: fifteen assertions over the
// deletion path — the single most unrecoverable operation in this system — and not one of them had
// ever been observed going red. The engine and barrier-14 checks were inline regexes, so a typo that
// made one unfalsifiable would have read as a guarantee holding.
const mustCatch = (label: string, caught: boolean) => {
  console.log(`  ${caught ? '✓' : '❌'} MUTATION caught: ${label}`);
  if (!caught) failed = true;
};

// The deleter-detection predicate, both directions.
mustCatch('a real SQL delete against a source listings table',
  hits('x.sql', REAL));
mustCatch('a real delete sitting on the line under a comment that quotes it',
  hits('x.sql', `-- explaining ${REAL}\n${REAL}`));
mustCatch('a client-side .delete() in python',
  hits('x.py', 'client.table("aqar_residential_listings").delete().execute()'));

// The engine's five guarantees, removed ONE AT A TIME against the REAL engine source — so each
// regex is proven to be load-bearing individually, not merely as a group where one survivor hides
// four dead ones.
for (const [needle, what] of [
  ['def _probe(', 'the source re-fetch (_probe)'],
  ['cleanup_deletion_log', 'the per-row audit trail'],
  ['_platform_health_ok', 'the platform-health gate'],
  ['_FREEZE_MAX_INCONCLUSIVE_RATE', 'the inconclusive-health freeze'],
  ['max_delete_per_run', 'the per-run batch cap'],
] as const) {
  mustCatch(`the engine losing ${what}`,
    engineGuaranteeProblems(engine.split(needle).join('/* REMOVED */')).length === 1);
}

// Barrier 14, each limb independently.
mustCatch('the barrier-14 migration being ABSENT (must not read as "barrier 14 is fine")',
  barrier14Problems(null).length === 1);
if (barrier14) {
  const sql = barrier14.sql;
  mustCatch('the trigger armed from a HARDCODED table list instead of by pattern',
    barrier14Problems(sql.replace(/table_name\s+like\s+'%\\_residential\\_listings'/i,
      "table_name = 'aqar_residential_listings'")).length === 1);
  mustCatch('the detector no longer comparing against purged_listings_archive',
    barrier14Problems(sql.split('purged_listings_archive').join('some_other_table')).length === 1);
  mustCatch('the detector TRUSTING deletion_reason, which the deleter itself writes',
    barrier14Problems(sql.replace(/mon_detect_unledgered_hard_delete/,
      "mon_detect_unledgered_hard_delete /* */ where deletion_reason = 'x' --")).length >= 1);
  // Negative control: the REAL migration is not flagged. Without this, an over-broad repair to any
  // limb above would pass every mutation and quietly fail every real run.
  check(barrier14Problems(sql).length === 0,
    'self-test: the SHIPPED barrier-14 migration is NOT flagged (the predicate is not vacuous)');
}

// Negative controls for the deleter predicate — a guard that is red for everything is as useless as
// one that is green for everything, and this is what catches an over-broad repair to codeOnly().
check(!hits('x.sql', `-- a bypass could run \`${REAL}\` and nothing would see it`),
  'self-test: the same statement inside a comment is NOT a violation');
check(!hits('x.md', `A bypass could run \`${REAL}\`.`),
  '  …nor is documenting it in markdown');
check(engineGuaranteeProblems(engine).length === 0,
  '  …and the REAL engine source is not flagged (not vacuously red)');

console.log(failed
  ? '\n❌ verify-no-unguarded-deleter: failed.'
  : '\n✓ no-unguarded-deleter: passed.');
process.exit(failed ? 1 : 0);
