// Barrier — catalogue, bridge and served location names carry no doubled, leading or trailing whitespace (owner
// 2026-10-19; migrations 20261019035034 + 20261019035156). The catalogue spelled «حي  السبهاني» and five cards served it.
//
// Replays the effective bodies from the migrations (definitions AND needle edits) and checks:
//   - squash_ws() trims and collapses every whitespace run;
//   - trg_squash_ws exists on all four tables (the last migration touching each trigger creates it);
//   - the detector's row source reads has_irregular_ws() on every surface, and the detector is rostered.
// Mutants below prove each check can fail.
//
// Run: node --experimental-strip-types scripts/verify-location-names-regular-whitespace.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, codeOnly, replayFunction } from './lib/rpcReplay.ts';

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};
const mustCatch = (what: string, caught: boolean) => ok(`(mutation) catches ${what}`, caught);

const TABLES = ['loc_catalog_city', 'loc_catalog_district', 'listings_arabic_locations', 'search_listings_ar'];
const SURFACES = [
  "from public.loc_catalog_city where public.has_irregular_ws(city_ar)",
  "from public.loc_catalog_district where public.has_irregular_ws(district_ar)",
  "from public.listings_arabic_locations\n   where public.has_irregular_ws(city_ar) or public.has_irregular_ws(district_ar)",
  "from public.search_listings_ar\n   where public.has_irregular_ws(city_ar) or public.has_irregular_ws(district_ar)",
];

function squashProblems(b: string): string[] {
  return /regexp_replace\(regexp_replace\(v, '\^\\s\+\|\\s\+\$', '', 'g'\), '\\s\+', ' ', 'g'\)/.test(codeOnly(b))
    ? [] : ['squash_ws() no longer trims and collapses every whitespace run'];
}
function predicateProblems(b: string): string[] {
  const c = codeOnly(b);
  const need = ["v like '%  %'", "v like ' %'", "v like '% '", "strpos(v, E'\\t') > 0", "strpos(v, E'\\n') > 0", "strpos(v, E'\\r') > 0"];
  return need.filter((n) => !c.includes(n)).map((n) => `has_irregular_ws() lost «${n}»`);
}
function rowsProblems(b: string): string[] {
  const c = codeOnly(b);
  return SURFACES.filter((s) => !c.includes(s)).map((s) => `the detector no longer reads «${s.split('\n')[0]}»`);
}
function triggerProblems(sqls: string[]): string[] {
  const fail: string[] = [];
  for (const t of TABLES) {
    const re = new RegExp(`(create\\s+trigger\\s+trg_squash_ws\\s+before\\s+insert\\s+or\\s+update\\s+of\\s+[a-z_, ]+\\s+on\\s+public\\.${t}\\b|drop\\s+trigger\\s+(if\\s+exists\\s+)?trg_squash_ws\\s+on\\s+public\\.${t}\\b|alter\\s+table\\s+public\\.${t}\\s+disable\\s+trigger\\s+trg_squash_ws)`, 'gi');
    let last = '';
    for (const s of sqls) for (const m of s.matchAll(re)) last = m[0].toLowerCase();
    if (!last.startsWith('create')) fail.push(`trg_squash_ws on ${t} is not standing (last statement: «${last || 'none'}»)`);
  }
  return fail;
}

// Executed SQL only, oldest first; a rolled-back proof's «drop trigger» lives inside a DO block, so DO bodies are cut.
const sqls = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/do\s+\$(\w*)\$[\s\S]*?\$\1\$/gi, ''));

const squash = replayFunction(MIGRATIONS_DIR, 'squash_ws');
const pred = replayFunction(MIGRATIONS_DIR, 'has_irregular_ws');
const rows = replayFunction(MIGRATIONS_DIR, 'location_whitespace_irregular_rows');
for (const r of [squash, pred, rows]) ok(`every migration touching ${r.fn}() was interpretable`, r.unresolved.length === 0, r.unresolved.join(', '));
ok('squash_ws() trims and collapses', squashProblems(squash.body ?? '').length === 0, squashProblems(squash.body ?? '').join('; '));
ok('has_irregular_ws() asks every case', predicateProblems(pred.body ?? '').length === 0, predicateProblems(pred.body ?? '').join('; '));
ok('the detector reads all four surfaces', rowsProblems(rows.body ?? '').length === 0, rowsProblems(rows.body ?? '').join('; '));
ok('trg_squash_ws stands on all four tables', triggerProblems(sqls).length === 0, triggerProblems(sqls).join('; '));
const rostered = readdirSync(MIGRATIONS_DIR).some((f) =>
  /'''mon_detect_location_whitespace_irregular'', ' \|\| anchor/.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));
ok('the detector is rostered in mon_run_all_detectors', rostered);

const s = squash.body ?? '', p = pred.body ?? '', r = rows.body ?? '';
mustCatch('a squash that only trims', squashProblems(s.replace(", '\\s+', ' ', 'g')", ", ' ', ' ', 'g')")).length > 0);
mustCatch('a predicate blind to tabs', predicateProblems(p.replace("strpos(v, E'\\t') > 0", "false")).length > 0);
mustCatch('a predicate blind to a trailing space', predicateProblems(p.replace("v like '% '", "false")).length > 0);
mustCatch('a detector that skips the index', rowsProblems(r.replace('from public.search_listings_ar', 'from public.search_listings_ar limit 0 --')).length > 0);
mustCatch('a later migration dropping the index trigger', triggerProblems([...sqls, 'drop trigger trg_squash_ws on public.search_listings_ar;']).length > 0);
mustCatch('a later migration disabling the catalogue trigger', triggerProblems([...sqls, 'alter table public.loc_catalog_district disable trigger trg_squash_ws;']).length > 0);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-location-names-regular-whitespace: OK');
