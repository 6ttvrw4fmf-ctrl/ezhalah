-- scraper_early_warning(): a crawl that dies BEFORE it registers is no longer silence read as health.
--
-- The robot reads scrape_runs only. A job that fails before db.begin_run() (DNS, a connect timeout on
-- the first request) writes no row, so the site was simply absent from `latest` and looked fine:
-- nafithh failed two nights running on «Could not resolve host: nafithh.sa» (10-06, 10-07), squares
-- on a connect timeout (10-07), ryadah (10-06) — none was flagged or re-crawled. Absence cannot be
-- compared, so it is now looked for: an active small-sources site that ran on at least 5 of the 7
-- days before the last 20 h (a NIGHTLY site by its own behaviour — every-N-days sites such as souq24
-- never qualify) and has NO scrape_runs row in the last 20 h is flagged and re-crawled like a failure.
-- Needle edit of the live body (same signature, no DROP); the check block proves it landed.
do $mig$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.scraper_early_warning(boolean)'::regprocedure);
  v_old := $o$                      and b.item like 'early-warning ' || l.platform || ' ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || '%'))
  select coalesce(jsonb_agg(to_jsonb(h) order by h.platform), '[]'::jsonb) into found from hits h;$o$;
  v_new := $n$                      and b.item like 'early-warning ' || l.platform || ' ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || '%')
  union all
  -- ABSENT: a nightly site with no row at all since yesterday's crawl (died before begin_run).
  select g.platform,
         'no run recorded in 20 h — the job died before it registered (DNS / connect error before begin_run?)',
         0, round(a.a, 1)
  from platform_registry g
  left join avg7 a on a.platform = g.platform
  where g.kind = 'source' and g.status = 'active'
    and g.platform !~ '^(aqar|wasalt|gathern|dealapp|muktamel)'
    and not exists (select 1 from scrape_runs r where r.platform = g.platform and r.started_at > now() - interval '20 hours')
    and (select count(distinct (r.started_at at time zone 'utc')::date) from scrape_runs r
         where r.platform = g.platform and r.started_at between now() - interval '8 days' and now() - interval '20 hours') >= 5
    and not exists (select 1 from ops_engineer_backlog b
                    where b.engineer = 'scraping-engineer'
                      and b.item like 'early-warning ' || g.platform || ' ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || '%'))
  select coalesce(jsonb_agg(to_jsonb(h) order by h.platform), '[]'::jsonb) into found from hits h;$n$;
  if position(v_old in v_def) = 0 then
    raise exception 'scraper_early_warning: the expected hits/aggregate shape was not found — refusing to edit blindly';
  end if;
  execute replace(v_def, v_old, v_new);
end $mig$;

do $chk$
begin
  if position('no run recorded in 20 h' in pg_get_functiondef('public.scraper_early_warning(boolean)'::regprocedure)) = 0 then
    raise exception 'scraper_early_warning: ABSENT branch missing after edit';
  end if;
end $chk$;
