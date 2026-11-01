// ALWAYS FAST: the web-bundle budget is real and actually runs (owner 2026-10-27).
//
// scripts/web-bundle-budget.mjs needs a built app, so it runs inside web-runtime-smoke.yml (a required check on every
// PR) right after the build. This hermetic half EXECUTES its decision on synthetic sizes and proves the workflow
// invokes it after `expo export` — so the budget cannot quietly stop running.
//   node --experimental-strip-types scripts/verify-web-bundle-budget-wired.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { bundleBudgetProblems, ENTRY_BUDGET_KB } = await import('./web-bundle-budget.mjs');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

check('a bundle at today\'s size passes', bundleBudgetProblems([{ name: 'entry-a.js', brotliKb: 972 }]).length === 0);
check('the budget sits above today (972 KB) and below the pre-fix size (1,208 KB)', ENTRY_BUDGET_KB > 972 && ENTRY_BUDGET_KB < 1208, String(ENTRY_BUDGET_KB));
mustCatch('the pre-fix bundle (native Sentry back in: 1,208 KB)', bundleBudgetProblems([{ name: 'entry-a.js', brotliKb: 1208 }]).length > 0);
mustCatch('a build that produced no entry at all (never a silent pass)', bundleBudgetProblems([]).length > 0);

const wf = readFileSync(join(root, '.github/workflows/web-runtime-smoke.yml'), 'utf8');
const wired = (w: string) => { const e = w.indexOf('npx expo export --platform web'); const b = w.indexOf('node scripts/web-bundle-budget.mjs'); return e > 0 && b > e; };
check('web-runtime-smoke.yml runs the budget right after building the app', wired(wf));
mustCatch('the budget step removed from the workflow', !wired(wf.replace('node scripts/web-bundle-budget.mjs', 'true')));

if (failed) { console.error(`\n❌ verify-web-bundle-budget-wired: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-web-bundle-budget-wired: the web bundle has a size budget, and every PR build checks it.');
