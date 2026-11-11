// «منذ 23 يوم» NEVER MAKES AN AD LOOK NEWER THAN IT IS (owner 2026-11-11: «if it says last month … we need to
// calculate it correctly … do whatever guard to make the dates accurate»).
//
// ialqarawi prints only HOW LONG AGO an ad was added («مضاف منذ 23 يوم», «7 شهر», «1 سنة»), never the day. Measured
// that day on production: every ad saying «N يوم» was first stored by us exactly N days earlier (4 of «23 يوم» → 23
// days, 2 of «10 يوم» → 10 …), so the count is the real age, not a re-post bump. Until then those 2,629 ads had no
// date and were missing from every «نُشر خلال» window.
//
// The count is turned into a FLOOR — «posted no earlier than» — stored in `posted_earliest_at`, never in
// `date_added` (the card prints that as a day). The «نُشر خلال» window reads the floor, so an ad counts under «30
// يوماً» only when even its oldest possible day is inside 30 days.
//
// This check EXECUTES the real code, never a copy of it:
//   1. a sweep plays a site over ~5,000 true ages × every way a site may count (floored or rounded, 30-day or
//      calendar months, 365-day years) and fails if ANY floor lands after the true posting time;
//   2. exact floors for the shapes ialqarawi really prints, so a floor that is safe but uselessly loose fails too;
//   3. text that is not a plain count — a «last updated» phrase, a real date, a dual with a number — stays unknown;
//   4. the real ialqarawi mapper writes the floor, and never into date_added;
//   5. each of those is shown to catch a planted mistake.
// The database half (keep the tightest floor, refuse a floor after the day we first stored the ad, feed the search
// index) is watched live by mon_detect_relative_posting_floor_unsafe(), migration 20261111233249.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FIXTURE = join(ROOT, 'scripts/lib/relative_posting_date_fixture.py');
const HELPER = readFileSync(join(ROOT, 'scrapers/common/posting_date.py'), 'utf8');
const MAPPER = readFileSync(join(ROOT, 'scrapers/ialqarawi/run.py'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const py = (fn: string, args: unknown[], mutated_source?: string): any => JSON.parse(execFileSync(
  'python3', ['-I', FIXTURE, ROOT],
  { input: JSON.stringify({ fn, args, mutated_source: mutated_source ?? null }), encoding: 'utf8',
    // No database configured: the mapper's location helpers then answer from the seeded catalogue alone.
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('SUPABASE_'))) },
));
/** A mutated copy of `src`; throws when the anchor is gone so a stale mutation is loud, never a silent pass. */
const mutate = (src: string, find: string, repl: string) => {
  if (!src.includes(find)) throw new Error(`mutation anchor not found: ${find}`);
  return src.replace(find, repl);
};

// ── 1. no floor is ever after the truth ─────────────────────────────────────────────────────────────────────────
const sweep = (src?: string) => py('sweep', [], src);
const real = sweep();
check(`no «منذ …» reading lands after the true posting time (${real.read} readings)`, real.read > 10000 && real.bad_count === 0,
  JSON.stringify(real.bad));

// ── 2. exact floors, read at 2026-11-11 09:30 UTC (the +1 hour is the read-to-write and clock margin) ──────────────
const EXACT: [string, string][] = [
  ['23 يوم', '2026-10-18T08:30:00+00:00'],          // younger than 24 days
  ['مضاف منذ 2 يوم', '2026-11-08T08:30:00+00:00'],
  ['منذ يومين', '2026-11-08T08:30:00+00:00'],
  ['7 شهر', '2026-03-08T08:30:00+00:00'],           // younger than 8 × 31 days
  ['1 سنة', '2024-11-09T08:30:00+00:00'],           // younger than 2 × 366 days
  ['٣ ساعات', '2026-11-11T04:30:00+00:00'],         // Arabic-Indic digits; younger than 4 hours
];
const exact = (src?: string) => py('floors', [EXACT.map(([t]) => t)], src) as (string | null)[];
const got = exact();
EXACT.forEach(([text, want], i) => check(`«${text}» → posted no earlier than ${want}`, got[i] === want, `got ${got[i]}`));

// ── 3. not a plain count → unknown ──────────────────────────────────────────────────────────────────────────────
const UNKNOWN = ['آخر تحديث منذ 3 أيام', '2026-11-01', '3 يومين', 'منذ فترة', 'قليل', '', '4 سنة تقريبا'];
const unknown = (src?: string) => (py('floors', [UNKNOWN], src) as (string | null)[]);
const u = unknown();
UNKNOWN.forEach((text, i) => check(`«${text}» stays unknown (no floor)`, u[i] === null, `got ${u[i]}`));

// ── 4. the real ialqarawi mapper ────────────────────────────────────────────────────────────────────────────────
const mapped = (ago: string | null, src?: string) => py('ialqarawi', [ago], src);
const m = mapped('23 يوم');
const floorMs = m.floor ? Date.parse(m.floor) : NaN;
const lo = Date.parse(m.before) - (24 * 86400 + 3600) * 1000 - 1000;
const hi = Date.parse(m.after) - (24 * 86400 + 3600) * 1000 + 1000;
check('ialqarawi «23 يوم» → posted_earliest_at = now − 24 days − 1 hour', m.mapped && floorMs >= lo && floorMs <= hi, JSON.stringify(m));
check('ialqarawi never writes the floor into date_added (the card prints that as a real day)', m.mapped && m.date_added == null, JSON.stringify(m));
const blank = mapped(null);
check('ialqarawi with no «مضاف منذ» writes no floor', blank.mapped && blank.floor == null, JSON.stringify(blank));

// ── 5. planted mistakes are caught ──────────────────────────────────────────────────────────────────────────────
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);
const H = (find: string, repl: string) => mutate(HELPER, find, repl);
mustCatch('a count read as its OWN age («23 يوم» = 23 days, so a 23½-day ad looks newer)',
  sweep(H('timedelta(days=day * (n + 1))', 'timedelta(days=day * n)')).bad_count > 0);
mustCatch('a month taken as 30 days (calendar months run longer)', sweep(H('"month": 31,', '"month": 30,')).bad_count > 0);
mustCatch('a year taken as 365 days in the bound', exact(H('"year": 366}', '"year": 365}'))[4] !== EXACT[4][1]);
mustCatch('the read-to-write margin dropped', exact(H('_AGO_MARGIN = timedelta(hours=1)', '_AGO_MARGIN = timedelta(0)'))[0] !== EXACT[0][1]);
mustCatch('a «last updated» phrase read as a posting count',
  unknown(H('(?:مضاف|أضيف|اضيف|منذ|قبل)', '(?:مضاف|أضيف|اضيف|منذ|قبل|آخر|تحديث)'))[0] !== null);
mustCatch('a number in front of a dual accepted («3 يومين»)',
  unknown(H('    if m.group(1) is not None and alone == 2:\n        return None', '    if False:\n        return None'))[2] !== null);
const M = (find: string, repl: string) => mutate(MAPPER, find, repl);
const FLOOR_LINE = '        row["posted_earliest_at"] = floor';
mustCatch('the mapper writing the floor into date_added', mapped('23 يوم', M(FLOOR_LINE, '        row["date_added"] = floor')).date_added != null);
mustCatch('the mapper dropping the floor', mapped('23 يوم', M(FLOOR_LINE, '        pass')).floor == null);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\n«منذ …» becomes a floor that never makes an ad look newer: OK');
