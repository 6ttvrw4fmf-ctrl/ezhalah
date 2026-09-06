// THE `ops_qa_scope` REGISTRY MUST NOT LAG THE CLIENT — the offline half of that guarantee.
//
// Named by `20260904142555_ops_qa_scope_reharvest_2026_09_04.sql`: «the fix is to stop the registry
// lagging the client, enforced offline by scripts/verify-qa-scope-registry-current.ts». That file
// did not exist until 2026-09-05, and the cost of its absence is measured, not hypothetical.
//
// WHY OFFLINE ENFORCEMENT LOOKS LIKE THIS. `ops_qa_scope` records the `p_tables` list the real
// client sends. Three layers reason from it — `mon_detect_search_scope_unreachable_inventory()`
// (the "stored, indexed and invisible" P1), `ops_qa_cohort_catalog()` (every `p_tables` the daily
// RPC coverage layer and the §3.1 narrowing probe send), and `ops_qa_diff` — and it is a HARVEST,
// so it rots the moment the client's table list changes. An offline check cannot read the live
// registry and must not try; what it CAN prove, hermetically, is that the refresh MECHANISM exists,
// is faithful to what production actually sent, and is wired to run. The DB's own three-day
// freshness gate then proves it really ran. Neither half alone is enough:
//
//   • The freshness gate alone was NOT enough. It shipped on 2026-09-04 and went green over a
//     registry nothing refreshed, because its stated dependency — `e2e/qa-coverage/harvest-scope.mjs`
//     — had never been written. Seventeen hours later ألتا and شموع الشمال shipped (commit 3c5644b),
//     the registry did not move, and the detector raised the exact false P1s the gate existed to
//     prevent: 13 production-ready listings called invisible while a real anon search of the
//     deployed bundle's own scope returned every one of them. A gate that trips at three days
//     cannot cover drift that produces false alerts at seventeen hours.
//   • This check alone is not enough either — a wired harvester that silently fails still leaves a
//     stale registry, and only the DB can see that. It goes P2-loud within STALE_AFTER.
//
// THE PROPERTY THAT MATTERS MOST. §41.6 is explicit that GUESSING `p_tables` invents matching
// defects production does not have; the registry is only worth anything because it is captured from
// the real client's request. So this check proves the harvester HARVESTS — it carries no table
// literal of its own — and that it refuses to record anything it cannot anchor to the request
// production actually sent.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { workflowInvokes } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const HARVESTER = 'e2e/qa-coverage/harvest-scope.mjs';

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


console.log('ops_qa_scope registry currency — the refresh mechanism exists, is faithful, and runs');

// ── 1. THE HARVESTER EXISTS ──────────────────────────────────────────────────────────────────────
const present = existsSync(join(root, HARVESTER));
check(`${HARVESTER} exists`, present);
if (!present) {
  console.error('\n✗ the registry has no refresh path at all — every layer that reads it will rot silently.');
  process.exit(1);
}
const src = readFileSync(join(root, HARVESTER), 'utf8');

// ── 2. IT COVERS EVERY SCOPE LABEL THE REGISTRY CAN NAME ─────────────────────────────────────────
// Derived from the migration corpus, not hardcoded here: a seventh label added by a future
// migration must fail this check rather than be silently left un-refreshed — which is exactly how
// one stale label among six fresh ones would slip past the oldest-label freshness gate.
const migDir = join(root, 'supabase/migrations');
const labels = new Set<string>();
for (const f of readdirSync(migDir).filter((n) => n.endsWith('.sql'))) {
  const sql = readFileSync(join(migDir, f), 'utf8');
  for (const m of sql.matchAll(/ops_qa_scope[\s\S]{0,4000}?/g)) void m;      // scoped read below
  if (!/ops_qa_scope/.test(sql)) continue;
  for (const m of sql.matchAll(/\(\s*'(res|resm|com|s1|s1m|s2)'\s*,/g)) labels.add(m[1]);
  for (const m of sql.matchAll(/scope\s*=\s*'(res|resm|com|s1|s1m|s2)'/g)) labels.add(m[1]);
}
check('the migration corpus defines the scope labels this check compares against', labels.size >= 3);
const uncovered = [...labels].filter((l) => !new RegExp(`scope:\\s*'${l}'`).test(src));
check(`the harvester covers every scope label the registry defines (${[...labels].sort().join(', ')})`,
  uncovered.length === 0);
for (const u of uncovered) console.error(`      no harvest plan for scope «${u}»`);

// ── 3. IT HARVESTS — it does not carry a table list of its own (§41.6) ───────────────────────────
// The single most important property. A harvester holding its own `*_listings` literals would be a
// hardcoded list wearing a harvest's clothes, and the registry would lag the client exactly as
// before while reading as freshly harvested.
const tableLiterals = [...src.matchAll(/'[a-z0-9_]+_(?:residential|commercial)_listings'/g)].map((m) => m[0]);
check('the harvester carries NO hardcoded source-table literal — it reads p_tables off the real request',
  tableLiterals.length === 0);
for (const t of tableLiterals) console.error(`      hardcoded table literal ${t}`);
check('it takes its tables from the intercepted request body, not from any local construction',
  /req\.p_tables/.test(src) && /resultSearches\(requests\)/.test(src));
check('§41.5 — only a p_limit > 1 request counts as a result search (autocomplete reuses this RPC)',
  /p_limit\s*\?\?\s*0\)\s*>\s*1/.test(src));

