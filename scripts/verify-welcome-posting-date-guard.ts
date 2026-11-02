// A POSTING DATE WE CANNOT TRUST NEVER MAKES A FACT (owner 2026-10-27: «make sure we make a strong guard so we never get a
// wrong fact»). Migration 20261028033700 checks every site's posting date on every facts build — never later than the day
// we first saw the ad, not our own scrape time, not in the future — and a site that fails is left out of every dated fact
// by BOTH the builder and its independent recount, with a P1 alarm naming it. This pins that the committed SQL keeps all
// of it: the verdict's thresholds (executed here, both directions, against the SQL's own numbers), both readers skipping
// distrusted tables, the check running inside the build, and the alarm on the detector roster.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /_welcome_posting_date_guard\.sql$/.test(f)).sort().at(-1);
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
check('the posting-date guard migration is committed', !!file);
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

// The verdict, read from the SQL and EXECUTED: the numbers in the file decide, not a copy of them here.
const verdictFrom = (s: string) => {
  const m = s.match(/select coalesce\(p_dated, 0\) >= (\d+)\s+and \(coalesce\(p_after, 0\) \* (\d+) >= p_dated or coalesce\(p_eq, 0\) \* (\d+) >= p_dated or coalesce\(p_future, 0\) \* (\d+) >= p_dated\)/);
  if (!m) return null;
  const [min, a, e, f] = m.slice(1).map(Number);
  return (dated: number, after: number, eq: number, future: number) => dated >= min && (after * a >= dated || eq * e >= dated || future * f >= dated);
};
const honestAndBad = (s: string) => {
  const v = verdictFrom(s);
  if (!v) return false;
  // honest sites measured 2026-10-28 (reinvest 1/219 later than first seen, muktamel 2/1178 near scrape time) stay trusted
  const honest = !v(100, 0, 0, 0) && !v(219, 1, 0, 0) && !v(1178, 0, 2, 0) && !v(9, 9, 9, 9);
  // a refresh date, a scrape-time stamp and future dates are each caught
  const bad = v(100, 5, 0, 0) && v(100, 0, 50, 0) && v(100, 0, 0, 5);
  return honest && bad;
};
check('the verdict keeps honest sites and catches refreshed dates, scrape-time stamps and future dates', honestAndBad(sql));
mustCatch('a verdict that never fires (thresholds raised out of reach)', !honestAndBad(sql.replace('coalesce(p_after, 0) * 20 >= p_dated', 'coalesce(p_after, 0) * 1 >= p_dated')));
mustCatch('a verdict that ignores scrape-time stamps', !honestAndBad(sql.replace('coalesce(p_eq, 0) * 2 >= p_dated', 'coalesce(p_eq, 0) * 0 >= p_dated')));

// the three measured conditions are what the check counts
const counts = (s: string) => s.includes("count(*) filter (where p > scraped_at + interval '1 day')")
  && s.includes('count(*) filter (where abs(extract(epoch from p - scraped_at)) < 900)')
  && s.includes("count(*) filter (where p > now() + interval '1 hour')")
  && s.includes("where scraped_at >= now() - interval '62 days' and date_added is not null");
check('the check counts later-than-first-seen, scrape-time and future dates over the rows the builder reads', counts(sql));
mustCatch('the later-than-first-seen count dropped', !counts(sql.replace("count(*) filter (where p > scraped_at + interval '1 day')", 'count(*) filter (where false)')));

// both readers skip a distrusted table, and the build runs the check first
const readers = (s: string) => s.includes('perform public.welcome_posting_date_check_run(d);')
  && (s.match(/source_table not in \(select c\.source_table from public\.welcome_posting_date_check c where c\.day = d and c\.distrusted\)/g) ?? []).length === 2
  && s.includes("pg_get_functiondef('public.build_welcome_insights'::regproc)") && s.includes("pg_get_functiondef('public.audit_welcome_insights'::regproc)");
check('the builder runs the check, and the builder AND the recount both skip distrusted sites', readers(sql));
mustCatch('the recount still reading a distrusted site (builder and recount disagree)', !readers(sql.replace('and s.source_table not in (select c.source_table from public.welcome_posting_date_check c where c.day = d and c.distrusted) loop', 'loop')));
mustCatch('the build no longer running the check', !readers(sql.replace('perform public.welcome_posting_date_check_run(d);', '')));

// the alarm exists, is P1 per site, notices a build without a check, and is on the roster (a detector off the roster is decoration)
const alarm = (s: string) => /create or replace function public\.mon_detect_welcome_posting_date_untrusted\(\)/.test(s)
  && s.includes("public.mon_raise('P1', 'welcome_posting_date_untrusted', r.source_table")
  && s.includes("'welcome_posting_date_untrusted:not_run'")
  && s.includes("'''mon_detect_welcome_posting_date_untrusted'', ' || anchor");
check('a P1 alarm names a distrusted site, notices a build without a check, and is on the detector roster', alarm(sql));
mustCatch('the alarm left off the roster', !alarm(sql.replace("'''mon_detect_welcome_posting_date_untrusted'', ' || anchor", 'anchor')));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ welcome-posting-date-guard: a date that is not a real posting date never makes a fact');
