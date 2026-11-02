-- Three aqar Hofuf rows whose resolver shadow still names الاحساء (city 3677) while their own neighborhood is a
-- الهفوف district and the search index already serves them as الهفوف (city 12): mon_detect_aqar_proven_wrong_resolution
-- raised them as P1 PROVEN_WRONG and its fix text names exactly this repair. Same values the 1,512 other
-- Hofuf shadow rows carry. Falcon 2026-10-30, backlog 807. Customer-visible state is unchanged.
do $repair$
declare n int;
begin
  update public.aqar_shadow_resolved
     set city_ar_parsed = 'الهفوف', region_ar_parsed = 'المنطقة الشرقية', parsed_city_id = 12
   where src_table = 'aqar_residential_listings' and id in (67479, 69085, 428844)
     and city_ar_parsed = 'الاحساء' and parsed_city_id = 3677 and today_city_id = 12;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'expected 3 stale shadow rows, found %', n; end if;
  insert into public.aqar_resolver_log (run_at, src_table, id, city_id, district_id)
  select now(), 'aqar_residential_listings', x, 12, null from unnest(array[67479, 69085, 428844]::bigint[]) x;
  if exists (select 1 from public.aqar_classify_shadow_drift() where category = 'PROVEN_WRONG' and id in (67479, 69085, 428844)) then
    raise exception 'PROOF: a repaired row still classifies PROVEN_WRONG';
  end if;
end $repair$;
