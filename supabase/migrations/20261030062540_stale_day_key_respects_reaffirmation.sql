-- Bug #3: mass_inactivation flapped every hour.
-- Cause: mon_stale_day_keyed_alerts() closed any open key dated before today once its detector had
-- swept today. But mon_detect_mass_inactivation deliberately re-checks YESTERDAY too
-- (d.day >= current_date - 1), so it re-raised the key it had just lost -> close/re-open every sweep
-- (23 times on 2026-10-28 for mass_inactivation:razre:2026-10-27).
-- Fix: never close a key that its detector's latest clean sweep re-affirmed.
-- swept_at, created_at and last_affirmed_at all come from the sweep transaction's now(), so
-- "touched at or after max(clean swept_at)" means "that sweep stood behind it" in BOTH detector
-- orders (the sweep rotates order every hour).

create or replace function public.mon_stale_day_keyed_alerts()
 returns table(alert_id bigint, kind text, dedup_key text, key_date date, reason text)
 language sql
 stable
as $function$
  with e as (
    select id, kind, dedup_key, substring(dedup_key from '\d{4}-\d{2}-\d{2}$')::date as key_date,
           greatest(created_at, coalesce(last_affirmed_at, created_at)) as last_touched
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
    -- BARRIER (bug #3): a key the detector's latest clean sweep re-affirmed is still true. Keep it.
    -- Must stay ">=": the sweep stamps both sides with the same now(). ">" brings the flap back.
    and not (e.last_touched >= coalesce(
          (select max(t.swept_at) from public.ops_detector_timing t
            where t.detector = 'mon_detect_' || e.kind
              and not coalesce(t.crashed, false) and not coalesce(t.skipped, false)),
          'infinity'::timestamptz))
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

-- Apply-time self-test (rolled back): fails the migration if the barrier is wrong.
do $$
declare ls timestamptz; y date := current_date - 1; a bigint; b bigint; aff bool; clr bool;
begin
  select max(swept_at) into ls from public.ops_detector_timing
   where detector = 'mon_detect_mass_inactivation' and not coalesce(crashed,false) and not coalesce(skipped,false);
  if ls is null or ls::date <> current_date then
    raise notice 'self-test skipped: no clean mass_inactivation sweep today'; return;
  end if;
  begin
    insert into public.alert_event(severity,kind,platform,dedup_key,detail,created_at,last_affirmed_at)
    values ('P1','mass_inactivation','__selftest_a__','mass_inactivation:__selftest_a__:'||y,'{}', ls - interval '1 hour', ls)
    returning id into a;
    insert into public.alert_event(severity,kind,platform,dedup_key,detail,created_at,last_affirmed_at)
    values ('P1','mass_inactivation','__selftest_b__','mass_inactivation:__selftest_b__:'||y,'{}', ls - interval '2 hour', ls - interval '1 hour')
    returning id into b;
    aff := exists(select 1 from public.mon_stale_day_keyed_alerts() s where s.alert_id = a);
    clr := exists(select 1 from public.mon_stale_day_keyed_alerts() s where s.alert_id = b);
    raise exception 'selftest:%:%', aff, clr;
  exception when raise_exception then
    if sqlerrm <> 'selftest:f:t' then
      raise exception 'bug #3 barrier self-test FAILED (closes_affirmed:closes_cleared = %)', sqlerrm;
    end if;
  end;
end $$;