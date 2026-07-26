// Regression guard for the region_or_city Arabic-boundary bug (found live 2026-07-25, round-5
// filter/backend audit). JS \b is only defined relative to ASCII \w — it never matches Arabic script,
// so the old /\bمدينة\b/ and /\bمنطقة\b/ in supabase/functions/agent/index.ts's region_or_city branch
// could NEVER match any Arabic text, making the entire "does the user want just the city, or the whole
// region?" disambiguation permanently dead for every real Arabic-first user.
//
// This script: (a) asserts via source-text that the broken \b pattern is gone and the Unicode-aware
// boundary pattern is in place; (b) genuinely EXECUTES a verbatim copy of the new regex logic against
// real repro text AND the trap cases that make a naive .includes() fix wrong (a place name that
// CONTAINS one of these words fused with no space, e.g. «المدينة المنورة» contains «مدينة», «المنطقة
// الشرقية» contains «منطقة» — both must NOT match); (c) asserts regionPin (whose sole documented
// contract is "pin a TWIN CITY to one region") is never assigned inside region_or_city anymore — that
// reuse was the second, coupled defect: it silently narrowed a whole-region request down to the one
// city sharing the region's name, hiding every other city in it.
//
//   node --experimental-strip-types scripts/verify-region-or-city-arabic-boundary.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── source-text: the broken pattern is gone, the fixed pattern is in place ──
const src = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
const regionOrCityBlock = (() => {
  const start = src.indexOf('if (ck === "region_or_city")');
  const end = src.indexOf('} else if (ck === "twin_city")');
  return start >= 0 && end > start ? src.slice(start, end) : '';
})();
check('region_or_city branch found in the source', regionOrCityBlock.length > 0);
// Checks the actual CODE form (an assignment feeding .test(text)), not the explanatory comment above
// it, which deliberately quotes the old pattern to document why the fix was needed.
check('the old ASCII-\\b Arabic pattern is GONE as executable code (would never match Arabic — the original bug)', !/=\s*\/\\bمدينة\\b\/\.test/.test(regionOrCityBlock) && !/=\s*\/\\bمنطقة\\b\/\.test/.test(regionOrCityBlock));
check('wantsCity uses the Unicode-aware boundary pattern', /\(\?<!\[\\p\{L\}\\p\{N\}\]\)مدينة\(\?!\[\\p\{L\}\\p\{N\}\]\)\/u/.test(regionOrCityBlock));
check('wantsRegion uses the Unicode-aware boundary pattern', /\(\?<!\[\\p\{L\}\\p\{N\}\]\)منطقة\(\?!\[\\p\{L\}\\p\{N\}\]\)\/u/.test(regionOrCityBlock));
check('regionPin is NEVER assigned inside region_or_city anymore (its contract is twin_city-only; reusing it here was the second, coupled defect)', !/regionPin\s*=/.test(regionOrCityBlock));
check('the wantsRegion branch sets `location` to the region form instead', /if \(wantsRegion && !wantsCity\) location = `منطقة \$\{nm\}`;/.test(regionOrCityBlock));
check('the wantsCity branch sets `location` to the bare city name instead', /else if \(wantsCity && !wantsRegion\) location = nm;/.test(regionOrCityBlock));

// ── EXECUTED tests: verbatim copy of the fixed regex logic ──
const wantsCity = (text: string) => /(?<![\p{L}\p{N}])مدينة(?![\p{L}\p{N}])/u.test(text);
const wantsRegion = (text: string) => /(?<![\p{L}\p{N}])منطقة(?![\p{L}\p{N}])/u.test(text);

check("real repro (found live): 'أبغى فيلا للبيع في مدينة جازان بس' -> wantsCity ONLY (was permanently dead before the fix)", wantsCity('أبغى فيلا للبيع في مدينة جازان بس') && !wantsRegion('أبغى فيلا للبيع في مدينة جازان بس'));
check("bare 'منطقة تبوك كاملة' -> wantsRegion true", wantsRegion('منطقة تبوك كاملة'));
check("TRAP: 'المدينة المنورة' (Madinah — contains «مدينة» fused with «ال», no space) must NOT trigger wantsCity", !wantsCity('المدينة المنورة'));
check("TRAP: 'المنطقة الشرقية' (Eastern Province — contains «منطقة» fused with «ال», no space) must NOT trigger wantsRegion", !wantsRegion('المنطقة الشرقية'));
check("a message with neither word -> both false (falls through to the disambiguation question, unchanged)", !wantsCity('فيلا في جازان') && !wantsRegion('فيلا في جازان'));
check("old ASCII \\b sanity check (proves \\b itself works fine for ASCII — the bug is Arabic-specific, not a regex-engine issue)", /\bcat\b/.test('a cat sat') && !/\bمدينة\b/.test('مدينة'));

console.log(
  failed === 0
    ? '\n✓ region_or_city Arabic-boundary fix verified — city-only/region-only intent detection works, twin-name traps correctly excluded, regionPin no longer conflated with the whole-region case'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
