-- Follow-up to 20260921073334, caught by its own barrier before it could mislead anyone
-- (scripts/verify-stale-sweep-exclusions-are-watched.ts, mutation "an exclusion named only in a
-- COMMENT does not count").
--
-- pg_get_functiondef() returns a function body VERBATIM, comments and all. The exclusion lifter
-- therefore read `-- tablename <> 'x'` — a clause someone commented out, or merely wrote as a note
-- — as a live exclusion, and would have started watching a table mark_stale_listings_inactive()
-- still covers. The failure direction is the safe one (a duplicate alert on one condition, not a
-- blind spot), which is exactly why it would have survived a long time unnoticed.
--
-- Strip line comments before matching. Everything else about the function is unchanged.

create or replace function public.ops_stale_sweep_excluded_tables()
returns table (tbl text, platform text, sla_hours int)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  src   text;
  excl  text[] := '{}';
  m     text[];
begin
  -- Read the live definition of the stale sweep and lift its by-name exclusions out of it. Both
  -- shapes it uses are recognised:  tablename <> 'x'   and   tablename not like 'pat%'.
  -- Parsing the source (rather than restating the list) is the whole point: this detector must
  -- not be able to disagree with the function it is covering for.
  src := pg_get_functiondef('public.mark_stale_listings_inactive(integer, numeric)'::regprocedure);

  -- Strip line comments FIRST, so a commented-out clause is not lifted as a live exclusion.
  src := regexp_replace(src, '--[^' || chr(10) || ']*', '', 'g');

  for m in select regexp_matches(src, 'tablename\s*<>\s*''([^'']+)''', 'g') loop
    excl := excl || ('=' || m[1]);
  end loop;
  for m in select regexp_matches(src, 'tablename\s+not\s+like\s+''([^'']+)''', 'g') loop
    excl := excl || ('~' || m[1]);
  end loop;

  if array_length(excl, 1) is null then
    -- Zero exclusions is a legitimate state (someone removed them) but it is also exactly what a
    -- silently-broken parse looks like, so say so instead of returning an empty, reassuring set.
    raise notice 'ops_stale_sweep_excluded_tables: no by-name exclusions found in mark_stale_listings_inactive';
    return;
  end if;

  return query
  select t.tablename::text,
         regexp_replace(t.tablename, '_(residential|commercial)_listings$', '')::text,
         g.sla_hours
    from pg_tables t
    left join public.ops_liveness_registry g
      on g.platform = regexp_replace(t.tablename, '_(residential|commercial)_listings$', '')
   where t.schemaname = 'public'
     and t.tablename ~ '_(residential|commercial)_listings$'
     and exists (
       select 1 from unnest(excl) e
        where (left(e, 1) = '=' and t.tablename = substr(e, 2))
           or (left(e, 1) = '~' and t.tablename like substr(e, 2))
     );
end
$function$;
