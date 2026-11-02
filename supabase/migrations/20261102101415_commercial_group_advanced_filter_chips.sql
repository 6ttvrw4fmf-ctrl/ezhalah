-- THE COMMERCIAL GROUP CHIPS (owner lists 2026-11-01, built 2026-11-02). One migration, the shape of the villas migration
-- (20261102055240) and of the countryside migration that runs right BEFORE it (the one that taught split_payments … no_services,
-- camels_horses, palm_fruit_trees): 45 new boolean text facts the free word reader learns in its own PR (mezzanine … building_rules:
-- shop / office / warehouse / building / hotel / fuel-station facts), ONE derived predicate token over columns already served
-- (pool_gym = pool or gym), and THREE street-width rungs (10+, 40+, 60+) built exactly like the 30+ rung. 46 tokens + 3 rungs.
--
-- RULE B unchanged: served = af_rule_b(box, the ad's quoted words). None of the 45 has a site box, so listing_rich_attrs gains a
-- NULL column per key and sync_listing_rich_attrs (hourly via sync_all_rich_attrs) merges and copies it like every other Rule B
-- column — its merged_list reads text_facts_af_columns() at run time, so it needs no edit here. The free word reader
-- (scrapers/facts/words.py AF_COLUMNS) is the ONLY writer; text_facts_all_quoted admits a key only with the ad's quote and reads
-- the same list, so it needs no edit either.
--
-- Checked live before drafting (2026-11-02): none of the 45 keys is a search_listings_ar / listing_rich_attrs /
-- listing_text_facts_af column, none is in text_facts_af_columns(), none has an af_field_registry row, zero listing_text_facts rows
-- carry any of them. pool and gym are served columns. cnt_stw30's returns needle and select line occur exactly once in the
-- apartment_guided_counts_ar template; the street_width:30+ row occurs once in the sweep and once in the truth table.
--
-- ORDER: this migration runs AFTER the countryside migration. Every needle below is the string that file BUILDS (its whitelist
-- tail, its last predicate arm, its scoped-CTE tail, its returns tail, its last select line, its af_canon tail, its last sweep /
-- truth-table rows, its apply_slice tails) — not the villas strings. The md5 guards are the bodies as the countryside migration
-- leaves them; every needle must occur exactly once or nothing changes.
--
-- WHAT CHANGES
--   1. listing_rich_attrs.<key> NULL boxes; search_listings_ar.<key> boolean (served).
--   2. text_facts_af_columns() = 170 keys; listing_text_facts_af / text_facts_apply_slice over the full list.
--   3. af_eligibility_clause() whitelist + one arm per token; top_cities_by_deal_ar (its copy); rebuild_af_filter_rpcs(); parity 0.
--   4. apartment_guided_counts_ar template: s.<col> in the scoped CTE, cnt_<token>, and cnt_stw10 / cnt_stw40 / cnt_stw60 next to
--      cnt_stw30 (p_street_width_min already exists; the rung is a count, not a new parameter).
--   5. location_search_candidates_ar template packs every new column into af_canon: a SIXTH and a SEVENTH jsonb_build_object
--      joined with || (29 + 16 pairs; one call takes at most 100 arguments).
--   6. ops_af_option_truth_sweep + af_option_truth_table learn amenity:<token> and street_width:10+/40+/60+;
--      af_option_vocab_drift() = 0; 183 amenity rows (137 + 46); 7 street_width rows.
--   7. af_field_registry rows; self-check chip == referee == direct (mezzanine), chip == referee (pool_gym); garbage 0.
--   8. af_cohort_registry: the 11 countryside / commercial cohorts the owner listed on 2026-11-01 (on conflict do nothing).
-- Client half (afCohorts.ts, advancedFilters.ts, afEvidence/afSummary/ResultCard/i18n, remote.ts GuidedCounts, sql/mirrors
-- af_eligibility_clause.sql + af_canon_select.sql, barriers) and the reader half ship in their own PRs; mirrored byte-exact
-- in mirror/<version>.

create temp table _com_tokens (ord int, token text, kind text, pred text, flt text, direct text, label_ar text);
insert into _com_tokens (ord, token, kind, label_ar) values
  (1,'mezzanine','bool','ميزانين'),
  (2,'pantry','bool','بوفيه / مطبخ تحضيري'),
  (3,'glass_front','bool','واجهة زجاجية'),
  (4,'frontage','bool','واجهة'),
  (5,'in_mall','bool','داخل مول أو مجمع'),
  (6,'in_tower','bool','داخل برج'),
  (7,'license','bool','رخصة / سجل تجاري'),
  (8,'food_allowed','bool','يصلح مطعم أو كافيه'),
  (9,'takeover','bool','تقبيل'),
  (10,'first_tenant','bool','جديد / أول مستأجر'),
  (11,'internet','bool','إنترنت'),
  (12,'civil_defense','bool','دفاع مدني'),
  (13,'high_ceiling','bool','سقف عالي'),
  (14,'hangar','bool','هنجر'),
  (15,'insulated_panel','bool','ساندوتش بانل'),
  (16,'cold_storage','bool','تبريد'),
  (17,'concrete_floor','bool','أرضية خرسانة أو إيبوكسي'),
  (18,'loading_dock','bool','رصيف تحميل'),
  (19,'big_gate','bool','بوابة كبيرة'),
  (20,'truck_access','bool','دخول الشاحنات'),
  (21,'crane','bool','رافعة'),
  (22,'racks','bool','أرفف'),
  (23,'office_inside','bool','مكتب داخلي'),
  (24,'heavy_power','bool','قوة كهربائية / 3 فاز'),
  (25,'industrial_area','bool','في المنطقة الصناعية'),
  (26,'car_service','bool','يصلح لخدمات السيارات'),
  (27,'meeting_room','bool','قاعة اجتماعات'),
  (28,'reception','bool','استقبال'),
  (29,'coworking','bool','مساحة عمل مشتركة'),
  (30,'private_office','bool','مكتب خاص'),
  (31,'central_ac','bool','تكييف مركزي'),
  (32,'shops_inside','bool','محلات'),
  (33,'offices_inside','bool','مكاتب'),
  (34,'apartments_inside','bool','شقق'),
  (35,'staff_housing_inside','bool','سكن موظفين'),
  (36,'restaurant_cafe','bool','مطعم / كافيه'),
  (37,'car_wash','bool','مغسلة سيارات'),
  (38,'market','bool','بقالة / ماركت'),
  (39,'earning_income','bool','مؤجر / دخل'),
  (40,'stars_mentioned','bool','نجوم'),
  (41,'rooms_suites','bool','غرف وأجنحة'),
  (42,'oil_change','bool','تغيير زيت'),
  (43,'pumps','bool','مضخات'),
  (44,'mosque','bool','مسجد'),
  (45,'building_rules','bool','نظام البناء');
update _com_tokens set pred = 's.' || token, flt = token, direct = 's.' || token || ' is true' where kind = 'bool';
insert into _com_tokens values
  (46,'pool_gym','derived','(s.pool or s.gym)','(pool or gym)','(s.pool is true or s.gym is true)','مسبح أو صالة رياضية');
do $$
begin
  if (select count(*) from _com_tokens where kind = 'bool') <> 45 or (select count(*) from _com_tokens) <> 46 then
    raise exception 'token table miscounted: % bool / % total', (select count(*) from _com_tokens where kind = 'bool'), (select count(*) from _com_tokens);
  end if;
  if (select count(distinct token) from _com_tokens) <> 46 then raise exception 'token table carries a duplicate token'; end if;
end $$;

-- ── 0. the countryside migration must already be in place (this one builds on the strings it leaves) ────
do $$
begin
  if not ('no_services' = any (public.text_facts_af_columns())) or not ('split_payments' = any (public.text_facts_af_columns())) then
    raise exception 'ABORT: the countryside migration has not been applied — this migration runs after it';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'search_listings_ar' and column_name = 'pool')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'search_listings_ar' and column_name = 'gym') then
    raise exception 'ABORT: search_listings_ar has no pool / gym column for the derived pool_gym token';
  end if;
