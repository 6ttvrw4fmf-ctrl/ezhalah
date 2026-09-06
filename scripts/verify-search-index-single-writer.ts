// SEARCH_LISTINGS_AR HAS ONE WRITER AT A TIME — INCIDENT #55.
//
// WHAT WENT WRONG. cron jobid 28 (sync-search-listings-ar) runs SEVEN writers of
// public.search_listings_ar in one implicit transaction. On 2026-09-04 at 16:20 jobid 47 started
// refresh_rnpl_flags() — THE SAME FUNCTION jobid 28 was executing — and at 16:21:27 jobid 28 died
// with «deadlock detected ... while locking tuple (3778,9) in relation search_listings_ar», inside
// `update public.search_listings_ar s set rent_now_pay_later = src.rnpl`, which IS
// refresh_rnpl_flags(). jobid 47 committed two seconds later: it was the blocked party, released by
// the victim's abort. Because pg_cron sends a multi-statement command as ONE transaction, the
// deadlock rolled back the WHOLE hourly chain — including the sync that had already succeeded. That
// is the real damage: the search index silently did not update for an hour while every
// point-in-time health read looked green.
//
// The incident was filed as "query cost on the location index". The timeouts are a symptom; the
// mechanism is two writers and no rule. And the duplication is DELIBERATE — 20260809131852, in its
// own words: "The standalone :20 refresh and the 10-minute sync_payment_monthly sweep stay as
// independent backstops." Deleting jobid 47 or 44 would remove a guard to make a symptom go away. So
// every writer takes one shared advisory key with pg_TRY_advisory_xact_lock and, when another writer
// owns the index, does nothing this pass and reports NULL.
//
// WHAT THIS FILE PROVES, and why each half exists:
//
//   1. DISCOVERY, NOT A REGISTRY. It replays the whole migration history and finds every function
//      whose EFFECTIVE final body writes public.search_listings_ar. A writer added tomorrow is
//      discovered automatically and is RED until it takes the lock. There is no list to remember to
//      update, which is the only kind of list that stays correct.
//   2. A FLOOR. A discovery check whose matcher quietly stops matching reads as a clean pass. If the
//      writer set ever shrinks below what was measured here, that is a failure to investigate.
//   3. THE GUARD MUST PRECEDE THE FIRST WRITE. A guard after the point of no return is not a guard
//      (owner-locked rule). The lock must be taken before the body's first insert/update/delete.
//   4. TRY, NEVER WAIT. pg_advisory_xact_lock() blocks, and a blocked pg_cron job holds one of only
//      six max_worker_processes slots — the resource 'cron_worker_starvation' already watches
//      (20260810111003). Swapping the try form for the blocking form would turn this fix into the
//      next outage, so the blocking form is banned outright.
//   5. SKIP REPORTS NULL, NEVER 0. A pass that did not run did not measure anything. "0 rows needed
//      updating" is a value invented for a question nobody asked — the owner-locked SOURCE IS TRUTH
//      rule (silent → NULL, never unknown → a value) applies to a refresher's own report too.
//   6. A STALE-BODY CHECK THAT DISTINGUISHES. rpcReplay reports migrations it cannot interpret. Ones
//      OLDER than the migration that installed the guard cannot have removed it — the replay is
//      chronological and the guard lands last — so failing on those would be permanent false noise
//      about six pre-existing 2026-07/08/09 migrations on sync_search_listings_ar. Ones NEWER than
//      the guard could have removed it and the replay would not know, so those are fatal.
//
// PRODUCTION, NOT JUST SOURCE (2026-09-06). Two concurrent pg_cron backends were run against the
// real functions: a holder took the key at 04:24:00 and held it 40s; a caller started in the same
// second, slept 8s and called the writers squarely inside that window. refresh_rnpl_flags → NULL,
// sync_payment_monthly → NULL, sync_search_listings_ar → zero rows, and BOTH jobs reported
// succeeded — no deadlock, no timeout, no lost chain. The negative control four minutes earlier,
// with the key free, had the same three calls return 0/0 and one row. This file is the source-side
// half of that; the behaviour itself was measured.
//
//   node --experimental-strip-types scripts/verify-search-index-single-writer.ts   (wired into `npm test`)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFunction, codeOnly, MIGRATIONS_DIR } from './lib/rpcReplay.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const LOCK_FN = 'search_index_writer_lock';

/**
 * The writer count measured when this barrier was written (2026-09-06), by the discovery below:
 * backfill_location_display_labels, propagate_dealapp_resolved_locations, refresh_rnpl_flags,
 * sync_gathern_native_attrs, sync_listing_photos, sync_listing_rich_attrs, sync_payment_monthly,
 * sync_search_first_seen_at, sync_search_listings_ar.
 */
const WRITER_FLOOR = 9;

// ── THE PREDICATES ───────────────────────────────────────────────────────────────────────────────
// Every assertion below is one of these applied to a real replayed body. The mutation proofs at the
// bottom apply the SAME functions to deliberately broken bodies, so what runs in anger is what was
// watched to fail — not a paraphrase of it.

