// Regression guard for the AREA-ARTIFACT price fix (owner-authorized repair, 2026-08-10).
//
// Bug class: aqar's «سعر المتر 1» rial-per-meter gimmick makes the site render area×1 as the page
// price with NO seller-published total; the parser stored that figure as price_total, producing
// price_total == area_m2 (55-row incident; per-row source evidence in the audit). The fix
// (migration 20260810202219) adds a guard inside aqar_parse(): when parsed price EXACTLY equals
// parsed area, keep it ONLY if an explicit total label (السعر/المطلوب/قيمة) sits adjacent to that
// exact figure — a labeled coincidence (id 132677) is source-real and stays; otherwise NULL.
//
// THIS script pins that guard in the LAST committed aqar_parse definition (last-def-wins across
// supabase/migrations, same principle as verify-sub1000-buy-not-gated.ts) so a future migration
// can't silently drop it and reintroduce area-as-price. It also pins the companion barrier pieces.
//
//   node --experimental-strip-types scripts/verify-aqar-area-artifact-guard.ts   (in `npm test`)

import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const re = /create\s+or\s+replace\s+function\s+public\.aqar_parse\b[\s\S]*?\$function\$([\s\S]*?)\$function\$/gi;

let body = '';
let lastFile = '';
for (const f of files) {
  const sql = readFileSync(`${DIR}/${f}`, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) { body = m[1]; lastFile = f; }
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

check('aqar_parse is defined in a committed migration (repo == prod)', body.length > 0, lastFile);

// The guard's load-bearing pieces, all of which must survive in the LAST definition:
check('artifact guard: price==area equality trigger present', /v_price\s*=\s*v_area::bigint/.test(body));
check('artifact guard: explicit total-label requirement present', /السعر\|المطلوب\|قيمة/.test(body));
check('artifact guard: nulls the artifact price (never keeps it)', /v_price\s*:=\s*null;\s*v_orig\s*:=\s*null/.test(body));
check('rate-strip (2026-08-03) still present — per-meter rates are not totals',
  /سعر\\s\*\)\?المتر|المتر\[/.test(body) || body.includes('المتر['));

// Companion barrier: the detector + allowlist must exist in some committed migration.
const all = files.map((f) => readFileSync(`${DIR}/${f}`, 'utf8')).join('\n');
check('live detector mon_detect_price_eq_area_or_ppm committed', all.includes('mon_detect_price_eq_area_or_ppm'));
check('verified-coincidence allowlist table committed', all.includes('ops_price_eq_area_verified'));

console.log(failed === 0
  ? '\n✓ area/ppm-as-price artifact guard is pinned — the 55-row bug class cannot silently return'
  : `\n✗ ${failed} check(s) FAILED — the artifact guard is being weakened or dropped`);
process.exit(failed === 0 ? 0 : 1);
