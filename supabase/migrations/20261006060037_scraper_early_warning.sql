-- ⚡ Scraping Engineer, 2026-10-06 — EARLY-WARNING ROBOT (owner backlog 64, no AI).
-- After the nightly small-sources crawl, a site whose latest finished run failed, saved 0 rows, or
-- saved under half its 7-day average is (1) written into ops_engineer_backlog with its numbers and
-- (2) re-crawled ONCE through small-sources-sync's targeted lane (its own concurrency group since
-- PR #6208, so it does not queue behind dwelleo's ~4 h job). The backlog row is also the once-a-day
-- guard: a site already flagged today is never re-dispatched. A site whose run is still in progress
-- is never touched (a list naming a running site would crawl it twice at once).
-- p_dry => true returns what it WOULD do and writes / dispatches nothing.

create or replace function public.scraper_early_warning(p_dry boolean default false)
returns table(platform text, reason text, rows_upserted int, avg7 numeric, dispatched boolean)
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
#variable_conflict use_column
declare
  tok text;
  picked text[];
  found jsonb;
begin
  with latest as (
    select distinct on (r.platform) r.platform, r.ok, r.rows_upserted, r.finished_at, r.started_at,
           left(coalesce(r.notes, ''), 160) as notes
    from scrape_runs r
    where r.started_at > now() - interval '20 hours'
    order by r.platform, r.started_at desc
  ), avg7 as (
    select r.platform, avg(r.rows_upserted)::numeric as a
    from scrape_runs r
    where r.ok and r.started_at between now() - interval '8 days' and now() - interval '20 hours'
    group by r.platform
  )
  , hits as (
  select l.platform,
         case when l.ok is false then 'failed: ' || l.notes
              when coalesce(l.rows_upserted, 0) = 0 then 'saved 0 rows'
              else 'saved under half its 7-day average' end as reason,
         coalesce(l.rows_upserted, 0) as rows_upserted,
         round(a.a, 1) as avg7
  from latest l
  join platform_registry g on g.platform = l.platform and g.kind = 'source' and g.status = 'active'
  left join avg7 a on a.platform = l.platform
  where l.finished_at is not null
    and l.platform !~ '^(aqar|wasalt|gathern|dealapp|muktamel)'          -- not small-sources-sync sites
    and (l.ok is false
         or (coalesce(l.rows_upserted, 0) = 0 and coalesce(a.a, 0) >= 1)   -- a source empty all week (manzo) is its own truth
         or (a.a >= 10 and l.rows_upserted < 0.5 * a.a))
    and not exists (select 1 from ops_engineer_backlog b
                    where b.engineer = 'scraping-engineer'
                      and b.item like 'early-warning ' || l.platform || ' ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || '%'))
  select coalesce(jsonb_agg(to_jsonb(h) order by h.platform), '[]'::jsonb) into found from hits h;

  select array_agg(e.platform order by e.platform) into picked
  from jsonb_to_recordset(found) as e(platform text, reason text, rows_upserted int, avg7 numeric);

  if not p_dry and picked is not null then
    insert into ops_engineer_backlog (engineer, item, status, evidence)
    select 'scraping-engineer',
           'early-warning ' || e.platform || ' ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')
             || ': ' || e.reason || ' — re-crawled once automatically; still bad = yours to fix',
           'open',
           'rows_upserted=' || e.rows_upserted || ' avg7=' || coalesce(e.avg7::text, 'n/a')
             || ' | scraper_early_warning() ' || to_char(now() at time zone 'utc', 'HH24:MI') || ' UTC'
    from jsonb_to_recordset(found) as e(platform text, reason text, rows_upserted int, avg7 numeric);

    select decrypted_secret into tok from vault.decrypted_secrets
      where name = any(array['github', 'github_pat']) limit 1;
    if tok is null or btrim(tok) = '' then
      raise exception 'scraper_early_warning: no usable GitHub PAT in vault — nothing written, nothing dispatched (the cron run fails loudly)'
        using errcode = '28000';
    end if;
    perform net.http_post(
      url := 'https://api.github.com/repos/6ttvrw4fmf-ctrl/ezhalah/actions/workflows/small-sources-sync.yml/dispatches',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || tok,
        'Accept', 'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent', 'ezhalah-supabase-cron',
        'Content-Type', 'application/json'),
      body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('source', array_to_string(picked, ',')))
    );
  end if;

  return query select e.platform, e.reason, e.rows_upserted, e.avg7, (not p_dry)
               from jsonb_to_recordset(found) as e(platform text, reason text, rows_upserted int, avg7 numeric)
               order by e.platform;
end;
$function$;

revoke all on function public.scraper_early_warning(boolean) from public, anon, authenticated;

-- 04:55 UTC: after most of the 04:22 nightly has finished, before the engineers' night window.
select cron.schedule('scraper-early-warning', '55 4 * * *', $$select public.scraper_early_warning()$$);

do $check$
declare n int;
begin
  perform * from public.scraper_early_warning(true);   -- dry run must execute cleanly
  select count(*) into n from cron.job where jobname = 'scraper-early-warning' and schedule = '55 4 * * *';
  if n <> 1 then raise exception 'scraper-early-warning cron not scheduled exactly once (%)', n; end if;
end
$check$;