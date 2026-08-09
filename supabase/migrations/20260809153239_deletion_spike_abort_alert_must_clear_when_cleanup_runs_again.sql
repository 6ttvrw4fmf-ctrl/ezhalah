-- mon_detect_deletion_spike() only ever RAISED — it had no resolve path at all, so every alert it
-- created stayed open forever even after the situation was fully resolved.
--
-- Evidence (2026-08-09): alert_event id 323 fired at 03:20Z for the gathern cleanup ABORT
-- ("anomaly: 301 candidates > threshold 300"). The underlying deadlock was fixed (PR #368/#370) and
-- the cleanup then ran successfully at 13:47Z — deleting 227 source-verified-404 rows and
-- self-healing 73 — yet id 323 was still unresolved, a permanent false P1 telling an operator to
-- review a condition that no longer exists. Same class as the orphaned-detector alert fixed on
-- 2026-08-06: a detector that can raise but never clear.
--
-- The self-heal is deliberately narrow. Only ABORTED alerts clear, and only when a STRICTLY LATER
-- non-dry, non-aborted run exists for that platform — i.e. the job the alert complained about has
-- since actually completed. SPIKE alerts are left open on purpose: "we deleted an unusually large
-- number of rows" is a historical fact that deserves human eyes, not a condition that clears.
create or replace function public.mon_detect_deletion_spike()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; n int := 0; med numeric; thresh numeric; floor_n int; factor numeric;
begin
  for rec in
    select r.*, p.anomaly_floor, p.anomaly_factor
    from public.cleanup_runs r
    left join public.platform_retention_policy p on p.platform = r.platform
    where r.ran_at > now() - interval '2 days' and not r.dry_run
  loop
    floor_n := coalesce(rec.anomaly_floor, 300);
    factor  := coalesce(rec.anomaly_factor, 4);
    if rec.aborted then
      n := n + public.mon_raise('P1','deletion_spike', rec.platform,
        'deletion_spike:'||rec.platform||':'||rec.id::text,
        jsonb_build_object('event','ABORTED','reason',rec.abort_reason,'candidates',rec.candidates,'ran_at',rec.ran_at));
      continue;
    end if;
    select coalesce(percentile_cont(0.5) within group (order by h.deleted),0) into med
      from public.cleanup_runs h
     where h.platform = rec.platform and not h.dry_run and h.ran_at < rec.ran_at and h.ran_at > rec.ran_at - interval '30 days';
    thresh := greatest(floor_n, factor * med);
    if rec.deleted > thresh then
      n := n + public.mon_raise('P1','deletion_spike', rec.platform,
        'deletion_spike:'||rec.platform||':'||rec.id::text,
        jsonb_build_object('event','SPIKE','deleted',rec.deleted,'threshold',round(thresh),'median_30d',round(med),'ran_at',rec.ran_at));
    end if;
  end loop;

  -- SELF-HEAL: an ABORTED alert clears once that platform has had a later successful real run.
  -- Scoped by detail->>'event' so a SPIKE alert is never silently closed.
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
