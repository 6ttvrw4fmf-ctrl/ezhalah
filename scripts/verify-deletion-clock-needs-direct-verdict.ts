// THE DELETION CLOCK NEEDS A DIRECT SOURCE VERDICT (owner decision 2, 2026-11-03 — "Yes, use your
// picks": "an ad becomes eligible for the deletion clock only after at least one DIRECT source
// verdict (last_verified_alive_at or a GONE probe), not crawl absence alone").
//
// Earned by the open P1 deletion_clock_without_evidence: on 2026-11-03 the retention engine's
// candidate predicate was `active=false AND missing_count>=3 AND last_seen_at < now()-30d` — three
// crawl-ABSENCE signals — so gathern had 210 of 13,522 deletion-eligible rows, wasalt residential 117,
// aqar residential 36 and wasalt commercial 14 with no source verdict at all. Only the delete-time
// re-probe stood between them and a permanent delete.
//
// The fix puts the predicate in ONE SQL function, deletion_clock_eligible_sql(), and makes every
// caller use it: cleanup.py (through deletion_clock_candidates / deletion_clock_eligible_count),
// ops_lifecycle_deletion_backlog, ops_lifecycle_backlog_evidence_class, and the detector, which
// re-checks the verdict with its OWN clause so it fires again if the predicate ever loses it.
//
// Two halves, both hermetic:
//   1. EXECUTED — the real cleanup.run() against the real test fake (scrapers/common/tests/
//      test_cleanup.py): an absence-only row is never a candidate even when the source would say 404,
//      a GONE probe or a last_verified_alive_at makes a row eligible, and no candidate is ever read
//      from the listing table directly. Then two mutations of cleanup.py that restore the old
//      PostgREST absence-only queries, which must turn those tests RED.
//   2. The committed SQL — the LATEST migration defining each function must carry the clause /
//      call the shared predicate. Proven against mutated text in both directions.
//   The live half is the detector itself: mon_detect_deletion_clock_without_evidence runs twice an
//   hour in production against the engine's real set.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly, replayFunction } from './lib/rpcReplay.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLEANUP = join(ROOT, 'scrapers', 'common', 'cleanup.py');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const problems: string[] = [];

// ── 1. EXECUTED: the engine ─────────────────────────────────────────────────────────────────────
const DRIVER = `
import json, sys, types, importlib
sys.path.insert(0, sys.argv[1])
mutated = sys.stdin.read() or None
import scrapers.common.tests.test_cleanup as T
if mutated:
    real = importlib.import_module('scrapers.common.cleanup')
    mod = types.ModuleType('mutant')
    mod.__dict__.update({k: v for k, v in real.__dict__.items() if not k.startswith('__')})
    mod.__dict__['__file__'] = real.__file__
    mod.__dict__['__name__'] = 'mutant'
    exec(compile(mutated, 'mutant.py', 'exec'), mod.__dict__)
    T.C = mod
out = {}
for name in json.loads(sys.argv[2]):
    try:
        getattr(T, name)()
        out[name] = 'GREEN'
    except AssertionError as e:
        out[name] = 'RED: ' + str(e)[:160]
    except Exception as e:
        out[name] = type(e).__name__ + ': ' + str(e)[:160]
print(json.dumps(out))
`;

const TESTS = [
  'test_absence_alone_never_starts_the_deletion_clock',
  'test_a_gone_probe_is_a_direct_verdict_that_starts_the_clock',
  'test_candidates_come_only_from_the_shared_predicate',
];

