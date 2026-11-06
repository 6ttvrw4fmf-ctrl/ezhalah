-- 🦅 falcon 2026-11-06: a stored REGA ad licence reaches the card on every site.
--
-- The card's «رقم رخصة الإعلان» row reads additional_info.rega_ad_license_number (src/data/remote.ts ADDL_FIELDS).
-- Measured 2026-11-06 ~20:10 UTC: ~37,000 ACTIVE ads on ~45 sites store the licence only in license_number, so no card
-- shows it (muhaysini 20,371 + 583, tuba 3,131 + 113, sakani 1,962 + 85, wahadat 1,092, manzo 1,084, aqar 966 + 51,
-- reinvest 694 + 271, abaad 469 …). The fleet-wide form of the owner's 11-04 Property Finder finding, which
-- 20261104214154 fixed for one site. Every stored value on the big sites is the 10-digit REGA ad-licence shape.
--
-- 1. mon_detect_licence_not_on_card(): every listing table with license_number + additional_info + active; an
--    active row whose 10-digit licence is missing from the card key raises P2 licence_not_on_card:<table>; a clean
--    table resolves its key. Daily (ops_detector_last_full_run, 20 h): it reads every listing table. On the roster.
-- 2. Backfill: the same value, verbatim, into the card key, table by table (each under 25,000 rows). The writer
--    fix that keeps it true on every crawl is scrapers/common/db.py _licence_on_card (PR 10917).
-- 3. PROOF at apply: no active row is left missing, and a planted miss is caught then rolled back.

create or replace function public.mon_detect_licence_not_on_card()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; r record; v_lic bigint; v_miss bigint; live text[] := '{}';
begin
  if exists (select 1 from public.ops_detector_last_full_run
              where detector = 'licence_not_on_card' and last_run_at > now() - interval '20 hours') then
    return 0;
  end if;
  for r in
    select c.table_name t
      from information_schema.columns c
      join information_schema.tables tt on tt.table_schema = 'public' and tt.table_name = c.table_name
                                       and tt.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'license_number' and c.table_name like '%\_listings'
       and exists (select 1 from information_schema.columns d where d.table_schema = 'public'
                     and d.table_name = c.table_name and d.column_name = 'additional_info')
       and exists (select 1 from information_schema.columns e where e.table_schema = 'public'
                     and e.table_name = c.table_name and e.column_name = 'active')
  loop
    execute format(
      'select count(*) filter (where btrim(license_number::text) ~ %L),
              count(*) filter (where btrim(license_number::text) ~ %L
                                 and nullif(btrim(additional_info->>%L), %L) is null)
         from public.%I where active',
      '^[0-9]{10}$', '^[0-9]{10}$', 'rega_ad_license_number', '', r.t) into v_lic, v_miss;
    if v_miss > 0 then
      live := live || ('licence_not_on_card:' || r.t);
      n := n + public.mon_raise('P2', 'licence_not_on_card', split_part(r.t, '_', 1), 'licence_not_on_card:' || r.t,
        jsonb_build_object('table', r.t, 'active_with_licence', v_lic, 'missing_on_card', v_miss,
          'why', 'Active ads store a 10-digit REGA ad licence in license_number but the card reads '
              || 'additional_info.rega_ad_license_number, so the customer sees no «رقم رخصة الإعلان». '
              || 'scrapers/common/db.py _licence_on_card copies it on every upsert that writes additional_info: '
              || 'find the scraper path that writes license_number without additional_info, or a crawl that has not '
              || 'run since the writer fix.'));
    end if;
  end loop;
  perform public.mon_resolve_stale_keys('licence_not_on_card', live);
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
  select 'licence_not_on_card', now(), n
   where not exists (select 1 from public.ops_detector_last_full_run where detector = 'licence_not_on_card');
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n
   where detector = 'licence_not_on_card';
  return n;
end
$function$;

revoke execute on function public.mon_detect_licence_not_on_card() from public, anon, authenticated;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_licence_not_on_card' in src) > 0 then
    raise notice 'mon_detect_licence_not_on_card already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aqar_price_over_authoritative_absent'',',
    E'    ''mon_detect_aqar_price_over_authoritative_absent'',\n    ''mon_detect_licence_not_on_card'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Backfill, table by table: the stored licence, verbatim, into the card key.
do $$
declare r record; v int; total int := 0;
begin
  for r in
    select c.table_name t
      from information_schema.columns c
      join information_schema.tables tt on tt.table_schema = 'public' and tt.table_name = c.table_name
                                       and tt.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'license_number' and c.table_name like '%\_listings'
       and exists (select 1 from information_schema.columns d where d.table_schema = 'public'
                     and d.table_name = c.table_name and d.column_name = 'additional_info')
       and exists (select 1 from information_schema.columns e where e.table_schema = 'public'
                     and e.table_name = c.table_name and e.column_name = 'active')
  loop
    execute format(
      'update public.%I
          set additional_info = coalesce(additional_info, %L::jsonb)
                                || jsonb_build_object(%L, btrim(license_number::text))
        where active and btrim(license_number::text) ~ %L
          and nullif(btrim(additional_info->>%L), %L) is null',
      r.t, '{}', 'rega_ad_license_number', '^[0-9]{10}$', 'rega_ad_license_number', '') ;
    get diagnostics v = row_count;
    if v > 25000 then raise exception '% would change % rows, over the 25,000 batch rule', r.t, v; end if;
    total := total + v;
  end loop;
  raise notice 'licence copied onto the card key for % active rows', total;
end $$;

-- PROOF: nothing left missing; a planted miss is caught, then rolled back.
do $$
declare v_hit int; v_id bigint;
begin
  delete from public.ops_detector_last_full_run where detector = 'licence_not_on_card';
  perform public.mon_detect_licence_not_on_card();
  if exists (select 1 from public.alert_event where kind = 'licence_not_on_card' and resolved_at is null) then
    raise exception 'PROOF: active rows still miss the card licence after the backfill';
  end if;
  begin
    select id into v_id from public.tuba_residential_listings where active and license_number ~ '^[0-9]{10}$' limit 1;
    update public.tuba_residential_listings set additional_info = additional_info - 'rega_ad_license_number' where id = v_id;
    delete from public.ops_detector_last_full_run where detector = 'licence_not_on_card';
    perform public.mon_detect_licence_not_on_card();
    select count(*) into v_hit from public.alert_event
     where dedup_key = 'licence_not_on_card:tuba_residential_listings' and resolved_at is null;
    if v_hit = 0 then raise exception 'PROOF: a planted missing licence was not caught'; end if;
    raise exception '__licence_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__licence_selftest_rollback__' then raise; end if;
  end;
  if position('mon_detect_licence_not_on_card' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
end $$;
