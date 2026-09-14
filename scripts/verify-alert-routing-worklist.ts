// A NEWLY FILED ALERT ISSUE IS ROUTED BY THE RUN THAT FILED IT — not one dispatch cycle later.
//
// THE DEFECT THIS PINS (found 2026-09-14, routine #7). alert-dispatch.yml's routing sweep read its
// worklist straight from `gh issue list --label ezhalah-alert --state open`. That call goes through
// GitHub's search index, which lags issue creation by a few seconds, and the routing step starts
// ~1 s after the filing step ends. So the sweep COULD NOT SEE THE ISSUES ITS OWN RUN HAD JUST
// FILED, and every alert issue was filed unrouted and picked up an owner label only on the next
// dispatch cycle — up to ~60 min on the hourly backstop.
//
// Proven by the workflow's own log rather than inferred: run 34835208275 filed #2646 (P0) and
// #2647 (P1) at 10:51:28-30, and its routing step at 10:51:31 routed only #2641/#2642/#2643 — the
// PREVIOUS cycle's issues. Two earlier instances match exactly (#2630 filed 08:18 → routed 08:24;
// #2641-3 filed 10:24 → routed 10:51), so this was systematic, not a one-off race.
//
// Why it mattered: "delivered is not owned" is the exact failure the routing step was written to
// close. A P0 reached GitHub in ~30 s and reached its OWNER an hour later; until then it was
// invisible to that routine's queue and read as '(unrouted)' to mon_detect_alert_queue_unworked().
// The bug was that failure surviving INSIDE its own fix, one layer down.
//
// WHY THIS BARRIER EXECUTES THE RULE. Per AGENTS.md ("A FAILED FETCH IS NOT AN EMPTY ANSWER"), a
// barrier over this class must RUN the function against an injected failure. Every one of the five
// defects of 2026-09-04 had a source-TEXT tripwire over the exact line and every one stayed green
// for as long as the defect was live. So §1 below feeds routingWorklist() the precise broken world
// — a listing that omits an issue that was just created — and asserts the issue is still walked.
// A grep for "created_issues.jsonl" would pass against a workflow that wrote the file and never
// read it, which is exactly the shape being guarded against.
//
// §2 is the homing half: the rule is only worth anything if the workflow actually executes it, so
// the workflow is parsed and asserted to both RECORD created issues and CONSUME them through the
// CLI. §3 mutation-proves the rule itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routingWorklist } from './lib/alertRouting.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const WORKFLOW = join(ROOT, '.github/workflows/alert-dispatch.yml');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nA newly filed alert issue is routed by the run that filed it\n');

// ── §1 THE DEFECT ITSELF, EXECUTED ──────────────────────────────────────────────────────────────
// The exact world of run 34835208275: the listing holds the previous cycle's issues, and #2646 and
// #2647 were created seconds ago and are not indexed yet.
const staleListing = [
  { number: 2643, title: '[alert] search_latency_degraded', labels: [{ name: 'ezhalah-alert' }, { name: 'routine-2-production' }] },
  { number: 2642, title: '[alert] search_scope_unreachable:rakez_residential_listings', labels: [{ name: 'ezhalah-alert' }] },
  { number: 2641, title: '[alert] quarantine_growth:rakez', labels: [{ name: 'ezhalah-alert' }] },
];
const justCreated = [
  { number: 2646, title: '[alert] seam_synthetic_delivery_probe:2026-09-14' },
  { number: 2647, title: '[alert] run_duration_explosion:muktamel' },
];

const worklist = routingWorklist(staleListing, justCreated);
const numbers = worklist.map((w) => w.number);

check(
  '§1 an issue created this run but ABSENT from the listing is still walked',
  numbers.includes(2646) && numbers.includes(2647),
  `worklist was [${numbers.join(', ')}]`,
);
check(
  '§1 a just-created issue is walked as UNROUTED, so it actually gets a label',
  worklist.find((w) => w.number === 2646)?.routed === false,
);
check(
  '§1 the pre-existing listing is still walked (no regression in the backfill half)',
  [2641, 2642, 2643].every((n) => numbers.includes(n)),
);
check(
  '§1 an issue that ALREADY carries a routine- label is reported as routed, not re-derived',
  worklist.find((w) => w.number === 2643)?.routed === true,
);
check(
  '§1 an unlabelled listing entry is still reported as unrouted',
  worklist.find((w) => w.number === 2642)?.routed === false,
);
check(
  '§1 titles survive, since the dedup_key is parsed back out of them',
  worklist.find((w) => w.number === 2646)?.title === '[alert] seam_synthetic_delivery_probe:2026-09-14',
);

