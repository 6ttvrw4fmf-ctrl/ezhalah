// A district read from an ad's pin may only FILL a gap, and nothing is served from it until it is switched on (owner 2026-10-24).
//
// WHAT THIS PINS. Migration *_pin_district_fill_table_and_recovery_arm.sql adds listing_pin_district (our catalog spelling,
// never a map provider's text) and one extra arm to refresh_district_recovery_table(). The arm is the whole safety story:
// it runs LAST with ON CONFLICT DO NOTHING, only for rows that are switched on (applied), only where the ad's native district,
// neighborhood and source district are all blank, only in the city the ad is served in, and it marks its rows
// verbatim = false / basis = 'pin' so nothing counts them as attestation and the app can label them «تقريبي».
// Migration *_pin_district_fill_batch_1_inert.sql loads the first batch with applied = false and only rows whose
// neighbours (ads that already carry a district within ~440 m) back them: support >= 2 and support >= 2 x against.
//
// SWITCH-ON GUARD. No migration may set applied = true until the label and the nightly alarm exist. When they do, the migration
// that flips it must update FLIP_ALLOWED below in the same PR, on purpose.
//
//   node --experimental-strip-types scripts/verify-pin-district-fill-contract.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const find = (re: RegExp, what: string): string => {
  const f = all.filter((n) => re.test(n)).at(-1);
  if (!f) { console.log(`FAIL  migration ${what} is missing`); process.exit(1); }
  return f;
};
const fileArm = find(/^\d{14}_pin_district_fill_table_and_recovery_arm\.sql$/, '*_pin_district_fill_table_and_recovery_arm.sql');
const fileData = find(/^\d{14}_pin_district_fill_batch_1_inert\.sql$/, '*_pin_district_fill_batch_1_inert.sql');
const sqlArm = readFileSync(join(dir, fileArm), 'utf8');
const sqlData = readFileSync(join(dir, fileData), 'utf8');

// Versions of migrations that are allowed to switch rows on. The alarm (mon_detect_pin_district_unvouched) and the DB guards
// (20261025203753) shipped; the owner then decided on 2026-10-25 there is NO «تقريبي» label (the district Apple Maps names
// is shown as the district), so the label is no longer a precondition. Batch 2, the middle homes, was switched on that day.
const FLIP_ALLOWED: string[] = ['20261025214336'];

