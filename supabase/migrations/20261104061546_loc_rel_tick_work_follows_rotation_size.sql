-- loc_rel ROTATION: WORK PER TICK FOLLOWS THE ROTATION SIZE (alert loc_rel_cycle_budget #6002, 2026-11-04).
--
-- 20260919061517 fixed tables-per-tick at 4 when the rotation held 101 tables and promised it would survive growth to
-- ~460. It did not need 460: measured 2026-11-04 the rotation holds 303 tables, 16 tables/hour are ticked (4 ticks x 4),
-- projected full cycle 18.9 h — past the 18 h early warning, heading for the 30 h starvation alarm. jobid 22 is healthy:
-- 96/96 runs in 24 h succeeded, AVERAGE 2.2 s per tick for 4 tables, max 96 s. The 30 s wall budget is nowhere near binding;
-- the fixed constant is the whole bottleneck, and a constant is exactly what made the cycle grow with every launch.
--
-- FIX (the lever the alarm names: work-per-tick; the 30 h alarm and loc_rel_scope_tables() are untouched):
-- tables per tick = greatest(4, ceil(rotation / 24)) — 4 ticks/hour, so the whole rotation is planned in ~6 h at any size
-- (303 → 13 per tick, ~7 s at today's per-table cost). The 30 s wall budget, still checked BEFORE claiming each table,
-- stays the hard ceiling, so a tick is bounded exactly as before (30 s + one table's 110 s statement_timeout). If the
-- budget ever binds, the cycle grows again and loc_rel_cycle_budget fires — then it is real per-table cost, not a constant.
-- Cron command unchanged (the sole `CALL public.loc_rel_refresh_tick();`). Live body patched, anchor checked once, fail closed.
do $mig$
declare
  d text := pg_get_functiondef('public.loc_rel_refresh_tick()'::regprocedure);
  a_old constant text := $o$  c_max_tables constant int     := 4;$o$;
  a_new constant text := $n$  -- 2026-11-04: follows the rotation size (~6 h planned cycle at 4 ticks/h); the 30 s budget below is the ceiling.
  c_max_tables constant int     := greatest(4, ceil((select count(*) from public.loc_rel_scope_tables()) / 24.0)::int);$n$;
begin
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1 then
    raise exception 'loc_rel_refresh_tick: c_max_tables anchor not found exactly once';
  end if;
  execute replace(d, a_old, a_new);
  if position('greatest(4, ceil((select count(*) from public.loc_rel_scope_tables()) / 24.0)::int)'
              in pg_get_functiondef('public.loc_rel_refresh_tick()'::regprocedure)) = 0 then
    raise exception 'loc_rel_refresh_tick: patch did not land';
  end if;
end
$mig$;
