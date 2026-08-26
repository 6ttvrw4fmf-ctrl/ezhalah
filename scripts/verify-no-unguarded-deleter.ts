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

check(!!barrier14, 'a migration arms trg_archive_hard_delete on the listings tables');
if (barrier14) {
  const sql = barrier14.sql;
  // The arming must be a PATTERN LOOP over the listings tables, never a hand-listed set: a new
  // platform's table would otherwise ship unaudited, and nothing would say so.
  check(/table_name\s+like\s+'%\\_residential\\_listings'/i.test(sql)
        && /table_name\s+like\s+'%\\_commercial\\_listings'/i.test(sql),
    '  …over every *_{residential,commercial}_listings table, by pattern, not a hardcoded list');
  check(/create\s+or\s+replace\s+function\s+public\.mon_detect_unledgered_hard_delete/i.test(sql),
    '  …and defines mon_detect_unledgered_hard_delete()');
  check(/cleanup_deletion_log/.test(sql) && /purged_listings_archive/.test(sql),
    '  …which compares what vanished against the engine ledger');
  // The detector must never key on deletion_reason: a bypass path can set that GUC as easily as it
  // can skip the ledger, so trusting it would let the caught actor silence its own alarm.
  const detectorBody = sql.slice(sql.indexOf('mon_detect_unledgered_hard_delete'));
  check(!/deletion_reason\s*(=|<>|!=|like|in\b)/i.test(detectorBody),
    '  …and does NOT trust deletion_reason, which the deleter itself writes');
  check(/pg_get_functiondef/i.test(sql) && /mon_run_all_detectors/i.test(sql),
    '  …and is wired into the detector roster by a guarded needle-edit');
}

// ── Self-test: the comment-stripping must not become a way through. ─────────────────────────────
// Both directions, because only one of them is obvious. If codeOnly() ever over-strips, the guard
// goes quiet on a real deleter and nothing else in the suite would notice.
const REAL = 'delete from aqar_residential_listings where id = 1;';
const hits = (path: string, body: string) =>
  CODE_PATTERNS.some((re) => re.test(codeOnly(path, body)));
check(hits('x.sql', REAL), 'self-test: a real SQL delete is still caught');
check(hits('x.sql', `-- explaining ${REAL}\n${REAL}`),
  '  …including one sitting under a comment that quotes it');
check(hits('x.py', `client.table("aqar_residential_listings").delete().execute()`),
  '  …and a client-side .delete() in python');
check(!hits('x.sql', `-- a bypass could run \`${REAL}\` and nothing would see it`),
  '  …while the same statement inside a comment is not a violation');
check(!hits('x.md', `A bypass could run \`${REAL}\`.`),
  '  …nor is documenting it in markdown');

console.log(failed
  ? '\n❌ verify-no-unguarded-deleter: failed.'
  : '\n✓ no-unguarded-deleter: passed.');
process.exit(failed ? 1 : 0);
