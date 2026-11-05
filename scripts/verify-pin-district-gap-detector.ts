// A served ad with a map pin in a city whose districts we list must not stay district-less because the PIN LAYER failed
// it (owner 2026-11-05: «fix it and make it a rule»). mon_detect_pin_district_gap() is that rule: it REPAIRS first
// (refills the recovery of any table holding a switched-on pin that is not served), raises P1 only for the residue (a pin
// the arm still refuses, a pin the served path drops, an ad the nightly never asked in 3 days), and P2 for Apple names
// not on a covered city's list. Rule outcomes (edge held for Google, Apple silent, other city, shared pin, the site's own
// district) are never the P1. The pin arm and listing_native_location_v2 treat a district field that only names the
// ad's OWN town as silent (owner 10-26: a town is not its own district), never another town.
//
// This barrier reads the newest committed definition of each piece and proves every clause with a mutant.
//   node --experimental-strip-types scripts/verify-pin-district-gap-detector.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const newest = (re: RegExp): [string, string] => {
  const f = files.filter((n) => re.test(readFileSync(join(dir, n), 'utf8'))).at(-1);
  if (!f) { console.log(`FAIL  no migration matches ${re}`); process.exit(1); }
  return [f, readFileSync(join(dir, f), 'utf8')];
};
const [fDet, sDet] = newest(/create or replace function public\.mon_detect_pin_district_gap\(\)/);
const [fRows, sRows] = newest(/create or replace function public\.pin_district_gap_rows\(\)/);
const [fTown, sTown] = newest(/create or replace function public\.district_is_own_town\(/);
const [fArm, sArm] = newest(/refresh_district_recovery_table: pin arm patch did not land/);
const [fV2, sV2] = newest(/listing_native_location_v2: pin_governorate patch did not land/);

// The body runs from the create to the close of WHATEVER dollar tag opened it ($function$, $$, $body$ …); no close → ''
// (verify-function-body-windows-fail-closed: a hardcoded tag reads a `$$` body as missing or as the rest of the file).
const body = (s: string, name: string) => {
  const at = s.search(new RegExp(`create or replace function public\\.${name}\\(`));
  if (at < 0) return '';
  const rest = s.slice(at);
  const open = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
  if (!open) return '';
  const close = rest.indexOf(open[0], open.index + open[0].length);
  return close < 0 ? '' : rest.slice(0, close + open[0].length + 1);
};

function detectorProblems(s: string): string[] {
  const fn = body(s, 'mon_detect_pin_district_gap');
  if (!fn) return ['mon_detect_pin_district_gap is not defined'];
  const fail: string[] = [];
  const repair = fn.indexOf('perform public.refresh_district_recovery_table(st);');
  const p1 = fn.indexOf("public.mon_raise('P1', 'pin_district_gap'");
  if (repair < 0) fail.push('the detector no longer repairs (refresh_district_recovery_table) before it raises');
  if (p1 < 0) fail.push('the residue is not raised as P1 pin_district_gap');
  if (repair >= 0 && p1 >= 0 && repair > p1) fail.push('the P1 is raised before the repair runs');
  if (!/where g\.state = 'applied_not_served' loop/.test(fn)) fail.push('the repair does not target switched-on pins that are not served');
  if (!/count\(\*\) filter \(where g\.state = 'never_asked' and g\.first_seen_at < now\(\) - interval '3 days'\)/.test(fn)) fail.push('an ad the nightly never reached is not raised');
  if (!/perform public\.mon_resolve_key\('pin_district_gap', 'pin_district_gap:fleet'\)/.test(fn)) fail.push('the P1 never resolves when the residue is gone');
  if (!/public\.mon_raise\('P2', 'pin_district_gap_self_healed'/.test(fn)) fail.push('the heal is not recorded');
  if (!/public\.mon_raise\('P2', 'pin_district_name_not_on_list'/.test(fn)) fail.push('Apple names not on the list are not surfaced for review');
  if (/insert into public\.loc_catalog_district|insert into public\.loc_district_alias/.test(fn)) fail.push('the detector adds districts or aliases by itself (owner: pins + maps, owner list only)');
  if (/held_edge'[^)]*then[^;]*mon_raise\('P1'/.test(fn)) fail.push('edge homes raise P1');
  if (!/select cron\.schedule\('mon-pin-district-gap', '\d{1,2} \d{1,2} \* \* \*',\s+\$c\$set statement_timeout to '600s'; select public\.mon_detect_pin_district_gap\(\);\$c\$\);/.test(s)) fail.push('the detector has no daily cron');
  return fail;
}
function rowsProblems(s: string): string[] {
  const fn = body(s, 'pin_district_gap_rows');
  if (!fn) return ['pin_district_gap_rows is not defined'];
  const fail: string[] = [];
  if (!/having count\(\*\) >= 10\)/.test(fn)) fail.push('the cohort is not limited to cities with a district list');
  if (!/\(s\.district_ar is null or btrim\(s\.district_ar\) = ''\)/.test(fn)) fail.push('ads that show a district are in the cohort');
  if (!/s\.latitude is not null and s\.longitude is not null/.test(fn)) fail.push('ads without a pin are in the cohort');
  if (!/\(nullif\(btrim\(v1\.district_ar\), ''\) is null or public\.district_is_own_town\(s\.city_id, v1\.district_ar\)\)/.test(fn)) fail.push('ads whose site names a real district are in the cohort (that is mon_detect_unknown_named_district)');
  if (!/when p\.applied and r\.basis is not null and r\.basis <> 'pin' then 'site_recovered_other_city'/.test(fn)) fail.push('a site-resolved ad reads as a dropped pin');
  if (!/when x\.la is not null then 'shared_pin'/.test(fn)) fail.push('shared default pins read as never asked');
  if (!/revoke all on function public\.pin_district_gap_rows\(\) from public, anon, authenticated;/.test(s)) fail.push('the public keys can call pin_district_gap_rows');
  return fail;
}
function townProblems(s: string): string[] {
  const fn = body(s, 'district_is_own_town');
  if (!fn) return ['district_is_own_town is not defined'];
  const fail: string[] = [];
  if (!/public\.loc_display_district_ar\(p_city_id, p_raw\) is null/.test(fn)) fail.push('a name the index SHOWS can read as own-town');
  if (!/public\.district_key_letters\(p_raw\) = public\.district_key_letters\(c\.city_ar\)/.test(fn)) fail.push('own-town no longer compares with the ad\'s own city');
  if (/c\.city_id <> p_city_id|place_km/.test(fn)) fail.push('another town\'s name reads as own-town (that is a city question)');
  return fail;
}
function armProblems(s: string): string[] {
  const fail: string[] = [];
  if (!/or public\.district_is_own_town\(coalesce\(s\.city_id, v1\.city_id\), v1\.district_ar\)\)/.test(s)) fail.push('the pin arm no longer fills an own-town ad');
  if (!/and not exists \(select 1 from public\.listing_title_district lt\s+where lt\.source_table = p\.source_table and lt\.listing_id = p\.listing_id\)/.test(s)) fail.push('the pin arm overrules the ad\'s own title');
  if (!/and not public\.district_is_own_town\(coalesce\(s\.city_id, v1\.city_id\), sd\.source_district_ar\)\)/.test(s)) fail.push('a source-stated real district can be overruled, or an own-town source field still blocks the pin');
  if (!/not found exactly once/.test(s)) fail.push('the live-body patch does not fail closed on a missing anchor');
  return fail;
}
function v2Problems(s1: string, s2: string): string[] {
  const fail: string[] = [];
  if (!/WHEN \(dr\.basis = ANY \(ARRAY\[''title''::text, ''pin''::text\]\)\) THEN dr\.district_ar/.test(s1)) fail.push('v2 does not serve a pin recovery ahead of a hidden own-town name');
  if (!/WHEN \(dr\.verbatim OR \(dr\.basis = ANY \(ARRAY\[''pin''::text, ''title''::text\]\)\)\) THEN norm_district_tok\(dr\.district_ar\)/.test(s2)) fail.push('v2 drops a pin district when the city came from the pin governorate');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);
const prove = (label: string, src: string, mutate: (s: string) => string, judge: (s: string) => string[]) => {
  const m = mutate(src);
  mustCatch(label, m !== src && judge(m).length > 0, m === src ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
};

// The cron is judged in the NEWEST migration that schedules it (20261105093108 moved it to 13:03, cron slot discipline).
const [fCron, sCron] = newest(/select cron\.schedule\('mon-pin-district-gap'/);
let p = detectorProblems(sDet.replace(/select cron\.schedule\('mon-pin-district-gap'[\s\S]*?\$c\$\);/, '') + '\n' + (sCron.match(/select cron\.schedule\('mon-pin-district-gap'[\s\S]*?\$c\$\);/)?.[0] ?? ''));
check(`${fDet} + ${fCron}: the detector repairs, then raises only the residue, daily`, p.length === 0, p.join('; '));
prove('detector raises without repairing', sDet, (s) => s.replace('perform public.refresh_district_recovery_table(st);', 'null;'), detectorProblems);
prove('detector forgets never-asked ads', sDet, (s) => s.replace("g.state = 'never_asked' and g.first_seen_at < now() - interval '3 days'", "false"), detectorProblems);
prove('detector never resolves', sDet, (s) => s.replace("perform public.mon_resolve_key('pin_district_gap', 'pin_district_gap:fleet');", 'null;'), detectorProblems);
prove('detector adds aliases itself', sDet, (s) => s.replace('  return n;\nend $function$;', '  insert into public.loc_district_alias values (1);\n  return n;\nend $function$;'), detectorProblems);
prove('detector has no cron', sDet, (s) => s.replace("select cron.schedule('mon-pin-district-gap'", "select 1, ('mon-pin-district-gap'"), detectorProblems);
prove('heal not recorded', sDet, (s) => s.replace("public.mon_raise('P2', 'pin_district_gap_self_healed'", "public.mon_noop('P2', 'x'"), detectorProblems);

p = rowsProblems(sRows); check(`${fRows}: the cohort is pin + district city + site silent`, p.length === 0, p.join('; '));
prove('cohort spans towns with no list', sRows, (s) => s.replace('having count(*) >= 10)', 'having count(*) >= 0)'), rowsProblems);
prove('site-named ads in the cohort', sRows, (s) => s.replace("(nullif(btrim(v1.district_ar), '') is null or public.district_is_own_town(s.city_id, v1.district_ar))", 'true'), rowsProblems);
prove('site-resolved ads read as dropped pins', sRows, (s) => s.replace("when p.applied and r.basis is not null and r.basis <> 'pin' then 'site_recovered_other_city'", "when false then 'x'"), rowsProblems);

p = townProblems(sTown); check(`${fTown}: own-town means the ad's OWN town only`, p.length === 0, p.join('; '));
prove('a shown name reads as own-town', sTown, (s) => s.replace('public.loc_display_district_ar(p_city_id, p_raw) is null', 'true'), townProblems);
prove('another town reads as own-town', sTown, (s) => s.replace('from public.loc_catalog_city c\n     where c.city_id = p_city_id', 'from public.loc_catalog_city c\n     where c.city_id <> p_city_id'), townProblems);

p = armProblems(sArm); check(`${fArm}: the pin arm fills own-town ads and yields to the title and the source`, p.length === 0, p.join('; '));
prove('arm overrules the title', sArm, (s) => s.replace(/      and not exists \(select 1 from public\.listing_title_district lt\n\s+where lt\.source_table = p\.source_table and lt\.listing_id = p\.listing_id\)\n/, ''), armProblems);
prove('arm skips own-town ads', sArm, (s) => s.replace('\n           or public.district_is_own_town(coalesce(s.city_id, v1.city_id), v1.district_ar))', ')'), armProblems);

p = v2Problems(sArm, sV2); check(`${fArm} + ${fV2}: v2 serves the pin district`, p.length === 0, p.join('; '));
prove('v2 hides the pin behind the town name', sArm, (s) => s.replace("ARRAY[''title''::text, ''pin''::text]", "ARRAY[''title''::text]"), (m) => v2Problems(m, sV2));
prove('v2 drops the pin in a pin-governorate city', sV2, (s) => s.replace("WHEN (dr.verbatim OR (dr.basis = ANY (ARRAY[''pin''::text, ''title''::text]))) THEN", 'WHEN dr.verbatim THEN'), (m) => v2Problems(sArm, m));

console.log(failed === 0 ? 'OK: the pin-district gap is repaired first and only the residue raises' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
