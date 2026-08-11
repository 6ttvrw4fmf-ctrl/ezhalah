-- Found by its own mutation test: dropping af_eligible_count made the barrier CRASH at the
-- '::regproc' cast in the param-surface check instead of reporting a violation. A crashed barrier
-- is a failed cron run, not an alert row — the failure mode a barrier exists to avoid. Checks C and
-- D now run only over functions that exist as exactly one overload; a missing surface is already
-- reported by check A and must not take the rest of the barrier down with it.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into strict def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_af_predicate_parity' and p.prokind = 'f';

  if position('-- C ---' in def) = 0 then
    raise exception 'section C anchor not found';
  end if;

  def := replace(def,
    E'  -- C ----------------------------------------------------------------------\n',
    E'  -- C + D run only when every surface exists as exactly one overload; a missing/duplicated\n'
 || E'  -- surface was already reported by check A, and crashing here would silence checks C and D.\n'
 || E'  if exists (select 1 from public.af_rpc_build_state bs\n'
 || E'              where (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n'
 || E'                      where n.nspname = ''public'' and p.proname = bs.fn_name and p.prokind = ''f'') <> 1) then\n'
 || E'    return total;\n'
 || E'  end if;\n'
 || E'  -- C ----------------------------------------------------------------------\n');

  execute def;
end $$;

-- install-time green check
do $$
declare v int;
begin
  v := public.mon_af_predicate_parity();
  if v <> 0 then raise exception 'parity barrier reports % violations after hardening', v; end if;
end $$;
