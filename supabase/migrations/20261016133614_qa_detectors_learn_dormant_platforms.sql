-- 🔧 Quality & Repair 2026-10-16: three monitors read the registry's DELIBERATE dormant state as an
-- unexplained defect. listing_native_location_v2 sets production_ready = false for every row of a
-- platform whose platform_registry.status = 'dormant' (owner down-rule: the SOURCE is down, its cards
-- would send a customer to a dead page). Measured 13:30 UTC: mon_detect_orphaned_search_row counted
-- 12,454 rows (dwelleo 12,329, sadin 83, nafithh 27, aqaralsaudia 16 — all dormant — plus 12 real ones:
-- dealapp 3, aqar 3, wasalt 2, muhaysini 2, aqarmonthly 1, aqarcity 1); audit_location_counts() reported
-- 12,455 «unexplained» not-ready rows, so audit-invariants.yml has been red on every run since 10-07;
-- and mon_detect_sync_pass_left_rows_unindexed held nafithh 13605342 as «stuck» for 9,660 minutes
-- (that third caller is patched in the companion migration qa_sync_unindexed_detector_learns_dormant).
-- A detector that fires on a state an engineer chose on purpose is noise that hides the real alerts
-- (QA lesson 2026-10-07): teach it the registry, prove both directions. One predicate, three callers;
-- nothing is loosened: a not-ready row of an ACTIVE platform still counts exactly as before.

create or replace function public.ops_platform_is_dormant(p_platform text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (select 1 from public.platform_registry pr
                  where pr.platform = p_platform and pr.status = 'dormant');
$$;

comment on function public.ops_platform_is_dormant(text) is
  '🔧 2026-10-16: true when platform_registry marks the platform dormant (the owner down-rule). listing_native_location_v2 clears production_ready for those rows on purpose, so a monitor that counts not-ready rows must exclude them or it reports a decision as a defect.';

-- 1. orphaned_search_row: a dormant platform's rows are held out of search on purpose.
create or replace function public.mon_detect_orphaned_search_row()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; cnt int; sample jsonb;
begin
  select count(*) into cnt
    from public.search_listings_ar s
   where not s.production_ready
     and s.region_id is not null
     and s.city_id  is not null
     and not public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
     and not public.ops_platform_is_dormant(s.platform);

  if coalesce(cnt, 0) > 0 then
    select jsonb_agg(x) into sample from (
      select s.source_table, s.listing_id, s.platform, s.city_ar, s.deal_ar, s.type_ar
        from public.search_listings_ar s
       where not s.production_ready
         and s.region_id is not null
         and s.city_id  is not null
         and not public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
         and not public.ops_platform_is_dormant(s.platform)
       order by s.source_table, s.listing_id
       limit 20) x;

    n := public.mon_raise('P1', 'orphaned_search_row', 'all', 'orphaned_search_row',
      jsonb_build_object(
        'count', cnt,
        'sample', sample,
        'why', 'Rows in search_listings_ar with a COMPLETE canonical location (region_id and city_id both set) but production_ready=false. They fail both branches of location_search_candidates_ar — the unlocated fallback admits only rows whose region_id or city_id IS NULL — so NO filter combination returns them, yet they still count as searchable in table-vs-index parity. The price/size-gate cohort and the rows of DORMANT platforms (platform_registry.status = dormant, held out of search on purpose) are deliberately excluded from this count, so a non-zero value here is a NEW cause. Find why production_ready was cleared on a fully located row; do NOT fix it by flipping production_ready without establishing that cause.'));
  else
    perform public.mon_resolve_key('orphaned_search_row', 'orphaned_search_row');
  end if;

  return n;
end
$function$;

-- 2. audit_location_counts: «dormant» becomes a KNOWN reason bucket; the unexplained count keeps
--    its meaning (a not-ready row with a resolved city and no known reason).
create or replace function public.audit_location_counts()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_total bigint; v_unexplained bigint; v_dormant bigint; v_drift bigint;
begin
  set local statement_timeout = '180s';
  select count(*),
         count(*) filter (where city_id is not null and city_ar is not null and btrim(city_ar) <> ''
                            and not public.ops_platform_is_dormant(platform)),
         count(*) filter (where public.ops_platform_is_dormant(platform))
    into v_total, v_unexplained, v_dormant
    from listing_native_location_v2
   where production_ready = false;
  select count(*) into v_drift from mon_search_index_city_drift;
  return jsonb_build_object(
    'not_ready_total',       v_total,
    'not_ready_unexplained', v_unexplained,
    'not_ready_dormant',     v_dormant,
    'search_index_drift',    v_drift);
end
$function$;

-- Proof, both directions, is run as a SELECT right after apply (the connector holds a DO block for a
-- human and times out, QA lesson 2026-10-10/10-13): ops_platform_is_dormant(<a dormant registry row>) = true,
-- (<an active row>) = false, ('__no_such_platform__') = false; mon_detect_orphaned_search_row's count 12,454 → 12.