function run(mutatedSource?: string): Record<string, string> {
  const raw = execFileSync('python3', ['-c', DRIVER, ROOT, JSON.stringify(TESTS)], {
    input: mutatedSource ?? '', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = raw.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

const src = readFileSync(CLEANUP, 'utf8');
const mutate = (from: string, to: string): string | null => {
  if (!src.includes(from)) {
    problems.push(`mutation target vanished from cleanup.py: ${from.slice(0, 80)}…`);
    return null;
  }
  return src.replace(from, to);
};

const real = run();
for (const t of TESTS) {
  if (real[t] !== 'GREEN') problems.push(`EXECUTED cleanup.run(): ${t} → ${real[t]}`);
}

// Mutation A — the work-set goes back to the old absence-only PostgREST query.
{
  const m = mutate(
    '                    rows = _eligible_rows(client, t, pol, cutoff, pol["max_delete_per_run"])',
    '                    rows = (client.table(t).select("id, ad_number, listing_url, missing_count, last_seen_at")\n' +
    '                            .eq("active", False).gte("missing_count", pol["min_missing_count"])\n' +
    '                            .lt("last_seen_at", cutoff).order("last_seen_at")\n' +
    '                            .limit(pol["max_delete_per_run"]).execute().data or [])');
  if (m) {
    const r = run(m);
    if (!r[TESTS[0]].startsWith('RED') && !r[TESTS[0]].includes('Error')) {
      problems.push('MUTATION NOT CAUGHT: the work-set reverted to the absence-only table query');
    }
    if (r[TESTS[2]] === 'GREEN') {
      problems.push('MUTATION NOT CAUGHT: candidates read from the listing table went unnoticed');
    }
  }
}

// Mutation B — the measured population goes back to the absence-only table count.
{
  const m = mutate(
    '                eligible_total += _eligible_count(client, t, pol, cutoff)',
    '                eligible_total += _count_of(\n' +
    '                    client.table(t).select("id", count="exact")\n' +
    '                    .eq("active", False).gte("missing_count", pol["min_missing_count"])\n' +
    '                    .lt("last_seen_at", cutoff).limit(1).execute())');
  if (m) {
    const r = run(m);
    if (r[TESTS[0]] === 'GREEN') {
      problems.push('MUTATION NOT CAUGHT: the eligible count reverted to the absence-only table count');
    }
  }
}

// No listing-table candidate query may come back anywhere in the engine.
if (/\.gte\("missing_count", pol\["min_missing_count"\]\)/.test(src)) {
  problems.push('cleanup.py builds a candidate filter on missing_count with PostgREST again — that ' +
    'query cannot express the direct-verdict clause; use _eligible_rows/_eligible_count');
}

// ── 2. The committed SQL ────────────────────────────────────────────────────────────────────────
type Defs = Map<string, string>;
// The effective body of each function after replaying every committed migration, via the repo's
// one tag-generic reader (scripts/lib/rpcReplay.ts). Comments are stripped so prose cannot satisfy
// a code assertion; a migration that touches a function in a way the reader cannot interpret FAILS.
function latestDefinitions(names: string[]): Defs {
  const out: Defs = new Map();
  for (const n of names) {
    const r = replayFunction(MIGRATIONS, n);
    if (r.unresolved.length) problems.push(`${n}: uninterpretable change in ${r.unresolved.join(', ')}`);
    if (r.body) out.set(n, codeOnly(r.body));
  }
  return out;
}

const VERDICT_CLAUSE = [
  /t\.last_verified_alive_at is not null/,
  /ops_stale_inactivation_probe/,
  /verdict = 'GONE'/,
  /probed_at >= t\.deactivated_at - interval '1 hour'/,
];
const CALLERS = [
  'deletion_clock_eligible_count',
  'deletion_clock_candidates',
  'ops_lifecycle_deletion_backlog',
  'ops_lifecycle_backlog_evidence_class',
  'mon_detect_deletion_clock_without_evidence',
];

function sqlProblems(defs: Defs): string[] {
  const p: string[] = [];
  const pred = defs.get('deletion_clock_eligible_sql');
  if (!pred) {
    p.push('no committed migration defines public.deletion_clock_eligible_sql');
  } else {
    // The clause must be inside an AND ( ... OR ... ) on the eligibility WHERE, never optional.
    for (const re of VERDICT_CLAUSE) {
      if (!re.test(pred)) p.push(`deletion_clock_eligible_sql lost part of the direct-verdict clause: ${re}`);
    }
    if (!/and\s*\(\s*t\.last_verified_alive_at is not null\s*\n?\s*or exists/.test(pred)) {
      p.push('deletion_clock_eligible_sql: the verdict clause is not an AND-ed precondition');
    }
  }
  for (const c of CALLERS) {
    const body = defs.get(c);
    if (!body) { p.push(`no committed migration defines public.${c}`); continue; }
    if (!body.includes('deletion_clock_eligible_sql(')) {
      p.push(`${c} no longer reads the deletion clock through deletion_clock_eligible_sql`);
    }
  }
  const det = defs.get('mon_detect_deletion_clock_without_evidence') ?? '';
  // The detector's verdict check is deliberately its OWN copy — a shared one would make it a tautology.
  if (!/t\.last_verified_alive_at is null/.test(det) || !/verdict = 'GONE'/.test(det)) {
    p.push('mon_detect_deletion_clock_without_evidence lost its own independent verdict re-check');
  }
  return p;
}

const defs = latestDefinitions(['deletion_clock_eligible_sql', ...CALLERS]);
problems.push(...sqlProblems(defs));

// Mutation proofs for the SQL half.
{
  const pred = defs.get('deletion_clock_eligible_sql');
  if (pred) {
    const stripped = new Map(defs);
    stripped.set('deletion_clock_eligible_sql',
      pred.replace(/and\s*\(\s*t\.last_verified_alive_at is not null[\s\S]*?interval '1 hour'\)\s*\)/, ''));
    if (sqlProblems(stripped).length === 0) problems.push('SQL MUTATION NOT CAUGHT: verdict clause removed');
    const orTrue = new Map(defs);
    orTrue.set('deletion_clock_eligible_sql',
      pred.replace(/and\s*\(\s*t\.last_verified_alive_at is not null/, 'or ( t.last_verified_alive_at is not null'));
    if (sqlProblems(orTrue).length === 0) problems.push('SQL MUTATION NOT CAUGHT: verdict clause made optional');
  }
  const bl = defs.get('ops_lifecycle_deletion_backlog');
  if (bl) {
    const m = new Map(defs);
    m.set('ops_lifecycle_deletion_backlog', bl.replaceAll('deletion_clock_eligible_sql(', 'own_predicate('));
    if (sqlProblems(m).length === 0) problems.push('SQL MUTATION NOT CAUGHT: a caller bypasses the shared predicate');
  }
}

if (problems.length) {
  console.error('RED  verify-deletion-clock-needs-direct-verdict\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('PASS verify-deletion-clock-needs-direct-verdict — EXECUTED cleanup.run(): crawl absence ' +
  'alone never starts the deletion clock, a direct verdict does, and candidates come only from ' +
  'deletion_clock_eligible_sql; 2 engine + 3 SQL mutations caught (owner decision 2, 2026-11-03).');
