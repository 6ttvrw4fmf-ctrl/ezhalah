// A listing the source 404s must never quietly stay in search — and the barrier that watches for it
// must never become a deletion path.
//
// THE INCIDENT (2026-08-12, Data Integrity run #14). gathern's liveness sweep re-fetched real listing
// URLs on three consecutive days and classified ~1,130 units DEAD (hard 404) every time:
//
//   08-10  APPLY scanned=3000 dead=1130 inactivated=0 strike=1130 alive=1870
//   08-11  APPLY scanned=1500 dead=1134 inactivated=0 strike=1134 alive=366
//   08-12  ANOMALY-CAPPED would_inactivate=1109 cap=150 — 0 rows inactivated; owner review required
//
// The kill cap refusing 1,109 inactivations in one sweep is CORRECT — that is the mass-deletion
// guard doing its job. What was missing is that nobody was told, so 1,107 listings whose source
// returns 404 stayed production_ready and clickable for three days. No alert named it: the open
// gathern alerts were about other things, and mon_detect_silent_scraper_death needs three
// consecutive BAD runs while 08-10 and 08-11 both reported ok=true. A capped or deadlocked liveness
// sweep was indistinguishable from a healthy one at the monitoring layer.
//
// WHAT THIS GUARD PROTECTS, and why each check exists:
//
//   • The detector must be WIRED in the same migration that creates it (AGENTS.md §11a) — an
//     unwired mon_detect_* is decoration and mon_detect_orphaned_detectors fires on it.
//   • The predicate must stay STRUCTURAL and enumerate every listing table dynamically. The
//     tempting shortcut is to grep scrape_runs.notes for "ANOMALY-CAPPED", which would only ever
//     work for the one platform that happens to print that string, or to hardcode `gathern`, which
//     is the §20 scope trap (a check JOINed to one platform silently scopes away the other 27).
//   • It must NEVER write to a listing table. This barrier reports a backlog whose resolution is a
//     bulk listing operation and therefore an owner decision (AGENTS.md RED list). A future edit
//     that "helpfully" makes it drain the backlog would convert a monitor into an unreviewed mass
//     inactivation — the exact thing the cap it reports on exists to prevent.
//   • Its alert text must not advise loosening the cap, for the same reason.
//   • It must self-heal, or the alert outlives the condition and stops carrying information.
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-served-after-source-gone-barrier.ts
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const DETECTOR = 'mon_detect_served_after_source_confirmed_gone';
const VIEW = 'mon_served_after_source_gone';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check(files.length > 100, `scanned ${files.length} migrations`,
  `only ${files.length} migration files found — the scan is not seeing the directory`);

const creators = files.filter((f) =>
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${DETECTOR}`, 'i')
    .test(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')));

check(creators.length >= 1,
  `${DETECTOR} is defined in ${creators.length} migration(s)`,
  `${DETECTOR} is not defined in any tracked migration — it would exist only in production, the ` +
  `schema drift AGENTS.md "Migration drift guard" forbids`);

if (creators.length) {
  const file = creators[creators.length - 1];
  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');

  // 1. Wired in the same migration. Trailing-identifier guard, not a bare substring: plain
  //    includes('mon_run_all_detectors') also matches mon_run_all_detectorsX.
  check(/mon_run_all_detectors(?![A-Za-z0-9_])/.test(sql),
    `${file} wires the detector into the roster in the same migration`,
    `${file} creates ${DETECTOR} without touching mon_run_all_detectors — an unwired detector is ` +
    `decoration and would be reported by mon_detect_orphaned_detectors`);

  check(sql.includes('pg_get_functiondef'),
    'the roster edit reads the live body via pg_get_functiondef (cannot drop entries it never read)',
    `${file} edits the roster without pg_get_functiondef — a hand-pasted body silently drops every ` +
    `detector the author's copy predates`);

  // 2. Structural predicate, every table, no hardcoded platform in the WHERE.
  check(sql.includes(VIEW),
    `the detector reads ${VIEW}`,
    `${file} no longer reads ${VIEW} — the structural predicate has been replaced`);

  check(/_\(residential\|commercial\)_listings\$/.test(sql),
    'the view enumerates every listing table dynamically (residential AND commercial, §20)',
    `${file} no longer enumerates listing tables by pattern — a hardcoded table list is the §20 ` +
    `scope trap that silently drops platforms as they are added`);

  check(sql.includes('missing_count') && sql.includes('last_seen_at'),
    'the predicate is structural (full strike grace + unseen window), not log-string parsing',
    `${file} no longer keys on missing_count/last_seen_at — if it now greps scrape_runs.notes for ` +
    `"ANOMALY-CAPPED" it only covers the one platform that prints that string`);

  // 3. THE IMPORTANT ONE: a monitor must never mutate listing rows.
  const body = sql.slice(sql.indexOf(DETECTOR));
  const mutates = /\b(update|delete\s+from|insert\s+into)\b[\s\S]{0,200}_(residential|commercial)_listings/i.test(body)
    || /\bset\s+active\s*=/i.test(body);
  check(!mutates,
    'the detector never writes to a listing table — it reports, the owner decides',
    `${file} makes ${DETECTOR} mutate listing rows. This barrier reports a backlog whose resolution ` +
    `is a bulk listing operation and an owner decision (RED list); draining it automatically would ` +
    `be an unreviewed mass inactivation — the very thing the kill cap it reports on prevents`);

  // 4. The alert must not coach the reader into loosening the safety gate.
  check(/do NOT loosen/i.test(sql),
    'the alert tells the reader to diagnose the deletion path, not to raise the cap',
    `${file} dropped the "do NOT loosen the cap" instruction — an alert that reads as "raise the ` +
    `cap" turns a safety gate into a nuisance to be silenced`);

  check(sql.includes('mon_resolve_key'),
    'resolves itself once a platform drains',
    `${file} never calls mon_resolve_key — the alert would outlive the condition`);
}

// 5. Worthless if nothing runs it.
const pkg = readFileSync('package.json', 'utf8');
check(pkg.includes('verify-served-after-source-gone-barrier'),
  'npm test runs this guard',
  'package.json no longer runs verify-served-after-source-gone-barrier.ts — the guard is inert');

console.log('served-after-source-gone-barrier: a 404 listing must not stay searchable unnoticed\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the served-after-gone barrier is unwired, ` +
    `narrowed, or has become a deletion path.`);
  process.exit(1);
}
console.log('\n✅ served-after-source-gone-barrier: passed.');
