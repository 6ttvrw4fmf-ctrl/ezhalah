-- ops_incident #35 — A PHYSICAL LISTINGS TABLE CAN EXIST IN NO LAYER OF THE SEARCH CHAIN, AND
-- EVERY GUARD FOR THAT CLASS READS THE SEARCH INDEX, SO NONE OF THEM CAN EVER SEE IT.
--
-- WHAT THE 2026-09-03 REPAIR JOINED, AND WHAT IT DID NOT. That repair joined the CLIENT scope to
-- the search INDEX: SEARCHABLE_TABLES became a partition derived from the view arms, and
-- verify-searchable-scope-matches-inventory.ts asserts client == live inventory in both directions.
-- It never joined the PHYSICAL tables to the inventory view. A platform can therefore be
-- scaffolded, scraped into, and stay invisible — and because rows in a non-arm table never reach
-- search_listings_ar, every existing guard for this class is blind to it BY CONSTRUCTION. All three
-- start from the same place:
--
--   mon_detect_registry_orphans (limb 3)           from public.search_listings_ar where production_ready
--   mon_detect_search_scope_unreachable_inventory  from public.search_listings_ar where production_ready
--   mon_detect_platform_monitoring_scope_gap       from public.search_listings_ar where production_ready
--
-- A table that is not an arm of active_listing_ids_v2 contributes zero rows to that index, so all
-- three read 0 and stay green forever. The guard and the gap were on the same side of the wall.
-- This adds the one direction nothing asserted: PHYSICAL -> inventory view.
--
-- THE NAMED INSTANCE IS GONE; THE CLASS IS NOT. When #35 was filed, alta_{residential,commercial}
-- _listings and shmoualshmal_{residential,commercial}_listings were in no layer. They have since
-- been launched (registry rows + view arms), and production today is 81 physical tables / 81
-- reachable / 0 orphans. NOTHING IS REPAIRED HERE — there is no wrong data to correct. What is
-- still open is the detection gap that let those four sit unseen, and that is what this closes.
--
-- DETECT-ONLY, DELIBERATELY. Reaching a table into the search chain is a LAUNCH — registry row,
-- view arm, client scope, liveness policy, the four layers of project_awal-revival — and a launch
-- is never something a monitor should perform for itself at 02:29.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. THE PREDICATE. Pure, STABLE, writes nothing, so a barrier can EXECUTE it against an injected
--    candidate instead of grepping this file. AGENTS.md: every one of the five defects of
--    2026-09-04 had a source-TEXT tripwire over the exact line, and two of them pinned the
--    defective line as correct. Same split as mon_orphaned_detectors(): this decides, §2 raises.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_unreachable_listing_tables(
  p_extra_candidates text[] default '{}'::text[]
)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive reach as (
    -- Reachability, not a literal arm list. Walk the inventory view's dependency graph so that
    -- inserting an intermediate view between it and the tables is a refactor, not 81 false
    -- positives. to_regclass (not ::regclass) so a MISSING view yields NULL — and therefore
    -- "nothing is reachable", which §2 reports as one shape failure — instead of an exception.
    select (to_regclass('public.active_listing_ids_v2'))::oid as oid
    union
    select d.refobjid
      from reach r
      join pg_rewrite w on w.ev_class = r.oid
      join pg_depend d on d.objid = w.oid
                      and d.classid = 'pg_rewrite'::regclass
                      and d.refclassid = 'pg_class'::regclass
     where d.refobjid <> r.oid
  ),
  reachable as (
    select c.relname from reach r join pg_class c on c.oid = r.oid
  ),
  candidates as (
    -- relkind 'r' ONLY: a physical table holding real rows. A view or matview named *_listings is
    -- derived and is not the thing that can strand inventory.
    select c.relname as name
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'r'
       and c.relname like '%\_listings'
    union
    -- Injected candidates are judged by EXACTLY the same two tests below, which is what lets the
    -- barrier ask "would you notice a table in no layer?" without scaffolding one in production.
    select x from unnest(coalesce(p_extra_candidates, '{}'::text[])) x
  )
  select coalesce(array_agg(c.name order by c.name), '{}'::text[])
    from candidates c
   where not exists (select 1 from reachable v where v.relname = c.name)
     -- POSITIVE evidence of deliberate scope exit, and only that. status = 'retired' is a decision
     -- someone recorded; a MISSING registry row is silence, and silence never excuses a table.
     -- An empty platform_registry therefore exempts nothing, which is the fail-closed direction.
     and not exists (select 1 from public.platform_registry pr
                      where pr.platform = split_part(c.name, '_', 1)
                        and pr.status = 'retired');
$function$;

comment on function public.mon_unreachable_listing_tables(text[]) is
  'ops_incident #35. Physical public.*_listings tables reachable from NO layer of the search chain: '
  'not an arm of active_listing_ids_v2 (directly or through an intermediate view) and not a '
  'registered-retired platform. p_extra_candidates injects a hypothetical table name through the '
  'identical predicate so the barrier can execute this instead of reading its source.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. THE DETECTOR. Raises; never repairs.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_detect_unreachable_listing_table()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
  v_orphans text[];
  v_live_keys text[] := '{}';
  v_total int;
  v_rows bigint;
  t text;
  k text;
