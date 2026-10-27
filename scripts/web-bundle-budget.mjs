// ALWAYS FAST: THE WEB APP'S DOWNLOAD STAYS UNDER BUDGET (owner 2026-10-27: «always keep it fast»).
//
// Run by .github/workflows/web-runtime-smoke.yml right after `npx expo export --platform web` (the build every PR
// already makes). Measured 2026-10-27: the entry bundle was 1,208 KB brotli; leaving the native Sentry SDK out of the
// web build brought it to ~972 KB. The budget below leaves room for normal growth and fails a change that adds a big
// library to the first download. Raising it is a deliberate, reviewed edit — first ask whether the new code can load
// later (lazy) instead.
//   node scripts/web-bundle-budget.mjs [dist]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';

export const ENTRY_BUDGET_KB = 1_100;

/** Problems for a set of web entry bundles (name → bytes); [] when within budget. */
export function bundleBudgetProblems(entries, budgetKb = ENTRY_BUDGET_KB) {
  if (!entries.length) return ['no web entry bundle found — the build did not produce one (never a silent pass)'];
  return entries.filter((e) => e.brotliKb > budgetKb)
    .map((e) => `${e.name} is ${e.brotliKb} KB brotli, over the ${budgetKb} KB budget — load the new code later (lazy) or trim it`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/web-bundle-budget.mjs')) {
  const dist = process.argv[2] || 'dist';
  const dir = join(dist, '_expo/static/js/web');
  let files = [];
  try { files = readdirSync(dir).filter((f) => /^entry-.*\.js$/.test(f)); } catch { /* reported below */ }
  const entries = files.map((f) => ({ name: f, brotliKb: Math.round(brotliCompressSync(readFileSync(join(dir, f))).length / 1024) }));
  for (const e of entries) console.log(`web entry ${e.name}: ${e.brotliKb} KB brotli (budget ${ENTRY_BUDGET_KB} KB)`);
  const problems = bundleBudgetProblems(entries);
  if (problems.length) { for (const p of problems) console.error(`❌ ${p}`); process.exit(1); }
  console.log('✅ web bundle within the speed budget.');
}
