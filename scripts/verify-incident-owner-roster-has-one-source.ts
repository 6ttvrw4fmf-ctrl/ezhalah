// Barrier: THE ELEVEN-ROUTINE ROSTER IS DEFINED ONCE, AND NOTHING RE-ENUMERATES IT BY HAND.
//
// Found by routine #8 (Regression Hunter) on 2026-09-13 by attacking the CLASS behind a fix rather
// than the fix's own instance. The roster grew from SEVEN routines to ELEVEN on 2026-09-04
// (migration 20260905022312). Two enumerations were updated — incident_route_owner() and
// scripts/lib/alertRouting.ts's ROUTINES — and three more in the same spine were not:
//
//   * incident_handoff() validated NOTHING about the slug it was handed, while its sibling write
//     path incident_open() has raised on an unknown SURFACE since the same day, under the comment
//     "UNKNOWN MUST BE LOUD ... a surface nobody named is a typo". ops_incident #182 was handed to
//     'routine-8-regression' on 2026-09-11 and sat invisible for two days, because every routine
//     spec's §G.6b queue query filters owner_routine on an EXACT string.
//   * mon_detect_stalled_incident() RAISED grouped by owner_routine (every slug gets a key) and
//     SELF-HEALED from a hardcoded seven. incident_stalled:routine-10-barrier was stuck open for
//     96.3 hours because no arm could retire it; mon_raise() returns 0 on an open dedup key, so it
//     also suppressed its own re-raise.
//   * mon_detect_alert_queue_unworked() carried the same seven under a comment promising the
//     opposite ("across every owner that can exist -- not merely the ones with rows today").
//
// WHY THIS BARRIER IS SHAPED THE WAY IT IS. Pinning the three repaired call sites would prove
// nothing: they are the three someone definitely fixed. The failure mode is the FOURTH copy, written
// next month by someone who does not know this function exists. So check 3 below does not look for
// known-bad functions — it DISCOVERS every committed function whose current definition names a
// routine slug, and fails on any that carries its own roster array. A hand-rolled list added
// tomorrow is red without anyone registering it here.
//
// HERMETIC BY CONSTRUCTION (AGENTS.md, "The required suite is HERMETIC"). This reads committed
// migrations and the real TypeScript module; it never touches the database. The live half was
// proven by executing the guards against production in the PR that introduced them (a handoff to a
// bad slug raising P0001, a raw UPDATE rejected by the CHECK constraint, and the first run of the
// repaired detector retiring the 96.3-hour key).
//
//   node --experimental-strip-types scripts/verify-incident-owner-roster-has-one-source.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTINES } from './lib/alertRouting.ts';

const root = join(import.meta.dirname, '..');
const migDir = join(root, 'supabase', 'migrations');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── Pure predicates. Every assertion below EXECUTES one of these, so the mutation proofs at the
// bottom exercise the same code that decides the verdict — not a copy of it, and not a regex over
// a file that a refactor could rename out from under.

/** Every 'routine-N-slug' string literal in a chunk of SQL. */
export const slugsIn = (sql: string): string[] =>
  [...sql.matchAll(/'(routine-\d+-[a-z0-9-]+)'/g)].map((m) => m[1]);

/**
 * Slice one function body out of a migration, dollar-quote aware. Returns '' when the function is
 * not defined here — a MISSING definition must read as absent, never as "nothing to check".
 */
export const sliceFunction = (sql: string, fn: string): string => {
  const head = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'i').exec(sql);
  if (!head) return '';
  const rest = sql.slice(head.index);
  const tag = /\$([a-z_]*)\$/i.exec(rest);
  if (!tag) return '';
  const open = rest.indexOf(tag[0]);
  const close = rest.indexOf(tag[0], open + tag[0].length);
  return close === -1 ? rest : rest.slice(0, close + tag[0].length);
};

/**
 * Array literals inside `sql` that carry a roster of their own. Kept as a named sub-case because
 * `array[...]` is how all three repaired siblings spelled it, but it is NOT the test — see below.
 */
export const rosterArraysIn = (sql: string): string[] =>
  [...sql.matchAll(/array\s*\[([^\]]*)\]/gi)]
    .map((m) => m[1])
    .filter((body) => new Set(slugsIn(body)).size >= 2);

