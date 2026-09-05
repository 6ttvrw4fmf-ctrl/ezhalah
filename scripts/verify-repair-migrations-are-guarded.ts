// A DATA REPAIR MUST SHIP WITH SOMETHING THAT WATCHES IT.
//
// The incident this generalises (2026-08-23). Migration 20260721104637 repaired 1,015 aqarmonthly
// districts whose city name had been glued on by a delimiter-less source slug. It worked. It shipped
// no detector. The parser guard that was supposed to hold the line implemented a WEAKER rule than
// the repair did — raw token comparison instead of normalised, and no abbreviated-city rule — so
// every re-scrape quietly re-corrupted rows the migration had just fixed. Nobody noticed for a
// month, and it only surfaced because someone happened to ask an unrelated question about the file.
//
// The lesson is not about districts. It is that a one-shot repair is a CLAIM about an invariant, and
// an unwatched claim decays. The repair proves the invariant held for one instant; only a standing
// detector proves it still holds. The repo already enforces the mirror image of this —
// mon_detect_orphaned_detectors() catches a detector nothing reaches — so this closes the other
// half: a repair nothing detects.
//
// THE RULE. A migration at or after the strict-era baseline that performs a data repair (an UPDATE
// executed at migration time, as opposed to one merely defined inside a function body) must ALSO
// either:
//   * reference a mon_detect_* detector — normally by creating one and wiring it to the roster, or
//   * appear in WAIVED below with a real reason.
//
// Enforcement starts at REPAIR_GUARD_BASELINE (the day the rule landed). Seven earlier listing
// repairs are unguarded; they are NOT waived — inventing reasons for them would be exactly the
// mute-button behaviour this file exists to prevent. They are pinned in KNOWN_BACKLOG instead, so
// they stay visible on every run and can be triaged deliberately. Pinning them also stops the
// baseline being gamed: a new repair slipped in under a backdated filename changes the set and
// fails the build.
//
//   node --experimental-strip-types scripts/verify-repair-migrations-are-guarded.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COMMITTED_NOT_APPLIED_BASELINE } from './lib/migrationDrift.ts';

const root = join(import.meta.dirname, '..');
const MIGRATIONS = join(root, 'supabase', 'migrations');

