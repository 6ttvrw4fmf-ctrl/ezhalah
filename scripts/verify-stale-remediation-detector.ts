// THE STALE-LIFECYCLE SAFETY INVARIANTS (investigation 2026-08-25)
//
//   node --experimental-strip-types scripts/verify-stale-remediation-detector.ts   (in `npm test`)
//
// CONTEXT: a user reported dead DealApp ads still opening from Ezhalah. The investigation found the
// lifecycle's SAFETY principle is correct and must be preserved, while its COVERAGE was incomplete:
//
//   * mark_stale_listings_inactive() is DETECT-ONLY on purpose — "a time-based sweep cannot verify a
//     listing is dead". It reports and delegates deactivation to paths that RE-FETCH THE SOURCE.
//   * but that delegation target exists for only 4 of 29 platforms, so on the rest a stale listing is
//     detected, alerted, and then nothing ever re-checks it. Measured: 19,908 user-reachable listings
//     on platforms with no cleanup/liveness path at all (dealapp 15,008 of them).
//   * mon_detect_stale_active_fraction() could not tell the two cases apart — it raised an identical
//     P1 whether a path existed and a guard was holding it (wasalt, benign) or no path was ever built
//     (dealapp, malignant). Four identical P1s sat open 14 days because the benign reading is the
//     reasonable one. mon_detect_stale_no_remediation_path() is the missing discriminator.
//
// THIS BARRIER PINS THE SAFETY PROPERTY, NOT THE NUMBERS. The counts move daily; what must never
// change is that NO time-based sweep may deactivate a listing, and that the new detector stays
// detection-only. The tempting "fix" for a stale backlog is to let the timer kill rows — that would
// destroy source truth at scale and is exactly what these assertions forbid.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname, '..', 'supabase', 'migrations');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

const files = readdirSync(MIG);
const find = (needle: string) => files.filter((f) => f.includes(needle));
const read = (f: string) => readFileSync(join(MIG, f), 'utf8');

// ── 1. THE DETECTOR AND ITS ROSTER ENTRY BOTH EXIST, MIRRORED FROM PRODUCTION ────────────────────
const detectorFiles = find('mon_detect_stale_no_remediation_path');
const rosterFiles = find('roster_stale_no_remediation_path_detector');
check('the detector migration is mirrored into git', detectorFiles.length === 1, JSON.stringify(detectorFiles));
check('its roster-registration migration is mirrored too (an unrostered detector is decoration)',
  rosterFiles.length === 1, JSON.stringify(rosterFiles));
if (detectorFiles.length !== 1 || rosterFiles.length !== 1) {
  console.log('\ncannot continue without both migrations'); process.exit(1);
}
const detector = read(detectorFiles[0]);
const roster = read(rosterFiles[0]);

// ── 2. THE DETECTOR IS DETECTION-ONLY — IT MAY NEVER WRITE TO A LISTING ──────────────────────────
// This is the invariant that protects source truth. mon_raise/mon_resolve_key write to alert_event,
// which is monitoring state, not listing state — everything else is forbidden.
const body = detector.slice(detector.indexOf('$function$'));
const forbidden = [
  [/update\s+public\.\w*_listings/i, 'UPDATE on a listings table'],
  [/delete\s+from\s+public\.\w*_listings/i, 'DELETE from a listings table'],
  [/set\s+active\s*=/i, 'setting active='],
  [/delete\s+from\s+public\.search_listings_ar/i, 'DELETE from the search index'],
] as const;
for (const [re, label] of forbidden)
  check(`the detector never performs ${label}`, !re.test(body), `matched: ${body.match(re)?.[0]}`);
