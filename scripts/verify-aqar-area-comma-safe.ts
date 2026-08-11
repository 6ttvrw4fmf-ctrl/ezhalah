// Regression guard — a thousands separator must never truncate an aqar area.
// Senior audit run #10 P1 sweep, 2026-08-11.
//
// THE BUG THIS PINS
// -----------------
// 114 active aqar listings carry an area between 1 and 10 m² alongside a multi-million-riyal price,
// which is what made them trip the field_integrity `extreme_magnitude` barrier (>2,000,000 SAR/m²).
// The price was never the problem — the AREA was truncated at its thousands comma:
//
//     id 22531  source text: «بمساحة اجمالية 2,496.4 م²» + «سعر البيع: 4,500,000 ريال»
//               stored:      area_m2 = 2          <- "2,496.4" cut at the comma
//     id 13975  source text: «الارض مساحة : 6250 متر»      stored: area_m2 = 6
//     id 60644  source text: «مساحة الأرض 2544.19 متر»     stored: area_m2 = 2
//
// The stored value is exactly floor(real_area / 1000) — the leading group of the comma-formatted
// number — which is how the repair could be corroborated per row rather than guessed. 19 rows were
// repaired on that proof (migration 20260811_aqar_area_comma_truncation_repair); the rest state no
// area in their own capture and were deliberately left alone.
//
// These rows all carry the June `backfill.v1` stub capture, whose missing «تفاصيل الإعلان» block
// means aqar_parse's structured area lookup returns NULL and the bad incoming value survives via
// `coalesce`. The live parser is comma-safe today — this guard is what keeps it that way, because
// the failure is silent: a truncated area produces a plausible-looking small number, not an error.
//
// WHAT MUST NOT REGRESS
//   * the area capture must keep commas IN the matched token (`\d[\d,]*`), or "2,496" matches as "2";
//   * the captured token must be comma-STRIPPED before the numeric cast, or the cast truncates;
//   * the plausibility gate must stay, so a phone/ID after «المساحة» still cannot become an area.
//
// Deliberately OFFLINE (reads only the repo's own migration files — no DB, no network).
//   node --experimental-strip-types scripts/verify-aqar-area-comma-safe.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

console.log('verify-aqar-area-comma-safe: a thousands comma must never truncate an area.\n');

// Last definition wins, same replay principle as the sibling verifiers.
let body = '';
const re =
  /create\s+or\s+replace\s+function\s+public\.aqar_parse\b[\s\S]*?\$function\$([\s\S]*?)\$function\$/gi;
for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) body = m[1];
  re.lastIndex = 0;
}
ok('aqar_parse is defined in a committed migration (repo == prod)', body.length > 0);
if (!body) process.exit(1);

// Isolate the area assignment: `v_area := ( ... );`
const areaBlock = body.match(/v_area\s*:=\s*\(([\s\S]*?)\n\s*\);/);
ok('the v_area assignment block is present', !!areaBlock);
const area = (areaBlock?.[1] ?? '').replace(/--.*$/gm, '');

// (1) commas must be inside the captured token, or the match stops at the first comma.
ok('the area capture keeps commas in the matched token (\\d[\\d,]*)',
  /'\\d\[\\d,\]\*'/.test(area) || /\\d\[\\d,\]\*/.test(area),
  area.slice(0, 120));

// (2) …and must be stripped before the numeric cast, or the cast itself truncates.
const strips = /regexp_replace\s*\([\s\S]*?,\s*','\s*,\s*''\s*,\s*'g'\s*\)/.test(area);
ok('the captured area is comma-stripped before the ::numeric cast', strips);

// (3) order matters: the strip has to happen inside the expression that is cast.
ok('the comma strip precedes the numeric cast in the same expression',
  strips && area.indexOf('regexp_replace') < area.lastIndexOf('::numeric'));

// (4) the 2026-07-28 plausibility gate must survive — a phone/ID after «المساحة» is not an area.
ok('the area plausibility gate is still present (1 .. 10,000,000)',
  /v\s*>=\s*1\s+and\s+v\s*<=\s*10000000/.test(area));

// (5) the structured-block anchor must still exclude «المساحة حسب الصك» (deed area is a different
//     field); without the negative lookahead the deed area silently becomes the listing area.
ok('the area anchor still excludes «المساحة حسب الصك»',
  /المساحة\(\?!\\s\*حسب\)/.test(area) || /المساحة\(\?!/.test(area));

console.log(
  failed === 0
    ? '\n✓ aqar area extraction is comma-safe — "2,496.4 م²" cannot become 2'
    : `\n✗ ${failed} check(s) FAILED — an area could be truncated at its thousands separator`,
);
process.exit(failed === 0 ? 0 : 1);
