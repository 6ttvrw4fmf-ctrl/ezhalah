-- ops_incident #35 — THE MUTATION, INSTITUTIONALISED. A barrier nobody has seen fail is a comment
-- that runs (AGENTS.md, §G.9.4).
--
-- mon_detect_unreachable_listing_table() is green today because production is genuinely clean: 81
-- physical listings tables, 81 reachable, 0 orphans. That is indistinguishable, from the outside,
-- from a predicate that has been weakened until it can no longer see anything — and "widen the
-- predicate to clear a red" is the documented way this repo loses a guard. A `create or replace`
-- that guts mon_unreachable_listing_tables() would leave every sweep green forever.
--
-- So the mutation does not happen once, in a session nobody can replay. It happens twice an hour:
-- this detector INJECTS a table that is in no layer and fails if the predicate does not report it,
-- injects one that IS reachable and fails if the predicate does report it, and checks that the
-- raising half still calls the deciding half. Same shape, same 'blind_guard' alert kind, as
-- mon_detect_orphan_detector_is_blind() — resolved BY KEY, so the two never clear each other.

create or replace function public.mon_detect_unreachable_listing_table_is_blind()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  -- A table name nothing has ever created, registered or retired. If the predicate works,
  -- injecting it MUST come back reported.
  probe constant text := 'zz_blindness_probe_residential_listings';
  control text;
  blind text[] := '{}';
begin
  -- POSITIVE: the thing the detector exists to notice — a listings table in no layer.
  if not (probe = any (public.mon_unreachable_listing_tables(array[probe]))) then
    blind := blind || array['an injected listings table in NO layer of the search chain was not reported'];
  end if;

  -- NEGATIVE CONTROL: a predicate that reported everything would satisfy the positive half and be
  -- just as useless — and it would also bury the real finding under 81 false alerts. Take a table
  -- the predicate currently considers reachable and assert that re-injecting it changes nothing.
  select c.relname into control
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r'
     and c.relname like '%\_listings'
     and not (c.relname = any (public.mon_unreachable_listing_tables()))
   order by c.relname
   limit 1;
  if control is null then
    blind := blind || array['no reachable listings table exists to use as a negative control — either the catalog is empty or every table is already reported'];
  elsif control = any (public.mon_unreachable_listing_tables(array[control])) then
    blind := blind || array[format('a REACHABLE listings table (%s) was reported as unreachable — the predicate flags everything', control)];
  end if;

  -- The raising half must still be attached to the deciding half. Without this, the two checks
  -- above could pass while mon_detect_unreachable_listing_table() quietly stopped consulting them.
  if position('public.mon_unreachable_listing_tables(' in (
       select pg_get_functiondef(p.oid) from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = 'mon_detect_unreachable_listing_table')) = 0 then
    blind := blind || array['mon_detect_unreachable_listing_table() no longer calls the predicate this self-test proves'];
  end if;

  if cardinality(blind) > 0 then
    n := public.mon_raise('P1', 'blind_guard', null,
      'blind_guard:mon_detect_unreachable_listing_table',
      jsonb_build_object('blind', to_jsonb(blind),
        'why', 'mon_detect_unreachable_listing_table() is the ONLY guard that can see a physical '
               || 'listings table in no layer of the search chain — every other guard for that '
               || 'class reads search_listings_ar, which such a table never reaches. It can no '
               || 'longer distinguish an unreachable table from a launched one, so its green is '
               || 'meaningless.',
        'fix', 'Restore the predicate. Never widen it to clear a red: the widening that clears the '
               || 'alarm is the same widening that would have let ops_incident #35 through.',
        'owner', 'routine-8-regression-hunter'));
  else
    -- BY KEY, never mon_resolve('blind_guard', ...): a kind-and-platform resolve would clear
    -- mon_detect_orphan_detector_is_blind()'s finding along with our own.
    perform public.mon_resolve_key('blind_guard', 'blind_guard:mon_detect_unreachable_listing_table');
  end if;
  return n;
end
$function$;

comment on function public.mon_detect_unreachable_listing_table_is_blind() is
  'ops_incident #35. Runs the #35 mutation twice an hour: injects a listings table in no layer and '
  'fails if it is not reported, injects a reachable one and fails if it is.';

-- ROSTER, SAME MIGRATION. Guarded needle-edit on the LIVE body — it cannot drop entries it never read.
do $do$
declare
  v_def text;
  v_before text;
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
  fn constant text := 'mon_detect_unreachable_listing_table_is_blind';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then
    raise exception 'mon_run_all_detectors is missing — refusing to wire a detector into nothing';
  end if;
  v_before := v_def;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'roster already carries %', fn;
    return;
  end if;
  execute v_def;
end $do$;

-- POST-CONDITIONS.
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_unreachable_listing_table_is_blind''' in v_def) = 0 then
    raise exception 'blind guard is not in the roster — the mutation would run nowhere';
  end if;
  if position('''mon_detect_unreachable_listing_table''' in v_def) = 0 then
    raise exception 'the detector it guards fell out of the roster';
  end if;

  -- It must pass RIGHT NOW against a healthy production, or it is not a usable signal.
  if public.mon_detect_unreachable_listing_table_is_blind() <> 0 then
    raise exception 'blind guard is red on a production known to be clean — it would be noise';
  end if;
end $do$;
