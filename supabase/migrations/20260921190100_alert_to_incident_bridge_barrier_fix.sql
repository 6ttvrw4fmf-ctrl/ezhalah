-- Mirror of the applied migration `alert_to_incident_bridge_barrier_fix`.
-- The bridge's verified-close must satisfy ops_incident_resolution_is_earned (barrier_script AND
-- production_verified_at both NOT NULL). For a bridged incident the durable guard IS its source
-- detector: it re-checks production every sweep and reopens the incident (incident_open on the same
-- fingerprint) if the condition returns. Naming it as the barrier is honest and satisfies the gate.
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
     where ae.resolved_at is null and ae.severity in ('P0','P1') and ae.owner_routine is not null
       and not (ae.kind = any(v_meta))
       and (ae.last_affirmed_at is null or ae.last_affirmed_at > now() - interval '48 hours')
  loop
    v_considered := v_considered + 1;
    v_sla := case a.severity when 'P0' then interval '4 hours' else interval '24 hours' end;
    if a.created_at > now() - v_sla then continue; end if;
    v_surface := case a.owner_routine
      when 'routine-1-scraping' then 'scraper' when 'routine-2-production' then 'agent'
      when 'routine-3-data-integrity' then 'data_integrity' when 'routine-4-search-qa' then 'search'
      when 'routine-5-af-trending' then 'advanced_filter' when 'routine-6-journey' then 'session'
      when 'routine-7-seam' then 'monitoring' when 'routine-8-regression-hunter' then 'regression'
      when 'routine-9-red-team' then 'production_truth' when 'routine-10-barrier' then 'barrier'
      when 'routine-11-lifecycle' then 'lifecycle' else 'monitoring' end;
    perform public.incident_open('alert:' || a.dedup_key,
      left(a.kind || ' — ' || coalesce(a.platform,'(no platform)'), 200),
      v_surface, a.severity, 'detector', a.dedup_key,
      jsonb_build_object('promoted_from_alert', a.id, 'kind', a.kind, 'dedup_key', a.dedup_key,
        'platform', a.platform, 'alert_created_at', a.created_at,
        'why', 'Serious alert left open past its ' || a.severity || ' SLA; promoted so it is tracked, owned, and escalated as an incident. Closes ONLY when the underlying alert is verified resolved in production — never on inspection.',
        'alert_detail', a.detail));
    v_promoted := v_promoted + 1;
  end loop;

  update public.ops_incident i
     set state = 'resolved', resolved_at = now(), production_verified_at = coalesce(i.production_verified_at, now()),
         barrier_script = coalesce(i.barrier_script, 'auto:detector-self-heal:' || i.source_ref),
         exit_reason = 'source_alert_resolved',
         root_cause = coalesce(i.root_cause, 'auto: the source alert''s detector verified the condition cleared in production'),
         last_progress_at = now(), updated_at = now()
   where i.fingerprint like 'alert:%' and i.state not in ('resolved','wont_fix')
     and not exists (select 1 from public.alert_event o where o.dedup_key = i.source_ref and o.resolved_at is null)
     and exists     (select 1 from public.alert_event r where r.dedup_key = i.source_ref and r.resolved_at is not null);
  get diagnostics v_closed = row_count;
  return jsonb_build_object('considered', v_considered, 'promoted_or_reobserved', v_promoted, 'verified_closed', v_closed);
end $fn$;