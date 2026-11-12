// Unit coverage for PR #11974's migration validator. Hermetic: no database or network.
// Run: node --experimental-strip-types scripts/verify-retired-town-remap-source-district-unit.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { problems } from './verify-retired-town-remap-keys-on-source-district.ts';

const name = '20261112071500_retired_town_remap_keys_on_source_district.sql';
const sql = readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const fix = { f: name, s: sql };
const key = 'listing_source_district_ar_fleet';
let checks = 0;
function test(label: string, run: () => void): void {
  run();
  checks++;
  console.log(`  ✓ ${label}`);
}
function replaceOnce(from: string, to: string): string {
  assert.equal(sql.split(from).length - 1, 1, `mutation anchor must be unique: ${from}`);
  return sql.replace(from, to);
}

test('the committed fix is valid in isolation', () => assert.deepEqual(problems([fix]), []));
test('an empty migration list fails closed', () => {
  assert.deepEqual(problems([]), [`20261112071500_*.sql is missing — retired_place_remap_rows() never learned the source-district key`]);
});
test('a similarly named migration at a different timestamp cannot stand in for the fix', () => {
  assert.match(problems([{ ...fix, f: '20261112071501_other.sql' }])[0], /is missing/);
});

const mutations = [
  ['live function lookup', "src := pg_get_functiondef('public.retired_place_remap_rows()'::regprocedure)", "src := pg_get_functiondef('public.other()'::regprocedure)", /LIVE/],
  ['exactly two replacements', 'if c <> 2 then raise', 'if c <> 1 then raise', /exactly 2 arms/],
  ['replacement predicate', "repl constant text := 'g2d.k in (", "repl constant text := 'g2d.k = (", /replacement no longer/],
  ['source fleet lookup', `from public.${key} sd`, 'from public.district_recovery sd', /replacement no longer/],
  ['both incident listings', 'listing_id in (9594877, 26273326)', 'listing_id in (9594877)', /two swapping homes|check block no longer executes/],
  ['incident destination city', 'and new_city_id = 3700) <> 2', 'and new_city_id = 12) <> 2', /check block no longer executes/],
  ['both incident results required', 'and new_city_id = 3700) <> 2', 'and new_city_id = 3700) < 1', /check block no longer executes/],
  ['pin remap floor', 'n_pin < 32 or n_other < 524', 'n_pin < 31 or n_other < 524', /remap that shrank/],
  ['other remap floor', 'n_pin < 32 or n_other < 524', 'n_pin < 32 or n_other < 523', /remap that shrank/],
  ['either floor must fail', 'n_pin < 32 or n_other < 524', 'n_pin < 32 and n_other < 524', /remap that shrank/],
] as const;
for (const [label, from, to, message] of mutations) {
  test(`rejects a missing or weakened ${label}`, () => {
    const errors = problems([{ f: name, s: replaceOnce(from, to) }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], message);
    assert.ok(errors[0].startsWith(name));
  });
}
test('missing check block reports both execution and shrink safeguards', () => {
  const errors = problems([{ f: name, s: sql.split('do $chk$')[0] }]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /check block no longer executes/);
  assert.match(errors[1], /remap that shrank/);
});
test('independent defects are reported together', () => {
  const broken = replaceOnce('if c <> 2 then raise', 'if c <> 1 then raise')
    .replace('n_pin < 32 or n_other < 524', 'false');
  assert.equal(problems([{ f: name, s: broken }]).length, 2);
});

// Minimal synthetic definitions isolate validator decisions, not SQL execution.
function definition(keys: number, delimiter = '$function$'): string {
  return `create or replace function public.retired_place_remap_rows() returns text language sql as ${delimiter}
    select '${Array(keys).fill(key).join(' ')}'
  ${delimiter};`;
}
const later = (s: string) => ({ f: '20261113000000_redefine.sql', s });
for (const delimiter of ['$function$', '$$']) {
  for (const keys of [0, 1, 2, 3]) {
    test(`${delimiter} function with ${keys} source references ${keys < 2 ? 'fails' : 'passes'}`, () => {
      const errors = problems([fix, later(definition(keys, delimiter))]);
      assert.equal(errors.length, keys < 2 ? 1 : 0);
      if (keys < 2) assert.match(errors[0], /20261113000000_redefine.sql: redefines/);
    });
  }
  test(`references after the ${delimiter} function cannot hide a regression`, () => {
    assert.equal(problems([fix, later(`${definition(1, delimiter)}\nselect '${key}';`)]).length, 1);
  });
}
test('an earlier definition without the key is allowed', () => {
  assert.deepEqual(problems([{ f: '20261111000000_before.sql', s: definition(0) }, fix]), []);
});
test('migration dates determine precedence even if input is unsorted', () => {
  assert.equal(problems([later(definition(0)), fix]).length, 1);
});
test('an unrelated function after the fix is allowed', () => {
  assert.deepEqual(problems([fix, later(definition(0).replace('retired_place_remap_rows', 'unrelated_rows'))]), []);
});
test('function redefinitions are detected with mixed case and whitespace', () => {
  const s = definition(0).replace('create or replace function public.', 'CREATE\nOR REPLACE\tFUNCTION PUBLIC.');
  assert.equal(problems([fix, later(s)]).length, 1);
});
test('each later regression is reported, even after a valid replacement', () => {
  const errors = problems([fix, later(definition(2)),
    { f: '20261114000000_bad.sql', s: definition(1) },
    { f: '20261115000000_bad.sql', s: definition(0) }]);
  assert.equal(errors.length, 2);
  assert.ok(errors[0].startsWith('20261114000000_bad.sql:'));
  assert.ok(errors[1].startsWith('20261115000000_bad.sql:'));
});

// SQL contract assertions complement the validator: it does not inspect these correlations.
test('source lookup is scoped to the same site AND listing', () => {
  assert.match(sql, /where sd\.source_table = v1\.source_table and sd\.listing_id = v1\.listing_id/);
});
test('source key supplements the existing native/recovery fallback', () => {
  assert.match(sql, /repl constant text := 'g2d\.k in \(public\.district_key_letters\(coalesce\(nullif\(btrim\(v1\.district_ar\), ''''\), dr\.district_ar\)\),'/);
  assert.match(sql, /public\.district_key_letters\(\(select sd\.source_district_ar/);
});
test('the migration replaces the checked needle and executes the resulting body', () => {
  assert.match(sql, /dst := replace\(src, needle, repl\);\s*execute dst;/);
  assert.match(sql, /if position\('listing_source_district_ar_fleet' in src\) > 0 then raise exception/);
});
test('apply-time checks preserve the pre-existing Arkaan move', () => {
  assert.match(sql, /if not exists \(select 1 from public\.retired_place_remap_rows\(\)\s+where source_table = 'arkaan_residential_listings' and listing_id = 26298570 and new_city_id = 3700\) then\s+raise exception/);
});
console.log(`✅ retired town source-district unit coverage: ${checks} checks passed`);
