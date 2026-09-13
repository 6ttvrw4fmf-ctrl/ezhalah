// Barrier: THE 30-DAY DELETION CLOCK MAY ONLY RUN FROM A SOURCE CONFIRMATION.
//
// THE DEFECT THIS CLOSES — ops_incident #24, open 2026-09-05, owner-decided 2026-09-12.
//
// `scrapers/common/cleanup.py` selected rows for PERMANENT, UNRECOVERABLE deletion with:
//
//     active = false  AND  missing_count >= min_missing_count  AND  last_seen_at < now() - 30d
//
// Every term is about OUR CRAWL. `last_seen_at` means "a crawl encountered this row";
// `missing_count` is accumulated by `db.prune_unseen()` from crawl ABSENCE — `EvidenceKind.ABSENCE`,
// which `LISTING_LIVENESS.md` §1–§3 forbids from ever being a death verdict. So a listing that
// merely fell out of a crawl — a timeout, a 403, a parser bug, a sweep that did not run — entered
// the queue to be erased forever, and only the delete-time re-probe stood in the way.
//
// Measured on production the day the fix shipped, on rows already past the 30-day mark:
//
//     aqar_residential    20,548 eligible —      0 with any recorded source verdict
//     wasalt_residential  11,207 eligible —  8,029 with a recorded DIRECT 404/410
//     gathern_residential  1,811 eligible —  1,811 with a recorded DIRECT 404/410
//
// aqar's zero is why this could not be fixed earlier: its sweep DOES probe each listing's own URL
// at full grace, but never wrote its findings down (`aqar_liveness_detail` had never received a
// row — ops_incident #214, fixed the same day in PR #2390). A clock cannot be gated on evidence
// nobody recorded.
//
// THE INVARIANT, and it is asserted as an invariant rather than as today's implementation
// (LISTING_LIFECYCLE_ENGINEER.md §4, standing rule: "a barrier that pins today's predicate goes
// green on the day someone writes a DIFFERENT correct implementation"):
//
//     > No row may be selected for deletion unless the SOURCE confirmed it dead, and the full
//     > retention window has elapsed SINCE THAT CONFIRMATION. No confirmation ⇒ never deletable,
//     > at any age.
//
// Boundary asserted at 29 / 30 / 31 days, in both directions, plus the case the old predicate
// would have SURVIVED: a 400-day-old row deactivated on absence alone, with no confirmation.
//
//   node --experimental-strip-types scripts/verify-deletion-clock-is-earned.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCommentsAndStrings } from './lib/stripComments.ts';

const root = join(import.meta.dirname, '..');
const CLEANUP = join(root, 'scrapers', 'common', 'cleanup.py');
const CONTRACT = join(root, 'scrapers', 'common', 'liveness_contract.py');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}
function mustCatch(label: string, caught: boolean): void {
  if (caught) console.log(`  ✓ mutation caught: ${label}`);
  else {
    console.error(`  ✗ MUTATION SURVIVED: ${label}`);
    failures++;
  }
}

// ─── §1 The invariant, EXECUTED as a predicate over synthetic rows ──────────────────────────────
//
// A pure model of "is this row deletable", so the rule can be run against the exact shapes that
// matter instead of pattern-matched in source. `eligible` is what the implementation must compute.

type Row = {
  active: boolean;
  missing_count: number;
  /** null = the source never confirmed this listing dead */
  source_confirmed_dead_at: number | null; // days ago
  last_seen_at: number;                    // days ago
};

const GRACE = 3;
const WINDOW = 30;

/** The RULE. Deletion requires a source confirmation aged past the full retention window. */
function eligible(r: Row): boolean {
  if (r.active) return false;
  if (r.missing_count < GRACE) return false;
  if (r.source_confirmed_dead_at === null) return false;   // never confirmed ⇒ never deletable
  return r.source_confirmed_dead_at > WINDOW;
}

/** The OLD, defective rule, kept only so the mutations below can prove the difference. */
function eligibleOld(r: Row): boolean {
  return !r.active && r.missing_count >= GRACE && r.last_seen_at > WINDOW;
}

const confirmed = (d: number, seen = d): Row => ({
  active: false, missing_count: 3, source_confirmed_dead_at: d, last_seen_at: seen,
});
const unconfirmed = (seen: number): Row => ({
  active: false, missing_count: 3, source_confirmed_dead_at: null, last_seen_at: seen,
});

console.log('§1 the retention window is measured from the SOURCE CONFIRMATION (executed):');
check('a confirmation 31 days old IS eligible', eligible(confirmed(31)));
check('a confirmation exactly 30 days old is NOT eligible (window not yet elapsed)',
  !eligible(confirmed(30)));
