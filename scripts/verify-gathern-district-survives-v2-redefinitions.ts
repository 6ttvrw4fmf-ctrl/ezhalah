// PERMANENT BARRIER — a full redefinition of listing_native_location_v2 must keep resolving Gathern's
// source-published Arabic district (2026-10-04, New Listings Engineer).
//
// THE INCIDENT. 20260911213602 made the view's gathern_additional_info_overlay arm resolve
// additional_info->>'district_ar' through resolve_district_ar(). Later migrations (0913 ... 0927)
// re-created the whole view from a stale copy and put "NULL::text AS district_ar" back, so every NEW
// Gathern unit lost its district: 37 of 42 arrivals on 2026-10-04, while older ones kept theirs.
// Nothing failed: a lost value looks identical to a source that published none.
//
// THE RULE. Among committed migrations that (re)define listing_native_location_v2, the LATEST by
// version must still carry resolve_district_ar. A new full redefinition built from a stale copy
// is RED here at PR time. Mutation: delete 20261004073216 and this fails on 20260927051226.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'supabase', 'migrations');
const redefines = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ f, sql: readFileSync(join(dir, f), 'utf8') }))
  .filter(({ sql }) => /listing_native_location_v2/.test(sql) && /create or replace view/i.test(sql));

if (redefines.length === 0) {
  console.error('FAIL: no migration (re)defines listing_native_location_v2 — the barrier lost its subject');
  process.exit(1);
}
const latest = redefines[redefines.length - 1];
if (!/resolve_district_ar/.test(latest.sql)) {
  console.error(
    `FAIL: the latest redefinition of listing_native_location_v2 (${latest.f}) does not resolve Gathern's ` +
      'additional_info->>\'district_ar\' via resolve_district_ar(): every new Gathern unit would lose its district.',
  );
  process.exit(1);
}
console.log(`ok: latest v2 redefinition ${latest.f} keeps the Gathern district resolver`);
