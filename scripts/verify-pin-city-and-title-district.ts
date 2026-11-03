// THE AD'S OWN PIN AND TITLE DECIDE ITS CITY AND DISTRICT — and the safety rules that make that decision safe stay in
// the committed SQL (backlog 1166 / 1165, owner 2026-11-02: «fix the wrong city ones, make sure they ALL match»; «do
// they have it written in their title?»).
//
// Production barriers: mon_detect_city_pin_mismatch() (silent check → P2, unresolved title conflicts → P3) and
// mon_detect_title_district_unserved() (silent decider → P2, decided district not served → P3), both on the
// mon_run_all_detectors roster, plus the two cron jobs that repair first. This repo barrier pins the RULES those jobs run
// on, each proven by a mutation, so a later edit cannot quietly widen them:
//   city   — misfiled only when the pin is outside the city's governorate (1.5 km tolerance); corrected only when the
//            ad's own words name exactly one city of the pin's governorate; never when the title says «مدينة <our city>»;
//            a word after «حي» is never a city; region phrases never count; the district moves with the city;
//   district — «حي X» only when X is on the served city's official list, exactly one, and not the town's own name.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = new URL('../supabase/migrations/', import.meta.url).pathname;
let fails = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };
const mustCatch = (name: string, caught: boolean) => check(`mutation caught: ${name}`, caught);

const all = readdirSync(MIG).filter((f) => f.endsWith('.sql') && f >= '20261102182629').sort()
  .map((f) => readFileSync(join(MIG, f), 'utf8')).join('\n');

type Rule = [string, RegExp];
const CITY: Rule[] = [
  ['the pin must be outside the filed city\'s governorate, 1.5 km border tolerance', /st_dwithin\(g\.geom, p\.pt, 0\.015\)/],
  ['a correction needs the ad\'s own words to name a city of the PIN\'s governorate', /join _cg cg on cg\.gid = f\.gid/],
  ['only ONE named city (or exactly one seat among them) — never a pick', /where n_city = 1 or \(n_seat = 1 and basis = 'seat'\)/],
  ['a title saying «مدينة <our city>» keeps our city', /position\(' مدينه ' \|\| btrim\(regexp_replace\(normalize_ar\(f\.city_ar\)/],
  ['a word right after «حي» is a district, never a city', /regexp_replace\(t\.txt, ' حي \[ء-ي\]\+\(\?= \)', ' ', 'g'\)/],
  ['region phrases («منطقة مكة المكرمة» in URLs) never count', /'\(منطقه\|المنطقه\) ' \|\| v_region_rx/],
  ['the district moves with the corrected city (v2 reads the correction\'s district)', /CASE WHEN \(xcc\.city_source = ''pin_governorate''::text\) THEN/],
  ['the city check repairs on a schedule', /cron\.schedule\('pin-city-correction'/],
  ['its detector is on the roster', /needle \|\| E'\\n    ''mon_detect_city_pin_mismatch'','\)/],
];
const DISTRICT: Rule[] = [
  ['«حي X» must be on the served city\'s official list', /on d\.city_id = b\.city_id and d\.retired_at is null/],
  ['X is never the town\'s own name', /where d\.district_norm <> norm_district_tok\(b\.city_ar\)/],
  ['X is never the city the title names after «مدينة»', /position\(' مدينه ' \|\| regexp_replace\(d\.district_norm, '\^ال', ''\)/],
  ['exactly ONE district per title', /where \(select count\(\*\) from _hit h2 where h2\.source_table = h\.source_table and h2\.listing_id = h\.listing_id\) = 1/],
  ['served through the title arm AFTER every other arm, never over them', /'title'\s+from public\.listing_title_district t[\s\S]*?on conflict \(source_table, listing_id\) do nothing;/],
  ['a title district replaces only a source district that DISPLAYS as nothing (the town-name case), never one that shows',
    /and public\.loc_display_district_ar\(coalesce\(s\.city_id, v1\.city_id\), v1\.district_ar\) is null/],
  ['…and overrides an earlier recovery only when that one displays as nothing', /_drt\.district_ar\) is null;/],
  ['the location view serves a title recovery ahead of a hidden source value', /ELSE CASE WHEN \(dr\.basis = ''title''::text\) THEN dr\.district_ar/],
  ['a title district replaces a NAMED source district only when that is another town of the region (never a real neighbourhood)',
    /create or replace function public\.district_is_other_town[\s\S]*?c\.region_id = \(select c0\.region_id from public\.loc_catalog_city c0 where c0\.city_id = p_city_id\)/],
  ['…and the hourly arm uses that test, not a bare «off the list»', /or public\.district_is_other_town\(coalesce\(s\.city_id, v1\.city_id\), v1\.district_ar\)\)/],
  ['a removed title decision heals: ads served with a basis-\'title\' recovery are re-judged every run',
    /from public\.district_recovery dr[\s\S]{0,200}?where dr\.basis = 'title' and s\.production_ready/],
  ['the loss guard never freezes a whole site: it carries the would-be-lost districts forward and refreshes the rest',
    /p_table, v_lost, v_elig\)\);\s+insert into _drt \(source_table, listing_id, district_ar, resolved_at, verbatim, basis\)\s+select o\.source_table/],
  ['the decider runs hourly', /cron\.schedule\('title-district'/],
  ['its detector is on the roster', /needle \|\| E'\\n    ''mon_detect_title_district_unserved'','\)/],
];

const holds = (sql: string, rules: Rule[]) => rules.map(([, rx]) => rx.test(sql));
holds(all, CITY).forEach((ok, i) => check(`city: ${CITY[i][0]}`, ok));
holds(all, DISTRICT).forEach((ok, i) => check(`district: ${DISTRICT[i][0]}`, ok));

// each rule must catch its own removal
const cut = (sql: string, rx: RegExp) => sql.replace(new RegExp(rx.source, 'g'), '/*removed*/');
CITY.forEach(([name, rx], i) => mustCatch(`city rule dropped — ${name}`, !holds(cut(all, rx), CITY)[i]));
DISTRICT.forEach(([name, rx], i) => mustCatch(`district rule dropped — ${name}`, !holds(cut(all, rx), DISTRICT)[i]));

if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nverify-pin-city-and-title-district: OK');
