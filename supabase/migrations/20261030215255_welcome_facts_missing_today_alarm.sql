-- Alarm: TODAY (Asia/Riyadh) must have welcome facts (owner 2026-10-30: «make sure we never get it ever again»).
--
-- welcome_insights_pick() serves only rows whose day = today in Riyadh, so a signed-in user sees the plain line whenever
-- today's rows are missing. That happened every night 00:00–00:47 Riyadh for 6 nights (the builder ran «45 */3») and no
-- detector said a word: mon_detect_welcome_insights_stale watches the BUILD's age, not the DAY the pick keys on.
-- This one asks the exact question the pick asks — are there rows for today — once the first build of the day has had
-- its chance (GRACE after Riyadh midnight; the build now starts at 00:02 and takes ~2 min), and also fires when the last
-- cron run of build-welcome-insights failed. Self-heals when rows appear.
create or replace function public.mon_detect_welcome_facts_missing_today(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  grace interval := interval '10 minutes';
  riyadh timestamp := p_now at time zone 'Asia/Riyadh';
  today date := riyadh::date;
  since_midnight interval := riyadh - date_trunc('day', riyadh);
  n_today bigint;
  last_run record;
  v_open boolean;
  r int := 0;
begin
  select count(*) into n_today from public.welcome_insight where day = today;
  select status, start_time, left(return_message, 300) as msg into last_run
    from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'build-welcome-insights')
     and status <> 'running'
   order by start_time desc limit 1;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'welcome_facts_missing_today' and resolved_at is null);

  if n_today > 0 and coalesce(last_run.status, 'succeeded') = 'succeeded' then
    if v_open then perform public.mon_resolve('welcome_facts_missing_today', 'fleet'); end if;
    return 0;
  end if;
  if n_today = 0 and since_midnight < grace then
    return 0; -- the first build of the day is still allowed to be running
  end if;
  if not v_open then
    r := public.mon_raise('P2', 'welcome_facts_missing_today', 'fleet', 'welcome_facts_missing_today',
      jsonb_build_object('riyadh_day', today, 'rows_today', n_today, 'minutes_since_midnight', floor(extract(epoch from since_midnight) / 60),
        'last_build_status', last_run.status, 'last_build_at', last_run.start_time, 'last_build_message', last_run.msg,
        'why', 'welcome_insights_pick() serves only rows for today (Riyadh). With none, every signed-in user sees the plain headline instead of a fact.',
        'action', 'select public.run_welcome_build(); then check cron job build-welcome-insights (schedule 2 */3) and its last job_run_details row.'));
  end if;
  return r;
end
$function$;

revoke all on function public.mon_detect_welcome_facts_missing_today(timestamptz) from public, anon, authenticated;

comment on function public.mon_detect_welcome_facts_missing_today(timestamptz) is
  'P2 when today (Asia/Riyadh) has no welcome_insight rows more than 10 min after midnight, or the last build-welcome-insights cron run failed; self-heals. Owner 2026-10-30.';

-- Roster it (the do $roster$ edit, never a full-function replace), right after the audit detector.
do $roster$
declare d text; anchor text := '''mon_detect_welcome_insights_audit'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_facts_missing_today''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_welcome_facts_missing_today'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_facts_missing_today''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end $roster$;

-- Proof, watched to catch: a clock set to 00:38 Riyadh on a day with no rows must RAISE; now (rows exist) must return 0;
-- 00:05 on an empty day is still grace. Rolled back so no alert row survives the proof.
do $proof$
declare r int; fake timestamptz;
begin
  r := public.mon_detect_welcome_facts_missing_today();
  if r <> 0 then raise exception 'PROOF: today has rows but the detector raised (%)', r; end if;
  fake := ((date '2099-01-01')::timestamp + time '00:38') at time zone 'Asia/Riyadh';
  r := public.mon_detect_welcome_facts_missing_today(fake);
  if r <> 1 then raise exception 'PROOF: a day with no rows at 00:38 Riyadh did not raise (%)', r; end if;
  delete from public.alert_event where dedup_key = 'welcome_facts_missing_today' and resolved_at is null;
  fake := ((date '2099-01-01')::timestamp + time '00:05') at time zone 'Asia/Riyadh';
  r := public.mon_detect_welcome_facts_missing_today(fake);
  if r <> 0 then raise exception 'PROOF: grace period not honoured (%)', r; end if;
  raise notice 'PROOF OK: welcome_facts_missing_today raises on an empty day after grace and stays quiet now';
end $proof$;
