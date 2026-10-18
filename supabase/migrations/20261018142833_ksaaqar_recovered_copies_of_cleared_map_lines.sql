-- 2026-10-18. Companion of 20261018125140 (ksaaqar `neighborhood` holds only a stated district): the recovered copies.
--
-- The repair cleared 165 ksaaqar neighborhoods that were the map line's title/category/country text, but the served
-- index kept showing them: public.district_recovery still held the copies made at 12:20, and every refill since
-- (13:10, 13:20, 14:10, 14:20) refused to replace them — its loss guard saw «118 of 152 recovered districts would be
-- lost» and kept the previous rows (location_pipeline_alerts district_recovery_shrank). The guard is right to stop an
-- accidental loss; this one is deliberate. Removed here: exactly the ksaaqar recovery rows whose source no longer
-- states any word (neighborhood NULL, no fleet source district, no listing_source_district_ar row) — 118 rows, 21 of
-- them obvious non-districts («المملكة العربية السعودية», «عقارات جدة», «شقه ايجار في الرياض 1», «القاهرة طريق
-- الواحات مح»). The next refill then has nothing to lose and runs; the served district of these rows goes NULL until
-- the page states one.
set local lock_timeout = '5s';

do $$
declare n int; v_left int;
begin
  delete from public.district_recovery dr
   using (select 'ksaaqar_residential_listings'::text as st, id, neighborhood from public.ksaaqar_residential_listings
          union all
          select 'ksaaqar_commercial_listings', id, neighborhood from public.ksaaqar_commercial_listings) k
   where k.st = dr.source_table and k.id = dr.listing_id
     and k.neighborhood is null
     and not exists (select 1 from public.listing_source_district_ar_fleet f
                      where f.source_table = dr.source_table and f.listing_id = dr.listing_id)
     and not exists (select 1 from public.listing_source_district_ar sd
                      where sd.source_table = dr.source_table and sd.listing_id = dr.listing_id);
  get diagnostics n = row_count;
  if n not between 100 and 140 then raise exception 'PROOF: expected ~118 stale ksaaqar recovery rows, deleted %', n; end if;

  -- PROOF: every ksaaqar recovery row left has a word at its source.
  select count(*) into v_left
    from public.district_recovery dr
    join (select 'ksaaqar_residential_listings'::text as st, id, neighborhood from public.ksaaqar_residential_listings
          union all
          select 'ksaaqar_commercial_listings', id, neighborhood from public.ksaaqar_commercial_listings) k
      on k.st = dr.source_table and k.id = dr.listing_id
   where k.neighborhood is null
     and not exists (select 1 from public.listing_source_district_ar_fleet f
                      where f.source_table = dr.source_table and f.listing_id = dr.listing_id)
     and not exists (select 1 from public.listing_source_district_ar sd
                      where sd.source_table = dr.source_table and sd.listing_id = dr.listing_id);
  if v_left <> 0 then raise exception 'PROOF: % stale ksaaqar recovery rows left', v_left; end if;
  raise notice 'removed % stale ksaaqar district_recovery rows', n;
end $$;