/**
 * Does this function body enumerate the roster itself, in ANY syntax?
 *
 * THE TEST IS THE SLUG COUNT, NOT THE BRACKET. The first version of this barrier asked only
 * `rosterArraysIn(body).length > 0` while its check reported the far broader claim "no function
 * re-enumerates the roster by hand" — ops_incident #218's pattern exactly: a check whose success
 * sentence is wider than the set it actually iterates. Measured 2026-09-13, three natural spellings
 * walked straight past it, every one of them a roster a person would plausibly write:
 *
 *   case r when 'routine-1-scraping' then 1 when 'routine-2-production' then 2 ... end
 *   from (values ('routine-1-scraping'),('routine-2-production'),...) t(r)
 *   where r in ('routine-1-scraping','routine-2-production',...)
 *
 * The CASE spelling is not hypothetical: it is how incident_route_owner() is written, so the one
 * shape most likely to be copied by someone adding a twelfth routine was the one shape invisible.
 *
 * Counting DISTINCT slugs in the body is syntax-agnostic and therefore cannot be dodged by choosing
 * a different bracket. Two is the threshold on purpose: a detector naming ONE routine in its alert
 * text ('routine-11-lifecycle' in mon_detect_unknown_treated_as_dead) is an attribution, not a
 * roster, and must stay green.
 */
export const ROSTER_HOMES = new Set([
  'incident_known_owners',  // the roster itself
  'incident_route_owner',   // the surface->owner MAP; names every slug by construction, and its
                            // totality + agreement with alertRouting.ts is pinned separately by
                            // scripts/verify-incident-spine.ts
]);

export const handRolledRosterIn = (fnName: string, body: string): number =>
  ROSTER_HOMES.has(fnName.toLowerCase()) ? 0 : new Set(slugsIn(body)).size >= 2
    ? new Set(slugsIn(body)).size
    : 0;

/** The roster the committed SQL declares, as a sorted set. */
export const declaredRoster = (knownOwnersFn: string): string[] =>
  [...new Set(slugsIn(knownOwnersFn))].sort();

