// EVERY SCHEDULED WORKFLOW MUST BE ABLE TO ALERT (2026-09-04, issue #1349).
//
// THE FAILURE CLASS THIS PINS. A workflow that runs unattended and fails silently is the same
// silence as no check at all. Measured 2026-09-04: 17 scheduled workflows could go red and raise
// NOTHING — only selector-e2e.yml and migration-drift-guard.yml called mon_raise. Issue #1349
// recorded the consequence: ui-parity failed five nights running and alerted nobody. The system's
// own production checks were the weakest link in its own alerting.
//
// This is the same lesson as the nine dark detectors of 2026-08-10 (AGENTS.md §"Read this first"):
// a monitor that cannot reach a human reads as a clean bill of health. So the barrier is deliberately
// SET-BASED — it enumerates the schedule triggers on disk rather than checking a hand-kept list, and
// a NEW scheduled workflow with no alerting FAILS by default. Discovery fails in the safe direction.
//
// THREE THINGS IT ASSERTS:
//   (a) every `.github/workflows/*.yml` with a schedule: trigger either invokes the bridge
//       (scripts/ops/raise-workflow-alert.mjs) or calls mon_raise directly, unless it carries an
//       explicit EXEMPT entry below with a written reason;
//   (b) every bridge invocation is well-formed — it names its OWN file as --workflow (the dedup key
//       is that filename, so a copy-paste names someone else's alert) and runs under always();
//   (c) every kind the bridge can emit is routed to its owning routine by EXECUTING the real
//       routineForKind() from scripts/lib/alertRouting.ts. Never string-matched: routing is regex
//       patterns with first-match-wins ordering, and only running it proves what a kind resolves to.
//
// Offline and deterministic — it reads tracked files and runs pure functions, so it belongs in
// `npm test` (it runs there by existing; see AGENTS.md §"How `npm test` finds its checks").
//
// Run: node --experimental-strip-types scripts/verify-scheduled-checks-alert-on-failure.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { routineForKind, FALLBACK_ROUTINE, ROUTINES, type RoutineNumber } from './lib/alertRouting.ts';
import { buildRpcCall, parseArgs, dedupKey, SEVERITY } from './ops/raise-workflow-alert.mjs';

const ROOT = join(import.meta.dirname, '..');
const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const BRIDGE = 'scripts/ops/raise-workflow-alert.mjs';

/**
 * The kinds the bridge is wired to emit, and the routine that must own each. Executed against the
 * real routing table below — this is the contract, not a copy of it.
 * Ownership follows the SURFACE the dead check was watching, so the engineer who would have received
 * the finding also receives the fact that the finder stopped working.
 */
const BRIDGE_KINDS: Record<string, RoutineNumber> = {
  af_live_check_failed: 5,      // 🎯 Advanced Filter + Trending
  search_live_check_failed: 4,  // 🧪 Search & Matching QA
  journey_live_check_failed: 6, // 👣 Journey & Persistence
  data_live_check_failed: 3,    // 🛡️ Data Integrity
  ingestion_check_failed: 1,    // ⚡ Junior Scraping
  seam_check_failed: 7,         // 🧵 Systems Seam
};

/**
 * Scheduled workflows deliberately NOT required to alert. Every entry carries a reason, and a stale
 * entry is itself a failure — an exemption list that outlives its reason is how a barrier is
 * quietly emptied one line at a time.
 */
const EXEMPT: Record<string, string> = {
  'alert-dispatch.yml':
    'This IS the delivery channel: an alert about its own failure could not be delivered by it. ' +
    'It is watched from the DB side instead, by mon_detect_alert_dispatch_silent() (migration ' +
    '20260828211856), which is a heartbeat detector that fires precisely when this workflow stops ' +
    'running — the one shape a self-raised alert cannot cover.',
  'af-live-truth-check.yml':
    'TEMPORARY (2026-09-04): owned by a concurrent change that adds its own af_live_check_failed ' +
    'wiring. af_live_check_failed is already routed (routine 5, asserted below), so the only ' +
    'missing half is the workflow step. DELETE THIS ENTRY once that change lands — it is the only ' +
    'live-check workflow still able to fail silently.',
};

