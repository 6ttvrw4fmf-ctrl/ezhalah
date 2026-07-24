// Regression test for a real bug found live 2026-07-24 during a filter-vs-backend audit:
// fetchPropertyAgeOptionCounts() (src/data/remote.ts) called RPC property_age_option_counts_ar
// without p_amenities/p_bath_min, so once a user had already answered an earlier advanced-filter
// question (e.g. RNPL "installment options"), the age-bucket count badges silently ignored that
// filter — showing counts far larger than what Search (and the sibling apartment_guided_counts_ar
// RPC, which already receives both params) actually returns for the same combination. Live-verified:
// a scope where the RPC's own math was otherwise correct still showed cnt_1_2=1276 for a combination
// that Search itself only returns 68 rows for.
//
// Fixed in two places, both checked here:
//   1. The DB migration (supabase/migrations/20260724132204_..._add_amenities_bathmin.sql) adds
//      p_amenities/p_bath_min as new trailing DEFAULT NULL params to property_age_option_counts_ar,
//      via DROP+CREATE (not bare CREATE OR REPLACE — adding params changes the function's argument
//      identity, and a bare OR REPLACE would create a second overloaded function instead of replacing
//      it, risking PostgREST's PGRST203 ambiguous-overload error).
//   2. fetchPropertyAgeOptionCounts() now forwards q.amenities/q.bathMin, the exact same conditional
//      shape fetchApartmentGuidedCounts() already uses a few lines below it.
//
// This is a static source-text check (same pattern as verify-city-field.ts/verify-district-field.ts —
// remote.ts imports '@/lib/supabase' at module scope, so it can't be live-imported by a plain node
// script). The live RPC behavior itself was verified manually against project aannarbkwcymrotzwdbo
// (anon-key REST) at fix time; this test's job is only to pin the source-level wiring against
// regressing back to the silently-narrower call.
//
//   node --experimental-strip-types scripts/verify-property-age-counts-amenities-param.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const remoteSrc = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');

const fnMatch = remoteSrc.match(
  /export async function fetchPropertyAgeOptionCounts\(q: SearchQuery\): Promise<AgeOptionCounts \| null> \{[\s\S]*?\n\}/,
);
check('fetchPropertyAgeOptionCounts() is still defined in src/data/remote.ts', fnMatch !== null);
const fnBody = fnMatch ? fnMatch[0] : '';

check(
  "fetchPropertyAgeOptionCounts() forwards an already-answered amenities filter (q.amenities -> p_amenities)",
  /\.\.\.\(q\.amenities\?\.length \? \{ p_amenities: q\.amenities \} : \{\}\)/.test(fnBody),
);
check(
  'fetchPropertyAgeOptionCounts() forwards an already-answered min-bathrooms filter (q.bathMin -> p_bath_min)',
  /\.\.\.\(q\.bathMin != null \? \{ p_bath_min: q\.bathMin \} : \{\}\)/.test(fnBody),
);
// Both new params are spread INTO the same supabase.rpc('property_age_option_counts_ar', {...}) call,
// not appended after it as an unrelated object — anchor on the RPC call containing both.
check(
  "both new params are part of the property_age_option_counts_ar RPC call itself (not dead code elsewhere)",
  /supabase\.rpc\('property_age_option_counts_ar', \{[\s\S]{0,1200}p_amenities: q\.amenities[\s\S]{0,300}p_bath_min: q\.bathMin/.test(fnBody),
);

// Sibling parity check: fetchApartmentGuidedCounts() must still pass both too (the pattern this fix
// was modeled on) — catches an accidental regression to THAT call site instead.
const guidedMatch = remoteSrc.match(
  /export async function fetchApartmentGuidedCounts\(q: SearchQuery\): Promise<GuidedCounts \| null> \{[\s\S]*?\n\}/,
);
check('fetchApartmentGuidedCounts() is still defined (the sibling pattern this fix mirrors)', guidedMatch !== null);
if (guidedMatch) {
  check(
    'fetchApartmentGuidedCounts() still forwards p_amenities (unchanged sibling behavior)',
    /\.\.\.\(q\.amenities\?\.length \? \{ p_amenities: q\.amenities \} : \{\}\)/.test(guidedMatch[0]),
  );
  check(
    'fetchApartmentGuidedCounts() still forwards p_bath_min (unchanged sibling behavior)',
    /\.\.\.\(q\.bathMin != null \? \{ p_bath_min: q\.bathMin \} : \{\}\)/.test(guidedMatch[0]),
  );
}

// The migration file itself must exist and actually add both params to the live function's signature
// (pins the DB-side half of the fix against being reverted/lost — see project memory
// 'migration-history-drift': execute_sql-only DB changes with no committed migration file are lost on
// the next deploy).
let migrationSrc = '';
try {
  migrationSrc = readFileSync(
    new URL(
      '../supabase/migrations/20260724132204_property_age_option_counts_ar_add_amenities_bathmin.sql',
      import.meta.url,
    ),
    'utf8',
  );
} catch {
  // leave empty; the check below fails with a clear message
}
check('the committed migration file for this fix exists', migrationSrc.length > 0);
check(
  "the migration DROPs the OLD 17-arg signature (not a bare CREATE OR REPLACE, to avoid the PGRST203 overload hazard)",
  /drop function if exists public\.property_age_option_counts_ar\(\s*text, text, text\[\], text\[\], text\[\], text\[\], integer\[\], text\[\], text\[\], text\[\],\s*integer\[\], integer, numeric, numeric, integer, integer, text\s*\);/.test(
    migrationSrc,
  ),
);
check(
  'the migration CREATEs the function with p_amenities and p_bath_min as new trailing params',
  /p_category text DEFAULT NULL::text,\s*p_amenities text\[\] DEFAULT NULL::text\[\],\s*p_bath_min integer DEFAULT NULL::integer\s*\)/.test(
    migrationSrc,
  ),
);
check(
  'the migration re-grants EXECUTE to anon and authenticated (the new signature needs its own grant)',
  /grant execute on function public\.property_age_option_counts_ar\([\s\S]*?\)\s*to anon, authenticated;/.test(migrationSrc),
);

console.log(
  failed === 0
    ? '\n✓ property_age_option_counts_ar amenities/bath_min wiring verified (source + migration)'
    : `\n✗ ${failed} assertion(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
