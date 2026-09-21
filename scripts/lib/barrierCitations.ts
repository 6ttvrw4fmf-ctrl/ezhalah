// A BARRIER CITATION IS A CLAIM. THE CLAIM MUST NAME SOMETHING THAT EXISTS.
//
// WHY THIS EXISTS (routine #10, ops_incident #209, measured 2026-09-13).
//
// `ops_incident` is the spine that makes a finding durable: `state = 'resolved'` is unreachable
// without naming a permanent regression barrier AND stamping a production verification, and a CHECK
// constraint enforces it (docs/ops/AUTONOMOUS_INCIDENT_LOOP.md, and the barrier over that constraint
// is scripts/verify-incident-spine.ts). That gate is the reason "every bug gets a barrier" no longer
// depends on anyone remembering.
//
// But the gate checks that a STRING IS PRESENT. It cannot check that the string names a real file,
// because Postgres cannot see the repository. So the one thing the gate is for — that a closed
// finding leaves permanent cover behind — is exactly the thing nothing verified. A citation naming
// a barrier that was never written satisfies the constraint perfectly.
//
// This is BARRIER_ENGINEER.md PART 1.11 in its purest form: *a pointer reads as coverage*. A reader
// who sees a named guard beside a closed incident stops asking whether the class is protected. It is
// also the shape AGENTS.md warns about in the ENGINEER_ROUTINES.md §R.2 worked example — a phantom
// created by the same change that created the real barrier, by a writer who had both names in mind.
//
// MEASURED, 2026-09-13, over every incident in a state that CLAIMS a barrier exists: FOUR citations
// name a file that appears in NO commit on ANY branch (`git log --all -S` returns nothing for each):
//
//   #37  fixed      routine-3-data-integrity  scripts/verify-search-sync-pass-is-evidenced.ts
//                   — cited as "hermetic, in npm test, 10 checks + 10 in-file mutation proofs"
//   #55  fixed      routine-3-data-integrity  scripts/verify-search-index-single-writer.ts
//                   — cited as "in npm test … 11 executable mutation proofs incl. negative controls"
//   #74  verifying  routine-7-seam            scripts/verify-gh-dispatch-fails-loud.ts
//                   — cited as "(in npm test run list; 373 checks)"
//   #177 verifying  routine-11-lifecycle      scrapers/common/tests/test_jurash_sold_pin_evidence.py
//                   — cited as "4 tests, mutation-proven (evidence write removed -> 3/4 go red)"
//
// Note what each citation asserts: not merely a name, but a count of checks and of mutation proofs.
// These are the most convincing sentences in the queue and the only four that describe nothing.
//
// WHAT THIS PREDICATE JUDGES, AND WHAT IT DELIBERATELY DOES NOT.
//
//   • Only rows in a CLAIMED state — 'fixed', 'verifying', 'resolved'. An 'open' or 'investigating'
//     row's citation is a PLAN, not a claim of cover, and failing it would be crying wolf at the
//     normal way an incident is worked. This is the distinguish-the-cases rule (BARRIER_ENGINEER.md
//     PART 6, Prohibition 1): the check must separate the defect from health, not flag everything.
//   • BOTH citation fields, concatenated — `barrier_script` AND `detail->>'barrier'`. Coalescing
//     them would let a phantom hide in whichever field lost the coalesce; rows carry both.
//   • Three artefact shapes, because citations are free prose and all three occur in production:
//     a QUALIFIED path (scripts/verify-x.ts), a BARE filename (incident #179 lists twelve barriers
//     by bare name — all twelve real, and invisible to a path-only reader), and a DATABASE function
//     (mon_detect_*), a perfectly good permanent barrier, checked against the COMMITTED migrations.
//
// FAILS CLOSED, AND SPECIFICALLY AGAINST THE FRIENDLY-LOOKING FAILURE. `ops_incident` is
// RLS-protected: an anon read returns HTTP 200 with `[]`. Read naively that says "no incident cites
// a phantom barrier" — a confident clean bill of health manufactured out of a permissions failure,
// which is AGENTS.md's **A FAILED FETCH IS NOT AN EMPTY ANSWER** committed by the verification layer
// itself (BARRIER_ENGINEER.md PART 1.5 says that rule binds a barrier's own reads exactly as it
// binds the product's). So `rows === null` and `rows === []` are each a FAILURE, never a pass, and
// an existence test that cannot answer returns `null` and is reported as UNKNOWN rather than as
// absent or as present.
//
// Everything is injected — the rows, the existence test — so the rule can be fed a broken world and
// watched to fail. scripts/verify-incident-citations-name-real-barriers.ts does exactly that.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** An artefact a citation names, in one of the four shapes production actually uses. */
export type Artifact =
  | { kind: 'path'; name: string }   // repo-relative, e.g. scripts/verify-x.ts
  | { kind: 'bare'; name: string }   // filename only, e.g. verify-x.ts  (incident #179's shape)
  | { kind: 'fn'; name: string }     // a database function, e.g. mon_detect_x
  | { kind: 'symbol'; name: string };// any other snake_case name a citation asserts exists

