// ops_incident #189: strip_district_city_suffix() never re-runs once a listing's city is resolved
// by the region-scoped fallback (listings_arabic_locations) rather than the platform parser — a
// glued «حي X <city>» suffix survives forever for exactly that cohort. Backfilled the 3 of 4
// flagged listings where the fix is fully deterministic from EXISTING source/canonical data;
// listing 762483 stays unfixed (genuinely unresolved city — see the migration's own header).
//
// This guard is hermetic — no database, no network — and pins the two committed migrations
// (a first attempt the connector reported failed, and a split retry that also landed — both real,
// both mirrored) target exactly the deterministic 3 ids, exclude 762483, and use the SAME vetted
// strip_district_city_suffix() function rather than a hand-rolled string edit.
//
//   node --experimental-strip-types scripts/verify-aqarmonthly-district-suffix-backfill-189.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('\nAqarmonthly district-suffix backfill targets exactly the 3 deterministic listings\n');

const MIGS = [
  '20260911221734_aqarmonthly_district_suffix_backfill_incident_189.sql',
  '20260911222018_aqarmonthly_district_suffix_backfill_incident_189.sql',
  '20260911223037_aqarmonthly_district_suffix_backfill_gets_a_detector_incident_189.sql',
];
const migrations = readdirSync(join(root, 'supabase/migrations'));
for (const m of MIGS) check(`${m} is committed`, migrations.includes(m), 'not found');

const sqls = MIGS.filter((m) => migrations.includes(m))
  .map((m) => readFileSync(join(root, 'supabase/migrations', m), 'utf8'));

for (const [i, sql] of sqls.entries()) {
  const tag = MIGS[i];
  check(`${tag}: uses the vetted strip_district_city_suffix() function, not a hand-rolled edit`,
    sql.includes('public.strip_district_city_suffix(r.district_ar, l.city_ar)'));

  check(`${tag}: scoped to exactly the 3 deterministic ids (762041, 762272, 1097370)`,
    /r\.id in \(762041, 762272, 1097370\)/.test(sql),
    'the id list does not match the deterministic-only scope');

  check(`${tag}: does NOT include 762483 (the genuinely-unresolved-city listing)`,
    !/\b762483\b.*in \(/.test(sql) && !sql.includes('762041, 762272, 1097370, 762483'),
    '762483 must stay excluded — its city is unresolved by both the parser and the fallback');

  check(`${tag}: requires matched=true and a non-null fallback city (never applies to an unresolved row)`,
    sql.includes('and l.matched') && sql.includes('and l.city_ar is not null'));
}

// ── MUTATION PROOF — a naive "fix all 4" scope must be caught ──────────────────────────────────────
const mustCatch = (label: string, checkPassesOnBrokenInput: boolean) => {
  check(`MUTATION ${label} — the check catches it`, checkPassesOnBrokenInput === false,
    'the check passed on a deliberately broken (over-wide) scope, so it cannot catch a regression');
};
const OVERWIDE_SQL = `
update public.aqarmonthly_residential_listings r
   set district_ar = public.strip_district_city_suffix(r.district_ar, l.city_ar)
  from public.listings_arabic_locations l
 where l.source_table = 'aqarmonthly_residential_listings'
   and l.listing_id = r.id
   and r.id in (762041, 762272, 1097370, 762483);
`;
mustCatch('a fix widened to include 762483 (no matched/city_ar guard)',
  !/\b762483\b.*in \(/.test(OVERWIDE_SQL) && !OVERWIDE_SQL.includes('762041, 762272, 1097370, 762483'));
mustCatch('a fix that drops the matched/city_ar guard entirely',
  OVERWIDE_SQL.includes('and l.matched') && OVERWIDE_SQL.includes('and l.city_ar is not null'));

console.log(failed
  ? `\n✗ verify-aqarmonthly-district-suffix-backfill-189: ${failed} check(s) failed.\n`
  : '\n✅ verify-aqarmonthly-district-suffix-backfill-189: exactly the 3 deterministic listings are '
    + 'fixed via the vetted stripper; 762483 stays honestly unresolved.\n');
process.exit(failed ? 1 : 0);