check('…it only ever writes monitoring state (mon_raise / mon_resolve_key)',
  /mon_raise\(/.test(body) && /mon_resolve_key\(/.test(body));

// ── 3. IT DISCRIMINATES ON PATH EXISTENCE, NOT MERELY ON STALENESS ───────────────────────────────
// Without this it would duplicate mon_detect_stale_active_fraction and re-create the ambiguity that
// let four P1s sit unactioned for 14 days.
check('it computes whether a deactivation path exists (has_path)', /has_path\s*:=\s*exists/i.test(body));
check('…checking the cleanup.py shape (cleanup:<platform>)', /'cleanup:'\s*\|\|\s*plat/.test(body));
check('…the table-scoped sweep shape (aqar_cleanup:<table>)', /aqar\\?_cleanup:/.test(body));
check('…and any platform-scoped liveness run', /liveness/.test(body));
check('it stays silent when a path exists (the wasalt guard-is-holding case is benign)',
  /if\s+has_path\s+then[\s\S]{0,220}?mon_resolve_key/i.test(body));
check('it self-heals when the staleness clears', /stale_n\s*,\s*0\s*\)\s*=\s*0[\s\S]{0,200}?mon_resolve_key/i.test(body));

// ── 4. IT RESOLVES WITH THE 2-ARG mon_resolve_key(kind, dedup) SIGNATURE ─────────────────────────
// A 1-arg call parses at CREATE time and only fails when the branch first executes — i.e. silently,
// in production, on the day it was supposed to self-heal.
const resolveCalls = [...body.matchAll(/mon_resolve_key\(([^)]*)\)/g)].map((m) => m[1]);
check('every mon_resolve_key call passes BOTH kind and dedup_key',
  resolveCalls.length > 0 && resolveCalls.every((a) => a.split(',').length >= 2),
  JSON.stringify(resolveCalls));

// ── 5. THE ROSTER EDIT IS A NEEDLE-EDIT OF THE LIVE DEFINITION, NEVER A RESTATED COPY ────────────
// Restating mon_run_all_detectors from memory silently reverts whatever another session added to the
// roster between then and now — the documented full-body-replace hazard.
check('the roster migration reads the LIVE definition (pg_get_functiondef)', /pg_get_functiondef/.test(roster));
check('…and needle-edits it rather than restating the array', /replace\(\s*d\s*,\s*anchor/.test(roster));
check('…refusing to proceed if the anchor is not unique', /anchor not unique/.test(roster));
check('…and is idempotent (re-running is a no-op)', /already rostered/.test(roster));

// ── 6. THE TIME-BASED SWEEP MUST NEVER DEACTIVATE (the principle this whole area rests on) ───────
// mark_stale_listings_inactive() reports and delegates; it must not be "fixed" into a timer that
// kills rows. If a future migration reintroduces a time-based kill there, this fails.
const staleSweep = files.filter((f) => /mark_stale_listings_inactive/i.test(f)).map(read).join('\n');
if (staleSweep) {
  check('mark_stale_listings_inactive never sets active=false on a time basis',
    !/set\s+active\s*=\s*false/i.test(staleSweep),
    'a time-based sweep cannot verify death — deactivation must re-fetch the source');
} else {
  console.log('SKIP  mark_stale_listings_inactive has no committed migration in this repo (prod-only object)');
}

// ── 7. MUTATION PROOF — the detection-only assertions must actually bite ─────────────────────────
{
  const mutated = body.replace(/has_path\s*:=\s*exists/i, 'has_path := false; /* mutated */ perform 1 from (select 1) z where exists')
                      .replace(/mon_raise\(/, "update public.dealapp_residential_listings set active = false; mon_raise(");
  const caught = /update\s+public\.\w*_listings/i.test(mutated) && /set\s+active\s*=/i.test(mutated);
  check('MUTATION: a detector that deactivated listings WOULD be caught by §2', caught);
  const blind = /update\s+public\.\w*_listings/i.test(body);
  check('CONTROL: the real detector is not flagged by that same test', !blind);
}

console.log(failed ? `\n${failed} FAILED` : '\nAll stale-lifecycle safety invariants hold');
process.exit(failed ? 1 : 0);
