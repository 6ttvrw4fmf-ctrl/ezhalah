// A COMPLETE CRAWL OF A SMALL SOURCE ANSWER IS NOT A PARTIAL CRAWL — executed, not grepped.
// Senior Production Engineer audit, 2026-09-12.
//
// THE DEFECT THIS PINS
// --------------------
// scrapers/aqarmonthly/run.py finalised its run with an ABSOLUTE row floor (`floor=50` on
// db.end_run), added after three Saturdays on which discovery collapsed to ~15 ids/shard. The
// premise written into that comment was that a slice is "never legitimately [that small] while the
// vertical is alive".
//
// Measured on the fifth consecutive Saturday (2026-09-12, from the source's own GraphQL, HTTP 200,
// no auth), the premise is false in one specific way:
//
//     Search.find(daily_renting_filter:{})                  → total 3,953   (the vertical IS alive)
//     Search.find(daily_renting_filter:{availability:{eq:1}}) → total   240   (what we ask for)
//     Search.find(daily_renting_filter:{availability:{eq:0}}) → total   399
//
// ~3,300 listings carry no availability value at all, so the facet we page answered 240 and
// discovery captured 240 of 240. A COMPLETE crawl of the source's own answer was demoted to
// ok=False, reddening CI and raising a P1 `ingestion_check_failed` every Saturday — five times, for
// a fact the source published. Perfectly periodic: 2026-08-15/22/29, 09-05, 09-12.
//
// AND THE FLOOR WAS BLIND IN THE DANGEROUS DIRECTION TOO, which is the half that matters more. A
// page stream that dies after 900 of a declared 3,800 leaves each of the 16 shards ~56 ids —
// comfortably OVER 50 — so it finalised ok=True. `discover_ids` ended its loop on `if not d: break`
// and `if not batch: break`, both of which turn a FAILED FETCH into "the source had no more"
// (AGENTS.md: "A FAILED FETCH IS NOT AN EMPTY ANSWER" — a request that failed rendered as a
// confident negative). On the unsharded path that ok=True verdict is what feeds prune_unseen().
//
// THE RULE NOW ENFORCED
// ---------------------
// The verdict is a COVERAGE relation against the source's OWN declared total, never an absolute
// count: `Search.find.total` is read on every page and was previously discarded. It is the only
// thing on the wire that separates "aqar published 240" from "we lost 3,560 of them".
//
// WHY THIS BARRIER EXECUTES THE SHIPPED CODE
// ------------------------------------------
// AGENTS.md records that all five defects of 2026-09-04 had a barrier over the exact line, and every
// one of those barriers was a source-TEXT tripwire that stayed green for as long as the defect was
// live — two of them pinned the defective line as correct. So this file imports the REAL
// `coverage_verdict` and the REAL `discover_ids` out of the shipped module and RUNS them, the second
// against an injected transport that fails the way curl_cffi really fails. Every claim below is a
// return value. The `MUTATE` limb re-introduces the defect and watches the assertions go red.
//
//   node --experimental-strip-types scripts/verify-aqarmonthly-coverage-beats-row-floor.ts

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RUN_PY = join(ROOT, 'scrapers', 'aqarmonthly', 'run.py');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The harness. Stubs only the network; everything that decides anything is the shipped function.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const HARNESS = String.raw`
import json, os, sys, inspect, textwrap
sys.path.insert(0, os.getcwd())
import scrapers.aqarmonthly.run as run

verdict = run.coverage_verdict
mut = os.environ.get("MUTATE")
if mut:
    find, repl = json.loads(mut)
    src = textwrap.dedent(inspect.getsource(run.coverage_verdict))
    if find not in src:
        print(json.dumps({"error": "mutation target not found: %r" % find})); sys.exit(0)
    ns = dict(run.__dict__)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
    verdict = ns["coverage_verdict"]

def pure(captured, declared, truncated=False, capped=False):
    # A mutant that CRASHES is caught, not a dead harness: "error" is neither True nor False, so
    # every assertion naming this case fails and the mutation registers.
    try:
        return verdict(run.Discovery(list(range(captured)), declared, truncated, capped))[0]
    except Exception as e:
        return "error: %s" % type(e).__name__

# ── 1. the PURE predicate, over the shapes that actually occur ───────────────────────────────
pure_cases = {
  # today's real shape: the source declared 240 and we hold all 240.
  "complete_but_small_240_of_240":   pure(240, 240),
  # a normal weekday: ~3.7k of ~3.7k.
  "complete_full_3736_of_3736":      pure(3736, 3736),
  # THE FALSE GREEN the old floor let through: stream died mid-flight.
  "truncated_900_of_3800":           pure(900, 3800, truncated=True),
  # same shortfall WITHOUT the truncation flag — coverage alone must still reject it.
  "short_900_of_3800":               pure(900, 3800),
  # 56 ids/shard is what 900/16 looks like: over the old floor of 50, still wrong.
  "short_just_over_old_floor":       pure(56 * 16, 3800),
  # no readable first page at all: coverage is unprovable, never "complete".
  "no_first_page":                   pure(0, None, truncated=True),
  "declared_none":                   pure(120, None),
  # ES 'total' drifts by a few across a multi-page stream — that must NOT flake.
  "within_slack_3795_of_3800":       pure(3795, 3800),
  "within_slack_237_of_240":         pure(237, 240),
  # ...unless the stream DIED there. Coverage alone cannot see this one: 3,795 of 3,800 is inside
  # the slack, so only the truncation flag knows the last page never arrived.
  "truncated_inside_slack":          pure(3795, 3800, truncated=True),
  # ...but the slack must not swallow a real loss.
  "beyond_slack_3400_of_3800":       pure(3400, 3800),
  "beyond_slack_200_of_240":         pure(200, 240),
  # the ES from-cap is a source-side bound, not our truncation.
  "es_capped":                       pure(9500, 40000, capped=True),
}

# ── 2. the REAL discover_ids, driven by an injected transport ────────────────────────────────
# Mirrors curl_cffi's real shapes: _gql returns (data, errored) and (None, False) when the
# transport gave up after its retries.
def page(total, ids):
    return ({"Search": {"find": {"total": total, "listings": [{"id": i} for i in ids]}}}, False)

def drive(script):
    """script: list of (data, errored) tuples served in order to successive _gql calls."""
    seq = list(script)
    def fake_gql(q, v, tries=3):
        return seq.pop(0) if seq else (None, False)
    orig = run._gql
    run._gql = fake_gql
    try:
        d = run.discover_ids()
        ok, why = run.coverage_verdict(d)
        return {"n": len(d.ids), "declared": d.declared, "truncated": d.truncated,
                "capped": d.capped, "complete": ok, "why": why}
    finally:
        run._gql = orig

full   = [page(120, list(range(i + 1, i + 51))) for i in range(0, 100, 50)] + [page(120, list(range(101, 121)))]
died   = [page(3800, list(range(1, 51))), page(3800, list(range(51, 101))), (None, False)]
empty  = [page(3800, list(range(1, 51))), page(3800, [])]
dupes  = [page(60, list(range(1, 51))), page(60, list(range(41, 61)))]   # 10 ids repeat across pages

# ES pages without a stable tiebreaker: pass 1 shows the same 40 ids twice and hides 20 of the
# declared 60. A single pass can only ever hold 40. Re-paging must recover the rest.
# A pass over a declared 60 at size=50 is exactly two page calls (from=0, from=50); it ends on
# frm >= total, never on an empty page (an empty page early is the UNKNOWN case tested above).
jitter = [page(60, list(range(1, 41))), page(60, list(range(1, 41))),      # pass 1: same 40 twice
          page(60, list(range(21, 61))), page(60, list(range(21, 61)))]    # pass 2: the hidden 20

wired = {
  "whole_catalogue":   drive(full),
  "transport_died":    drive(died),
  "empty_page_early":  drive(empty),
  "duplicate_ids":     drive(dupes),
  "nothing_at_all":    drive([(None, False)]),
  "es_jitter_repaged": drive(jitter),
}
print(json.dumps({"pure": pure_cases, "wired": wired}))
`;

