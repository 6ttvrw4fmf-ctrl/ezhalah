-- loader_strip_platforms_ar() cost TWICE what the function it replaces on the loading screen cost.
--
-- Measured 2026-09-27 right after 20260927050354: loader_active_platforms_ar() 141 ms / 17,693
-- shared buffers; loader_strip_platforms_ar() 271 ms / 34,860 — exactly double. EXPLAIN of the SQL
-- body shows why: the planner evaluates `unnest(public.loader_active_platforms_ar())` once while
-- PLANNING (Planning: 17,549 buffers, 140 ms — a stable, argument-less call in FROM is pre-evaluated
-- for its row estimate) and again while EXECUTING (17,066 buffers, 133 ms). Every search's loader
-- would have paid for the platform scan twice.
--
-- plpgsql assigns the base set to a variable exactly once; the filter then runs over a parameter the
-- planner cannot pre-evaluate. Same result, same contract, one scan. Nothing else changes.

create or replace function public.loader_strip_platforms_ar()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active text[] := public.loader_active_platforms_ar();
begin
  return coalesce(
    (select array_agg(p order by p)
       from unnest(v_active) as p
      where not exists (
        select 1 from public.platform_registry r
         where r.platform = p and r.status in ('dormant', 'retired'))),
    '{}'::text[]);
end;
$$;

grant execute on function public.loader_strip_platforms_ar() to anon, authenticated;

do $verify$
declare
  v_active text[] := public.loader_active_platforms_ar();
  v_strip  text[] := public.loader_strip_platforms_ar();
  v_expect text[];
begin
  select coalesce(array_agg(p order by p), '{}'::text[]) into v_expect
    from unnest(v_active) p
   where not exists (select 1 from public.platform_registry r
                      where r.platform = p and r.status in ('dormant','retired'));
  if v_strip is distinct from v_expect then
    raise exception 'rewrite changed the answer: got %, expected %', v_strip, v_expect;
  end if;
  raise notice 'loader strip unchanged by the rewrite: % platforms', cardinality(v_strip);
end $verify$;
