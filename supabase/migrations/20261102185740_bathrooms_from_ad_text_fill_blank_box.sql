-- BATHROOMS FROM THE AD'S OWN WORDS FILL A BLANK BOX (backlog 1168, owner 2026-11-02: every ad in «الشقق والسكن المشترك»
-- states its bathrooms at the source, we must carry it). Measured 11-02: 108,875 of 260,131 group ads (42 %) carried a
-- count; the sites state it but often only in the description — aqar 6863619 has no bathroom box and says «ثلاث دورات
-- مياه», muhaysini 6040 «دورتا مياه (2)», dealapp 586613 «دورتين مياه».
-- Same Rule B path as street_width_m (2026-10-25) and apartments_count / shops_count (2026-11-01), nothing new:
--   * the nightly word checker (scrapers/facts/word_checker.py) emits ONE agreed count per ad with its quote — never a
--     pool («حمام سباحة»), an outside / annex toilet, a per-unit count («كل شقة 2 دورات مياه»), or two different
--     counts (no sum, no pick); 1..20;
--   * text_facts_af_num_columns() admits 'bathrooms', the CHECK admits a JSON number 1..20 with its quote;
--   * listing_text_facts_af exposes it behind the same numbers switch (text_facts_street_width_on());
--   * sync_search_listings_ar writes AND compares af_rule_b_num(v.bathrooms, tf.bathrooms): the site's own number is
--     never replaced, the text fills a blank box only. Source tables are untouched (PRICE/PERIOD/… = SOURCE holds).
set local lock_timeout = '15s';
create or replace function public.text_facts_af_num_columns()
returns text[] language sql immutable parallel safe as $$
  select array['street_width_m','apartments_count','shops_count','bathrooms']::text[]
$$;
comment on function public.text_facts_af_num_columns() is
  'The NUMERIC search-index columns an ad''s text may fill (Rule B for numbers: a blank box only). street_width_m since 2026-10-25; apartments_count, shops_count since 2026-11-01; bathrooms since 2026-11-02 (backlog 1168).';

create or replace function public.text_facts_all_quoted(p jsonb)
returns boolean language sql immutable parallel safe as $$
  select coalesce(jsonb_typeof(p), '') = 'object' and not exists (
    select 1 from jsonb_each(p) e
     where not (   (e.key = any (public.text_facts_af_columns())
                    and coalesce(jsonb_typeof(e.value -> 'v'), '') = 'boolean')
                or (e.key = any (public.text_facts_af_num_columns())
                    and coalesce(jsonb_typeof(e.value -> 'v'), '') = 'number'
                    and (case when jsonb_typeof(e.value -> 'v') = 'number' then (e.value ->> 'v')::numeric end)
                        between (case e.key when 'street_width_m' then 4 when 'apartments_count' then 2 when 'shops_count' then 1 when 'bathrooms' then 1 end)
                            and (case e.key when 'street_width_m' then 150 when 'apartments_count' then 500 when 'shops_count' then 300 when 'bathrooms' then 20 end)))
        or coalesce(length(btrim(e.value ->> 'q')), 0) = 0)
$$;