type Wired = { n: number; declared: number | null; truncated: boolean; capped: boolean; complete: boolean; why: string };
type Result = { pure?: Record<string, boolean>; wired?: Record<string, Wired>; error?: string };

const runHarness = (mutate?: [string, string]): Result => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Result;
};

console.log('aqarmonthly: source-declared coverage decides the run, not an absolute row floor\n');

const base = runHarness();
check(!base.error, 'the shipped discover_ids/coverage_verdict import and run', base.error ?? '');
if (base.error) process.exit(1);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE PURE PREDICATE. `holds` returns the assertions that PASS so a mutation can shrink it.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const MUST_BE_COMPLETE = [
  'complete_but_small_240_of_240', 'complete_full_3736_of_3736',
  'within_slack_3795_of_3800', 'within_slack_237_of_240', 'es_capped',
];
const MUST_BE_INCOMPLETE = [
  'truncated_900_of_3800', 'short_900_of_3800', 'short_just_over_old_floor',
  'no_first_page', 'declared_none', 'beyond_slack_3400_of_3800', 'beyond_slack_200_of_240',
  'truncated_inside_slack',
];

const holds = (r: Result): string[] => {
  const p = r.pure ?? {};
  const held: string[] = [];
  for (const k of MUST_BE_COMPLETE) if (p[k] === true) held.push(`complete:${k}`);
  for (const k of MUST_BE_INCOMPLETE) if (p[k] === false) held.push(`incomplete:${k}`);
  return held;
};
const TOTAL = MUST_BE_COMPLETE.length + MUST_BE_INCOMPLETE.length;

