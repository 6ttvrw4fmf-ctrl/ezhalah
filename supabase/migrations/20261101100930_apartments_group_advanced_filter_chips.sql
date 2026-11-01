-- THE APARTMENTS & CO-LIVING CHIPS (owner handoff 2026-10-31, built 2026-11-01). One migration, the shape of
-- 20261026011638 (majlis), for 39 boolean text facts (11 promoted from listing_facts storage: roof, two_entrances, annex,
-- yard, garage, grill, storage, water_tank, warranty, electronic_deed, basement; 28 new words the free word reader learns
-- in its own PR), 2 numeric facts (apartments_count, shops_count) and 6 derived predicate tokens (separate_meters = either
-- meter; apts4/8/12/20 = apartments_count ladder; has_shops = shops_count >= 1).
--
-- RULE B unchanged: served = af_rule_b(box, the ad's quoted words). None of these has a site box, so listing_rich_attrs
-- gains a NULL column per key and sync_listing_rich_attrs (hourly via sync_all_rich_attrs) merges and copies it like every
-- other Rule B column. The free word reader (scrapers/facts/words.py AF_COLUMNS) is the ONLY writer; text_facts_all_quoted
-- admits a new key only with the ad's own quote, numbers per-key bounded (apartments 2..500, shops 1..300).
--
-- WHAT CHANGES (every live body md5-guarded; every needle must occur exactly once or nothing changes)
--   1. listing_rich_attrs.<key> NULL boxes; search_listings_ar.<key> boolean / smallint (served).
--   2. text_facts_af_columns() = 60 keys; text_facts_af_num_columns() = 3; text_facts_all_quoted per-key bounds;
--      listing_text_facts_af / ops_text_facts_vs_index / text_facts_apply_slice over the full list;
--      sync_listing_rich_attrs merged_list learns af_rule_b_num for the numeric keys.
--   3. af_eligibility_clause() whitelist + one arm per token; top_cities_by_deal_ar (its copy); rebuild_af_filter_rpcs(); parity 0.
--   4. apartment_guided_counts_ar template: s.<col> in the scoped CTE, cnt_<token> (+ cnt_apts_unknown, cnt_shops_unknown).
--   5. location_search_candidates_ar template packs every new column into af_canon (the card's proof; a second
--      jsonb_build_object joined with ||, one call takes at most 100 arguments).
--   6. ops_af_option_truth_sweep + af_option_truth_table learn amenity:<token>; af_option_vocab_drift() = 0.
--   7. af_field_registry rows; self-check chip == referee == direct (roof), chip == referee (separate_meters); garbage 0.
-- Client half (afCohorts.ts COHORT_CARDS, advancedFilters.ts card questions, afEvidence/afSummary/ResultCard/i18n,
-- remote.ts GuidedCounts, sql/mirrors, barriers) and the reader half ship in their own PRs; mirrored byte-exact in mirror/<version>.

create temp table _apt_tokens (ord int, token text, kind text, pred text, flt text, direct text, label_ar text);
insert into _apt_tokens (ord, token, kind, label_ar) values
  (1,'roof','bool','سطح خاص'), (2,'two_entrances','bool','مدخلين'), (3,'annex','bool','ملحق'), (4,'yard','bool','حوش'),
  (5,'garage','bool','كراج'), (6,'grill','bool','مشب / شواية'), (7,'storage','bool','غرفة تخزين'), (8,'water_tank','bool','خزان ماء خاص'),
  (9,'warranty','bool','ضمانات'), (10,'electronic_deed','bool','صك إلكتروني'), (11,'basement','bool','قبو'),
  (12,'self_checkin','bool','دخول ذاتي'), (13,'wifi','bool','واي فاي'), (14,'bills_included','bool','الكهرباء والماء مشمولة'),
  (15,'jacuzzi','bool','جاكوزي'), (16,'smart_tv','bool','شاشة ذكية / سينما'), (17,'billiards','bool','طاولة بلياردو'),
  (18,'cleaning_service','bool','خدمة تنظيف'), (19,'soundproof','bool','عازل صوت'), (20,'cameras','bool','كاميرات مراقبة'),
  (21,'guard','bool','حارس'), (22,'smart_entry','bool','دخول ذكي'), (23,'smart_home','bool','منزل ذكي'), (24,'central_gas','bool','غاز مركزي'),
  (25,'sauna','bool','ساونا'), (26,'kids_play_area','bool','ألعاب أطفال'), (27,'nursery','bool','حضانة'), (28,'free_maintenance','bool','صيانة مجانية'),
  (29,'intercom','bool','انتركم'), (30,'fire_system','bool','نظام إطفاء'), (31,'ev_charger','bool','شاحن سيارات كهربائية'),
  (32,'central_vacuum','bool','مكنسة مركزية'), (33,'insulation','bool','عزل حراري ومائي'), (34,'dining_majlis','bool','مقلط'),
  (35,'own_bathroom','bool','دورة مياه خاصة'), (36,'fridge','bool','ثلاجة'), (37,'whole_floor','bool','دور كامل'),
  (38,'singles','bool','عزاب'), (39,'families','bool','عوائل');
update _apt_tokens set pred = 's.' || token, flt = token, direct = 's.' || token || ' is true' where kind = 'bool';
insert into _apt_tokens values
  (40,'separate_meters','derived','(s.separate_electricity_meter or s.separate_water_meter)','(separate_electricity_meter or separate_water_meter)','(s.separate_electricity_meter is true or s.separate_water_meter is true)','عدادات مستقلة'),
  (41,'apts4','derived','s.apartments_count >= 4','apartments_count >= 4','s.apartments_count >= 4','٤ شقق فأكثر'),
  (42,'apts8','derived','s.apartments_count >= 8','apartments_count >= 8','s.apartments_count >= 8','٨ شقق فأكثر'),
  (43,'apts12','derived','s.apartments_count >= 12','apartments_count >= 12','s.apartments_count >= 12','١٢ شقة فأكثر'),
  (44,'apts20','derived','s.apartments_count >= 20','apartments_count >= 20','s.apartments_count >= 20','٢٠ شقة فأكثر'),
  (45,'has_shops','derived','s.shops_count >= 1','shops_count >= 1','s.shops_count >= 1','محلات تجارية');

-- ── 1. the NULL boxes and the served columns ────────────────────────────────────────────────────────────
do $$
declare v text; boxes text; k text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_rich_attrs' and column_name = 'self_checkin') then
    raise notice 'listing_rich_attrs already carries the apartment chips — view step skipped';
  else
    select string_agg(format('null::boolean as %I', token), ', ' order by ord) into boxes from _apt_tokens where kind = 'bool';
    v := regexp_replace(pg_get_viewdef('public.listing_rich_attrs'::regclass, true), ';\s*$', '');
    execute 'create or replace view public.listing_rich_attrs as select v.*, ' || boxes
         || ', null::smallint as apartments_count, null::smallint as shops_count from (' || v || ') v';
  end if;
  for k in select token from _apt_tokens where kind = 'bool' order by ord loop
    execute format('alter table public.search_listings_ar add column if not exists %I boolean', k);
    execute format('comment on column public.search_listings_ar.%I is %L', k,
      'Advanced Filter amenity (owner 2026-10-31): af_rule_b(NULL box, the ad''s quoted words via listing_text_facts_af.' || k || '). Positive-only IS TRUE token; NULL = unknown.');
  end loop;
  foreach k in array array['apartments_count','shops_count'] loop
    execute format('alter table public.search_listings_ar add column if not exists %I smallint', k);
    execute format('comment on column public.search_listings_ar.%I is %L', k,
      'Advanced Filter number (owner 2026-10-31): the ad''s own ' || k || ' read by the free word reader; NULL = the ad did not say.');
  end loop;
  for k in select token from _apt_tokens where kind = 'bool' union all select unnest(array['apartments_count','shops_count']) loop
    if not (k = any (public._rich_attr_columns())) then
      raise exception '_rich_attr_columns() does not derive % — the two columns are not both in place', k;
    end if;
  end loop;
end $$;

-- ── 2. the text overlay learns every key ────────────────────────────────────────────────────────────────
do $$
begin
  if md5(pg_get_functiondef('public.text_facts_af_columns()'::regprocedure)) <> '60353bea05482c90e6ff3f3eb8a2f7b0' then
    raise exception 'text_facts_af_columns moved since 20261026011638; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.text_facts_af_num_columns()'::regprocedure)) <> '5dfaec34aa7cee85eeefac3612161ecd' then
    raise exception 'text_facts_af_num_columns moved since 20261025231203; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.text_facts_all_quoted(jsonb)'::regprocedure)) <> 'd4d15bacf22e247532aaaf6dad5ce333' then
    raise exception 'text_facts_all_quoted moved since 20261025231203; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.text_facts_apply_slice(text,bigint,bigint)'::regprocedure)) <> 'a6ef6a7f447b8f517e7dd27c7c35472f' then
    raise exception 'text_facts_apply_slice moved since 20261026011638; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.sync_listing_rich_attrs(text)'::regprocedure)) <> 'a9144ea1647b6a04bb4b5660b9404d75' then
    raise exception 'sync_listing_rich_attrs moved since 20261025205008; rebase this migration';
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
               'own_bathroom','fridge','whole_floor','singles','families']::text[]