/** The incident states that CLAIM permanent cover already exists. A plan is not a claim. */
export const CLAIMED_STATES = ['fixed', 'verifying', 'resolved'] as const;

export type IncidentRow = {
  id: number;
  state: string;
  owner_routine: string;
  /** barrier_script and detail->>'barrier' concatenated; null when the row cites nothing. */
  citation: string | null;
};

/**
 * `null` from an existence test means THE QUESTION COULD NOT BE ANSWERED — an unreadable tree, an
 * unreadable catalog. It is reported as a problem, never silently resolved to true or to false.
 */
export type ExistenceTest = (a: Artifact) => boolean | null;

// `tsx` BEFORE `ts`, AND a non-alphanumeric lookahead (repaired 2026-09-20, routine #10).
// JS alternation is ordered: with `ts` first, `src/app/agent.tsx` matched `…agent.ts` and STOPPED,
// so the extractor invented a file that has never existed and reported incident #260 — whose
// citation is correct and names `src/app/agent.tsx` — as a phantom. That false red kept
// incident-citation-guard.yml failing and a P1 `barrier_check_failed` alert open from 2026-09-14 to
// 2026-09-20, unacknowledged. A guard that cries wolf is not a stricter guard; it is a guard people
// learn to scroll past, and the obvious way to make it green is to delete it. The lookahead makes
// the ordering belt-and-braces rather than load-bearing.
const QUALIFIED =
  /(?:scripts|e2e|scrapers|supabase|sql|src)\/[A-Za-z0-9_./-]+\.(?:tsx|ts|mjs|cjs|py|sql)(?![A-Za-z0-9])/g;
const BARE = /\b(?:verify-[A-Za-z0-9_.-]+?\.(?:ts|mjs)|test_[A-Za-z0-9_]+\.py)\b/g;
// A GLOB IS NOT A CITATION OF ONE OBJECT (same repair, same day). `\b(mon_[a-z0-9_]+)\b` read the
// prose `mon_detect_*` — "the detectors continue watching this class" — as a claim that a function
// literally named `mon_detect_` exists, and reported incident #335 as a phantom. It is not a claim
// about one function at all. A token that ends in `_`, or that is immediately followed by `*`, is a
// prefix; the guard must not manufacture a name out of it. A fully spelled `mon_detect_x` is
// unaffected, which is the direction that has to keep working and is proven below.
const DBFN = /\bmon_[a-z0-9_]*/g;
// THE FOURTH SHAPE (closed 2026-09-21, routine #10, ops_incident #364).
//
// `DBFN` recognises `mon_*` and nothing else, so a barrier cited as ANY OTHER database object
// yielded no artefact at all and was therefore neither verified nor flagged. Three real citations
// sat in that hole: #324 cites `enforce_price_size_sanity() + ops_price_source_verified`, #134
// cites `tg_archive_hard_deleted_listing` propagating to `listings_arabic_locations`, and #233
// cites the pytest function `test_retire_superseded_siblings`. A trigger, a view, a constraint
// function and a test function are all perfectly good permanent barriers; naming one bought a
// closed incident the appearance of cover with nothing behind it.
//
// The rejected repair, recorded on the incident, was "any identifier followed by ()" — that flags
// `citedArtifacts()` and every other camelCase symbol written with parens, manufacturing phantoms
// out of prose, which is exactly the defect repaired here the day before. The shape that
// DISTINGUISHES is snake_case: at least one underscore between two lowercase alphanumeric runs.
// English prose has no underscores, camelCase has no underscores, and every database object, column,
// alert kind and pytest function in these citations does.
//
// MEASURED BEFORE IT WAS WRITTEN, over the 193 claimed-state citations live in production on
// 2026-09-21: 85 distinct tokens, and ALL 85 resolve against the checkout. That is the negative
// control on real data — this widening is green on the queue as it stands and can only go red on a
// name that appears nowhere, which is the defect class of 2026-09-13.
const SYMBOL = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/**
 * Extracts every artefact a free-text citation names, de-duplicated and in a stable order.
 *
 * Qualified paths are consumed FIRST and removed from the text, then bare filenames, before the
 * function and symbol scans run — so `scripts/verify-x.ts` yields one artefact rather than also
 * yielding the bare `verify-x.ts`, `test_x.py` does not additionally yield the symbol `test_x`, and
 * a path segment can never be mistaken for a database object.
 */
