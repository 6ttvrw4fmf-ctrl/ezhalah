// Regression guard (2026-08-14) for the wasalt enum-liveness CONFIRM budget starving a table.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// The confirm cohort was filled table-by-table with a running remainder:
//
//     for tbl in TABLES:
//         need = args.confirm_limit - len(cohort)
//         if need <= 0: break
//         rows = ... .limit(need)
//
// so the FIRST table took every slot it could use and later tables got only the leftovers. That is
// invisible while the cap is slack, and silently permanent once it binds. Observed in production on
// 2026-08-14: the 01:35 run confirmed exactly 1489 dead + 11 control = 1500 = --confirm-limit, i.e.
// wasalt_residential_listings consumed the whole budget. The 22 struck wasalt_commercial_listings
// rows were never even fetched, so they could not be confirmed dead OR resurrected as live — they
// stayed active and production_ready, served to real users, and would keep doing so for as long as
// residential saturates the cap. The residential cohort has grown 356 → 952 → 1206 → 1489 across
// consecutive runs, so the cap now binds every run: this was a permanent starvation, not a one-day
// remainder. It surfaced as the served_after_source_gone P1 on both wasalt tables.
//
// WHAT THE FIX IS *NOT*: it does not raise --confirm-limit, and it does not weaken the grace,
// coverage, control or collapse guards. Draining that backlog faster is a bulk listing operation and
// an owner decision (AGENTS.md RED list). This only makes a FIXED budget fair, so no table can be
// starved indefinitely by another.
//
// This guard executes the REAL plan_confirm_budget() out of scrapers/wasalt/liveness.py (no network,
// no DB) and asserts the safety post-conditions, plus the production shape that regressed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-liveness-confirm-budget-fair');

// ── 1. The real function, executed ────────────────────────────────────────────────────────────
const py = `
import json, sys
sys.path.insert(0, '.')
import importlib.util
spec = importlib.util.spec_from_file_location('liveness_mod', 'scrapers/wasalt/liveness.py')
mod = importlib.util.module_from_spec(spec)
sys.modules['liveness_mod'] = mod
try:
    spec.loader.exec_module(mod)
except Exception:
    # The module imports db/network helpers at import time in some environments; fall back to
    # extracting just the pure planner so this guard never depends on scraper runtime deps.
    src = open('scrapers/wasalt/liveness.py').read()
    start = src.index('def plan_confirm_budget')
    end = src.index('\\ndef ', start + 1)
    ns = {}
    exec(src[start:end], ns)
    class M: pass
    mod = M(); mod.plan_confirm_budget = ns['plan_confirm_budget']
cases = [
    [[1689, 22], 1500],   # the production 2026-08-14 shape
    [[5000, 22], 1500],   # residential far over cap
    [[0, 22], 1500],      # only commercial has work
    [[10, 5], 1500],      # demand below cap
    [[1500, 1500], 1500], # both saturated
    [[3, 0], 1500],
    [[0, 0], 1500],
    [[100, 100], 0],
    [[7, 9, 11], 10],     # more than two tables
]
print(json.dumps([[c[0], c[1], mod.plan_confirm_budget(c[0], c[1])] for c in cases]))
`;
let results: [number[], number, number[]][] = [];
try {
  results = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }).trim());
} catch (e) {
  check('plan_confirm_budget is importable and runs', false, String(e).slice(0, 300));
  process.exit(1);
}

// ── 2. Safety post-conditions on every case ───────────────────────────────────────────────────
for (const [available, cap, take] of results) {
  const total = take.reduce((a, b) => a + b, 0);
  const want = Math.min(cap, available.reduce((a, b) => a + b, 0));
  check(
    `cap respected & demand met for available=[${available}] cap=${cap}`,
    total === want && take.every((t, i) => t <= available[i] && t >= 0),
    `granted=[${take}] total=${total} expected=${want}`,
  );
}

// ── 3. THE REGRESSION: the production shape must not starve the second table ───────────────────
const prod = results.find(([a, c]) => a[0] === 1689 && a[1] === 22 && c === 1500)!;
check(
  'production 2026-08-14 shape: commercial is NOT starved',
  prod[2][1] === 22,
  `commercial granted ${prod[2][1]} of 22 struck rows (old code granted 0)`,
);
check(
  'production 2026-08-14 shape: budget still exactly the cap',
  prod[2][0] + prod[2][1] === 1500,
  `granted [${prod[2]}]`,
);
const starved = results.find(([a, c]) => a[0] === 5000 && a[1] === 22 && c === 1500)!;
check(
  'a table demanding many times the cap still cannot starve the other',
  starved[2][1] === 22 && starved[2][0] + starved[2][1] === 1500,
  `granted [${starved[2]}]`,
);

// ── 4. The call site must actually use the planner (a pure function nothing calls is decoration) ─
const src = readFileSync('scrapers/wasalt/liveness.py', 'utf8');
check(
  'run_enum_strike() builds its cohort through plan_confirm_budget()',
  /take\s*=\s*plan_confirm_budget\(/.test(src),
  'cohort must be budgeted by the planner, not by a running remainder',
);
check(
  'the starving "need = confirm_limit - len(cohort)" loop is gone',
  !/need\s*=\s*args\.confirm_limit\s*-\s*len\(cohort\)/.test(src),
);
check(
  '--confirm-limit default is unchanged at 1500 (this fix must not raise the cap)',
  /"--confirm-limit",\s*type=int,\s*default=1500/.test(src),
);
for (const guard of ['coverage_ok', 'control_ok', '--grace']) {
  check(`safety guard ${guard} still present`, src.includes(guard));
}

console.log(failures === 0 ? '✅ PASS' : `❌ FAIL (${failures})`);
process.exit(failures === 0 ? 1 - 1 : 1);