end $$;

-- ── 1. the NULL boxes and the served columns ────────────────────────────────────────────────────────────
do $$
declare v text; boxes text; k text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_rich_attrs' and column_name = 'mezzanine') then
    raise notice 'listing_rich_attrs already carries the commercial chips — view step skipped';
  else
    select string_agg(format('null::boolean as %I', token), ', ' order by ord) into boxes from _com_tokens t where kind = 'bool'
       and not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'listing_rich_attrs' and c.column_name = t.token);
    v := regexp_replace(pg_get_viewdef('public.listing_rich_attrs'::regclass, true), ';\s*$', '');
    execute 'create or replace view public.listing_rich_attrs as select v.*, ' || boxes || ' from (' || v || ') v';
  end if;
  for k in select token from _com_tokens where kind = 'bool' order by ord loop
    execute format('alter table public.search_listings_ar add column if not exists %I boolean', k);
    execute format('comment on column public.search_listings_ar.%I is %L', k,
      'Advanced Filter amenity (owner 2026-11-01, commercial group): af_rule_b(NULL box, the ad''s quoted words via listing_text_facts_af.' || k || '). Positive-only IS TRUE token; NULL = unknown.');
  end loop;
  for k in select token from _com_tokens where kind = 'bool' loop
    if not (k = any (public._rich_attr_columns())) then
      raise exception '_rich_attr_columns() does not derive % — the two columns are not both in place', k;
    end if;
  end loop;
