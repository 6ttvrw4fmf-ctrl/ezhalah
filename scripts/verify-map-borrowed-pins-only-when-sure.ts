// A LISTING WITH NO PIN BORROWS ITS TWIN'S PIN ONLY WHEN WE ARE SURE (owner 2026-11-09: «make it a rule»; «just match
// the ones that you are confident about — if something doesn't match, keep them on a side»). docs/ARCHITECTURE.md, Map tab.
//
// Reads the LATEST committed migration that defines map_pin_borrow_refresh_ar() and holds every certainty clause in place:
// licence matches stay inside one city; detail matches need zero disagreeing details, at least two agreeing ones and at
// most 10 look-alikes; every twin on ONE spot (≤ 0.0015°); default (shared office) pins never lend; and the map reads the
// borrowed pins (map_listing_points_ar) on an hourly schedule. Each clause is mutation-proven against the real file:
// dropping or loosening it turns this red. A SQL body cannot be executed offline; the live half is the map pin robot.
//
//   node --experimental-strip-types scripts/verify-map-borrowed-pins-only-when-sure.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? '.', '..');
const dir = join(root, 'supabase/migrations');
const file = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => /create or replace function public\.map_pin_borrow_refresh_ar\(/.test(readFileSync(join(dir, f), 'utf8')));

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };

const RULES: Array<[string, RegExp]> = [
  ['a licence match stays inside one city', /join pin p on p\.lic = np\.lic and p\.city_id = np\.city_id/],
  ['a detail match needs the same city, district, deal, type, size and bedrooms', /on p\.city_id = np\.city_id and p\.d = np\.d and p\.deal_ar = np\.deal_ar and p\.type_ar = np\.type_ar\s+and p\.a = np\.a and p\.b = np\.b/],
  ['…no disagreeing detail, at least two agreeing, at most 10 look-alikes', /where k <= 10 and conflicts = 0 and agrees >= 2/],
  ['…and every one of the seven details counts as a conflict when both ads state it and they differ',
    /\(np\.ba <> p\.ba\)[\s\S]*\(np\.lr <> p\.lr\)[\s\S]*\(np\.fl <> p\.fl\)[\s\S]*\(abs\(np\.ag - p\.ag\) > 1\)[\s\S]*\(np\.sw <> p\.sw\)[\s\S]*\(np\.dir <> p\.dir\)[\s\S]*\(np\.fc <> p\.fc\)[\s\S]*conflicts,/],
  ['every matching twin sits on ONE spot (≤ 0.0015°), else no pin', /having max\(la\) - min\(la\) <= 0\.0015 and max\(lo\) - min\(lo\) <= 0\.0015/],
  ['a shared default (office) pin never lends itself', /pin as materialized \([\s\S]*not exists \(select 1 from public\.ops_default_pin_register r/],
  ['only listings with no pin of their own borrow', /from public\.search_listings_ar x\s+where x\.latitude is null or x\.longitude is null/],
  ['the map reads own pins + borrowed pins', /create or replace view public\.map_listing_points_ar as[\s\S]*union all[\s\S]*from public\.map_pin_borrow b/],
  ['the borrowed list is rebuilt every hour (new listings follow the rule)', /cron\.schedule\('map-pin-borrow-refresh', '47 \* \* \* \*'/],
];
const problems = (sql: string) => RULES.filter(([, re]) => !re.test(sql)).map(([l]) => l);

check('a committed migration defines map_pin_borrow_refresh_ar()', !!file);
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
for (const [label, re] of RULES) check(label, re.test(sql));

// Mutations: loosening any certainty clause must be caught.
const MUT: Array<[string, string, string]> = [
  ['a licence match across cities', ' and p.city_id = np.city_id\n    where np.lic', '\n    where np.lic'],
  ['a detail match that tolerates one disagreeing detail', 'conflicts = 0', 'conflicts <= 1'],
  ['a detail match on one agreeing detail', 'agrees >= 2', 'agrees >= 1'],
  ['a detail match among 50 look-alikes', 'k <= 10', 'k <= 50'],
  ['twins in two places still lending a pin', 'max(la) - min(la) <= 0.0015', 'max(la) - min(la) <= 0.05'],
  ['street width no longer able to rule a twin out', ' + coalesce((np.sw <> p.sw)::int, 0)', ''],
  ['an office pin lending itself', "and not exists (select 1 from public.ops_default_pin_register r\n                       where r.source_table = x.source_table", "and true or exists (select 1 from public.ops_default_pin_register r\n                       where r.source_table = x.source_table"],
];
for (const [label, from, to] of MUT) {
  const m = sql.replace(from, to);
  check(`(mutation) catches ${label}`, m !== sql && problems(m).length > 0);
}

if (failed) { console.error(`\n❌ verify-map-borrowed-pins-only-when-sure: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-borrowed-pins-only-when-sure: a no-pin listing borrows a pin only when we are sure');
