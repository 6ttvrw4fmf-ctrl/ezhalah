// THE SITE'S OWN POSTING DATE REACHES `date_added` — on every platform that publishes one.
//
// Owner rule (2026-10-26, docs/ARCHITECTURE.md §20): every time-window welcome fact («posted
// yesterday», «this week») counts an ad by the day the SITE says it was posted, read from the source
// table's `date_added` through public.source_posted_at(text). An ad with no readable date counts in
// no window.
//
// What was wrong, measured read-only on production 2026-11-09: eight platforms publish that date and
// we were throwing it away at the last step.
//   · dealapp (74,751 rows), arkaan (2,493), mustqr (1,743), therc (457), tawia (10), eydah (2): the
//     mapper read the date, filed it under additional_info / source_capture, and never wrote
//     `date_added` — NULL on 100%.
//   · sakan (3,340): the date sits on the OUTER JSON-LD listing block; the parser only opened `about`.
//   · aqarcity (948 rows first seen since the site's redesign): the page renamed `datePublished` to
//     `datePosted`; the mapper kept asking for the old key and got nothing, silently.
// The last one is the shape worth a barrier: nothing failed, nothing logged, a column just stopped
// filling. So this file EXECUTES each platform's real mapper over an input carrying the site's date
// and reads `date_added` off the row it returns — it does not grep for a line.
//
// It also pins the three ways a "fix" here goes wrong:
//   1. a value public.source_posted_at cannot read is stored but never counted — the four shapes are
//      lifted from the migration that defines that function and every stored value is held to them;
//   2. a UTC stamp shows the wrong DAY on the card, which reads the string textually — a zoned stamp
//      is stored as the same instant in Saudi time;
//   3. a bump / edit / sitemap date read as a posting date makes old ads look new — each mapper is
//      given a readable «updated» date and no posting date, and must answer NULL.
//
// Hermetic: stored pages and synthetic records only, the location catalog stubbed. No network.
//
// Run: node --experimental-strip-types scripts/verify-source-posting-date-is-written.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const FIX = 'scripts.lib.posting_date_fixture';
const HELPER_MOD = 'scrapers.common.posting_date';
const HELPER_SRC = join(ROOT, 'scrapers/common/posting_date.py');
const SQL_SRC = join(ROOT, 'supabase/migrations/20261026122758_welcome_facts_windows_count_by_source_posting_date.sql');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const show = (v: unknown) => JSON.stringify(v);

// ── 1. THE READER'S FOUR SHAPES, lifted from the migration that defines public.source_posted_at ──
// Lifted, not retyped: if that function ever learns a fifth shape or loses one, this file follows it.
const sql = readFileSync(SQL_SRC, 'utf8');
const fnBody = windowBetween(sql, 'create or replace function public.source_posted_at', 'comment on function public.source_posted_at', 'migration 20261026122758');
const SQL_SHAPES = [...fnBody.matchAll(/if r ~ '([^']+)' then/g)].map((m) => new RegExp(m[1]));
check('lifted the four shapes public.source_posted_at reads', SQL_SHAPES.length === 4, `found ${SQL_SHAPES.length}`);
const sqlReads = (s: string) => SQL_SHAPES.some((re) => re.test(s.trim()));

