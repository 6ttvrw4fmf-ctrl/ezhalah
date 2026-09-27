create or replace function public.promote_aged_alerts_to_incidents()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare
  a record; v_considered int := 0; v_promoted int := 0; v_closed int := 0;
  v_meta text[] := array[
    'incident_stalled','alert_queue_unworked','stuck_open_alert','stale_no_remediation_path',
    'remediation_exhausted','remediation_worker_stale','detector_sweep_budget','detector_crash',
    'routine_sentry_silent','detector_dark','orphaned_detector'];
  v_sla interval; v_surface text;
begin
  for a in
    select ae.id, ae.kind, ae.dedup_key, ae.platform, ae.severity, ae.owner_routine, ae.created_at, ae.detail
      from public.alert_event ae
     where ae.resolved_at is null
       and ae.severity in ('P0','P1')
       and ae.owner_routine is not null
       and not (ae.kind = any(v_meta))
       and (ae.last_affirmed_at is null or ae.last_affirmed_at > now() - interval '48 hours')
  loop
    v_considered := v_considered + 1;
    v_sla := case a.severity when 'P0' then interval '4 hours' else interval '24 hours' end;
    if a.created_at > now() - v_sla then continue; end if;
    v_surface := case a.owner_routine
      when 'routine-1-scraping'          then 'scraper'
      when 'routine-2-production'         then 'agent'
      when 'routine-3-data-integrity'    then 'data_integrity'
      when 'routine-4-search-qa'         then 'search'
      when 'routine-5-af-trending'       then 'advanced_filter'
      when 'routine-6-journey'           then 'session'
      when 'routine-7-seam'              then 'monitoring'
      when 'routine-8-regression-hunter' then 'regression'
      when 'routine-9-red-team'          then 'production_truth'
      when 'routine-10-barrier'          then 'barrier'
      when 'routine-11-lifecycle'        then 'lifecycle'
      else 'monitoring' end;
    perform public.incident_open(
      'alert:' || a.dedup_key,
      left(a.kind || ' — ' || coalesce(a.platform,'(no platform)'), 200),
      v_surface, a.severity, 'alert_bridge', a.dedup_key,
      jsonb_build_object('promoted_from_alert', a.id, 'kind', a.kind, 'dedup_key', a.dedup_key,
        'platform', a.platform, 'alert_created_at', a.created_at,
        'why', 'Serious alert left open past its ' || a.severity || ' SLA; promoted so it is tracked, owned, and escalated as an incident. Closes ONLY when the underlying alert is verified resolved in production — never on inspection.',
        'alert_detail', a.detail));
    v_promoted := v_promoted + 1;
  end loop;

  update public.ops_incident i
     set state = 'resolved', resolved_at = now(),
         production_verified_at = coalesce(i.production_verified_at, now()),
         exit_reason = 'source_alert_resolved',
         root_cause = coalesce(i.root_cause, 'auto: the source alert''s detector verified the condition cleared in production'),
         last_progress_at = now(), updated_at = now()
   where i.source = 'alert_bridge'
     and i.state not in ('resolved','wont_fix')
     and not exists (select 1 from public.alert_event o where o.dedup_key = i.source_ref and o.resolved_at is null)
     and exists     (select 1 from public.alert_event r where r.dedup_key = i.source_ref and r.resolved_at is not null);
  get diagnostics v_closed = row_count;

  return jsonb_build_object('considered', v_considered, 'promoted_or_reobserved', v_promoted, 'verified_closed', v_closed);
end $fn$;

comment on function public.promote_aged_alerts_to_incidents() is
  'Alert->incident bridge (owner 2026-09-21). Promotes serious (P0/P1) alerts open past their SLA (P0 4h, P1 24h) into ops_incident, idempotent+deduped by fingerprint alert:<dedup_key>. Excludes meta kinds to prevent an alert<->incident loop. Closes a bridged incident only when its source alert is verified-resolved in production. Never auto-resolves on inspection.';

select cron.schedule('alert-to-incident-bridge', '*/20 * * * *',
  $$ set statement_timeout to '60s'; select public.promote_aged_alerts_to_incidents(); $$);

drop view if exists public.mon_remediation_health;
create view public.mon_remediation_health as
select
  (select count(*) from alert_event where resolved_at is null) as open_incidents,
  (select count(*) from alert_event where resolved_at is null and severity='P0') as open_p0,
  (select count(*) from alert_event where resolved_at is null and severity='P1') as open_p1,
  (select round(extract(epoch from (now()-min(created_at)))/86400.0,1)
     from alert_event where resolved_at is null and severity in ('P0','P1')) as oldest_serious_days,
  (select count(*) from alert_event where resolved_at is null
     and last_affirmed_at is not null and last_affirmed_at < now()-interval '48 hours') as stale_unworked,
  (select count(*) from alert_event where resolved_at is null and owner_routine is null) as unrouted,
  (select count(*) from alert_event where resolved_at is null and dispatched_at is not null
     and acknowledged_at is null and dispatched_at < now()-interval '48 hours') as dispatched_unacked_48h,
  (select round(100.0 * count(*) filter (where verified) / nullif(count(*),0), 1)
     from ops_remediation_attempt where attempted_at > now()-interval '7 days') as autofix_success_pct_7d,
  (select count(*) from ops_remediation_attempt where attempted_at > now()-interval '7 days' and not coalesce(verified,false)) as autofix_failures_7d,
  (select count(*) from alert_event where kind='remediation_exhausted' and resolved_at is null) as remediation_exhausted_open,
  (select max(ran_at) from ops_remediation_run) as worker_last_ran,
  (select count(*) filter (where a.last_ran is null or a.last_ran < now()-interval '30 hours')
     from (select o.canonical,
             (select max(h.ran_at) from ops_routine_sentry_heartbeat h
                join ops_routine_heartbeat_alias al on al.emits_as=h.routine where al.canonical=o.canonical) as last_ran
           from (select unnest(incident_known_owners()) as canonical) o) a) as routines_silent,
  (select count(*) from alert_event where kind='alert_flapping' and resolved_at is null) as flapping_open,
  (select count(*) from ops_incident where source='alert_bridge' and state not in ('resolved','wont_fix')) as bridge_incidents_open;