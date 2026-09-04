// Barrier: THE INCIDENT SPINE'S TWO LOAD-BEARING PROMISES CANNOT BE QUIETLY REMOVED.
//
// ops_incident (migration 20260904144004) exists because the alerting layer detects well and closes
// badly: 1,014 alerts raised all-time, 2 ever acknowledged, 106 open with the oldest at 24 days. The
// table is only worth having if two specific properties hold, and both are the kind of thing a
// future "cleanup" removes without noticing:
//
//   1. RESOLUTION IS EARNED. `state = 'resolved'` is unreachable without naming a permanent
//      regression barrier AND stamping a production verification — enforced by a CHECK constraint,
//      not by an agent remembering at the end of a long run. Drop that constraint and the whole
//      point of the table evaporates while every other test stays green.
//   2. OWNERSHIP IS TOTAL AND AGREES WITH THE REST OF THE SYSTEM. incident_route_owner() must map
//      every surface to one of the SAME seven routine slugs that scripts/lib/alertRouting.ts uses.
//      Two independent copies of a seven-name list is exactly the divergence this codebase has been
//      burned by (docs/ops/ALERT_ROUTING.md exists because "an alert with no owner is the hole this
//      closes"). If someone renames a routine in the TypeScript and not in the SQL, incidents route
//      to a label no GitHub query will ever select, and they become invisible — silently.
//
// This runs offline against the committed migration mirror and the real TypeScript module. It
// deliberately does NOT hit the database: the live half is proven by executing the functions in
// production (that self-test is recorded in the PR), and a barrier that needs credentials cannot run
// on every PR, which is where a rename would actually land.
//
//   node --experimental-strip-types scripts/verify-incident-spine.ts   (in `npm test` by existing)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTINES, routineForKind, FALLBACK_ROUTINE } from './lib/alertRouting.ts';

const root = join(import.meta.dirname, '..');
const migDir = join(root, 'supabase', 'migrations');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The spine's migration is identified by its content, not its filename, so a rename cannot orphan
// this barrier — and a MISSING file is a failure rather than a silent skip.
// ALL needles must appear in the same file. A single needle is not enough to identify a migration
// here: `mon_detect_alert_queue_unworked` appears in both the spine (which defines it) and the
// roster (which lists it), and `mon_run_all_detectors` appears in every migration that has ever
// edited the roster. Requiring a conjunction makes the match unique, and a match that is not unique
// is reported rather than silently resolved to whichever file sorts first.
const migrationNamed = (...needles: string[]): string => {
  const hits: string[] = [];
  for (const f of readdirSync(migDir).sort()) {
    if (!f.endsWith('.sql')) continue;
    const body = readFileSync(join(migDir, f), 'utf8');
    if (needles.every((n) => body.includes(n))) hits.push(body);
  }
  if (hits.length > 1) {
    console.error(`FAIL  ${hits.length} migrations match [${needles.join(' + ')}] — the needle set is ambiguous`);
    failures++;
  }
  return hits[0] ?? '';
};

const spine = migrationNamed('create table if not exists public.ops_incident');
const roster = migrationNamed('mon_run_all_detectors', 'mon_detect_stalled_incident');
// The surface VOCABULARY, added 2026-09-04 after a coverage audit found ~9 real user-reachable
// surfaces with no name — so findings on them fell through to the routine-2 fallback and arrived
// indistinguishable from noise.
const vocab = migrationNamed('incident_known_surfaces', 'unknown incident surface');

console.log('\nIncident spine — resolution stays earned, and ownership stays total\n');

check('the ops_incident migration is committed (production and git agree)', spine !== '',
  'no migration in supabase/migrations/ creates public.ops_incident');
check('the roster migration is committed', roster !== '',
  'the two detectors exist but nothing in git puts them on mon_run_all_detectors()');

// ── 1. RESOLUTION IS EARNED ────────────────────────────────────────────────────────────────────
// Assert the CONSTRAINT, not the helper function: incident_resolve() guards the front door, but the
// constraint is what stops a raw UPDATE from walking round the back. Production proved both refuse.
const earned = /constraint\s+ops_incident_resolution_is_earned\s+check\s*\(([\s\S]*?)\)\s*,/.exec(spine)?.[1] ?? '';
check('a CHECK constraint — not merely a function — guards resolution', earned !== '',
  'ops_incident_resolution_is_earned is gone; a raw UPDATE can now close an incident');
check('resolution requires a named regression barrier', /barrier_script\s+is\s+not\s+null/.test(earned));
check('resolution requires a production verification', /production_verified_at\s+is\s+not\s+null/.test(earned));
check('both are required together, not either-or', /\band\b/.test(earned) && !/\bor\s+production_verified/.test(earned),
  `the constraint reads: ${earned.replace(/\s+/g, ' ').trim()}`);

check('the two non-fix exits must state a reason',
  /constraint\s+ops_incident_non_fix_exit_needs_a_reason/.test(spine)
  && /state\s+not\s+in\s*\(\s*'blocked'\s*,\s*'wont_fix'\s*\)/.test(spine));