export function citedArtifacts(citation: string): Artifact[] {
  const out: Artifact[] = [];
  const seen = new Set<string>();
  const push = (kind: Artifact['kind'], name: string) => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, name } as Artifact);
  };

  let rest = citation;
  for (const m of citation.match(QUALIFIED) ?? []) {
    push('path', m);
    rest = rest.split(m).join(' ');
  }
  for (const m of rest.match(BARE) ?? []) {
    push('bare', m);
    rest = rest.split(m).join(' ');
  }
  for (const m of rest.matchAll(DBFN)) {
    const name = m[0];
    // `mon_detect_*` / `mon_detect_` are PREFIXES, not names. See the DBFN header: reading one as a
    // function is how a correct incident was reported as citing something that does not exist.
    if (name.endsWith('_') || rest[m.index + name.length] === '*') continue;
    push('fn', name);
  }
  for (const m of rest.matchAll(SYMBOL)) {
    // `mon_*` is DBFN's lane and is held to the STRONGER test (a committed CREATE FUNCTION). Taking
    // it here too would re-admit the `mon_detect_*` glob that DBFN deliberately refuses.
    if (m[0].startsWith('mon_')) continue;
    push('symbol', m[0]);
  }
  return out;
}

/**
 * Returns every reason the citations are NOT trustworthy. Empty means every claimed-state incident
 * cites artefacts that all provably exist.
 *
 * @param rows    the incident rows, or `null` when the table COULD NOT BE READ
 * @param exists  does this artefact exist? `null` when the question could not be answered
 */
export function citationProblems(rows: IncidentRow[] | null, exists: ExistenceTest): string[] {
  if (rows === null) {
    return ['ops_incident could not be READ — that is UNKNOWN, never "no phantom citations found". '
      + 'An anon read of this RLS-protected table returns 200 with [], which is indistinguishable '
      + 'from a clean queue (AGENTS.md: A FAILED FETCH IS NOT AN EMPTY ANSWER).'];
  }
  if (rows.length === 0) {
    return ['ops_incident returned ZERO rows. The table provably holds closed incidents, so an empty '
      + 'read is an RLS/permissions failure wearing the costume of a clean result — refused rather '
      + 'than reported as "every citation checks out".'];
  }

  const problems: string[] = [];
  const claimed = new Set<string>(CLAIMED_STATES);

  for (const row of rows) {
    if (!claimed.has(row.state)) continue;          // a plan is not a claim of cover
    if (!row.citation || !row.citation.trim()) continue;

    for (const a of citedArtifacts(row.citation)) {
      const verdict = exists(a);
      if (verdict === true) continue;
      const what = a.kind === 'fn' ? 'database function'
        : a.kind === 'symbol' ? 'name' : 'file';
      problems.push(
        verdict === null
          ? `incident #${row.id} (${row.state}, ${row.owner_routine}) cites the ${what} `
            + `"${a.name}" and its existence COULD NOT BE DETERMINED — UNKNOWN, not accepted`
          : `incident #${row.id} (${row.state}, ${row.owner_routine}) cites the ${what} `
            + `"${a.name}", which DOES NOT EXIST — the incident reads as covered and is not`,
      );
    }
  }
  return problems;
}

