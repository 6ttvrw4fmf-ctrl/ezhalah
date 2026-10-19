// Barrier — a dealapp town that is a catalogue city in several regions is placed by the ad's OWN pin, or not at all
// (owner 2026-10-18; migration 20261019001829, scraper scrapers/common/arabic_location.py city_by_own_pin).
//
// The bridge resolve_dealapp_city() may narrow a name's catalogue twins to ONE city only when the scraper's pick
// carries its provenance (additional_info.city_source = 'own_pin_disambiguation'), in BOTH candidate arms, and must keep
// the one-catalogue-city rule. The effective body is replayed from the migrations (definitions AND needle edits), so a
// later stale full-body paste that drops the pin arm fails here. Mutants below prove each check can fail.
//
// Run: node --experimental-strip-types scripts/verify-dealapp-town-placed-by-own-pin.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, codeOnly, replayFunction } from './lib/rpcReplay.ts';

const PIN_COL = /case when r\.additional_info->>'city_source' = 'own_pin_disambiguation'\s+then nullif\(r\.additional_info->>'pin_city_id', ''\)::int end as pin_city_id/;
const NARROW = 'and (g.pin_city_id is null or lc.city_id = g.pin_city_id)';

function problems(body: string): string[] {
  const b = codeOnly(body);
  const fail: string[] = [];
  if (!PIN_COL.test(b)) fail.push('the pin pick is read without its provenance (or not at all)');
  if (b.split(NARROW).length - 1 !== 2) fail.push('the pin does not narrow BOTH candidate arms (exact name and spacing-insensitive)');
  if (!/having count\(distinct c\.city_id\) = 1/.test(b)) fail.push('the one-catalogue-city rule is gone (a twin would be guessed)');
  if (!/case when x\.pin_city_id is not null then 'own_pin_disambiguation' else 'dealapp_arabic_city_bridge' end/.test(b)) fail.push('the bridge row no longer records own_pin_disambiguation provenance');
  if (!/is distinct from \(excluded\.city_ar, excluded\.region_ar\)/.test(b)) fail.push('a region-only correction (same twin name) is never written');
  return fail;
}

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

const r = replayFunction(MIGRATIONS_DIR, 'resolve_dealapp_city');
ok('every migration touching resolve_dealapp_city() was interpretable', r.unresolved.length === 0, r.unresolved.join(', '));
ok('the own-pin migration is replayed', r.touchedBy.includes('20261019001829_dealapp_town_placed_by_own_pin.sql'), r.touchedBy.join(', '));
const live = problems(r.body ?? '');
ok('the effective bridge places a twin only by its own pin, with provenance', live.length === 0, live.join('; '));

const body = r.body ?? '';
const mutants: [string, string][] = [
  ['provenance check dropped', body.replace("case when r.additional_info->>'city_source' = 'own_pin_disambiguation'\n                    then ", 'case when true then ')],
  ['second arm not narrowed', body.replace(`\n          ${NARROW}`, '')],
  ['one-city rule dropped', body.replace('having count(distinct c.city_id) = 1', 'having count(distinct c.city_id) >= 1')],
  ['provenance not recorded', body.replace("then 'own_pin_disambiguation' else", "then 'dealapp_arabic_city_bridge' else")],
  ['region change ignored', body.replace('is distinct from (excluded.city_ar, excluded.region_ar)', 'is distinct from (excluded.city_ar, public.listings_arabic_locations.region_ar)')],
  ['pin arm only in a comment', body.replace(`         ${NARROW}\n`, `         -- ${NARROW}\n`)],
];
for (const [name, m] of mutants) ok(`mutant caught: ${name}`, m !== body && problems(m).length > 0);

// The scraper half: the pick is only ever written with its provenance.
const run = readFileSync(join(import.meta.dirname, '..', 'scrapers', 'dealapp', 'run.py'), 'utf8');
ok('dealapp writes pin_city_id only together with city_source', /info\["pin_city_id"\] = pin_city_id\n\s+info\["city_source"\] = "own_pin_disambiguation"/.test(run));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-dealapp-town-placed-by-own-pin: OK');
