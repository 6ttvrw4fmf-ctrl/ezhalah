// CI invariant (audit item 6, owner-approved 2026-07-27): the LIVE type allowlist
// (public.known_type_ar) must equal the committed repo seed (sql/known_type_ar.generated.sql),
// which the taxonomy gate already proves equal to the UI hierarchy, RPC vocabulary and ingestion
// maps. This closes the last drift leg: a live-only allowlist edit (the +4 rows found by the
// 2026-07-27 audit) now fails CI instead of sitting invisible. New raw values stay quarantined by
// detect_novel_property_types() (pg_cron jobid 33) — reviewed, never silently defaulted.
//   node --experimental-strip-types scripts/verify-live-canon-sync.ts   (wired into `npm test`)
// Network note: reads the PUBLIC anon REST endpoint. If the network is unavailable the check is
// SKIPPED WITH A LOUD WARNING (exit 0) — offline builds must not false-fail; CI has network.
import { readFileSync } from 'node:fs';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from './lib/public-supabase.ts';

// Same committed PUBLIC constants this file used to inline — now shared, so the key lives in ONE
// place and the copies cannot drift apart (2026-08-10).
const ANON = PUBLIC_SUPABASE_ANON_KEY;
const URL_ = `${PUBLIC_SUPABASE_URL}/rest/v1/known_type_ar?select=type_ar,macro&limit=1000`;

const seedSql = readFileSync(new URL('../sql/known_type_ar.generated.sql', import.meta.url), 'utf8');
const seed = new Map<string, string>();
for (const m of seedSql.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g))
  seed.set(m[1].replace(/''/g, "'").normalize('NFC'), m[2].replace(/''/g, "'"));

let live: Array<{ type_ar: string; macro: string }>;
try {
  const r = await fetch(URL_, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  live = await r.json();
} catch (e) {
  console.warn(`⚠ live-canon-sync SKIPPED (network unavailable: ${e}) — run again with network; CI must not skip.`);
  process.exit(0);
}

const problems: string[] = [];
const liveMap = new Map(live.map((r) => [r.type_ar.normalize('NFC'), r.macro]));
for (const [t, m] of liveMap) {
  if (!seed.has(t)) problems.push(`LIVE-ONLY row (repo seed missing): «${t}» (${m}) — mirror it or remove it`);
  else if (seed.get(t) !== m) problems.push(`macro drift: «${t}» live=${m} seed=${seed.get(t)}`);
}
for (const [t, m] of seed) if (!liveMap.has(t)) problems.push(`SEED-ONLY row (not applied to live): «${t}» (${m})`);

if (problems.length) {
  console.error(`✗ live known_type_ar ≠ repo seed (${problems.length} drift(s)):`);
  for (const p of problems) console.error('   ' + p);
  process.exit(1);
}
console.log(`✓ live-canon-sync: live known_type_ar == repo seed (${seed.size} labels, incl. the «غير معروف» sentinel)`);
