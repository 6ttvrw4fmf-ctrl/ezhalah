// Regression guard — an explicitly LABELED aqar total must beat a sub-floor document-order pick.
// Senior audit run #10, 2026-08-11.
//
// THE BUG THIS PINS
// -----------------
// aqar_parse() collects every currency-marked number in the page head and takes prices[1] — pure
// DOCUMENT ORDER. aqar renders an unlabeled currency chip in the page header that does NOT always
// carry the total, so for some ads the first number in the document is not the price:
//
//   id 7026223 / 7032586  «سعر المتر 2690 السعر: 11,000,000 ريال»  → stored 2,690
//        Two عمارة listings in المدينة المنورة, 2,091 m² and 2,000 m². An 11,000,000 SAR building
//        was served to users at 2,690 SAR — production_ready, live in search_listings_ar, matching
//        every cheap Buy filter. Detector mon_detect_aqar_ppm_as_total raised P1 alert 420 on these.
//   id 6962441 / 3897470  chip «950 §» / «680 §» beside «السعر: 950,000 ريال» / «السعر : 680,000﷼»
//        The chip is an ABBREVIATED thousands figure — exactly 1/1000 of the labeled total.
//   id 74567 / 74616 / 74619  «تكلفة المياه ... 7 ريال شهريًا» before «السعر: 720,000 ريال»
//        A monthly WATER BILL in the seller's prose became the price of a 720,000 SAR apartment.
//
// The 2026-08-03 per-meter strips do not catch these: they require the currency marker adjacent to
// «المتر», and these pages put the bare rate in the description while the CHIP carries the mark.
//
// THE RULE
// --------
// When the document-order pick lands UNDER 10,000 SAR — the band trg_aqar_parse already documents as
// "never a real SAR total ... an honest NULL beats a fabricated price" — and the same page states an
// explicit «السعر: N ريال» at or above that band, the labeled figure is the SOURCE'S OWN statement of
// the price and wins. Nothing is derived, estimated or rounded.
//
// WHAT MUST NOT REGRESS (the reason this file is strict about direction)
// ----------------------------------------------------------------------
// The rule is ONE-DIRECTIONAL and FLOOR-GATED. Measured over all 56,384 active aqar Buy rows on
// 2026-08-11, 348 carry a labeled value BELOW the header price — tax/net/rounding, e.g. header
// 1,250,025 against «السعر: 1,250,000 ريال صافي». There the header IS the authoritative structured
// price and the prose is the seller's round number, so "prefer the label" must NEVER become
// unconditional. If a future edit drops the `< 10000` floor or the `>= 10000` labeled minimum, those
// 348 rows start taking prose over structured data — the exact inversion migration 20260810184335
// fixed for furnished/floor_number. This guard fails the build on that.
//
// Deliberately OFFLINE (reads only the repo's own migration files — no DB, no network) to match the
// other verifiers chained in `npm test`. Replays the migration directory the way Postgres would:
// last definition of an object wins.
//
//   node --experimental-strip-types scripts/verify-aqar-labeled-total-beats-subfloor.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

/** Body of the LAST `CREATE OR REPLACE FUNCTION public.<name>` across all migrations. */
function lastBodyOf(name: string): string {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`,
    'gi',
  );
  let body = '';
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) body = m[1];
    re.lastIndex = 0;
  }
  return body;
}

console.log('verify-aqar-labeled-total-beats-subfloor: an explicit «السعر» total outranks a');
console.log('  sub-floor document-order pick — one-directionally, and only below the floor.\n');

const body = lastBodyOf('aqar_parse');
ok('aqar_parse is defined in a committed migration (repo == prod)', body.length > 0);
if (!body) process.exit(1);

// Strip line comments so prose in the rationale can never satisfy a check.
const code = body.replace(/--.*$/gm, '');

// (1) The rule exists at all: a labeled-total extraction keyed on «السعر» + a currency marker.
const labeledRe = /regexp_match\s*\(\s*head\s*,\s*'السعر[^']*'\s*\)/;
ok('extracts an explicitly labeled «السعر: N ريال» total from the page head', labeledRe.test(code));

// (2) It is FLOOR-GATED — only fires when the document-order pick is below the 10,000 SAR band.
const floorGuard = /v_price\s+is\s+not\s+null\s+and\s+v_price\s*<\s*10000/;
ok('only fires when the document-order pick is under the 10,000 SAR non-price band', floorGuard.test(code));

// (3) The labeled value must itself clear the floor — never swap one sub-floor number for another.
ok('requires the labeled total to be >= 10000 before it can win', /v\s*>=\s*10000/.test(code));

// (4) DIRECTION: the assignment must sit inside the floor-gated branch. Guard against a future edit
//     that hoists `v_price := v_labeled` out to the top level, where it would let a seller's rounded
//     prose figure overwrite a plausible structured price on all 348 labeled-lower rows.
const gatedBlock = code.match(
  /if\s+v_price\s+is\s+not\s+null\s+and\s+v_price\s*<\s*10000\s+then([\s\S]*?)end\s+if\s*;/,
);
ok('the labeled-total branch is present and closed', !!gatedBlock);
const assigns = [...code.matchAll(/v_price\s*:=\s*v_labeled/g)].length;
ok('v_price := v_labeled appears exactly once', assigns === 1, `found ${assigns}`);
ok(
  'v_price := v_labeled happens ONLY inside the floor-gated branch (never unconditional)',
  !!gatedBlock && /v_price\s*:=\s*v_labeled/.test(gatedBlock[1]),
);

// (5) The pre-existing guards this fix sits between must survive — the 2026-08-03 per-meter strips
//     and the 2026-08-10 area artifact guard. A full-body replace that drops either is the
//     documented recurring hazard (the mirror was found stale exactly this way on 2026-08-11).
ok('2026-08-03 per-meter strip still present (rate-qualified expressions removed from head)',
  /المتر\[\\s:\]\{0,6\}/.test(code) || /المتر\[\\s:\]/.test(code));
ok('2026-08-10 area-artifact guard still present (price == area needs an adjacent total label)',
  /v_price\s*=\s*v_area::bigint/.test(code) && /السعر\|المطلوب\|قيمة/.test(code));

// (6) The word-price fallback must still run BEFORE the labeled-total rule, so «510 الف» is already
//     resolved to 510000 and cannot be mistaken for a sub-floor pick needing rescue.
const iWord = code.indexOf('aqar_word_price');
const iLabeled = code.search(floorGuard);
ok('word-price fallback still runs before the labeled-total rule',
  iWord > -1 && iLabeled > -1 && iWord < iLabeled, `word@${iWord} labeled@${iLabeled}`);

console.log(
  failed === 0
    ? '\n✓ labeled-total rule intact: source-labeled totals win below the floor, prose never wins above it'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
