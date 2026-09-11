// REAL regression barrier for the gathern_additional_info_overlay district discard (found live
// 2026-09-11, tracing district survival scraped -> listing_native_location_v2 -> search_listings_ar
// for gathern/wasalt/aqar/dealapp/remal/amaall).
//
// THE DEFECT. 74 active gathern_residential_listings have no row at all in
// listing_native_location_v1 (not native, not legacy-matched via listings_arabic_locations), so
// they are produced by listing_native_location_v2's catch-all UNION ALL branch. That branch's
// `gathern_additional_info_overlay` arm already reads additional_info->>'resolved_city_id' to
// resolve city_id -- but the branch's single shared `district_ar` output column was hardcoded
// `NULL::text` for EVERY row in the catch-all, discarding the district sitting in the exact same
// additional_info blob. Proven live: search_listings_ar.district_ar was NULL for all 74, though
// each carries a genuine source-published neighbourhood (English `neighborhood` column) and its
// already-produced Arabic translation (additional_info->>'district_ar', e.g. "Al Malqa Dist." /
// "حي الملقا"). district_recovery (the hourly gap-filler) cannot reach them either: it only ever
// reads FROM listing_native_location_v1, and these rows have no v1 row to read.
//
// THE FIX resolves district_ar inside the gathern_additional_info_overlay lateral using
// resolve_district_ar(city_id, additional_info->>'district_ar') -- the SAME vetted resolver
// district_recovery already uses for this exact gap elsewhere: an attested-in-this-city lookup via
// loc_canonical_district that returns NULL rather than inventing a value when unattested (SOURCE IS
// TRUTH: a genuinely unparseable/uncatalogued district stays NULL, never guessed). Production
// verified after sync_search_listings_ar(): 30 of the 74 resolve to a real حي (attested in their
// city's canonical catalog); the other 44 correctly stay NULL (their city's district catalog does
// not yet cover that neighbourhood -- a catalog-coverage gap, not a bug). Confirmed through the REAL
// anon-key search RPC: filtering city تمير (167) by district ONLY ("حي الياسمين") now returns
// exactly the 2 previously-unreachable listings (8653490, 8321372).
//
//   node --experimental-strip-types scripts/verify-gathern-overlay-district-not-discarded.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const MIG_DIR = join(ROOT, 'supabase', 'migrations');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// Match the migration that DEFINES the fix by its unique fingerprint -- resolve_district_ar called
// against the exact additional_info fields the overlay already reads for city_id -- not merely one
// that mentions gathern or the overlay by name (the arm's ORIGINAL definition, in an earlier
// migration, mentions "gathern_additional_info_overlay" too and must not satisfy this check).
const FINGERPRINT = "resolve_district_ar((g.additional_info ->> ''resolved_city_id''";
const defining = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => readFileSync(join(MIG_DIR, f), 'utf8').includes(FINGERPRINT))
  .sort();

check('a migration defines the gathern-overlay district fix', defining.length > 0);
const sql = defining.length ? readFileSync(join(MIG_DIR, defining[defining.length - 1]), 'utf8') : '';

// ── 1. THE FIX TARGETS THE RIGHT VIEW, THE RIGHT COLUMN ─────────────────────────────────────────
check('#1 it rewrites listing_native_location_v2',
  /create or replace view public\.listing_native_location_v2/i.test(sql));
check('#1 the hardcoded NULL literal is the anchor being replaced (proves this is the discard site)',
  sql.includes("a1 := 'NULL::text AS district_ar,'"));

// ── 2. THE FIX GOES THROUGH THE VETTED RESOLVER, NEVER A RAW PASSTHROUGH ────────────────────────
// A naive "fix" that just forwards additional_info->>'district_ar' unchecked would serve an
// unattested/un-canonicalised string -- exactly what SOURCE IS TRUTH forbids inventing/guessing past.
const usesResolver = (table: string) =>
  new RegExp(
    `resolve_district_ar\\(\\(g\\.additional_info ->> ''resolved_city_id''::text\\)::integer, g\\.additional_info ->> ''district_ar''::text\\) AS district_ar\\s*\\n\\s*FROM ${table} g`,
  ).test(sql);
check('#2 the residential leg resolves through resolve_district_ar keyed on the SAME resolved city_id',
  usesResolver('gathern_residential_listings'));
check('#2 the commercial leg resolves through resolve_district_ar keyed on the SAME resolved city_id',
  usesResolver('gathern_commercial_listings'));
check('#2 the final column reads the lateral output, not a fresh unresolved expression',
  sql.includes("v_new := replace(v_def, a1, 'gth.district_ar AS district_ar,')"));

// ── 3. SURGICAL: anchors verified unique before mutating, refuses instead of guessing ───────────
// This repo's established pattern for view surgery (see 20260820205739_v2_city_ar_falls_back_to_
// canonical_catalog_label.sql) -- refuse rather than silently patch the wrong occurrence.
check('#3 refuses if the anchors are not exactly unique',
  /if n1 <> 1 or n2 <> 1 then\s*\n\s*raise exception 'REFUSED/.test(sql));
check('#3 refuses if the replacement produced no change',
  /if v_new = v_def then\s*\n\s*raise exception 'REFUSED: no change/.test(sql));

// ── 4. THE FIX MUST NOT WIDEN — every other catch-all arm stays untouched ───────────────────────
// lal_live_overlay / lal_region_scoped_overlay / unresolved_catchall have zero live rows today; this
// fix must not silently start resolving district for them without the same attestation review.
const body = sql.slice(sql.indexOf('do $$'));
check('#4 only the gathern additional_info arms are touched (residential + commercial, no others)',
  (body.match(/resolve_district_ar\(/g) ?? []).length === 2);

// ── 5. MUTATION PROOF — a naive raw-passthrough "fix" fails contract #2 ─────────────────────────
const mustCatch = (label: string, caught: boolean) => check(label, caught);
{
  const naiveMutant = `
    a2new := '...
            NULLIF(btrim(g.additional_info ->> ''district_ar''::text), '''') AS district_ar
           FROM gathern_residential_listings g ...';`;
  mustCatch('#5 a raw-passthrough mutant (no attestation check) is caught by contract #2',
    !/resolve_district_ar\(/.test(naiveMutant));

  // …and the mirror: the ACTUAL shipped fix text must NOT be caught by that same predicate — the
  // proof is not vacuously red on everything.
  const realFragment = "resolve_district_ar((g.additional_info ->> ''resolved_city_id''::text)::integer, g.additional_info ->> ''district_ar''::text) AS district_ar\n           FROM gathern_residential_listings g";
  mustCatch('#5 …while the real shipped fix is NOT flagged by the same predicate (not vacuously red)',
    /resolve_district_ar\(/.test(realFragment));
}

// ── 6. Wired into the suite ──────────────────────────────────────────────────────────────────────
check('#6 this check is discovered by npm test',
  npmTestRuns(ROOT, 'verify-gathern-overlay-district-not-discarded'));

console.log(failed === 0
  ? '\n✓ gathern_additional_info_overlay no longer discards a source-published district'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