// ── 4. A CAPTURE IS ANCHOR-CHECKED BEFORE IT IS TRUSTED ──────────────────────────────────────────
// A mis-click that filed «شقة»'s tables under `com` would make the detector confidently wrong in
// BOTH directions — inventing unreachable tables and hiding genuinely dropped ones. What production
// SENT decides, never what the harness believes it clicked (§40.4).
check('the capture is rejected unless the request carries the macro the plan asked for',
  /req\.p_category\s*!==\s*plan\.macro/.test(src));
check('the capture is rejected unless the request carries the plan’s anchor type',
  /req\.p_types\.includes\(plan\.anchor\)/.test(src));
check('an empty p_tables is rejected rather than recorded',
  /req\.p_tables\.length\s*===\s*0/.test(src));

// ── 5. A PARTIAL HARVEST IS REFUSED ──────────────────────────────────────────────────────────────
// Writing only the labels that succeeded refreshes `harvested_at` on some rows and leaves others
// stale — and the detector's gate reads the OLDEST label, so a partial write is undetectable as
// partial. All labels, or none.
check('a partial harvest writes NOTHING (all labels, or none)',
  /captured\.length\s*!==\s*PLANS\.length/.test(src) && /refusing to write any label/i.test(src));
check('the refusal exits non-zero rather than printing a warning nobody reads',
  /process\.exit\(1\)/.test(src));

// ── 6. THE «شهري» SELECTION IS PROVEN TO HAVE COMMITTED (§41.7) ──────────────────────────────────
// شهري needs two clicks in order; if the second never lands, the monthly label captures the ANNUAL
// pool and the two monthly-only sources vanish from every layer that reads this registry — while
// every row still looks freshly harvested.
check('a monthly label equal to its annual twin is refused, never recorded',
  /\['resm',\s*'res'\]/.test(src) && /\['s1m',\s*'s1'\]/.test(src));

// ── 7. SOMETHING ACTUALLY RUNS IT ────────────────────────────────────────────────────────────────
// The freshness gate's premise. A harvester nothing schedules is the 2026-09-04 state exactly.
const wfDir = join(root, '.github/workflows');
const wfFiles = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
const invoking = wfFiles.filter((f) => workflowInvokes(readFileSync(join(wfDir, f), 'utf8'), 'harvest-scope'));
check('a workflow invokes the harvester (comments do not count — testRegistry.workflowInvokes)',
  invoking.length > 0);
const scheduled = invoking.filter((f) => /^\s*schedule:/m.test(readFileSync(join(wfDir, f), 'utf8')));
check('at least one of those workflows is SCHEDULED, so freshness is maintained without anyone remembering',
  scheduled.length > 0);
if (invoking.length) console.log(`      invoked by: ${invoking.join(', ')}${scheduled.length ? ` (scheduled: ${scheduled.join(', ')})` : ''}`);

// ── 8. MUTATION PROOFS — the predicates really discriminate ──────────────────────────────────────
const hardcoded = (s: string) => [...s.matchAll(/'[a-z0-9_]+_(?:residential|commercial)_listings'/g)].length;
mustCatch('a harvester carrying a hardcoded table list fails the §41.6 predicate',
  hardcoded("const T = ['aqar_residential_listings', 'alta_residential_listings'];") === 2);
mustCatch('the real harvester passes that same predicate', hardcoded(src) === 0);
mustCatch('a plan set missing a label is detected',
  [...labels].filter((l) => !new RegExp(`scope:\\s*'${l}'`).test("{ scope: 'res' }")).length === labels.size - 1);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the registry can lag the client again.`);
  process.exit(1);
}
console.log('\n✓ the ops_qa_scope refresh path exists, harvests rather than guesses, refuses a partial or mis-anchored capture, and is scheduled');