// Repairs that legitimately need no standing detector. A waiver is a REASON, not a mute button:
// state why the invariant cannot decay, or which existing detector already covers it.
const WAIVED: Record<string, string> = {
  // The repair and the detector that watches its class landed as two migrations one minute apart,
  // so the repair file itself never reaches a mon_detect_* in executed SQL. The class IS watched:
  // 20260824115704 re-asserts this exact UPDATE idempotently and then calls
  // mon_detect_fabricated_unpublished_amenity(), which is on the mon_run_all_detectors() roster and
  // runs twice an hour. Open that companion to check this reason rather than taking it on trust.
  '20260824114314_defabricate_probed_aqar_non_villa_maid_driver.sql':
    'watched by its companion 20260824115704_defabrication_reruns_its_watching_detector.sql, which '
    + 're-asserts the same UPDATE and re-runs mon_detect_fabricated_unpublished_amenity()',
  // Same two-migrations-minutes-apart shape, recovered from production during the 2026-08-29 drift
  // sweep. The un-gate repair (an UPDATE flipping production_ready for archive-proven prices) was
  // caught by THIS barrier on PR #1198, and its author shipped the guard as the companion migration:
  // 20260828230419 creates mon_detect_price_source_evidence_stale(), needle-edits it into the
  // mon_run_all_detectors() roster, RE-ASSERTS this exact UPDATE idempotently, and runs the detector
  // in the same migration. The companion's own header says all of this — open it to check this
  // reason rather than taking it on trust.
  '20260828225740_ungate_the_archive_proven_extreme_price_rows.sql':
    'watched by its companion 20260828230419_price_source_evidence_must_keep_holding_and_reassert_'
    + 'the_ungate.sql, which re-asserts the same UPDATE and ships + rosters + runs '
    + 'mon_detect_price_source_evidence_stale()',
  // Third instance of the two-migrations-minutes-apart shape. The repair retires the residential
  // half of 8 res/com URL collisions (one source ad, two production_ready rows, two cards, one
  // destination URL); its companion 20260830140831 ships the detector seven minutes later, so the
  // repair file itself never reaches a mon_detect_* in executed SQL.
  //
  // Unlike the two waivers above, the companion does NOT re-assert the repair's UPDATE — and
  // deliberately so. Those repairs needed re-assertion because their detectors watch a CLASS
  // (fabricated amenities, stale price evidence) and so cannot tell whether that particular repair
  // still holds. This companion's detector watches THIS REPAIR SPECIFICALLY: it reads the
  // ops_res_com_collision_adjudication ledger the repair wrote and fires the moment any row that
  // repair retired is active again while its commercial sibling still is. That is strictly stronger
  // than a re-assertion, which would only correct drift at deploy time; this runs twice an hour.
  // It is rostered into mon_run_all_detectors and mutation-proved inside its own migration (it
  // reactivates a retired row, asserts the detector fires, then puts the row back). Open that
  // companion to check this reason rather than taking it on trust.
  '20260830140110_res_com_url_collision_repair.sql':
    'watched by its companion 20260830140831_res_com_collision_repair_regression_detector.sql, '
    + 'which ships + rosters + mutation-proves mon_detect_res_com_collision_repair_regression() — a '
    + 'detector that watches THIS repair (the adjudication ledger it wrote), not just its class',
  // Fourth instance of the two-migrations-minutes-apart shape, and the first one this barrier could
  // only ever have seen AFTER the mirror was repaired: all six of the 2026-09-05 migrations were
  // applied to production and never committed, so while the drift was open this file did not exist
  // in git and the barrier could not weigh it at all. That is the drift-blinds-barriers shape in
  // miniature — the check was green because the evidence was missing, not because the rule held.
  //
  // The repair (incident #38) re-annualises 130 muktamel rent rows whose scraper stored the RAW
  // monthly figure in the yearly price_annual column, so the app's /12 rendered them at a twelfth of
  // the advertised rent. Its detector lands 3 minutes later in 20260905071148, so the repair file
  // itself never reaches a mon_detect_* in executed SQL.
  //
  // Same reasoning as the first two waivers: the detector watches a CLASS (a whole platform's
  // monthly-rent cohort sitting below a 500 SAR/month median), so it cannot by itself tell whether
  // this particular repair still holds — which is why the companion RE-ASSERTS it. Re-assertion
  // matters more here than in any prior case: gh-muktamel-weekly (cron jobid 14) is active=false, so
  // no future crawl will ever re-correct these rows, and the ledger's price_before/price_after are
  // the only record of what the source actually published. Open the two companions to check this
  // reason rather than taking it on trust.
  '20260905070828_repair_muktamel_raw_monthly_rent_stored_in_price_annual.sql':
    'watched by its companions 20260905071148_barrier_a_whole_platform_monthly_rent_cohort_that_was_'
    + 'never_annualised.sql, which ships + rosters mon_detect_unannualised_rent_cohort(), and '
    + '20260905072446_rent_annualisation_repair_reasserts_itself_and_runs_its_watching_detector.sql, '
    + 'which re-asserts the same UPDATE idempotently from the ops_rent_annualisation_repair ledger '
    + 'and runs that detector',
  // A different shape from the three above: this one is NOT A REPAIR AT ALL. Its statement is
  // `update search_listings_ar set city_id = city_id where city_id in (3677, 12)` — a self
  // assignment. It writes each row's existing value back over itself and therefore cannot change,
  // correct or destroy any listing data; there is no repaired state for a detector to watch decay.
  // Its only purpose is to fire the BEFORE INSERT OR UPDATE trigger set_match_city_ids so
  // composite_match_city_ids() recomputes match_city_ids for the two clustered cities. The real
  // change in that migration is two rows inserted into loc_city_cluster, which is catalog/config,
  // not listing data — the classifier's own "bookkeeping and config writes are not repairs" rule.
  // Verify by reading the statement: if it ever stops being `city_id = city_id`, this waiver is
  // wrong and must be replaced by a detector.
  '20260831195108_cluster_al_ahsa_hofuf_so_each_name_finds_the_other.sql':
    'not a repair — the UPDATE is a self-assignment (city_id = city_id) that exists solely to fire '
    + 'the set_match_city_ids trigger; it writes each row its own existing value, so no listing '
    + 'data changes and there is no repaired state to decay',
};