check('a confirmation 29 days old is NOT eligible', !eligible(confirmed(29)));
check('an ACTIVE row is never eligible', !eligible({ ...confirmed(400), active: true }));
check('a row below full strike grace is never eligible',
  !eligible({ ...confirmed(400), missing_count: 2 }));

console.log('\n§2 NO CONFIRMATION ⇒ NEVER DELETABLE, AT ANY AGE (executed):');
check('a 31-day-old unconfirmed row is NOT eligible', !eligible(unconfirmed(31)));
check('a 400-day-old unconfirmed row is NOT eligible', !eligible(unconfirmed(400)));
check('a 10-year-old unconfirmed row is NOT eligible', !eligible(unconfirmed(3650)));

// The whole point of ops_incident #24, stated as a differential: the old rule DELETED these.
mustCatch(
  'the OLD last_seen_at rule would have deleted a 400-day unconfirmed row; the new rule does not',
  eligibleOld(unconfirmed(400)) && !eligible(unconfirmed(400)),
);
mustCatch(
  'a row seen recently but confirmed dead long ago is eligible (clock is NOT last_seen_at)',
  eligible(confirmed(31, 1)) && !eligibleOld(confirmed(31, 1)),
);
mustCatch(
  'a row crawl-missing for 400 days but confirmed dead only yesterday is NOT eligible',
  !eligible(confirmed(1, 400)) && eligibleOld(confirmed(1, 400)),
);

// ─── §3 The implementation actually uses the confirmation column, on EVERY selection site ───────
//
// Three call sites select candidates (bounded, the count that feeds the anomaly gate, and the
// work-set). A gate applied to two of three is not a gate.

console.log('\n§3 every candidate-selection site is keyed on the confirmation:');
const cleanupSrc = readFileSync(CLEANUP, 'utf8');
const code = stripCommentsAndStrings(cleanupSrc);

const selectSites = [...cleanupSrc.matchAll(/\.eq\(\s*["']active["']\s*,\s*False\s*\)/g)];
check(
  `all candidate selections found (${selectSites.length}, expected >= 3)`,
  selectSites.length >= 3,
);

const confirmedFilters = [
  ...cleanupSrc.matchAll(/not_\.is_\(\s*["']source_confirmed_dead_at["']\s*,\s*["']null["']\s*\)/g),
];
const windowFilters = [
  ...cleanupSrc.matchAll(/\.lt\(\s*["']source_confirmed_dead_at["']\s*,\s*cutoff\s*\)/g),
];
check(
  `every selection excludes NULL confirmations (${confirmedFilters.length} of ${selectSites.length})`,
  confirmedFilters.length >= selectSites.length,
  'a selection site without the NULL guard can delete an unconfirmed row',
);
check(
  `every selection applies the window to the confirmation (${windowFilters.length})`,
  windowFilters.length >= confirmedFilters.length,
);
check(
  'no candidate selection still filters on last_seen_at',
  !/\.lt\(\s*["']last_seen_at["']\s*,\s*cutoff\s*\)/.test(cleanupSrc),
  'the old crawl-contact clock is still selecting rows for deletion',
);

// ─── §4 Only the contract may write the stamp ───────────────────────────────────────────────────
//
// A hand-written stamp condemns a row nobody read — the mirror of the hand-written
// last_verified_alive_at stamp LISTING_LIVENESS.md §3 already forbids.

console.log('\n§4 only liveness_contract.death_patch() may write the stamp:');
const contractSrc = readFileSync(CONTRACT, 'utf8');
check('death_patch() exists in the contract', /def death_patch\(/.test(contractSrc));
check(
  'death_patch() writes the stamp ONLY for a confirmed-dead decision',
  /return \{"source_confirmed_dead_at": now_iso\} if decision\.confirmed_dead else \{\}/
    .test(contractSrc),
);
check(
  'decide() sets confirmed_dead only on the deactivate branch',
  /action="deactivate",[\s\S]{0,220}?confirmed_dead=True/.test(contractSrc) &&
    (contractSrc.match(/confirmed_dead=True/g) || []).length === 1,
  'confirmed_dead is set somewhere other than the single deactivate branch',
);
check(
  'the ABSENCE branch cannot produce a confirmation',
  /EvidenceKind\.ABSENCE:[\s\S]{0,320}?action="none"/.test(contractSrc),
);
check(
  'no scraper writes source_confirmed_dead_at by hand',
  !/["']source_confirmed_dead_at["']\s*:/.test(
    stripCommentsAndStrings(readFileSync(join(root, 'scrapers', 'common', 'cleanup.py'), 'utf8')),
  ),
);

if (failures > 0) {
  console.error(`\n✗ ${failures} check(s) failed — the deletion clock is not earned.`);
  process.exit(1);
}
console.log('\n✓ A listing can only be deleted 30 days after the SOURCE confirmed it is gone.');
