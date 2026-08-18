-- Data Integrity run #29 follow-up (owner-directed): make the duplicate-place-name rule an
-- INVARIANT, enforced continuously, so it cannot hide in a fourth implementation.
--
-- THE PERMANENT RULE
--   If the source publishes a region, resolve the city WITHIN that region.
--   Never require the city name to be globally unique.
--   If it is still ambiguous inside the published region, return UNKNOWN rather than guessing.
--
-- Run #29 found the same wrong rule in three places at once (resolve_english_city_overlay,
-- listing_native_location_v2's catchall lalc, and — inverted — the district-only inference). All
-- three are fixed; this barrier exists so the fourth one is caught the day it is written.
--
-- Two limbs, because code shape and live behaviour fail independently:
--
--   STRUCTURAL — every object that RESOLVES a canonical city from a name must also consult
--   loc_catalog_region. Search-side consumers (which take city_ids as input and never derive one
--   from a name) are exempt via an explicit allowlist carrying a reason, so the exemption is a
--   reviewed decision rather than a silent gap.
--
--   BEHAVIOURAL — for every listing whose own resolution row carries BOTH a region and a city name
--   that is ambiguous across the catalog, the city actually served must be the one that name
--   resolves to inside that region. This catches a regression even if the code is rearranged into a
--   shape the structural limb does not recognise, and it catches a wrong city that no amount of
--   code reading would reveal.

create table if not exists public.ops_city_resolution_exempt (
  object_name text primary key,
  reason      text not null,
  decided_at  timestamptz not null default now()
);

comment on table public.ops_city_resolution_exempt is
  'Objects allowed to touch loc_catalog_city WITHOUT region scoping, because they consume city_ids '
  'rather than deriving one from a name. Every row is a reviewed exemption from the region-scoped '
  'city-resolution invariant (run #29). Adding a row is a deliberate act; mon_detect_city_resolution_'
  'ignores_region() reads this table and reports anything not listed.';

insert into public.ops_city_resolution_exempt (object_name, reason) values
  ('location_search_candidates_ar',   'search RPC: receives p_cities / city_ids from the client and filters; never derives a canonical city from a name'),
  ('af_eligible_count',               'advanced-filter counter: same scope params as the search RPC, consumes ids'),
  ('apartment_guided_counts_ar',      'guided-flow counter: consumes the caller scope, no name->id resolution'),
  ('property_age_option_counts_ar',   'age-bucket counter: consumes the caller scope, no name->id resolution'),
  ('composite_match_city_ids',        'expands a city name to the SET of matching ids for SEARCH breadth - deliberately many-to-many, never a canonical assignment'),
  ('search_cities_ar',                'city autocomplete: returns candidates for a user to choose between; ambiguity is the point')
on conflict (object_name) do nothing;

create or replace function public.mon_detect_city_resolution_ignores_region()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  structural jsonb;
  struct_n int := 0;
  behav_n int := 0;
  behav_sample jsonb;
