// Barrier: A PER-ROW LIVENESS EVIDENCE TABLE THAT NOTHING WRITES IS A DARK DETECTOR ARM.
//
// THE DEFECT THIS EXISTS FOR, measured on production 2026-09-12 by routine #11.
//
// On 2026-08-31 two migrations created per-row liveness audit trails and the machinery that reads
// them: `aqar_liveness_detail` (20260831003901, plus the `ops_aqar_recent_kills` view) and
// `dealapp_liveness_detail` (20260831004139). The aqar one was written in direct response to the
// owner asking why 13,139 listings disappeared on 2026-08-30 and nobody being able to say — its own
// header ends "An audit trail you only wish you had during an incident is not an audit trail."
//
// NOTHING EVER WROTE A ROW TO EITHER TABLE. Twelve days later, measured:
//
//     aqar_liveness_detail_id_seq.last_value    = NULL     -- the sequence never advanced
//     dealapp_liveness_detail_id_seq.last_value = NULL     -- i.e. not one row, ever
//     pg_stat_user_tables.n_tup_ins             = 0 for both
//
// while `scrapers/aqar/liveness.py` was deactivating ~300 aqar listings a day across 16 shards.
// Only gathern ever wrote its own ledger. Two consequences, both live for twelve days:
//
//   1. `ops_aqar_recent_kills` — the view built to answer "why was THIS row deactivated" for our
//      largest platform (90,906 active rows, ~97k probes/day) — returned the empty set, forever.
//      The question the table was created to answer was still unanswerable.
//   2. `mon_detect_served_despite_direct_404` reads these tables in FOUR of its seven arms. Four
//      arms could never raise and never resolve, because their evidence source was empty by
//      construction. That is a P1 detector reading as a clean bill of health over a surface nobody
//      was measuring — the exact class AGENTS.md opens with (nine dark detectors, 2026-08-10) and
//      the class of ops_incident #188 and #25.
//
// WHY A TEXT TRIPWIRE OVER THE DETECTOR WOULD NOT HAVE CAUGHT IT. The detector SQL was correct. The
// table DDL was correct. The view was correct. Every artefact read as right on its own; the defect
// lived in the SEAM between them — a reader with no writer. Nothing that inspects one file can see
// a missing counterpart, which is why this barrier asserts the PAIRING and not any one side.
//
// THE INVARIANT. For every per-row liveness evidence table this repository declares, some scraper
// must insert into it. A `select` does not count: reading your own empty ledger is the defect.
//
// Deliberately hermetic (AGENTS.md, "the required suite is HERMETIC"): it reads the repo only and
// reaches no network, so its verdict depends on the diff and never on production's state. The live
// half — "the table is non-empty and growing" — belongs to the detectors, which already watch it.
//
//   node --experimental-strip-types scripts/verify-liveness-evidence-tables-have-writers.ts

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

// ─── The predicate, pure over its inputs so the mutations below can execute it ──────────────────

export type Corpus = {
  /** Every committed migration's SQL text. */
  migrations: string[];
  /** Every scraper source text (the files that would do the writing). */
  scrapers: string[];
};

/** A table is an evidence ledger if it is named like one: <platform>_liveness[_pilot]_detail. */
const EVIDENCE_NAME = /\b([a-z][a-z0-9_]*_liveness(?:_[a-z0-9_]+)?_detail)\b/g;

const CREATE_EVIDENCE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z][a-z0-9_]*_liveness(?:_[a-z0-9_]+)?_detail)\b/gi;

/**
 * Evidence tables this repo declares: those CREATEd by a migration, plus those a monitoring
 * detector READS. The second half matters — `wasalt_liveness_pilot_detail` predates the migration
 * era and would be invisible to a create-only scan, and a detector arm is exactly the consumer
 * whose evidence must exist.
 */
export function declaredEvidenceTables(migrations: string[]): string[] {
  const found = new Set<string>();
  for (const sql of migrations) {
    for (const m of sql.matchAll(CREATE_EVIDENCE)) found.add(m[1].toLowerCase());
    // Any evidence table named inside a mon_detect_* function body is being read by a detector.
    if (/create\s+or\s+replace\s+function\s+public\.mon_detect_/i.test(sql)) {
      for (const m of sql.matchAll(EVIDENCE_NAME)) found.add(m[1].toLowerCase());
    }
  }
  return [...found].sort();
}

/**
 * Does any scraper INSERT into this table? Matches both idioms in the tree:
 *   client.table("x").insert(chunk)                      — aqar / gathern
 *   db._execute(db.sb().table("x").insert(rows), ...)     — wasalt
 * A `.select(` on the same table is deliberately NOT a writer.
 */
export function hasWriter(table: string, scrapers: string[]): boolean {
  const insert = new RegExp(
    `table\\(\\s*["']${table}["']\\s*\\)\\s*(?:\\.\\s*)?\\.?\\s*insert\\s*\\(`,
  );
  const looser = new RegExp(`table\\(\\s*["']${table}["']\\s*\\)[\\s\\S]{0,80}?\\.insert\\s*\\(`);
  return scrapers.some((src) => insert.test(src) || looser.test(src));
}

