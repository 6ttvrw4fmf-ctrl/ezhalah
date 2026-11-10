// THE SITE'S OWN POSTING DATE REACHES `date_added` — the sites fixed after the first eight.
//
// Owner 2026-11-09: «we need it solved» — every listing carries the date its SOURCE website says it was
// posted (docs/ARCHITECTURE.md §20: every time-window welcome fact counts by it, through
// public.source_posted_at(text); an ad with no readable date is in no window).
//
// scripts/verify-source-posting-date-is-written.ts covers the first eight platforms (PR #11531). This file
// covers every site added after them — wasalt first (92,079 active rows, all undated: it publishes
// `publishedAt` on every search-list property and the scraper never read it), then each site the
// 2026-11-09 per-site probe found publishing a date. The sites and their inputs live in
// scripts/lib/posting_date_fixture_more.py (one fixture file per group of sites); this file EXECUTES each
// site's real mapper over them and reads `date_added` off the row it returns. It does not grep for a line.
//
// Per site it proves, by execution:
//   1. the date read from a live ad page lands in `date_added`, in a shape the SQL reader counts;
//   2. «no posting date» → NULL, and the ad still maps (unknown is never a guess, never our crawl time);
//   3. MUTATION — with site_posting_date() switched off in every loaded scraper module, the date is gone:
//      the site's date reaches `date_added` only through the shared reader (Saudi-time conversion, the four
//      shapes), never by a side door;
//   4. MUTATION — each site's declared wrong reading (an edit date, a bump date, a licence date read as the
//      posting date) is caught.
// And that every site registered here is declared publishes = 'yes' in ops_source_posting_date_policy by a
// committed migration, so mon_detect_source_posting_date_fill_regressed() watches its NEW rows in production.
//
// Hermetic: stored pages and synthetic records only, the location catalog stubbed. No network.
//
// Run: node --experimental-strip-types scripts/verify-source-posting-date-more-sites.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const FIX = 'scripts.lib.posting_date_fixture_more';
const SQL_SRC = join(ROOT, 'supabase/migrations/20261026122758_welcome_facts_windows_count_by_source_posting_date.sql');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const show = (v: unknown) => JSON.stringify(v);
// A mutation proof: the barrier's own predicate, applied to a deliberately broken mapper, must say «caught».
const mutation = (label: string, caught: boolean, detail = '') => check(`MUTATION: catches ${label}`, caught, detail);

// ── 1. THE READER'S FOUR SHAPES, lifted from the migration that defines public.source_posted_at ──
const sql = readFileSync(SQL_SRC, 'utf8');
const fnBody = windowBetween(sql, 'create or replace function public.source_posted_at', 'comment on function public.source_posted_at', 'migration 20261026122758');
const SQL_SHAPES = [...fnBody.matchAll(/if r ~ '([^']+)' then/g)].map((m) => new RegExp(m[1]));
check('lifted the four shapes public.source_posted_at reads', SQL_SHAPES.length === 4, `found ${SQL_SHAPES.length}`);
const sqlReads = (s: string) => SQL_SHAPES.some((re) => re.test(s.trim()));

// ── 2. THE REGISTRY — every site's answers, computed in ONE python process ──────────────────────
type Mapped = { mapped: boolean; date_added: string | null; why: string } | { error: string };
type CaseOut = [unknown[], string | null, string, Mapped];
type MutOut = [string, string, boolean, Mapped, Mapped | null];
type Site = { site: string; module: string; cases: CaseOut[]; helper_off: Mapped | null; mutations: MutOut[] };
const err = (m: Mapped | null): string | null => (m && 'error' in m ? m.error : null);
const dateOf = (m: Mapped | null): string | null | undefined => (m && !('error' in m) ? m.date_added : undefined);

const sites = (pyCall(ROOT, FIX, 'run_all', [[]]) as Site[][])[0];
check('the fixture registry lists sites', sites.length > 0, 'no site registered');
// Every group file listed in posting_date_fixture_more.GROUP_MODULES is imported unconditionally, so a deleted or
// misnamed group fails the python call above instead of silently dropping its sites.
check('wasalt is registered (92,079 active rows, the largest site that was undated)', sites.some((s) => s.site === 'wasalt'));

// ── 3. EVERY SITE'S REAL MAPPER ───────────────────────────────────────────────────────────────
for (const s of sites) {
  const pos = s.cases.filter(([, want]) => typeof want === 'string');
  const neg = s.cases.filter(([, want]) => want === null);
  check(`${s.site}: has a live-page case and a no-date case`, pos.length > 0 && neg.length > 0,
    `${pos.length} dated, ${neg.length} undated`);
  for (const [args, want, why, got] of s.cases) {
    if (err(got)) { check(`${s.site}: mapper ran (${why})`, false, err(got)!); continue; }
    const g = got as Exclude<Mapped, { error: string }>;
    check(`${s.site}: the ad maps (${why})`, g.mapped === true, `skipped: ${g.why}`);
    check(`${s.site}: date_added = ${show(want)} — ${why}`, g.date_added === want, `got ${show(g.date_added)} for ${show(args)}`);
    if (g.date_added !== null) check(`${s.site}:   …in a shape the SQL reader counts`, sqlReads(g.date_added));
  }
}

