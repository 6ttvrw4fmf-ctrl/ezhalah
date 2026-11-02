-- THE COUNTRYSIDE + RESIDENTIAL-LAND GROUP CHIPS (owner approval 2026-11-02, built 2026-11-02). One migration, the shape
-- of the villas migration (the one that taught the surfaces women_majlis … smart_home_entry), for 58 new boolean text facts the
-- free word reader learns in its own PR (split_payments … no_services: short-stay amenities, farm facts, residential-land facts)
-- and 2 derived predicate tokens over columns this migration adds (camels_horses = camels or horses_stable,
-- palm_fruit_trees = palms or fruit_trees). No new bathroom rungs. 60 tokens in all.
--
-- RULE B unchanged: served = af_rule_b(box, the ad's quoted words). None of the 58 has a site box, so listing_rich_attrs
-- gains a NULL column per key and sync_listing_rich_attrs (hourly via sync_all_rich_attrs) merges and copies it like every
-- other Rule B column — its merged_list reads text_facts_af_columns() at run time, so it needs no edit here. The free word
-- reader (scrapers/facts/words.py AF_COLUMNS) is the ONLY writer; text_facts_all_quoted admits a key only with the ad's quote
-- and reads the same list, so it needs no edit either.
--
-- corner_plot: checked live before drafting — no search_listings_ar / listing_rich_attrs / listing_text_facts_af column, not in
-- text_facts_af_columns(), no af_field_registry row, zero listing_text_facts rows carry the key. It is therefore added exactly
-- like the other 57; the column step is `add column if not exists` and the view step is skipped if the key is already a box.
--
-- WHAT CHANGES (every live body md5-guarded; every needle must occur exactly once or nothing changes)
--   1. listing_rich_attrs.<key> NULL boxes; search_listings_ar.<key> boolean (served).
--   2. text_facts_af_columns() = 125 keys; listing_text_facts_af / text_facts_apply_slice over the full list.
--   3. af_eligibility_clause() whitelist + one arm per token; top_cities_by_deal_ar (its copy); rebuild_af_filter_rpcs(); parity 0.
--   4. apartment_guided_counts_ar template: s.<col> in the scoped CTE, cnt_<token>.
--   5. location_search_candidates_ar template packs every new column into af_canon: a FOURTH and a FIFTH jsonb_build_object
--      joined with || (29 pairs = 58 arguments each; one call takes at most 100 and the third already carries 14).
--   6. ops_af_option_truth_sweep + af_option_truth_table learn amenity:<token>; af_option_vocab_drift() = 0; 137 amenity rows.
--   7. af_field_registry rows; self-check chip == referee == direct (split_payments), chip == referee (camels_horses); garbage 0.
-- Client half (afCohorts.ts, advancedFilters.ts, afEvidence/afSummary/ResultCard/i18n, remote.ts GuidedCounts, sql/mirrors
-- af_eligibility_clause.sql + af_canon_select.sql, barriers) and the reader half ship in their own PRs; mirrored byte-exact
-- in mirror/<version>.

create temp table _cs_tokens (ord int, token text, kind text, pred text, flt text, direct text, label_ar text);
insert into _cs_tokens (ord, token, kind, label_ar) values
  (1,'split_payments','bool','دفعات / دفع شهري'),
  (2,'heated_pool','bool','مسبح مدفأ'),
  (3,'kids_pool','bool','مسبح أطفال'),
  (4,'water_slide','bool','زحليقة'),
  (5,'sea_view','bool','إطلالة بحرية'),
  (6,'football_pitch','bool','ملعب كرة قدم'),
  (7,'playstation','bool','بلايستيشن'),
  (8,'inflatable_games','bool','نطيطة'),
  (9,'sound_system','bool','نظام صوتي'),
  (10,'fire_pit','bool','موقد نار'),
  (11,'bait_shaar','bool','بيت شعر'),
  (12,'mandi_pit','bool','حفرة مندي'),
  (13,'outdoor_seating','bool','جلسة خارجية'),
  (14,'tent','bool','خيمة'),
  (15,'dunes_view','bool','إطلالة على الرمال'),
  (16,'women_section','bool','قسم نساء'),
  (17,'two_sections','bool','قسمين'),
  (18,'events_hall','bool','صالة مناسبات'),
  (19,'privacy_screen','bool','ساتر / خصوصية'),
  (20,'trees','bool','أشجار'),
  (21,'for_families','bool','للعوائل'),
  (22,'for_youth','bool','للشباب'),
  (23,'for_events','bool','للمناسبات'),
  (24,'for_newlyweds','bool','للعرسان'),
  (25,'quad_bikes','bool','دبابات'),
  (26,'horses_stable','bool','خيل / اسطبل'),
  (27,'camels','bool','إبل / هجن'),
  (28,'toilets_on_site','bool','دورات مياه'),
  (29,'lighting','bool','إنارة'),
  (30,'artesian_well','bool','بئر ارتوازي'),
  (31,'solar_power','bool','طاقة شمسية'),
  (32,'palms','bool','نخيل'),
  (33,'fruit_trees','bool','أشجار مثمرة'),
  (34,'fodder_crops','bool','أعلاف ومحاصيل'),
  (35,'greenhouses','bool','بيوت محمية'),
  (36,'producing_farm','bool','مزرعة منتجة'),
  (37,'animal_pens','bool','حظائر'),
  (38,'poultry','bool','دواجن'),
  (39,'farm_house','bool','بيت / فيلا داخل المزرعة'),
  (40,'farm_rest_house','bool','استراحة داخل المزرعة'),
  (41,'workers_housing','bool','سكن عمال'),
  (42,'fence','bool','مسورة'),
  (43,'main_road','bool','على طريق رئيسي'),
  (44,'good_soil','bool','تربة صالحة للزراعة'),
  (45,'corner_plot','bool','زاوية'),
  (46,'three_streets','bool','ثلاث شوارع'),
  (47,'ready_to_build','bool','جاهزة للبناء'),
  (48,'raised_plot','bool','أرض مرتفعة'),
  (49,'residential_commercial','bool','سكني تجاري'),
  (50,'all_services','bool','جميع الخدمات'),
  (51,'asphalt','bool','مسفلتة'),
  (52,'street_lights','bool','إنارة وأرصفة'),
  (53,'approved_plan','bool','مخطط معتمد'),
  (54,'direct_owner','bool','من المالك'),
  (55,'inside_project','bool','داخل مخطط'),
  (56,'floors_allowed','bool','نظام البناء'),
  (57,'grant_land','bool','منحة'),
  (58,'no_services','bool','بدون خدمات');
update _cs_tokens set pred = 's.' || token, flt = token, direct = 's.' || token || ' is true' where kind = 'bool';
insert into _cs_tokens values
  (59,'camels_horses','derived','(s.camels or s.horses_stable)','(camels or horses_stable)','(s.camels is true or s.horses_stable is true)','إبل أو خيل'),
  (60,'palm_fruit_trees','derived','(s.palms or s.fruit_trees)','(palms or fruit_trees)','(s.palms is true or s.fruit_trees is true)','نخيل أو أشجار مثمرة');
do $$
begin
  if (select count(*) from _cs_tokens where kind = 'bool') <> 58 or (select count(*) from _cs_tokens) <> 60 then
    raise exception 'token table miscounted: % bool / % total', (select count(*) from _cs_tokens where kind = 'bool'), (select count(*) from _cs_tokens);
  end if;
end $$;

-- ── 1. the NULL boxes and the served columns ────────────────────────────────────────────────────────────
do $$
declare v text; boxes text; k text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_rich_attrs' and column_name = 'split_payments') then
    raise notice 'listing_rich_attrs already carries the countryside chips — view step skipped';
  else
    select string_agg(format('null::boolean as %I', token), ', ' order by ord) into boxes from _cs_tokens t where kind = 'bool'
       and not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'listing_rich_attrs' and c.column_name = t.token);
    v := regexp_replace(pg_get_viewdef('public.listing_rich_attrs'::regclass, true), ';\s*$', '');
    execute 'create or replace view public.listing_rich_attrs as select v.*, ' || boxes || ' from (' || v || ') v';
  end if;
  for k in select token from _cs_tokens where kind = 'bool' order by ord loop
    execute format('alter table public.search_listings_ar add column if not exists %I boolean', k);
    execute format('comment on column public.search_listings_ar.%I is %L', k,
      'Advanced Filter amenity (owner 2026-11-02, countryside + residential-land group): af_rule_b(NULL box, the ad''s quoted words via listing_text_facts_af.' || k || '). Positive-only IS TRUE token; NULL = unknown.');
  end loop;
  for k in select token from _cs_tokens where kind = 'bool' loop
    if not (k = any (public._rich_attr_columns())) then
      raise exception '_rich_attr_columns() does not derive % — the two columns are not both in place', k;
    end if;
  end loop;