// ── 2. THE SHARED HELPER ───────────────────────────────────────────────────────────────────────
// [what the site published, what `date_added` must hold]
const HELPER_CASES: [unknown, string | null, string][] = [
  ['2023-05-03T12:05:45.503Z', '2023-05-03T15:05:45+03:00', 'dealapp: UTC «Z» → the same instant in Saudi time'],
  ['2026-11-08T22:30:00.000Z', '2026-11-09T01:30:00+03:00', 'posted 01:30 Saudi time → the Saudi DAY, not the UTC day before'],
  ['2026-02-23T22:28:45.651044+00:00', '2026-02-24T01:28:45+03:00', 'mustqr: «+00:00» → Saudi time'],
  ['2026-06-10T14:58:40+03:00', '2026-06-10T14:58:40+03:00', 'therc: already Saudi time → unchanged'],
  ['2026-06-10T14:58:40+0300', '2026-06-10T14:58:40+03:00', 'offset without a colon'],
  ['2026-06-10T07:58:40-04:00', '2026-06-10T14:58:40+03:00', 'a western offset'],
  ['2026-11-07', '2026-11-07', 'arkaan / sakan: a bare day → kept as published'],
  [' 2026-11-07\n', '2026-11-07', 'surrounding whitespace is not part of the date'],
  ['2026-11-07T09:15', '2026-11-07T09:15', 'no zone = already Saudi-local to the reader → kept'],
  ['2026-11-07 09:15:30', '2026-11-07 09:15:30', 'no zone, space separator → kept'],
  ['24/09/2026', '24/09/2026', 'aqarcity cell: DD/MM/YYYY → kept'],
  ['5/1/2026', '5/1/2026', 'single-digit day and month'],
  // UNKNOWN STAYS NULL — none of these is a date the reader can count by.
  ['', null, 'empty'],
  ['منذ 3 أيام', null, 'relative text alone is not a date'],
  ['٣٠ نوفمبر ٢٠٢٥', null, 'month name (aqarcity older layout)'],
  ['٠٤/٠٥/٢٠٢٦', null, 'Arabic-Indic digits: the SQL cast refuses them'],
  ['Nov 7, 2026', null, 'English month name'],
  ['1762500000', null, 'an epoch number as text'],
  [1762500000, null, 'a number'],
  [null, null, 'null'],
  ['31/02/2026', null, 'impossible date'],
  ['2026-02-30', null, 'impossible date'],
  ['09/24/2026', null, 'month-first: day-first reading has no month 24'],
  ['2026-13-01T00:00:00Z', null, 'month 13'],
  ['2026-11-07T25:00:00Z', null, 'hour 25'],
  ['2026-11-07T09:15:30Z posted', null, 'a date with words after it'],
];
// Shapes the reader's pattern accepts but its cast rejects (it answers NULL through its exception arm).
const IMPOSSIBLE = new Set(['31/02/2026', '2026-02-30', '09/24/2026', '2026-13-01T00:00:00Z', '2026-11-07T25:00:00Z']);

const helperOut = pyCall(ROOT, HELPER_MOD, 'site_posting_date', HELPER_CASES.map(([raw]) => [raw])) as (string | null)[];
HELPER_CASES.forEach(([raw, want, why], i) => {
  check(`helper: ${why}`, helperOut[i] === want, `${show(raw)} → ${show(helperOut[i])}, expected ${show(want)}`);
  if (typeof want === 'string') {
    check(`  …and the SQL reader can read what is stored (${want})`, sqlReads(want) && sqlReads(String(raw)));
  } else if (typeof raw === 'string' && sqlReads(raw)) {
    // We say NULL where the reader's PATTERN says yes: allowed only for a date that does not exist.
    check(`  …NULL on a reader-shaped value is an impossible date (${raw})`, IMPOSSIBLE.has(raw));
  }
});

// ── 3. EVERY PLATFORM'S REAL MAPPER ────────────────────────────────────────────────────────────
type Mapped = { mapped: boolean; date_added: string | null; why: string };
const run = (platform: string, args: unknown[], mutated?: string): Mapped =>
  (pyCall(ROOT, FIX, 'mapped', [[platform, args, mutated ?? null]]) as Mapped[])[0];
const runMany = (platform: string, argsList: unknown[][]): Mapped[] =>
  pyCall(ROOT, FIX, 'mapped', argsList.map((a) => [platform, a, null])) as Mapped[];

