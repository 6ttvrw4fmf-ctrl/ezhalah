-- 2026-11-04 (🔧): three coverage detectors learn the platform registry. Property Finder is STAGED behind the
-- owner's launch switch (platform_registry.status = 'retired' with the STAGED note; PR #10464 flips it): its
-- 4,519 rows sit in tables no search arm reads BY DECISION. detect_novel_property_types raised
-- INVARIANT:unsynced_table on both tables (alerts 13054/13055, P1) and mon_detect_commercial_coverage_blind_spot
-- raised on the commercial one (13060, P1) at 12:59 — a detector that fires on a state an engineer chose on
-- purpose is noise that hides the real alerts (QUALITY_REPAIR_ENGINEER.md lesson 2026-10-07 / 2026-11-03 ③).
-- Edited IN PLACE with a needle that must exist exactly once (lesson 2026-10-30): no retyping of 400-line bodies.

-- (1) detect_novel_property_types: the SOURCE_TABLE coverage loop skips tables of a non-active platform.
do $mig$
declare src text; n int;
  needle constant text := 'where not exists (select 1 from public.search_listings_ar l where l.source_table = s.tbl)';
  patch  constant text := 'where not exists (select 1 from public.search_listings_ar l where l.source_table = s.tbl)
      -- 2026-11-04: a platform the registry holds as dormant/retired (propertyfinder is STAGED behind the
      -- owner''s launch switch) reaches search by decision, not by accident: it is not a half-added platform.
      and not exists (select 1 from public.platform_registry pr
                       where pr.status <> ''active'' and s.tbl like pr.platform || ''\_%'')';
begin
  src := pg_get_functiondef('public.detect_novel_property_types'::regproc);
  n := (select count(*) from regexp_matches(src, regexp_replace(needle, '([().*+?\[\]\\])', '\\\1', 'g'), 'g'));
  if n <> 1 then raise exception 'detect_novel_property_types: needle found % times, expected 1', n; end if;
  execute replace(src, needle, patch);
end $mig$;

-- (2) mon_detect_legacy_alert_tables (a0): an unsynced_table invariant on a non-active platform self-resolves.
do $mig$
declare src text; n int;
  needle constant text := 'if coalesce(v_active,0) = 0 or v_synced > 0 then';
  patch  constant text := 'if coalesce(v_active,0) = 0 or v_synced > 0
           or exists (select 1 from public.platform_registry pr   -- 2026-11-04: staged/dormant/retired platform
                       where pr.status <> ''active'' and v_tbl like pr.platform || ''\_%'') then';
begin
  src := pg_get_functiondef('public.mon_detect_legacy_alert_tables'::regproc);
  n := (select count(*) from regexp_matches(src, regexp_replace(needle, '([().*+?\[\]\\])', '\\\1', 'g'), 'g'));
  if n <> 1 then raise exception 'mon_detect_legacy_alert_tables: needle found % times, expected 1', n; end if;
  execute replace(src, needle, patch);
end $mig$;

-- (3) mon_detect_commercial_coverage_blind_spot: same rule (small body, re-created whole).
create or replace function public.mon_detect_commercial_coverage_blind_spot()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; r record; v_active bigint; v_search bigint; live text[] := '{}';
begin
  if not public.mon_claim_daily_slot('commercial_coverage_blind_spot') then return 0; end if;
  for r in
    select c.table_name
    from information_schema.tables c
    where c.table_schema = 'public' and c.table_name like '%\_commercial\_listings'
      -- 2026-11-04: a platform the registry holds as dormant/retired (propertyfinder is STAGED behind the
      -- owner's launch switch) is kept out of search by decision; it is not a blind spot.
      and not exists (select 1 from public.platform_registry pr
                       where pr.status <> 'active' and c.table_name like pr.platform || '\_%')
  loop
    execute format('select count(*) from public.%I where active', r.table_name) into v_active;
    select count(*) into v_search from public.search_listings_ar s where s.source_table = r.table_name;
    if v_active > 50 and v_search = 0 then
      live := live || ('commercial_coverage_blind_spot:' || r.table_name);
      n := n + public.mon_raise('P1', 'commercial_coverage_blind_spot',
        replace(r.table_name, '_commercial_listings', ''),
        'commercial_coverage_blind_spot:' || r.table_name,
        jsonb_build_object('table', r.table_name, 'active_rows', v_active, 'rows_in_search', v_search,
          'note', 'A whole commercial table holds active inventory but reaches search with nothing. '
               || 'Also re-check that every fidelity barrier spans BOTH the residential and the '
               || 'commercial table for this platform — a residential-only JOIN hides half a platform.'));
    end if;
  end loop;
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'commercial_coverage_blind_spot';
  perform public.mon_resolve_stale_keys('commercial_coverage_blind_spot', live);
  return n;
end $function$;

-- Both directions, on the real registry: the staged platform is excused, an active one is not.
do $mig$
begin
  if not exists (select 1 from public.platform_registry pr
                  where pr.status <> 'active' and 'propertyfinder_commercial_listings' like pr.platform || '\_%') then
    raise exception 'propertyfinder is not non-active in platform_registry — the rule would not excuse it';
  end if;
  if exists (select 1 from public.platform_registry pr
              where pr.status <> 'active' and 'aqar_commercial_listings' like pr.platform || '\_%') then
    raise exception 'aqar reads as non-active — the rule would excuse a live platform';
  end if;
  if position('pr.status <> ''active''' in pg_get_functiondef('public.detect_novel_property_types'::regproc)) = 0
     or position('pr.status <> ''active''' in pg_get_functiondef('public.mon_detect_legacy_alert_tables'::regproc)) = 0 then
    raise exception 'in-place edit did not land';
  end if;
end $mig$;

-- The blind-spot detector is daily-gated (mon_claim_daily_slot), so its stale key would sit a day: close it now
-- with the rule's own evidence. The two legacy_novel_type keys close by their resolver (a0) at the next sweep.
select public.mon_resolve_key('commercial_coverage_blind_spot', 'commercial_coverage_blind_spot:propertyfinder_commercial_listings');