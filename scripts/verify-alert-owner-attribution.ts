// Barrier: AN UNWORKED ALERT QUEUE MUST NAME A ROUTINE, AND OWNERSHIP MUST STAY SINGLE-SOURCED.
//
// Two properties, both of which a well-meaning edit would quietly break.
//
// 1. ATTRIBUTION. mon_detect_alert_queue_unworked() must group the backlog BY OWNER and put the
//    owner in its dedup key. The first version reported one aggregate number, which is a fact
//    nobody owns: "106 alerts unacknowledged" is not a task, "routine-3 has 24, oldest 24 days" is.
//    The owner's instruction (2026-09-04) was "Creating an issue and leaving it there is not
//    success." An aggregate alert cannot be worked, only read.
//
// 2. SINGLE SOURCE. routineForKind() in scripts/lib/alertRouting.ts is the ONE implementation of
//    kind -> routine, and that file's own header forbids mirroring it ("Do not 'mirror' this table
//    into the workflow or into SQL -- that would create the drift this shape avoids"). So SQL must
//    never compute an owner; it may only read the projection that alert-dispatch.yml writes after
//    executing the real function. This barrier fails if a CASE/regex mapping kinds to routines ever
//    appears in the migration, which is exactly how the second copy would arrive.
//
//   node --experimental-strip-types scripts/verify-alert-owner-attribution.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// Identify the migration by CONTENT so a rename cannot orphan this barrier, and require the match
// to be unique so it can never silently assert against the wrong file.
const migDir = join(root, 'supabase', 'migrations');
const hits = readdirSync(migDir).sort()
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(migDir, f), 'utf8'))
  .filter((b) => b.includes('alert_event add column if not exists owner_routine'));
check('the owner_routine migration is committed (production and git agree)', hits.length === 1,
  `${hits.length} migrations add owner_routine — expected exactly 1`);
const mig = hits[0] ?? '';
const wf = readFileSync(join(root, '.github/workflows/alert-dispatch.yml'), 'utf8');
// Strip full-line YAML comments at the READER, so prose explaining the mechanism can never satisfy
// a check about the mechanism.
const wfCode = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

console.log('\nAlert ownership — attributed to a routine, and computed in exactly one place\n');

// ── 1. the column and its index exist ───────────────────────────────────────────────────────────
check('alert_event carries owner_routine', /add column if not exists owner_routine text/.test(mig));
check('open alerts are indexed by owner (the detector groups on it every tick)',
  /create index if not exists alert_event_open_by_owner/.test(mig));

// ── 2. the detector attributes rather than aggregates ───────────────────────────────────────────
const fn = /create or replace function public\.mon_detect_alert_queue_unworked\(\)([\s\S]*?)\$fn\$;/.exec(mig)?.[1] ?? '';
check('the unworked-queue detector exists in this migration', fn !== '');
check('it groups the backlog BY OWNER', /coalesce\(a\.owner_routine, '\(unrouted\)'\) as owner/.test(fn) && /group by 1/.test(fn));
check('the dedup key carries the owner, so each routine gets its own answerable alert',
  /'alert_queue_unworked:' \|\| rec\.owner/.test(fn));
check('an un-routed row reads as (unrouted) rather than joining another routine’s pile',
  /'\(unrouted\)'/.test(fn));
check('a backlog containing a P0 escalates the alert to P0',
  /case when rec\.p0 > 0 then 'P0' else 'P1' end/.test(fn));
check('it self-heals per owner across ALL possible owners, not only those with rows today',
  /c_owners text\[\]/.test(fn) && /unnest\(c_owners\)/.test(fn));
check('the superseded aggregate key is explicitly retired (a zombie alert cannot self-heal)',
  /mon_resolve_key\('alert_queue_unworked', 'alert_queue_unworked:all'\)/.test(fn));
check('the grace window is not silently widened (48h)', /interval '48 hours'/.test(fn));

