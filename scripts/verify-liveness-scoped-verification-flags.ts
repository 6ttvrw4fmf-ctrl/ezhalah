// REAL barrier for the two liveness flags that make a SCOPED, NON-DESTRUCTIVE verification possible
// (owner-approved 2026-08-31 for the wasalt struck backlog).
//
// WHY THEY EXIST. wasalt's liveness sweep fetches each listing's full ~400KB page through a METERED
// Saudi residential proxy. Over ~54k active rows that is ~22 GB, which is exactly why
// wasalt-liveness.yml carries NO schedule (cost guard, adversarial review 2026-06) and why wasalt's
// direct oracle has never once run — leaving 3,367 struck rows in a permanent UNKNOWN state that
// nothing could resolve. --only-struck narrows the sweep to just that backlog (~1.3 GB) so the
// question "are these actually dead?" becomes answerable without the full sweep's cost.
//
// WHY THIS FILE EXISTS. These flags sit on the most safety-critical script in the repo: the one
// that can set active=false. A flag that widened the cohort, or that skipped the wrong branch,
// would be a mass-false-inactivation vector. So the two properties that make them safe are pinned
// here rather than left to review:
//
//   1. BOTH DEFAULT OFF. An existing caller that passes neither flag behaves exactly as before —
//      no workflow, cron or operator command changes meaning.
//   2. --only-struck is STRICTLY NARROWING. It ADDS `missing_count >= grace` to the cohort. It can
//      only ever examine FEWER rows, so it cannot produce a kill the default sweep would not also
//      have produced.
//   3. --report-only SUPPRESSES THE DEAD PATH ENTIRELY — no active=false, no missing_count write —
//      while leaving the ALIVE path intact. The alive path writes through the sanctioned
//      direct_alive_patch(), so report-only can move a row from UNKNOWN toward ALIVE and never
//      toward DEAD.
//   4. The cohort filter is applied to the COUNT probe, the OFFSET probes AND the keyset loop.
//      Applying it to only some of them would compute shard windows over one population and walk
//      them over another — bug B1's exact shape, which once gave shard 0 eighty-one percent of the
//      table.
//
//   node --experimental-strip-types scripts/verify-liveness-scoped-verification-flags.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'scrapers', 'aqar', 'liveness.py'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── 1. BOTH DEFAULT OFF — existing callers are untouched ─────────────────────────────────────────
check('#1 --only-struck exists and is a store_true flag (default off)',
  /add_argument\("--only-struck",\s*action="store_true"/.test(SRC));
check('#1 --report-only exists and is a store_true flag (default off)',
  /add_argument\("--report-only",\s*action="store_true"/.test(SRC));
check('#1 neither flag has a default that turns it on',
  !/add_argument\("--only-struck"[^)]*default\s*=\s*True/.test(SRC)
  && !/add_argument\("--report-only"[^)]*default\s*=\s*True/.test(SRC));

// ── 2. --only-struck is STRICTLY NARROWING ───────────────────────────────────────────────────────
// It must ADD a predicate to the cohort, never replace or relax `active = true`.
check('#2 the cohort helper still requires active = true unconditionally',
  /def _cohort\(q\):[\s\S]{0,200}?q\.eq\("active",\s*True\)/.test(SRC));
check('#2 --only-struck ADDS a missing_count >= grace predicate',
  /gte\("missing_count",\s*args\.grace\)\s*if\s*args\.only_struck/.test(SRC));
check('#2 it does not weaken the filter when the flag is off (returns the active-only query)',
  /return q\.gte\("missing_count", args\.grace\) if args\.only_struck else q/.test(SRC));

// ── 3. --report-only KILLS NOTHING ───────────────────────────────────────────────────────────────
const deadBranch = SRC.slice(SRC.indexOf('looks_dead(status, body)'),
                             SRC.indexOf('elif r is not None and status == 200'));
check('#3 the dead branch is guarded by report_only', /if args\.report_only:/.test(deadBranch));
{
  // Inside the report-only arm there must be NO write at all. Anchor the end on the OUTER else —
  // the one that opens the acting branch with `upd: dict` — not on the first `else:` found, which
  // belongs to the inner grace comparison and would truncate the arm before pending_kill.
  const armStart = deadBranch.indexOf('if args.report_only:');
  const armEnd = deadBranch.indexOf('upd: dict', armStart);
  const arm = deadBranch.slice(armStart, armEnd > 0 ? armEnd : undefined);
  check('#3 the report-only arm performs no update()', !/\.update\(/.test(arm));
  check('#3 the report-only arm never sets active=false', !/"active"\]?\s*[:=]\s*False/.test(arm));
  check('#3 the report-only arm still counts the verdict it would have reached',
    /killed \+= 1/.test(arm) && /pending_kill \+= 1/.test(arm));
}
check('#3 the ALIVE path is untouched and still uses the sanctioned contract helper',
  SRC.includes('direct_alive_patch(now_iso=now_iso)')
  && SRC.includes('from scrapers.common.liveness_contract import direct_alive_patch'));

// ── 4. COHORT CONSISTENCY — shard windows and the walk must see the same population ──────────────
const cohortUses = (SRC.match(/_cohort\(/g) || []).length;
check(`#4 the cohort filter is applied in all three places (count, offset probe, keyset loop) — found ${cohortUses}`,
  cohortUses >= 4); // 1 definition + 3 call sites
check('#4 no raw .eq("active", True) survives on the sweep queries (all go through _cohort)',
  (SRC.match(/\.eq\("active",\s*True\)/g) || []).length === 1); // only the one inside _cohort

// ── 5. MUTATION PROOF — the dangerous shapes must fail ───────────────────────────────────────────
{
  const widening = 'return q.gte("missing_count", 0) if args.only_struck else q';
  check('#5 a cohort that does not actually narrow fails contract #2',
    !/gte\("missing_count",\s*args\.grace\)\s*if/.test(widening));
  const killingReportOnly = 'if args.report_only:\n    upd["active"] = False\n    client.table(t).update(upd)';
  check('#5 a report-only arm that still writes fails contract #3',
    /\.update\(/.test(killingReportOnly));
}

// ── 6. Wired into the suite ──────────────────────────────────────────────────────────────────────
check('#6 this check is discovered by npm test',
  npmTestRuns(ROOT, 'verify-liveness-scoped-verification-flags'));

console.log(failed === 0
  ? '\n✓ scoped-verification flags are default-off, strictly narrowing, and cannot deactivate'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
