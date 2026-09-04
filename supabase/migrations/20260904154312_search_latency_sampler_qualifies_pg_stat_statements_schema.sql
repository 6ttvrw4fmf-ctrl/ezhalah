-- pg_stat_statements lives in the `extensions` schema, not `public` (Supabase's default placement).
-- mon_sample_search_latency() pins `set search_path to 'public'` — correct and deliberate, since an
-- unqualified search_path in a SECURITY DEFINER function is a privilege-escalation hole — so the
-- view was simply not visible and every call raised 42P01. Caught by running the sampler for real
-- immediately after applying it rather than trusting that it compiled: a plpgsql body only resolves
-- its table references at EXECUTION time, so "the migration applied cleanly" proves nothing here.
--
-- Schema-qualify rather than widen search_path: adding `extensions` to the path of a SECURITY
-- DEFINER function would make every other unqualified name in it resolvable from that schema too.
--
-- The catalog read is also wrapped so a future environment WITHOUT the extension degrades to "no
-- sample" instead of erroring inside the twice-hourly detector transaction — where a raise would
-- abort the whole sweep and take every other detector down with it.
create or replace function public.mon_sample_search_latency()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_calls bigint; v_ms numeric; v_prev record; v_dc bigint; v_dms numeric; v_int numeric; v_cron numeric;
begin
  begin
    select coalesce(sum(s.calls),0), coalesce(sum(s.total_exec_time),0)
      into v_calls, v_ms
      from extensions.pg_stat_statements s
     where s.query ilike '%location_search_candidates_ar%';
  exception when undefined_table or insufficient_privilege then
    return;   -- no statement statistics available here; a monitoring gap must never page anyone
  end;
  if coalesce(v_calls,0) = 0 then return; end if;

  select * into v_prev from public.ops_search_latency_sample order by sampled_at desc limit 1;

  if v_prev.sampled_at is not null and v_calls >= v_prev.calls_total and v_ms >= v_prev.exec_ms_total then
    v_dc  := v_calls - v_prev.calls_total;
    v_int := extract(epoch from (now() - v_prev.sampled_at));
    if v_dc > 0 then v_dms := round(((v_ms - v_prev.exec_ms_total) / v_dc)::numeric, 1); end if;
    select coalesce(sum(extract(epoch from (least(coalesce(d.end_time, now()), now())
                                          - greatest(d.start_time, v_prev.sampled_at)))), 0)
      into v_cron
      from cron.job_run_details d
     where d.start_time < now()
       and coalesce(d.end_time, now()) > v_prev.sampled_at;
  end if;

  insert into public.ops_search_latency_sample
    (sampled_at, calls_total, exec_ms_total, delta_calls, delta_mean_ms, cron_busy_s, interval_s)
  values (now(), v_calls, v_ms, v_dc, v_dms, greatest(coalesce(v_cron,0), 0), v_int);

  delete from public.ops_search_latency_sample where sampled_at < now() - interval '30 days';
end $$;