end $$;

-- ── 2. the text overlay learns every key ────────────────────────────────────────────────────────────────
do $$
begin
  if md5(pg_get_functiondef('public.text_facts_af_columns()'::regprocedure)) <> '25d2024a5117f0527892ca001e3e7c5e' then
    raise exception 'text_facts_af_columns moved since the villas migration; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.text_facts_apply_slice(text,bigint,bigint)'::regprocedure)) <> '7cf0840040ec75c22b8d57dad1c0883f' then
    raise exception 'text_facts_apply_slice moved since the villas migration; rebase this migration';
  end if;
  if md5(pg_get_viewdef('public.listing_text_facts_af'::regclass, true)) <> '7d301b97ad21c0ffa5d7faf1510af531' then
    raise exception 'listing_text_facts_af moved since the villas migration; rebase this migration';
  end if;
  if 'corner_plot' = any (public.text_facts_af_columns()) then
    raise exception 'corner_plot is already an AF column; drop it from _cs_tokens and the overlay before applying';
  end if;
end $$;

create or replace function public.text_facts_af_columns()
returns text[] language sql immutable parallel safe as $$
  select array['furnished','elevator','parking','kitchen','air_conditioner','maid_room','driver_room',
               'private_entrance','separate_electricity_meter','separate_water_meter','electricity',
               'water_supply','sanitation','balcony','laundry_room','pool','gym','garden','car_entrance',
               'optical_fibers','majlis',
               'roof','two_entrances','annex','yard','garage','grill','storage','water_tank','warranty','electronic_deed','basement',
               'self_checkin','wifi','bills_included','jacuzzi','smart_tv','billiards','cleaning_service','soundproof',
               'cameras','guard','smart_entry','smart_home','central_gas','sauna','kids_play_area','nursery',
               'free_maintenance','intercom','fire_system','ev_charger','central_vacuum','insulation','dining_majlis',
               'own_bathroom','fridge','whole_floor','singles','families',
               'women_majlis','outdoor_kitchen','outdoor_diwaniya','waterfall','well','irrigation','sports_court',
               'split_payments','heated_pool','kids_pool','water_slide','sea_view','football_pitch',
               'playstation','inflatable_games','sound_system','fire_pit','bait_shaar','mandi_pit',
               'outdoor_seating','tent','dunes_view','women_section','two_sections','events_hall',
               'privacy_screen','trees','for_families','for_youth','for_events','for_newlyweds',
               'quad_bikes','horses_stable','camels','toilets_on_site','lighting','artesian_well',
               'solar_power','palms','fruit_trees','fodder_crops','greenhouses','producing_farm',
               'animal_pens','poultry','farm_house','farm_rest_house','workers_housing','fence',
               'main_road','good_soil','corner_plot','three_streets','ready_to_build','raised_plot',
               'residential_commercial','all_services','asphalt','street_lights','approved_plan','direct_owner',
               'inside_project','floors_allowed','grant_land','no_services']::text[]
