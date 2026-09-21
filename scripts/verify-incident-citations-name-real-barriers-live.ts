// AN INCIDENT'S BARRIER CITATION MUST NAME SOMETHING THAT EXISTS — LIVE HALF.
//
// The rule and the four phantom citations it was written for are documented once, in
// scripts/lib/barrierCitations.ts. In one line: `ops_incident` refuses to close a finding without
// naming a permanent barrier — a CHECK constraint enforces it — and nothing ever checked that the
// named barrier was written, because Postgres cannot see the repository. Four incidents in a state
// that CLAIMS cover cite files appearing in no commit on any branch, each with a confident count of
// checks and mutation proofs beside it.
//
// THIS HALF IS THE ONLY PLACE THE TWO SIDES MEET. The citations live in production; the artefacts
// live in the checkout. Neither side can answer alone — which is precisely why the question went
// unasked for as long as the table has existed.
//
// WHY IT IS NOT IN `npm test`. Its verdict is decided by PRODUCTION's incident table, which moves
// whenever any of the eleven routines writes a row, so inside the required per-PR suite it would
// fail unrelated pull requests on someone else's incident — the placement defect AGENTS.md records
// for four checks on 2026-09-06 ("The required suite is HERMETIC"). The hermetic half
// (scripts/verify-incident-citations-name-real-barriers.ts) keeps the predicate and its mutation
// proofs per-PR, and asserts by EXECUTION that the workflow named in scripts/test-exclusions.txt
// really invokes this file — so the split cannot decay into a deletion.
//
// THE SCHEDULE IS THE LOAD-BEARING TRIGGER, for the same reason p0-fast-lane-coverage.yml and the
// migration drift guard schedule theirs: a phantom citation is introduced by an UPDATE in the
// database, long after any pull request is gone. A push-triggered check alone would never see it.
//
// FAILS CLOSED, AND SPECIFICALLY AGAINST THE FRIENDLY-LOOKING FAILURE. `ops_incident` is
// RLS-protected: an ANON read returns HTTP 200 with `[]`. Read naively that says "no incident cites
// a phantom barrier" — a clean bill of health manufactured out of a permissions failure. Rows are
// handed to citationProblems() as `null` on any non-2xx, and a zero-row read is refused outright.
// Run it with SUPABASE_SERVICE_ROLE_KEY.
//
//   SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types \
//     scripts/verify-incident-citations-name-real-barriers-live.ts
//
// SCOPE, stated rather than hidden: existence is judged against THIS CHECKOUT. A barrier that exists
// only on an unmerged branch reads as missing — which is the correct verdict for a citation on a
// closed incident, since an unmerged barrier guards nothing. The workflow checks out `main`.
//
// MUTATION-PROOF-EXEMPT: this file has no logic of its own to mutate — it fetches, hands the answer
// to citationProblems() and prints. That predicate lives in scripts/lib/barrierCitations.ts and its
// hermetic sibling proves it by mutation in every limb, including the two that decide this check's
// honesty: a non-2xx and an RLS-emptied 200 must each read as UNKNOWN rather than as a queue with no
// phantom citations. A proof duplicated here would exercise nothing this file itself decides. (The
// count of proofs is deliberately not quoted: a number in prose goes stale and then reads as
// coverage — BARRIER_ENGINEER.md PART 1.11. Run the hermetic half to see the current set.)

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import {
  citationProblems, bareIndex, committedFunctions, treeMentionTest,
  type Artifact, type IncidentRow,
} from './lib/barrierCitations.ts';

const ROOT = join(import.meta.dirname, '..');
const { url: URL_BASE } = resolvePublicSupabase();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Returns the incident rows, or null when the table could not be READ. Never `[]` on error. */
async function readIncidents(): Promise<IncidentRow[] | null> {
  if (!SERVICE_ROLE_KEY) {
    console.error('  ops_incident read needs SUPABASE_SERVICE_ROLE_KEY (the table is RLS-protected '
      + 'and an anon read returns 200 with [] — which this check must never mistake for a queue '
      + 'whose every citation checks out)');
    return null;
  }
  const select = 'id,state,owner_routine,barrier_script,detail';
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}/rest/v1/ops_incident?select=${select}&limit=10000`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  } catch (e) {
    console.error(`  ops_incident unreachable: ${(e as Error).message}`);
    return null;
  }
  if (!res.ok) {
    console.error(`  ops_incident read failed: HTTP ${res.status}`);
    return null;
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (e) {
    console.error(`  ops_incident response was not JSON: ${(e as Error).message}`);
    return null;
  }
  if (!Array.isArray(raw)) {
    console.error('  ops_incident response was not an array — UNKNOWN, not empty');
    return null;
  }
  return (raw as Record<string, unknown>[]).map((r) => {
    const detail = r.detail as Record<string, unknown> | null;
    const fromDetail = detail && typeof detail.barrier === 'string' ? detail.barrier : null;
    const script = typeof r.barrier_script === 'string' ? r.barrier_script : null;
    // BOTH fields, concatenated. Coalescing would let a phantom hide in whichever field lost.
    const citation = [script, fromDetail].filter(Boolean).join(' || ') || null;
    return {
      id: Number(r.id),
      state: String(r.state),
      owner_routine: String(r.owner_routine ?? 'unknown'),
      citation,
    };
  });
}

console.log('\nEvery closed incident cites a barrier that exists (live half)\n');

const rows = await readIncidents();
const bare = bareIndex(ROOT);
const fns = committedFunctions(ROOT);
const mentioned = treeMentionTest(ROOT);

const exists = (a: Artifact): boolean | null => {
  if (a.kind === 'path') return existsSync(join(ROOT, a.name));
  if (a.kind === 'bare') return bare.has(a.name);
  // A non-`mon_` snake_case name (a trigger, a view, a constraint function, a pytest function).
  // Held to "mentioned somewhere in the checkout", never to a CREATE FUNCTION it may not be.
  if (a.kind === 'symbol') return mentioned(a.name);
  return fns === null ? null : fns.has(a.name);   // UNKNOWN, never silently true or false
};

const problems = citationProblems(rows, exists);

if (problems.length === 0) {
  const claimed = (rows ?? []).filter((r) => ['fixed', 'verifying', 'resolved'].includes(r.state));
  console.log(`PASS  every citation on ${claimed.length} claimed-state incidents names a real artefact `
    + `(${rows?.length ?? 0} incidents read)\n`);
  process.exit(0);
}

console.error(`FAIL  ${problems.length} citation(s) name something that does not exist:\n`);
for (const p of problems) console.error(`  • ${p}`);
console.error('\nA citation is a claim. An incident that reads as covered and is not is worse than an '
  + 'open one, because nobody will look at it again.\n');
process.exit(1);