begin
  v_orphans := public.mon_unreachable_listing_tables();

  select count(*) into v_total
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r'
     and c.relname like '%\_listings';

  if v_total = 0 then
    -- FAIL CLOSED. Zero listings tables is not "no orphans"; it is a catalog this detector cannot
    -- believe. Reporting clean here is the dark-detector shape AGENTS.md was burned by.
    k := 'unreachable_listing_table_shape';
    v_live_keys := v_live_keys || k;
    v_n := v_n + public.mon_raise('P1', 'unreachable_listing_table', null, k,
      jsonb_build_object(
        'why', 'There are ZERO physical public.*_listings tables. Every platform table this app '
               || 'serves from has disappeared from the catalog, or this detector is looking at the '
               || 'wrong schema. Either way the orphan question is unjudgeable, not clean.',
        'fix', 'Establish what happened to the platform tables before trusting any search barrier; '
               || 'do not silence this detector to make the sweep green.'));

  elsif cardinality(v_orphans) = v_total and v_total > 1 then
    -- The view reaches NOTHING. That is one fact about active_listing_ids_v2, not v_total
    -- independent scaffolding accidents, and reporting it as v_total alerts would bury it.
    k := 'unreachable_listing_table_shape';
    v_live_keys := v_live_keys || k;
    v_n := v_n + public.mon_raise('P1', 'unreachable_listing_table', null, k,
      jsonb_build_object(
        'physical_tables', v_total,
        'why', format('NONE of the %s physical listings tables is reachable from '
               || 'active_listing_ids_v2. The view is missing, was rebuilt as a stub, or now reaches '
               || 'its tables by a route pg_depend does not follow (dynamic SQL, a foreign table). '
               || 'Search is serving from an inventory view that touches no inventory.', v_total),
        'fix', 'Read pg_get_viewdef(''public.active_listing_ids_v2'') and restore the union arms. If '
               || 'the chain legitimately gained a level this predicate cannot walk, TEACH '
               || 'mon_unreachable_listing_tables() the new route — never relax it to clear the red.'));

  else
    foreach t in array v_orphans loop
      -- Exact count, not reltuples: this loop is empty in the healthy case, so there is no reason
      -- to report an estimate. An injected candidate has no table, hence no count — NULL, never 0.
      if to_regclass('public.' || quote_ident(t)) is null then
        v_rows := null;
      else
        execute format('select count(*) from public.%I', t) into v_rows;
      end if;

      k := 'unreachable_listing_table:' || t;
      v_live_keys := v_live_keys || k;
      v_n := v_n + public.mon_raise(
        case when coalesce(v_rows, 0) > 0 then 'P1' else 'P2' end,
        'unreachable_listing_table', split_part(t, '_', 1), k,
        jsonb_build_object(
          'table', t,
          'platform', split_part(t, '_', 1),
          'rows', v_rows,
          'why', format('%s exists as a physical table but is reachable from NO layer of the search '
                 || 'chain: not an arm of active_listing_ids_v2, and no platform_registry row '
                 || 'retires it. Its %s rows cannot reach search_listings_ar, so every index-driven '
                 || 'barrier (registry_orphans limb 3, search_scope_unreachable, '
                 || 'platform_monitoring_scope_gap) reads 0 for it and stays green — this detector '
                 || 'is the only one that can see it.',
                 t, coalesce(v_rows::text, 'unknown number of')),
          'fix', 'Finish the launch or record the exit. A launch is FOUR layers (project_awal-'
                 || 'revival): platform_registry row, an arm in active_listing_ids_v2, the client '
                 || 'SEARCHABLE_TABLES scope, and a liveness policy. If the platform is genuinely '
                 || 'out of scope, set platform_registry.status = ''retired'' with a note saying why. '
                 || 'Do NOT drop the table to clear this alert — that destroys captured listings.'));
    end loop;
  end if;

  -- Self-heal on the EVALUATED path only: every key this run did not re-raise is no longer true.
  perform public.mon_resolve_stale_keys('unreachable_listing_table', v_live_keys);
  return v_n;
end
$function$;

comment on function public.mon_detect_unreachable_listing_table() is
  'ops_incident #35. DETECT-ONLY. Raises when a physical *_listings table is in no layer of the '
  'search chain. Repairs nothing: reaching a table into search is a four-layer launch.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. ROSTER, IN THIS SAME MIGRATION. AGENTS.md: "a detector outside the roster is decoration", and
--    mon_detect_orphaned_detectors() fires on anything nothing reaches. Guarded needle-edit — read
--    the LIVE body, assert the anchor, splice one name in — so it cannot drop entries it never
--    read, which is how the roster was lost four times before 20260810222259.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
do $do$
declare
  v_def text;
  v_before text;
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
  fn constant text := 'mon_detect_unreachable_listing_table';
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

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. POST-CONDITIONS. Executed, not asserted in prose.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
do $do$
declare
  v_def text;
  v_injected text[];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_unreachable_listing_table''' in v_def) = 0 then
    raise exception 'detector is not in the roster — it would be decoration';
  end if;

  -- The detector must still be able to SEE something. A predicate that returns '{}' for every
  -- possible input is a comment that runs, and that is the state this whole migration exists to
  -- prevent — so prove the positive direction here, at apply time, on production's own catalog.
  v_injected := public.mon_unreachable_listing_tables(
    array['zzz_incident35_postcondition_residential_listings']);
  if not ('zzz_incident35_postcondition_residential_listings' = any(v_injected)) then
    raise exception 'predicate does not report a table in no layer — the barrier is blind';
  end if;

  -- And the negative direction, on real production state: a launched platform is NOT reported.
  if 'alta_residential_listings' = any(public.mon_unreachable_listing_tables()) then
    raise exception 'predicate reports a launched platform as unreachable — it would cry wolf';
  end if;
end $do$;