$$;
do $$
begin
  if array_length(public.text_facts_af_columns(), 1) <> 125 then
    raise exception 'text_facts_af_columns() has % keys, expected 125', array_length(public.text_facts_af_columns(), 1);
  end if;
  if (select count(*) from unnest(public.text_facts_af_columns()) k) <> (select count(distinct k) from unnest(public.text_facts_af_columns()) k) then
    raise exception 'text_facts_af_columns() carries a duplicate key';
  end if;
  if public.text_facts_all_quoted('{"palms": {"v": true, "q": ""}}'::jsonb)
     or public.text_facts_all_quoted('{"no_services": {"v": 1, "q": "بدون خدمات"}}'::jsonb)
     or not public.text_facts_all_quoted('{"split_payments": {"v": true, "q": "دفعات"}, "corner_plot": {"v": true, "q": "زاوية"}, "wifi": {"v": true, "q": "واي فاي"}}'::jsonb) then
    raise exception 'text_facts_all_quoted does not admit the new keys as intended';
  end if;
end $$;

-- the overlay view: every existing column keeps its position; the 58 countryside keys are appended after the villa keys.
create or replace view public.listing_text_facts_af as
select f.source_table, f.listing_id,
       public.text_fact_bool(f.facts, 'furnished') as furnished,
       public.text_fact_bool(f.facts, 'elevator') as elevator,
       public.text_fact_bool(f.facts, 'parking') as parking,
       public.text_fact_bool(f.facts, 'kitchen') as kitchen,
       public.text_fact_bool(f.facts, 'air_conditioner') as air_conditioner,
       public.text_fact_bool(f.facts, 'maid_room') as maid_room,
       public.text_fact_bool(f.facts, 'driver_room') as driver_room,
       public.text_fact_bool(f.facts, 'private_entrance') as private_entrance,
       public.text_fact_bool(f.facts, 'separate_electricity_meter') as separate_electricity_meter,
       public.text_fact_bool(f.facts, 'separate_water_meter') as separate_water_meter,
       public.text_fact_bool(f.facts, 'electricity') as electricity,
       public.text_fact_bool(f.facts, 'water_supply') as water_supply,
       public.text_fact_bool(f.facts, 'sanitation') as sanitation,
       public.text_fact_bool(f.facts, 'balcony') as balcony,
       public.text_fact_bool(f.facts, 'laundry_room') as laundry_room,
       public.text_fact_bool(f.facts, 'pool') as pool,
       public.text_fact_bool(f.facts, 'gym') as gym,
       public.text_fact_bool(f.facts, 'garden') as garden,
       public.text_fact_bool(f.facts, 'car_entrance') as car_entrance,
       public.text_fact_bool(f.facts, 'optical_fibers') as optical_fibers,
       case when public.text_facts_street_width_on() then public.text_fact_num(f.facts, 'street_width_m')::smallint end as street_width_m,
       case when public.text_facts_majlis_on() then public.text_fact_bool(f.facts, 'majlis') end as majlis,
       public.text_fact_bool(f.facts, 'roof') as roof,
       public.text_fact_bool(f.facts, 'two_entrances') as two_entrances,
       public.text_fact_bool(f.facts, 'annex') as annex,
       public.text_fact_bool(f.facts, 'yard') as yard,
       public.text_fact_bool(f.facts, 'garage') as garage,
       public.text_fact_bool(f.facts, 'grill') as grill,
       public.text_fact_bool(f.facts, 'storage') as storage,
       public.text_fact_bool(f.facts, 'water_tank') as water_tank,
       public.text_fact_bool(f.facts, 'warranty') as warranty,
       public.text_fact_bool(f.facts, 'electronic_deed') as electronic_deed,
       public.text_fact_bool(f.facts, 'basement') as basement,
       public.text_fact_bool(f.facts, 'self_checkin') as self_checkin,
       public.text_fact_bool(f.facts, 'wifi') as wifi,
       public.text_fact_bool(f.facts, 'bills_included') as bills_included,
       public.text_fact_bool(f.facts, 'jacuzzi') as jacuzzi,
       public.text_fact_bool(f.facts, 'smart_tv') as smart_tv,
       public.text_fact_bool(f.facts, 'billiards') as billiards,
       public.text_fact_bool(f.facts, 'cleaning_service') as cleaning_service,
       public.text_fact_bool(f.facts, 'soundproof') as soundproof,
       public.text_fact_bool(f.facts, 'cameras') as cameras,
       public.text_fact_bool(f.facts, 'guard') as guard,
       public.text_fact_bool(f.facts, 'smart_entry') as smart_entry,
       public.text_fact_bool(f.facts, 'smart_home') as smart_home,
       public.text_fact_bool(f.facts, 'central_gas') as central_gas,
       public.text_fact_bool(f.facts, 'sauna') as sauna,
       public.text_fact_bool(f.facts, 'kids_play_area') as kids_play_area,
       public.text_fact_bool(f.facts, 'nursery') as nursery,
       public.text_fact_bool(f.facts, 'free_maintenance') as free_maintenance,
       public.text_fact_bool(f.facts, 'intercom') as intercom,
       public.text_fact_bool(f.facts, 'fire_system') as fire_system,
       public.text_fact_bool(f.facts, 'ev_charger') as ev_charger,
       public.text_fact_bool(f.facts, 'central_vacuum') as central_vacuum,
       public.text_fact_bool(f.facts, 'insulation') as insulation,
       public.text_fact_bool(f.facts, 'dining_majlis') as dining_majlis,
       public.text_fact_bool(f.facts, 'own_bathroom') as own_bathroom,
       public.text_fact_bool(f.facts, 'fridge') as fridge,
       public.text_fact_bool(f.facts, 'whole_floor') as whole_floor,
       public.text_fact_bool(f.facts, 'singles') as singles,
       public.text_fact_bool(f.facts, 'families') as families,
       case when public.text_facts_street_width_on() then public.text_fact_num(f.facts, 'apartments_count')::smallint end as apartments_count,
       case when public.text_facts_street_width_on() then public.text_fact_num(f.facts, 'shops_count')::smallint end as shops_count,
       public.text_fact_bool(f.facts, 'women_majlis') as women_majlis,
       public.text_fact_bool(f.facts, 'outdoor_kitchen') as outdoor_kitchen,
       public.text_fact_bool(f.facts, 'outdoor_diwaniya') as outdoor_diwaniya,
       public.text_fact_bool(f.facts, 'waterfall') as waterfall,
       public.text_fact_bool(f.facts, 'well') as well,
       public.text_fact_bool(f.facts, 'irrigation') as irrigation,
       public.text_fact_bool(f.facts, 'sports_court') as sports_court,
       public.text_fact_bool(f.facts, 'split_payments') as split_payments,
       public.text_fact_bool(f.facts, 'heated_pool') as heated_pool,
       public.text_fact_bool(f.facts, 'kids_pool') as kids_pool,
       public.text_fact_bool(f.facts, 'water_slide') as water_slide,
       public.text_fact_bool(f.facts, 'sea_view') as sea_view,
       public.text_fact_bool(f.facts, 'football_pitch') as football_pitch,
       public.text_fact_bool(f.facts, 'playstation') as playstation,
       public.text_fact_bool(f.facts, 'inflatable_games') as inflatable_games,
       public.text_fact_bool(f.facts, 'sound_system') as sound_system,
       public.text_fact_bool(f.facts, 'fire_pit') as fire_pit,
       public.text_fact_bool(f.facts, 'bait_shaar') as bait_shaar,
       public.text_fact_bool(f.facts, 'mandi_pit') as mandi_pit,
       public.text_fact_bool(f.facts, 'outdoor_seating') as outdoor_seating,
       public.text_fact_bool(f.facts, 'tent') as tent,
       public.text_fact_bool(f.facts, 'dunes_view') as dunes_view,
       public.text_fact_bool(f.facts, 'women_section') as women_section,
       public.text_fact_bool(f.facts, 'two_sections') as two_sections,
       public.text_fact_bool(f.facts, 'events_hall') as events_hall,
       public.text_fact_bool(f.facts, 'privacy_screen') as privacy_screen,
       public.text_fact_bool(f.facts, 'trees') as trees,
       public.text_fact_bool(f.facts, 'for_families') as for_families,
       public.text_fact_bool(f.facts, 'for_youth') as for_youth,
       public.text_fact_bool(f.facts, 'for_events') as for_events,
       public.text_fact_bool(f.facts, 'for_newlyweds') as for_newlyweds,
       public.text_fact_bool(f.facts, 'quad_bikes') as quad_bikes,
       public.text_fact_bool(f.facts, 'horses_stable') as horses_stable,
       public.text_fact_bool(f.facts, 'camels') as camels,
       public.text_fact_bool(f.facts, 'toilets_on_site') as toilets_on_site,
       public.text_fact_bool(f.facts, 'lighting') as lighting,
       public.text_fact_bool(f.facts, 'artesian_well') as artesian_well,
       public.text_fact_bool(f.facts, 'solar_power') as solar_power,
       public.text_fact_bool(f.facts, 'palms') as palms,
       public.text_fact_bool(f.facts, 'fruit_trees') as fruit_trees,
       public.text_fact_bool(f.facts, 'fodder_crops') as fodder_crops,
       public.text_fact_bool(f.facts, 'greenhouses') as greenhouses,
       public.text_fact_bool(f.facts, 'producing_farm') as producing_farm,
       public.text_fact_bool(f.facts, 'animal_pens') as animal_pens,
       public.text_fact_bool(f.facts, 'poultry') as poultry,
       public.text_fact_bool(f.facts, 'farm_house') as farm_house,
       public.text_fact_bool(f.facts, 'farm_rest_house') as farm_rest_house,
       public.text_fact_bool(f.facts, 'workers_housing') as workers_housing,
       public.text_fact_bool(f.facts, 'fence') as fence,
       public.text_fact_bool(f.facts, 'main_road') as main_road,
       public.text_fact_bool(f.facts, 'good_soil') as good_soil,
       public.text_fact_bool(f.facts, 'corner_plot') as corner_plot,
       public.text_fact_bool(f.facts, 'three_streets') as three_streets,
       public.text_fact_bool(f.facts, 'ready_to_build') as ready_to_build,
       public.text_fact_bool(f.facts, 'raised_plot') as raised_plot,
       public.text_fact_bool(f.facts, 'residential_commercial') as residential_commercial,
       public.text_fact_bool(f.facts, 'all_services') as all_services,
       public.text_fact_bool(f.facts, 'asphalt') as asphalt,
       public.text_fact_bool(f.facts, 'street_lights') as street_lights,
       public.text_fact_bool(f.facts, 'approved_plan') as approved_plan,
       public.text_fact_bool(f.facts, 'direct_owner') as direct_owner,
       public.text_fact_bool(f.facts, 'inside_project') as inside_project,
       public.text_fact_bool(f.facts, 'floors_allowed') as floors_allowed,
       public.text_fact_bool(f.facts, 'grant_land') as grant_land,
       public.text_fact_bool(f.facts, 'no_services') as no_services
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);
comment on view public.listing_text_facts_af is
  'Rule B overlay input: the ad-text value per Advanced Filter column (125 booleans + street_width_m, apartments_count, shops_count), only with its quote, never from changed text, empty when ops_feature_flags.af_text_facts_overlay is off; street_width_m / majlis each behind their own switch.';
