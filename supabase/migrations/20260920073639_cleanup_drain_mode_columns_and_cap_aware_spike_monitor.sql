-- DRAIN MODE for the retention cleanup engine (owner-approved 2026-09-20).
-- The anomaly/fraction guards abort the whole run when the deletion-eligible population is large,
-- which is correct for a sudden spike but wrong for a genuine STANDING backlog (sold/rented
-- listings that piled up while the guard aborted every run since 2026-08-23 — the guard's own note
-- warns it "can never drain"). Customers keep clicking dead listings. drain_backlog lets the engine
-- DRIP a normal capped batch, source-re-verifying every row, instead of aborting — while a genuine
-- regression SPIKE still aborts (scrapers/common/cleanup.py::_is_spike). Default OFF (default-deny);
-- enabled per-platform only after a dry-run proves the backlog is genuine.

alter table public.platform_retention_policy
  add column if not exists drain_backlog boolean not null default false,
  add column if not exists drain_spike_factor numeric not null default 2.0;

-- Make the deletion-spike monitor cap-aware: a run that deleted up to its own max_delete_per_run is
-- operating exactly as configured, not spiking. Without this, every drain run (and even a normal
-- run whose cap 500 exceeds the floor 300) would raise a P1. The ABORTED branch is unchanged, so a
-- spike caught by the engine still alerts.
create or replace function public.mon_detect_deletion_spike()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; n int := 0; med numeric; thresh numeric; floor_n int; factor numeric; cap_n int; v_dedup text;
begin
  for rec in
    select r.*, p.anomaly_floor, p.anomaly_factor, p.max_delete_per_run
    from public.cleanup_runs r
    left join public.platform_retention_policy p on p.platform = r.platform
    where r.ran_at > now() - interval '2 days' and not r.dry_run
  loop
    floor_n := coalesce(rec.anomaly_floor, 300);
    factor  := coalesce(rec.anomaly_factor, 4);
    cap_n   := coalesce(rec.max_delete_per_run, 500);
    if rec.aborted then
      v_dedup := 'deletion_spike:'||rec.platform||':'||rec.id::text;
      if not exists (select 1 from public.alert_event where dedup_key = v_dedup) then
        n := n + public.mon_raise('P1','deletion_spike', rec.platform, v_dedup,
          jsonb_build_object('event','ABORTED','reason',rec.abort_reason,'candidates',rec.candidates,'ran_at',rec.ran_at));
      end if;
      continue;
    end if;
    select coalesce(percentile_cont(0.5) within group (order by h.deleted),0) into med
      from public.cleanup_runs h
     where h.platform = rec.platform and not h.dry_run and h.ran_at < rec.ran_at and h.ran_at > rec.ran_at - interval '30 days';
    -- A run can never delete more than its own cap, so a batch up to the cap is by definition not a
    -- spike; only deletions BEYOND the configured cap (a code/config fault) are.
    thresh := greatest(floor_n, factor * med, cap_n);
    if rec.deleted > thresh then
      v_dedup := 'deletion_spike:'||rec.platform||':'||rec.id::text;
      if not exists (select 1 from public.alert_event where dedup_key = v_dedup) then
        n := n + public.mon_raise('P1','deletion_spike', rec.platform, v_dedup,
          jsonb_build_object('event','SPIKE','deleted',rec.deleted,'threshold',round(thresh),'median_30d',round(med),'ran_at',rec.ran_at));
      end if;
    end if;
  end loop;

  update public.alert_event a set resolved_at = now()
  where a.kind = 'deletion_spike'
    and a.resolved_at is null
    and a.detail->>'event' = 'ABORTED'
    and exists (
      select 1 from public.cleanup_runs c
      where c.platform = a.platform
        and not c.dry_run
        and not c.aborted
        and c.ran_at > (a.detail->>'ran_at')::timestamptz);

  return n;
end $function$;
