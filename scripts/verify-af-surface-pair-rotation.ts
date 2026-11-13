// The AF region sweep's multi-type pair stage is BUDGETED and ROTATED, so the job finishes and every pair is still covered
// across days (🦅 2026-11-13).
//
// af-live-truth-check run 43424461595: stage 1 took 65 min, then 182 pairs ran for 84 min (0 failures) and the job was
// CANCELLED at its 150-min cap mid-pair — the combined Buy∪Rent and both-period stages never ran, on any day, and the
// whole robot read «cancelled». This guard EXECUTES the real rotationOffset()/pairBudgetSpent() lifted from
// verify-af-full-surface-differential.ts (importing that file would run the live sweep) and pins the workflow's budget.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'scripts', 'verify-af-full-surface-differential.ts');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed++;
};
const mutation = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

const m = await liftSymbols(SRC, [
  { header: 'export function rotationOffset(' },
  { header: 'export const pairBudgetSpent', endsWith: /;\s*$/ },
], ['rotationOffset', 'pairBudgetSpent']);
const rotationOffset = m.rotationOffset as (n: number, day: number) => number;
const pairBudgetSpent = m.pairBudgetSpent as (start: number, budgetMs: number, now: number) => boolean;

/** Over n consecutive days the start offset visits every pair index — no pair is starved forever. */
const coversAll = (rot: (n: number, d: number) => number, n: number) => {
  const seen = new Set<number>();
  for (let d = 20_000; d < 20_000 + n; d++) seen.add(rot(n, d));
  return seen.size === n;
};
for (const n of [1, 2, 37, 74, 182, 250, 333]) check(`rotation visits every offset across ${n} days (n=${n})`, coversAll(rotationOffset, n));
check('rotation is stable within one day (re-runs start at the same pair)', rotationOffset(182, 20_405) === rotationOffset(182, 20_405));
check('budget 0 never stops a local run', !pairBudgetSpent(0, 0, 10 ** 12));
check('the budget stops the stage once spent', pairBudgetSpent(0, 40 * 60_000, 40 * 60_000));
check('…and not one millisecond before', !pairBudgetSpent(0, 40 * 60_000, 40 * 60_000 - 1));

// Mutations: a fixed start (the old exhaustive walk) and a stride sharing a factor with n starve pairs.
mutation('a fixed start offset is caught', !coversAll(() => 0, 182));
mutation('a stride that shares a factor with n (2 for n=182) is caught', !coversAll((n, d) => (d * 2) % n, 182));
const stopsWhenSpent = (f: (s: number, b: number, n: number) => boolean) => f(0, 40 * 60_000, 41 * 60_000) && !f(0, 0, 41 * 60_000);
mutation('a budget that never stops is caught', stopsWhenSpent(pairBudgetSpent) && !stopsWhenSpent(() => false));
mutation('a «budget» that stops even unbudgeted local runs is caught', !stopsWhenSpent(() => true));

// The workflow must actually set the budget, below the job's own cap.
const wf = readFileSync(join(ROOT, '.github', 'workflows', 'af-live-truth-check.yml'), 'utf8');
const job = wf.slice(wf.indexOf('  af-surface-region:'), wf.indexOf('  af-surface-city:'));
const budget = Number(/AF_FSD_PAIR_BUDGET_MIN:\s*['"]?(\d+)/.exec(job)?.[1] ?? NaN);
const cap = Number(/timeout-minutes:\s*(\d+)/.exec(job)?.[1] ?? NaN);
check('af-surface-region sets AF_FSD_PAIR_BUDGET_MIN', Number.isFinite(budget) && budget > 0, `budget=${budget}`);
check('…and stage 1 (65 min measured) + the pair budget leaves ≥ 30 min of the job cap for the later stages',
  Number.isFinite(cap) && 65 + budget + 30 <= cap, `65 + ${budget} + 30 vs cap ${cap}`);

console.log(failed === 0 ? '\n✓ the pair stage is budgeted and rotated; the region sweep can finish' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