$$;
create or replace function public.text_facts_af_num_columns()
returns text[] language sql immutable parallel safe as $$
  select array['street_width_m','apartments_count','shops_count']::text[]
$$;
comment on function public.text_facts_af_num_columns() is
  'The NUMERIC search-index columns an ad''s text may fill (Rule B for numbers: a blank box only). street_width_m since 2026-10-25; apartments_count, shops_count since 2026-11-01 (owner handoff 2026-10-31).';

create or replace function public.text_facts_all_quoted(p jsonb)
returns boolean language sql immutable parallel safe as $$
  select coalesce(jsonb_typeof(p), '') = 'object' and not exists (
    select 1 from jsonb_each(p) e
     where not (   (e.key = any (public.text_facts_af_columns())
                    and coalesce(jsonb_typeof(e.value -> 'v'), '') = 'boolean')
                or (e.key = any (public.text_facts_af_num_columns())
                    and coalesce(jsonb_typeof(e.value -> 'v'), '') = 'number'
                    and (case when jsonb_typeof(e.value -> 'v') = 'number' then (e.value ->> 'v')::numeric end)
                        between (case e.key when 'street_width_m' then 4 when 'apartments_count' then 2 when 'shops_count' then 1 end)
                            and (case e.key when 'street_width_m' then 150 when 'apartments_count' then 500 when 'shops_count' then 300 end)))
        or coalesce(length(btrim(e.value ->> 'q')), 0) = 0)
