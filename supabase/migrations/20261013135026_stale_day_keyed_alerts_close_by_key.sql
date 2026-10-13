-- 🔧 Quality & Repair 2026-10-13: a per-DAY dedup key must not leave yesterday's alert open forever (backlog 521).
--
-- Seven detectors raise under '<kind>:<current_date>' and resolve only today's key, so every earlier day's alert
-- stays open with nobody able to close it: on 2026-10-13 aqar_proven_wrong_resolution carried 17 open P1s for ONE real
-- row (20261013133115 fixed that one detector). This sweeper closes the class, BY KEY, under two sound rules:
--   (a) a NEWER day key of the same kind exists (any status) — the newer key carries the state;
--   (b) the detector mon_detect_<kind> swept today (ops_detector_timing, not crashed, not skipped) and NO key for today
--       exists — mon_raise with a new day key always creates a row, so an absent today key after a sweep means the
--       condition was false today, whatever the detector returned (ops_detector_timing.raised is the NEWLY-raised
--       count, never «found nothing»).
-- A kind whose detector name differs from 'mon_detect_<kind>' falls to (a) only: fail closed, the alert stays.
-- It returns 0 (it raises nothing) and leaves its trace in mon_mv_refresh_log('stale_day_keyed_alerts_closed'), never
-- a NOTICE (2026-10-07: a mid-run NOTICE froze cron job 38). Rostered by the same server-side edit as 20261013134551.

create or replace function public.mon_stale_day_keyed_alerts()
 returns table(alert_id bigint, kind text, dedup_key text, key_date date, reason text)
 language sql
 stable
as $function$
  with e as (
    select id, kind, dedup_key, substring(dedup_key from '\d{4}-\d{2}-\d{2}$')::date as key_date
    from public.alert_event
    where resolved_at is null and dedup_key ~ ':\d{4}-\d{2}-\d{2}$'
  )
  select e.id, e.kind, e.dedup_key, e.key_date,
         case
           when exists (select 1 from public.alert_event n
                         where n.kind = e.kind and n.dedup_key ~ ':\d{4}-\d{2}-\d{2}$'
                           and substring(n.dedup_key from '\d{4}-\d{2}-\d{2}$')::date > e.key_date)
             then 'a newer day key of the same kind exists'
           else 'the detector swept today and raised no key for today'
         end
  from e
  where e.key_date < current_date
    and (
      exists (select 1 from public.alert_event n
               where n.kind = e.kind and n.dedup_key ~ ':\d{4}-\d{2}-\d{2}$'
                 and substring(n.dedup_key from '\d{4}-\d{2}-\d{2}$')::date > e.key_date)
      or (
        exists (select 1 from public.ops_detector_timing t
                 where t.detector = 'mon_detect_' || e.kind and t.swept_at::date = current_date
                   and not t.crashed and not t.skipped)
        and not exists (select 1 from public.alert_event n
                         where n.kind = e.kind and n.dedup_key like '%:' || current_date::text)
      )
    )
  order by e.kind, e.key_date;
$function$;

create or replace function public.mon_detect_stale_day_keyed_alert()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c record; closed int := 0; keys text := '';
begin
  for c in select * from public.mon_stale_day_keyed_alerts() loop
    perform public.mon_resolve_key(c.kind, c.dedup_key);
    closed := closed + 1;
    keys := keys || c.dedup_key || ' (' || c.reason || '); ';
  end loop;
  if closed > 0 then
    insert into public.mon_mv_refresh_log (object_name, refreshed_at, rows_after, note)
    values ('stale_day_keyed_alerts_closed', now(), closed, left(keys, 900))
    on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;
  end if;
  return 0;  -- a self-heal raises nothing; the trace is the log row above
end
$function$;

-- Roster: insert the new name right before an existing anchor in the live mon_run_all_detectors text, then execute it.
do $roster$
declare d text; anchor text := '''mon_detect_aqar_proven_wrong_resolution'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_stale_day_keyed_alert''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_stale_day_keyed_alert'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_stale_day_keyed_alert''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF at apply, both directions, on planted keys inside a sub-transaction that is always rolled back.
do $proof$
declare r int; v_list text;
begin
  if (select count(*) from public.mon_stale_day_keyed_alerts()) <> 0 then
    raise exception 'PROOF: candidates exist before planting — read them first: %',
      (select string_agg(dedup_key, ', ') from public.mon_stale_day_keyed_alerts());
  end if;
  begin
    -- (a) two old keys of a kind that has a newer key: both close
    perform public.mon_raise('P1', 'aqar_proven_wrong_resolution', 'aqar', 'aqar_proven_wrong_resolution:2000-01-01', '{"planted":true}'::jsonb);
    perform public.mon_raise('P1', 'aqar_proven_wrong_resolution', 'aqar', 'aqar_proven_wrong_resolution:2000-01-02', '{"planted":true}'::jsonb);
    -- (b) an old key of a kind whose detector swept today and raised no key for today: closes
    perform public.mon_raise('P2', 'unverified_inactivation', 'fleet', 'unverified_inactivation:2000-01-01', '{"planted":true}'::jsonb);
    -- fail closed: a kind with NO sweep today and no newer key stays open
    perform public.mon_raise('P2', 'qa_planted_kind', 'fleet', 'qa_planted_kind:2000-01-01', '{"planted":true}'::jsonb);
    select string_agg(dedup_key, ',' order by dedup_key) into v_list from public.mon_stale_day_keyed_alerts();
    if v_list is distinct from 'aqar_proven_wrong_resolution:2000-01-01,aqar_proven_wrong_resolution:2000-01-02,unverified_inactivation:2000-01-01' then
      raise exception 'PROOF: candidate set is % ', coalesce(v_list, '(none)');
    end if;
    r := public.mon_detect_stale_day_keyed_alert();
    if r <> 0 then raise exception 'PROOF: sweeper returned % (must raise nothing)', r; end if;
    if (select count(*) from public.alert_event where dedup_key in ('aqar_proven_wrong_resolution:2000-01-01','aqar_proven_wrong_resolution:2000-01-02','unverified_inactivation:2000-01-01') and resolved_at is null) <> 0 then
      raise exception 'PROOF: a candidate stayed open';
    end if;
    if (select count(*) from public.alert_event where dedup_key = 'qa_planted_kind:2000-01-01' and resolved_at is null) <> 1 then
      raise exception 'PROOF: the fail-closed key was closed';
    end if;
    raise exception 'ROLLBACK_PLANT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PLANT' then raise; end if;
  end;
  if (select count(*) from public.alert_event where detail->>'planted' = 'true') <> 0 then raise exception 'PROOF: planted rows survived the rollback'; end if;
  r := (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_stale_day_keyed_alert');
  if r <> 0 then raise exception 'PROOF: the sweeper reads as orphaned'; end if;
end
$proof$;