do $guard$
begin
  -- the view must still be exactly what the repo last defined (another session may have added a column since)
  if (select string_agg(attname, ',' order by attnum) from pg_attribute
       where attrelid = 'public.listing_text_facts_af'::regclass and attnum > 0 and not attisdropped)
     <> 'source_table,listing_id,furnished,elevator,parking,kitchen,air_conditioner,maid_room,driver_room,private_entrance,separate_electricity_meter,separate_water_meter,electricity,water_supply,sanitation,balcony,laundry_room,pool,gym,garden,car_entrance,optical_fibers,street_width_m,majlis,roof,two_entrances,annex,yard,garage,grill,storage,water_tank,warranty,electronic_deed,basement,self_checkin,wifi,bills_included,jacuzzi,smart_tv,billiards,cleaning_service,soundproof,cameras,guard,smart_entry,smart_home,central_gas,sauna,kids_play_area,nursery,free_maintenance,intercom,fire_system,ev_charger,central_vacuum,insulation,dining_majlis,own_bathroom,fridge,whole_floor,singles,families,apartments_count,shops_count,women_majlis,outdoor_kitchen,outdoor_diwaniya,waterfall,well,irrigation,sports_court,split_payments,heated_pool,kids_pool,water_slide,sea_view,football_pitch,playstation,inflatable_games,sound_system,fire_pit,bait_shaar,mandi_pit,outdoor_seating,tent,dunes_view,women_section,two_sections,events_hall,privacy_screen,trees,for_families,for_youth,for_events,for_newlyweds,quad_bikes,horses_stable,camels,toilets_on_site,lighting,artesian_well,solar_power,palms,fruit_trees,fodder_crops,greenhouses,producing_farm,animal_pens,poultry,farm_house,farm_rest_house,workers_housing,fence,main_road,good_soil,corner_plot,three_streets,ready_to_build,raised_plot,residential_commercial,all_services,asphalt,street_lights,approved_plan,direct_owner,inside_project,floors_allowed,grant_land,no_services,mezzanine,pantry,glass_front,frontage,in_mall,in_tower,license,food_allowed,takeover,first_tenant,internet,civil_defense,high_ceiling,hangar,insulated_panel,cold_storage,concrete_floor,loading_dock,big_gate,truck_access,crane,racks,office_inside,heavy_power,industrial_area,car_service,meeting_room,reception,coworking,private_office,central_ac,shops_inside,offices_inside,apartments_inside,staff_housing_inside,restaurant_cafe,car_wash,market,earning_income,stars_mentioned,rooms_suites,oil_change,pumps,mosque,building_rules' then
    raise exception 'listing_text_facts_af moved since 20261102101415; rebase this migration';
  end if;
  if public.text_facts_all_quoted('{"bathrooms": {"v": 0, "q": "x"}}'::jsonb)
     or public.text_facts_all_quoted('{"bathrooms": {"v": 21, "q": "x"}}'::jsonb)
     or public.text_facts_all_quoted('{"bathrooms": {"v": 3}}'::jsonb)
     or not public.text_facts_all_quoted('{"bathrooms": {"v": 3, "q": "ثلاث دورات مياه"}, "street_width_m": {"v": 20, "q": "شارع 20"}}'::jsonb) then
    raise exception 'text_facts_all_quoted: bathrooms bounds wrong';
  end if;
end
$guard$;

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
       public.text_fact_bool(f.facts, 'building_rules') as building_rules,
       case when public.text_facts_street_width_on() then public.text_fact_num(f.facts, 'bathrooms')::smallint end as bathrooms
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);

-- sync_search_listings_ar: the text count fills a BLANK box, in the value written AND in the change detection
-- (patched on the live body; fails closed if either expression is not found exactly once)
do $mig$
declare
  d text := pg_get_functiondef('public.sync_search_listings_ar()'::regprocedure);
  w_old constant text := 'v.area_m2, v.bedrooms, v.bathrooms,';
  w_new constant text := 'v.area_m2, v.bedrooms, public.af_rule_b_num(v.bathrooms::smallint, tf.bathrooms),';
  c_old constant text := 'or s3.bathrooms is distinct from v.bathrooms';
  c_new constant text := 'or s3.bathrooms is distinct from public.af_rule_b_num(v.bathrooms::smallint, tf.bathrooms)';
begin
  if (length(d) - length(replace(d, w_old, ''))) / length(w_old) <> 1
     or (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'sync_search_listings_ar: bathrooms expressions not found exactly once';
  end if;
  execute replace(replace(d, w_old, w_new), c_old, c_new);
  if position('af_rule_b_num(v.bathrooms::smallint, tf.bathrooms)' in pg_get_functiondef('public.sync_search_listings_ar()'::regprocedure)) = 0 then
    raise exception 'sync_search_listings_ar: bathrooms merge did not land';
  end if;
end
$mig$;
