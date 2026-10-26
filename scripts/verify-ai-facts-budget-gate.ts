// THE AI FACTS READER CANNOT OUTSPEND ITS MONTH (owner 2026-10-26: «the max budget for the AI backend is 30 dollars
// monthly»). The paid teacher now runs nightly over new ads and once over the backlog, so the cap must be enforced where
// the money leaves — the facts-extract proxy — AND refused early by the script, AND read from ONE place (the
// ai_facts_budget row), with the spend measured from the cost log every run writes (listing_facts_runs, this calendar
// month). This check holds the four files to that contract offline; the migration proves the predicate at apply time.
//
//   node --experimental-strip-types scripts/verify-ai-facts-budget-gate.ts    (runs by existence)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const MIG = join(root, 'supabase', 'migrations');
const latest = (needle: string): string => {
  const f = readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort().filter((x) => readFileSync(join(MIG, x), 'utf8').includes(needle));
  return f.length ? readFileSync(join(MIG, f[f.length - 1]), 'utf8') : '';
};
const SQL = latest('function public.facts_ai_budget(');
const PY = readFileSync(join(root, 'scrapers', 'facts', 'extract.py'), 'utf8');
const PROXY = readFileSync(join(root, 'supabase', 'functions', 'facts-extract', 'index.ts'), 'utf8');
const WF = readFileSync(join(root, '.github', 'workflows', 'facts-extract.yml'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };

// ── the predicates, each a function of the text it judges ────────────────────────────────────────────
export const sqlGateReadsTheMonthLog = (s: string) =>
  /function public\.facts_ai_budget\(/.test(s)
  && /from public\.listing_facts_runs where at >= date_trunc\('month', now\(\)\)/.test(s)
  && /from public\.ai_facts_budget where id/.test(s)
  && /\+ coalesce\(p_estimate_usd, 0\) <= coalesce\(\(select month_usd_cap from b\), 0\)/.test(s);
export const sqlCapIsThirty = (s: string) => /values \(true, true, 30,/.test(s) && /month_usd_cap numeric\s+not null check \(month_usd_cap > 0\)/.test(s);
export const sqlProvesTheCapAtApply = (s: string) => /facts_ai_budget\(1000000\) ->> 'allow'\)::boolean then\s*\n\s*raise exception/.test(s);
export const sqlNightlyCron = (s: string) => /cron\.schedule\('gh-facts-ai-new', '40 7 \* \* \*', \$\$select public\.trigger_gh_workflow\('facts-extract\.yml'\)\$\$\)/.test(s);
export const pyAsksBeforeAnyCall = (p: string) =>
  /budget = client\.rpc\("facts_ai_budget", \{"p_estimate_usd": round\(args\.limit \* 0\.0001, 4\)\}\)/.test(p)
  && /if not budget\.get\("allow"\):\s*\n\s*print\("STOP: the monthly AI facts budget would be exceeded[^"]*"\)\s*\n\s*return 0/.test(p);
export const pyReasksDuringTheRun = (p: string) =>
  /if calls and calls % 25 == 0:[\s\S]{0,400}raise Stop\(f"monthly AI facts budget reached/.test(p);
export const proxyGatesThePaidCall = (x: string) =>
  /rest\/v1\/rpc\/facts_ai_budget/.test(x) && /if \(!b\.allow\) return \{ allow: false, reason: `monthly AI facts budget reached/.test(x)
  && /if \(!r2\.ok\) return \{ allow: false/.test(x);
export const wfDefaultsAreTheNightlyRun = (w: string) =>
  /mode:\s*\n\s*description:[^\n]*\n\s*required: false\s*\n\s*default: new/.test(w)
  && /--mode "\$MODE"/.test(w) && /MODE: \$\{\{ inputs\.mode \|\| 'new' \}\}/.test(w);

console.log('\nAI facts reader: one monthly cap, enforced at the paid call and refused early by the script\n');
check('the migration defining facts_ai_budget exists', SQL.length > 0);
check('facts_ai_budget measures THIS calendar month from listing_facts_runs and compares to the ai_facts_budget row', sqlGateReadsTheMonthLog(SQL));
check('the cap row is 30 USD and positive by CHECK', sqlCapIsThirty(SQL));
check('the migration proves at apply time that a spend past the cap is refused', sqlProvesTheCapAtApply(SQL));
check('the nightly dispatch exists (07:40 UTC, after the free reader)', sqlNightlyCron(SQL));
check('extract.py asks the budget before any paid call and exits cleanly on a refusal', pyAsksBeforeAnyCall(PY));
check('extract.py re-asks every 25 calls and stops the run when the month is spent', pyReasksDuringTheRun(PY));
check('the facts-extract proxy asks facts_ai_budget before the paid fetch and fails CLOSED', proxyGatesThePaidCall(PROXY));
check("the workflow's defaults are the nightly run (mode new; run id derived)", wfDefaultsAreTheNightlyRun(WF));

console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mut = 0;
const mustCatch = (label: string, caught: boolean) => { console.log(`  ${caught ? 'PASS  catches' : 'FAIL  BLIND to'}: ${label}`); if (!caught) mut++; };
mustCatch('a gate that measures all-time spend instead of this month',
  !sqlGateReadsTheMonthLog(SQL.replace("where at >= date_trunc('month', now())", '')));
mustCatch('the cap quietly raised in the seed row', !sqlCapIsThirty(SQL.replace('values (true, true, 30,', 'values (true, true, 300,')));
mustCatch('the script skipping the early budget ask', !pyAsksBeforeAnyCall(PY.replace('if not budget.get("allow"):', 'if False:')));
mustCatch('the script no longer re-asking mid-run', !pyReasksDuringTheRun(PY.replace('if calls and calls % 25 == 0:', 'if False:')));
mustCatch('the proxy failing OPEN on an unreachable budget gate', !proxyGatesThePaidCall(PROXY.replace('if (!r2.ok) return { allow: false', 'if (!r2.ok) return { allow: true')));
mustCatch('the nightly default flipped to the paid sample plan', !wfDefaultsAreTheNightlyRun(WF.replace('default: new', 'default: sample')));

if (mut) { console.error(`\n✗ ${mut} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failed) { console.error(`\n✗ ${failed} check(s) FAILED — the AI facts reader could outspend its month\n`); process.exit(1); }
console.log('\n✓ the AI facts reader is capped at one monthly budget, enforced at the paid call\n');