$$;
do $$
begin
  if public.text_facts_all_quoted('{"apartments_count": {"v": 1, "q": "شقة"}}'::jsonb)
     or public.text_facts_all_quoted('{"shops_count": {"v": 301, "q": "محل"}}'::jsonb)
     or public.text_facts_all_quoted('{"wifi": {"v": true, "q": ""}}'::jsonb)
     or public.text_facts_all_quoted('{"wifi": {"v": 1, "q": "واي فاي"}}'::jsonb)
     or public.text_facts_all_quoted('{"street_width_m": {"v": 2, "q": "شارع 2م"}}'::jsonb)
     or not public.text_facts_all_quoted('{"apartments_count": {"v": 12, "q": "عدد الشقق 12"}, "shops_count": {"v": 2, "q": "محلين"}, "wifi": {"v": true, "q": "واي فاي"}, "street_width_m": {"v": 20, "q": "شارع 20"}}'::jsonb) then
    raise exception 'text_facts_all_quoted does not bound the new keys as intended';
  end if;
end $$;

-- the overlay view: the 20 original booleans keep their positions, then street_width_m and majlis behind their switches,
-- then every later key, then the numbers (behind the numeric switch).
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
       case when public.text_facts_street_width_on() then public.text_fact_num(f.facts, 'shops_count')::smallint end as shops_count
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);
comment on view public.listing_text_facts_af is
  'Rule B overlay input: the ad-text value per Advanced Filter column (60 booleans + street_width_m, apartments_count, shops_count), only with its quote, never from changed text, empty when ops_feature_flags.af_text_facts_overlay is off; street_width_m / majlis each behind their own switch.';

