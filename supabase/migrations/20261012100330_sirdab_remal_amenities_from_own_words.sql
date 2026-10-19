-- sirdab and remal: amenities from each ad's OWN words (🔬 AF engineer, 2026-10-12).
-- sirdab's API property object has no field for them (ramps, licences, has_water / has_sewage / has_electricity,
-- security_cameras …), and remal's WordPress post carries no meta and no taxonomy for them, so the ad text is the
-- only statement and prose is lawful — YES or nothing, never «no» (ADVANCED_FILTER_SOURCE_TRUTH §2). Both parsers
-- stored the text and never read it: 115 of 566 active sirdab ads and 34 of 82 remal ads named one and stored
-- NULL. scrapers/sirdab/run.py and scrapers/remal/run.py now read it on every crawl. Values: computed 2026-10-12 by
-- the shared reader scrapers.common.normalize.prose_amenities_yes over the stored description of every active row.
-- Written only where the column is NULL; true only.
do $b$
declare r record; n int; total int := 0;
begin
  for r in select * from (values
    ('air_conditioner', array[13707303,13707314,13707380,13707401,13707576,13707586,13707620,13707711,13707713,13707748,13707751,13707753,13707773,13707807,13707809,13707868,13707901,13707903,13707904]::bigint[]),
    ('balcony_terrace', array[13707356,13707377]::bigint[]),
    ('elevator', array[13707511]::bigint[]),
    ('furnished', array[13707352,13707401,13707489,13707716,13707722,13707730,13707753]::bigint[]),
    ('kitchen', array[13707314,13707355,13707406,13707410,13707451,13707490,13707538,13707565,13707602,13707614,13707618,13707693,13707705,13707737,13707745,13707814,13707826,13707841,13707856,13707868,13707877,13707895,14169454]::bigint[]),
    ('optical_fibers', array[13707347,13707454,13707463,13707717,13707736]::bigint[]),
    ('parking', array[13707303,13707318,13707319,13707355,13707356,13707380,13707390,13707485,13707499,13707510,13707511,13707512,13707531,13707533,13707542,13707573,13707576,13707578,13707586,13707629,13707633,13707670,13707709,13707737,13707759,13707760,13707761,13707762,13707763,13707764,13707765,13707766,13707767,13707768,13707769,13707770,13707771,13707772,13707774,13707777,13707778,13707779,13707808,13707809,13707856,13707886,13707895,13943783]::bigint[]),
    ('private_entrance', array[13707329,13707351,13707354,13707356,13707366,13707368,13707371,13707372,13707373,13707376,13707377,13707378,13707379,13707380,13707385,13707404,13707405,13707435,13707436,13707437,13707438,13707439,13707440,13707441,13707443,13707444,13707446,13707447,13707448,13707454,13707562,13707640,14405434]::bigint[])
  ) v(col, ids) loop
    if r.col not in ('elevator','parking','kitchen','air_conditioner','maid_room','driver_room','private_entrance',
                     'laundry_room','balcony_terrace','car_entrance','optical_fibers','furnished') then
      raise exception 'outside the reviewed set: %', r.col;
    end if;
    execute format('update public.sirdab_commercial_listings set %I = true where %I is null and active and id = any($1)',
                   r.col, r.col) using r.ids;
    get diagnostics n = row_count; total := total + n;
  end loop;
  raise notice 'sirdab prose amenities: % values written', total;
  if total = 0 or total > 138 then raise exception 'backfill out of range: % of 138', total; end if;
end $b$;
do $b$
declare r record; n int; total int := 0;
begin
  for r in select * from (values
    ('air_conditioner', array[10729381]::bigint[]),
    ('driver_room', array[10729368,10729370,10729371,10729375,10729379,10729380,10729395,10729414]::bigint[]),
    ('elevator', array[10729345,10729369,10729370,10729375,10729415]::bigint[]),
    ('furnished', array[10729378,10729381,10729399,10729415]::bigint[]),
    ('kitchen', array[10729366,10729367,10729368,10729369,10729370,10729371,10729372,10729373,10729374,10729375,10729376,10729377,10729379,10729380,10729385,10729395,10729414,10729415,10729417]::bigint[]),
    ('laundry_room', array[10729367,10729371,10729372,10729375,10729414]::bigint[]),
    ('maid_room', array[10729366,10729367,10729368,10729370,10729371,10729372,10729375,10729376,10729378,10729379,10729380,10729414]::bigint[]),
    ('parking', array[10729338,10729339,10729342,10729343,10729345,10729355,10729364,10729368,10729370,10729371,10729375,10729378,10729387,10729395,10729396,10729402,10729410,10729412,10729414,10729415]::bigint[])
  ) v(col, ids) loop
    if r.col not in ('elevator','parking','kitchen','air_conditioner','maid_room','driver_room','private_entrance',
                     'laundry_room','balcony_terrace','car_entrance','optical_fibers','furnished') then
      raise exception 'outside the reviewed set: %', r.col;
    end if;
    execute format('update public.remal_residential_listings set %I = true where %I is null and active and id = any($1)',
                   r.col, r.col) using r.ids;
    get diagnostics n = row_count; total := total + n;
  end loop;
  raise notice 'remal prose amenities: % values written', total;
  if total = 0 or total > 74 then raise exception 'backfill out of range: % of 74', total; end if;
end $b$;