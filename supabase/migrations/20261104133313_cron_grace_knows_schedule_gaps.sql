-- 2026-11-04 (🔧): the cron grace is floored at the schedule's own largest gap. mon_cron_expected_gap() learned
-- the cadence as 2 × the MEDIAN observed gap; a job scheduled «50 0,4,18,20 * * *» (jobid 202 pin-city-correction)
-- has gaps 4 h / 14 h / 2 h / 4 h, so the learned grace was 8 h and cron_overdue:202 paged every afternoon between
-- 12:50 and 18:50 UTC on a job that was exactly on time (alert 13051 at 12:59 — the city_pin_check_silent shape of
-- 2026-11-03, lesson ③: a detector must know the cadence of the job it watches). NOT A WEAKENING: a grace can only
-- move UP, and only for the shape «M h1,h2,… * * *» whose largest gap is read from the schedule itself.
create or replace function public.mon_cron_schedule_max_gap(p_schedule text)
 returns interval
 language plpgsql
 immutable
as $function$
declare f text[]; hrs int[]; n int; i int; mx int := 0;
begin
  f := regexp_split_to_array(btrim(coalesce(p_schedule, '')), '\s+');
  if coalesce(array_length(f, 1), 0) <> 5 then return null; end if;
  -- only «M h1,h2,… * * *» is read; any other shape (*/N, minute lists, day fields) keeps the learned cadence
  if f[3] <> '*' or f[4] <> '*' or f[5] <> '*' then return null; end if;
  if f[1] !~ '^[0-9]{1,2}$' or f[2] !~ '^[0-9]{1,2}(,[0-9]{1,2})*$' then return null; end if;
  select array_agg(h order by h) into hrs
    from (select distinct x::int as h from unnest(string_to_array(f[2], ',')) x) d;
  n := array_length(hrs, 1);
  if n < 2 then return interval '24 hours'; end if;
  for i in 1 .. n - 1 loop mx := greatest(mx, hrs[i + 1] - hrs[i]); end loop;
  mx := greatest(mx, 24 - hrs[n] + hrs[1]);   -- the gap that wraps past midnight
  return make_interval(hours => mx);
end $function$;

create or replace function public.mon_cron_expected_gap(p_jobid bigint, p_fallback_h integer)
 returns interval
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with g as (
    select extract(epoch from (d.start_time
             - lag(d.start_time) over (order by d.start_time)))::numeric as gap_s
      from cron.job_run_details d
     where d.jobid = p_jobid
       and d.status = 'succeeded'
       and d.start_time > greatest(
             now() - interval '7 days',
             coalesce((select s.schedule_changed_at
                         from public.ops_cron_job_first_seen s
                        where s.jobid = p_jobid), '-infinity'::timestamptz))
  ),
  learned as (select public.mon_cron_gap_from_series(array_agg(g.gap_s), p_fallback_h) as iv from g)
  -- 2026-11-04: never below the schedule's own largest gap plus an hour of margin (grace = cadence has no margin)
  select greatest(l.iv,
                  coalesce((select public.mon_cron_schedule_max_gap(j.schedule) from cron.job j where j.jobid = p_jobid)
                           + interval '1 hour', l.iv))
    from learned l;
$function$;

-- Both directions, on real jobs and fixed strings.
do $mig$
begin
  if public.mon_cron_schedule_max_gap('50 0,4,18,20 * * *') <> interval '14 hours' then raise exception 'hour-list gap misread'; end if;
  if public.mon_cron_schedule_max_gap('0 3 * * *') <> interval '24 hours' then raise exception 'daily job misread'; end if;
  if public.mon_cron_schedule_max_gap('*/15 * * * *') is not null then raise exception '*/15 must stay learned'; end if;
  if public.mon_cron_schedule_max_gap('29,59 * * * *') is not null then raise exception 'minute list must stay learned'; end if;
  if public.mon_cron_schedule_max_gap('0 21 */2 * *') is not null then raise exception 'day-of-month shape must stay learned'; end if;
  if public.mon_cron_expected_gap(202, 24) < interval '15 hours' then
    raise exception 'jobid 202 grace still below its 14 h schedule gap: %', public.mon_cron_expected_gap(202, 24);
  end if;
end $mig$;