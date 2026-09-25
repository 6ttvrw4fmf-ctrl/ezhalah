// Mutation proof for mon_detect_aqar_proven_wrong_resolution() and mon_detect_city_region_mismatch()
// (migration 20260925175109, 2026-09-25 full aqar-drift audit and 1,322-row repair).
//
// A detector that has never been watched fail is not proven — it might be checking the wrong thing
// and reading green by accident (see AGENTS.md's "read 0 for weeks while every barrier was green").
// This reproduces the EXACT historic bug shape on ONE real, already-repaired row (id=23460, the
// Dhahran/الظهران example from the session report): freezes it back to the wrong city the same way
// aqar_shadow_resolved was found frozen, confirms both detectors flip 0 -> >0, then restores the
// row's correct values and confirms they flip back to 0. try/finally guarantees the restore runs
// even if an assertion throws, so a failed run cannot leave the row mutated - see the migration's
// own commit message for the one time this script's author did that by hand mid-session and had to
// hand-repair it immediately.
//
// LIVE, WRITE-CAPABLE, NOT hermetic: requires SUPABASE_SERVICE_ROLE_KEY (RLS-bypassing writes to
// aqar_shadow_resolved / search_listings_ar). Deliberately excluded from `npm test` (see
// scripts/test-exclusions.txt) - the required suite must not need a privileged secret, and must not
// mutate production data on every unrelated PR.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types scripts/verify-aqar-drift-detectors-live.ts
//
// MUTATION-PROOF-EXEMPT: this file has no separate predicate of its own to run mustCatch(...)
// against — it IS the mutation proof. It deliberately corrupts a real production row into the exact
// historic bug shape, asserts the SQL detectors flip 0 -> nonzero, then restores the row and asserts
// they flip back to 0 (see assertEqual() calls below). That live mutate/measure/restore cycle is the
// same concept mustCatch() encodes for an in-process predicate, done here against a real database
// because the logic under proof (mon_detect_aqar_proven_wrong_resolution,
// mon_detect_city_region_mismatch) lives in Postgres, not in this file.
import { PUBLIC_SUPABASE_URL } from './lib/public-supabase.ts';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SERVICE_ROLE_KEY) {
  console.error('this mutation proof needs SUPABASE_SERVICE_ROLE_KEY (it writes to production tables, '
    + 'past RLS, inside a guarded try/finally) — an unset key is a FAILURE here, not a pass, because a '
    + 'scheduled proof that cannot run protects nothing.');
  process.exit(1);
}

const TEST_ROW = {
  src_table: 'aqar_residential_listings',
  id: 23460,
  correct_city_ar: 'الظهران',
  correct_city_id: 227,
  correct_region_ar: 'المنطقة الشرقية',
  correct_region_id: 5,
  wrong_city_ar: 'الدمام', // the exact frozen value this row carried before the 2026-09-25 repair
  wrong_city_id: 13,
  wrong_region_id_for_region_test: 1, // Riyadh - a real, different region, to trip the region check
};

async function rest(path: string, init: RequestInit) {
  const r = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const rpc = (fn: string) => rest(`rpc/${fn}`, { method: 'POST', body: '{}' }).then((v) => v as number);

async function setShadow(city_ar: string, city_id: number, region_ar: string) {
  await rest(
    `aqar_shadow_resolved?src_table=eq.${TEST_ROW.src_table}&id=eq.${TEST_ROW.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        city_ar_parsed: city_ar, parsed_city_id: city_id, region_ar_parsed: region_ar,
        today_city: city_ar, today_region: region_ar, today_city_id: city_id,
      }),
    },
  );
}

async function setSearchIndexRegion(region_id: number) {
  await rest(
    `search_listings_ar?source_table=eq.${TEST_ROW.src_table}&listing_id=eq.${TEST_ROW.id}&platform=eq.aqar`,
    { method: 'PATCH', body: JSON.stringify({ region_id }) },
  );
}

let failed = false;

async function assertEqual(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`${ok ? '✓' : '✗'} ${label}: got ${actual}, expected ${expected}`);
  if (!ok) failed = true;
}

try {
  await assertEqual('proven_wrong before mutation', await rpc('mon_detect_aqar_proven_wrong_resolution'), 0);
  await assertEqual('region_mismatch before mutation', await rpc('mon_detect_city_region_mismatch'), 0);

  // Mutate: reproduce the exact historic bug shape on this one real row.
  await setShadow(TEST_ROW.wrong_city_ar, TEST_ROW.wrong_city_id, TEST_ROW.correct_region_ar);
  await setSearchIndexRegion(TEST_ROW.wrong_region_id_for_region_test);

  await assertEqual('proven_wrong WHILE mutated (must catch it)', await rpc('mon_detect_aqar_proven_wrong_resolution'), 1);
  await assertEqual('region_mismatch WHILE mutated (must catch it)', await rpc('mon_detect_city_region_mismatch'), 1);
} finally {
  // Always restore, even if an assertion above threw - this row must never stay mutated.
  await setShadow(TEST_ROW.correct_city_ar, TEST_ROW.correct_city_id, TEST_ROW.correct_region_ar);
  await setSearchIndexRegion(TEST_ROW.correct_region_id);
}

await assertEqual('proven_wrong AFTER restore', await rpc('mon_detect_aqar_proven_wrong_resolution'), 0);
await assertEqual('region_mismatch AFTER restore', await rpc('mon_detect_city_region_mismatch'), 0);

if (failed) {
  console.error('✗ aqar drift detector mutation proof FAILED - see above.');
  process.exit(1);
}
console.log('✓ both detectors correctly flip 0 -> nonzero -> 0 against a real reproduced bug, and the test row is restored.');
