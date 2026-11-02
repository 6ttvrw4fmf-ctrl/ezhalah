-- 🦅 Falcon 2026-10-23: a served district never carries the text of an ad's REGA block.
--
-- Found today: three Haraj rows served «الملك فهد صاحب الترخيص : <office> تاريخ انتهاء رخصة الإعلان : 2026-12-31» and two
-- siblings as their district_ar (the licence holder's name and an expiry date inside a location name; the companion repair
-- touched exactly those 3 rows). The parser fix of 2026-10-22 stops NEW rows, but nothing watched the served index, so
-- rows written before it sat in the district list for days. This watches OUR served claim, for every platform: a
-- production_ready district_ar that contains a REGA block label or a colon. P2, hourly (0.4 s measured on the live index).
-- Never fix by blanking a district: re-read the ad's own deed line and store the word it names.

create or replace function public.mon_detect_district_carries_ad_block_text()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; v_open boolean; r int := 0;
begin
  select coalesce(sum(n), 0), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'rows', n) order by n desc), '[]'::jsonb)
    into v_rows, v_by
    from (select platform, count(*) n from public.search_listings_ar
           where production_ready
             and district_ar ~ '(صاحب الترخيص|تاريخ انتهاء|رخصة الإعلان|عمولة نقل|الموظف المسؤول|رقم جوال|غرض الإعلان|:)'
           group by platform) z;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'district_carries_ad_block_text' and resolved_at is null);
  if v_rows = 0 then
    if v_open then perform public.mon_resolve('district_carries_ad_block_text', 'location'); end if;
  elsif not v_open then
    r := public.mon_raise('P2', 'district_carries_ad_block_text', 'location', 'district_carries_ad_block_text',
      jsonb_build_object('rows', v_rows, 'per_platform', v_by,
        'examples', (select jsonb_agg(jsonb_build_object('source_table', s.source_table, 'listing_id', s.listing_id))
                       from (select source_table, listing_id from public.search_listings_ar
                              where production_ready
                                and district_ar ~ '(صاحب الترخيص|تاريخ انتهاء|رخصة الإعلان|عمولة نقل|الموظف المسؤول|رقم جوال|غرض الإعلان|:)'
                              limit 10) s),
        'why', 'A served district carries text from the ad''s REGA licence or deed block (a label, a colon, a licence holder, an expiry). It shows in the district list and can carry an advertiser name. Re-read the ad''s own deed «الحي:» line and store that word; check the platform parser splits glued labels (haraj: _GLUED_LABEL). Never blank the district.'));
  end if;
  return r;
end $function$;

-- Roster (an unrostered detector is decoration).
do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_district_carries_ad_block_text''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_district_carries_ad_block_text'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_district_carries_ad_block_text''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF: a planted glued district on one served row is counted, inside a rolled-back sub-transaction.
do $proof$
declare base bigint; planted bigint; t text; lid bigint;
begin
  base := (select count(*) from public.search_listings_ar where production_ready
            and district_ar ~ '(صاحب الترخيص|تاريخ انتهاء|رخصة الإعلان|عمولة نقل|الموظف المسؤول|رقم جوال|غرض الإعلان|:)');
  select source_table, listing_id into t, lid from public.search_listings_ar
   where production_ready and district_ar is not null
     and district_ar !~ '(صاحب الترخيص|تاريخ انتهاء|رخصة الإعلان|عمولة نقل|الموظف المسؤول|رقم جوال|غرض الإعلان|:)' limit 1;
  if lid is null then raise exception 'PROOF: no served row to plant on'; end if;
  begin
    update public.search_listings_ar set district_ar = district_ar || ' صاحب الترخيص : مكتب تاريخ انتهاء رخصة الإعلان : 2026-12-08'
     where source_table = t and listing_id = lid;
    planted := (select count(*) from public.search_listings_ar where production_ready
                 and district_ar ~ '(صاحب الترخيص|تاريخ انتهاء|رخصة الإعلان|عمولة نقل|الموظف المسؤول|رقم جوال|غرض الإعلان|:)');
    if planted <> base + 1 then raise exception 'PROOF: the planted glued district was not counted (% vs %)', planted, base; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_district_carries_ad_block_text') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: % served now (the index follows the repair at the next sync); a planted one is caught; rostered', base;
end $proof$;