/** The barrier itself: every declared evidence table must have a writer. Returns the problems. */
export function evidenceTablesWithoutWriters(corpus: Corpus): string[] {
  return declaredEvidenceTables(corpus.migrations)
    .filter((t) => !hasWriter(t, corpus.scrapers))
    .map(
      (t) =>
        `${t}: declared (created by a migration and/or read by a mon_detect_* detector) but NO ` +
        `scraper inserts into it. A detector arm over an empty ledger is dark, not clean.`,
    );
}

// ─── Executable mutation proofs — run the real predicate against deliberately broken inputs ─────

let failures = 0;
function mustCatch(label: string, caught: boolean): void {
  if (!caught) {
    console.error(`  ✗ MUTATION SURVIVED: ${label}`);
    failures++;
  } else {
    console.log(`  ✓ mutation caught: ${label}`);
  }
}

const CREATE_AQAR = 'create table if not exists public.aqar_liveness_detail (id bigint);';
const DETECTOR_READS_AQAR = `
  create or replace function public.mon_detect_served_despite_direct_404()
  returns integer as $$ begin
    perform 1 from public.aqar_liveness_detail d;
  end $$ language plpgsql;`;
const REAL_WRITER = 'client.table("aqar_liveness_detail").insert(chunk).execute()';
const WASALT_WRITER =
  'db._execute(db.sb().table("wasalt_liveness_pilot_detail").insert(rows[i:i+500]), what="x")';

console.log('Mutation proofs (the predicate executed against broken corpora):');

// THE ACTUAL 2026-09-12 DEFECT: table created, detector reads it, nothing writes it.
mustCatch(
  'a created evidence table with no writer is DETECTED (the real aqar defect)',
  evidenceTablesWithoutWriters({ migrations: [CREATE_AQAR], scrapers: [] }).length === 1,
);

mustCatch(
  'a detector arm reading an evidence table nothing writes is DETECTED',
  evidenceTablesWithoutWriters({ migrations: [DETECTOR_READS_AQAR], scrapers: [] }).some((p) =>
    p.startsWith('aqar_liveness_detail:'),
  ),
);

// A reader is not a writer — the failure mode that let this sit for twelve days.
mustCatch(
  'a scraper that only SELECTs from the ledger does not count as a writer',
  evidenceTablesWithoutWriters({
    migrations: [CREATE_AQAR],
    scrapers: ['client.table("aqar_liveness_detail").select("id").execute()'],
  }).length === 1,
);

// A writer for a DIFFERENT table must not satisfy this table (the copy-paste near-miss).
mustCatch(
  'a writer for a different evidence table does not satisfy this one',
  evidenceTablesWithoutWriters({
    migrations: [CREATE_AQAR],
    scrapers: ['client.table("gathern_liveness_detail").insert(chunk).execute()'],
  }).length === 1,
);

// Positive controls: the predicate must NOT fire when the writer genuinely exists, or the barrier
// is one that can never pass and will be deleted by the next person it inconveniences.
mustCatch(
  'a real writer SATISFIES the invariant (no false red)',
  evidenceTablesWithoutWriters({ migrations: [CREATE_AQAR], scrapers: [REAL_WRITER] }).length === 0,
);

mustCatch(
  "wasalt's db.sb().table(...).insert idiom is recognised as a writer (no false red)",
  evidenceTablesWithoutWriters({
    migrations: ['create table public.wasalt_liveness_pilot_detail (id bigint);'],
    scrapers: [WASALT_WRITER],
  }).length === 0,
);

if (failures > 0) {
  console.error(`\n${failures} mutation(s) survived — this barrier does not hold.`);
  process.exit(1);
}

// ─── The real check, against this repository ────────────────────────────────────────────────────

function readAll(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...readAll(p, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

const corpus: Corpus = {
  migrations: readAll(join(root, 'supabase', 'migrations'), ['.sql']),
  scrapers: readAll(join(root, 'scrapers'), ['.py']),
};

if (corpus.migrations.length === 0 || corpus.scrapers.length === 0) {
  console.error('✗ empty corpus — refusing to pass vacuously (migrations or scrapers not found).');
  process.exit(1);
}

const tables = declaredEvidenceTables(corpus.migrations);
const problems = evidenceTablesWithoutWriters(corpus);

console.log(`\nDeclared per-row liveness evidence tables: ${tables.length}`);
for (const t of tables) {
  console.log(`  ${hasWriter(t, corpus.scrapers) ? '✓ written' : '✗ NO WRITER'}  ${t}`);
}

if (problems.length > 0) {
  console.error('\n✗ Evidence ledger(s) that nothing writes:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    '\nA detector reading an empty ledger reports a clean bill of health over a surface nobody\n' +
      'is measuring. Wire the writer in the scraper that makes the verdict (see\n' +
      'scrapers/gathern/liveness.py for the reference shape: buffer, best-effort flush, evidence\n' +
      'only, never gating a deactivation). Do NOT satisfy this by deleting the table or the\n' +
      "detector arm — that removes the measurement instead of the blind spot.",
  );
  process.exit(1);
}

console.log('\n✓ Every declared per-row liveness evidence table has a scraper that writes it.');
