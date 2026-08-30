// An adjudicated retraction must survive the jobs that reactivate rows.
//
// THE DEFECT THIS PINS. `auto_recover_false_inactive()` reactivates rows that are inactive with
// zero strikes — the signature of a listing flipped by something other than the strike ladder. An
// ADJUDICATED retraction has exactly that signature, and for the same reason: it was never struck,
// because a recorded decision was made about it instead. On 2026-08-30 the job had no adjudication
// exemption at all, and the 8 res/com URL-collision retractions (5 sadin, 3 dealapp) missed being
// reactivated by 55 minutes of crawl timing. An hour either way and the collision the repair had
// just fixed would have been live in search again the next morning.
//
// THE SHAPE OF THE MISTAKE, which is what actually needs pinning: the exemption elsewhere WAS
// written — `mon_unverified_inactivations_24h` exempted `ops_adjudicated_retraction` — and then a
// second ledger, `ops_res_com_collision_adjudication`, arrived. Nothing failed. The consumer went
// on exempting one ledger and silently stopped covering adjudications recorded in the other. A
// third ledger would have done it again.
//
// So the rule is not "remember both ledgers". It is: there is ONE view that answers "has this row
// been adjudicated", every consumer reads it, and no consumer reaches past it to a single ledger.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const MIGRATION = '20260830193119';
const VIEW = 'ops_adjudicated_listing';
const LEDGERS = ['ops_adjudicated_retraction', 'ops_res_com_collision_adjudication'];

// A ledger NAMED in prose is documentation; a ledger QUERIED is a reach-past. Strip `--` comments
// and whole `comment on ... is '...';` statements before asking which one a body actually uses —
// otherwise the view's own comment, which explains this very defect, reads as the defect.
const codeOnly = (s: string) =>
  s.replace(/--[^\n]*/g, '').replace(/comment on [\s\S]*?;\s*/gi, '');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-adjudication-is-never-undone: one ledger set, read by everything that flips rows.');

const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(MIGRATION));
check('the migration is mirrored in the repo', Boolean(file),
  `no file starting ${MIGRATION} — it is applied in production with no committed source`);
if (!file) {
  console.log('\n❌ verify-adjudication-is-never-undone: cannot continue without the migration.');
  process.exit(1);
}
const sql = readFileSync(join(MIGRATIONS, file), 'utf8');

// ── The union view exists and covers every ledger that identifies a listing row ────────────────
check(`${VIEW} is defined`, new RegExp(`create or replace view public\\.${VIEW}\\b`).test(sql));
const viewBody = sql.slice(sql.indexOf(`create or replace view public.${VIEW}`),
  sql.indexOf('create or replace function public.auto_recover_false_inactive'));
for (const ledger of LEDGERS) {
  check(`${VIEW} covers ${ledger}`, viewBody.includes(ledger),
    `a ledger outside the union is an adjudication every consumer will silently ignore`);
}
check(`${VIEW} unions rather than picking one ledger`, /\bunion\b/i.test(viewBody));

// ── The recovery job keys on the mistake, not on the crawl ─────────────────────────────────────
const recover = sql.slice(sql.indexOf('create or replace function public.auto_recover_false_inactive'),
  sql.indexOf('create or replace view public.mon_unverified_inactivations_24h'));
check('the recovery window is keyed on deactivated_at',
  /t\.deactivated_at >= now\(\) - \$1/.test(recover),
  'keyed on last_seen_at, the window is 24h minus however long ago the crawl ran — an accident of ' +
  'crawl timing that measured 55 minutes wide on 2026-08-30');
check('a row with no deactivated_at still has a fallback',
  /t\.deactivated_at is null and t\.last_seen_at >= now\(\) - \$1/.test(recover),
  'without it, a deactivation that never stamped deactivated_at becomes unrecoverable — and ' +
  'recovering a live listing is the safe direction');
check('the recovery job refuses to touch an adjudicated row',
  new RegExp(`not exists \\(select 1 from public\\.${VIEW}`).test(recover),
  'owner rule 2026-08-30: an adjudicated duplicate can never be auto-reactivated');

// ── Every consumer reads the view, and none reaches past it ────────────────────────────────────
const graded = sql.slice(sql.indexOf('create or replace view public.mon_unverified_inactivations_24h'),
  sql.indexOf('create or replace function public.mon_detect_adjudicated_reactivation'));
check('the inactivation monitor reads the same ledger set', graded.includes(VIEW),
  `it exempted only ${LEDGERS[0]} and therefore graded all 8 res/com retractions as unverified`);
for (const consumer of [['recovery job', recover], ['inactivation monitor', graded]] as const) {
  const [label, body] = consumer;
  const direct = LEDGERS.filter((l) => codeOnly(body).includes(l));
  check(`the ${label} does not reach past the view to a single ledger`, direct.length === 0,
    `references ${direct.join(', ')} directly — that is exactly how the second ledger got missed`);
}

// ── The barrier that proves the exemption held ─────────────────────────────────────────────────
check('a detector checks no adjudicated row came back active',
  /create or replace function public\.mon_detect_adjudicated_reactivation/.test(sql),
  'an exemption nothing verifies is an intention, not a guarantee');
check('that detector is spliced into the mon_run_all_detectors roster',
  sql.includes("''mon_detect_adjudicated_reactivation''"),
  'a detector nothing calls is decoration');
check('the roster edit refuses rather than silently no-opping if its anchor moved',
  /raise exception 'roster anchor not found/.test(sql));
check('the detector can clear itself once the condition is gone',
  /mon_resolve_key\('adjudicated_reactivation'/.test(sql),
  'an alert kind nothing can clear is a ratchet, and mon_detect_unresolvable_alert_kinds ' +
  'would be right to say so');

check('this barrier is discovered and run by npm test',
  npmTestRuns(ROOT, 'verify-adjudication-is-never-undone'));

console.log(
  failures === 0
    ? '\n✅ verify-adjudication-is-never-undone: all checks passed.'
    : `\n❌ verify-adjudication-is-never-undone: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
