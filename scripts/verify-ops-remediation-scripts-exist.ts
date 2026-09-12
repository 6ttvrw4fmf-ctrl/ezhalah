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
  { path: 'scripts/verify-run-field-range-composite-baseline-live.ts', owner: 'routine-3-data-integrity',
    why: 'claimed by 20260821031350_fix_run_field_range_composite_baseline.sql; scraped-field range baselines' },
  // CLOSED 2026-09-05 by routine-2-production (PR #1850), the routine this gap was routed to.
  // scripts/verify-searchable-platforms-are-monitored.ts now exists and calls
  // ops_searchable_platforms_unmonitored() — the external reader migration 20260905062027 created
  // the RPC for. It is registered exactly as this ledger required a LIVE check to be: a
  // test-exclusions.txt row naming .github/workflows/loader-active-platforms-check.yml as its home,
  // never the required hermetic npm test. The routing worked end to end — the gap was raised by the
  // session that mirrored the migration, and closed by the surface that owns the predicate.
  { path: 'scripts/verify-sentry-heartbeat-detector-wired.ts', owner: 'routine-7-seam',
    why: 'claimed by 20260830183604_sentry_check_heartbeat_and_silent_detector_layer2.sql; detector roster seam' },
  { path: 'scripts/verify-unlocated-fallback-scope.ts', owner: 'routine-3-data-integrity',
    why: 'claimed by 20260810123000_unlocated_fallback_must_only_rescue_unlocated_rows.sql; location source truth' },
  // Both raised 2026-09-06 while recovering 18 migrations that were live in production but never
  // mirrored to this repo (found because they blocked the remal/amaall launch deploy). Recovered
  // verbatim from supabase_migrations.schema_migrations.statements — the SQL each names below is
  // real and running; only the repo-side test file that would prove it was never committed by
  // whichever session authored it.
  { path: 'scripts/verify-declared-alert-kind-has-an-emitter.ts', owner: 'routine-11',
    why: 'claimed by 20260906041438_a_declared_alert_kind_without_an_emitter_is_decoration.sql; '
      + 'its own sibling 20260906041121_routine11_lifecycle_the_last_four_alert_kinds_get_an_emitter.sql '
      + 'names the owning routine in its filename — the alert-kind/emitter roster this session shipped' },
  { path: 'scripts/verify-placeholder-price-detector-sees-the-whole-sentinel-set.ts', owner: 'routine-3-data-integrity',
    why: 'claimed by 20260906043755_wasalt_form_default_prices_are_retracted_and_watched.sql '
      + '(ops_incident #63/#65); wasalt placeholder-price detection is price/listing data integrity' },
];

/**
 * SUPERSEDED PLACEHOLDERS — unlike KNOWN_GAPS, these are not real protections someone still owes.
 * Each is a worked-example path inside a RAISE EXCEPTION message that was never meant to name a
 * real file, left behind in an already-applied (therefore immutable — verify-migration-content-
 * parity.ts) migration. The very next migration replaced the live guidance so nothing points at the
 * placeholder anymore; only the frozen historical text of the first migration still does. Routing
 * this to a KNOWN_GAPS "owner" would be dishonest — no routine should ever go write
 * scripts/verify-x.ts, because it was never a real protection to begin with.
 */
const SUPERSEDED_PLACEHOLDER_CLAIMS: { path: string; from: string; why: string }[] = [
  { path: 'scripts/verify-x.ts', from: '20260911181654_incident_resolution_gate_cannot_be_satisfied_by_its_own_default.sql',
    why: 'a worked-example path inside a RAISE EXCEPTION message, not a real barrier. Superseded '
      + 'same day by 20260911183306_incident_resolve_guidance_names_no_script_that_does_not_exist.sql, '
      + "which replaced the live function's guidance to name no concrete path at all — see that "
      + "migration's own comment for the full account." },
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
const supersededPaths = new Set(SUPERSEDED_PLACEHOLDER_CLAIMS.map((s) => s.path));
const dangling: string[] = [];
for (const [p, from] of [...claims].sort()) {
  if (existsSync(join(root, p))) continue;
  if (gapPaths.has(p)) continue;
  if (supersededPaths.has(p)) continue;
  dangling.push(`${p}  — claimed by ${from}`);
}
check('no migration claims a barrier that was never written', dangling.length === 0);
for (const d of dangling) console.error(`      ${d}`);
if (SUPERSEDED_PLACEHOLDER_CLAIMS.length) {
  console.log(`      ${SUPERSEDED_PLACEHOLDER_CLAIMS.length} superseded placeholder claim(s), already fixed live:`);
  for (const s of SUPERSEDED_PLACEHOLDER_CLAIMS) console.log(`        ${s.path} (${s.from})`);
}

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
