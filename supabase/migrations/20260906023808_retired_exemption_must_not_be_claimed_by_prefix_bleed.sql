-- ops_incident #35, follow-up — THE RETIRED-PLATFORM EXEMPTION COULD BE CLAIMED BY PREFIX BLEED.
--
-- Found by mutating the detector shipped minutes earlier in
-- 20260906023450_a_listings_table_in_no_layer_of_the_search_chain. That version derived the
-- platform with split_part(name, '_', 1), so the FIRST underscore-delimited token decided whether a
-- table could claim the "registered-retired, deliberately out of scope" exemption. Measured against
-- production's own registry (deal, toor and alnokhba are status = 'retired'):
--
--   mon_unreachable_listing_tables(array[
--     'deal_special_residential_listings',   -- split_part -> 'deal'  : EXEMPTED, wrongly
--     'toor_x_commercial_listings',          -- split_part -> 'toor'  : EXEMPTED, wrongly
--     'brandnew_residential_listings'])      --                        reported, correctly
--   => {brandnew_residential_listings}
--
-- Two of the three vanished. That is a FALSE NEGATIVE in the exact detector whose whole purpose is
-- that this class hides silently — the one direction a detector may never fail. Every platform slug
-- in production today is a single token ([a-z0-9]+), so nothing is mis-judged right now; this closes
-- the path before a slug with an underscore in it makes the hole real.
--
-- THE FIX: strip the KNOWN suffix instead of guessing at the first token. A name that does not have
-- that suffix falls through unchanged, matches no platform_registry row, and is therefore REPORTED
-- rather than exempted — the exemption can only be claimed by positive evidence, never by an
-- accident of tokenisation. Same reason the exemption already required status = 'retired' and not
-- merely the presence of a row: silence never excuses a table.

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
    -- "nothing is reachable", which the detector reports as one shape failure, not an exception.
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
     -- POSITIVE evidence of deliberate scope exit, and only that. Strip the known suffix rather
     -- than taking the first token: 'deal_special_residential_listings' must NOT be able to claim
     -- retired 'deal'. A name without the suffix falls through whole, matches no row, and is
     -- reported — an empty or unmatched registry exempts nothing, which is the fail-closed way.
     and not exists (select 1 from public.platform_registry pr
                      where pr.platform = regexp_replace(c.name, '_(residential|commercial)_listings$', '')
                        and pr.status = 'retired');
$function$;

comment on function public.mon_unreachable_listing_tables(text[]) is
  'ops_incident #35. Physical public.*_listings tables reachable from NO layer of the search chain: '
  'not an arm of active_listing_ids_v2 (directly or through an intermediate view) and not a '
  'registered-retired platform. The retired exemption strips the known _(residential|commercial)'
  '_listings suffix, never the first token, so a prefix cannot borrow another platform''s '
  'retirement. p_extra_candidates injects a hypothetical table name through the identical '
  'predicate so the barrier can execute this instead of reading its source.';

-- The detector labelled its alert with the same first-token guess, so an underscored slug would
-- have been reported against the WRONG platform. One derivation, used by both.
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
  v_platform text;
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

      v_platform := regexp_replace(t, '_(residential|commercial)_listings$', '');
      k := 'unreachable_listing_table:' || t;
      v_live_keys := v_live_keys || k;
      v_n := v_n + public.mon_raise(
        case when coalesce(v_rows, 0) > 0 then 'P1' else 'P2' end,
        'unreachable_listing_table', v_platform, k,
        jsonb_build_object(
          'table', t,
          'platform', v_platform,
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

-- POST-CONDITIONS — both directions, executed against production's own catalog and registry.
do $do$
declare
  v_reported text[];
begin
  -- The bleed is closed: a name whose first token is a retired platform is still REPORTED.
  v_reported := public.mon_unreachable_listing_tables(
    array['deal_special_residential_listings', 'toor_x_commercial_listings',
          'brandnew_residential_listings']);
  if not ('deal_special_residential_listings' = any(v_reported)) then
    raise exception 'prefix bleed still open: deal_special_* borrowed retired deal''s exemption';
  end if;
  if not ('toor_x_commercial_listings' = any(v_reported)) then
    raise exception 'prefix bleed still open: toor_x_* borrowed retired toor''s exemption';
  end if;
  if not ('brandnew_residential_listings' = any(v_reported)) then
    raise exception 'predicate no longer reports an unknown table — the barrier is blind';
  end if;

  -- The exemption still WORKS for the case it exists for: an exact retired slug.
  if 'deal_residential_listings' = any(
       public.mon_unreachable_listing_tables(array['deal_residential_listings'])) then
    raise exception 'the retired exemption is gone — a deliberately retired platform would cry wolf';
  end if;

  -- And production itself is still clean: no real table is reported.
  if cardinality(public.mon_unreachable_listing_tables()) <> 0 then
    raise exception 'production now reports unreachable tables: %',
      array_to_string(public.mon_unreachable_listing_tables(), ', ');
  end if;
end $do$;
