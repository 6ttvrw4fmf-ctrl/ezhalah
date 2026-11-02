-- TEXT FACTS → ADVANCED FILTER, part 2 of 2: the two search-index writers merge the overlay under RULE B
-- (owner 2026-10-25, «We trust the sellers sentence»; law: docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md).
--
-- WHERE THE MERGE HAPPENS. search_listings_ar gets the 20 Advanced Filter amenity columns from exactly two
-- writers, and both now read public.af_rule_b(<box>, <text>) instead of the box:
--   sync_search_listings_ar()        furnished, elevator, parking, kitchen, air_conditioner, maid_room,
--                                    driver_room, private_entrance   (box = listing_native_location_v2)
--   sync_listing_rich_attrs(table)   the 12 others: meters, utilities, balcony, laundry, pool, gym, garden,
--                                    car entrance, fibre                (box = listing_rich_attrs)
-- Each merge sits in BOTH the value written and the change-detection that decides whether to write, so a
-- merged row is not rewritten every hour and a new fact (or the switch) is picked up by the next pass.
-- Every reader — the AF results RPC, both guided-count RPCs, the agent (which searches through the same
-- RPC), and the independent oracle (afOracleFilter.ts reads search_listings_ar directly) — reads the merged
-- column, so they cannot disagree. rebuild_af_filter_rpcs() / af_eligibility_clause are NOT touched.
--
-- KILL SWITCH. listing_text_facts_af is empty while ops_feature_flags.af_text_facts_overlay is off, so
-- af_rule_b(box, NULL) = box everywhere and the next pass writes the box back. A stale fact (text changed)
-- is dropped by the same view; sync_search_listings_ar() stamps staleness first thing on every pass.
--
-- SAFETY. Needle edits on the LIVE bodies (the full-function-replace hazard, AGENTS.md): each body's md5 is
-- checked in THIS transaction before it is touched, each needle must occur exactly the stated number of
-- times, and the edited body must carry every merge afterwards. Any miss raises and nothing changes.
do $$
declare
  src text;
  e text[];
  n int;
  sync_edits text[][] := array[
    ['if not public.search_index_writer_lock() then return; end if;',
     'if not public.search_index_writer_lock() then return; end if;
  -- RULE B (owner 2026-10-25): an ad whose text changed since the word checker read it stops applying on THIS pass.
  perform public.text_facts_mark_stale();', '1'],
    ['    v.furnished,
    v.property_age,',
     '    public.af_rule_b(v.furnished, tf.furnished),
    v.property_age,', '1'],
    ['    v.elevator, v.parking, v.kitchen, v.air_conditioner, v.maid_room, v.driver_room, v.private_entrance,
    v.production_ready, v.price_per_meter',
     '    public.af_rule_b(v.elevator, tf.elevator), public.af_rule_b(v.parking, tf.parking), public.af_rule_b(v.kitchen, tf.kitchen),
    public.af_rule_b(v.air_conditioner, tf.air_conditioner), public.af_rule_b(v.maid_room, tf.maid_room),
    public.af_rule_b(v.driver_room, tf.driver_room), public.af_rule_b(v.private_entrance, tf.private_entrance),
    v.production_ready, v.price_per_meter', '1'],
    ['  left join type_label_ar t on t.en = v.property_type
',
     '  left join type_label_ar t on t.en = v.property_type
  -- RULE B overlay (the ad''s own sentence, quoted). Empty while the kill switch is off → every merge is the box.
  left join public.listing_text_facts_af tf on tf.source_table = v.source_table and tf.listing_id = v.listing_id
', '1'],
    ['or s3.furnished is distinct from (v.furnished)', 'or s3.furnished is distinct from public.af_rule_b(v.furnished, tf.furnished)', '1'],
    ['or s3.elevator is distinct from v.elevator', 'or s3.elevator is distinct from public.af_rule_b(v.elevator, tf.elevator)', '1'],
    ['or s3.parking is distinct from v.parking', 'or s3.parking is distinct from public.af_rule_b(v.parking, tf.parking)', '1'],
    ['or s3.kitchen is distinct from v.kitchen', 'or s3.kitchen is distinct from public.af_rule_b(v.kitchen, tf.kitchen)', '1'],
    ['or s3.air_conditioner is distinct from v.air_conditioner', 'or s3.air_conditioner is distinct from public.af_rule_b(v.air_conditioner, tf.air_conditioner)', '1'],
    ['or s3.maid_room is distinct from v.maid_room', 'or s3.maid_room is distinct from public.af_rule_b(v.maid_room, tf.maid_room)', '1'],
    ['or s3.driver_room is distinct from v.driver_room', 'or s3.driver_room is distinct from public.af_rule_b(v.driver_room, tf.driver_room)', '1'],
    ['or s3.private_entrance is distinct from v.private_entrance', 'or s3.private_entrance is distinct from public.af_rule_b(v.private_entrance, tf.private_entrance)', '1']
  ];
  rich_edits text[][] := array[
    ['  cols text[]; set_list text; diff_list text;', '  cols text[]; set_list text; diff_list text; merged_list text;', '1'],
    ['  create temp table if not exists _rich_diff (like public.listing_rich_attrs) on commit drop;',
     '  -- RULE B (owner 2026-10-25): every Advanced Filter column the ad''s text answers is merged with the box
  -- (af_rule_b) BEFORE the diff, so the diff and the write both see the served value. Column order is
  -- listing_rich_attrs'' own, because _rich_diff is (like listing_rich_attrs).
  select string_agg(case when a.attname = any (public.text_facts_af_columns())
                         then format(''public.af_rule_b(r0.%1$I, tf.%1$I) as %1$I'', a.attname)
                         else format(''r0.%I'', a.attname) end, '', '' order by a.attnum)
    into merged_list
    from pg_attribute a
   where a.attrelid = ''public.listing_rich_attrs''::regclass and a.attnum > 0 and not a.attisdropped;

  create temp table if not exists _rich_diff (like public.listing_rich_attrs) on commit drop;', '1'],
    ['    select r.* from public.listing_rich_attrs r
    join public.search_listings_ar s
      on s.source_table = r.source_table and s.listing_id = r.listing_id
    where r.source_table = %L and (%s)
  $f$, p_source_table, diff_list);',
     '    select r.* from (select %s from public.listing_rich_attrs r0
                       left join public.listing_text_facts_af tf
                         on tf.source_table = r0.source_table and tf.listing_id = r0.listing_id
                      where r0.source_table = %L) r
    join public.search_listings_ar s
      on s.source_table = r.source_table and s.listing_id = r.listing_id
    where (%s)
  $f$, merged_list, p_source_table, diff_list);', '1']
  ];
begin
  -- sync_search_listings_ar ----------------------------------------------------------------------------
  src := pg_get_functiondef('public.sync_search_listings_ar()'::regprocedure);
  if md5(src) <> 'c96c9d9fe6771a51c26227703f24a317' then
    raise exception 'sync_search_listings_ar moved since this migration was written (md5 %); rebase the needles', md5(src);
  end if;
  foreach e slice 1 in array sync_edits loop
    n := (length(src) - length(replace(src, e[1], ''))) / length(e[1]);
    if n <> e[3]::int then
      raise exception 'sync_search_listings_ar: needle found % times, expected %: %', n, e[3], left(e[1], 80);
    end if;
    src := replace(src, e[1], e[2]);
  end loop;
  if (length(src) - length(replace(src, 'public.af_rule_b(v.', ''))) / length('public.af_rule_b(v.') <> 16 then
    raise exception 'sync_search_listings_ar: expected 16 Rule B merges (8 written + 8 compared)';
  end if;
  execute src;

  -- sync_listing_rich_attrs ----------------------------------------------------------------------------
  src := pg_get_functiondef('public.sync_listing_rich_attrs(text)'::regprocedure);
  if md5(src) <> '23523597d455e6fa7e1eba01b62bfeb6' then
    raise exception 'sync_listing_rich_attrs moved since this migration was written (md5 %); rebase the needles', md5(src);
  end if;
  foreach e slice 1 in array rich_edits loop
    n := (length(src) - length(replace(src, e[1], ''))) / length(e[1]);
    if n <> e[3]::int then
      raise exception 'sync_listing_rich_attrs: needle found % times, expected %: %', n, e[3], left(e[1], 80);
    end if;
    src := replace(src, e[1], e[2]);
  end loop;
  execute src;
end $$;

-- A batched applier for the switch flip (both directions). The hourly writers converge on their own, but
-- turning the switch on or off moves ~10^5 rows, and this instance must not absorb that in one statement
-- (2026-08-10 outage rule: ≤ 25k rows per statement, a health probe between). Same merge, same boxes as
-- the two writers; one table, one listing_id window per call. NULL = the single-writer lock was busy.
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
             public.af_rule_b(e.furnished, tf.furnished)               as furnished,
             public.af_rule_b(e.elevator, tf.elevator)                 as elevator,
             public.af_rule_b(e.parking, tf.parking)                   as parking,
             public.af_rule_b(e.kitchen, tf.kitchen)                   as kitchen,
             public.af_rule_b(e.air_conditioner, tf.air_conditioner)   as air_conditioner,
             public.af_rule_b(e.maid_room, tf.maid_room)               as maid_room,
             public.af_rule_b(e.driver_room, tf.driver_room)           as driver_room,
             public.af_rule_b(e.private_entrance, tf.private_entrance) as private_entrance,
             public.af_rule_b(r.separate_electricity_meter, tf.separate_electricity_meter) as separate_electricity_meter,
             public.af_rule_b(r.separate_water_meter, tf.separate_water_meter) as separate_water_meter,
             public.af_rule_b(r.electricity, tf.electricity)           as electricity,
             public.af_rule_b(r.water_supply, tf.water_supply)         as water_supply,
             public.af_rule_b(r.sanitation, tf.sanitation)             as sanitation,
             public.af_rule_b(r.balcony, tf.balcony)                   as balcony,
             public.af_rule_b(r.laundry_room, tf.laundry_room)         as laundry_room,
             public.af_rule_b(r.pool, tf.pool)                         as pool,
             public.af_rule_b(r.gym, tf.gym)                           as gym,
             public.af_rule_b(r.garden, tf.garden)                     as garden,
             public.af_rule_b(r.car_entrance, tf.car_entrance)         as car_entrance,
             public.af_rule_b(r.optical_fibers, tf.optical_fibers)     as optical_fibers
        from public.search_listings_ar s
        join public.listing_extra_attrs_mv e on e.source_table = s.source_table and e.listing_id = s.listing_id
        join (select * from public.listing_rich_attrs where source_table = %1$L and listing_id between %2$s and %3$s) r
          on r.source_table = s.source_table and r.listing_id = s.listing_id
        left join public.listing_text_facts_af tf on tf.source_table = s.source_table and tf.listing_id = s.listing_id
       where s.source_table = %1$L and s.listing_id between %2$s and %3$s)
    update public.search_listings_ar s set
      furnished = m.furnished, elevator = m.elevator, parking = m.parking, kitchen = m.kitchen,
      air_conditioner = m.air_conditioner, maid_room = m.maid_room, driver_room = m.driver_room,
      private_entrance = m.private_entrance, separate_electricity_meter = m.separate_electricity_meter,
      separate_water_meter = m.separate_water_meter, electricity = m.electricity, water_supply = m.water_supply,
      sanitation = m.sanitation, balcony = m.balcony, laundry_room = m.laundry_room, pool = m.pool, gym = m.gym,
      garden = m.garden, car_entrance = m.car_entrance, optical_fibers = m.optical_fibers
      from m
     where s.source_table = m.source_table and s.listing_id = m.listing_id
       and (s.furnished, s.elevator, s.parking, s.kitchen, s.air_conditioner, s.maid_room, s.driver_room,
            s.private_entrance, s.separate_electricity_meter, s.separate_water_meter, s.electricity, s.water_supply,
            s.sanitation, s.balcony, s.laundry_room, s.pool, s.gym, s.garden, s.car_entrance, s.optical_fibers)
           is distinct from
           (m.furnished, m.elevator, m.parking, m.kitchen, m.air_conditioner, m.maid_room, m.driver_room,
            m.private_entrance, m.separate_electricity_meter, m.separate_water_meter, m.electricity, m.water_supply,
            m.sanitation, m.balcony, m.laundry_room, m.pool, m.gym, m.garden, m.car_entrance, m.optical_fibers)
  $f$, p_source_table, p_lo, p_hi);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.text_facts_apply_slice(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.text_facts_apply_slice(text, bigint, bigint) to service_role;
comment on function public.text_facts_apply_slice(text, bigint, bigint) is
  'Rule B switch flip in ≤25k-row slices: writes af_rule_b(box, ad-text) into the 20 AF columns of one table''s listing_id window. The hourly writers do the same merge; this only spreads the one-time flip. NULL = writer lock busy.';