end $$;

-- ── 2. the text overlay learns every key ────────────────────────────────────────────────────────────────
do $$
declare k text;
begin
  if md5(pg_get_functiondef('public.text_facts_af_columns()'::regprocedure)) <> 'fe4d85b1a080adf1beaf3f9d6fdf2721' then
    raise exception 'text_facts_af_columns moved since the countryside migration; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.text_facts_apply_slice(text,bigint,bigint)'::regprocedure)) <> '000083018008a7a31a0f14dda1ea0a55' then
    raise exception 'text_facts_apply_slice moved since the countryside migration; rebase this migration';
  end if;
  if md5(pg_get_viewdef('public.listing_text_facts_af'::regclass, true)) <> 'b5e1ffd693b1f049c869abe2c97c8467' then
    raise exception 'listing_text_facts_af moved since the countryside migration; rebase this migration';
  end if;
  for k in select token from _com_tokens where kind = 'bool' loop
    if k = any (public.text_facts_af_columns()) then
      raise exception '% is already an AF column; drop it from _com_tokens and the overlay before applying', k;
    end if;
  end loop;
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
               'inside_project','floors_allowed','grant_land','no_services',
               'mezzanine','pantry','glass_front','frontage','in_mall','in_tower',
               'license','food_allowed','takeover','first_tenant','internet','civil_defense',
               'high_ceiling','hangar','insulated_panel','cold_storage','concrete_floor','loading_dock',
               'big_gate','truck_access','crane','racks','office_inside','heavy_power',
               'industrial_area','car_service','meeting_room','reception','coworking','private_office',
               'central_ac','shops_inside','offices_inside','apartments_inside','staff_housing_inside','restaurant_cafe',
               'car_wash','market','earning_income','stars_mentioned','rooms_suites','oil_change',
               'pumps','mosque','building_rules']::text[]
$$;
do $$
begin
  if array_length(public.text_facts_af_columns(), 1) <> 170 then
    raise exception 'text_facts_af_columns() has % keys, expected 170', array_length(public.text_facts_af_columns(), 1);
  end if;
  if (select count(*) from unnest(public.text_facts_af_columns()) k) <> (select count(distinct k) from unnest(public.text_facts_af_columns()) k) then
    raise exception 'text_facts_af_columns() carries a duplicate key';
  end if;
  if public.text_facts_all_quoted('{"mezzanine": {"v": true, "q": ""}}'::jsonb)
     or public.text_facts_all_quoted('{"building_rules": {"v": 1, "q": "نظام البناء"}}'::jsonb)
     or not public.text_facts_all_quoted('{"hangar": {"v": true, "q": "هنجر"}, "no_services": {"v": true, "q": "بدون خدمات"}, "wifi": {"v": true, "q": "واي فاي"}}'::jsonb) then
    raise exception 'text_facts_all_quoted does not admit the new keys as intended';
  end if;
end $$;

