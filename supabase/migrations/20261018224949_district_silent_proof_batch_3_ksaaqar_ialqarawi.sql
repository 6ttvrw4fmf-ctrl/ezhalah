-- PROVEN-SILENT DISTRICT PROOF ROWS, batch 3 (2026-10-18): ksaaqar and ialqarawi, after today's parser fixes and re-reads.
-- ksaaqar (#7553, re-read by small-sources-sync 39153551841, 18:18 UTC): the page's own «الموقع:» box — the pin label,
-- now read whole — names only the city or the country («الرياض», «جدة السعودية», «المملكة العربية السعودية»), and the
-- ad's title and description carry no «حي». The label's other shapes (a road, a town, another city) are NOT here.
-- ialqarawi (#7546, re-read by 39150476373, 17:38 UTC): the ad's own «الحي» field holds the ad's CITY («الحي: الرياض»
-- on an ad in الرياض), and the title and description carry no «حي». Rows whose «الحي» names a district, a different
-- town, or whose title says «بحي …» are NOT here. Rows are excused per listing; a new blank row is not.
set local lock_timeout = '5s';

insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof, decided_by)
select 'ksaaqar', k.tbl, k.id,
       'ksaaqar: the pin label names only the city or the country, and the ad names no «حي»',
       'ad page: the «الموقع:» box (<h4>الموقع:</h4><p>…</p>, the pin label in full), the title, the description',
       '2026-10-18 re-read (run 39153551841): label «' || (k.ai->>'map_line') || '» on an ad filed under ' || k.city_ar
         || '; no «حي» in the title or the description',
       'district engineer 2026-10-18 (page read)'
  from (select 'ksaaqar_residential_listings' tbl, id, city_ar, district_ar, neighborhood, additional_info ai, title, description, active
          from public.ksaaqar_residential_listings
        union all
        select 'ksaaqar_commercial_listings', id, city_ar, district_ar, neighborhood, additional_info, title, description, active
          from public.ksaaqar_commercial_listings) k
 where k.active and coalesce(k.district_ar, '') = '' and coalesce(k.neighborhood, '') = ''
   and k.ai->>'district_source' = 'map_line'
   and btrim(regexp_replace(regexp_replace(k.ai->>'map_line',
         '(المملكة العربية السعودية|السعودية|عقارات|محافظة|مدينة|منطقة|'
           || regexp_replace(k.city_ar, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || ')', ' ', 'g'), '[\s,،\-]+', ' ', 'g')) = ''
   and coalesce(k.title, '') || ' ' || coalesce(k.description, '') !~ '(^|[^ء-ي])(ب|و|ل)?(حي|الحي)\s'
   and not public.district_blank_is_excused('ksaaqar', k.tbl, k.id);

insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof, decided_by)
select 'ialqarawi', q.tbl, q.id,
       'ialqarawi: the ad''s «الحي» field holds its city, and the ad names no «حي»',
       'ad page: the «الحي» field of the details table, the title, the description',
       '2026-10-18 re-read (run 39150476373): «الحي: ' || (q.ai->>'district_field_raw') || '» on an ad in ' || q.city_ar
         || '; no «حي» in the title or the description',
       'district engineer 2026-10-18 (page read)'
  from (select 'ialqarawi_residential_listings' tbl, id, city_ar, district_ar, neighborhood, additional_info ai, title, description, active
          from public.ialqarawi_residential_listings
        union all
        select 'ialqarawi_commercial_listings', id, city_ar, district_ar, neighborhood, additional_info, title, description, active
          from public.ialqarawi_commercial_listings) q
 where q.active and coalesce(q.district_ar, '') = '' and coalesce(q.neighborhood, '') = ''
   and normalize_ar(q.ai->>'district_field_raw') = normalize_ar(q.city_ar)
   and coalesce(q.title, '') || ' ' || coalesce(q.description, '') !~ '(^|[^ء-ي])(ب|و|ل)?(حي|الحي)\s'
   and not public.district_blank_is_excused('ialqarawi', q.tbl, q.id);