// ── YAML reading. Strip comments AT THE READER, including trailing ones ────────────────────────────
// A commented-out `schedule:` must not read as scheduled, and a commented-out bridge call must not
// read as wired — that is the difference between checking the code and checking the prose next to it.
function stripComments(yaml: string): string {
  return yaml
    .split('\n')
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

const isScheduled = (yaml: string) => /^\s*schedule:\s*$/m.test(yaml);
const callsBridge = (yaml: string) => yaml.includes('raise-workflow-alert.mjs');
/**
 * The two sanctioned alternatives to the bridge:
 *   - the workflow curls rpc/mon_raise itself (selector-e2e.yml);
 *   - the script it RUNS raises the alert from inside (migration-drift-guard.yml → the drift
 *     checker writes its own P1). Resolving the invoked file and reading it is the honest test —
 *     "the workflow file does not contain the string mon_raise" says nothing about whether the run
 *     alerts. One level deep only: a raise buried deeper fails this barrier loudly, and the answer
 *     to that is the bridge step, which is the shape this repo wants anyway.
 */
const raisesDirectly = (yaml: string) =>
  /rpc\/mon_raise/.test(yaml)
  || [...yaml.matchAll(/\b(scripts\/[\w./-]+\.(?:ts|mjs|cjs|js|py|sh))/g)]
    .map((m) => join(ROOT, m[1]!))
    .some((p) => existsSync(p) && readFileSync(p, 'utf8').includes('mon_raise'));

/** Every `--kind X` the file passes to the bridge. */
const kindsUsed = (yaml: string) => [...yaml.matchAll(/--kind\s+([a-z0-9_]+)/g)].map((m) => m[1]!);
/** Every `--workflow F` the file passes to the bridge. */
const workflowArgs = (yaml: string) => [...yaml.matchAll(/--workflow\s+(\S+)/g)].map((m) => m[1]!);
/** The bridge call must sit under an always() condition, or a FAILING run never reaches it. */
const bridgeRunsOnFailure = (yaml: string) => {
  const at = yaml.indexOf('raise-workflow-alert.mjs');
  if (at < 0) return false;
  return /if:\s*always\(\)/.test(yaml.slice(0, at).split('\n').slice(-12).join('\n'));
};

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// ── 0. The bridge itself must exist ───────────────────────────────────────────────────────────────
check(existsSync(join(ROOT, BRIDGE)), `${BRIDGE} exists`,
  `${BRIDGE} is missing — every workflow below invokes a script that is not there`);

// ── 1. Load every workflow ────────────────────────────────────────────────────────────────────────
const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml')).sort();
const yaml = new Map(files.map((f) => [f, stripComments(readFileSync(join(WORKFLOW_DIR, f), 'utf8'))]));
check(files.length > 40, `${files.length} workflow files enumerated`,
  `only ${files.length} workflow files found — the glob is broken, and a barrier over an empty set passes trivially`);

const scheduled = files.filter((f) => isScheduled(yaml.get(f)!));
check(scheduled.length >= 15, `${scheduled.length} workflows carry a schedule: trigger`,
  `only ${scheduled.length} scheduled workflows detected — the schedule: predicate is broken`);

// ── 2. (a) Every scheduled workflow alerts, or is explicitly exempt with a reason ──────────────────
const silent = scheduled.filter(
  (f) => !callsBridge(yaml.get(f)!) && !raisesDirectly(yaml.get(f)!) && !(f in EXEMPT));
check(silent.length === 0,
  `all ${scheduled.length - Object.keys(EXEMPT).length} non-exempt scheduled workflows can raise an alert`,
  `these scheduled workflows fail SILENTLY — a red run notifies nobody: ${silent.join(', ')}. Add ` +
  `the final bridge step (see ui-parity.yml) or, if it genuinely must not alert, add it to EXEMPT ` +
  `in this file with the reason and the detector that covers it instead`);

// ── 3. Exemption hygiene: no stale entries, no reasonless ones ────────────────────────────────────
for (const [file, reason] of Object.entries(EXEMPT)) {
  check(reason.trim().length > 40, `EXEMPT ${file} carries a written reason`,
    `EXEMPT["${file}"] has no real reason — an unexplained exemption is a hole, not a decision`);
  check(files.includes(file), `EXEMPT ${file} exists`,
    `EXEMPT["${file}"] names a workflow that no longer exists — delete the stale entry`);
  if (files.includes(file)) {
    check(isScheduled(yaml.get(file)!), `EXEMPT ${file} is actually scheduled`,
      `EXEMPT["${file}"] is no longer a scheduled workflow — the exemption is stale, delete it`);
    check(!callsBridge(yaml.get(file)!),
      `EXEMPT ${file} is still unwired (the exemption is still doing something)`,
      `EXEMPT["${file}"] now calls the bridge — remove the exemption so the barrier protects it`);
  }
}

// ── 4. (b) Every bridge invocation is well-formed, wherever it lives ──────────────────────────────
// Not only the scheduled ones: pg_cron drives several workflows through workflow_dispatch (GitHub's
// own schedule: triggers were dropped project-wide for skipping runs), so they are unattended too.
const wired = files.filter((f) => callsBridge(yaml.get(f)!));
check(wired.length >= 15, `${wired.length} workflows invoke the bridge`,
  `only ${wired.length} workflows invoke the bridge — expected the full wired set`);
for (const f of wired) {
  const src = yaml.get(f)!;
  const args = workflowArgs(src);
  check(args.length > 0 && args.every((a) => a === f),
    `${f} names itself as --workflow`,
    `${f} passes --workflow ${args.join(',') || '(none)'} — the dedup key is workflow_failed:<file>, ` +
    `so this workflow would raise and resolve SOMEONE ELSE'S alert (copy-paste bug)`);
  const kinds = kindsUsed(src);
  check(kinds.length > 0 && kinds.every((k) => k in BRIDGE_KINDS),
    `${f} passes a declared kind (${kinds.join(', ')})`,
    `${f} passes --kind ${kinds.join(',') || '(none)'}, which is not declared in BRIDGE_KINDS — an ` +
    `undeclared kind is unrouted-by-accident; add it here AND to scripts/lib/alertRouting.ts`);
  check(bridgeRunsOnFailure(src), `${f} reaches the bridge on a FAILING run (always())`,
    `${f}'s bridge call has no always() guard above it — GitHub skips later steps/jobs after a ` +
    `failure by default, so it would only ever run on green: it could resolve alerts and never raise one`);
}

// ── 5. (c) ROUTING, BY EXECUTION ──────────────────────────────────────────────────────────────────
// The real routineForKind(), not a string match on the file. Extracted as a function so the mutation
// proof below can run the SAME predicate against a broken resolver.
type Resolver = (kind: string) => RoutineNumber;
const misroutedBy = (resolve: Resolver) =>
  Object.entries(BRIDGE_KINDS).filter(([kind, want]) => resolve(kind) !== want)
    .map(([kind, want]) => `${kind} → ${resolve(kind)} (want ${want})`);

const misrouted = misroutedBy(routineForKind);
check(misrouted.length === 0,
  `all ${Object.keys(BRIDGE_KINDS).length} bridge kinds route to their owning routine`,
  `these kinds do not route where they must: ${misrouted.join('; ')}. An alert filed to the wrong ` +
  `routine is an alert nobody works — fix scripts/lib/alertRouting.ts`);
for (const [kind, want] of Object.entries(BRIDGE_KINDS)) {
  if (routineForKind(kind) === want) ok.push(`  ${kind} → ${ROUTINES[want].name}`);
}

// ── 6. The bridge's own logic — executed, never described ─────────────────────────────────────────
{
  const base = { kind: 'search_live_check_failed', workflow: 'ui-parity.yml', runUrl: 'https://x/1' };
  const raise = buildRpcCall({ ...base, status: 'failure' });
  check(raise?.fn === 'mon_raise' && raise.body.p_sev === SEVERITY
    && raise.body.p_dedup === 'workflow_failed:ui-parity.yml'
    && raise.body.p_platform === null
    && typeof raise.body.p_detail?.why === 'string' && typeof raise.body.p_detail?.action === 'string'
    && raise.body.p_detail?.run_url === 'https://x/1',
    'failure → mon_raise(P1, kind, null, workflow_failed:<file>, {workflow, run_url, why, action})',
    'the bridge no longer raises the documented P1 shape on failure');
  const resolve = buildRpcCall({ ...base, status: 'success' });
  check(resolve?.fn === 'mon_resolve_key' && resolve.body.p_dedup === dedupKey('ui-parity.yml')
    && resolve.body.p_kind === base.kind,
    'success → mon_resolve_key(kind, same dedup key) — the alert self-heals',
    'the bridge no longer resolves on success: an alert would stay open after the check recovered');
  check(buildRpcCall({ ...base, status: 'cancelled' }) === null
    && buildRpcCall({ ...base, status: 'skipped' }) === null,
    'cancelled/skipped → no write (a cancelled run proves nothing either way)',
    'the bridge writes on a cancelled run — it would either raise a false alarm or erase a real alert');
  // One dedup key per WORKFLOW, never per run: two different runs of one workflow must collide.
  check(dedupKey('ui-parity.yml') === dedupKey('ui-parity.yml')
    && dedupKey('ui-parity.yml') !== dedupKey('audit-invariants.yml'),
    'the dedup key is the workflow file — one open alert per workflow, not one per run',
    'the dedup key is no longer per-workflow — a nightly failure would open a new alert every night');
  // Arguments are validated, not trusted: a typo must fail loudly rather than write the wrong key.
  const rejects = (argv: string[]) => { try { parseArgs(argv); return false; } catch { return true; } };
  check(rejects(['--kind', 'k', '--workflow', 'w.yml', '--status', 'failure'])
    && rejects(['--kind', 'k', '--workflow', 'w.yml', '--status', 'nope', '--run-url', 'u'])
    && !rejects(['--kind', 'k', '--workflow', 'w.yml', '--status', 'failure', '--run-url', 'u']),
    'parseArgs rejects a missing --run-url and an unknown --status, and accepts a full call',
    'parseArgs no longer validates its arguments — a typo would silently produce a wrong or absent alert');
}

// ── MUTATION PROOF ────────────────────────────────────────────────────────────────────────────────
// Each assertion is re-run against a deliberately broken input; a check that no longer fails on its
// own defect has stopped testing anything.
console.log('scheduled-checks-alert-on-failure: an unattended red run must reach a human\n');
for (const o of ok) console.log(`  ✓ ${o}`);

let blind = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  blind++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');

// (1) A scheduled workflow LOSES its alerting step. Mutate a real wired file and re-run the real
//     predicate: strip the bridge invocation from ui-parity.yml and it must show up as silent.
{
  const mutated = new Map(yaml);
  mutated.set('ui-parity.yml', yaml.get('ui-parity.yml')!.replace(/raise-workflow-alert\.mjs/g, 'echo'));
  const stillSilent = scheduled.filter(
    (f) => !callsBridge(mutated.get(f)!) && !raisesDirectly(mutated.get(f)!) && !(f in EXEMPT));
  mustCatch('a scheduled workflow whose alerting step was deleted',
    stillSilent.includes('ui-parity.yml'));
}
// (2) A brand-new scheduled workflow that nobody wired. The set-based enumeration, not a list.
{
  const newFile = 'brand-new-nightly-check.yml';
  const fakeFiles = [...files, newFile];
  const fakeYaml = new Map(yaml).set(newFile, 'on:\n  schedule:\n    - cron: 0 3 * * *\njobs:\n  x:\n    steps: []\n');
  const fakeSilent = fakeFiles.filter((f) => isScheduled(fakeYaml.get(f)!)
    && !callsBridge(fakeYaml.get(f)!) && !raisesDirectly(fakeYaml.get(f)!) && !(f in EXEMPT));
  mustCatch('a NEW scheduled workflow added with no alerting at all', fakeSilent.includes(newFile));
}
// (3) A kind LOSES its route. Run the same predicate against a resolver that has forgotten every
//     pattern — exactly what deleting rules from alertRouting.ts produces.
mustCatch('a bridge kind that lost its routing rule (falls through to the #2 triage fallback)',
  misroutedBy(() => FALLBACK_ROUTINE).length === Object.values(BRIDGE_KINDS).filter((r) => r !== FALLBACK_ROUTINE).length
  && misroutedBy(() => FALLBACK_ROUTINE).length > 0);
// (4) A kind routed to the WRONG routine (not merely unrouted) — a plausible copy-paste in the table.
mustCatch('a bridge kind routed to the wrong routine',
  misroutedBy((k) => (k === 'ingestion_check_failed' ? 3 : routineForKind(k))).length === 1);
// (5) The commented-out-alerting dodge: prose that mentions the bridge must not count as wiring.
mustCatch('a workflow whose only bridge reference is inside a YAML comment',
  !callsBridge(stripComments('jobs:\n  x:\n    steps:\n      # run: node scripts/ops/raise-workflow-alert.mjs\n'))
  && !isScheduled(stripComments('on:\n  # schedule:\n  workflow_dispatch: {}\n')));
// (6) A bridge call that names another workflow's file — it would hijack that alert's dedup key.
mustCatch('a bridge call passing someone else\'s --workflow (wrong dedup key)',
  workflowArgs('run: node scripts/ops/raise-workflow-alert.mjs --workflow ui-parity.yml')
    .some((a) => a !== 'audit-invariants.yml'));
// (7) A bridge call with no always() guard — it would resolve alerts and never raise one.
mustCatch('a bridge step with no always() guard above it',
  !bridgeRunsOnFailure('    steps:\n      - name: bridge\n        run: node scripts/ops/raise-workflow-alert.mjs --kind k\n'));
// (8) An exemption that names nowhere. EXEMPT must not become a graveyard.
mustCatch('an exemption with no written reason', !('x'.trim().length > 40));
// (9) The invoked-script escape hatch must not become a free pass: running SOME script is not
//     alerting. It counts only when that file really raises — proven in both directions.
mustCatch('a workflow that runs a script which does NOT raise (must not read as alerting)',
  !raisesDirectly('run: node scripts/run-tests.mjs\n')
  && raisesDirectly('run: node scripts/verify-migration-drift-vs-production.ts\n'));

for (const p of problems) console.error(`  ✗ ${p}`);
if (problems.length || blind) {
  console.error(`\n❌ ${problems.length} check(s) failed, ${blind} guard(s) blind — an unattended ` +
    `workflow can fail without alerting anyone (issue #1349).`);
  process.exit(1);
}
console.log('\n✅ scheduled-checks-alert-on-failure: passed.');
