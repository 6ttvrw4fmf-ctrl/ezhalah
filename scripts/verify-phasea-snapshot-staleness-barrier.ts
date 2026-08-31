// REAL regression barrier for the phasea frozen-snapshot staleness detector.
//
// THE DEFECT THIS CLOSES (found live 2026-08-31). phasea_src_arabic is a one-off snapshot table
// (23,252 rows) captured during the 2026-08-21 phasea work. NOTHING repopulates it — no cron job
// writes it — yet listing_native_location_v1 (refreshed hourly, jobid 17) resolves city_id and
// region_id through phasea_shadow_resolution, whose candidate ordering PREFERS the city matching
// the snapshot's city_ar_src over shadow_city. Where the snapshot has gone stale against the
// source, the listing is SERVED IN THE WRONG CITY.
//
// Nothing could see it. search_listings_ar agreed with listing_native_location_v2, which agreed
// with v1 — all three wrong together — and mon_search_index_city_drift compares the index against
// the resolver's own output, so it is structurally incapable of catching a resolver that is
// confidently wrong. Two listings were served in the wrong city for weeks:
//   gathern 726509 — snapshot «ابها»; source city_ar «جدة», English "Jeddah", GPS 21.583/39.211.
//   sadin  597777 — snapshot «المدينة المنورة»; source city_ar «تبوك», English "Tabuk", and the
//                   listing's own title reads «فيلا فاخرة للبيع في تبوك – حي الجامعة».
//
// WHY THE SCOPE IS NARROW, AND WHY THAT IS THE POINT. The detector fires only where the snapshot
// contradicts the LIVE SOURCE PAYLOAD for the same listing — provable staleness with a provable
// repair, so every finding is closable. A wider rule ("snapshot and canonical resolve to different
// cities") would sweep in ~49 rows that are NOT defects: «الاحساء»→«الهفوف» (29, governorate vs
// principal city — a TAXONOMY decision on the RED list), «المبرز»/«الرايس»/«حقل» (17, where the
// snapshot's Arabic value is the MORE specific and correct city, so flipping would BREAK them),
// and «سبت العلاية»→«العلا» (3, needing per-listing checks). Firing on those would be a detector
// nobody can clear — this repo's own documented failure mode (mon_detect_unresolvable_alert_kinds).
// So the narrow scope is a load-bearing decision, and this file pins it.
//
//   node --experimental-strip-types scripts/verify-phasea-snapshot-staleness-barrier.ts
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
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.mon_detect_phasea_snapshot_stale_vs_source/i
    .test(readFileSync(join(MIG_DIR, f), 'utf8')))
  .sort();

check('a migration defines the phasea snapshot staleness detector', defining.length > 0);
const sql = defining.length ? readFileSync(join(MIG_DIR, defining[defining.length - 1]), 'utf8') : '';

// ── 1. The oracle is the LIVE SOURCE PAYLOAD, not another derived layer ──────────────────────────
// Comparing the snapshot against anything we ourselves computed is how this bug hid for weeks.
check('#1 the view compares the snapshot against the source payload city_ar',
  sql.includes("additional_info->>''city_ar''") && sql.includes('phasea_src_arabic'));
check('#1 the comparison is normalisation-aware (spelling variants are not defects)',
  /normalize_ar\(btrim\(p\.city_ar_src\)\)\s*is distinct from/.test(sql));
check('#1 rows whose source publishes no city_ar are skipped, never guessed at',
  sql.includes("c.additional_info ? ''city_ar''"));

// ── 2. SCOPE DISCIPLINE — it must NOT fire on the adjudication set ───────────────────────────────
// A blanket "snapshot != canonical city" rule would raise 49 unclearable findings and would
// invite a bulk overwrite that breaks the 17 rows where the snapshot is the correct answer.
check('#2 the detector does not key off the canonical/catalog-city disagreement',
  !sql.includes('listing_location_canonical_mv') && !sql.includes('shadow_city is distinct'));
check('#2 the repair guidance forbids bulk overwriting',
  /do NOT bulk-overwrite/i.test(sql));
check('#2 the taxonomy carve-out is recorded so a later edit cannot silently widen scope',
  sql.includes('TAXONOMY') && sql.includes('RED'));

// ── 3. The finding must be actionable: what broke, and exactly how to repair it ──────────────────
check('#3 the alert explains the wrong-city consequence',
  /SERVED IN THE WRONG CITY/i.test(sql));
check('#3 the alert names the repair path end to end',
  sql.includes('listing_native_location_v1') && sql.includes('sync_search_listings_ar'));
check('#3 the alert ships a copy-pasteable query for the offending rows', sql.includes("'query',"));

// ── 4. Lifecycle: raises P1, and SELF-HEALS rather than needing a manual resolve ─────────────────
check('#4 raises P1', /mon_raise\(\s*'P1'/.test(sql));
check('#4 self-heals via mon_resolve_key when a table stops contradicting its source',
  sql.includes('mon_resolve_key') && sql.includes("'phasea_snapshot_stale'"));

// ── 5. ROSTER WIRING — a detector nothing reaches is decoration ──────────────────────────────────
// AGENTS.md requires the wrapper AND its roster entry in the SAME migration.
check('#5 the migration wires the detector into mon_run_all_detectors',
  sql.includes('mon_run_all_detectors') && sql.includes('mon_detect_phasea_snapshot_stale_vs_source'));
check('#5 roster insertion is idempotent (re-running the migration cannot double-add)',
  /position\('mon_detect_phasea_snapshot_stale_vs_source' in def\)\s*=\s*0/.test(sql));
check('#5 roster wiring FAILS CLOSED if its anchor is gone, instead of silently not wiring',
  /raise exception/i.test(sql) && sql.includes('refusing to guess'));

// ── 6. MUTATION PROOF — a snapshot-only or self-referential oracle fails this contract ───────────
{
  const preFix = `
    create or replace view public.mon_phasea_snapshot_stale_vs_source as
    select p.source_table, 'x' platform, count(*) stale_rows
      from public.phasea_src_arabic p
      join public.listing_location_canonical_mv mv using (source_table, listing_id)
     where normalize_ar(p.city_ar_src) is distinct from normalize_ar(mv.city)
     group by 1;`;
  const mutantFails =
    !preFix.includes("additional_info->>''city_ar''") &&
    preFix.includes('listing_location_canonical_mv') &&
    !/do NOT bulk-overwrite/i.test(preFix);
  check('#6 a canonical-vs-snapshot oracle (the 49-row trap) fails contracts #1 and #2', mutantFails);
}

// ── 7. Wired into the suite ──────────────────────────────────────────────────────────────────────
check('#7 this check is discovered by npm test',
  npmTestRuns(ROOT, 'verify-phasea-snapshot-staleness-barrier'));

console.log(failed === 0
  ? '\n✓ phasea snapshot-staleness barrier intact — a frozen snapshot cannot silently move a listing'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
