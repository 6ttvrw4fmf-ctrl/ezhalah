-- Wire a watchdog that already existed but nobody was listening to.
--
-- public.mon_region_label_as_city has been sitting in the database as a VIEW: rows whose city_ar is
-- the name of one of the 13 catalog REGIONS, yet which carry a concrete city_id. That is the
-- exact-location-only violation the 2026-08-10 audit named — «منطقة الرياض» is an administrative
-- area, never a city, so resolving it to الرياض city fabricates precision the source never gave.
--
-- The view was correct and is currently empty. No detector read it, so if it ever stopped being
-- empty, nothing would have said so. That is the same failure shape as the incident on 2026-08-23:
-- a guard that exists but is not wired to anything decays into decoration. mon_detect_orphaned_
-- detectors() catches a detector nothing reaches; this closes the case of a monitoring VIEW nothing
-- reaches.
--
-- Pairs with the code-side fix in the same batch: to_catalog() was hardened in the 2026-08-10 audit
-- and resolve() on 2026-08-23. This is the data-side proof that both actually hold in production —
-- code review says the rule is written down, this says the rows obey it.

create or replace function public.mon_detect_region_label_as_city()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_rows bigint; n int := 0; sample jsonb;
begin
  select count(*) into v_rows from public.mon_region_label_as_city;

  if v_rows > 0 then
    select jsonb_agg(to_jsonb(x)) into sample
      from (select platform, listing_id, city_field_holds, city_id, production_ready
              from public.mon_region_label_as_city limit 5) x;
    n := public.mon_raise('P1','region_label_as_city','all','region_label_as_city',
      jsonb_build_object('rows', v_rows, 'sample', sample,
        'why','A region label was resolved to a specific city. One of the 13 regions is an '
           || 'administrative area that merely shares a city name, so this invents a precision the '
           || 'source never published and puts listings on the wrong city page. Fix the RESOLVER '
           || '(to_catalog/resolve in scrapers/common/arabic_location.py must strip only the '
           || 'governorate form for a city retry, never the region form) - never patch the row.'));
  else
    perform public.mon_resolve_key('region_label_as_city','region_label_as_city');
  end if;
  return n;
end $$;

do $$
declare src text; newsrc text;
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_region_label_as_city' in src) > 0 then
    raise notice 'already on the roster - no-op'; return;
  end if;
  if position('''mon_detect_rent_period_source_mismatch''' in src) = 0 then
    raise exception 'anchor mon_detect_rent_period_source_mismatch missing from roster';
  end if;
  newsrc := replace(src,
    '''mon_detect_rent_period_source_mismatch''',
    '''mon_detect_rent_period_source_mismatch'',' || chr(10) ||
    '    ''mon_detect_region_label_as_city''');
  execute format(
    'create or replace function public.mon_run_all_detectors() returns jsonb '
    'language plpgsql security definer set search_path to ''public'' as %L', newsrc);
end $$;
