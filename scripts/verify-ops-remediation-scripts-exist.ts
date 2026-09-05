// EVERY BARRIER A MIGRATION CLAIMS MUST ACTUALLY EXIST, AND SOMETHING MUST RUN IT.
//
// THE BUG CLASS (found 2026-09-05, Search & Matching QA). A migration says, in its own header,
// "enforced offline by scripts/verify-qa-scope-registry-current.ts", or a detector's `fix` field
// tells the next engineer to "re-harvest: node e2e/qa-coverage/harvest-scope.mjs". The reader —
// human or agent — takes that as a statement of fact: the protection exists, someone wrote it, it
// runs. Six of those references pointed at files that had NEVER been written.
//
// This is not paperwork. `mon_detect_search_scope_unreachable_inventory()` was hardened on
// 2026-09-04 with a three-day freshness gate whose entire premise is a harvester that keeps
// `ops_qa_scope` current — "Freshness is kept by e2e/qa-coverage/harvest-scope.mjs", said the
// migration, about a file that did not exist. Seventeen hours later ألتا and شموع الشمال shipped,
// the registry did not move, and the detector raised the exact false P1s the hardening had been
// written to prevent, claiming 13 production-ready listings were "stored, indexed and invisible"
// while every one of them was returned by a real anon search of the deployed bundle's own scope.
// The freshness gate could not save it: the gate trips at three days, the drift produced false
// alerts at seventeen hours, and nothing was ever going to refresh the registry.
//
// It is the same shape AGENTS.md already names as this repo's most expensive failure mode — a
// protection that reads as present and is absent, so a clean sweep sits on top of an open hole.
// A dangling reference is worse than no reference: it actively tells the next engineer to stop
// looking.
//
// WHAT THIS CHECKS, over every `supabase/migrations/*.sql`:
//   1. every `scripts/…` or `e2e/…` path a migration names EXISTS on disk, and
//   2. every `scripts/verify-*` entrypoint it names is actually REACHED — `npm test` runs it, a
//      workflow invokes it, or `scripts/test-exclusions.txt` names where it runs instead. A barrier
//      nothing executes is decoration, which is the same lie one step later.
//
// Reachability is asked through `scripts/lib/testRegistry.ts` (`npmTestRuns` / `workflowInvokes`),
// never by string-matching `package.json` — AGENTS.md forbids that predicate outright, and
// `workflowInvokes` exists because two guards previously accepted a script named only inside a
// workflow COMMENT that said it was deliberately not run there.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, npmTestRuns, workflowInvokes } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) { failures++; console.error(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`);
};
/**
 * A MUTATION PROOF: this barrier's own predicate, applied to a deliberately broken input, asserting
 * that it really comes back RED. `caught` must be a computed boolean — a literal `true` here is the
 * shape scripts/verify-new-barriers-are-mutation-proven.ts exists to refuse.
 */
const mustCatch = (label: string, caught: boolean) => check(`MUTATION \u2014 ${label}`, caught);


/**
 * Repo paths a migration can name. Deliberately narrow to the two directories that hold executable
 * ops artifacts — a migration mentioning `src/data/remote.ts` is citing product code as context,
 * not promising a protection.
 */
const PATH_RE = /(?:scripts|e2e)\/[A-Za-z0-9_@./-]+\.(?:ts|mjs|js|cjs|sh|py)/g;

/**
 * KNOWN GAPS — dangling references that predate this barrier, each ROUTED to the routine that owns
 * the surface it protects (docs/ops/ENGINEER_ROUTINES.md §G.3: route, never "someone should look").
 *
 * This ledger is a CEILING, not a parking space. A reference not listed here fails the run, so a
 * NEW dangling barrier claim cannot be introduced without a deliberate, reviewed edit to this file
 * — and an entry whose file has since been written also fails, so the ledger cannot rot into a
 * graveyard of stale excuses. It may only shrink.
 */
const KNOWN_GAPS: { path: string; owner: string; why: string }[] = [
  { path: 'scripts/verify-p0-fast-lane-detection.ts', owner: 'routine-7-seam',
    why: 'claimed by 20260831192229_p0_detection_leaves_the_long_sweep_transaction.sql; detector/alert seam' },
  { path: 'scripts/verify-run-field-range-composite-baseline-live.ts', owner: 'routine-3-data-integrity',
    why: 'claimed by 20260821031350_fix_run_field_range_composite_baseline.sql; scraped-field range baselines' },
  { path: 'scripts/verify-searchable-platforms-are-monitored.ts', owner: 'routine-2-production',
    why: 'claimed by 20260905062027_ops_searchable_platforms_unmonitored_is_readable_by_a_barrier.sql, which created the anon-executable RPC ops_searchable_platforms_unmonitored() specifically so a committed barrier could EXECUTE it — then never wrote that barrier. Surfaced only when routine-7-seam mirrored the migration into git on 2026-09-05 (it was applied to production at 06:20Z and uncommitted until then), which is the drift-blinds-barriers shape: the check was green because the evidence was missing. NOT an unguarded invariant in production — mon_detect_registry_orphans limb 3 enforces the same predicate, is on the mon_run_all_detectors roster, runs twice hourly, and ops_searchable_platforms_unmonitored() returns 0 rows as of 2026-09-05 11:07Z. What is missing is the EXTERNAL reader, which is the whole point of that migration: limb 3 can only be verified by reading its own function body, so if it were deleted tomorrow nothing outside it would notice. Routed to routine-2-production, which authored the migration and owns the platform-registry/monitoring-scope surface; routine-7-seam did not author the barrier because its predicate and failure semantics belong to that surface (SYSTEMS_SEAM_ENGINEER.md PART 2). It is a LIVE check, so its home must be a workflow or a test-exclusions.txt row, never the required hermetic npm test.' },
  { path: 'scripts/verify-sentry-heartbeat-detector-wired.ts', owner: 'routine-7-seam',
    why: 'claimed by 20260830183604_sentry_check_heartbeat_and_silent_detector_layer2.sql; detector roster seam' },
  { path: 'scripts/verify-unlocated-fallback-scope.ts', owner: 'routine-3-data-integrity',
    why: 'claimed by 20260810123000_unlocated_fallback_must_only_rescue_unlocated_rows.sql; location source truth' },
];

