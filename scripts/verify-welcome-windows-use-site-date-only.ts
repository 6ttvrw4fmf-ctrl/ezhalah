// EVERY DATED WELCOME FACT COUNTS BY THE SITE'S OWN POSTING DATE, NEVER OURS (owner 2026-11-10: «it must strictly check
// dates and no duplicates, those rules must be in guard … must must must»). Migration 20261110091555 adds
// mon_detect_welcome_windows_use_site_date (P1, on the detector roster), which re-reads the LIVE builder, recount and
// welcome_month on every sweep: the site's posting date replaces our first-seen date for the whole 60-day reach, an ad
// with no readable or a future date is in NO window, and nothing falls back to our own date. Duplicates have their own
// four guards (verify-welcome-facts-all-sites-once, -count-a-licence-once, -same-site-repost-counts-once, -never-duplicated).
//
// EXECUTED: the detector's own patterns are lifted out of the committed SQL and run against the real shape of the live
// builder / recount lines (honest → no problem) and against each way of breaking the rule (→ caught).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /_welcome_windows_use_site_date_guard\.sql$/.test(f)).sort().at(-1);
let fail = 0;
const check = (label: string, ok: boolean) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
check('the migration carrying the site-date guard is committed', !!file);
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
// The detector's body only — the apply-time proof below it reuses the variable names.
const body = (sql.match(/function public\.mon_detect_welcome_windows_use_site_date\(\)[\s\S]*?\$function\$([\s\S]*?)\$function\$/) ?? [])[1] ?? '';
check('the detector body was found', body.length > 0);

// Lift every pattern the detector applies with ~ / !~ / ~* and every position('…') literal, unescaping SQL quotes.
const unq = (s: string) => s.replace(/''/g, "'");
const pat = (op: string, v: string) => [...body.matchAll(new RegExp(`\\b${v} ${op} '((?:[^']|'')*)'`, 'g'))].map((m) => new RegExp(unq(m[1]), op === '~*' ? 'i' : ''));
const pos = (v: string) => [...body.matchAll(new RegExp(`position\\('((?:[^']|'')*)' in ${v}\\) = 0`, 'g'))].map((m) => unq(m[1]));

const B_MUST = pat('!~', 'b'), B_NEVER = pat('~', 'b'), A_NEVER = pat('~', 'a'), M_NEVER = pat('~\\*', 'm');
const B_POS = pos('b'), A_POS = pos('a'), M_POS = pos('m');
const A_COUNT = unq((body.match(/replace\(a, '((?:[^']|'')*)', ''\)/) ?? [])[1] ?? '');
check('lifted the builder patterns (3 musts, 1 fallback)', B_MUST.length === 3 && B_NEVER.length === 1);
check('lifted the recount and window patterns', A_NEVER.length === 1 && M_NEVER.length === 1 && A_POS.length === 2 && M_POS.length === 1 && B_POS.length === 1 && !!A_COUNT);

/** The detector's verdict over three function texts, using ONLY the lifted patterns. */
function problems(b: string, a: string, m: string): string[] {
  const out: string[] = [];
  if (B_MUST.some((r) => !r.test(b)) || B_POS.some((p) => !b.includes(p))) out.push('builder');
  if (B_NEVER.some((r) => r.test(b))) out.push('builder-fallback');
  if (a.split(A_COUNT).length - 1 < 2 || A_POS.some((p) => !a.includes(p))) out.push('recount');
  if (A_NEVER.some((r) => r.test(a))) out.push('recount-fallback');
  if (M_POS.some((p) => !m.includes(p)) || M_NEVER.some((r) => r.test(m))) out.push('window');
  return out;
}

// The live shapes (copied from pg_get_functiondef on 2026-11-10).
const B = `      execute format('insert into w_posted select %L, t.id, public.source_posted_at(t.date_added) from public.%I t where t.scraped_at >= $1', v_tbl, v_tbl)
  update w_b b set first_seen_at = coalesce((select p.posted_at from w_posted p
                                              where p.source_table = b.source_table and p.listing_id = b.listing_id
                                                and p.posted_at <= now() limit 1), '-infinity'::timestamptz)
   where b.first_seen_at >= now() - interval '61 days';`;
const A = `      execute format('insert into a_posted select %L, t.id, public.source_posted_at(t.date_added) from public.%I t where t.scraped_at >= $1', v_tbl, v_tbl)
  coalesce(s.first_seen_at >= f.first_ever + interval '7 days' and (case when s.first_seen_at >= t0 - interval '61 days' then coalesce(ap.posted_at, '-infinity'::timestamptz) else s.first_seen_at end) >= t0 - interval '60 days'
   and (case when s.first_seen_at >= t0 - interval '61 days' then coalesce(ap.posted_at, '-infinity'::timestamptz) else s.first_seen_at end) < t0 - interval '30 days', false) is_m0`;
const M = `percentile_cont(0.5) within group (order by (%5$s)) filter (where first_seen_at >= %6$L::timestamptz - interval '30 days') m1,`;

check('the honest live shapes raise nothing', problems(B, A, M).length === 0);
mustCatch('the builder falling back to our own first-seen date',
  problems(B.replace("'-infinity'::timestamptz)", 'b.first_seen_at)'), A, M).length > 0);
mustCatch('the builder accepting a future site date', problems(B.replace('and p.posted_at <= now() ', ''), A, M).length > 0);
mustCatch('the builder swapping only the last 30 days (ads 31–60 days old keep our date)',
  problems(B.replace("interval '61 days'", "interval '30 days'"), A, M).length > 0);
mustCatch('the builder no longer reading the site date field', problems(B.replace('source_posted_at(t.date_added)', 'now()'), A, M).length > 0);
mustCatch('the recount falling back to our own first-seen date',
  problems(B, A.replaceAll("coalesce(ap.posted_at, '-infinity'::timestamptz)", 'coalesce(ap.posted_at, s.first_seen_at)'), M).length > 0);
mustCatch('the recount keeping only one of its windows strict',
  problems(B, A.replace("coalesce(ap.posted_at, '-infinity'::timestamptz)", 'ap.posted_at'), M).length > 0);
mustCatch('the 30-day window reading our scrape time', problems(B, A, M.replace('first_seen_at >=', 'scraped_at >=')).length > 0);

const alarm = sql.includes("public.mon_raise('P1', 'welcome_windows_use_site_date'")
  && sql.includes("'''mon_detect_welcome_windows_use_site_date'', ' || anchor");
check('it raises a P1 and is on the detector roster (a detector off the roster is decoration)', alarm);

if (fail) { console.error(`\n❌ verify-welcome-windows-use-site-date-only: ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-welcome-windows-use-site-date-only: every dated fact counts by the site\'s posting date, never ours');
