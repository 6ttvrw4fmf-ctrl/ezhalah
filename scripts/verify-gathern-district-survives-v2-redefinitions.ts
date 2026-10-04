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
// is RED here at PR time.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Mig = { f: string; sql: string };
const dir = join(process.cwd(), 'supabase', 'migrations');
const all: Mig[] = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ f, sql: readFileSync(join(dir, f), 'utf8') }));

/** Problems with the migration set: the latest v2 redefinition must keep the Gathern district resolver. */
function problems(migs: Mig[]): string[] {
  const redefines = migs.filter(({ sql }) => /listing_native_location_v2/.test(sql) && /create or replace view/i.test(sql));
  if (redefines.length === 0) return ['no migration (re)defines listing_native_location_v2 — the barrier lost its subject'];
  const latest = redefines[redefines.length - 1];
  return /resolve_district_ar/.test(latest.sql) ? [] : [
    `the latest redefinition of listing_native_location_v2 (${latest.f}) does not resolve Gathern's additional_info->>'district_ar' via resolve_district_ar(): every new Gathern unit would lose its district`,
  ];
}

let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

check('the latest listing_native_location_v2 redefinition keeps the Gathern district resolver', problems(all));
// Mutation: without the 2026-10-04 fix the latest redefinition is the stale 0927 copy, which must go RED.
mustCatch('a stale full redefinition (the 2026-10-04 fix removed)', problems(all.filter((m) => !m.f.startsWith('20261004073216'))));
// Mutation: a NEW redefinition from a stale copy, added after the fix, must go RED too.
mustCatch('a future stale redefinition', problems([...all, { f: '99999999999999_stale_copy.sql', sql: 'create or replace view public.listing_native_location_v2 as select NULL::text AS district_ar' }]));
console.log(failed ? `\n${failed} FAILED` : '\nAll Gathern-district-survival assertions passed');
process.exit(failed ? 1 : 0);