// platform → [builder args, expected date_added, what the case proves]
const PLATFORM_CASES: Record<string, [unknown[], string | null, string][]> = {
  dealapp: [
    [['2023-05-03T12:05:45.503Z'], '2023-05-03T15:05:45+03:00', 'schema datePosted (real page 573551)'],
    [['2026-11-08T22:30:00.000Z'], '2026-11-09T01:30:00+03:00', 'a late-evening UTC post lands on the Saudi day'],
    [[null], null, 'no datePosted → NULL, the ad still maps'],
  ],
  arkaan: [
    [['2026-11-07'], '2026-11-07', 'JSON-LD datePosted'],
    [[null, '2026-11-09'], null, 'only the card\'s «last updated» is readable → NULL (a refresh is not a posting)'],
  ],
  therc: [
    [['2026-06-10T14:58:40+03:00'], '2026-06-10T14:58:40+03:00', 'JSON-LD datePosted'],
    [[null, '2026-11-01T00:00:00+03:00'], null, 'only the sitemap lastmod is readable → NULL'],
  ],
  mustqr: [
    [['2026-02-23T22:28:45.651044+00:00'], '2026-02-24T01:28:45+03:00', 'API created_at'],
    [[null, '2026-11-07T08:00:00.000000+00:00'], null, 'only updated_at is readable → NULL'],
  ],
  sakan: [
    [[], '2026-11-08', 'the OUTER RealEstateListing.datePosted (real page 100553)'],
    [['٠٤ مايو ٢٠٢٦'], null, 'the page\'s month-name form is not a readable date → NULL'],
    [[null, false], null, 'no datePosted → NULL, the ad still maps'],
  ],
  aqarcity: [
    [['published'], '2026-07-15T17:05:16+03:00', 'the stored real page 30260: the old key, datePublished'],
    [['posted'], '2026-07-15T17:05:16+03:00', 'the redesigned page: datePosted in UTC — the SAME stored value'],
    [['cell'], '05/10/2025', 'block silent → the page\'s own «تاريخ النشر» cell'],
    [['month-name'], null, 'block silent, cell prints «٣٠ نوفمبر ٢٠٢٥» → NULL'],
    [['silent'], null, 'only dateModified is readable → NULL (an edit is not a posting)'],
  ],
  eydah: [
    [['2026-08-18'], '2026-08-18', 'JSON-LD datePosted'],
    [[null], null, 'no datePosted → NULL, the ad still maps'],
  ],
  tawia: [
    [['2026-09-20T14:24:18.813696+00:00'], '2026-09-20T17:24:18+03:00', 'JSON-LD datePosted'],
    [[null], null, 'no datePosted → NULL, the ad still maps'],
  ],
};

const realOut: Record<string, Mapped[]> = {};
for (const [platform, cases] of Object.entries(PLATFORM_CASES)) {
  let out: Mapped[];
  try { out = runMany(platform, cases.map(([a]) => a)); }
  catch (e) { check(`${platform}: mapper ran`, false, (e as Error).message.split('\n').slice(-3).join(' | ')); continue; }
  realOut[platform] = out;
  cases.forEach(([args, want, why], i) => {
    check(`${platform}: the ad maps (${why})`, out[i].mapped === true, `skipped: ${out[i].why}`);
    check(`${platform}: date_added = ${show(want)} — ${why}`, out[i].date_added === want, `got ${show(out[i].date_added)} for ${show(args)}`);
    if (out[i].date_added !== null) check(`${platform}:   …in a shape the SQL reader counts`, sqlReads(out[i].date_added as string));
  });
}

// ── 4. MUTATION PROOFS — the REAL mapper module, mutated, over the same input ──────────────────
// An anchor that no longer matches is LOUD and separate from "python threw": a mutant that was never
// applied proves nothing, and must not read as a caught mutation.
const mutant = (label: string, platform: string, srcRel: string, edit: (s: string) => string, args: unknown[]): Mapped | null => {
  const real = readFileSync(join(ROOT, srcRel), 'utf8');
  const mutated = edit(real);
  if (mutated === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); return null; }
  try { return run(platform, args, mutated); }
  catch (e) { check(`MUTATION ${label}: python threw — ${(e as Error).message.split('\n').slice(-2).join(' | ')}`, false); return null; }
};
// `expectReal` is what section 3 already proved the real mapper answers; the mutant must answer differently.
const mustCatch = (label: string, got: Mapped | null, expectReal: string | null) => {
  if (got) check(`MUTATION: catches ${label}`, got.date_added !== expectReal, `mutant still answered ${show(got.date_added)}`);
};

mustCatch('dealapp dropping the date_added write (the defect as it shipped)',
  mutant('dealapp/no-write', 'dealapp', 'scrapers/dealapp/run.py',
    (s) => s.replace('        "date_added": site_posting_date(schema.get("datePosted")),\n', ''),
    ['2023-05-03T12:05:45.503Z']), '2023-05-03T15:05:45+03:00');

mustCatch('arkaan reading the «last updated» note as the posting date',
  mutant('arkaan/bump', 'arkaan', 'scrapers/arkaan/run.py',
    (s) => s.replace('"date_added": site_posting_date(ld.get("datePosted")),', '"date_added": site_posting_date(item.get("last_updated")),'),
    [null, '2026-11-09']), null);

mustCatch('therc reading the sitemap lastmod as the posting date',
  mutant('therc/lastmod', 'therc', 'scrapers/therc/run.py',
    (s) => s.replace('"date_added": site_posting_date(ld.get("datePosted")),', '"date_added": site_posting_date(lastmod),'),
    [null, '2026-11-01T00:00:00+03:00']), null);

