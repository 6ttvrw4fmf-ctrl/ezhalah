// PERMANENT BARRIER — a deliberate deactivation that the recovery job cannot tell from an accident
// is undone within a day (2026-09-20, routine-8-regression-hunter).
//
// THE INCIDENT THIS GENERALISES. The owner said «delete the 99 please» about راكز's «البيع على
// الخارطة» off-plan units on 2026-09-14. Migration 20260914181618 deactivated them. They were ACTIVE
// AGAIN the next morning, and three days were spent suspecting the scraper — which was innocent
// throughout: `map_unit()` was executed against the real live unit 16938 and the real live project
// 16055 and correctly returned None. Nothing was wrong with the scraper, the data, or the migration.
// `auto_recover_false_inactive()` (pg_cron jobid 30, `20 5 * * *`) had simply read an owner decision
// as an accident, because under its predicate the two are the same row:
//
//     active = false
//     and coalesce(missing_count, 0) = 0          -- true for anything still published at source
//     and deactivated_at >= now() - 24h           -- true for anything you just applied
//     and not exists (... ops_adjudicated_listing ...)   -- the ONLY clause that separates them
//
// WHY A RULE WAS NOT ENOUGH. AGENTS.md gained the rule on 2026-09-18 ("HIDING A LISTING IS A
// TWO-PART ACT"). It gained no check. Measured on 2026-09-20, in the three deactivating migrations
// that landed AFTER the rule, the documented register was used ZERO times:
//
//   20260919010944  six wasalt listings, proven 404 on BOTH language routes through a headed
//                   Chromium, twice. Unadjudicated. Survives only because the author raised
//                   missing_count to 3 — which that migration's own comment gives as internal
//                   tidiness ("so the deactivated row is internally consistent for monitoring"),
//                   not as the thing keeping six dead listings out of search. Change that line for
//                   any reason and six 404s return.
//   20260919230553  four down sites (eastabha 200-but-a-placeholder, souq24 suspended, sadin 502,
//                   october 502), 334 listings. Unadjudicated. Survives only because the owner
//                   reversed it five minutes later (20260919231035).
//
// Two survivals by side effect and one by reversal is not a guard. This file is the guard.
//
// WHAT IS ASSERTED. Every committed migration whose EXECUTED sql sets `active = false` on a listing
// table — DISCOVERED by shape at run time, never from a list someone has to remember to extend —
// must satisfy one of the recovery job's real escape clauses, in the same migration or in a
// companion that lands before the next 05:20 UTC run.
//
// THE COMPANION WINDOW IS MEASURED IN RECOVERY RUNS, NOT IN HOURS, and that is the whole point.
// 20260919230553 → 20260919231035 is five minutes with no 05:20 in between: a real rescue.
// 20260914181618 → 20260918172239 is "only four files apart" in a directory listing and FOUR
// recovery runs too late: the rows were live again after the first one. An hours-based window would
// have called the rakez incident protected.
//
// WHAT THIS DOES NOT COVER, stated rather than implied. This judges COMMITTED MIGRATIONS. A
// deactivation applied straight through `execute_sql` and never committed is invisible here by
// construction — and if it also writes no audit row, it is invisible to any detector too, because a
// deliberate withdrawal that records nothing is definitionally indistinguishable from an accidental
// flip. That is the same blind spot AGENTS.md states for the pre-baseline migration era. Measured on
// 2026-09-20: every one of the 15 deactivating migrations in the tree is a migration, and a full
// scan of the live recovery predicate across all listing tables found exactly ONE row inside it
// (azdad_residential_listings 10778042) with no `deactivated_at`, no deletion-log row and no
// withdrawal trail of any kind — the signature of a genuine accidental flip, which is precisely what
// the recovery job correctly exists to repair. Zero deliberate withdrawals are currently at risk.
// The gap is stated, not closed.
//
//   node --experimental-strip-types scripts/verify-deliberate-deactivation-is-adjudicated.ts
//   (auto-discovered into `npm test` by scripts/lib/testRegistry.ts)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrationVersion } from './lib/repairClassifier.ts';
import {
  deactivatesListings, protectionsIn, deactivationVerdict, recoveryRunsBetween,
  versionToUtcMs, ADJUDICATION_ERA_BASELINE, MIN_WAIVER_REASON, type Protection,
} from './lib/deactivationAdjudication.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

// A waiver is a REASON, not a mute button. Nothing is waived today; the map exists so that the
// honest way to accept a future exception is to write down why, in the file, where a reviewer sees it.
const WAIVED: Record<string, string> = {};

// Pre-baseline deactivations. NOT waived — inventing reasons for them would be the mute-button
// behaviour this file exists to prevent. Pinned so they stay visible on every run, and so the
// baseline cannot be gamed by backdating a filename: a new deactivation under an old prefix changes
// this set and fails the build.
const KNOWN_BACKLOG: Record<string, string> = {
  '20260714000000': 'alnokhba/toor retirements, pre-register era',
  '20260914181618': 'THE RAKEZ INCIDENT ITSELF — remediated by 20260918172239, four recovery runs too late',
  // 20260817225546 (dealapp misclassified residential duplicates) is deliberately NOT here: it is
  // rescued by 20260817230317, eight minutes later and no 05:20 in between. It was in this list on
  // the first run, and the stale-entry check above is what removed it — the backlog is measured,
  // not asserted.
};

// ── Discover the population by SHAPE ────────────────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const sqlOf = new Map<string, string>();
for (const f of files) sqlOf.set(f, readFileSync(join(MIGRATIONS, f), 'utf8'));

const protectionsByVersion: Array<[string, Set<Protection>]> = files.map(
  (f) => [migrationVersion(f), protectionsIn(sqlOf.get(f)!)],
);

