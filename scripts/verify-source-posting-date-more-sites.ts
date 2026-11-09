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

// ── 1. THE READER'S FOUR SHAPES, lifted from the migration that defines public.source_posted_at ──
const sql = readFileSync(SQL_SRC, 'utf8');
const fnBody = windowBetween(sql, 'create or replace function public.source_posted_at', 'comment on function public.source_posted_at', 'migration 20261026122758');
const SQL_SHAPES = [...fnBody.matchAll(/if r ~ '([^']+)' then/g)].map((m) => new RegExp(m[1]));
check('lifted the four shapes public.source_posted_at reads', SQL_SHAPES.length === 4, `found ${SQL_SHAPES.length}`);
const sqlReads = (s: string) => SQL_SHAPES.some((re) => re.test(s.trim()));

// ── 2. THE REGISTRY ───────────────────────────────────────────────────────────────────────────
type Case = [unknown[], string | null, string];
type Mutation = [string, string, string, string, unknown[]];
type Site = { site: string; module: string; cases: Case[]; mutations: Mutation[] };
type Mapped = { mapped: boolean; date_added: string | null; why: string };

const sites = (pyCall(ROOT, FIX, 'platforms', [[]]) as Site[][])[0];
check('the fixture registry lists sites', sites.length > 0, 'no site registered');
check('wasalt is registered (92,079 active rows, the largest site that was undated)', sites.some((s) => s.site === 'wasalt'));

// ── 3. EVERY SITE'S REAL MAPPER ───────────────────────────────────────────────────────────────
const firstPositive: Record<string, Case> = {};
for (const s of sites) {
  const pos = s.cases.filter(([, want]) => typeof want === 'string');
  const neg = s.cases.filter(([, want]) => want === null);
  check(`${s.site}: has a live-page case and a no-date case`, pos.length > 0 && neg.length > 0,
    `${pos.length} dated, ${neg.length} undated`);
  if (pos.length) firstPositive[s.site] = pos[0];

  let out: Mapped[];
  try { out = pyCall(ROOT, FIX, 'mapped', s.cases.map(([a]) => [s.site, a, null])) as Mapped[]; }
  catch (e) { check(`${s.site}: mapper ran`, false, (e as Error).message.split('\n').slice(-3).join(' | ')); continue; }
  s.cases.forEach(([args, want, why], i) => {
    check(`${s.site}: the ad maps (${why})`, out[i].mapped === true, `skipped: ${out[i].why}`);
    check(`${s.site}: date_added = ${show(want)} — ${why}`, out[i].date_added === want, `got ${show(out[i].date_added)} for ${show(args)}`);
    if (out[i].date_added !== null) check(`${s.site}:   …in a shape the SQL reader counts`, sqlReads(out[i].date_added as string));
  });
}

// ── 4. MUTATION PROOFS ────────────────────────────────────────────────────────────────────────
// 4a. The shared reader switched off everywhere: a dated case must lose its date.
for (const s of sites) {
  const pos = firstPositive[s.site];
  if (!pos) continue;
  let got: Mapped;
  try { got = (pyCall(ROOT, FIX, 'mapped_without_helper', [[s.site, pos[0]]]) as Mapped[])[0]; }
  catch (e) { check(`MUTATION ${s.site}/helper-off: python threw — ${(e as Error).message.split('\n').slice(-2).join(' | ')}`, false); continue; }
  check(`MUTATION: catches ${s.site} writing its date without site_posting_date()`, got.date_added === null,
    `with the reader switched off the mapper still wrote ${show(got.date_added)}`);
}

// 4b. Each site's declared wrong reading. The mutant must answer differently from the real mapper.
// An anchor that no longer matches is LOUD: a mutant that was never applied proves nothing.
for (const s of sites) {
  const modFile = s.module.replace(/\./g, '/') + '.py';
  for (const [label, file, find, replace, args] of s.mutations) {
    if (file !== modFile) { check(`MUTATION ${label}: must edit the site's own module ${modFile}, not ${file}`, false); continue; }
    const real = readFileSync(join(ROOT, file), 'utf8');
    const mutated = real.replace(find, replace);
    if (mutated === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); continue; }
    try {
      const [want, got] = pyCall(ROOT, FIX, 'mapped', [[s.site, args, null], [s.site, args, mutated]]) as Mapped[];
      check(`MUTATION: catches ${label}`, got.date_added !== want.date_added, `mutant still answered ${show(got.date_added)}`);
    } catch (e) { check(`MUTATION ${label}: python threw — ${(e as Error).message.split('\n').slice(-2).join(' | ')}`, false); }
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

// ── 6. THIS FILE RUNS IN `npm test` — asked of the registry, never by string-matching package.json ──
check('npm test runs this check', npmTestRuns(ROOT, 'verify-source-posting-date-more-sites'));

console.log(failed === 0
  ? `\n✅ source-posting-date (more sites): ${sites.length} site(s) write the site's own posting date to date_added, in a shape the welcome facts can count.\n`
  : `\n❌ source-posting-date (more sites): ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