create or replace view public.ops_text_facts_vs_index as
select f.source_table, f.listing_id, f.platform, f.listing_key, f.read_at, f.stale_at, e.key as col,
       (e.value ->> 'v')::boolean as text_value, e.value ->> 'q' as quote,
       s.listing_id is not null as in_index,
       (to_jsonb(s) ->> e.key)::boolean as index_value
  from public.listing_text_facts f
 cross join lateral jsonb_each(f.facts) e
  left join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id
 where e.key = any (public.text_facts_af_columns());

-- the batch applier over every column (the 8 box-from-listing_extra_attrs_mv columns keep their `e.` source)
create or replace function public.text_facts_apply_slice(p_source_table text, p_lo bigint, p_hi bigint)
returns integer language plpgsql as $$
declare n integer;
begin
  if p_source_table is null or p_source_table !~ '^[a-z0-9_]+_listings$' then
    raise exception 'p_source_table must be a bare <platform>_<kind>_listings identifier, got %', p_source_table;
  end if;
  if not public.search_index_writer_lock() then return null; end if;
  execute format($f$
    with m as (
      select s.source_table, s.listing_id,
             public.af_rule_b(e.furnished, tf.furnished) as furnished,
             public.af_rule_b(e.elevator, tf.elevator) as elevator,
             public.af_rule_b(e.parking, tf.parking) as parking,
             public.af_rule_b(e.kitchen, tf.kitchen) as kitchen,
             public.af_rule_b(e.air_conditioner, tf.air_conditioner) as air_conditioner,
             public.af_rule_b(e.maid_room, tf.maid_room) as maid_room,
             public.af_rule_b(e.driver_room, tf.driver_room) as driver_room,
             public.af_rule_b(e.private_entrance, tf.private_entrance) as private_entrance,
             public.af_rule_b(r.separate_electricity_meter, tf.separate_electricity_meter) as separate_electricity_meter,
             public.af_rule_b(r.separate_water_meter, tf.separate_water_meter) as separate_water_meter,
             public.af_rule_b(r.electricity, tf.electricity) as electricity,
             public.af_rule_b(r.water_supply, tf.water_supply) as water_supply,
             public.af_rule_b(r.sanitation, tf.sanitation) as sanitation,
             public.af_rule_b(r.balcony, tf.balcony) as balcony,
             public.af_rule_b(r.laundry_room, tf.laundry_room) as laundry_room,
             public.af_rule_b(r.pool, tf.pool) as pool,
             public.af_rule_b(r.gym, tf.gym) as gym,
             public.af_rule_b(r.garden, tf.garden) as garden,
             public.af_rule_b(r.car_entrance, tf.car_entrance) as car_entrance,
             public.af_rule_b(r.optical_fibers, tf.optical_fibers) as optical_fibers,
             public.af_rule_b(r.majlis, tf.majlis) as majlis,
             public.af_rule_b(r.roof, tf.roof) as roof,
             public.af_rule_b(r.two_entrances, tf.two_entrances) as two_entrances,
             public.af_rule_b(r.annex, tf.annex) as annex,
             public.af_rule_b(r.yard, tf.yard) as yard,
             public.af_rule_b(r.garage, tf.garage) as garage,
             public.af_rule_b(r.grill, tf.grill) as grill,
             public.af_rule_b(r.storage, tf.storage) as storage,
             public.af_rule_b(r.water_tank, tf.water_tank) as water_tank,
             public.af_rule_b(r.warranty, tf.warranty) as warranty,
             public.af_rule_b(r.electronic_deed, tf.electronic_deed) as electronic_deed,
             public.af_rule_b(r.basement, tf.basement) as basement,
             public.af_rule_b(r.self_checkin, tf.self_checkin) as self_checkin,
             public.af_rule_b(r.wifi, tf.wifi) as wifi,
             public.af_rule_b(r.bills_included, tf.bills_included) as bills_included,
             public.af_rule_b(r.jacuzzi, tf.jacuzzi) as jacuzzi,
             public.af_rule_b(r.smart_tv, tf.smart_tv) as smart_tv,
             public.af_rule_b(r.billiards, tf.billiards) as billiards,
             public.af_rule_b(r.cleaning_service, tf.cleaning_service) as cleaning_service,
             public.af_rule_b(r.soundproof, tf.soundproof) as soundproof,
             public.af_rule_b(r.cameras, tf.cameras) as cameras,
             public.af_rule_b(r.guard, tf.guard) as guard,
             public.af_rule_b(r.smart_entry, tf.smart_entry) as smart_entry,
             public.af_rule_b(r.smart_home, tf.smart_home) as smart_home,
             public.af_rule_b(r.central_gas, tf.central_gas) as central_gas,
             public.af_rule_b(r.sauna, tf.sauna) as sauna,
             public.af_rule_b(r.kids_play_area, tf.kids_play_area) as kids_play_area,
             public.af_rule_b(r.nursery, tf.nursery) as nursery,
             public.af_rule_b(r.free_maintenance, tf.free_maintenance) as free_maintenance,
             public.af_rule_b(r.intercom, tf.intercom) as intercom,
             public.af_rule_b(r.fire_system, tf.fire_system) as fire_system,
             public.af_rule_b(r.ev_charger, tf.ev_charger) as ev_charger,
             public.af_rule_b(r.central_vacuum, tf.central_vacuum) as central_vacuum,
             public.af_rule_b(r.insulation, tf.insulation) as insulation,
             public.af_rule_b(r.dining_majlis, tf.dining_majlis) as dining_majlis,
             public.af_rule_b(r.own_bathroom, tf.own_bathroom) as own_bathroom,
             public.af_rule_b(r.fridge, tf.fridge) as fridge,
             public.af_rule_b(r.whole_floor, tf.whole_floor) as whole_floor,
             public.af_rule_b(r.singles, tf.singles) as singles,
             public.af_rule_b(r.families, tf.families) as families,
             public.af_rule_b_num(r.apartments_count, tf.apartments_count) as apartments_count,
             public.af_rule_b_num(r.shops_count, tf.shops_count) as shops_count
        from public.search_listings_ar s
        join public.listing_extra_attrs_mv e on e.source_table = s.source_table and e.listing_id = s.listing_id
        join (select * from public.listing_rich_attrs where source_table = %1$L and listing_id between %2$s and %3$s) r
          on r.source_table = s.source_table and r.listing_id = s.listing_id
        left join public.listing_text_facts_af tf on tf.source_table = s.source_table and tf.listing_id = s.listing_id
       where s.source_table = %1$L and s.listing_id between %2$s and %3$s)
    update public.search_listings_ar s set
      furnished = m.furnished, elevator = m.elevator, parking = m.parking, kitchen = m.kitchen, air_conditioner = m.air_conditioner, maid_room = m.maid_room, driver_room = m.driver_room, private_entrance = m.private_entrance, separate_electricity_meter = m.separate_electricity_meter, separate_water_meter = m.separate_water_meter, electricity = m.electricity, water_supply = m.water_supply, sanitation = m.sanitation, balcony = m.balcony, laundry_room = m.laundry_room, pool = m.pool, gym = m.gym, garden = m.garden, car_entrance = m.car_entrance, optical_fibers = m.optical_fibers, majlis = m.majlis, roof = m.roof, two_entrances = m.two_entrances, annex = m.annex, yard = m.yard, garage = m.garage, grill = m.grill, storage = m.storage, water_tank = m.water_tank, warranty = m.warranty, electronic_deed = m.electronic_deed, basement = m.basement, self_checkin = m.self_checkin, wifi = m.wifi, bills_included = m.bills_included, jacuzzi = m.jacuzzi, smart_tv = m.smart_tv, billiards = m.billiards, cleaning_service = m.cleaning_service, soundproof = m.soundproof, cameras = m.cameras, guard = m.guard, smart_entry = m.smart_entry, smart_home = m.smart_home, central_gas = m.central_gas, sauna = m.sauna, kids_play_area = m.kids_play_area, nursery = m.nursery, free_maintenance = m.free_maintenance, intercom = m.intercom, fire_system = m.fire_system, ev_charger = m.ev_charger, central_vacuum = m.central_vacuum, insulation = m.insulation, dining_majlis = m.dining_majlis, own_bathroom = m.own_bathroom, fridge = m.fridge, whole_floor = m.whole_floor, singles = m.singles, families = m.families, apartments_count = m.apartments_count, shops_count = m.shops_count
      from m
     where s.source_table = m.source_table and s.listing_id = m.listing_id
       and (s.furnished, s.elevator, s.parking, s.kitchen, s.air_conditioner, s.maid_room, s.driver_room, s.private_entrance, s.separate_electricity_meter, s.separate_water_meter, s.electricity, s.water_supply, s.sanitation, s.balcony, s.laundry_room, s.pool, s.gym, s.garden, s.car_entrance, s.optical_fibers, s.majlis, s.roof, s.two_entrances, s.annex, s.yard, s.garage, s.grill, s.storage, s.water_tank, s.warranty, s.electronic_deed, s.basement, s.self_checkin, s.wifi, s.bills_included, s.jacuzzi, s.smart_tv, s.billiards, s.cleaning_service, s.soundproof, s.cameras, s.guard, s.smart_entry, s.smart_home, s.central_gas, s.sauna, s.kids_play_area, s.nursery, s.free_maintenance, s.intercom, s.fire_system, s.ev_charger, s.central_vacuum, s.insulation, s.dining_majlis, s.own_bathroom, s.fridge, s.whole_floor, s.singles, s.families, s.apartments_count, s.shops_count)
           is distinct from
           (m.furnished, m.elevator, m.parking, m.kitchen, m.air_conditioner, m.maid_room, m.driver_room, m.private_entrance, m.separate_electricity_meter, m.separate_water_meter, m.electricity, m.water_supply, m.sanitation, m.balcony, m.laundry_room, m.pool, m.gym, m.garden, m.car_entrance, m.optical_fibers, m.majlis, m.roof, m.two_entrances, m.annex, m.yard, m.garage, m.grill, m.storage, m.water_tank, m.warranty, m.electronic_deed, m.basement, m.self_checkin, m.wifi, m.bills_included, m.jacuzzi, m.smart_tv, m.billiards, m.cleaning_service, m.soundproof, m.cameras, m.guard, m.smart_entry, m.smart_home, m.central_gas, m.sauna, m.kids_play_area, m.nursery, m.free_maintenance, m.intercom, m.fire_system, m.ev_charger, m.central_vacuum, m.insulation, m.dining_majlis, m.own_bathroom, m.fridge, m.whole_floor, m.singles, m.families, m.apartments_count, m.shops_count)
  $f$, p_source_table, p_lo, p_hi);
  get diagnostics n = row_count;
  return n;