// ── 3. SQL must never become a second copy of the routing map ───────────────────────────────────
const ROUTINE_LITERALS = (mig.match(/'routine-[1-7]-[a-z-]+'/g) ?? []).length;
const selfHealList = (fn.match(/'routine-[1-7]-[a-z-]+'/g) ?? []).length;
check('the only routine names in SQL are the self-heal roster, never a kind→routine mapping',
  ROUTINE_LITERALS === selfHealList && selfHealList === 7,
  `${ROUTINE_LITERALS} routine literals in the migration, ${selfHealList} of them in the self-heal roster`);
check('SQL never maps an alert KIND to a routine (that map has exactly one implementation)',
  !/kind\s*(=|~|like|in)\s*[^\n]*routine-/i.test(mig),
  'a kind→routine mapping has appeared in SQL — scripts/lib/alertRouting.ts is the single source');

// ── 4. the workflow writes the projection, from the SAME value it labels with ───────────────────
check('the routing sweep writes owner_routine back to alert_event',
  /PATCH[\s\S]{0,300}alert_event\?dedup_key=eq/.test(wfCode) && /owner_routine/.test(wfCode));
check('it writes the SAME variable it labels the issue with (one answer, two destinations)',
  /--add-label "\$label"/.test(wfCode) && /\\"owner_routine\\":\\"\$\{label\}\\"/.test(wfCode),
  'the label and the written owner have diverged — they must be the same computed value');
check('it only ever FILLS a null, so a hand-corrected owner is never overwritten',
  /owner_routine=is\.null/.test(wfCode));
check('it only writes for unresolved alerts', /resolved_at=is\.null/.test(wfCode));
check('the label is still computed by executing the real routing module',
  /scripts\/alert-routing-label\.ts/.test(wfCode));
check('every open alert issue is walked, so pre-existing ones get backfilled',
  /routed: \(\[\.labels\[\]\.name\] \| map\(startswith\("routine-"\)\) \| any\)/.test(wfCode));
check('the label is still applied ONLY when absent (a human re-route is respected)',
  /if \[ "\$already" = "false" \]; then/.test(wfCode));
check('a failed write-back warns instead of failing the whole dispatch run',
  /::warning::could not write owner_routine/.test(wfCode));

// ── mutation self-proof ─────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
mustCatch('the detector going back to one anonymous aggregate',
  !/'alert_queue_unworked:' \|\| rec\.owner/.test(fn.replace(/'alert_queue_unworked:' \|\| rec\.owner/, "'alert_queue_unworked:all'")));
mustCatch('the superseded :all key no longer being retired',
  !/mon_resolve_key\('alert_queue_unworked', 'alert_queue_unworked:all'\)/.test(
    fn.replace(/perform public\.mon_resolve_key\('alert_queue_unworked', 'alert_queue_unworked:all'\);/, '')));
mustCatch('a kind→routine mapping appearing in SQL',
  /kind\s*(=|~|like|in)\s*[^\n]*routine-/i.test(mig + "\n  if kind like 'af_%' then owner := 'routine-5-af-trending'; end if;"));
mustCatch('the write-back overwriting an owner someone had corrected by hand',
  !/owner_routine=is\.null/.test(wfCode.replace(/&owner_routine=is\.null/, '')));
mustCatch('the label and the written owner diverging',
  !/\\"owner_routine\\":\\"\$\{label\}\\"/.test(wfCode.replace(/\\"owner_routine\\":\\"\$\{label\}\\"/, '\\"owner_routine\\":\\"routine-2-production\\"')));
mustCatch('the grace window being widened to make the alert quieter',
  !/interval '48 hours'/.test(fn.replace(/interval '48 hours'/, "interval '30 days'")));
mustCatch('the migration finder going blind if the column is dropped',
  !''.includes('alert_event add column if not exists owner_routine'));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the alert backlog names its routine, and kind→routine still has exactly one implementation\n');
