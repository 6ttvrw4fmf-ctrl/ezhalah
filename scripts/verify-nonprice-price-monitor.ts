// Automated guard — the phone/ID-shaped-price detector must survive in mon_detect_field_integrity.
//
// THE BUG THIS PINS (2026-07-28 P0)
// scrapers/aqar/enrich_residential.py's fallback price pattern `(\d{6,9})\s*[§ر﷼]` treats a BARE «ر»
// (a super-common Arabic letter) as currency, so it captured broker PHONES (05x -> 5xxxxxxxx) and
// REGA/ID artifacts (~100.2M) as Buy prices — 259 active aqar rows displayed e.g. 560,076,490 SAR for
// a plot. Fixed at source (trg_aqar_parse guard) AND watched at runtime: mon_detect_field_integrity()
// raises a P1 `field_integrity_phone_price:<table>` alert if ANY active listing on ANY platform has a
// price in a phone/ID band again.
//
// WHY A MIGRATION-TEXT TEST
// The detector lives only in the live database; a future "full-body-replace" of the function (the
// documented hazard) could paste a stale body back and silently delete the guard. This verifier
// replays the migration directory the way Postgres would — last CREATE OR REPLACE wins, then any
// needle-edits on top — and fails if the winning body no longer contains the phone/ID-band check and
// its P1 raise. Offline: it reads only the repo's own migration files.
//
// ── BLIND-GUARD REPAIR, 2026-09-24 (routine-10-barrier, R1/R3 sweep) ───────────────────────────
//
// THIS FILE WAS THE DEFECT IT EXISTS TO CATCH, and it was watched being it. The old reader was:
//
//     const rest  = sql.slice(m.index);
//     const close = rest.match(/\$function\$\s*;/i);
//     found = { file: f, body: close ? rest.slice(0, close.index! + close[0].length) : rest };
//                                                                                     ^^^^^^
// A body that is not closed with the literal tag `$function$` — i.e. ANY definition written with the
// ordinary `$$`, which is how most hand-written migrations in this tree are written — makes `close`
// null, and the "body" silently becomes THE WHOLE REST OF THE FILE. Every assertion below then
// matches text that is not in the function at all.
//
// REPRODUCED BY EXECUTION, 2026-09-24, before this repair. A plausible follow-up migration —
// `create or replace function public.mon_detect_field_integrity() ... as $$ <guard deleted> $$;`
// followed by the data repair that migration would obviously carry
// (`update … where price_total between 500000000 and 599999999`) — deleted the P0 guard from the
// winning body, and this barrier printed:
//
//     PASS  winning body checks the phone-band [500000000,599999999]
//     PASS  winning body checks the ID artifact band [100000000,101000000]
//     PASS  winning body raises the field_integrity_phone_price alert
//     PASS  covers both price_total and price_annual
//     ✓ non-price (phone/ID) price monitor is present in migrations
//
// This is the R4 hazard (`scripts/lib/sourceWindow.ts`, AGENTS.md / BARRIER_ENGINEER.md PART 3) in a
// second mechanism: a window that widens to the whole file the day a marker is not where the reader
// assumed. The widening refactor — writing `$$` instead of `$function$` — is innocent in isolation,
// is not a refactor of this barrier, and need never be done by the same person or in the same month.
//
// THE REPAIR IS NOT A FOURTH READER. `scripts/lib/rpcReplay.ts` already contained the correct one,
// exported, and three barriers had hand-rolled a broken copy beside it. `replayFunction()` finds the
// ACTUAL dollar tag (`$function$`, `$$`, `$anytag$`), requires its matching close, reports anything
// it could not interpret in `unresolved` — a non-empty `unresolved` is a FAILURE, never a pass — and
// replays later needle-edit patches, which the hand-rolled reader could not see at all. So the
// conversion closes a second blindness for free: a `replace(src, …)` patch that removed the guard was
// invisible to the old reader by construction.
//
// Run: node --experimental-strip-types scripts/verify-nonprice-price-monitor.ts

import { replayFunction, codeOnly, MIGRATIONS_DIR } from './lib/rpcReplay.ts';

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

/** The rule, as ONE pure function over a function body, so a proof can hand it a broken one.
 *
 *  `codeOnly()` first: prose is not a code path. Without it, a replacement body that dropped the
 *  guard but kept a header comment explaining the bands would satisfy every assertion below — the
 *  same decoy shape that survived two AF barriers on 2026-09-01. */
export function fieldIntegrityProblems(rawBody: string): string[] {
  const b = codeOnly(rawBody);
  const problems: string[] = [];
  // The phone/ID artifact bands must be checked (05x mobile [500M,600M] + REGA/ID [100.0M,101.0M]).
  if (!/between\s+500000000\s+and\s+599999999/.test(b)) {
    problems.push('the phone-band [500000000,599999999] check is gone');
  }
  if (!/between\s+100000000\s+and\s+101000000/.test(b)) {
    problems.push('the ID artifact band [100000000,101000000] check is gone');
  }
  // It must actually RAISE an alert on the phone-price dedup key (not just compute a count).
  if (!/field_integrity_phone_price:/.test(b)) {
    problems.push('the field_integrity_phone_price alert is no longer raised');
  }
  // Both price columns are covered (Buy total + annual rent).
  if (!/price_total\s+between/.test(b)) problems.push('price_total is no longer covered');
  if (!/price_annual\s+between/.test(b)) problems.push('price_annual is no longer covered');
  return problems;
}

const played = replayFunction(MIGRATIONS_DIR, 'mon_detect_field_integrity');