-- the overlay view: every existing column keeps its position; the 45 commercial keys are appended after the countryside keys.
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
       public.text_fact_bool(f.facts, 'no_services') as no_services,
       public.text_fact_bool(f.facts, 'mezzanine') as mezzanine,
       public.text_fact_bool(f.facts, 'pantry') as pantry,
       public.text_fact_bool(f.facts, 'glass_front') as glass_front,
       public.text_fact_bool(f.facts, 'frontage') as frontage,
       public.text_fact_bool(f.facts, 'in_mall') as in_mall,
       public.text_fact_bool(f.facts, 'in_tower') as in_tower,
       public.text_fact_bool(f.facts, 'license') as license,
       public.text_fact_bool(f.facts, 'food_allowed') as food_allowed,
       public.text_fact_bool(f.facts, 'takeover') as takeover,
       public.text_fact_bool(f.facts, 'first_tenant') as first_tenant,
       public.text_fact_bool(f.facts, 'internet') as internet,
       public.text_fact_bool(f.facts, 'civil_defense') as civil_defense,
       public.text_fact_bool(f.facts, 'high_ceiling') as high_ceiling,
       public.text_fact_bool(f.facts, 'hangar') as hangar,
       public.text_fact_bool(f.facts, 'insulated_panel') as insulated_panel,
       public.text_fact_bool(f.facts, 'cold_storage') as cold_storage,
       public.text_fact_bool(f.facts, 'concrete_floor') as concrete_floor,
       public.text_fact_bool(f.facts, 'loading_dock') as loading_dock,
       public.text_fact_bool(f.facts, 'big_gate') as big_gate,
       public.text_fact_bool(f.facts, 'truck_access') as truck_access,
       public.text_fact_bool(f.facts, 'crane') as crane,
       public.text_fact_bool(f.facts, 'racks') as racks,
       public.text_fact_bool(f.facts, 'office_inside') as office_inside,
       public.text_fact_bool(f.facts, 'heavy_power') as heavy_power,
       public.text_fact_bool(f.facts, 'industrial_area') as industrial_area,
       public.text_fact_bool(f.facts, 'car_service') as car_service,
       public.text_fact_bool(f.facts, 'meeting_room') as meeting_room,
       public.text_fact_bool(f.facts, 'reception') as reception,
       public.text_fact_bool(f.facts, 'coworking') as coworking,
       public.text_fact_bool(f.facts, 'private_office') as private_office,
       public.text_fact_bool(f.facts, 'central_ac') as central_ac,
       public.text_fact_bool(f.facts, 'shops_inside') as shops_inside,
       public.text_fact_bool(f.facts, 'offices_inside') as offices_inside,
       public.text_fact_bool(f.facts, 'apartments_inside') as apartments_inside,
       public.text_fact_bool(f.facts, 'staff_housing_inside') as staff_housing_inside,
       public.text_fact_bool(f.facts, 'restaurant_cafe') as restaurant_cafe,
       public.text_fact_bool(f.facts, 'car_wash') as car_wash,
       public.text_fact_bool(f.facts, 'market') as market,
       public.text_fact_bool(f.facts, 'earning_income') as earning_income,
       public.text_fact_bool(f.facts, 'stars_mentioned') as stars_mentioned,
       public.text_fact_bool(f.facts, 'rooms_suites') as rooms_suites,
       public.text_fact_bool(f.facts, 'oil_change') as oil_change,
       public.text_fact_bool(f.facts, 'pumps') as pumps,
       public.text_fact_bool(f.facts, 'mosque') as mosque,
       public.text_fact_bool(f.facts, 'building_rules') as building_rules
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);
comment on view public.listing_text_facts_af is
  'Rule B overlay input: the ad-text value per Advanced Filter column (170 booleans + street_width_m, apartments_count, shops_count), only with its quote, never from changed text, empty when ops_feature_flags.af_text_facts_overlay is off; street_width_m / majlis each behind their own switch.';
do $$
declare k text;
begin
  for k in select token from _com_tokens where kind = 'bool' loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_text_facts_af' and column_name = k) then
      raise exception 'listing_text_facts_af does not carry %', k;
    end if;
  end loop;
end $$;

-- text_facts_apply_slice: the 45 commercial keys join the merge select, the set list and both change-detection tuples
-- (needles = the tails the countryside migration left: its last key is no_services)
do $mig$
declare src text; fn text; needle text; repl text; n int; k text;
begin
  fn := 'public.text_facts_apply_slice(text,bigint,bigint)';
  src := pg_get_functiondef(fn::regprocedure);

  needle := $x$             public.af_rule_b(r.no_services, tf.no_services) as no_services$x$;
  select needle || ',' || E'\n' || string_agg(format('             public.af_rule_b(r.%1$I, tf.%1$I) as %1$I', token), ',' || E'\n' order by ord)
    into repl from _com_tokens where kind = 'bool';
  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then raise exception '%: merge-select needle found % times, expected 1', fn, n; end if;
  src := replace(src, needle, repl);

  needle := $x$no_services = m.no_services$x$;
  select needle || ', ' || string_agg(format('%1$I = m.%1$I', token), ', ' order by ord) into repl from _com_tokens where kind = 'bool';
  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then raise exception '%: set-list needle found % times, expected 1', fn, n; end if;
  src := replace(src, needle, repl);

  foreach k in array array['s', 'm'] loop
    needle := k || '.no_services)';
    select k || '.no_services, ' || string_agg(k || '.' || token, ', ' order by ord) || ')' into repl from _com_tokens where kind = 'bool';
    n := (length(src) - length(replace(src, needle, ''))) / length(needle);
    if n <> 1 then raise exception '%: % tuple needle found % times, expected 1', fn, k, n; end if;
    src := replace(src, needle, repl);
  end loop;
  execute src;
  if position('tf.building_rules) as building_rules' in pg_get_functiondef(fn::regprocedure)) = 0 then
    raise exception '%: the rebuilt applier does not merge building_rules', fn;
  end if;