const deactivators = files.filter((f) => deactivatesListings(sqlOf.get(f)!));

console.log(
  `verify-deliberate-deactivation-is-adjudicated: ${files.length} migration(s), `
  + `${deactivators.length} deactivate listings`,
);
if (deactivators.length === 0) {
  fail('no deactivating migration found at all — the discovery predicate has gone blind');
}

const verdictFor = (file: string) => {
  const version = migrationVersion(file);
  return deactivationVerdict({
    version,
    own: protectionsIn(sqlOf.get(file)!),
    companions: protectionsByVersion.filter(([v]) => versionToUtcMs(v) > versionToUtcMs(version)),
    waiver: WAIVED[version],
  });
};

// ── The rule, over in-era migrations ────────────────────────────────────────────────────────────
let inEra = 0;
for (const f of deactivators) {
  const version = migrationVersion(f);
  if (version < ADJUDICATION_ERA_BASELINE) continue;
  inEra++;
  const v = verdictFor(f);
  if (v.protected) {
    ok(`${version}: ${v.reason}${v.via === 'companion' ? ` (via ${v.companionVersion})` : ''}`);
  } else {
    fail(
      `${version} (${f}) deliberately deactivates listings and ${v.reason}.\n`
      + `      auto_recover_false_inactive() will reactivate these rows at the next 05:20 UTC run.\n`
      + `      Fix: insert the rows into public.ops_adjudicated_retraction`
      + ` (source_table, listing_id, reason, evidence) in this same migration.`,
    );
  }
}
ok(`${inEra} in-era deactivating migration(s) judged (baseline ${ADJUDICATION_ERA_BASELINE})`);

// ── The backlog is a FLOOR, and it may only shrink ──────────────────────────────────────────────
const backlogNow = deactivators
  .map(migrationVersion)
  .filter((v) => v < ADJUDICATION_ERA_BASELINE && !verdictFor(
    deactivators.find((f) => migrationVersion(f) === v)!,
  ).protected);

for (const v of backlogNow) {
  if (!KNOWN_BACKLOG[v]) {
    fail(`${v}: a pre-baseline deactivation not in KNOWN_BACKLOG — a backdated filename cannot buy an exemption`);
  }
}
for (const v of Object.keys(KNOWN_BACKLOG)) {
  if (!backlogNow.includes(v)) {
    fail(`${v}: pinned in KNOWN_BACKLOG but no longer an unprotected deactivation — remove the stale entry`);
  }
}
ok(`pre-baseline backlog pinned at ${backlogNow.length} (shrink-only)`);

// Every waiver must carry a real reason.
for (const [v, reason] of Object.entries(WAIVED)) {
  if (reason.trim().length < MIN_WAIVER_REASON) fail(`${v}: waiver reason is too short to be a reason`);
}

// ── MUTATION PROOFS — the predicate is EXECUTED against deliberately broken input ───────────────
// Each feeds the real functions a case that must be judged unprotected, or a real migration with
// its protection removed. A barrier nobody has watched fail is a comment that runs.
const S = (...p: Protection[]) => new Set<Protection>(p);
const mustCatch = (what: string, run: () => boolean) => {
  if (run()) ok(`mutation caught: ${what}`);
  else fail(`MUTATION SURVIVED: ${what}`);
};

mustCatch('a deactivation with no protection at all',
  () => !deactivationVerdict({ version: '20260920120000', own: S(), companions: [] }).protected);

mustCatch('the rakez shape: adjudicated four recovery runs late',
  () => !deactivationVerdict({
    version: '20260914181618', own: S(),
    companions: [['20260918172239', S('adjudicated')]],
  }).protected);

mustCatch('the five-minute companion rescue is NOT rejected (the rule stays usable)',
  () => deactivationVerdict({
    version: '20260919230553', own: S(),
    companions: [['20260919231035', S('reactivated')]],
  }).protected);

mustCatch('a companion one minute AFTER a 05:20 run does not rescue',
  () => !deactivationVerdict({
    version: '20260920051900', own: S(),
    companions: [['20260920052100', S('adjudicated')]],
  }).protected);

mustCatch('`missing_count = 0` is not mistaken for a raised strike count',
  () => !protectionsIn('update wasalt_residential_listings set active = false, missing_count = 0;')
    .has('missing_count'));

mustCatch('a register named only in a COMMENT does not count as a write',
  () => !protectionsIn(
    '-- remember to insert into ops_adjudicated_retraction later\n'
    + 'update rakez_residential_listings set active = false;',
  ).has('adjudicated'));

mustCatch('an UPDATE inside a function BODY is not an executed deactivation',
  () => !deactivatesListings(
    'create or replace function f() returns void language plpgsql as $$\n'
    + 'begin update rakez_residential_listings set active = false; end $$;',
  ));

mustCatch('the dynamic `execute format(...)` deactivation is seen (the four-down-sites shape)',
  () => deactivatesListings(
    "execute format('update public.%I set active = false, deactivated_at = now() where active', v_tbl);",
  ));

mustCatch('a literal deactivation is seen',
  () => deactivatesListings('update public.rakez_residential_listings set active = false where id = 1;'));

mustCatch('a waiver too short to be a reason does not protect',
  () => !deactivationVerdict({
    version: '20260920120000', own: S(), companions: [], waiver: 'because',
  }).protected);

mustCatch('recoveryRunsBetween counts a crossed 05:20, not elapsed hours',
  () => recoveryRunsBetween('20260920051900', '20260920052100') === 1
     && recoveryRunsBetween('20260920052100', '20260920235900') === 0);

console.log(failures === 0
  ? '\n✅ every deliberate deactivation is distinguishable from an accident.'
  : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
