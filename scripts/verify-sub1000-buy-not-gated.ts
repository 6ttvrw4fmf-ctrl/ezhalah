// Regression guard for Q1 (owner 2026-08-09, SOURCE-OF-TRUTH KEEP): a sub-1000 Buy price is
// source-published and must stay searchable at ANY magnitude — no hiding source-published prices.
// search_row_price_gated() was an interim "hide Buy 1..999 SAR" gate, now neutralised to a no-op.
// This reconstructs the LAST committed definition of the function across migrations (last-def-wins,
// same principle as verify-rpc-clause-invariants.ts) and FAILS if it ever re-introduces a price
// predicate — so a future migration can't silently start hiding sub-1000 (or any) source-published price.
//
//   node --experimental-strip-types scripts/verify-sub1000-buy-not-gated.ts   (wired into `npm test`)

import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort(); // YYYYMMDDHHMMSS_* → chronological
const re = /create\s+or\s+replace\s+function\s+public\.search_row_price_gated\b[\s\S]*?\$function\$([\s\S]*?)\$function\$/gi;

let body = '';
for (const f of files) {
  const sql = readFileSync(`${DIR}/${f}`, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) body = m[1]; // keep the last occurrence overall
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

check('search_row_price_gated is defined in a committed migration (repo == prod)', body.length > 0);

const code = body.replace(/--.*$/gm, '').trim(); // strip line comments, keep the real SQL
const hidesPrice = /\bp?_?price_total\s*<\s*\d/i.test(code);
const neutral = /\bselect\s+false\b/i.test(code);

check('search_row_price_gated does NOT re-introduce a price hide predicate (< N)', !hidesPrice, code.slice(0, 90));
check('search_row_price_gated is neutralised (returns false — never hides a source-published price)', neutral, code.slice(0, 90));

console.log(failed === 0
  ? '\n✓ sub-1000 (and any) source-published Buy price is never gated — SOURCE-OF-TRUTH KEEP holds'
  : `\n✗ ${failed} check(s) FAILED — a price gate is being re-introduced`);
process.exit(failed === 0 ? 0 : 1);
