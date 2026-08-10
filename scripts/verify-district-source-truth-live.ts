// LIVE regression barrier for the audit-2026-08-10 district fix: a district we DISPLAY must never
// name a different district than the one the source published.
//
// What went wrong. gathern publishes its district twice — an Arabic value in
// additional_info->>'district_ar' (authoritative) and an English transliteration in `neighborhood`.
// Two separate paths let the English side win:
//   1. refresh_district_recovery()'s English arm resolved 'al dariyah' → 'حي البرية' via
//      bridge_en_district (consonant similarity, d vs ب) while the source plainly said 'الدرعية'.
//      The mapping was attested in no migration — it was self-confirming, because
//      refresh_district_name_bridge() re-learns EN→AR pairs by reading back the resolver's own output.
//   2. the legacy listings_arabic_locations overlay carried 'حي الزهرة' where the source said
//      'حي الظاهرة' (both are real, distinct districts of المدينة المنورة).
// 258 rows displayed a district the source contradicted. Now 0.
//
// The rule this pins: source wins; when the source's district is not attested in the listing's city
// the district is NULL. We never substitute a different district — unknown stays unknown.
//
// NOT wired into `npm test` (CI has no network/DB). Run after any district/location migration and
// from the daily production audit:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-district-source-truth-live.ts

import { resolvePublicSupabase } from './lib/public-supabase.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function count(path: string): Promise<number> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { ...HEADERS, Prefer: 'count=exact' },
  });
  if (!res.ok && res.status !== 206) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`no count for ${path}`);
  return total;
}

async function rows<T>(path: string): Promise<T[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T[];
}

let failed = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
};

// 1. The barrier view must be empty. Any row = a guess is overruling source truth again.
const contradictions = await count('mon_district_contradicts_source?select=listing_id&limit=1');
check(
  'no listing displays a district the source contradicts',
  contradictions === 0,
  `mon_district_contradicts_source = ${contradictions} rows`,
);

if (contradictions > 0) {
  const sample = await rows<{ platform: string; listing_id: number; source_says: string; we_display: string }>(
    'mon_district_contradicts_source?select=platform,listing_id,source_says,we_display&limit=5',
  );
  for (const r of sample) {
    console.log(`      ${r.platform}/${r.listing_id}: source="${r.source_says}" displayed="${r.we_display}"`);
  }
}

// 2. The specific pair that started it: 'al dariyah' must not resolve to البرية (or anything else).
//    The source says الدرعية, which is a CITY, not a الرياض district → the honest answer is NULL.
const dariyah = await rows<{ en_norm: string; district_norm: string | null }>(
  'bridge_en_district?select=en_norm,district_norm&en_norm=eq.dariyah',
);
check(
  "bridge no longer maps 'dariyah' to a district",
  dariyah.length === 0 || dariyah[0].district_norm === null,
  dariyah.length === 0 ? 'pair absent' : `maps to ${dariyah[0].district_norm}`,
);

// 3. Guard against over-correction: the fix must not have wiped district coverage wholesale.
//    Districts are still resolved for the overwhelming majority of rows that publish one.
const withSource = await count('listing_source_district_ar?select=listing_id&limit=1');
const gathernFilled = await count(
  'search_listings_ar?select=listing_id&platform=eq.gathern&district_ar=not.is.null&limit=1',
);
const pct = withSource > 0 ? (100 * gathernFilled) / withSource : 0;
check(
  'district coverage stayed healthy after enforcing source truth',
  pct >= 90,
  `${gathernFilled}/${withSource} = ${pct.toFixed(1)}% (floor 90%)`,
);

console.log(
  failed === 0
    ? '\n✓ displayed district always agrees with the source — unknown stays unknown, never a substitute'
    : `\n✗ ${failed} check(s) FAILED — a derived district is overruling source truth`,
);
process.exit(failed === 0 ? 0 : 1);