/** True when the unknown-slug guard runs BEFORE the row is written. A guard after the UPDATE is decoration. */
export const guardPrecedesWrite = (handoffFn: string): boolean => {
  const guard = handoffFn.search(/raise exception 'unknown routine slug/);
  const write = handoffFn.search(/update\s+public\.ops_incident/i);
  return guard !== -1 && write !== -1 && guard < write;
};

/** True when the guard actually consults the shared roster rather than a literal of its own. */
export const guardUsesSharedRoster = (handoffFn: string): boolean =>
  /=\s*any\s*\(\s*public\.incident_known_owners\(\)\s*\)/i.test(handoffFn);

// ── Load every committed migration once.
//
// ALL of them, not just the ones naming a routine slug. Filtering here would be a real defect:
// `latestDefinitionOf` must see a function's NEWEST definition, and a later migration that
// redefines a detector WITHOUT a roster array is exactly the change that fixes this class. Reading
// only slug-bearing files would keep returning the superseded body and report a repair as a
// violation — a false red on the apparatus, which AGENTS.md calls dangerous in its own right.
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const bodies = new Map<string, string>();
for (const f of files) bodies.set(f, readFileSync(join(migDir, f), 'utf8'));

const slugBearing = [...bodies.values()].filter((b) => b.includes('routine-'));
check('committed migrations naming a routine slug were found', slugBearing.length > 0,
  'none found — the barrier would be vacuously green');

/** The LATEST committed definition of a function wins; migrations are append-only. */
const latestDefinitionOf = (fn: string): string => {
  let found = '';
  for (const f of files) {
    const slice = sliceFunction(bodies.get(f) ?? '', fn);
    if (slice) found = slice;
  }
  return found;
};

// ── 1. The SQL roster and the TypeScript roster are the same set, in both directions.
const knownOwners = latestDefinitionOf('incident_known_owners');
check('incident_known_owners() is defined in a committed migration', knownOwners !== '',
  'the roster has no committed source — production would be the only place it exists');

const sqlRoster = declaredRoster(knownOwners);
const tsRoster = Object.values(ROUTINES).map((r) => r.label).sort();
check(`the SQL roster lists all ${tsRoster.length} routines (${sqlRoster.length} found)`,
  sqlRoster.length === tsRoster.length && sqlRoster.every((s, i) => s === tsRoster[i]),
  `only in SQL: [${sqlRoster.filter((s) => !tsRoster.includes(s)).join(', ')}] | ` +
  `only in alertRouting.ts: [${tsRoster.filter((s) => !sqlRoster.includes(s)).join(', ')}]`);

// ── 2. incident_handoff() refuses a slug no routine reads, before it writes, using the roster.
const handoff = latestDefinitionOf('incident_handoff');
check('incident_handoff() is defined in a committed migration', handoff !== '');
check('incident_handoff() refuses an unknown routine slug',
  /raise exception 'unknown routine slug/.test(handoff),
  'a handoff to a typo creates a queue nobody reads — ops_incident #182 sat there for two days');
check('…and consults the shared roster rather than a list of its own',
  guardUsesSharedRoster(handoff));
check('…and does so BEFORE the row is updated', guardPrecedesWrite(handoff));

// ── 3. THE CLASS GUARD. No committed function may carry a roster array of its own.
// Discovery by shape: every function defined anywhere in the migrations that names a routine slug.
// Candidates come from the SLUG-BEARING migrations only: a function can carry a roster array only
// if some version of it named a routine slug. Its latest definition is then resolved against ALL
// migrations, so a later slug-free redefinition is what gets judged.
const declaredFns = new Set<string>();
for (const body of slugBearing) {
  for (const m of body.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi)) {
    declaredFns.add(m[1].toLowerCase());
  }
}
const handRolled: string[] = [];
for (const fn of declaredFns) {
  const n = handRolledRosterIn(fn, latestDefinitionOf(fn));
  if (n > 0) handRolled.push(`${fn} (${n} slugs)`);
}
check(`no function re-enumerates the roster by hand, in ANY syntax (${declaredFns.size} committed functions scanned)`,
  handRolled.length === 0,
  `hand-rolled roster(s) in: ${handRolled.join(', ')}. Call public.incident_known_owners() instead — ` +
  `a second copy is how routine-10-barrier's alert sat unretireable for 96.3 hours. If this is a ` +
  `legitimate second home, add it to ROSTER_HOMES with a reason rather than widening the predicate.`);

// ── 4. The hidden path is closed: a raw UPDATE cannot address a queue nobody reads.
const constraintMig = [...bodies.values()].find((b) => b.includes('ops_incident_owner_is_a_real_routine')) ?? '';
check('a CHECK constraint pins owner_routine to the roster',
  /add\s+constraint\s+ops_incident_owner_is_a_real_routine[\s\S]{0,200}incident_known_owners\(\)/i.test(constraintMig),
  'without it the guard only covers callers of incident_handoff(); a direct UPDATE still orphans a finding');

// ── MUTATION PROOFS. Each feeds a deliberately broken input to the SAME predicate used above.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

// The defect exactly as it shipped: the roster left at the pre-2026-09-04 seven.
const sevenOnly = knownOwners.replace(
  /'routine-8-regression-hunter','routine-9-red-team','routine-10-barrier','routine-11-lifecycle'/, "'routine-7-seam'");
mustCatch('the roster left at the pre-2026-09-04 seven (the defect as it shipped)',
  declaredRoster(sevenOnly).length !== tsRoster.length);
mustCatch('a single routine dropped from the roster',
  declaredRoster(knownOwners.replace(/'routine-11-lifecycle'/, "'routine-7-seam'")).length !== tsRoster.length);
mustCatch('a routine renamed in SQL but not in alertRouting.ts',
  !declaredRoster(knownOwners.replace(/'routine-6-journey'/, "'routine-6-journeys'"))
     .every((s) => tsRoster.includes(s)));
mustCatch('a slug that exists in SQL and in no routine at all (the #182 shape)',
  !declaredRoster(knownOwners.replace(/'routine-9-red-team'/, "'routine-8-regression'"))
     .every((s) => tsRoster.includes(s)));
mustCatch('…while the REAL committed roster is NOT flagged (the predicate is not vacuously red)',
  declaredRoster(knownOwners).every((s) => tsRoster.includes(s)) && sqlRoster.length === tsRoster.length);

