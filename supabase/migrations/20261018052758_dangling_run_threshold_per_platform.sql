-- Dangling-run threshold per platform, measured from its own history (backlog 645/584, 2026-10-18).
--
-- mon_detect_dangling_scrape_run raised at a flat 3 h (dwelleo 6 h), so every job that legitimately
-- runs longer raised a P1 during each healthy run and the remediation loop escalated it to a P0
-- remediation_exhausted: fleet_liveness:muhaysini (ok runs of 5 h 22 min; P1 10-15 and 10-17, P0 9786
-- on 10-17) and wasalt_enum_shard (ok shards of 5 h 00 min; P1 9833 and 9836 on 10-18). The pending
-- "close the row at 3 h" patch would have marked those LIVE runs orphaned instead.
--
-- The threshold is now the platform's own longest ok run in the last 21 days × 1.25, never below 3 h
-- (dwelleo keeps its 6 h floor) and never above 6 h 30 min: a GitHub-hosted job is killed at 6 h, so a
-- row still open past that is dead whatever its history. enum-rollup rows are excluded (written at the
-- end with the first shard's start time, never open). A platform with no ok run keeps 3 h.
-- verify_dangling_scrape_run (the remediation loop's check) reads the same helper, so the detector and
-- its verifier can no longer disagree. Everything else in both bodies is unchanged.
create or replace function public.scrape_run_dangling_after(p_platform text)
 returns interval
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select least(interval '6 hours 30 minutes', greatest(
           interval '3 hours',
           case when p_platform = 'dwelleo' then interval '6 hours' else interval '0' end,
           coalesce((select max(s.finished_at - s.started_at) * 1.25
                     from public.scrape_runs s
                     where s.platform = p_platform
                       and s.ok
                       and s.finished_at is not null
                       and s.started_at > now() - interval '21 days'
                       and coalesce(s.notes, '') not like 'enum-rollup%'), interval '0')));
$function$;

create or replace function public.mon_detect_dangling_scrape_run()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; n int := 0;
begin
  for rec in
    select s.platform,
           count(*)                                   as dangling_runs,
           min(s.started_at)                          as oldest,
           max(s.started_at)                          as newest,
           (array_agg(s.id order by s.started_at desc))[1:5] as sample_run_ids
    from public.scrape_runs s
    where s.ok is null
      and s.finished_at is null
      and s.started_at between now() - interval '48 hours' and now() - interval '3 hours'
      -- each platform's own threshold (its longest ok run × 1.25, 3 h floor, 6 h 30 min cap)
      and s.started_at <= now() - public.scrape_run_dangling_after(s.platform)
    group by s.platform
  loop
    n := n + public.mon_raise('P1','dangling_scrape_run', rec.platform,
      'dangling_scrape_run:'||rec.platform||':'||to_char(rec.newest,'YYYY-MM-DD'),
      jsonb_build_object(
        'platform', rec.platform,
        'dangling_runs', rec.dangling_runs,
        'oldest', rec.oldest,
        'newest', rec.newest,
        'sample_run_ids', rec.sample_run_ids,
        'why','scrape_runs row started but never finalized (ok and finished_at both still null) — the job was killed before end_run(), most often the GitHub Actions timeout-minutes budget. Rows it upserted are kept, but prune/sold-pin never ran and the platform''s last-OK freshness signal did not advance. Fix the run budget or the per-run cap; never hand-edit the row.'));
  end loop;

  -- self-heal: resolve once the platform has no dangling run left in the window (the run
  -- finalized late, or it aged past 48h)
  update public.alert_event a set resolved_at = now()
  where a.kind = 'dangling_scrape_run'
    and a.resolved_at is null
    and not exists (
      select 1 from public.scrape_runs s
      where s.platform = a.platform
        and s.ok is null
        and s.finished_at is null
        and s.started_at between now() - interval '48 hours' and now() - interval '3 hours'
        and s.started_at <= now() - public.scrape_run_dangling_after(s.platform));

  return n;
end $function$;

create or replace function public.verify_dangling_scrape_run(p_dedup text, p_platform text)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  select not exists (
    select 1 from public.scrape_runs s
    where s.platform = p_platform
      and s.ok is null and s.finished_at is null
      and s.started_at between now() - interval '48 hours' and now() - interval '3 hours'
      and s.started_at <= now() - public.scrape_run_dangling_after(s.platform));
$function$;

do $check$
begin
  if public.scrape_run_dangling_after('fleet_liveness:muhaysini') < interval '5 hours 22 minutes' then
    raise exception 'muhaysini liveness threshold % is shorter than its measured ok run', public.scrape_run_dangling_after('fleet_liveness:muhaysini');
  end if;
  if public.scrape_run_dangling_after('wasalt_enum_shard') < interval '5 hours 1 minute' then
    raise exception 'wasalt_enum_shard threshold % is shorter than its measured ok shard', public.scrape_run_dangling_after('wasalt_enum_shard');
  end if;
  if public.scrape_run_dangling_after('dwelleo') < interval '6 hours' then
    raise exception 'dwelleo lost its 6 h floor';
  end if;
  if public.scrape_run_dangling_after('__no_such_platform__') <> interval '3 hours' then
    raise exception 'a platform with no ok run must keep the 3 h threshold';
  end if;
  if public.scrape_run_dangling_after('wasalt') > interval '6 hours 30 minutes' then
    raise exception 'threshold above the 6 h 30 min cap';
  end if;
end $check$;