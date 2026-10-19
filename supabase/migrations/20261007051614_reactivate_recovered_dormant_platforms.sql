-- A dormant website comes back BY ITSELF the first time its crawl saves listings again.
--
-- Until now nothing flipped dormant -> active: the crawl kept re-probing a dormant site every night
-- (as designed), but its listings stayed hidden until an engineer noticed. 2026-10-04: alhoshan and
-- macsaib crawled ok and stayed hidden until 10-05 (~110 listings, a day). 2026-10-07: dwelleo
-- (~12,300 listings) went dormant on an empty catalogue + 15/15 listing pages 404 — it must return
-- the hour its API serves listings again, not the next engineer night.
--
-- Rule: a kind='source' platform with status 'dormant' whose LATEST finished scrape_runs row (same
-- platform label) started after the registry row's last change, is ok, and saved >= 3 rows is set
-- back to 'active' through set_platform_status (dated note). Runs hourly at :15, before the :22
-- search sync that recomputes production_ready. A failed or empty crawl changes nothing; a crawl
-- that began before the site was made dormant is never read as recovery.
create or replace function public.reactivate_recovered_dormant_platforms()
returns table(platform text, run_started_at timestamptz, rows_upserted integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in
    select pr.platform, s.started_at, s.rows_upserted
    from platform_registry pr
    join lateral (
      select sr.started_at, sr.ok, sr.rows_upserted
      from scrape_runs sr
      where sr.platform = pr.platform and sr.finished_at is not null
      order by sr.started_at desc
      limit 1
    ) s on true
    where pr.kind = 'source' and pr.status = 'dormant'
      and s.started_at > pr.updated_at
      and s.ok is true
      and coalesce(s.rows_upserted, 0) >= 3
  loop
    perform set_platform_status(r.platform, 'active',
      format('auto: crawl %s UTC ok, %s rows saved — the site serves listings again (reactivate_recovered_dormant_platforms)',
             to_char(r.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), r.rows_upserted));
    platform := r.platform; run_started_at := r.started_at; rows_upserted := r.rows_upserted;
    return next;
  end loop;
end;
$function$;

select cron.schedule('reactivate-recovered-dormant-platforms', '15 * * * *',
                     'select public.reactivate_recovered_dormant_platforms()');

-- Rehearsal (rolled back): a dormant site with a fresh ok run of 5 rows comes back; one whose only
-- fresh run failed, one whose ok run predates the dormant flip, and one with 0 rows stay dormant.
do $rehearsal$
declare n int;
begin
  begin
    insert into platform_registry (platform, status, kind, expected_cadence_hours, window_days, updated_at)
    values ('zz_rh_back', 'dormant', 'source', 24, 7, now() - interval '2 hours'),
           ('zz_rh_fail', 'dormant', 'source', 24, 7, now() - interval '2 hours'),
           ('zz_rh_old',  'dormant', 'source', 24, 7, now() - interval '2 hours'),
           ('zz_rh_zero', 'dormant', 'source', 24, 7, now() - interval '2 hours');
    insert into scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted) values
      ('zz_rh_back', now() - interval '1 hour', now(), true, 5, 5),
      ('zz_rh_fail', now() - interval '1 hour', now(), false, 4, 4),
      ('zz_rh_old',  now() - interval '3 hours', now() - interval '150 minutes', true, 9, 9),
      ('zz_rh_zero', now() - interval '1 hour', now(), true, 0, 0);
    select count(*) into n from reactivate_recovered_dormant_platforms() f where f.platform like 'zz_rh_%';
    if n <> 1 or (select status from platform_registry where platform = 'zz_rh_back') <> 'active'
       or exists (select 1 from platform_registry where platform in ('zz_rh_fail','zz_rh_old','zz_rh_zero') and status <> 'dormant') then
      raise exception 'reactivate_recovered_dormant_platforms rehearsal FAILED (n=%)', n;
    end if;
    raise exception 'rehearsal_ok';
  exception when others then
    if sqlerrm <> 'rehearsal_ok' then raise; end if;
  end;
end $rehearsal$;