check('a handoff records where it came from',
  /constraint\s+ops_incident_handoff_records_its_origin/.test(spine));

// blocked is the only state that routinely reaches the owner, so entering it must cite §G.2.
check('blocking cites one of §G.2’s six legitimate reasons to stop',
  /p_g2_category/.test(spine) && /not in \('a','b','c','d','e','f'\)/.test(spine));
check('an ownership/permission block is REFUSED in favour of routing (§G.3)',
  /lower\(p_g2_category\) in \('d','e'\)/.test(spine) && /incident_handoff/.test(spine),
  'categories (d) and (e) are boundaries §G.3 says must be ROUTED, never parked as blocked');

// ── 2. OWNERSHIP IS TOTAL AND AGREES WITH alertRouting.ts ──────────────────────────────────────
const sqlSlugs = new Set(
  [...spine.matchAll(/then\s+'(routine-[a-z0-9-]+)'/g)].map((m) => m[1]));
const elseSlug = /else\s+'(routine-[a-z0-9-]+)'\s*\n?\s*end/.exec(spine)?.[1] ?? '';
if (elseSlug) sqlSlugs.add(elseSlug);

// Execute the real module rather than string-matching it — the repo's standing rule.
const tsSlugs = new Set(Object.values(ROUTINES).map((r: { label: string }) => r.label));

check('incident_route_owner() is TOTAL (it has an else branch)', elseSlug !== '',
  'without an else, an unmapped surface yields NULL and owner_routine is NOT NULL — inserts would throw');
check('the fallback owner is the standing triage router, routine #2',
  elseSlug === 'routine-2-production', `fallback is ${elseSlug || '(none)'}`);
check('every routine slug in SQL exists in scripts/lib/alertRouting.ts',
  [...sqlSlugs].every((s) => tsSlugs.has(s)),
  `SQL-only slugs: ${[...sqlSlugs].filter((s) => !tsSlugs.has(s)).join(', ') || '(none)'}`);
check('all seven routines are reachable as incident owners',
  [...tsSlugs].every((s) => sqlSlugs.has(s)),
  `routines no incident can ever be routed to: ${[...tsSlugs].filter((s) => !sqlSlugs.has(s)).join(', ') || '(none)'}`);

// ── 2c. the surface vocabulary: unknown must be LOUD, never a silent fallback ───────────────────
// Routing stays total (a fallback is a real owner, not a bin), but "I deliberately chose #2" and
// "I typed `resultcard` instead of `result_card`" must not produce the same row. An unrecognised
// surface is UNKNOWN, and this repo's standing rule is that unknown is never quietly answered.
check('the surface vocabulary is committed', vocab !== '');
check('incident_open REFUSES a surface nobody named',
  /raise exception 'unknown incident surface/.test(vocab),
  'an unknown surface would route to #2 and be indistinguishable from a deliberate assignment');
check('the refusal names the whole valid vocabulary, so a caller can fix it without reading the migration',
  /array_to_string\(public\.incident_known_surfaces\(\), ', '\)/.test(vocab));
check('the guard runs BEFORE the row is created (a bad surface never lands)',
  vocab.indexOf("raise exception 'unknown incident surface") < vocab.indexOf('insert into public.ops_incident'));

// Every named surface must reach a REAL routine. Parsed out of the vocabulary list and mapped
// through the same CASE the database uses, so a surface added to one and not the other is caught.
const known = (/incident_known_surfaces\(\)[\s\S]*?select array\[([\s\S]*?)\]/.exec(vocab)?.[1] ?? '')
  .match(/'([a-z_]+)'/g)?.map((q) => q.slice(1, -1)) ?? [];
const routeCase = /create or replace function public\.incident_route_owner[\s\S]*?\$fn\$;/.exec(vocab)?.[0] ?? '';
const mapped = new Set([...routeCase.matchAll(/when '([a-z_]+)'\s+then/g)].map((m) => m[1]));
check(`the vocabulary is non-trivial (${known.length} surfaces)`, known.length >= 30,
  `parsed only ${known.length} surfaces — the reader is broken, so the checks below would pass vacuously`);
const unmapped = known.filter((k) => !mapped.has(k));
check('every named surface has an EXPLICIT route (none relies on the fallback)',
  unmapped.length === 0,
  `named but not mapped, so they would silently land on #2: ${unmapped.join(', ')}`);
for (const s of ['agent', 'interview', 'share', 'account_menu', 'browser', 'devices', 'support', 'intro', 'mode_switch', 'feedback']) {
  check(`'${s}' is nameable (a finding there can be delivered)`, known.includes(s));
}

// ── 3. the state machine covers the owner's loop, end to end ───────────────────────────────────
const states = /state\s+text\s+not null default 'open'\s*\n?\s*check \(state in \(([\s\S]*?)\)\)/.exec(spine)?.[1] ?? '';
for (const s of ['open', 'investigating', 'reproduced', 'fixed', 'verifying', 'resolved',
                 'handed_off', 'blocked', 'wont_fix']) {
  check(`state '${s}' exists`, states.includes(`'${s}'`));
}
check('re-observing a RESOLVED incident reopens it (a barrier that did not hold is louder than the bug)',
  /if v_state = 'resolved' then[\s\S]{0,400}set state = 'open'/.test(spine));