// Enforcement starts here — the day this rule landed.
const REPAIR_GUARD_BASELINE = '20260823000000';

// Unguarded listing repairs that predate the rule. Visible, not forgiven.
const KNOWN_BACKLOG = [
  '20260815063640_senior_run21_price_source_verified_and_aqar_ppm_copy_repair.sql',
  '20260815072254_aqar_rent_period_probed_verdict_repair_and_rent_period_text_barrier.sql',
  '20260817225546_retract_dealapp_misclassified_residential_duplicates.sql',
  '20260820205258_aqar_commercial_amenity_source_probe_and_defabrication.sql',
  '20260821224203_retract_road_name_city_aqarcity_4573610.sql',
  '20260822063503_retract_unpublished_price_aqar_6686450.sql',
  '20260822072730_restore_four_source_live_gathern_listings.sql',
];

/** Strip `create [or replace] function … $tag$ body $tag$` spans. An UPDATE inside a function body
 *  is a definition, not an execution — it only repairs data when something calls it. A `do $$ … $$`
 *  block is deliberately NOT stripped: that runs at migration time, and is how most repairs (the
 *  aqarmonthly one included) are actually written. */
function executedSql(sql: string): string {
  let out = '';
  let i = 0;
  const fnStart = /create\s+(or\s+replace\s+)?function\b/gi;
  for (;;) {
    fnStart.lastIndex = i;
    const m = fnStart.exec(sql);
    if (!m) { out += sql.slice(i); break; }
    out += sql.slice(i, m.index);
    const tag = /\$([A-Za-z_]*)\$/.exec(sql.slice(m.index));
    if (!tag) { out += sql.slice(m.index); break; }
    const open = m.index + tag.index + tag[0].length;
    const close = sql.indexOf(tag[0], open);
    if (close === -1) { break; }            // unterminated: treat the rest as function body
    i = close + tag[0].length;
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

/** Tables whose rows a scraper re-writes. THIS is the decay mechanism: a config or registry row
 *  stays where you put it, but a repaired LISTING row gets overwritten by the next scrape of that
 *  listing — so a listing repair is exactly the kind whose invariant can silently come undone, and
 *  exactly the kind that needs something standing watch. */
const LISTING_TABLE = /(^|_)listings$|^search_listings_ar$|^listing_[a-z0-9_]+$/;

/** Does this migration EXECUTE a repair of listing data? */
export function repairsData(sql: string): boolean {
  const body = executedSql(stripComments(sql));
  const re = /\bupdate\s+(?:only\s+)?([a-z_][a-z0-9_.]*)/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const t = m[1].toLowerCase().replace(/^public\./, '');
    if (LISTING_TABLE.test(t)) return true;
  }
  return false;
}

export function isGuarded(sql: string): boolean {
  return /mon_detect_[a-z0-9_]+/i.test(stripComments(sql));
}

const version = (f: string) => (f.match(/^(\d{8,14})/)?.[1] ?? '').padEnd(14, '0');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nEvery data repair must ship with something that watches it\n');

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const offenders: string[] = [];
const backlog: string[] = [];
let repairs = 0;

for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
  if (!repairsData(sql)) continue;
  if (version(f) < COMMITTED_NOT_APPLIED_BASELINE) continue;   // pre strict-era: out of scope entirely
  repairs++;
  if (isGuarded(sql) || f in WAIVED) continue;
  (version(f) >= REPAIR_GUARD_BASELINE ? offenders : backlog).push(f);
}

check(`enforcement baseline sits at or after the strict era (${REPAIR_GUARD_BASELINE})`,
  REPAIR_GUARD_BASELINE >= COMMITTED_NOT_APPLIED_BASELINE);
check(`every NEW listing repair is watched by a detector or explicitly waived (${repairs} in-era repairs)`,
  offenders.length === 0,
  offenders.length
    ? `unguarded:\n        ${offenders.join('\n        ')}\n      Add a mon_detect_* detector wired to mon_run_all_detectors, or add a reasoned waiver.`
    : '');
