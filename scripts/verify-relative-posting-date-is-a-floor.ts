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
// index, log every flip, switch a site off when its count restarts) is watched live by
// mon_detect_relative_posting_floor_unsafe(), migrations 20261111233249 and 20261111235627.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
check(`no «منذ …» reading puts the floor after, or the ceiling before, the true posting time (${real.read} readings)`, real.read > 10000 && real.bad_count === 0,
  JSON.stringify(real.bad));

// ── 2. exact floors, read at 2026-11-11 09:30 UTC (the +1 hour is the read-to-write and clock margin) ──────────────
const EXACT: [string, string][] = [
  ['23 يوم', '2026-10-18T08:30:00+00:00'],          // younger than 24 days
  ['مضاف منذ 2 يوم', '2026-11-08T08:30:00+00:00'],
  ['منذ يومين', '2026-11-08T08:30:00+00:00'],
  ['7 شهر', '2026-03-08T08:30:00+00:00'],           // younger than 8 × 31 days
  ['1 سنة', '2024-11-09T08:30:00+00:00'],           // younger than 2 × 366 days
  ['٣ ساعات', '2026-11-11T04:30:00+00:00'],         // Arabic-Indic digits; younger than 4 hours
  ['أمس', '2026-11-09T08:30:00+00:00'],             // the calendar day before: younger than 2 days
  ['اليوم', '2026-11-10T08:30:00+00:00'],           // younger than 1 day
  ['الآن', '2026-11-11T07:30:00+00:00'],            // within the hour
];
const exact = (src?: string) => py('floors', [EXACT.map(([t]) => t)], src) as (string | null)[];
const got = exact();
EXACT.forEach(([text, want], i) => check(`«${text}» → posted no earlier than ${want}`, got[i] === want, `got ${got[i]}`));

// The ceiling («posted no later than»): «N unit» proves only N−1 of the shortest unit, because a site may round
// or count calendar days. With the floor it brackets the day; for «23 يوم» the bracket is two days wide.
const CEIL: [string, string][] = [
  ['23 يوم', '2026-10-20T09:30:00+00:00'],          // at least 22 days old
  ['7 شهر', '2026-05-27T09:30:00+00:00'],           // at least 6 × 28 days
  ['1 سنة', '2026-11-11T09:30:00+00:00'],           // «1 سنة» proves nothing about the latest day by itself
  ['أمس', '2026-11-11T09:30:00+00:00'],
];
const ceil = (src?: string) => py('ceilings', [CEIL.map(([t]) => t)], src) as (string | null)[];
const gotCeil = ceil();
CEIL.forEach(([text, want], i) => check(`«${text}» → posted no later than ${want}`, gotCeil[i] === want, `got ${gotCeil[i]}`));

// ── 3. not a plain count → unknown ──────────────────────────────────────────────────────────────────────────────
const UNKNOWN = ['آخر تحديث منذ 3 أيام', '2026-11-01', '3 يومين', 'منذ فترة', 'قليل', '', '4 سنة تقريبا', '2 أمس'];
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
check('ialqarawi writes the ceiling with the floor (posted_latest_at = now − 22 days)', m.mapped && m.ceiling != null
  && Math.abs(Date.parse(m.ceiling) - (Date.parse(m.before) - 22 * 86400 * 1000)) < 60_000, JSON.stringify(m));
check('ialqarawi never writes the floor into date_added (the card prints that as a real day)', m.mapped && m.date_added == null, JSON.stringify(m));
const blank = mapped(null);
check('ialqarawi with no «مضاف منذ» writes no floor', blank.mapped && blank.floor == null, JSON.stringify(blank));