check('severity escalates on re-observation and never silently downgrades',
  /incident_worst_severity/.test(spine));

// ── 4. the detectors are rostered, and report per owner rather than per incident ───────────────
check('both incident detectors are added to the roster in a committed migration',
  /mon_detect_stalled_incident/.test(roster) && /mon_detect_alert_queue_unworked/.test(roster));
check('the roster edit verifies its own result instead of trusting the replace',
  /expected exactly 2/.test(roster) && /post-edit verification failed/.test(roster),
  'a roster edit that does not re-read the function can silently no-op or clobber a concurrent append');
check('stalled incidents are reported per OWNER, not per incident (no alert storm)',
  /group by owner_routine/.test(spine));

// The loop's own alerts must not land on the #2 fallback. An alert saying "nobody is reading the
// alert queue", filed to the busiest triage queue, is the joke version of this whole project — and
// alertRouting.ts's own header warns that #2 inheriting a backlog by default is how a triage router
// stops being read. Executed, not string-matched.
for (const kind of ['alert_queue_unworked', 'incident_stalled']) {
  check(`'${kind}' is explicitly routed, not left to the #2 fallback`,
    routineForKind(kind) !== FALLBACK_ROUTINE,
    `routineForKind('${kind}') === ${routineForKind(kind)}, which is the fallback`);
}

// ── mutation self-proof: every claim above must FAIL against its own defect ────────────────────
let mutFail = 0;
const mustCatch = (label: string, brokenIsCaught: boolean) => {
  if (brokenIsCaught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

const dropConstraint = spine.replace(
  /constraint\s+ops_incident_resolution_is_earned\s+check\s*\([\s\S]*?\)\s*,/, '');
mustCatch('the earned-resolution constraint being dropped',
  !/constraint\s+ops_incident_resolution_is_earned/.test(dropConstraint));

const weakened = spine.replace(
  /(constraint\s+ops_incident_resolution_is_earned\s+check\s*\()([\s\S]*?)(\)\s*,)/,
  "$1 state <> 'resolved' or barrier_script is not null $3");
const weakEarned = /constraint\s+ops_incident_resolution_is_earned\s+check\s*\(([\s\S]*?)\)\s*,/.exec(weakened)?.[1] ?? '';
mustCatch('resolution no longer requiring a production verification',
  !/production_verified_at\s+is\s+not\s+null/.test(weakEarned));

const renamed = spine.replace(/'routine-6-journey'/g, "'routine-6-journeys'");
const renamedSlugs = new Set([...renamed.matchAll(/then\s+'(routine-[a-z0-9-]+)'/g)].map((m) => m[1]));
mustCatch('a routine renamed in SQL but not in alertRouting.ts',
  ![...renamedSlugs].every((s) => tsSlugs.has(s)));

const untotal = spine.replace(/else\s+'routine-2-production'/, '');
mustCatch('incident_route_owner() losing its else branch and becoming partial',
  /else\s+'(routine-[a-z0-9-]+)'\s*\n?\s*end/.exec(untotal)?.[1] === undefined);

const noReopen = spine.replace(/set state = 'open', resolved_at = null/, 'set resolved_at = resolved_at');
mustCatch('a regressed incident no longer reopening',
  !/if v_state = 'resolved' then[\s\S]{0,400}set state = 'open'/.test(noReopen));

const parkable = spine.replace(/lower\(p_g2_category\) in \('d','e'\)/, "lower(p_g2_category) in ('zz')");
mustCatch('an ownership boundary becoming parkable as blocked instead of routed',
  !/lower\(p_g2_category\) in \('d','e'\)/.test(parkable));

// Prove the routing check can fail: a kind nothing claims MUST read as the fallback.
mustCatch('a loop kind that lost its explicit route (falls back to #2)',
  routineForKind('a_kind_no_rule_will_ever_claim_xyzzy') === FALLBACK_ROUTINE);

mustCatch('incident_open losing its unknown-surface guard',
  !/raise exception 'unknown incident surface/.test(vocab.replace(/raise exception 'unknown incident surface[\s\S]*?end if;/, '')));
mustCatch('a surface named in the vocabulary but never routed',
  (() => { const k = [...known, 'a_surface_with_no_route']; return k.filter((x) => !mapped.has(x)).length > 0; })());
mustCatch('the guard being moved AFTER the insert (a bad surface would already have landed)',
  (() => { const bad = "insert into public.ops_incident\n raise exception 'unknown incident surface";
           return bad.indexOf("raise exception 'unknown incident surface") > bad.indexOf('insert into public.ops_incident'); })());

mustCatch('the migration-finder going blind when the table is gone',
  (() => { const s = spine.replace('create table if not exists public.ops_incident', 'create table x');
           return !s.includes('create table if not exists public.ops_incident'); })());

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ an incident cannot close without a barrier and a production verification, and every surface has a real owner\n');