/** A statement that writes the search index. Word-bounded so `search_listings_ar_v2` never counts. */
const writeAt = (code: string): number =>
  code.search(/\b(insert\s+into|update|delete\s+from)\s+(public\.)?search_listings_ar\b/i);

export const isWriter = (code: string): boolean => writeAt(code) >= 0;

const guardAt = (code: string): number => code.search(new RegExp(`\\b${LOCK_FN}\\s*\\(`, 'i'));

export const takesLock = (code: string): boolean => guardAt(code) >= 0;

export const takesLockBeforeFirstWrite = (code: string): boolean =>
  takesLock(code) && isWriter(code) && guardAt(code) < writeAt(code);

/** The skip must mean "did not run": NULL, or no rows for a set-returning function. Never 0. */
export const skipReportsNullNotZero = (code: string): boolean =>
  new RegExp(`if\\s+not\\s+public\\.${LOCK_FN}\\s*\\(\\s*\\)\\s+then\\s+return\\s*(null)?\\s*;`, 'i').test(code);

export const lockIsNonBlocking = (lockCode: string): boolean =>
  /pg_try_advisory_xact_lock\s*\(/i.test(lockCode)
  // `pg_advisory_xact_lock(` is also a substring of `pg_try_advisory_xact_lock(`, so the ban has to
  // be anchored on a boundary the try form does not satisfy.
  && !/(?<!try_)\bpg_advisory_(xact_)?lock\s*\(/i.test(lockCode);

export const lockKeys = (lockCode: string): string[] =>
  [...lockCode.matchAll(/hashtext\s*\(\s*'([^']+)'\s*\)/gi)].map((m) => m[1]);

/** Unresolved migrations that landed AFTER the guard did — the only ones that could have removed it. */
export const blindAfterGuard = (unresolved: string[], guardLanded: string): string[] =>
  unresolved.filter((u) => u.split(' ')[0] > guardLanded);

// ── DISCOVERY ────────────────────────────────────────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

const defined = new Set<string>();
for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
  for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi)) {
    defined.add(m[1].toLowerCase());
  }
}

type Writer = { fn: string; code: string; touchedBy: string[]; unresolved: string[] };
const writers: Writer[] = [];
for (const fn of [...defined].sort()) {
  if (fn === LOCK_FN) continue;                       // the lock itself writes nothing
  const r = replayFunction(MIGRATIONS_DIR, fn);
  if (!r.body) continue;
  const code = codeOnly(r.body);                      // prose in a comment must not satisfy an assertion
  if (isWriter(code)) writers.push({ fn, code, touchedBy: r.touchedBy, unresolved: r.unresolved });
}

check(
  `discovery found at least ${WRITER_FLOOR} writers of search_listings_ar (found ${writers.length})`,
  writers.length >= WRITER_FLOOR,
  writers.length < WRITER_FLOOR
    ? 'The set SHRANK. Either a writer was removed (say so and lower the floor deliberately) or the '
      + `matcher stopped matching, in which case this barrier is now blind. Found: ${writers.map((w) => w.fn).join(', ')}`
    : '',
);

// ── THE LOCK HELPER ITSELF ───────────────────────────────────────────────────────────────────────
const lock = replayFunction(MIGRATIONS_DIR, LOCK_FN);
check(`${LOCK_FN}() is defined in the migration history`, lock.body !== null);

if (lock.body) {
  const lockCode = codeOnly(lock.body);
  check(`${LOCK_FN}() takes the key with pg_TRY_advisory_xact_lock and never blocks`,
    lockIsNonBlocking(lockCode),
    'A waiting pg_cron job holds one of six worker slots. Queued backstops would starve the pool and '
      + 'then die on statement_timeout anyway — the outage the try form exists to avoid.');
  const keys = lockKeys(lockCode);
  check(`${LOCK_FN}() serialises on exactly ONE key (found ${keys.length}: ${keys.join(', ') || 'none'})`,
    keys.length === 1,
    'Two keys are two locks, and two locks taken in two orders is the deadlock this fix removes.');
}

// ── EVERY WRITER TAKES IT, BEFORE IT WRITES ──────────────────────────────────────────────────────
for (const w of writers) {
  check(`${w.fn}() takes the single-writer lock`, takesLock(w.code),
    takesLock(w.code) ? '' : 'It writes search_listings_ar and can therefore race any other writer. Add:\n      '
      + `if not public.${LOCK_FN}() then return null; end if;   (or bare \`return;\` if it RETURNS TABLE)`);
  if (!takesLock(w.code)) continue;

  check(`${w.fn}() takes the lock BEFORE its first write`, takesLockBeforeFirstWrite(w.code),
    takesLockBeforeFirstWrite(w.code) ? ''
      : `The guard sits at ${guardAt(w.code)}, the first write at ${writeAt(w.code)}. A guard after `
        + 'the point of no return is not a guard — the rows are already locked by then.');

  check(`${w.fn}() reports a skip as NULL / no rows, never 0`, skipReportsNullNotZero(w.code),
    `Expected \`if not public.${LOCK_FN}() then return null; end if;\` (or bare \`return;\` for a `
      + 'set-returning function). Anything that returns a number claims it measured something.');

  const guardLanded = w.touchedBy.filter((f) =>
    readFileSync(join(MIGRATIONS_DIR, f), 'utf8').includes(LOCK_FN)).at(-1) ?? '';
  const blind = blindAfterGuard(w.unresolved, guardLanded);
  check(`${w.fn}() has no uninterpretable migration after the guard landed`, blind.length === 0,
    blind.length ? 'Replayed body may be stale, so "the guard is present" is UNKNOWN, not true:\n      '
      + blind.join('\n      ') : '');
}

