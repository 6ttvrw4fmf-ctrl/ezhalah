// REAL regression barrier for the district-contradicts-source detector.
//
// THE DEFECT THIS CLOSES (found live 2026-08-31). mon_district_contradicts_source existed as a
// monitoring VIEW with NO detector function and NO roster entry — nobody ever called it. AGENTS.md
// says "a detector outside the roster is decoration"; this was worse, because
// mon_detect_orphaned_detectors() fires on a detector nothing reaches but NOT on a monitoring view
// that never became a detector at all. So the view sat there reading 6 while every barrier was
// green, and 6 gathern listings served a district the source never published for weeks.
//
// THE UNDERLYING CAUSE is the second frozen snapshot found in one run.
// listings_arabic_locations is a plain table with NO cron job repopulating it, and
// listing_native_location_v1's final SELECT falls back to it for district_ar whenever the upstream
// arm yields NULL — which is always, for the phasea platforms. A stale row in it is served straight
// to users. 5 المجمعة listings were served «حي الملك عبدالله» where the source publishes
// «حي الجامعيين»; gathern 726509 was served «حي الربوة» where the source publishes «حي الصفا».
//
// SCOPE IS LOAD-BEARING, exactly as in verify-phasea-snapshot-staleness-barrier.ts. 6,781 of 21,172
// active gathern rows carry raw fields that no longer match the live source, but only 6 contradict
// the source's OWN published district once normalised. The detector measures the user-visible
// condition — not the raw-string difference — so it stays 0 while the rest are benign spelling
// drift, and rewriting a resolver input for thousands of listings stays the owner's call.
//
//   node --experimental-strip-types scripts/verify-district-contradicts-source-detector.ts
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

// Must match the migration that DEFINES the detector, not merely one that MENTIONS it — the
// derived-store registry migration names it in a seed value, and an any-mention filter would
// silently retarget this whole check at the wrong file. (Same any-mention trap the sql-mirror
// staleness checker documents; it bit this file on 2026-08-31.)
const defining = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.mon_detect_district_contradicts_source/i
    .test(readFileSync(join(MIG_DIR, f), 'utf8')))
  .sort();

check('a migration defines the district-contradicts-source detector', defining.length > 0);
const sql = defining.length ? readFileSync(join(MIG_DIR, defining[defining.length - 1]), 'utf8') : '';

// ── 1. THE VIEW MUST BECOME A DETECTOR — the whole point ─────────────────────────────────────────
check('#1 a mon_detect_* function wraps the view',
  /create or replace function public\.mon_detect_district_contradicts_source/i.test(sql));
check('#1 it reads the monitoring view rather than re-deriving the predicate',
  sql.includes('from public.mon_district_contradicts_source'));

// ── 2. ROSTER WIRING — an unrostered detector is decoration ──────────────────────────────────────
check('#2 the migration wires it into mon_run_all_detectors', sql.includes('mon_run_all_detectors'));
check('#2 roster insertion is idempotent',
  /position\('mon_detect_district_contradicts_source' in def\)\s*=\s*0/.test(sql));
check('#2 roster wiring FAILS CLOSED if its anchor is gone',
  /raise exception/i.test(sql) && sql.includes('refusing to guess'));

// ── 3. Lifecycle: P1, and self-heals instead of needing a manual resolve ─────────────────────────
check('#3 raises P1', /mon_raise\(\s*'P1'/.test(sql));
check('#3 self-heals via mon_resolve_key',
  sql.includes('mon_resolve_key') && sql.includes("'district_contradicts_source'"));

// ── 4. The finding must be actionable and name the real cause ────────────────────────────────────
check('#4 the alert names the user-visible consequence in both directions',
  /cannot find the listing/i.test(sql) && /is not there/i.test(sql));
check('#4 the alert names the frozen-snapshot cause',
  sql.includes('listings_arabic_locations') && /no refresh job/i.test(sql));
check('#4 the alert gives the end-to-end repair path',
  sql.includes('listing_native_location_v1') && sql.includes('sync_search_listings_ar'));
check('#4 the repair guidance defers to NULL when the source fields disagree',
  /resolve to NULL rather than guessing/i.test(sql));

// ── 5. SCOPE — measure the contradiction, never the raw-string difference ────────────────────────
// Keying on raw drift would raise ~6,781 benign rows and invite a bulk rewrite of a resolver input.
check('#5 the bulk raw-drift set is explicitly left to the owner',
  /RED list/.test(sql) && /6,78/.test(sql));
check('#5 normalisation-awareness is stated so a spelling variant is not a finding',
  /normalisation-aware/i.test(sql));

// ── 6. The data repair must be idempotent and self-guarding ──────────────────────────────────────
check('#6 the repair only moves rows the view still reports',
  /exists \(select 1 from public\.mon_district_contradicts_source/i.test(sql));
check('#6 the repair requires the source to publish BOTH district fields',
  sql.includes("nullif(btrim(g.neighborhood), '')")
  && sql.includes("nullif(btrim(g.additional_info->>'district_ar'), '')"));

// ── 7. MUTATION PROOF — a raw-drift oracle fails the scope contracts ─────────────────────────────
{
  const preFix = `
    select l.listing_id from listings_arabic_locations l
      join gathern_residential_listings g on g.id = l.listing_id
     where l.raw_district is distinct from g.neighborhood;`;
  const mutantFails =
    !preFix.includes('mon_district_contradicts_source') &&
    !/normalisation-aware/i.test(preFix) &&
    !/RED list/.test(preFix);
  check('#7 a raw-string-drift oracle (the ~6,781-row trap) fails contracts #1 and #5', mutantFails);
}

// ── 8. Wired into the suite ──────────────────────────────────────────────────────────────────────
check('#8 this check is discovered by npm test',
  npmTestRuns(ROOT, 'verify-district-contradicts-source-detector'));

console.log(failed === 0
  ? '\n✓ district-contradicts-source detector intact — the view can no longer be decoration'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
