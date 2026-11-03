// ALWAYS FAST: THE WEB APP'S DOWNLOAD STAYS UNDER BUDGET (owner 2026-10-27: «always keep it fast»).
//
// Run by .github/workflows/web-runtime-smoke.yml right after `npx expo export --platform web` (the build every PR
// already makes). Measured 2026-10-27: the entry bundle was 1,208 KB brotli; leaving the native Sentry SDK out of the
// web build brought it to ~972 KB. The budget below leaves room for normal growth and fails a change that adds a big
// library to the first download. Raising it is a deliberate, reviewed edit — first ask whether the new code can load
// later (lazy) instead.
//
// WHAT IS MEASURED IS THE FIRST DOWNLOAD, NOT ONE FILE (2026-11-02). With code splitting (expo-router async routes on
// web, or any `import()`), Expo writes the shared modules to `__common-<hash>.js` and the page loads it SYNCHRONOUSLY
// next to `entry-<hash>.js`. Measuring the entry alone then reads 221 KB while the visitor downloads ~900 KB — a
// budget that cannot see most of the download is no budget. So the CLI sums every script the exported index.html
// loads with a plain <script src> (the runtime, __common, the entry, the layout and index route chunks), and only when
// the HTML names none does it fall back to the entry files on disk. A route chunk loaded later (map, agent) is not
// in the first download and is not counted.
//   node scripts/web-bundle-budget.mjs [dist]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';

export const ENTRY_BUDGET_KB = 1_100;

/** Problems for a set of measured downloads (name → brotli KB); [] when within budget. */
export function bundleBudgetProblems(entries, budgetKb = ENTRY_BUDGET_KB) {
  if (!entries.length) return ['no web entry bundle found — the build did not produce one (never a silent pass)'];
  return entries.filter((e) => e.brotliKb > budgetKb)
    .map((e) => `${e.name} is ${e.brotliKb} KB brotli, over the ${budgetKb} KB budget — load the new code later (lazy) or trim it`);
}

/** Every script the exported page loads by src, in order ("/_expo/static/js/web/x.js" → "_expo/static/js/web/x.js").
 *  Expo marks them all `defer`; defer and async scripts still download with the page, so all of them count. */
export function firstDownloadScripts(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="\/?([^"]+\.js)"[^>]*>/g)].map((m) => m[1]);
}

/** One measured row for the whole first download: the sum of the given files' brotli sizes. */
export function firstDownloadEntry(files) {
  const parts = files.map((f) => ({ name: f.name, brotliKb: Math.round(brotliCompressSync(f.bytes).length / 1024) }));
  return { name: `first download (${parts.map((p) => `${p.name} ${p.brotliKb} KB`).join(' + ')})`, brotliKb: parts.reduce((a, p) => a + p.brotliKb, 0), parts };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/web-bundle-budget.mjs')) {
  const dist = process.argv[2] || 'dist';
  let html = '';
  try { html = readFileSync(join(dist, 'index.html'), 'utf8'); } catch { /* fall back to the entry files below */ }
  let scripts = firstDownloadScripts(html);
  if (!scripts.length) {
    const dir = '_expo/static/js/web';
    try { scripts = readdirSync(join(dist, dir)).filter((f) => /^entry-.*\.js$/.test(f)).map((f) => `${dir}/${f}`); } catch { /* reported below */ }
  }
  const entries = [];
  if (scripts.length) {
    const first = firstDownloadEntry(scripts.map((s) => ({ name: s.replace(/^.*\//, ''), bytes: readFileSync(join(dist, s)) })));
    for (const p of first.parts) console.log(`  ${p.name}: ${p.brotliKb} KB brotli`);
    console.log(`web first download: ${first.brotliKb} KB brotli over ${first.parts.length} file(s) (budget ${ENTRY_BUDGET_KB} KB)`);
    entries.push(first);
  }
  const problems = bundleBudgetProblems(entries);
  if (problems.length) { for (const p of problems) console.error(`❌ ${p}`); process.exit(1); }
  console.log('✅ web bundle within the speed budget.');
}