end $$;

-- sync_listing_rich_attrs: the numeric Rule B keys merge with af_rule_b_num (a NULL box takes the ad's number)
do $mig$
declare src text; fn text; needle text; repl text; n int;
begin
  fn := 'public.sync_listing_rich_attrs(text)';
  src := pg_get_functiondef(fn::regprocedure);
  needle := $x$  select string_agg(case when a.attname = any (public.text_facts_af_columns())
                         then format('public.af_rule_b(r0.%1$I, tf.%1$I) as %1$I', a.attname)
                         else format('r0.%I', a.attname) end, ', ' order by a.attnum)$x$;
  repl := $x$  select string_agg(case when a.attname = any (public.text_facts_af_columns())
                         then format('public.af_rule_b(r0.%1$I, tf.%1$I) as %1$I', a.attname)
                         when a.attname = any (public.text_facts_af_num_columns())
                         then format('public.af_rule_b_num(r0.%1$I, tf.%1$I) as %1$I', a.attname)
                         else format('r0.%I', a.attname) end, ', ' order by a.attnum)$x$;
  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then raise exception '%: merged_list needle found % times, expected 1', fn, n; end if;
  execute replace(src, needle, repl);
end $mig$;

-- ── 3.–7. the Advanced Filter surfaces, exactly as 20261026011638 did, the strings built from _apt_tokens ──
do $do$
declare
  wl_old text := $x$'majlis','furnished','rnpl','rent_now_pay_later'))$x$;
  wl_new text;
  pred_old text := $x$and (not ('majlis'                       = any(p_amenities)) or s.majlis)$x$;
  pred_new text;
  scoped_old text := $x$s.separate_water_meter, s.majlis, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  scoped_new text;
  ret_old text := $x$cnt_majlis bigint, cnt_selected bigint$x$;
  ret_new text;
  sel_old text := $x$    count(*) filter (where majlis)                          as cnt_majlis,$x$;
  sel_new text;
  canon_old text := $x$'majlis', s.majlis) end as af_canon$x$;
  canon_new text;
  sweep_old text := $x$        ('amenity:majlis','cnt_majlis','p_amenities:=array[''majlis'']','s.majlis is true'),$x$;
  sweep_add text;
  tt_old text := $x$    ('amenity:majlis','cnt_majlis','p_amenities:=array[''majlis'']','s.majlis is true','guided'),$x$;
  tt_add text;
  cols text; toks text; clause text; tcbd_def text; tpl text; sweep_def text; tt_def text; occ int;
  before_n bigint; after_n bigint; parity int; v_counts jsonb; v_chip bigint; v_ref bigint; v_direct bigint; v_garbage bigint; v_drift int; tok text;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure)) <> 'b7af7af5dce365fc0a7f1b9f46fd3193' then
    raise exception 'ABORT: af_eligibility_clause moved since this migration was written (%)', md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure));
  end if;
  if md5(pg_get_functiondef('public.top_cities_by_deal_ar'::regproc)) <> '1702d192ab2eb230d08ec9b5040ae2a5' then
    raise exception 'ABORT: top_cities_by_deal_ar moved since this migration was written';
  end if;
  if md5(pg_get_functiondef('public.ops_af_option_truth_sweep'::regproc)) <> '108857e6f128fed61e185661d2d6976b'
     or md5(pg_get_functiondef('public.af_option_truth_table'::regproc)) <> '6bf32f25c36fef6ada20048ba0fb5823' then
    raise exception 'ABORT: the sweep or the truth table moved since this migration was written';
  end if;

  select string_agg(quote_literal(token), ',' order by ord) into toks from _apt_tokens;
  wl_new := $x$'majlis',$x$ || toks || $x$,'furnished','rnpl','rent_now_pay_later'))$x$;
  select pred_old || E'\n' || string_agg(format('           and (not (%L = any(p_amenities)) or %s)', token, pred), E'\n' order by ord) into pred_new from _apt_tokens;
  select string_agg('s.' || token, ', ' order by ord) into cols from _apt_tokens where kind = 'bool';
  cols := cols || ', s.apartments_count, s.shops_count';
  scoped_new := 's.separate_water_meter, s.majlis, ' || cols || ', s.rating, s.reviews_count, s.unit_subtype_ar';
  select 'cnt_majlis bigint, ' || string_agg('cnt_' || token || ' bigint', ', ' order by ord) || ', cnt_apts_unknown bigint, cnt_shops_unknown bigint, cnt_selected bigint' into ret_new from _apt_tokens;
  select sel_old || E'\n' || string_agg(format('    count(*) filter (where %s) as cnt_%s,', flt, token), E'\n' order by ord)
         || E'\n    count(*) filter (where apartments_count is null) as cnt_apts_unknown,'
         || E'\n    count(*) filter (where shops_count is null) as cnt_shops_unknown,' into sel_new from _apt_tokens;
  -- a second jsonb_build_object joined with || : one call takes at most 100 arguments (the pack is now 70 pairs)
  select $x$'majlis', s.majlis) || jsonb_build_object($x$ || string_agg(format('%L, s.%I', token, token), ', ' order by ord) || $x$, 'apartments_count', s.apartments_count, 'shops_count', s.shops_count) end as af_canon$x$
    into canon_new from _apt_tokens where kind = 'bool';
  select sweep_old || E'\n' || string_agg(format('        (%L,%L,%L,%L),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into sweep_add from _apt_tokens;
  select tt_old || E'\n' || string_agg(format('    (%L,%L,%L,%L,''guided''),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into tt_add from _apt_tokens;

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
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');

  perform * from rebuild_af_filter_rpcs();

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort changed %->%', before_n, after_n;
  end if;
  if position('''cameras'', s.cameras' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0 then
    raise exception 'ABORT: the rebuilt location_search_candidates_ar does not pack cameras';
  end if;

  -- 7. chip == referee == direct on the fleet-wide base (the exact formula of 20260902220000)
  select to_jsonb(g) into v_counts from apartment_guided_counts_ar() g;
  for tok in select token from _apt_tokens loop
    if v_counts ->> ('cnt_' || tok) is null then raise exception 'ABORT: rebuilt RPC has no cnt_% column', tok; end if;
  end loop;
  if v_counts ->> 'cnt_apts_unknown' is null or v_counts ->> 'cnt_shops_unknown' is null then raise exception 'ABORT: unknown counts missing'; end if;
  v_chip := (v_counts ->> 'cnt_roof')::bigint;
  select af_eligible_count(p_amenities:=array['roof']) into v_ref;
  select count(*) into v_direct from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
     and s.roof;
  if v_chip <> v_ref or v_ref <> v_direct then
    raise exception 'ABORT: roof chip % / referee % / direct % disagree', v_chip, v_ref, v_direct;
  end if;
  v_chip := (v_counts ->> 'cnt_separate_meters')::bigint;
  select af_eligible_count(p_amenities:=array['separate_meters']) into v_ref;
  if v_chip <> v_ref then raise exception 'ABORT: separate_meters chip % / referee % disagree', v_chip, v_ref; end if;
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
  if (select count(*) from af_option_truth_table() where label like 'amenity:%') <> 65 then
    raise exception 'ABORT: expected 65 amenity rows in af_option_truth_table, got %', (select count(*) from af_option_truth_table() where label like 'amenity:%');
  end if;

  -- 7. the registry describes every chip
  insert into public.af_field_registry
    (canonical_key, label_ar, category, datatype, unknown_policy, ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
  select token, label_ar, 'amenity', 'boolean', 'NULL', true, 'more_options', null,
         'Apartments & Co-living chip (owner handoff 2026-10-31). ' || case when kind = 'bool' then 'af_rule_b(NULL box, the ad''s quoted words); IS TRUE token.' else 'Derived predicate token: ' || pred end,
         'advanced'
    from _apt_tokens
  union all select 'apartments_count', 'عدد الشقق', 'structure', 'number', 'NULL', true, 'more_options', null, 'The ad''s own apartment count read by the free word reader (2..500); served to the apts4/8/12/20 ladder (owner handoff 2026-10-31).', 'advanced'
  union all select 'shops_count', 'عدد المحلات', 'structure', 'number', 'NULL', true, 'more_options', null, 'The ad''s own shop count read by the free word reader (1..300); served to has_shops (owner handoff 2026-10-31).', 'advanced'
  on conflict (canonical_key) do update
    set ui_exposed = true, ui_group = 'more_options', not_exposed_reason = null, filter_tier = 'advanced',
        label_ar = excluded.label_ar, concept_note = excluded.concept_note, category = excluded.category, datatype = excluded.datatype;

  raise notice 'SUCCESS: 45 tokens live on af_eligibility_clause + top_cities_by_deal_ar; counts in the scoped CTE; af_canon packs 41 new columns; roof chip==referee==direct (%); parity 0; cohort % unchanged', v_chip, before_n;
end $do$;

drop table _apt_tokens;
select public.mon_selftest_text_facts();