/** Every barrier-shaped filename in the checkout, indexed by BARE name, for incident #179's shape. */
export function bareIndex(repoRoot: string): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else names.add(e.name);
    }
  };
  for (const d of ['scripts', 'scrapers', 'e2e']) walk(join(repoRoot, d), 0);
  return names;
}

/**
 * Every database function the COMMITTED migrations define, or null when they could not be read.
 *
 * Deliberately the repo and not pg_proc. A citation naming `mon_detect_x` claims a permanent barrier
 * exists, and AGENTS.md's mirror rule makes the repository the canonical record of every object live
 * in production — so a detector absent from every committed migration either does not exist or is
 * undeclared drift, and both are real problems (the second has its own 15-minute guard). Judging it
 * from the checkout also means this check needs the network for ROWS only: existence, in all three
 * artefact shapes, is a question about the tree. scripts/verify-committed-sql-defines-what-it-calls.ts
 * is the existing precedent for reading object definitions out of committed SQL.
 */
export function committedFunctions(repoRoot: string): Set<string> | null {
  const dir = join(repoRoot, 'supabase', 'migrations');
  if (!existsSync(dir)) return null;                 // UNKNOWN, never an empty catalog
  const defined = new Set<string>();
  const DEF = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const body = readFileSync(join(dir, f), 'utf8');
    for (const m of body.matchAll(DEF)) defined.add(m[1].toLowerCase());
  }
  return defined.size === 0 ? null : defined;        // a zero-row catalog is unreadable, not empty
}

/**
 * Does this snake_case name appear ANYWHERE in the committed checkout — in a tracked file's
 * contents, or inside a tracked path? Returns `null` when the question could not be ANSWERED.
 *
 * DELIBERATELY WEAKER THAN THE `fn` TEST, AND SAID OUT LOUD RATHER THAN IMPLIED. A `mon_*` citation
 * is held to a committed `CREATE FUNCTION`; a bare snake_case token cannot be, because the same
 * shape covers a trigger, a view, a table, a column, an alert kind, a pytest function and a Python
 * helper, and the reader has no way to know which was meant. Pretending to know would invent
 * phantoms out of correct citations — the failure this guard spent six days in on 2026-09-14.
 *
 * What it DOES check is the claim that actually failed: the four phantoms measured on 2026-09-13
 * appeared in NO commit on ANY branch. A name nothing in the repository mentions is not a barrier,
 * whatever kind of object it was supposed to be. Going from "not read at all" to "must exist
 * somewhere" strictly adds cover and weakens nothing (BARRIER_ENGINEER.md PART 6, Prohibition 1).
 *
 * Markdown is excluded from the content search on purpose: a name that appears only in a doc is a
 * POINTER, and a pointer reading as coverage is PART 1.11, the defect this whole module is about.
 */
export function treeMentionTest(repoRoot: string): (name: string) => boolean | null {
  // Production-only objects are REAL but absent from committed SQL by construction (incident #26).
  // Judging them missing would report the pre-baseline blind spot as a phantom citation.
  const productionOnly = new Set<string>();
  const baseline = join(repoRoot, 'scripts', 'production-only-object-baseline.txt');
  if (existsSync(baseline)) {
    for (const line of readFileSync(baseline, 'utf8').split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) productionOnly.add(t.toLowerCase());
    }
  }

  const ls = spawnSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64e6 });
  const trackedPaths = ls.error || ls.status !== 0 ? null : ls.stdout;

  const cache = new Map<string, boolean | null>();
  return (name: string): boolean | null => {
    if (cache.has(name)) return cache.get(name)!;
    let verdict: boolean | null;
    if (productionOnly.has(name)) verdict = true;
    else if (trackedPaths === null) verdict = null;          // cannot list the tree ⇒ UNKNOWN
    else if (trackedPaths.includes(name)) verdict = true;    // the name is part of a tracked path
    else {
      const r = spawnSync('git', ['grep', '-l', '-I', '-F', '-e', name, '--', ':!*.md'],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64e6 });
      // git grep: 0 = found, 1 = no match, anything else (or a spawn error) = the question FAILED.
      if (r.error || (r.status !== 0 && r.status !== 1)) verdict = null;
      else verdict = r.status === 0;
    }
    cache.set(name, verdict);
    return verdict;
  };
}
