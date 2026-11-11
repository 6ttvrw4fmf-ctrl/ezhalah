// Offline regressions for PR #11808. Run with:
// node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-retired-town-by-pin.ts
// These are SQL contract checks and unit tests of the changed checker, not database execution.
// Replay needle edits too: the last CREATE alone misses the registered-default exclusion.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { problems } from './verify-location-fixes-2026-10-30.ts';
import { codeOnly, MIGRATIONS_DIR, replayFunction } from './lib/rpcReplay.ts';

const migrations = readdirSync(MIGRATIONS_DIR).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort()
  .map(f => ({ f, s: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));
const definition = migrations.filter(m => /create or replace function public\.retired_place_remap_rows\(/i.test(m.s)).at(-1)!;
const pinProblem = 'a home under a neighbouring city may move';
const pinProblems = (ms: typeof migrations) => problems(ms).filter(p => p.includes(pinProblem));
function replaceOnce(s: string, from: string, to: string): string {
  assert.equal(s.split(from).length - 1, 1, `mutation must match exactly once: ${from}`);
  return s.replace(from, to);
}
const changeDefinition = (from: string, to: string) => migrations.map(m => m === definition
  ? { ...m, s: replaceOnce(m.s, from, to) } : m);

test('current migrations satisfy the location checker', () => assert.deepEqual(problems(migrations), []));

for (const [label, from, to] of [
  ['missing latitude', 'and s.latitude is not null and s.longitude is not null', 'and s.longitude is not null'],
  ['missing distance gate', ' <= 15\n', ' >= 15\n'],
  ['widened radius', ' <= 15\n', ' <= 15000\n'],
  ['strict boundary that drops exactly 15 km', ' <= 15\n', ' < 15\n'],
] as const) {
  test(`checker rejects ${label} with the defining filename`, () => {
    const found = pinProblems(changeDefinition(from, to));
    assert.equal(found.length, 1);
    assert.ok(found[0].startsWith(definition.f + ':'));
  });
}

test('checker accepts SQL whitespace around the radius comparison', () => {
  assert.deepEqual(pinProblems(changeDefinition(' <= 15\n', '\n <=\t15\n')), []);
});

test('checker reads a later definition rather than an earlier safe body', () => {
  const s = replaceOnce(definition.s, ' <= 15\n', ' <= 15000\n');
  const found = pinProblems([...migrations, { f: '29990101000000_regression.sql', s }]);
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith('29990101000000_regression.sql:'));
});

test('an earlier unsafe definition does not poison a later repaired definition', () => {
  const s = replaceOnce(definition.s, ' <= 15\n', ' <= 15000\n');
  assert.deepEqual(pinProblems([{ f: '20000101000000_old.sql', s }, ...migrations]), []);
});

const replay = replayFunction(MIGRATIONS_DIR, 'retired_place_remap_rows');
assert.deepEqual(replay.unresolved, [], 'every function edit must be understood');
assert.ok(replay.body, 'the remap function must exist');
const body = codeOnly(replay.body);
const arm = /\),\s*g2n as \(([\s\S]*?)\n\s*\)\s*select \*/i.exec(body)?.[1];
assert.ok(arm, 'the neighbouring-city arm must exist');

test('effective body includes the follow-up default-pin migration', () => {
  assert.ok(replay.touchedBy.includes('20261111075146_retired_town_by_pin_ignores_registered_default_points.sql'));
  assert.equal((arm.match(/ops_default_pin_register/g) ?? []).length, 1);
});

// Scoped to g2n: a guard in the older g2 arm cannot make these pass accidentally.
// Match executable SQL only, with whitespace normalized so indentation is not a contract.
const contracts = [
  ['only a different source city', 'g2d.city_id <> v1.city_id'],
  ['never remap a town to itself', 'g2d.tgt <> v1.city_id'],
  ['match the district name with blank-source recovery',
    "g2d.k = public.district_key_letters(coalesce(nullif(btrim(v1.district_ar), ''), dr.district_ar))"],
  ['recovery belongs to the same source and listing',
    'dr.source_table = v1.source_table and dr.listing_id = v1.listing_id'],
  ['target city is active and in the source region', 'n.retired_at is null and n.region_id = o.region_id'],
  ['target centre is required', 'join public.loc_city_center cc on cc.city_id = g2d.tgt'],
  ['pin belongs to the same source and listing', 's.source_table = v1.source_table and s.listing_id = v1.listing_id'],
  ['both coordinates are required', 's.latitude is not null and s.longitude is not null'],
  ['registered defaults are excluded', 'and not exists (select 1 from public.ops_default_pin_register g'],
  ['default points are scoped to their platform', 'g.source_table = s.source_table'],
  ['default latitude matches at five decimal places', 'g.lat = round(s.latitude::numeric, 5)'],
  ['default longitude matches at five decimal places', 'g.lng = round(s.longitude::numeric, 5)'],
  ['distance uses the target latitude and longitude', '111.0 * sqrt(power(s.latitude::float8 - cc.lat, 2)'],
  ['longitude is scaled at the target latitude and the 15 km boundary is inclusive',
    '+ power((s.longitude::float8 - cc.lng) * cos(radians(cc.lat)), 2)) <= 15'],
  ['one result per source/listing', 'select distinct on (v1.source_table, v1.listing_id)'],
  ['ambiguous towns resolve deterministically', 'order by v1.source_table, v1.listing_id, g2d.tgt'],
  ['new moves carry their own kind', "'district_is_city_by_pin'"],
] as const;

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
for (const [label, clause] of contracts) {
  test(`SQL contract: ${label}`, () => {
    const actual = normalize(arm);
    const required = normalize(clause);
    assert.ok(actual.includes(required), `missing: ${clause}`);
  });
}

test('the new arm preserves the two existing remap paths', () => {
  assert.match(body, /select \* from g34 union all select \* from g2 union all select \* from g2n/);
  const oldArm = /\),\s*g2 as \(([\s\S]*?)\),\s*g2n as/i.exec(body)?.[1];
  assert.ok(oldArm);
  assert.match(oldArm, /g2d\.city_id = v1\.city_id/);
  assert.doesNotMatch(oldArm, /s\.latitude|ops_default_pin_register/, 'same-city recovery still needs no pin');
});