console.log('ops remediation scripts — every barrier a migration claims must exist and run');

// ── Collect every reference, with the migration that made the claim ──────────────────────────────
const migDir = join(root, 'supabase/migrations');
const claims = new Map<string, string>();
for (const f of readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(migDir, f), 'utf8');
  for (const m of sql.match(PATH_RE) ?? []) if (!claims.has(m)) claims.set(m, f);
}
check('migrations were scanned and do reference ops scripts (the corpus is not empty)', claims.size > 0);

// ── 1. EXISTENCE ─────────────────────────────────────────────────────────────────────────────────
const gapPaths = new Set(KNOWN_GAPS.map((g) => g.path));
const dangling: string[] = [];
for (const [p, from] of [...claims].sort()) {
  if (existsSync(join(root, p))) continue;
  if (gapPaths.has(p)) continue;
  dangling.push(`${p}  — claimed by ${from}`);
}
check('no migration claims a barrier that was never written', dangling.length === 0);
for (const d of dangling) console.error(`      ${d}`);

// The ledger may only shrink: an entry whose file now exists is a stale excuse and must be deleted.
const healed = KNOWN_GAPS.filter((g) => existsSync(join(root, g.path)));
check('the KNOWN_GAPS ledger carries no entry whose file now exists', healed.length === 0);
for (const h of healed) console.error(`      ${h.path} now exists — remove its KNOWN_GAPS entry`);

// Every gap is ROUTED, not merely noted. An owner-less gap is the thing §G.3 forbids.
check('every KNOWN_GAPS entry names an owning routine',
  KNOWN_GAPS.every((g) => /^routine-\d+/.test(g.owner) && g.why.length > 20));
if (KNOWN_GAPS.length) {
  console.log(`      ${KNOWN_GAPS.length} pre-existing gap(s), each routed:`);
  for (const g of KNOWN_GAPS) console.log(`        ${g.path} → ${g.owner}`);
}

// ── 2. REACHABILITY of the `verify-*` entrypoints a migration names ──────────────────────────────
// A `scripts/lib/*` module or an `e2e/*` helper is imported, not invoked, so only entrypoints are
// judged here. `verify-*` is this repo's one executable-barrier convention, and it already has a
// contract for where a check may run (npm test, a workflow, or an exclusion row naming its home).
const registry = loadRegistry(root);
const excluded = new Set(registry.excluded.map((e) => e.name));
const wfDir = join(root, '.github/workflows');
const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => readFileSync(join(wfDir, f), 'utf8'));

const unreached: string[] = [];
for (const [p, from] of [...claims].sort()) {
  if (!/^scripts\/verify-[^/]+\.(ts|mjs)$/.test(p)) continue;
  if (!existsSync(join(root, p))) continue;                 // already reported above
  const base = p.replace(/^scripts\//, '');
  const runs = npmTestRuns(root, p)
    || excluded.has(base)
    || workflows.some((w) => workflowInvokes(w, p));
  if (!runs) unreached.push(`${p}  — claimed by ${from}, but nothing runs it`);
}
check('every verify-* barrier a migration claims is actually reached by something', unreached.length === 0);
for (const u of unreached) console.error(`      ${u}`);

// ── 3. MUTATION PROOF — the predicate really fails on a fabricated claim ─────────────────────────
// Executed, not asserted about. A guard against dangling references that cannot itself detect one
// is precisely the failure it exists to catch.
const detect = (sql: string) =>
  (sql.match(PATH_RE) ?? []).filter((p) => !existsSync(join(root, p)) && !gapPaths.has(p));

mustCatch('a fabricated barrier claim is detected',
  detect("-- pinned by scripts/verify-this-was-never-written-2026.ts\nselect 1;").length === 1);
mustCatch('a real, existing barrier claim is NOT flagged',
  detect('-- pinned by scripts/verify-ops-remediation-scripts-exist.ts\nselect 1;').length === 0);
mustCatch('a KNOWN_GAPS path is tolerated exactly once, by the ledger and not by accident',
  KNOWN_GAPS.length === 0
    || (detect(`-- see ${KNOWN_GAPS[0].path}`).length === 0
        && !existsSync(join(root, KNOWN_GAPS[0].path))));

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — a migration promises a protection that is missing or dead.`);
  process.exit(1);
}
console.log('\n✓ every barrier the migration corpus claims exists, and something runs it');