end $mig$;

-- ── 3.–8. the Advanced Filter surfaces, exactly as the countryside migration did, the strings built from _com_tokens ──
do $do$
declare
  wl_old text := $x$'palm_fruit_trees','furnished','rnpl','rent_now_pay_later'))$x$;
  wl_new text;
  pred_old text := $x$           and (not ('palm_fruit_trees' = any(p_amenities)) or (s.palms or s.fruit_trees))$x$;
  pred_new text;
  scoped_old text := $x$s.no_services, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  scoped_new text;
  ret_old text := $x$cnt_palm_fruit_trees bigint, cnt_selected bigint$x$;
  ret_new text;
  sel_old text := $x$    count(*) filter (where (palms or fruit_trees)) as cnt_palm_fruit_trees,$x$;
  sel_new text;
  -- the street-width rungs sit next to the 30+ rung, exactly as it is produced and swept
  stw_ret_old text := $x$cnt_stw30 bigint, $x$;
  stw_ret_new text := $x$cnt_stw30 bigint, cnt_stw10 bigint, cnt_stw40 bigint, cnt_stw60 bigint, $x$;
  stw_sel_old text := $x$    count(*) filter (where street_width_m >= 30)            as cnt_stw30,$x$;
  stw_sel_new text := $x$    count(*) filter (where street_width_m >= 30)            as cnt_stw30,
    count(*) filter (where street_width_m >= 10)            as cnt_stw10,
    count(*) filter (where street_width_m >= 40)            as cnt_stw40,
    count(*) filter (where street_width_m >= 60)            as cnt_stw60,$x$;
  stw_sweep_old text := $x$        ('street_width:30+','cnt_stw30','p_street_width_min:=30::smallint','s.street_width_m >= 30'),$x$;
  stw_sweep_new text := $x$        ('street_width:30+','cnt_stw30','p_street_width_min:=30::smallint','s.street_width_m >= 30'),
        ('street_width:10+','cnt_stw10','p_street_width_min:=10::smallint','s.street_width_m >= 10'),
        ('street_width:40+','cnt_stw40','p_street_width_min:=40::smallint','s.street_width_m >= 40'),
        ('street_width:60+','cnt_stw60','p_street_width_min:=60::smallint','s.street_width_m >= 60'),$x$;
  stw_tt_old text := $x$    ('street_width:30+','cnt_stw30','p_street_width_min:=30::smallint','s.street_width_m >= 30','guided'),$x$;
  stw_tt_new text := $x$    ('street_width:30+','cnt_stw30','p_street_width_min:=30::smallint','s.street_width_m >= 30','guided'),
    ('street_width:10+','cnt_stw10','p_street_width_min:=10::smallint','s.street_width_m >= 10','guided'),
    ('street_width:40+','cnt_stw40','p_street_width_min:=40::smallint','s.street_width_m >= 40','guided'),
    ('street_width:60+','cnt_stw60','p_street_width_min:=60::smallint','s.street_width_m >= 60','guided'),$x$;
  canon_old text := $x$'no_services', s.no_services) end as af_canon$x$;
  canon_new text; canon_a text; canon_b text;
  sweep_old text := $x$        ('amenity:palm_fruit_trees','cnt_palm_fruit_trees','p_amenities:=array[''palm_fruit_trees'']','(s.palms is true or s.fruit_trees is true)'),$x$;
  sweep_add text;
  tt_old text := $x$    ('amenity:palm_fruit_trees','cnt_palm_fruit_trees','p_amenities:=array[''palm_fruit_trees'']','(s.palms is true or s.fruit_trees is true)','guided'),$x$;
  tt_add text;
  cols text; toks text; clause text; tcbd_def text; tpl text; sweep_def text; tt_def text; occ int;
  before_n bigint; after_n bigint; parity int; v_counts jsonb; v_chip bigint; v_ref bigint; v_direct bigint; v_garbage bigint; v_drift int; tok text;
  v_stw10 bigint; v_stw10_ref bigint; v_stw10_direct bigint; v_mezz bigint;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure)) <> 'fcba4a0e6cddf157b74cffa9cd00a01d' then
    raise exception 'ABORT: af_eligibility_clause moved since this migration was written (%)', md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure));
  end if;
  if md5(pg_get_functiondef('public.top_cities_by_deal_ar'::regproc)) <> '12e6f96930dd95c44f414f6b2bf80bae' then
    raise exception 'ABORT: top_cities_by_deal_ar moved since this migration was written';
  end if;
  if md5(pg_get_functiondef('public.ops_af_option_truth_sweep'::regproc)) <> '4e067781fd060103a2e7fb0403914cc4'
     or md5(pg_get_functiondef('public.af_option_truth_table'::regproc)) <> '482fe4ca7c0c57063e4464d08802ed15' then
    raise exception 'ABORT: the sweep or the truth table moved since this migration was written';
  end if;

  select string_agg(quote_literal(token), ',' order by ord) into toks from _com_tokens;
  wl_new := $x$'palm_fruit_trees',$x$ || toks || $x$,'furnished','rnpl','rent_now_pay_later'))$x$;
  select pred_old || E'\n' || string_agg(format('           and (not (%L = any(p_amenities)) or %s)', token, pred), E'\n' order by ord) into pred_new from _com_tokens;
  select string_agg('s.' || token, ', ' order by ord) into cols from _com_tokens where kind = 'bool';
  scoped_new := 's.no_services, ' || cols || ', s.rating, s.reviews_count, s.unit_subtype_ar';
  select 'cnt_palm_fruit_trees bigint, ' || string_agg('cnt_' || token || ' bigint', ', ' order by ord) || ', cnt_selected bigint' into ret_new from _com_tokens;
  select sel_old || E'\n' || string_agg(format('    count(*) filter (where %s) as cnt_%s,', flt, token), E'\n' order by ord) into sel_new from _com_tokens;
  -- a sixth and a seventh jsonb_build_object joined with || : one call takes at most 100 arguments; 29 pairs = 58, 16 pairs = 32
  select string_agg(format('%L, s.%I', token, token), ', ' order by ord) into canon_a from _com_tokens where kind = 'bool' and ord <= 29;
  select string_agg(format('%L, s.%I', token, token), ', ' order by ord) into canon_b from _com_tokens where kind = 'bool' and ord > 29;
  if (select count(*) from _com_tokens where kind = 'bool' and ord <= 29) * 2 > 100 or (select count(*) from _com_tokens where kind = 'bool' and ord > 29) * 2 > 100 then
    raise exception 'ABORT: an af_canon jsonb_build_object would exceed 100 arguments';
  end if;
  canon_new := $x$'no_services', s.no_services) || jsonb_build_object($x$ || canon_a || $x$) || jsonb_build_object($x$ || canon_b || $x$) end as af_canon$x$;
  select sweep_old || E'\n' || string_agg(format('        (%L,%L,%L,%L),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into sweep_add from _com_tokens;
  select tt_old || E'\n' || string_agg(format('    (%L,%L,%L,%L,''guided''),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into tt_add from _com_tokens;

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

  -- 4. the guided-counts template: the tokens, then the three street-width rungs next to the 30+ rung
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
  if position('cnt_stw10' in tpl) > 0 or position('cnt_stw40' in tpl) > 0 or position('cnt_stw60' in tpl) > 0 then
    raise exception 'ABORT: the template already carries a 10+/40+/60+ street-width rung';
  end if;
  occ := (length(tpl) - length(replace(tpl, stw_ret_old, ''))) / length(stw_ret_old);
  if occ <> 1 then raise exception 'ABORT: street-width returns needle occurs %', occ; end if;
  tpl := replace(tpl, stw_ret_old, stw_ret_new);
  occ := (length(tpl) - length(replace(tpl, stw_sel_old, ''))) / length(stw_sel_old);
  if occ <> 1 then raise exception 'ABORT: street-width select needle occurs %', occ; end if;
  tpl := replace(tpl, stw_sel_old, stw_sel_new);
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
  if position('''mezzanine'', s.mezzanine' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0
     or position('''building_rules'', s.building_rules' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0 then
    raise exception 'ABORT: the rebuilt location_search_candidates_ar does not pack mezzanine / building_rules';
  end if;

  -- 7. chip == referee == direct on the fleet-wide base (the exact formula the villas migration used)
  select to_jsonb(g) into v_counts from apartment_guided_counts_ar() g;
  for tok in select token from _com_tokens loop
    if v_counts ->> ('cnt_' || tok) is null then raise exception 'ABORT: rebuilt RPC has no cnt_% column', tok; end if;
  end loop;
  foreach tok in array array['stw10', 'stw40', 'stw60'] loop
    if v_counts ->> ('cnt_' || tok) is null then raise exception 'ABORT: rebuilt RPC has no cnt_% column', tok; end if;
  end loop;
  v_chip := (v_counts ->> 'cnt_mezzanine')::bigint;
  select af_eligible_count(p_amenities:=array['mezzanine']) into v_ref;
  select count(*) into v_direct from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
     and s.mezzanine;
  if v_chip <> v_ref or v_ref <> v_direct then
    raise exception 'ABORT: mezzanine chip % / referee % / direct % disagree', v_chip, v_ref, v_direct;
  end if;
  v_mezz := v_chip;
  v_chip := (v_counts ->> 'cnt_pool_gym')::bigint;
  select af_eligible_count(p_amenities:=array['pool_gym']) into v_ref;
  if v_chip <> v_ref then raise exception 'ABORT: pool_gym chip % / referee % disagree', v_chip, v_ref; end if;
  -- the new street-width rung: chip == referee == direct, the same three-way check as a token
  v_stw10 := (v_counts ->> 'cnt_stw10')::bigint;
  select af_eligible_count(p_street_width_min:=10::smallint) into v_stw10_ref;
  select count(*) into v_stw10_direct from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
     and s.street_width_m >= 10;
  if v_stw10 <> v_stw10_ref or v_stw10_ref <> v_stw10_direct then
    raise exception 'ABORT: street_width:10+ chip % / referee % / direct % disagree', v_stw10, v_stw10_ref, v_stw10_direct;
  end if;
  if (v_counts ->> 'cnt_stw40')::bigint > (v_counts ->> 'cnt_stw30')::bigint or (v_counts ->> 'cnt_stw60')::bigint > (v_counts ->> 'cnt_stw40')::bigint
     or (v_counts ->> 'cnt_stw10')::bigint < (v_counts ->> 'cnt_stw15')::bigint then
    raise exception 'ABORT: street-width rungs are not monotone: 10+=% 15+=% 30+=% 40+=% 60+=%',
      v_counts ->> 'cnt_stw10', v_counts ->> 'cnt_stw15', v_counts ->> 'cnt_stw30', v_counts ->> 'cnt_stw40', v_counts ->> 'cnt_stw60';
  end if;
  select af_eligible_count(p_amenities:=array['garbage_token_zz']) into v_garbage;
  if v_garbage <> 0 then raise exception 'ABORT: af_eligible_count garbage token returned %', v_garbage; end if;
  if (select count(*) from top_cities_by_deal_ar(p_amenities:=array['garbage_token_zz'])) <> 0 then
    raise exception 'ABORT: top_cities_by_deal_ar garbage token returned rows';
  end if;

  -- 6. the runtime sweep and the in-DB truth table learn every token and the three rungs
  select pg_get_functiondef(p.oid) into sweep_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ops_af_option_truth_sweep';
  occ := (length(sweep_def) - length(replace(sweep_def, sweep_old, ''))) / length(sweep_old);
  if occ <> 1 then raise exception 'ABORT: sweep anchor occurs %', occ; end if;
  sweep_def := replace(sweep_def, sweep_old, sweep_add);
  occ := (length(sweep_def) - length(replace(sweep_def, stw_sweep_old, ''))) / length(stw_sweep_old);
  if occ <> 1 then raise exception 'ABORT: sweep street-width anchor occurs %', occ; end if;
  execute replace(sweep_def, stw_sweep_old, stw_sweep_new);
  select pg_get_functiondef(p.oid) into tt_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'af_option_truth_table';
  occ := (length(tt_def) - length(replace(tt_def, tt_old, ''))) / length(tt_old);
  if occ <> 1 then raise exception 'ABORT: truth-table anchor occurs %', occ; end if;
  tt_def := replace(tt_def, tt_old, tt_add);
  occ := (length(tt_def) - length(replace(tt_def, stw_tt_old, ''))) / length(stw_tt_old);
  if occ <> 1 then raise exception 'ABORT: truth-table street-width anchor occurs %', occ; end if;
  execute replace(tt_def, stw_tt_old, stw_tt_new);
  select count(*) into v_drift from af_option_vocab_drift();
  if v_drift <> 0 then
    raise exception 'ABORT: af_option_vocab_drift reports % row(s): %', v_drift,
      (select string_agg(d.side || ':' || d.label, ', ') from af_option_vocab_drift() d);
  end if;
  if (select count(*) from af_option_truth_table() where label like 'amenity:%') <> 183 then
    raise exception 'ABORT: expected 183 amenity rows in af_option_truth_table (137 + 46), got %', (select count(*) from af_option_truth_table() where label like 'amenity:%');
  end if;
  if (select count(*) from af_option_truth_table() where label like 'street_width:%') <> 7 then
    raise exception 'ABORT: expected 7 street_width rows in af_option_truth_table (10,15,20,25,30,40,60), got %', (select count(*) from af_option_truth_table() where label like 'street_width:%');
  end if;

  -- 7. the registry describes every chip
  insert into public.af_field_registry
    (canonical_key, label_ar, category, datatype, unknown_policy, ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
  select token, label_ar, 'amenity', 'boolean', 'NULL', true, 'more_options', null,
         'Commercial group chip (owner lists 2026-11-01, built 2026-11-02). ' || case when kind = 'bool' then 'af_rule_b(NULL box, the ad''s quoted words); IS TRUE token.' else 'Derived predicate token: ' || pred end,
         'advanced'
    from _com_tokens
  on conflict (canonical_key) do update
    set ui_exposed = true, ui_group = 'more_options', not_exposed_reason = null, filter_tier = 'advanced',
        label_ar = excluded.label_ar, concept_note = excluded.concept_note, category = excluded.category, datatype = excluded.datatype;

  -- 8. the cohorts the owner listed (unique key: deal_ar, coalesce(rent_period_ar,''), type_ar — a row already there is kept as is)
  insert into public.af_cohort_registry (type_ar, deal_ar, rent_period_ar, enabled, note) values
    ('استراحة',    'إيجار', 'شهري', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('شاليه',      'إيجار', 'شهري', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('شاليه',      'إيجار', 'سنوي', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('شاليه',      'بيع',   null,   true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('مخيم',       'إيجار', 'شهري', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('مزرعة',      'إيجار', 'سنوي', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('أرض زراعية', 'إيجار', 'سنوي', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('فندق',       'إيجار', 'سنوي', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('أرض تجارية', 'إيجار', 'سنوي', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('أرض صناعية', 'إيجار', 'سنوي', true, 'owner lists 2026-11-01, built 2026-11-02'),
    ('دوبلكس',     'إيجار', 'سنوي', true, 'owner lists 2026-11-01, built 2026-11-02')
  on conflict do nothing;
  if (select count(*) from public.af_cohort_registry where enabled and (
        (type_ar, deal_ar, coalesce(rent_period_ar, '')) in (('استراحة','إيجار','شهري'),('شاليه','إيجار','شهري'),('شاليه','إيجار','سنوي'),('شاليه','بيع',''),
                                                             ('مخيم','إيجار','شهري'),('مزرعة','إيجار','سنوي'),('أرض زراعية','إيجار','سنوي'),('فندق','إيجار','سنوي'),
                                                             ('أرض تجارية','إيجار','سنوي'),('أرض صناعية','إيجار','سنوي'),('دوبلكس','إيجار','سنوي')))) <> 11 then
    raise exception 'ABORT: the 11 owner cohorts are not all enabled in af_cohort_registry';
  end if;

  raise notice 'SUCCESS: 46 commercial tokens + 3 street-width rungs live on af_eligibility_clause + top_cities_by_deal_ar; counts in the scoped CTE; af_canon packs 45 new columns; mezzanine chip==referee==direct (%); stw10 chip==referee==direct (%); parity 0; cohort % unchanged', v_mezz, v_stw10, before_n;
end $do$;

drop table _com_tokens;
