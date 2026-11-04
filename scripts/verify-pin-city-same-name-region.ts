// A SAME-NAME TOWN IN THE PIN'S REGION IS A PIN-CITY CANDIDATE — and only under its four safety conditions
// (alert 12259 phasea_offregion_pick, تربه حائل 2372, 2026-11-04).
//
// «تربه» is a town in منطقة مكة المكرمة (2156) and in منطقة حائل (2372). aqar files every «تربه» ad under its crawl
// facet «Turabah, Makkah», wasalt resolves «تربة» by name alone, and refresh_pin_city_correction() called the 36 ads
// whose own pin is at 28.25 N 42.93 E «unfixable»: the title «مدينة تربة» names OUR city (so it kept it), and 2372 had
// too few homes to own a governorate. The new arm takes the ONE same-name live city in the pin's region.
//
// WHAT THIS PINS, each rule proven by deleting it (it must then go RED):
//   1. the arm exists and its candidate has the filed city's own name, in the PIN's region;
//   2. only when the filed city is in ANOTHER region (a same-region pair is never this arm's business);
//   3. only when that region holds EXACTLY ONE live city of the name (never a pick between two);
//   4. never when the ad's own words name a DIFFERENT city after «مدينة» (aqar's «مدينة الخوير» ads stay unfixed);
//   5. retired cities are never candidates.
//
//   node --experimental-strip-types scripts/verify-pin-city-same-name-region.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname, '..', 'supabase', 'migrations');
let fail = 0;
const check = (name: string, ok: boolean) => { if (!ok) { console.log(`FAIL  ${name}`); fail++; } };

type Rule = [string, RegExp];
export const RULES: Rule[] = [
  ['the same-name arm exists', /'same_name_pin_region'::text/],
  ['candidate = the filed city\'s own name, in the PIN\'s region',
    /join public\.loc_catalog_city c on c\.city_norm = oc\.city_norm and c\.region_id = g\.region_id/],
  ['retired cities are never candidates', /and c\.city_id <> f\.city_id and c\.retired_at is null/],
  ['the filed city is in another region', /where g\.region_id <> oc\.region_id/],
  ['exactly one live city of that name in the pin\'s region',
    /where c3\.city_norm = oc\.city_norm and c3\.region_id = g\.region_id and c3\.retired_at is null\) = 1/],
  ['the ad\'s words name no OTHER city after «مدينة»',
    /and \(t\.txt !~ ' مدينه \[ء-ي\]'\s+or position\(' مدينه ' \|\| regexp_replace\(oc\.city_norm, '\[\^ء-ي\]\+', ' ', 'g'\) \|\| ' ' in t\.txt\) > 0\)/],
  ['_pick still demands a single candidate', /where n_city = 1 or \(n_seat = 1 and basis = 'seat'\)/],
];

export const holds = (sql: string) => RULES.map(([, rx]) => rx.test(sql));

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const touching = files.filter((f) => /refresh_pin_city_correction/.test(readFileSync(join(MIG, f), 'utf8')));
const all = touching.map((f) => readFileSync(join(MIG, f), 'utf8')).join('\n');

holds(all).forEach((ok, i) => check(`rule: ${RULES[i][0]}`, ok));
// each rule must catch its own removal
const cut = (sql: string, rx: RegExp) => sql.replace(new RegExp(rx.source, 'g'), '/*removed*/');
RULES.forEach(([name, rx], i) => check(`mutation not caught: ${name}`, !holds(cut(all, rx))[i]));

// a later migration that rewrites refresh_pin_city_correction wholesale must carry the arm too: the newest file
// that redefines the function body (create or replace … refresh_pin_city_correction) must not predate the arm.
const arm = touching.find((f) => readFileSync(join(MIG, f), 'utf8').includes("'same_name_pin_region'::text"));
const rewrites = touching.filter((f) => /create or replace function public\.refresh_pin_city_correction/i.test(readFileSync(join(MIG, f), 'utf8')));
const lastRewrite = rewrites.at(-1);
check(`a full rewrite (${lastRewrite}) after the arm (${arm}) dropped it`,
  !arm || !lastRewrite || lastRewrite < arm || readFileSync(join(MIG, lastRewrite), 'utf8').includes("'same_name_pin_region'::text"));

if (fail) process.exit(1);
console.log(`✅ verify-pin-city-same-name-region: ${RULES.length} rules hold in ${arm}; ${RULES.length} mutations caught`);