mustCatch('mustqr reading updated_at as the posting date',
  mutant('mustqr/updated', 'mustqr', 'scrapers/mustqr/run.py',
    (s) => s.replace('"date_added": site_posting_date(p.get("created_at")),', '"date_added": site_posting_date(p.get("updated_at")),'),
    [null, '2026-11-07T08:00:00.000000+00:00']), null);

mustCatch('mustqr dropping the date_added write',
  mutant('mustqr/no-write', 'mustqr', 'scrapers/mustqr/run.py',
    (s) => s.replace('        "date_added": site_posting_date(p.get("created_at")),\n', ''),
    ['2026-02-23T22:28:45.651044+00:00']), '2026-02-24T01:28:45+03:00');

mustCatch('sakan no longer reading the outer listing block (the defect as it shipped)',
  mutant('sakan/no-capture', 'sakan', 'scrapers/sakan/run.py',
    (s) => s.replace('            out["date_posted"] = d.get("datePosted")\n', ''),
    []), '2026-11-08');

mustCatch('sakan capturing the date but not writing it',
  mutant('sakan/no-write', 'sakan', 'scrapers/sakan/run.py',
    (s) => s.replace('        "date_added": site_posting_date(p.get("date_posted")),\n', ''),
    []), '2026-11-08');

mustCatch('aqarcity asking only for the old key (the defect as it shipped)',
  mutant('aqarcity/old-key', 'aqarcity', 'scrapers/aqarcity/run.py',
    (s) => s.replace('                       or site_posting_date(ld.get("datePosted"))\n', ''),
    ['posted']), '2026-07-15T17:05:16+03:00');

mustCatch('aqarcity reading dateModified as the posting date',
  mutant('aqarcity/modified', 'aqarcity', 'scrapers/aqarcity/run.py',
    (s) => s.replace('or site_posting_date(pi.get("تاريخ النشر")))', 'or site_posting_date(pi.get("تاريخ النشر")) or site_posting_date(ld.get("dateModified")))'),
    ['silent']), null);

mustCatch('eydah dropping the date_added write',
  mutant('eydah/no-write', 'eydah', 'scrapers/eydah/run.py',
    (s) => s.replace('        "date_added": site_posting_date(ld.get("datePosted")),\n', ''),
    ['2026-08-18']), '2026-08-18');

mustCatch('tawia dropping the date_added write',
  mutant('tawia/no-write', 'tawia', 'scrapers/tawia/run.py',
    (s) => s.replace('        "date_added": site_posting_date(ld.get("datePosted")),\n', ''),
    ['2026-09-20T14:24:18.813696+00:00']), '2026-09-20T17:24:18+03:00');

// The helper itself, mutated.
const helperMutant = (label: string, edit: (s: string) => string, raw: string): Mapped | null => {
  const real = readFileSync(HELPER_SRC, 'utf8');
  const mutated = edit(real);
  if (mutated === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); return null; }
  try {
    const got = (pyCall(ROOT, HELPER_MOD, 'site_posting_date', [[raw]], mutated) as (string | null)[])[0];
    return { mapped: true, date_added: got, why: '' };
  } catch (e) { check(`MUTATION ${label}: python threw — ${(e as Error).message.split('\n').slice(-2).join(' | ')}`, false); return null; }
};

mustCatch('the helper storing a UTC stamp as published (the card would show the day before)',
  helperMutant('helper/utc-verbatim',
    (s) => s.replace('return at.strftime("%Y-%m-%dT%H:%M:%S") + "+03:00"', 'return r'),
    '2026-11-08T22:30:00.000Z'), '2026-11-09T01:30:00+03:00');

mustCatch('the helper reading D/M/YYYY month-first (it would accept 09/24/2026, which the SQL reader cannot cast)',
  helperMutant('helper/month-first',
    (s) => s.replace('date(int(m.group(3)), int(m.group(2)), int(m.group(1)))', 'date(int(m.group(3)), int(m.group(1)), int(m.group(2)))'),
    '09/24/2026'), null);

// ── 5. THIS FILE RUNS IN `npm test` — asked of the registry, never by string-matching package.json ──
check('npm test runs this check', npmTestRuns(ROOT, 'verify-source-posting-date-is-written'));

console.log(failed === 0
  ? '\n✅ source-posting-date: every platform that publishes a posting date writes it to date_added, in a shape the welcome facts can count.\n'
  : `\n❌ source-posting-date: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
