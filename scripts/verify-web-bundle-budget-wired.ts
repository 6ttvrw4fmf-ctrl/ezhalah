// ALWAYS FAST: the web-bundle budget is real and actually runs (owner 2026-10-27).
//
// scripts/web-bundle-budget.mjs needs a built app, so it runs inside web-runtime-smoke.yml (a required check on every
// PR) right after the build. This hermetic half EXECUTES its decision on synthetic sizes and proves the workflow
// invokes it after `expo export` — so the budget cannot quietly stop running.
//   node --experimental-strip-types scripts/verify-web-bundle-budget-wired.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { bundleBudgetProblems, ENTRY_BUDGET_KB, firstDownloadScripts, firstDownloadEntry } = await import('./web-bundle-budget.mjs');
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

// THE FIRST DOWNLOAD, NOT ONE FILE (2026-11-02): a split build loads __common next to the entry; the budget must see both.
const html = '<html><head><script src="/_expo/static/js/web/__expo-metro-runtime-1f8f.js" defer></script>'
  + '<script src="/_expo/static/js/web/__common-abcd.js"></script><script src="/_expo/static/js/web/entry-ef01.js"></script>'
  + '<script async src="/_expo/static/js/web/later-2222.js"></script><script type="module" src="/_expo/static/js/web/mod-3333.js"></script></head></html>';
check('every script the exported page loads by src is measured, in order (Expo marks them all defer; defer and async still download with the page)',
  JSON.stringify(firstDownloadScripts(html)) === JSON.stringify(['_expo/static/js/web/__expo-metro-runtime-1f8f.js', '_expo/static/js/web/__common-abcd.js', '_expo/static/js/web/entry-ef01.js', '_expo/static/js/web/later-2222.js', '_expo/static/js/web/mod-3333.js']));
mustCatch('a parser that only sees the entry file (the blind spot of 2026-11-02: 221 KB read while ~900 KB downloaded)', firstDownloadScripts(html).some((s) => /__common-/.test(s)));
check('a page naming no script yields none (the CLI then falls back to the entry files, never a silent pass)', firstDownloadScripts('<html></html>').length === 0);
const big = randomBytes(900_000);  // incompressible: ~879 KB brotli
const small = Buffer.from('globalThis.x=1;'.repeat(2000));
const sum = firstDownloadEntry([{ name: '__common-a.js', bytes: big }, { name: 'entry-b.js', bytes: small }]);
check('the first download is the SUM of its files\' brotli sizes', sum.parts.length === 2 && sum.brotliKb === sum.parts[0].brotliKb + sum.parts[1].brotliKb && sum.brotliKb > 800);
mustCatch('a split build whose entry is small but whose __common pushes the first download over budget', bundleBudgetProblems([firstDownloadEntry([{ name: '__common-a.js', bytes: randomBytes(1_800_000) }, { name: 'entry-b.js', bytes: small }])]).length > 0);
check('the same split build within budget passes', bundleBudgetProblems([{ name: 'first download', brotliKb: 221 + 589 + 80 + 30 }]).length === 0);

if (failed) { console.error(`\n❌ verify-web-bundle-budget-wired: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-web-bundle-budget-wired: the web bundle has a size budget, and every PR build checks it.');