do $$
declare k text;
begin
  for k in select token from _cs_tokens where kind = 'bool' loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_text_facts_af' and column_name = k) then
      raise exception 'listing_text_facts_af does not carry %', k;
    end if;
  end loop;
end $$;

-- text_facts_apply_slice: the 58 countryside keys join the merge select, the set list and both change-detection tuples
do $mig$
declare src text; fn text; needle text; repl text; n int; k text;
begin
  fn := 'public.text_facts_apply_slice(text,bigint,bigint)';
  src := pg_get_functiondef(fn::regprocedure);

  needle := $x$             public.af_rule_b(r.sports_court, tf.sports_court) as sports_court$x$;
  select needle || ',' || E'\n' || string_agg(format('             public.af_rule_b(r.%1$I, tf.%1$I) as %1$I', token), ',' || E'\n' order by ord)
    into repl from _cs_tokens where kind = 'bool';
  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then raise exception '%: merge-select needle found % times, expected 1', fn, n; end if;
  src := replace(src, needle, repl);

  needle := $x$sports_court = m.sports_court$x$;
  select needle || ', ' || string_agg(format('%1$I = m.%1$I', token), ', ' order by ord) into repl from _cs_tokens where kind = 'bool';
  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then raise exception '%: set-list needle found % times, expected 1', fn, n; end if;
  src := replace(src, needle, repl);

  foreach k in array array['s', 'm'] loop
    needle := k || '.sports_court)';
    select k || '.sports_court, ' || string_agg(k || '.' || token, ', ' order by ord) || ')' into repl from _cs_tokens where kind = 'bool';
    n := (length(src) - length(replace(src, needle, ''))) / length(needle);
    if n <> 1 then raise exception '%: % tuple needle found % times, expected 1', fn, k, n; end if;
    src := replace(src, needle, repl);
  end loop;
  execute src;
  if position('tf.no_services) as no_services' in pg_get_functiondef(fn::regprocedure)) = 0 then
    raise exception '%: the rebuilt applier does not merge no_services', fn;
  end if;