// The handoff guard, removed and neutered.
mustCatch('incident_handoff losing its unknown-slug guard entirely',
  !/raise exception 'unknown routine slug/.test(
    handoff.replace(/if not \(p_new_owner[\s\S]*?end if;/, '')));
mustCatch('the guard being moved AFTER the update (the row has already landed)',
  !guardPrecedesWrite(
    "update public.ops_incident set owner_routine = p_new_owner;\n" +
    "raise exception 'unknown routine slug %', p_new_owner;"));
mustCatch('the guard checking a literal list of its own instead of the shared roster',
  !guardUsesSharedRoster(handoff.replace(
    /=\s*any\s*\(\s*public\.incident_known_owners\(\)\s*\)/i,
    "= any (array['routine-1-scraping','routine-2-production'])")));

// The class guard: a fourth copy appearing in a detector.
const reInlined = `create or replace function public.mon_detect_something() returns int language plpgsql as $function$
declare c_owners text[] := array['routine-1-scraping','routine-2-production','routine-3-data-integrity'];
begin return 0; end $function$;`;
mustCatch('a detector re-inlining its own roster array (the next stale copy)',
  handRolledRosterIn('mon_detect_something', sliceFunction(reInlined, 'mon_detect_something')) > 0);
mustCatch('…the same thing written as the stale seven',
  handRolledRosterIn('mon_detect_x', `array['routine-1-scraping','routine-2-production','routine-3-data-integrity',
    'routine-4-search-qa','routine-5-af-trending','routine-6-journey','routine-7-seam']`) > 0);

// THE THREE SPELLINGS THAT ESCAPED THE FIRST VERSION OF THIS BARRIER (measured 2026-09-13).
// Each is a roster a person would plausibly write, and each returned false under the array-only
// predicate while the check above reported "no function re-enumerates the roster by hand".
mustCatch('a roster written as a CASE — the shape incident_route_owner itself uses',
  handRolledRosterIn('mon_detect_thing', `select case r
     when 'routine-1-scraping' then 1 when 'routine-2-production' then 2
     when 'routine-3-data-integrity' then 3 when 'routine-7-seam' then 7 end`) > 0);
mustCatch('…a roster written as a VALUES list',
  handRolledRosterIn('mon_detect_other',
    `from (values ('routine-1-scraping'),('routine-2-production'),('routine-7-seam')) t(r)`) > 0);
mustCatch('…a roster written as an IN list',
  handRolledRosterIn('mon_detect_third',
    `where r in ('routine-1-scraping','routine-2-production','routine-7-seam')`) > 0);

mustCatch('…while a detector naming ONE routine for attribution is NOT flagged (no false red)',
  handRolledRosterIn('mon_detect_unknown_treated_as_dead', `'routine-11-lifecycle'`) === 0);
mustCatch('…and the roster function itself is NOT flagged for containing the roster',
  handRolledRosterIn('incident_known_owners', knownOwners) === 0);
mustCatch('…nor is incident_route_owner, the surface→owner map pinned by verify-incident-spine.ts',
  handRolledRosterIn('incident_route_owner',
    `case s when 'search' then 'routine-4-search-qa' when 'trending' then 'routine-5-af-trending' end`) === 0);
mustCatch('…but an exempt NAME does not launder a roster in a DIFFERENT function',
  handRolledRosterIn('mon_detect_copycat',
    `case s when 'search' then 'routine-4-search-qa' when 'trending' then 'routine-5-af-trending' end`) > 0);

// Fail-closed: a missing definition must never read as a silent pass.
mustCatch('the roster function disappearing from the migrations',
  declaredRoster(sliceFunction('-- nothing here', 'incident_known_owners')).length !== tsRoster.length);
mustCatch('incident_handoff disappearing from the migrations',
  !guardPrecedesWrite(sliceFunction('-- nothing here', 'incident_handoff')));
mustCatch('the CHECK constraint being dropped',
  !/add\s+constraint\s+ops_incident_owner_is_a_real_routine/i.test(
    constraintMig.replace(/add\s+constraint\s+ops_incident_owner_is_a_real_routine/gi, 'add constraint something_else')));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the roster has one source, every handoff is checked against it, and nothing keeps a copy\n');