// ── 4. MUTATION PROOFS ────────────────────────────────────────────────────────────────────────
// 4a. The shared reader switched off in every loaded scraper module: a dated case must lose its date.
for (const s of sites) {
  if (!s.helper_off) continue;
  if (err(s.helper_off)) { check(`MUTATION ${s.site}/helper-off: python threw`, false, err(s.helper_off)!); continue; }
  const off = s.helper_off as Exclude<Mapped, { error: string }>;
  // The ad must still map: a skipped ad answers NULL too, and would prove nothing about a side door.
  mutation(`${s.site} writing its date without site_posting_date()`, off.mapped === true && off.date_added === null,
    `mapped=${off.mapped}; with the reader switched off the mapper wrote ${show(off.date_added)}`);
}

// 4b. Each site's declared wrong reading: the mutant must answer differently from the real mapper.
// An anchor that no longer matches is LOUD: a mutant that was never applied proves nothing.
for (const s of sites) {
  const modFile = s.module.replace(/\./g, '/') + '.py';
  for (const [label, file, applied, real, mutant] of s.mutations) {
    if (file !== modFile) { check(`MUTATION ${label}: must edit the site's own module ${modFile}, not ${file}`, false); continue; }
    if (!applied) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); continue; }
    if (err(real) || err(mutant)) { check(`MUTATION ${label}: python threw`, false, (err(real) ?? err(mutant))!); continue; }
    // The mutant must still produce a row: «no row» is not the wrong date it was built to produce.
    const mm = mutant as Exclude<Mapped, { error: string }>;
    mutation(`${label}`, mm.mapped === true && dateOf(mutant) !== dateOf(real),
      `mutant mapped=${mm.mapped}, answered ${show(dateOf(mutant))}`);
  }
}

// ── 4c. A PRINTED «DATE» THAT IS NOT A POSTING DATE STAYS OUT OF date_added ───────────────────────
// nofodh prints «تاريخ النشر» on every page, but it is the platform's import timestamp: 2,542 of 2,556
// active ads share one value (measured 2026-11-10). A shared stamp is not a posting date, and a wrong date
// is worse than none — so the mapper stores NULL, keeps the printed text in the row's capture, and the
// site is 'no' in the policy table. mon_detect_shared_posting_stamp() watches every table for the shape.
type NoDate = { site: string; module: string; mapped?: boolean; date_added?: string | null; why?: string;
  raw_kept?: boolean; error?: string; mutations: [string, string, boolean, Mapped | null][] };
const noDate = (pyCall(ROOT, FIX, 'no_date_report', [[]]) as NoDate[][])[0];
check('nofodh is registered as a site whose printed date is not a posting date', noDate.some((n) => n.site === 'nofodh'));
for (const n of noDate) {
  if (n.error) { check(`${n.site}: mapper ran`, false, n.error); continue; }
  check(`${n.site}: the ad still maps`, n.mapped === true, `skipped: ${n.why}`);
  check(`${n.site}: date_added stays NULL (the printed stamp is not a posting date)`, n.date_added === null, `got ${show(n.date_added)}`);
  check(`${n.site}: the printed text is kept verbatim in the row's capture`, n.raw_kept === true);
  for (const [label, , applied, mutant] of n.mutations) {
    if (!applied) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); continue; }
    if (err(mutant)) { check(`MUTATION ${label}: python threw`, false, err(mutant)!); continue; }
    const mm = mutant as Exclude<Mapped, { error: string }>;
    mutation(`${label}`, mm.mapped === true && mm.date_added !== null, `mutant answered ${show(mm.date_added)}`);
  }
}

// ── 5. EVERY SITE HERE IS WATCHED IN PRODUCTION ─────────────────────────────────────────────────
// A site that writes its date but is not 'yes' in ops_source_posting_date_policy is invisible to
// mon_detect_source_posting_date_fill_regressed(): the day the site renames its field, nothing fires.
const yes = new Set<string>();
for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
  const text = readFileSync(join(MIGRATIONS, f), 'utf8');
  if (!/ops_source_posting_date_policy/.test(text)) continue;
  for (const m of text.matchAll(/\(\s*'([a-z0-9]+)'\s*,\s*'(yes|no|unknown)'/g)) {
    if (m[2] === 'yes') yes.add(m[1]); else yes.delete(m[1]);
  }
}
for (const s of sites) {
  check(`${s.site}: declared publishes = 'yes' in ops_source_posting_date_policy by a committed migration`, yes.has(s.site));
}
for (const n of noDate) {
  check(`${n.site}: NOT declared 'yes' (its printed date is not a posting date)`, !yes.has(n.site));
}

// ── 6. THIS FILE RUNS IN `npm test` — asked of the registry, never by string-matching package.json ──
check('npm test runs this check', npmTestRuns(ROOT, 'verify-source-posting-date-more-sites'));

console.log(failed === 0
  ? `\n✅ source-posting-date (more sites): ${sites.length} site(s) write the site's own posting date to date_added, in a shape the welcome facts can count.\n`
  : `\n❌ source-posting-date (more sites): ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
