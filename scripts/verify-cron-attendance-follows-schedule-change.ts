// cron_health limb 5 (ATTENDANCE) must judge a job only against the schedule it actually had.
//
// THE DEFECT (2026-11-03, alert cron_absent:188). gh-facts-words-nightly went daily -> hourly at :25 ->
// hourly at :01 within ten hours. mon_detect_cron_health() already stamps the change in
// ops_cron_job_first_seen.schedule_changed_at (and limb 3's grace respects it), but limb 5 passed only
// first_seen_at to mon_cron_attendance_expected() and counted runs over a flat 24 h. Result: "18 of 24
// runs, 75 %" for a job that had started every run due under each schedule — a P2 that told the next
// engineer to go hunting for top-of-hour worker contention that did not exist.
//
// THE RULE. The expected count and the actual count both start at
//     greatest(first_seen_at, schedule_changed_at, now() - 24 h)
// so a run is only expected from the moment the schedule that predicts it existed, and only runs from
// that same moment are counted against it. A job whose schedule did not change is judged exactly as
// before — a genuinely dropped run still raises (direction 2 below).
//
// HOW THIS CHECKS IT (hermetic). It reads the LATEST committed migration that defines or patches the
// limb-5 query, decides from its text whether each window honours schedule_changed_at, and then EXECUTES
// the limb's decision (a TS transcription of its threshold) on two scenarios with the windows that text
// implies. The mutation is the previous committed definition (20260923233458), which must FAIL.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');

type Windows = { expectedHonoursChange: boolean; actualHonoursChange: boolean };

function windowsFrom(sql: string): Windows | null {
  // The LAST occurrence wins: a patch migration names the old text as its anchor first and the
  // replacement after it, and the replacement is what production runs.
  const exp = [...sql.matchAll(/mon_cron_attendance_expected\(j\.schedule,\s*([^\n]*?)\)\s+as expected_24h/g)].at(-1);
  const act = [...sql.matchAll(/and d\.start_time > ([^\n]*?)\)::int as actual_24h/g)].at(-1);
  if (!exp || !act) return null;
  return {
    expectedHonoursChange: /schedule_changed_at/.test(exp[1]),
    actualHonoursChange: /schedule_changed_at/.test(act[1]),
  };
}

const H = 3600_000;
// One hourly job (1 run/hour). runs = start times in ms relative to now (negative).
function limb5Raises(w: Windows, firstSeenAgoH: number, changedAgoH: number | null, runsAgoH: number[]): boolean {
  const now = 0;
  const win24 = now - 24 * H;
  const firstSeen = now - firstSeenAgoH * H;
  const changed = changedAgoH == null ? null : now - changedAgoH * H;
  const startExp = w.expectedHonoursChange ? Math.max(firstSeen, changed ?? -Infinity) : firstSeen;
  // mon_cron_attendance_expected: floor(minutes_in_hour * least(24h, now - start)/1h)
  const expected = Math.floor(Math.max(0, Math.min(24 * H, now - startExp)) / H);
  const startAct = w.actualHonoursChange ? Math.max(win24, firstSeen, changed ?? -Infinity) : win24;
  const actual = runsAgoH.map((h) => now - h * H).filter((t) => t > startAct).length;
  return expected >= 24 && actual < expected - 1 && actual / expected < 0.9;
}

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// The job-188 day: daily at ~-38h, then hourly :25 from -20h to -12h, then hourly :01 from -10.5h on.
const rescheduledRuns = [38, ...Array.from({ length: 9 }, (_, i) => 20 - i), ...Array.from({ length: 11 }, (_, i) => 10.4 - i)];
// A job that never changed schedule and genuinely lost 6 of its last 24 runs.
const droppedRuns = Array.from({ length: 24 }, (_, i) => i + 0.5).filter((h) => ![2, 5, 9, 13, 17, 21].includes(Math.floor(h)));

function judge(sql: string) {
  const w = windowsFrom(sql);
  if (!w) return { parsed: false, falseAlarm: true, missesRealDrop: true };
  return {
    parsed: true,
    falseAlarm: limb5Raises(w, 9 * 24, 10.6, rescheduledRuns),
    missesRealDrop: !limb5Raises(w, 9 * 24, null, droppedRuns),
  };
}

console.log('verify-cron-attendance-follows-schedule-change: limb 5 judges a job against the schedule it had.');

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const defining = files.filter((f) => /as expected_24h/.test(readFileSync(join(MIG, f), 'utf8')));
const latest = defining.at(-1);
check('a committed migration defines limb 5', Boolean(latest));
if (latest) {
  const r = judge(readFileSync(join(MIG, latest), 'utf8'));
  check(`${latest}: limb-5 windows are readable`, r.parsed);
  check(`${latest}: a rescheduled job that ran every due run does NOT raise`, !r.falseAlarm,
    'expected/actual windows ignore schedule_changed_at — the job-188 false alarm');
  check(`${latest}: a job that really dropped 6 of 24 runs still raises`, !r.missesRealDrop);
}

// Mutation proof: the previous definition must be caught.
const OLD = files.find((f) => f.startsWith('20260923233458'));
check('the pre-fix definition is still in the tree (mutation source)', Boolean(OLD));
if (OLD) {
  const r = judge(readFileSync(join(MIG, OLD), 'utf8'));
  check('mutation: the pre-fix limb 5 is caught raising on the rescheduled job', r.parsed && r.falseAlarm);
  check('mutation: the pre-fix limb 5 still catches a real drop (the check is not one-sided)', r.parsed && !r.missesRealDrop);
}
// Mutation: honouring the change only in the ACTUAL window is not enough (it shrinks the numerator
// while the denominator still expects 24 runs).
{
  const other: Windows = { expectedHonoursChange: false, actualHonoursChange: true };
  check('mutation: honouring the change only in the actual window raises on the rescheduled job',
    limb5Raises(other, 9 * 24, 10.6, rescheduledRuns));
}

if (failures) {
  console.log(`\n❌ verify-cron-attendance-follows-schedule-change: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-cron-attendance-follows-schedule-change: passed.');
