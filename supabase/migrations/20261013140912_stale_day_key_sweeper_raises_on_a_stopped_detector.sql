-- 🔧 Quality & Repair 2026-10-13: the stale-day-key sweeper must be able to SPEAK (alert 9369, detector_cannot_raise).
--
-- 20261013135026 shipped mon_detect_stale_day_keyed_alert() as a pure self-heal with no mon_raise, and the fleet's
-- audibility barrier (mon_detect_detector_cannot_raise) rightly flagged it 29 minutes later: a rostered detector that
-- can never reach alert_event is decoration. It has a real finding to make — a day-keyed alert older than one day that
-- CANNOT be closed because its own detector has not swept today (the detector stopped; its silence was reading as
-- health, LISTING_LIVENESS.md §9). It now raises P2 on that, by a constant key, and resolves it when none remains.

create or replace function public.mon_stuck_day_keyed_alerts()
 returns table(alert_id bigint, kind text, dedup_key text, key_date date)
 language sql
 stable
as $function$
  select e.id, e.kind, e.dedup_key, substring(e.dedup_key from '\d{4}-\d{2}-\d{2}$')::date
  from public.alert_event e
  where e.resolved_at is null
    and e.dedup_key ~ ':\d{4}-\d{2}-\d{2}$'
    and substring(e.dedup_key from '\d{4}-\d{2}-\d{2}$')::date < current_date - 1
    and not exists (select 1 from public.mon_stale_day_keyed_alerts() s where s.alert_id = e.id)
    and exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_' || e.kind)
    and not exists (select 1 from public.ops_detector_timing t
                     where t.detector = 'mon_detect_' || e.kind and t.swept_at::date = current_date
                       and not t.crashed and not t.skipped)
  order by e.kind, 4;
$function$;

create or replace function public.mon_detect_stale_day_keyed_alert()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c record; closed int := 0; keys text := ''; n int := 0; stuck jsonb; k int;
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

  -- The finding: an old day key whose own detector has not swept today — a stopped detector, not a stale alert.
  select count(*), jsonb_agg(jsonb_build_object('kind', s.kind, 'dedup_key', s.dedup_key, 'key_date', s.key_date))
    into k, stuck
    from (select * from public.mon_stuck_day_keyed_alerts() limit 20) s;
  if k > 0 then
    n := public.mon_raise('P2', 'stale_day_keyed_alert', 'fleet', 'stale_day_keyed_alert',
      jsonb_build_object('count', k, 'stuck', stuck,
        'why', 'a day-keyed alert older than one day is still open and cannot be closed: no newer key exists and its '
            || 'own detector mon_detect_<kind> has no clean sweep today. A detector that stopped running leaves '
            || 'yesterday''s key as the only state — its silence is the finding (LISTING_LIVENESS.md §9).',
        'fix', 'read ops_detector_timing for that detector (crashed? skipped? absent from the roster?) and restore '
            || 'its run; the key closes itself once the detector sweeps again.'));
  else
    perform public.mon_resolve_key('stale_day_keyed_alert', 'stale_day_keyed_alert');
  end if;
  return n;
end
$function$;

-- PROOF at apply, both directions, inside a rolled-back sub-transaction.
do $proof$
declare r int;
begin
  r := public.mon_detect_stale_day_keyed_alert();
  if r <> 0 then raise exception 'PROOF: stuck keys exist before planting (%): %', r,
    (select string_agg(dedup_key, ', ') from public.mon_stuck_day_keyed_alerts()); end if;
  begin
    -- a kind with a detector that exists but has not swept today, holding a 2-day-old key: must RAISE
    execute 'create function public.mon_detect_qa_planted_kind() returns integer language sql as $q$ select public.mon_raise(''P2'', ''qa_planted_kind'', ''fleet'', ''qa_planted_kind:'' || current_date, ''{}''::jsonb) $q$';
    perform public.mon_raise('P2', 'qa_planted_kind', 'fleet', 'qa_planted_kind:2000-01-01', '{"planted":true}'::jsonb);
    if (select count(*) from public.mon_stuck_day_keyed_alerts() where dedup_key = 'qa_planted_kind:2000-01-01') <> 1 then
      raise exception 'PROOF: the planted stuck key is not listed';
    end if;
    r := public.mon_detect_stale_day_keyed_alert();
    if (select count(*) from public.alert_event where dedup_key = 'stale_day_keyed_alert' and resolved_at is null) <> 1 then
      raise exception 'PROOF: the sweeper did not raise on a stuck key';
    end if;
    raise exception 'ROLLBACK_PLANT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PLANT' then raise; end if;
  end;
  if (select count(*) from public.alert_event where detail->>'planted' = 'true' or dedup_key = 'stale_day_keyed_alert') <> 0 then
    raise exception 'PROOF: planted rows survived the rollback';
  end if;
  if (select count(*) from pg_proc where proname = 'mon_detect_qa_planted_kind') <> 0 then raise exception 'PROOF: planted function survived'; end if;
end
$proof$;