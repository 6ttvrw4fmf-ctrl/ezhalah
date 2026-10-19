-- 🔬 AF engineer 2026-10-08: therc / shomou amenities and arkaan facade from each ad's OWN stored text.
--
-- None of the three sites publishes a structured field for these (therc's capture records
-- «not_published: amenities, furnished»; shomou's article has no amenity row; arkaan's spec cell «الشارع»
-- holds the width only), so the ad's own words are the only statement and prose is lawful — YES or
-- nothing, never «no» (ADVANCED_FILTER_SOURCE_TRUTH §2). The values were computed in CI, read-only over
-- the listings, by the PR-#6434 readers themselves (therc.description_amenities,
-- normalize.prose_amenities_yes, normalize.street_from_prose with the «×» corner-plot guard) over the
-- stored description / source_capture.detail.ad_text, and staged in ops_af_backfill_staging under batch
-- 'af-2026-10-08-prose' (1,646 values; therc 10283466's AC left out by hand: «تمديدات (نحاس) المكيفات
-- جاهزة» is prepared piping, not a fitted unit). Each is written only where the column is NULL, so
-- nothing a source or a crawl already set is overwritten. The old parsers never write these columns, so a
-- crawl before the merge cannot undo it. The served rows are re-derived the way sync_search_listings_ar()
-- maps these columns (a pass-through, direction through its canonical-value CASE).
do $$
declare
  b     constant text := 'af-2026-10-08-prose';
  r     record;
  n     int;
  t_src int := 0;
  t_srv int := 0;
begin
  if (select count(*) from public.ops_af_backfill_staging where batch = b) <> 1646 then
    raise exception 'staging batch % is not the reviewed 1,646 values', b;
  end if;
  if exists (select 1 from public.ops_af_backfill_staging where batch = b and (
        src_table not in ('therc_residential_listings', 'shomou_residential_listings', 'arkaan_residential_listings')
     or col not in ('kitchen','elevator','parking','maid_room','driver_room','air_conditioner','furnished',
                    'laundry_room','balcony_terrace','private_entrance','car_entrance','optical_fibers','direction')
     or (col = 'direction' and val not in ('شمال','جنوب','شرق','غرب'))
     or (col <> 'direction' and val <> 't'))) then
    raise exception 'staging batch % carries a table, column or value outside the reviewed set', b;
  end if;

  for r in select distinct src_table, col from public.ops_af_backfill_staging where batch = b order by 1, 2 loop
    execute format(
      'update public.%I t set %I = %s from public.ops_af_backfill_staging s
        where s.batch = $1 and s.src_table = %L and s.col = %L and t.id = s.listing_id and t.%I is null',
      r.src_table, r.col, case when r.col = 'direction' then 's.val' else 'true' end, r.src_table, r.col, r.col)
    using b;
    get diagnostics n = row_count; t_src := t_src + n;

    if r.col in ('kitchen','elevator','parking','maid_room','driver_room','air_conditioner','private_entrance','furnished') then
      execute format(
        'update public.search_listings_ar ss set %I = t.%I from public.%I t, public.ops_af_backfill_staging s
          where s.batch = $1 and s.src_table = %L and s.col = %L and t.id = s.listing_id
            and ss.source_table = %L and ss.listing_id = t.id and ss.%I is distinct from t.%I',
        r.col, r.col, r.src_table, r.src_table, r.col, r.src_table, r.col, r.col)
      using b;
      get diagnostics n = row_count; t_srv := t_srv + n;
    elsif r.col = 'direction' then
      execute format(
        'update public.search_listings_ar ss set direction_ar = t.direction from public.%I t, public.ops_af_backfill_staging s
          where s.batch = $1 and s.src_table = %L and s.col = ''direction'' and t.id = s.listing_id
            and ss.source_table = %L and ss.listing_id = t.id and ss.direction_ar is distinct from t.direction',
        r.src_table, r.src_table, r.src_table)
      using b;
      get diagnostics n = row_count; t_srv := t_srv + n;
    end if;
  end loop;
  raise notice 'AF prose backfill: % source values, % served values', t_src, t_srv;
end $$;