function armProblems(s: string): string[] {
  const fail: string[] = [];
  if (!/create table if not exists public\.listing_pin_district \(/.test(s)) fail.push('listing_pin_district is not created');
  if (!/primary key \(source_table, listing_id\)/.test(s)) fail.push('listing_pin_district lost its (source_table, listing_id) key');
  if (!/applied\s+boolean not null default false/.test(s)) fail.push('applied no longer defaults to false (rows would be served the moment they are loaded)');
  if (!/alter table public\.listing_pin_district enable row level security;/.test(s)) fail.push('row level security is off on listing_pin_district');
  if (!/revoke all on table public\.listing_pin_district from public, anon, authenticated;/.test(s)) fail.push('listing_pin_district is readable by the public keys');
  if (!/alter table public\.district_recovery add column if not exists basis text;/.test(s)) fail.push('district_recovery has no basis column to mark pin rows');

  const fn = s.match(/CREATE OR REPLACE FUNCTION public\.refresh_district_recovery_table\([\s\S]*?\$function\$;/i)?.[0] ?? '';
  if (!fn) { fail.push('refresh_district_recovery_table is not redefined'); return fail; }
  const arm = fn.match(/-- PIN ARM[\s\S]*?\$f\$, p_table, p_table\);/)?.[0] ?? '';
  if (!arm) { fail.push('the pin arm is missing from refresh_district_recovery_table'); return fail; }
  if (!/from public\.listing_pin_district p/.test(arm)) fail.push('the pin arm does not read listing_pin_district');
  if (!/\bp\.applied\b/.test(arm)) fail.push('the pin arm serves rows that are not switched on');
  if (!/p\.city_id = coalesce\(v1\.city_id, s\.city_id\)/.test(arm)) fail.push('the pin arm no longer requires the pin city to be the served city');
  if (!/\(v1\.district_ar is null or btrim\(v1\.district_ar\) = ''\)/.test(arm)) fail.push('the pin arm may overrule a native district');
  if (!/nullif\(btrim\(x\.neighborhood\), ''\) is null/.test(arm)) fail.push('the pin arm may overrule a non-blank neighborhood');
  if (!/not exists \(\s*select 1 from public\.listing_source_district_ar sd\s+where sd\.source_table = p\.source_table and sd\.listing_id = p\.listing_id\)/.test(arm)) fail.push('the pin arm may overrule a district the source states');
  if (!/on conflict \(source_table, listing_id\) do nothing/.test(arm)) fail.push('the pin arm can replace a district another arm resolved');
  if (!/now\(\), false, 'pin'/.test(arm)) fail.push('pin rows are not marked verbatim = false / basis = pin');
  const sdArm = fn.indexOf('do update\n    set district_ar = excluded.district_ar');
  if (sdArm < 0 || fn.indexOf('-- PIN ARM') < sdArm) fail.push('the pin arm no longer runs after the source-district arm');
  if (fn.indexOf('-- PIN ARM') > fn.indexOf('-- LOSS GUARD')) fail.push('the pin arm runs after the loss guard');
  if (!/create temp table if not exists _drt \([^;]*basis text/.test(fn)) fail.push('the working table has no basis column');
  if (!/insert into public\.district_recovery \(source_table, listing_id, district_ar, resolved_at, verbatim, basis\)\s+select source_table, listing_id, district_ar, resolved_at, verbatim, basis from _drt;/.test(fn)) fail.push('the final write drops the basis column');
  if (!/if v_elig >= 50 and v_lost > 0\.01 \* v_elig then/.test(fn)) fail.push('the recovery loss guard is gone');
  if (!/delete from public\.district_recovery where source_table = p_table;/.test(fn)) fail.push('the per-table refill no longer replaces its own rows');
  return fail;
}

function dataProblems(s: string): string[] {
  const fail: string[] = [];
  if (!/insert into public\.listing_pin_district \(source_table, listing_id, city_id, district_ar, support, against, run_id, applied\)/.test(s)) fail.push('the batch does not insert into listing_pin_district with its evidence columns');
  if (!/select v\.st, v\.lid, v\.cid, v\.d, v\.s, v\.a, '[a-z0-9-]+', false\s+from \(values/.test(s)) fail.push('the batch is not loaded with applied = false');
  if (!/where exists \(select 1 from public\.search_listings_ar x\s+where x\.source_table = v\.st and x\.listing_id = v\.lid and x\.city_id = v\.cid\s+and \(x\.district_ar is null or btrim\(x\.district_ar\) = ''\)\)/.test(s)) fail.push('the batch no longer loads only ads that are still blank in the served index and still in the same city');
  if (!/on conflict \(source_table, listing_id\) do nothing;/.test(s)) fail.push('the batch can overwrite an earlier row');
  const body = s.match(/from \(values\n([\s\S]*?)\n\) as v\(st, lid, cid, d, s, a\)/)?.[1] ?? '';
  const rows = [...body.matchAll(/\('([a-z0-9_]+_listings)',(\d+),(\d+),'([^']+)',(\d+),(\d+)\)/g)];
  if (rows.length === 0) fail.push('the batch has no rows');
  const seen = new Set<string>();
  for (const r of rows) {
    const [, tbl, id, , name, sup, ag] = r;
    const support = Number(sup), against = Number(ag);
    if (support < 2 || support < 2 * against) fail.push(`${tbl}:${id} «${name}» is not backed by its neighbours (support ${support}, against ${against})`);
    const k = `${tbl}:${id}`;
    if (seen.has(k)) fail.push(`${k} appears twice`);
    seen.add(k);
  }
  const stray = body.replace(/\('([a-z0-9_]+_listings)',(\d+),(\d+),'([^']+)',(\d+),(\d+)\)/g, '').replace(/[,\s]/g, '');
  if (stray) fail.push(`the batch has text that is not a row: ${stray.slice(0, 60)}`);
  return fail;
}

function flipProblems(files: Array<[string, string]>): string[] {
  const fail: string[] = [];
  for (const [f, text] of files) {
    if (!/listing_pin_district/.test(text)) continue;
    const t = text.replace(/--[^\n]*/g, '');
    const version = f.slice(0, 14);
    const flips = /set\s+applied\s*=\s*true/i.test(t) || /,\s*true\s+from \(values/i.test(t) || /applied[^;]{0,40}default true/i.test(t);
    if (flips && !FLIP_ALLOWED.includes(version)) fail.push(`${f} switches pin districts on before the label and the nightly alarm are recorded as shipped`);
  }
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const liveArm = armProblems(sqlArm);
check(`committed migration ${fileArm} holds every pin`, liveArm.length === 0, liveArm.join('; '));
const armMutants: Array<[string, (s: string) => string]> = [
  ['rows are served without being switched on', (s) => s.replace('      and p.applied\n', '')],
  ['pin city no longer checked', (s) => s.replace('      and p.city_id = coalesce(v1.city_id, s.city_id)\n', '')],
  ['native district may be overruled', (s) => s.replace("      and (v1.district_ar is null or btrim(v1.district_ar) = '')\n      and nullif(", '      and nullif(')],
  ['non-blank neighborhood may be overruled', (s) => s.replace("      and nullif(btrim(x.neighborhood), '') is null\n", '')],
  ['source-stated district may be overruled', (s) => s.replace(/      and not exists \(\n            select 1 from public\.listing_source_district_ar sd\n            where sd\.source_table = p\.source_table and sd\.listing_id = p\.listing_id\)\n    on conflict \(source_table, listing_id\) do nothing\n  \$f\$, p_table, p_table\);/, '    on conflict (source_table, listing_id) do nothing\n  $f$, p_table, p_table);')],
  ['pin arm replaces other recoveries', (s) => s.replace(/(from public\.listing_pin_district p[\s\S]*?)on conflict \(source_table, listing_id\) do nothing/, '$1on conflict (source_table, listing_id) do update set district_ar = excluded.district_ar')],
  ['pin rows counted as verbatim', (s) => s.replace("now(), false, 'pin'", "now(), true, 'pin'")],
  ['basis lost on the final write', (s) => s.replace('resolved_at, verbatim, basis)\n  select source_table, listing_id, district_ar, resolved_at, verbatim, basis from _drt;', 'resolved_at, verbatim)\n  select source_table, listing_id, district_ar, resolved_at, verbatim from _drt;')],
  ['loss guard removed', (s) => s.replace('if v_elig >= 50 and v_lost > 0.01 * v_elig then', 'if false then')],
  ['table readable by the public keys', (s) => s.replace('revoke all on table public.listing_pin_district from public, anon, authenticated;', '')],
  ['row level security off', (s) => s.replace('alter table public.listing_pin_district enable row level security;', '')],
  ['rows default to switched on', (s) => s.replace('applied      boolean not null default false', 'applied      boolean not null default true')],
];
for (const [label, mutate] of armMutants) {
  const m = mutate(sqlArm);
  mustCatch(`arm: ${label}`, m !== sqlArm && armProblems(m).length > 0, m === sqlArm ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

const liveData = dataProblems(sqlData);
check(`committed migration ${fileData} holds every pin`, liveData.length === 0, liveData.join('; '));
const firstRow = /\('([a-z0-9_]+_listings)',(\d+),(\d+),'([^']+)',(\d+),(\d+)\)/;
const dataMutants: Array<[string, (s: string) => string]> = [
  ['batch loaded switched on', (s) => s.replace(/(v\.a, '[a-z0-9-]+', )false/, '$1true')],
  ['blank-ad check removed', (s) => s.replace(/where exists \(select 1 from public\.search_listings_ar x[\s\S]*?\)\)\non conflict/, 'on conflict')],
  ['a row without neighbour support', (s) => s.replace(firstRow, "('abeea_commercial_listings',5434266,31,'حي التحلية',1,0)")],
  ['a row its neighbours contradict', (s) => s.replace(firstRow, "('abeea_commercial_listings',5434266,31,'حي التحلية',10,9)")],
  ['an earlier row can be overwritten', (s) => s.replace('on conflict (source_table, listing_id) do nothing;', 'on conflict (source_table, listing_id) do update set district_ar = excluded.district_ar;')],
  ['a row appears twice', (s) => s.replace(firstRow, (m) => `${m},${m}`)],
];
for (const [label, mutate] of dataMutants) {
  const m = mutate(sqlData);
  mustCatch(`data: ${label}`, m !== sqlData && dataProblems(m).length > 0, m === sqlData ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

const files: Array<[string, string]> = all.map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
const liveFlip = flipProblems(files);
check('no migration switches pin districts on yet', liveFlip.length === 0, liveFlip.join('; '));
mustCatch('flip: an update switches rows on', flipProblems([...files, ['20261230000000_x.sql', 'update public.listing_pin_district set applied = true where run_id = \'x\';']]).length > 0);
mustCatch('flip: a batch is loaded switched on', flipProblems([...files, ['20261230000001_x.sql', 'insert into public.listing_pin_district (source_table) select v.st, true from (values (1)) v(st);']]).length > 0);
mustCatch('flip: the default is flipped', flipProblems([...files, ['20261230000002_x.sql', 'alter table public.listing_pin_district alter column applied set default true; -- listing_pin_district']]).length > 0);

console.log(failed === 0 ? 'OK: a pin district can only fill a gap and is not served until switched on' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