// Pinning the backlog is what stops the baseline being used as an escape hatch: any NEW unguarded
// repair landing with a pre-baseline filename shows up here as an unexpected entry.
check(`the pre-rule backlog is exactly the ${KNOWN_BACKLOG.length} known files (no backdating past the baseline)`,
  backlog.length === KNOWN_BACKLOG.length && backlog.every((f) => KNOWN_BACKLOG.includes(f)),
  `expected ${KNOWN_BACKLOG.length}, found ${backlog.length}:\n        ${backlog.filter((f) => !KNOWN_BACKLOG.includes(f)).join('\n        ') || '(same set)'}`);
if (backlog.length) {
  console.log(`\n  NOTE  ${backlog.length} listing repairs predate this rule and remain unwatched — visible, not forgiven:`);
  for (const f of backlog) console.log(`          ${f}`);
}
check('no waiver is left without a reason',
  Object.entries(WAIVED).every(([, why]) => why.trim().length > 20));

// The incident itself, pinned as a fixture: the migration that started this must be recognised as a
// repair, and must be recognised as UNGUARDED — if the classifier ever stops seeing it, the barrier
// has gone blind to the very case it was built for. (It is pre-baseline, so it is not an offender.)
const origin = files.find((f) => f.startsWith('20260721104637'));
check('the 2026-07-21 aqarmonthly backfill is still classified repair-and-unguarded (the fixture)',
  !!origin && repairsData(readFileSync(join(MIGRATIONS, origin), 'utf8'))
          && !isGuarded(readFileSync(join(MIGRATIONS, origin), 'utf8')));
const fixed = files.find((f) => f.endsWith('_aqarmonthly_district_suffix_canonical_guard.sql'));
check('its 2026-08-23 replacement IS classified as guarded',
  !!fixed && repairsData(readFileSync(join(MIGRATIONS, fixed), 'utf8'))
          && isGuarded(readFileSync(join(MIGRATIONS, fixed), 'utf8')));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the classifier must not be fooled\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND: ${label}`);
};

mustCatch('a bare backfill is flagged as an unguarded repair',
  repairsData('update aqarmonthly_residential_listings set district_ar = x;') === true
  && isGuarded('update aqarmonthly_residential_listings set district_ar = x;') === false);
mustCatch('a repair inside a do-block still counts as executed',
  repairsData('do $mig$ begin update search_listings_ar set district_ar = y; end $mig$;') === true);
mustCatch('an UPDATE merely DEFINED in a function body is not a repair',
  repairsData(`create or replace function f() returns int language plpgsql as $fn$
     begin update search_listings_ar set district_ar = y; return 1; end $fn$;`) === false);
mustCatch('a repair that ships a detector passes',
  isGuarded(`update t set c = 1;
     create or replace function public.mon_detect_thing() returns int language sql as $$ select 0 $$;`) === true);
mustCatch('bookkeeping and config writes are not "repairs" (they cannot be re-scraped over)',
  repairsData('update ops_daily_engineer_run set finished_at = now();') === false
  && repairsData('update mon_config set v = 1;') === false
  && repairsData('update af_field_registry set exposed = true;') === false
  && repairsData('update platform_cadence set expected_hours = 48;') === false);
mustCatch('every listing-table shape is recognised',
  repairsData('update aqarmonthly_residential_listings set x=1;')
  && repairsData('update search_listings_ar set x=1;')
  && repairsData('update listing_extra_attrs set x=1;'));
mustCatch('a detector named only in a COMMENT does not count as guarding',
  isGuarded('-- TODO: add mon_detect_thing later\nupdate t set c = 1;') === false);
mustCatch('the era filter actually excludes pre-baseline files',
  version('20260721104637_x.sql') < COMMITTED_NOT_APPLIED_BASELINE
  && version('20260823145919_x.sql') >= REPAIR_GUARD_BASELINE);
mustCatch('a backdated unguarded repair cannot hide below the baseline',
  !KNOWN_BACKLOG.includes('20260816000000_sneaky_backdated_repair.sql'));

if (mutFail) { console.error(`\n✗ ${mutFail} classifier case(s) wrong\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log(`\n✓ ${repairs} in-era data repairs, all watched\n`);