begin
  -- ── limb 1: structural ───────────────────────────────────────────────────────────────────────
  with objs as (
    select 'function'::text kind, p.proname name, pg_get_functiondef(p.oid) body
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.prokind = 'f'
    union all
    select 'view', c.relname, pg_get_viewdef(c.oid, true)
      from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
     where n2.nspname = 'public' and c.relkind in ('v','m')
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'object', name) order by name), '[]'::jsonb),
         count(*)
    into structural, struct_n
  from objs o
  where o.body ~* 'loc_catalog_city'
    -- derives a city from a NAME (rather than consuming ids)
    and (o.body ~* 'city_norm' or o.body ~* 'normalize_ar\s*\(\s*[a-z0-9_.]*city')
    and o.body !~* 'loc_catalog_region'
    and o.name not like 'mon\_%'
    and not exists (select 1 from public.ops_city_resolution_exempt e where e.object_name = o.name);

  -- ── limb 2: behavioural ──────────────────────────────────────────────────────────────────────
  -- The resolution row carries a region AND a city name that is ambiguous catalog-wide; the served
  -- city must be the one that name resolves to INSIDE that region.
  with amb as (
    select l.source_table, l.listing_id, l.city_ar, l.region_ar,
           (select cc.city_id
              from public.loc_catalog_city cc
              join public.loc_catalog_region cr on cr.region_id = cc.region_id
             where cc.city_norm = public.normalize_ar(l.city_ar) and cr.region_ar = l.region_ar
             group by cc.city_id having count(*) >= 1 limit 2) as region_city_id
      from public.listings_arabic_locations l
     where l.matched and l.city_ar is not null and l.region_ar is not null
       and (select count(distinct cc.city_id) from public.loc_catalog_city cc
             where cc.city_norm = public.normalize_ar(l.city_ar)) > 1
       and (select count(distinct cc.city_id)
              from public.loc_catalog_city cc
              join public.loc_catalog_region cr on cr.region_id = cc.region_id
             where cc.city_norm = public.normalize_ar(l.city_ar) and cr.region_ar = l.region_ar) = 1
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'source_table', a.source_table, 'listing_id', a.listing_id,
           'resolved_city_ar', a.city_ar, 'published_region', a.region_ar,
           'expected_city_id', a.region_city_id, 'served_city_id', s.city_id) ), '[]'::jsonb)
    into behav_n, behav_sample
  from amb a
  join public.search_listings_ar s
    on s.source_table = a.source_table and s.listing_id = a.listing_id
  where s.city_id is not null and s.city_id is distinct from a.region_city_id;

  if struct_n > 0 or behav_n > 0 then
    n := public.mon_raise('P1', 'city_resolution_ignores_region', 'all', 'city_resolution_ignores_region',
      jsonb_build_object(
        'objects_without_region_scoping', struct_n,
        'objects', structural,
        'listings_served_wrong_city', behav_n,
        'sample', case when behav_n > 0 then behav_sample else '[]'::jsonb end,
        'invariant', 'If the source publishes a region, resolve the city WITHIN that region. Never '
                     'require the city name to be globally unique. If it is still ambiguous inside '
                     'the published region, return UNKNOWN rather than guessing.',
        'why', 'Saudi place names repeat across regions legitimately - «الباحة» exists in منطقة الباحة '
               'and منطقة حائل, «القويعية» in four regions, «الدرعية» twice inside منطقة الرياض alone. '
               'Run #29 found the global-uniqueness rule in three implementations at once; nine live '
               'listings were unreachable by every Filter combination as a result.',
        'do_not', 'Do NOT satisfy this by loosening the unambiguity test. Unique INSIDE the published '
                  'region is a confident match; ambiguous inside it must stay NULL. A search-side '
                  'consumer that never derives a city from a name belongs in ops_city_resolution_exempt '
                  'with a reason, not in a widened regex.'));
  else
    perform public.mon_resolve_key('city_resolution_ignores_region', 'city_resolution_ignores_region');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_city_resolution_ignores_region() is
  'P1, two limbs. STRUCTURAL: any public function/view that derives a canonical city from a NAME '
  'without consulting loc_catalog_region, excluding reviewed entries in ops_city_resolution_exempt. '
  'BEHAVIOURAL: any served listing whose resolution row carries a region and a catalog-ambiguous '
  'city name, yet whose served city_id is not the one that name resolves to inside that region. '
  'Added by run #29 after the same global-uniqueness rule was found in three implementations at '
  'once. The invariant: source publishes a region -> resolve within it; still ambiguous -> UNKNOWN.';

do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_city_resolution_ignores_region''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then raise exception 'mon_run_all_detectors not found - refusing to wire blindly'; end if;
  if position('mon_detect_city_resolution_ignores_region' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1', (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1', before_n, after_n;
  end if;
  if position('mon_detect_city_resolution_ignores_region' in src) = 0
     or position('mon_detect_district_only_city_inference' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;
  execute src;
end
$do$;