console.log('1. the predicate, executed');
for (const k of MUST_BE_COMPLETE) {
  check(base.pure?.[k] === true, `${k} is COMPLETE`,
    'a crawl that holds everything the source declared must finalise healthy however small — ' +
    'demoting it reddens CI for a fact the source published (the 5 Saturdays this fixes)');
}
for (const k of MUST_BE_INCOMPLETE) {
  check(base.pure?.[k] === false, `${k} is NOT complete`,
    'short of the source-declared total, or unprovable — this is the shape an absolute row floor ' +
    'passed as healthy, and on the unsharded path that verdict feeds prune_unseen()');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE REAL PAGING LOOP, against a transport that fails the way the real one does.
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2. discover_ids itself, against an injected transport');
const w = base.wired ?? ({} as Record<string, Wired>);

check(w.whole_catalogue?.complete === true && w.whole_catalogue?.n === 120,
  'a stream that reaches the declared total is complete',
  JSON.stringify(w.whole_catalogue));

check(w.transport_died?.complete === false && w.transport_died?.truncated === true,
  'a transport that gives up mid-stream is UNKNOWN, not a small catalogue',
  `got ${JSON.stringify(w.transport_died)} — this returned 100 ids of a declared 3,800 and, under ` +
  'the old absolute floor, every shard still cleared 50 and the run finalised ok=True');

check(w.empty_page_early?.complete === false && w.empty_page_early?.truncated === true,
  'an empty page BEFORE the declared total is a source hiccup, not the end of the catalogue',
  JSON.stringify(w.empty_page_early));

check(w.duplicate_ids?.n === 60,
  'ids repeated across ES pages are deduped, so coverage counts DISTINCT ids',
  `got n=${w.duplicate_ids?.n} (expected 60 distinct from 70 returned) — without the dedupe a ` +
  'stream that repeats a page can inflate len(ids) past a declared total it never covered');

check(w.es_jitter_repaged?.n === 60 && w.es_jitter_repaged?.complete === true,
  'ids a jittering ES hid on the first pass are recovered by re-paging',
  `got ${JSON.stringify(w.es_jitter_repaged)} — measured live on 2026-09-12, ONE pass over a ` +
  'declared 240 returned 194-199 distinct: a silent ~19% capture loss on every run, and on the ' +
  'unsharded path that short id set is what prune_unseen() is handed');

check(w.nothing_at_all?.complete === false && w.nothing_at_all?.declared === null,
  'no readable first page proves nothing',
  JSON.stringify(w.nothing_at_all));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE CALL SITE. The one claim that cannot be executed without a network: that main() actually
//    uses the verdict, and that the absolute floor did not quietly come back beside it.
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n3. the call site wiring');
const src = readFileSync(RUN_PY, 'utf8');

check(/complete,\s*why\s*=\s*coverage_verdict\(disc\)/.test(src),
  'main() computes the coverage verdict from the discovery it just ran');
check(/if not complete:/.test(src) && /rows_upserted=0/.test(src),
  'an incomplete discovery ends the run BEFORE the upsert/prune leg');
const code = src.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');  // prose about the OLD floor is not code
check(!/\bfloor\s*=\s*[1-9]/.test(code),
  'no absolute row floor survives beside the coverage verdict',
  'floor=N and coverage would disagree on exactly the shape this fixes — the source-declared ' +
  'total already decided it, and a row floor can only re-introduce the false red');
check(/source_total=/.test(src),
  "the run's notes record the source-declared total",
  'without it a reader cannot tell a small honest catalogue from a lost one after the fact');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. MUTATION PROOF (§G.9.4). Re-introduce the defect; the assertions above must go red.
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n4. mutation proof — the defect re-introduced, the barrier watched');
const baseHeld = holds(base);
check(baseHeld.length === TOTAL, `all ${TOTAL} predicate assertions hold on the shipped code`,
  `${baseHeld.length}/${TOTAL}`);

const MUTANTS: Array<[string, [string, string], string]> = [
  ['absolute row floor instead of coverage (the exact defect removed)',
   ['    if d.truncated:', '    return len(d.ids) >= 50, "row floor"\n    if d.truncated:'],
   'short_just_over_old_floor'],
  ['a failed page stream treated as the end of the catalogue',
   ['    if d.truncated:', '    if False:'],
   'truncated_inside_slack'],
  ['slack widened until a real loss fits inside it',
   ['int(d.declared * COVERAGE_SLACK_PCT)', 'int(d.declared * 0.99)'],
   'beyond_slack_3400_of_3800'],
  ['an unprovable coverage read allowed through',
   ['    if d.declared is None:', '    if False:'],
   'declared_none'],
];

/** The repo's proof convention (verify-new-barriers-are-mutation-proven.ts): `caught` is COMPUTED
 *  from running the mutant, never a literal — a proof that cannot fail is not a proof. */
const mustCatch = (label: string, caught: boolean, detail = '') =>
  check(caught, `mutant "${label}" is caught`, detail);

for (const [label, mutation, mustBreak] of MUTANTS) {
  const m = runHarness(mutation);
  // A mutant that could not be applied proves nothing, so it keeps every assertion and fails here
  // exactly like one that was applied and went unnoticed — no separate literal-argument branch.
  const broke = baseHeld.filter((h) => !(m.error ? baseHeld : holds(m)).includes(h));
  mustCatch(label, broke.some((b) => b.endsWith(mustBreak)),
    m.error ?? `expected the assertion on ${mustBreak} to fail; assertions lost: ` +
    `${broke.join(', ') || 'NONE'} — a barrier that stays green through its own defect is decoration`);
}

console.log(
  failed === 0
    ? '\n✓ aqarmonthly-coverage-beats-row-floor: coverage against source truth decides the run; ' +
      'a complete-but-small crawl passes, a truncated one cannot.'
    : `\n✗ aqarmonthly-coverage-beats-row-floor: ${failed} check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