end $mig$;

-- ── 3.–7. the Advanced Filter surfaces, exactly as the villas migration did, the strings built from _cs_tokens ──
do $do$
declare
  wl_old text := $x$'smart_home_entry','furnished','rnpl','rent_now_pay_later'))$x$;
  wl_new text;
  pred_old text := $x$           and (not ('smart_home_entry' = any(p_amenities)) or (s.smart_home or s.smart_entry))$x$;
  pred_new text;
  scoped_old text := $x$s.sports_court, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  scoped_new text;
  ret_old text := $x$cnt_smart_home_entry bigint, cnt_selected bigint$x$;
  ret_new text;
  sel_old text := $x$    count(*) filter (where (smart_home or smart_entry)) as cnt_smart_home_entry,$x$;
  sel_new text;
  canon_old text := $x$'sports_court', s.sports_court) end as af_canon$x$;
  canon_new text; canon_a text; canon_b text;
  sweep_old text := $x$        ('amenity:smart_home_entry','cnt_smart_home_entry','p_amenities:=array[''smart_home_entry'']','(s.smart_home is true or s.smart_entry is true)'),$x$;
  sweep_add text;
  tt_old text := $x$    ('amenity:smart_home_entry','cnt_smart_home_entry','p_amenities:=array[''smart_home_entry'']','(s.smart_home is true or s.smart_entry is true)','guided'),$x$;
  tt_add text;
  cols text; toks text; clause text; tcbd_def text; tpl text; sweep_def text; tt_def text; occ int;
  before_n bigint; after_n bigint; parity int; v_counts jsonb; v_chip bigint; v_ref bigint; v_direct bigint; v_garbage bigint; v_drift int; tok text;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure)) <> 'a0a75c9727a6131321840156e5cbf276' then
    raise exception 'ABORT: af_eligibility_clause moved since this migration was written (%)', md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure));
  end if;
  if md5(pg_get_functiondef('public.top_cities_by_deal_ar'::regproc)) <> '8107d86f71361a4ba6b883d416237ecb' then
    raise exception 'ABORT: top_cities_by_deal_ar moved since this migration was written';
  end if;
  if md5(pg_get_functiondef('public.ops_af_option_truth_sweep'::regproc)) <> '6873b287e20f4d392f53e812a762a7d3'
     or md5(pg_get_functiondef('public.af_option_truth_table'::regproc)) <> 'aeb1ba499f7bdb0f0da09f0de8994452' then
    raise exception 'ABORT: the sweep or the truth table moved since this migration was written';
  end if;

  select string_agg(quote_literal(token), ',' order by ord) into toks from _cs_tokens;
  wl_new := $x$'smart_home_entry',$x$ || toks || $x$,'furnished','rnpl','rent_now_pay_later'))$x$;
  select pred_old || E'\n' || string_agg(format('           and (not (%L = any(p_amenities)) or %s)', token, pred), E'\n' order by ord) into pred_new from _cs_tokens;
  select string_agg('s.' || token, ', ' order by ord) into cols from _cs_tokens where kind = 'bool';
  scoped_new := 's.sports_court, ' || cols || ', s.rating, s.reviews_count, s.unit_subtype_ar';
  select 'cnt_smart_home_entry bigint, ' || string_agg('cnt_' || token || ' bigint', ', ' order by ord) || ', cnt_selected bigint' into ret_new from _cs_tokens;
  select sel_old || E'\n' || string_agg(format('    count(*) filter (where %s) as cnt_%s,', flt, token), E'\n' order by ord) into sel_new from _cs_tokens;
  -- a fourth and a fifth jsonb_build_object joined with || : one call takes at most 100 arguments; 29 pairs = 58 each
  select string_agg(format('%L, s.%I', token, token), ', ' order by ord) into canon_a from _cs_tokens where kind = 'bool' and ord <= 29;
  select string_agg(format('%L, s.%I', token, token), ', ' order by ord) into canon_b from _cs_tokens where kind = 'bool' and ord > 29;
  if (select count(*) from _cs_tokens where kind = 'bool' and ord <= 29) * 2 > 100 or (select count(*) from _cs_tokens where kind = 'bool' and ord > 29) * 2 > 100 then
    raise exception 'ABORT: an af_canon jsonb_build_object would exceed 100 arguments';
  end if;
  canon_new := $x$'sports_court', s.sports_court) || jsonb_build_object($x$ || canon_a || $x$) || jsonb_build_object($x$ || canon_b || $x$) end as af_canon$x$;
  select sweep_old || E'\n' || string_agg(format('        (%L,%L,%L,%L),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into sweep_add from _cs_tokens;
  select tt_old || E'\n' || string_agg(format('    (%L,%L,%L,%L,''guided''),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into tt_add from _cs_tokens;

  -- 3. the canonical clause + its byte-identical copy in top_cities_by_deal_ar
  clause := af_eligibility_clause();
  occ := (length(clause) - length(replace(clause, wl_old, ''))) / length(wl_old);
  if occ <> 1 then raise exception 'ABORT: af_eligibility_clause whitelist needle occurs %', occ; end if;
  clause := replace(clause, wl_old, wl_new);
  occ := (length(clause) - length(replace(clause, pred_old, ''))) / length(pred_old);
  if occ <> 1 then raise exception 'ABORT: af_eligibility_clause predicate needle occurs %', occ; end if;
  clause := replace(clause, pred_old, pred_new);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', clause);

  select pg_get_functiondef('public.top_cities_by_deal_ar'::regproc) into tcbd_def;
  occ := (length(tcbd_def) - length(replace(tcbd_def, wl_old, ''))) / length(wl_old);
  if occ <> 1 then raise exception 'ABORT: top_cities_by_deal_ar whitelist needle occurs %', occ; end if;
  tcbd_def := replace(tcbd_def, wl_old, wl_new);
  occ := (length(tcbd_def) - length(replace(tcbd_def, pred_old, ''))) / length(pred_old);
  if occ <> 1 then raise exception 'ABORT: top_cities_by_deal_ar predicate needle occurs %', occ; end if;
  tcbd_def := replace(tcbd_def, pred_old, pred_new);
  execute tcbd_def;

  -- 4. the guided-counts template
  select template into tpl from af_rpc_templates where fn_name = 'apartment_guided_counts_ar';
  if tpl is null then raise exception 'ABORT: af_rpc_templates has no apartment_guided_counts_ar row'; end if;
  occ := (length(tpl) - length(replace(tpl, scoped_old, ''))) / length(scoped_old);
  if occ <> 1 then raise exception 'ABORT: scoped needle occurs %', occ; end if;
  tpl := replace(tpl, scoped_old, scoped_new);
  occ := (length(tpl) - length(replace(tpl, ret_old, ''))) / length(ret_old);
  if occ <> 1 then raise exception 'ABORT: returns needle occurs %', occ; end if;
  tpl := replace(tpl, ret_old, ret_new);
  occ := (length(tpl) - length(replace(tpl, sel_old, ''))) / length(sel_old);
  if occ <> 1 then raise exception 'ABORT: select needle occurs %', occ; end if;
  tpl := replace(tpl, sel_old, sel_new);
  update af_rpc_templates set template = tpl where fn_name = 'apartment_guided_counts_ar';

  -- 5. the results RPC packs every new column into af_canon (the card's proof)
  select template into tpl from af_rpc_templates where fn_name = 'location_search_candidates_ar';
  if tpl is null then raise exception 'ABORT: af_rpc_templates has no location_search_candidates_ar row'; end if;
  occ := (length(tpl) - length(replace(tpl, canon_old, ''))) / length(canon_old);
  if occ <> 1 then raise exception 'ABORT: canon needle occurs %', occ; end if;
  tpl := replace(tpl, canon_old, canon_new);
  update af_rpc_templates set template = tpl where fn_name = 'location_search_candidates_ar';

  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['فيلا'], p_cities:=array['الرياض'], p_category:='Residential');

  perform * from rebuild_af_filter_rpcs();

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['فيلا'], p_cities:=array['الرياض'], p_category:='Residential');
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort changed %->%', before_n, after_n;
  end if;
  if position('''no_services'', s.no_services' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0
     or position('''split_payments'', s.split_payments' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0 then
    raise exception 'ABORT: the rebuilt location_search_candidates_ar does not pack split_payments / no_services';
  end if;

  -- 7. chip == referee == direct on the fleet-wide base (the exact formula the villas migration used)
  select to_jsonb(g) into v_counts from apartment_guided_counts_ar() g;
  for tok in select token from _cs_tokens loop
    if v_counts ->> ('cnt_' || tok) is null then raise exception 'ABORT: rebuilt RPC has no cnt_% column', tok; end if;
  end loop;
  v_chip := (v_counts ->> 'cnt_split_payments')::bigint;
  select af_eligible_count(p_amenities:=array['split_payments']) into v_ref;
  select count(*) into v_direct from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
     and s.split_payments;
  if v_chip <> v_ref or v_ref <> v_direct then
    raise exception 'ABORT: split_payments chip % / referee % / direct % disagree', v_chip, v_ref, v_direct;
  end if;
  v_chip := (v_counts ->> 'cnt_camels_horses')::bigint;
  select af_eligible_count(p_amenities:=array['camels_horses']) into v_ref;
  if v_chip <> v_ref then raise exception 'ABORT: camels_horses chip % / referee % disagree', v_chip, v_ref; end if;
  select af_eligible_count(p_amenities:=array['garbage_token_zz']) into v_garbage;
  if v_garbage <> 0 then raise exception 'ABORT: af_eligible_count garbage token returned %', v_garbage; end if;
  if (select count(*) from top_cities_by_deal_ar(p_amenities:=array['garbage_token_zz'])) <> 0 then
    raise exception 'ABORT: top_cities_by_deal_ar garbage token returned rows';
  end if;

  -- 6. the runtime sweep and the in-DB truth table learn every token
  select pg_get_functiondef(p.oid) into sweep_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ops_af_option_truth_sweep';
  occ := (length(sweep_def) - length(replace(sweep_def, sweep_old, ''))) / length(sweep_old);
  if occ <> 1 then raise exception 'ABORT: sweep anchor occurs %', occ; end if;
  execute replace(sweep_def, sweep_old, sweep_add);
  select pg_get_functiondef(p.oid) into tt_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'af_option_truth_table';
  occ := (length(tt_def) - length(replace(tt_def, tt_old, ''))) / length(tt_old);
  if occ <> 1 then raise exception 'ABORT: truth-table anchor occurs %', occ; end if;
  execute replace(tt_def, tt_old, tt_add);
  select count(*) into v_drift from af_option_vocab_drift();
  if v_drift <> 0 then
    raise exception 'ABORT: af_option_vocab_drift reports % row(s): %', v_drift,
      (select string_agg(d.side || ':' || d.label, ', ') from af_option_vocab_drift() d);
  end if;
  if (select count(*) from af_option_truth_table() where label like 'amenity:%') <> 137 then
    raise exception 'ABORT: expected 137 amenity rows in af_option_truth_table (77 + 60), got %', (select count(*) from af_option_truth_table() where label like 'amenity:%');
  end if;

  -- 7. the registry describes every chip
  insert into public.af_field_registry
    (canonical_key, label_ar, category, datatype, unknown_policy, ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
  select token, label_ar, 'amenity', 'boolean', 'NULL', true, 'more_options', null,
         'Countryside + residential-land group chip (owner 2026-11-02). ' || case when kind = 'bool' then 'af_rule_b(NULL box, the ad''s quoted words); IS TRUE token.' else 'Derived predicate token: ' || pred end,
         'advanced'
    from _cs_tokens
  on conflict (canonical_key) do update
    set ui_exposed = true, ui_group = 'more_options', not_exposed_reason = null, filter_tier = 'advanced',
        label_ar = excluded.label_ar, concept_note = excluded.concept_note, category = excluded.category, datatype = excluded.datatype;

  raise notice 'SUCCESS: 60 countryside tokens live on af_eligibility_clause + top_cities_by_deal_ar; counts in the scoped CTE; af_canon packs 58 new columns; split_payments chip==referee==direct (%); parity 0; cohort % unchanged', v_chip, before_n;
end $do$;

drop table _cs_tokens;