// ── 4b. only a site PROVEN to print its ad's real age may turn «منذ …» into a floor ─────────────────────────────────
// Discovered by shape: every scraper that calls posted_no_earlier_than(). Enrolled ⇔ calls it; a waived site never does.
const callers = (src?: string) => readdirSync(join(ROOT, 'scrapers'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'common')
  .filter((d) => {
    const dir = join(ROOT, 'scrapers', d.name);
    return readdirSync(dir).filter((f) => f.endsWith('.py')).some((f) =>
      (d.name === 'ialqarawi' && f === 'run.py' && src !== undefined ? src : readFileSync(join(dir, f), 'utf8'))
        .includes('posted_no_earlier_than('));
  }).map((d) => d.name).sort();
const registryOk = (reg: any, who: string[]) => {
  const problems: string[] = [];
  for (const site of who) if (!reg.enrolled.includes(site)) problems.push(`${site} reads «منذ …» but is not proven (AGO_COUNT_IS_REAL_AGE)`);
  for (const site of reg.enrolled) if (!who.includes(site)) problems.push(`${site} is enrolled but its scraper never writes a floor`);
  for (const site of reg.waived) if (reg.enrolled.includes(site)) problems.push(`${site} is both proven and waived`);
  for (const site of reg.enrolled.concat(reg.waived)) if (!existsSync(join(ROOT, 'scrapers', site))) problems.push(`${site} has no scraper`);
  if (!reg.reasons_present) problems.push('an entry has no reason');
  return problems;
};
const reg = py('registry', []);
const who = callers();
const regProblems = registryOk(reg, who);
check(`every scraper that turns «منذ …» into a floor is a PROVEN site (${who.join(', ')})`, regProblems.length === 0, regProblems.join('; '));
check('aqaratikom («منذ» is a refresh time there) is waived and writes no floor', reg.waived.includes('aqaratikom') && !who.includes('aqaratikom'));

// ── 5. planted mistakes are caught ──────────────────────────────────────────────────────────────────────────────
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);
const H = (find: string, repl: string) => mutate(HELPER, find, repl);
mustCatch('a count read as its OWN age («23 يوم» = 23 days, so a 23½-day ad looks newer)',
  sweep(H('timedelta(days=day * (n + 1))', 'timedelta(days=day * n)')).bad_count > 0);
mustCatch('a ceiling that trusts the full count («2 شهر» at 45 days, rounded, is not 56 days old)',
  sweep(H('* max(0, n - 1)', '* n')).bad_count > 0);
mustCatch('a month taken as 30 days (calendar months run longer)', sweep(H('"month": 31,', '"month": 30,')).bad_count > 0);
mustCatch('a year taken as 365 days in the bound', exact(H('"year": 366}', '"year": 365}'))[4] !== EXACT[4][1]);
mustCatch('the read-to-write margin dropped', exact(H('_AGO_MARGIN = timedelta(hours=1)', '_AGO_MARGIN = timedelta(0)'))[0] !== EXACT[0][1]);
mustCatch('a «last updated» phrase read as a posting count',
  unknown(H('(?:مضاف|أضيف|اضيف|منذ|قبل)', '(?:مضاف|أضيف|اضيف|منذ|قبل|آخر|تحديث)'))[0] !== null);
mustCatch('a number in front of a dual accepted («3 يومين»)',
  unknown(H('    if m.group(1) is not None and m.group(2) in _AGO_NO_NUMBER:\n        return None', '    if False:\n        return None'))[2] !== null);
mustCatch('«أمس» read as within one day', exact(H('*[(w, "day", 1) for w in ("أمس", "امس", "البارحة")]', '*[(w, "day", 0) for w in ("أمس", "امس", "البارحة")]'))[6] !== EXACT[6][1]);
const M = (find: string, repl: string) => mutate(MAPPER, find, repl);
const FLOOR_LINE = '        row["posted_earliest_at"] = floor';
mustCatch('the mapper writing the floor into date_added', mapped('23 يوم', M(FLOOR_LINE, '        row["date_added"] = floor')).date_added != null);
mustCatch('the mapper dropping the floor', mapped('23 يوم', M(FLOOR_LINE, '        pass')).floor == null);

mustCatch('ialqarawi dropped from the proven list', registryOk(py('registry', [], H('    "ialqarawi": "2026-11-11:', '    "ialqarawi_x": "2026-11-11:')), who).length > 0);
mustCatch('a waived site enrolled as well', registryOk(py('registry', [], H('AGO_COUNT_IS_REAL_AGE = {\n', 'AGO_COUNT_IS_REAL_AGE = {\n    "aqaratikom": "planted: a refresh time read as a posting age",\n')), who).length > 0);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\n«منذ …» becomes a floor that never makes an ad look newer: OK');