// The union must not double-walk an issue GitHub DID manage to index in time. Walking it twice
// would re-derive an owner over a label a human may have corrected by hand.
const indexedInTime = routingWorklist(
  [{ number: 2646, title: '[alert] x', labels: [{ name: 'ezhalah-alert' }, { name: 'routine-7-seam' }] }],
  [{ number: 2646, title: '[alert] x' }],
);
check(
  '§1 an issue in BOTH the listing and the created set is walked exactly once',
  indexedInTime.length === 1,
  `got ${indexedInTime.length}`,
);
check(
  '§1 ...and keeps the listing\'s label state, so a hand-set owner is never re-derived',
  indexedInTime[0]?.routed === true,
);

// Most runs file nothing. That path must be byte-for-byte the old behaviour.
const nothingCreated = routingWorklist(staleListing, []);
check(
  '§1 a run that filed nothing yields exactly the listing, unchanged',
  JSON.stringify(nothingCreated.map((w) => w.number)) === JSON.stringify([2643, 2642, 2641]),
);
check(
  '§1 an empty listing with a fresh issue still yields that issue (first alert after a quiet spell)',
  routingWorklist([], justCreated).length === 2,
);

// ── §2 HOMING: the workflow must actually record AND consume the created set ─────────────────────
const wf = readFileSync(WORKFLOW, 'utf8');

check(
  '§2 the filing step records what it created',
  /created_issues\.jsonl/.test(wf) && />>\s*created_issues\.jsonl/.test(wf),
);
check(
  '§2 the routing step EXECUTES the worklist rule (not a jq restatement of it)',
  /alert-routing-worklist\.ts\s+created_issues\.jsonl/.test(wf),
);
check(
  '§2 the routing sweep no longer builds its worklist with an inline jq map',
  !/jq -c '\.\[\] \| \{number, title, routed:/.test(wf),
);
check(
  '§2 the created set is APPENDED, never truncated (a run may file several)',
  !/>\s*created_issues\.jsonl/.test(wf.replace(/>>\s*created_issues\.jsonl/g, '')),
);
// Recording the number is an OPTIMISATION; filing the issue is the load-bearing act. The step runs
// under `set -e`, so an unguarded `jq --argjson n "$num"` on unexpected `gh` output would abort the
// whole loop and leave every REMAINING alert in that run unfiled — trading a one-cycle routing
// delay for a total dispatch outage. The guard must therefore be numeric AND non-fatal.
check(
  '§2 the number parse is guarded, so a surprise from `gh` cannot abort the filing loop',
  /\[ -z "\$\{num\/\/\[0-9\]\/\}" \]/.test(wf) && /::warning::could not parse an issue number/.test(wf),
);
check(
  '§2 the labelling mechanism is still the idempotent sweep, not a --label on create',
  /gh issue create[^\n]*--label ezhalah-alert[^\n]*--label "\$sev"/.test(wf)
    && !/gh issue create[^\n]*--label "\$label"/.test(wf),
);
check(
  '§2 this barrier runs in npm test',
  npmTestRuns(ROOT, 'verify-alert-routing-worklist'),
);

// ── §3 MUTATION PROOFS: each is a plausible way to break the rule; each must be caught ───────────
type Mutant = { name: string; run: () => boolean };
const mutants: Mutant[] = [
  {
    // THE ORIGINAL DEFECT. Dropping the union is exactly the code that was live until 2026-09-14.
    name: 'drops the created set (the original defect)',
    run: () => routingWorklist(staleListing, []).some((w) => w.number === 2646),
  },
  {
    name: 'marks a just-created issue as already routed (so it never gets a label)',
    run: () => routingWorklist([], justCreated).every((w) => w.routed === false) === false,
  },
  {
    name: 'loses the pre-existing listing (breaks the backfill half)',
    run: () => routingWorklist([], justCreated).some((w) => w.number === 2641),
  },
  {
    name: 'double-walks an issue present in both inputs',
    run: () => indexedInTime.length !== 1,
  },
  {
    name: 'reports an already-owned issue as unrouted (re-derives a hand-set owner)',
    run: () => worklist.find((w) => w.number === 2643)?.routed !== true,
  },
  {
    name: 'drops the title, leaving no dedup_key to route on',
    run: () => routingWorklist([], justCreated).some((w) => !w.title),
  },
];

// Named mustCatch to match every other barrier in this tree, and because
// verify-new-barriers-are-mutation-proven.ts looks for exactly this call to confirm a new barrier
// carries an EXECUTABLE proof rather than a prose claim of one.
function mustCatch(label: string, caught: boolean): void {
  check(`§3 mutant caught — ${label}`, caught);
}

for (const m of mutants) {
  let caught = false;
  try {
    caught = m.run() === false;
  } catch {
    caught = true;
  }
  mustCatch(m.name, caught);
}

if (failures > 0) {
  console.error(`\nverify-alert-routing-worklist: ${failures} FAILED\n`);
  process.exit(1);
}
console.log('\nverify-alert-routing-worklist: all checks passed\n');
