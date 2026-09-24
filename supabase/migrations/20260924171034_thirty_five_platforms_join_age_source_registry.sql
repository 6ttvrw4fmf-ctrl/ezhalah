-- Twenty-two of the thirty-five platforms join age_source_registry — the ONLY way an age reaches
-- the Advanced Filter.
--
-- listing_native_location_v2 takes property_age from listing_age_resolved, NOT from
-- listing_extra_attrs, and rebuild_age_producer() (pg_cron 46, hourly at :44) regenerates that view
-- from THIS registry alone (the akariyoun lesson, 20260919014424: a hand-added arm is wiped within the
-- hour). Without these rows every age the scrapers write stays NULL in search_listings_ar.
--
-- ONLY PLATFORMS WHOSE run.py WRITES property_age ARE REGISTERED (SOURCE IS TRUTH: a field the source
-- does not state stays NULL, and a registry row for a platform that never writes the column would be
-- a claim nothing measures). Each row cites the run.py line that writes the column. The other
-- thirteen — fkralemar, hasaad, aqaralriyadh, jawher, m3tmd, senan, thousand, tamyaz, marksa,
-- rightcompound, azure, expattrusted, flow — publish no age field and their run.py writes no
-- property_age (AST-read 2026-09-24), so they get no row.
--
-- No rebuild is called here: the tables are empty at apply time, and age_source_health() gates each
-- canonical_column arm until the table has >= 5 aged rows, > 1 distinct age, max <= 100 and no
-- build years. The :44 run admits each table on its own once its first sweep clears that gate — the
-- small offices (almuteb, aalbarrak, sodasyat, albdah, eydah, hazim, yameen) stay INERT until then.
--
-- TRUSTED IS EARNED BY A LIVE PROBE (the registry's standing rule): every reader below was measured
-- live while its scraper was built (the SOURCE SHAPE block of each run.py records the field, its
-- vocabulary and the counts quoted here), and every field/prose reader goes through
-- normalize.exact_age / age_from_labelled_prose / age_from_completion_year / parse_property_age, so
-- an OPEN BOUND («اكثر من عشر سنوات», «40+») is NULL, never its floor, a warranty («ضمان 15 سنة») is
-- never an age, and a completion year is converted to whole years on every run rather than stored.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', v.trusted, v.note, now()
from (values
  -- source: scrapers/dwelleo/run.py:407
  ('dwelleo', true, 'TRUSTED 2026-09-24: the API record''s own building_year -> normalize.age_from_completion_year (whole years, recomputed each run, never stored once). Read from the full 11,480-row catalogue walk.'),
  -- source: scrapers/aqalemhajer/run.py:546
  ('aqalemhajer', true, 'TRUSTED 2026-09-24: Drupal field al-mr «العمر N» -> normalize.exact_age (an open bound is NULL, never its floor). Live index read: property_age on 100 of 1,229 listings.'),
  -- source: scrapers/sakani/run.py:438
  ('sakani', true, 'TRUSTED 2026-09-24: the detail''s unit_age, else the licence record''s property_age, through normalize.exact_age; a stated 0 is «new». Live: property_age on 10 of 282 rental units.'),
  -- source: scrapers/shatri/run.py:251
  ('shatri', true, 'TRUSTED 2026-09-24: Houzez meta fave_property_year -> normalize.age_from_completion_year (whole years). 74 sale listings.'),
  -- source: scrapers/alqasem/run.py:254
  ('alqasem', true, 'TRUSTED 2026-09-24: spec «حالة العقار» -> normalize.exact_age; never read for Land. 29 listings.'),
  -- source: scrapers/wadod/run.py:210
  ('wadod', true, 'TRUSTED 2026-09-24: detail field «عمر العقار» (live values 2 / 5 / 7 / جديد) -> normalize.exact_age. 33 listings.'),
  -- source: scrapers/almuteb/run.py:218
  ('almuteb', true, 'TRUSTED 2026-09-24: anchored prose -> normalize.age_from_labelled_prose. INERT UNTIL >= 5 AGED ROWS: 10 listings in total, so age_source_health() says too_small today.'),
  -- source: scrapers/aalbarrak/run.py:235
  ('aalbarrak', true, 'TRUSTED 2026-09-24: labelled prose «عمر العقار 4 سنوات» -> normalize.age_from_labelled_prose; a «ضمان 15 سنة» warranty is refused. INERT UNTIL >= 5 AGED ROWS: 10 listings in total.'),
  -- source: scrapers/alrifai/run.py:180
  ('alrifai', true, 'TRUSTED 2026-09-24: labelled prose -> normalize.age_from_labelled_prose; a «10 سنوات» warranty is never the age. 21 listings — likely too_small until more state an age.'),
  -- source: scrapers/sodasyat/run.py:260
  ('sodasyat', true, 'TRUSTED 2026-09-24: fact «عمر العقار : جديد» -> 0 through normalize.age_from_labelled_prose. INERT UNTIL >= 5 AGED ROWS / > 1 distinct age: 11 listings in total.'),
  -- source: scrapers/justsa/run.py:241
  ('justsa', true, 'TRUSTED 2026-09-24: spec «عمر العقار» («جديد» …) -> normalize.exact_age. 80 listings.'),
  -- source: scrapers/snam/run.py:240
  ('snam', true, 'TRUSTED 2026-09-24: the API''s yearBuilt is a DATE («2025-05-05»); its year -> normalize.age_from_completion_year, recomputed on every run rather than stored once. 72 units.'),
  -- source: scrapers/goldendeal/run.py:459
  ('goldendeal', true, 'TRUSTED 2026-09-24: year_built is FREE ENTRY — «0» = not provided (173 of 275) -> NULL; a 4-digit year -> normalize.age_from_completion_year; a small integer is an age typed directly -> the shared bounds gate; Land never carries an age. Live: property_age on 82 of 275.'),
  -- source: scrapers/yameen/run.py:56-58 (imports goldendeal's map_listing; the write is scrapers/goldendeal/run.py:459)
  ('yameen', true, 'TRUSTED 2026-09-24: SAME ENGINE as goldendeal (year_built: null 5 / «0» 4 / a year 18 of 27). INERT UNTIL >= 5 AGED ROWS: live property_age on 4 of 27, so age_source_health() says too_small today.'),
  -- source: scrapers/ebriza/run.py:345
  ('ebriza', true, 'TRUSTED 2026-09-24: the API''s age field -> normalize.exact_age (the literal «null» and the «اختر» placeholder stay NULL); «جديد» is the shared vocabulary. Live: age on 165 of 207.'),
  -- source: scrapers/eilmalriyada/run.py:329
  ('eilmalriyada', true, 'TRUSTED 2026-09-24: API property_age through parse_age: «0» (141) is UNSET -> NULL, not «new»; «حديث» (66) is outside the vocabulary -> NULL; only a stated number or «جديد» becomes an age.'),
  -- source: scrapers/daryusuf/run.py:479
  ('daryusuf', true, 'TRUSTED 2026-09-24: bilingual fact «عمر العقار / Property Age / Building Age» -> parse_age. 290 listings.'),
  -- source: scrapers/albdah/run.py:233
  ('albdah', true, 'TRUSTED 2026-09-24: «عمر العقار» («جديد» / 4 / 7); «مجدد» = renovated, NOT an age -> NULL. INERT UNTIL >= 5 AGED ROWS: 10 listings in total.'),
  -- source: scrapers/eydah/run.py:163
  ('eydah', true, 'TRUSTED 2026-09-24: spec «عمر العقار» -> normalize.parse_property_age. INERT UNTIL >= 5 AGED ROWS: 2 offers in total, so age_source_health() says too_small.'),
  -- source: scrapers/hazim/run.py:177
  ('hazim', true, 'TRUSTED 2026-09-24: the entity''s `year` (2023.0) -> normalize.age_from_completion_year (whole years). INERT UNTIL >= 5 AGED ROWS: 6 listings in total.'),
  -- source: scrapers/villassa/run.py:301
  ('villassa', true, 'TRUSTED 2026-09-24: detail «عمر العقار» («جديد», «اربع سنوات», «ثمان سنوات») -> normalize.exact_age, word numerals included. Live: 6 of 14 state an age; gated by age_source_health() until >= 5 aged rows with > 1 distinct age.'),
  -- source: scrapers/livingcompound/run.py:208
  ('livingcompound', true, 'TRUSTED 2026-09-24: «Year Built» (property_year, e.g. «2018») -> normalize.age_from_completion_year. 19 units.')
) as v(p, trusted, note)
cross join lateral (values (v.p || '_residential_listings'), (v.p || '_commercial_listings')) as x(t)
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted,
      note = excluded.note, updated_at = now();

do $verify$
declare n_trusted int; n_all int; n_stray int;
begin
  select count(*) filter (where trusted), count(*) into n_trusted, n_all
    from public.age_source_registry
   where source_table ~ '^(dwelleo|aqalemhajer|sakani|shatri|alqasem|wadod|almuteb|aalbarrak|alrifai|sodasyat|justsa|snam|goldendeal|yameen|ebriza|eilmalriyada|daryusuf|albdah|eydah|hazim|villassa|livingcompound)_(residential|commercial)_listings$';
  if n_all <> 44 or n_trusted <> 44 then
    raise exception 'age_source_registry: expected 44 rows / 44 trusted for the twenty-two age writers, got % / %', n_all, n_trusted;
  end if;
  select count(*) into n_stray
    from public.age_source_registry
   where source_table ~ '^(fkralemar|hasaad|aqaralriyadh|jawher|m3tmd|senan|thousand|tamyaz|marksa|rightcompound|azure|expattrusted|flow)_(residential|commercial)_listings$';
  if n_stray <> 0 then
    raise exception 'age_source_registry: % row(s) for platforms whose run.py writes no property_age', n_stray;
  end if;
  raise notice 'twenty-two age-writing platforms registered in age_source_registry (44 rows, all trusted); thirteen non-writers deliberately absent';
end $verify$;