// ── MUTATION PROOF — the predicates above, applied to deliberately broken bodies ─────────────────
console.log('\n  mutation proof — the same predicates, against bodies re-broken on purpose\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// The real, currently-passing refresh_rnpl_flags body — the function that actually deadlocked — is
// the base for the mutants, so a proof cannot drift away from the shape it is protecting.
const healthy = writers.find((w) => w.fn === 'refresh_rnpl_flags')?.code ?? '';
check('the mutation base is the real refresh_rnpl_flags body (the function that deadlocked)',
  healthy.length > 0 && isWriter(healthy) && takesLock(healthy));

const GUARD = `  if not public.${LOCK_FN}() then return null; end if;\n`;

// M1 — the guard deleted outright: the pre-fix state of every one of these nine functions.
mustCatch('a writer of search_listings_ar that takes no lock at all',
  !takesLock(healthy.replace(GUARD, '')));

// M2 — the guard present, honest and un-stale, but placed AFTER the UPDATE it was meant to precede.
const lateGuard = `${healthy.replace(GUARD, '')}\n${GUARD}`;
mustCatch('a guard sitting AFTER the first write — present, but past the point of no return',
  takesLock(lateGuard) && !takesLockBeforeFirstWrite(lateGuard));

// M2b — NEGATIVE CONTROL. A predicate that flagged everything would satisfy M2 and be useless.
mustCatch('…while the real, correctly-ordered body is NOT flagged as late',
  takesLockBeforeFirstWrite(healthy));

// M3 — the skip claiming it measured something: `return 0` is "ran, found nothing", a value we
// invented for a question nobody asked.
mustCatch('a skip that reports 0 rows instead of NULL',
  !skipReportsNullNotZero(healthy.replace('then return null;', 'then return 0;')));

// M4 — the try form swapped for the blocking form: this fix turned into the next worker starvation.
mustCatch('the BLOCKING pg_advisory_xact_lock replacing the try form',
  !lockIsNonBlocking("if pg_advisory_xact_lock(hashtext('search_listings_ar:single_writer')) then return true; end if;"));

// M4b — NEGATIVE CONTROL for the substring trap: `pg_advisory_xact_lock(` is literally inside
// `pg_try_advisory_xact_lock(`, so a naive ban would flag the correct code too.
mustCatch('…while the try form itself is NOT mistaken for the blocking form',
  lockIsNonBlocking("if pg_try_advisory_xact_lock(hashtext('search_listings_ar:single_writer')) then return true; end if;"));

// M5 — a second key. Two locks taken in two orders is the deadlock this whole fix removes.
mustCatch('a second advisory key quietly added to the helper',
  lockKeys("pg_try_advisory_xact_lock(hashtext('a:one')) ... pg_try_advisory_xact_lock(hashtext('b:two'))").length !== 1);

// M6 — a migration NEWER than the guard that the replayer cannot interpret: the replayed body may no
// longer contain what production contains, so "the guard is present" is UNKNOWN, not true.
mustCatch('an uninterpretable migration landing AFTER the guard',
  blindAfterGuard(['20260907000000_rewrites_the_body.sql (unrecognised change)'],
    '20260906043000_search_index_has_one_writer_at_a_time.sql').length > 0);

// M6b — NEGATIVE CONTROL. The six pre-existing 2026-07/08/09 unresolved entries on
// sync_search_listings_ar provably could not have removed a guard added later; failing on those
// would be permanent false noise, and a barrier that cries wolf gets muted.
mustCatch('…while an uninterpretable migration from BEFORE the guard is not counted against it',
  blindAfterGuard(['20260803112311_p1_interim_gate_buy_token_price.sql (unrecognised change)'],
    '20260906043000_search_index_has_one_writer_at_a_time.sql').length === 0);

// M7 — the discovery matcher going blind. If `isWriter` stopped recognising a write, every
// per-writer assertion above would silently evaluate over an empty set and this file would pass.
mustCatch('a body that writes the index NOT being recognised as a writer',
  isWriter('  update public.search_listings_ar s set rent_now_pay_later = src.rnpl'));
mustCatch('…while a different table with the same prefix is NOT counted as a writer',
  !isWriter('  update public.search_listings_ar_v2 s set x = 1'));

failures += mutFail;
console.log(
  failures === 0
    ? `\n✅ ${writers.length} writers of search_listings_ar, all serialised on one non-blocking key`
    : `\n❌ ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