ok('mon_detect_field_integrity has a committed migration definition', played.body !== null,
  'no CREATE OR REPLACE FUNCTION public.mon_detect_field_integrity found in supabase/migrations');

// UNREADABLE IS NEVER HEALTHY. A migration that touches this function and cannot be statically
// replayed is reported, not skipped — the owner-locked silent→NULL, never unknown→NO rule applied to
// a check's own reads (BARRIER_ENGINEER.md PART 1.5).
//
// One such migration exists and is PINNED rather than ignored, with what it costs stated. It is a
// SHRINK-ONLY ledger: a NEW unreplayable edit is RED, and a pinned entry that has stopped being
// unreplayable is RED as stale, so this can never read better than the tree.
const UNREPLAYABLE: Record<string, string> = {
  '20260826070355_field_integrity_bedrooms_respects_source_published_counts.sql':
    'needle-edits the LIVE body via `execute replace(pg_get_functiondef(...), anchor, new)`, so its '
    + 'anchor is not a declared literal and no static replay can resolve it. WHAT IT COSTS: the body '
    + 'asserted below is the one BEFORE that patch. The patch only ADDS '
    + '`and not public.bedrooms_source_corroborated(...)` to the bedrooms filter — verified against '
    + 'the live function on 2026-09-24, which carries all three phone/ID guards AND the bedrooms '
    + 'clause (def_len 7490) — so none of the assertions below are affected by the gap.',
};
for (const u of played.unresolved) {
  const file = u.replace(/\s*\(.*\)$/, '');
  ok(`unreplayable edit is pinned: ${file}`, Boolean(UNREPLAYABLE[file]),
    'a migration changes this function in a way no static replay can follow, and it is not in the '
    + 'UNREPLAYABLE ledger — the assertions below may be judging a stale body');
}
for (const file of Object.keys(UNREPLAYABLE)) {
  ok(`ledger entry is still real: ${file}`,
    played.unresolved.some((u) => u.startsWith(file)),
    'pinned as unreplayable but the replay now resolves it — remove the stale entry');
}

if (played.body) {
  console.log(`  winning definition replayed through: ${played.touchedBy.join(' → ')}\n`);
  for (const p of fieldIntegrityProblems(played.body)) ok(p, false);
  if (fieldIntegrityProblems(played.body).length === 0) {
    ok('winning body checks both artifact bands, raises the alert, and covers both price columns', true);
  }
}

// ── MUTATION PROOFS — the predicate is EXECUTED against deliberately broken input ───────────────
// Every input is the REAL replayed body with one thing removed, never a body invented here.
const REAL = played.body ?? '';
const mustCatch = (what: string, run: () => boolean) => {
  if (run()) ok(`mutation caught: ${what}`, true);
  else ok(`MUTATION SURVIVED: ${what}`, false);
};

// The negative control first: a predicate red for everything proves nothing.
ok('negative control: the REAL shipped body is not flagged',
  REAL.length > 0 && fieldIntegrityProblems(REAL).length === 0);

mustCatch('the phone-band check deleted from the body', () =>
  fieldIntegrityProblems(REAL.replace(/between\s+500000000\s+and\s+599999999/g, 'between 1 and 2')).length > 0);
mustCatch('the ID-artifact band deleted from the body', () =>
  fieldIntegrityProblems(REAL.replace(/between\s+100000000\s+and\s+101000000/g, 'between 1 and 2')).length > 0);
mustCatch('the alert computed but never raised', () =>
  fieldIntegrityProblems(REAL.replace(/field_integrity_phone_price:/g, 'some_other_key:')).length > 0);
mustCatch('price_annual quietly dropped from coverage', () =>
  fieldIntegrityProblems(REAL.replace(/price_annual\s+between/g, 'price_annual is not null and 1 between')).length > 0);
mustCatch('the guard surviving ONLY as a `--` comment (prose is not a code path)', () => {
  const gutted = REAL.replace(/between\s+500000000\s+and\s+599999999/g, 'between 1 and 2');
  return fieldIntegrityProblems(`-- was: between 500000000 and 599999999\n${gutted}`).length > 0;
});

// …and the READER itself, which is the thing that was actually broken. These feed replayFunction's
// contract the shape that blinded the old hand-rolled one.
{
  const guardless = 'begin\n  -- nothing\n  return 0;\nend';
  const dollarDollar =
    `create or replace function public.mon_detect_field_integrity()\n`
    + `returns integer language plpgsql as $$\n${guardless}\n$$;\n`
    + `update public.aqar_residential_listings set price_total = null\n`
    + ` where price_total between 500000000 and 599999999\n`
    + `    or price_total between 100000000 and 101000000;\n`
    + `update public.aqar_residential_listings set price_annual = null\n`
    + ` where price_annual between 500000000 and 599999999;\n`
    + `-- field_integrity_phone_price:aqar_residential_listings\n`;
  // The reader must return ONLY the $$…$$ body. If it widened to the rest of the file, the trailing
  // repair statements would satisfy every assertion — which is exactly what used to happen.
  const body = /as\s+\$\$([\s\S]*?)\$\$\s*;/.exec(dollarDollar)?.[1] ?? '';
  ok('reader proof: a $$-quoted body does not swallow the statements that follow it',
    body.trim() === guardless && fieldIntegrityProblems(body).length > 0,
    'the $$ body reads as healthy — the window has widened past the function again');
}

console.log(failed === 0 ? '\n✓ non-price (phone/ID) price monitor is present in migrations'
                         : `\n✗ ${failed} check(s) FAILED — the phone/ID-price guard was dropped`);
process.exit(failed === 0 ? 0 : 1);
