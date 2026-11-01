-- alkhaas and rawasidark: amenities from each ad's OWN words (🔬 AF engineer, 2026-10-12).
-- Neither site publishes a structured amenity field: al-khaas's page is title + area + free text, rawasidark's
-- catalog object is area / city / location / price / streetWidth / title / type / description (every raw key
-- is kept in source_capture). The ad text is therefore the only statement and prose is lawful — YES or
-- nothing, never «no» (ADVANCED_FILTER_SOURCE_TRUTH §2). Both parsers stored the text and never read it, so
-- 98 al-khaas and 36 rawasidark active ads that name a kitchen / AC / parking / room stored NULL and the
-- Advanced Filter never found them (ops_af_score 2026-10-12: alkhaas 0 of 5 findable, rawasidark 0 of 3;
-- source-reread 38229066757 confirmed the ad bodies). The parsers read it from this change on.
-- Values: computed 2026-10-12 by the shared reader scrapers.common.normalize.prose_amenities_yes over the
-- stored description of every active row (220 values). Written only where the column is NULL; true only.
-- The :20 extra-attrs refresh and the :22 sync carry them to search (the sync re-derives on any
-- amenity difference).
do $b$
declare r record; n int; total int := 0;
begin
  for r in select * from (values
    ('alkhaas_residential_listings', 'air_conditioner', array[638742,638743,638746,638747,644982,645673,645677,645687,645692,645714,645720,645727,645783,645784,645802,645806,645828,645829,645830,645831,645834,645835,645836,645838,645839]::bigint[]),
    ('alkhaas_residential_listings', 'driver_room', array[645638,645750,645761,645774]::bigint[]),
    ('alkhaas_residential_listings', 'elevator', array[638745]::bigint[]),
    ('alkhaas_residential_listings', 'kitchen', array[638739,638741,638742,638743,638744,638745,638746,638747,638748,638776,644982,644986,645637,645639,645642,645665,645671,645672,645673,645674,645675,645677,645680,645681,645686,645687,645691,645692,645693,645698,645699,645700,645702,645709,645713,645714,645720,645723,645724,645728,645729,645730,645731,645734,645735,645736,645739,645748,645750,645751,645753,645759,645760,645761,645762,645768,645769,645773,645774,645775,645776,645781,645782,645783,645784,645785,645789,645790,645794,645796,645798,645801,645802,645806,645809,645810,645812,645813,645828,645829,645830,645831,645832,645833,645834,645835,645836,645837,645838,645839]::bigint[]),
    ('alkhaas_residential_listings', 'laundry_room', array[638745,638746,645665,645730,645751,645789,645790,645798]::bigint[]),
    ('alkhaas_residential_listings', 'maid_room', array[645639,645675,645687,645750]::bigint[]),
    ('alkhaas_residential_listings', 'parking', array[638742,638743,638744,638747,644986,645665,645686,645687,645692,645698,645699,645711,645714,645720,645769,645781,645783,645784,645806,645828,645829,645831,645834,645836]::bigint[]),
    ('alkhaas_residential_listings', 'private_entrance', array[644982,645686]::bigint[]),
    ('alkhaas_commercial_listings', 'air_conditioner', array[645757,645807]::bigint[]),
    ('alkhaas_commercial_listings', 'kitchen', array[645656,645657,645758,645807]::bigint[]),
    ('rawasidark_residential_listings', 'air_conditioner', array[10283237]::bigint[]),
    ('rawasidark_residential_listings', 'balcony_terrace', array[10283225,10283233]::bigint[]),
    ('rawasidark_residential_listings', 'driver_room', array[10283244,10283273,10283300]::bigint[]),
    ('rawasidark_residential_listings', 'elevator', array[10283273,10283293,10283299]::bigint[]),
    ('rawasidark_residential_listings', 'kitchen', array[10283224,10283225,10283233,10283237,10283240,10283244,10283245,10283250,10283252,10283253,10283254,10283255,10283256,10283257,10283258,10283259,10283268,10283269,10283274,10283287,10283290,10283292,10283295,10283298,10283299,10283300]::bigint[]),
    ('rawasidark_residential_listings', 'laundry_room', array[10283258]::bigint[]),
    ('rawasidark_residential_listings', 'maid_room', array[10283254]::bigint[]),
    ('rawasidark_residential_listings', 'parking', array[10283237,10283252,10283256,10283292]::bigint[]),
    ('rawasidark_residential_listings', 'private_entrance', array[10283227,10283252,10283256]::bigint[]),
    ('rawasidark_commercial_listings', 'air_conditioner', array[10283304]::bigint[]),
    ('rawasidark_commercial_listings', 'kitchen', array[10283302,10283304,10283313,10283314,10283315,10283316,10283317]::bigint[]),
    ('rawasidark_commercial_listings', 'laundry_room', array[10283313,10283314,10283315,10283316]::bigint[])
  ) v(tbl, col, ids) loop
    if r.tbl not in ('alkhaas_residential_listings','alkhaas_commercial_listings',
                     'rawasidark_residential_listings','rawasidark_commercial_listings')
       or r.col not in ('elevator','parking','kitchen','air_conditioner','maid_room','driver_room','private_entrance',
                        'laundry_room','balcony_terrace','car_entrance','optical_fibers','furnished') then
      raise exception 'outside the reviewed set: %.%', r.tbl, r.col;
    end if;
    execute format('update public.%I set %I = true where %I is null and active and id = any($1)', r.tbl, r.col, r.col)
      using r.ids;
    get diagnostics n = row_count; total := total + n;
  end loop;
  raise notice 'alkhaas and rawasidark prose amenities: % values written', total;
  if total = 0 or total > 220 then raise exception 'backfill out of range: % of 220', total; end if;
end $b$;