-- MAJLIS BECOMES AN ADVANCED FILTER AMENITY (owner 2026-10-26, decision #3 of the handoff: «the first new filter
-- question from the stored facts» → majlis). The 21st amenity token, wired exactly like the 2026-08-31 / 09-02 rich
-- set (20260831205347 + 20260902220000) PLUS the Rule B overlay (20261025203351 / 20261025205008), in ONE migration.
--
-- WHY MAJLIS. No site has a «مجلس» tick box the way they have «مصعد»; aqar and wasalt publish a majlis COUNT
-- (reception_rooms_majlis → listing_rich_attrs.majlis_rooms, 7,328 ads > 0, never 0 — a positive-only box), and the
-- sellers' own words name it on 91,408 more ads (word-checker-v1 fact `majlis`, 100 % agreement with the box where
-- both exist, 10-25 report). Under Rule B the served value = af_rule_b(box, text): box > 0 → true; text names it →
-- true; text explicitly negates it («بدون مجلس») → false; silent + no box → unknown (NULL, never served).
--
-- WHAT CHANGES (each live body md5-guarded in this step; needles must occur exactly once or nothing changes)
--   1. listing_rich_attrs.majlis        generated: majlis_rooms IS NULL → NULL, else majlis_rooms > 0 (the BOX)
--      search_listings_ar.majlis        boolean (served). _rich_attr_columns() derives the shared column set from
--                                       information_schema, so sync_listing_rich_attrs copies and MERGES it (its
--                                       merged_list already says: a column named in text_facts_af_columns() is served as
--                                       af_rule_b(box, text)). No sync body is edited.
--   2. text_facts_af_columns() += majlis; listing_text_facts_af += majlis (behind ops_feature_flags.af_text_facts_majlis,
--      born ON); text_facts_apply_slice merges it; ops_text_facts_vs_index reads s.majlis; text_facts_todo lists, once,
--      every ad read before this switch whose history holds a majlis fact (91k, re-read from CURRENT text).
--   3. af_eligibility_clause() whitelist + predicate arm; top_cities_by_deal_ar (its byte-identical copy);
--      rebuild_af_filter_rpcs(); parity 0; the certified cohort's base count unchanged.
--   4. apartment_guided_counts_ar template: s.majlis in the scoped CTE, cnt_majlis in RETURNS and SELECT; rebuilt.
--   5. ops_af_option_truth_sweep + af_option_truth_table learn amenity:majlis; af_option_vocab_drift() = 0.
--   6. af_field_registry: majlis registered, ui_exposed, advanced tier, more_options.
--   7. Self-check at apply time: chip == referee == direct for majlis on the fleet-wide base; garbage token still 0.
-- Same-change client half (one PR): src/lib/afCohorts.ts RESIDENTIAL_AMENITY_BASE, src/data/advancedFilters.ts chip,
-- src/data/remote.ts GuidedCounts + listing mapping, src/lib/afEvidence.ts, src/components/ResultCard.tsx, src/i18n.tsx,
-- src/lib/chatTitle.ts, scripts/lib/afOracleFilter.ts / afMatrix.ts / afLiveSkipLedger.ts, scrapers/facts/words.py
-- AF_COLUMNS, scripts/verify-text-facts-rule-b.ts (reads the LATEST definitions); the agent's amenity vocabulary
-- (supabase/functions/agent/index.ts) in its own single-writer change.

-- ── 1. the box and the served column ────────────────────────────────────────────────────────────────────
-- listing_rich_attrs is a VIEW (one UNION ALL arm per source table, ~520 KB, maintained by needle-edit migrations on
-- pg_get_viewdef — 20261022001318 is the precedent). The box is derived ONCE, outside the arms, by wrapping the live
-- definition: every arm stays byte-identical, so later arm edits still find their needles. Idempotent: a wrapped view
-- is not wrapped again.
do $$
declare v text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_rich_attrs' and column_name = 'majlis') then
    raise notice 'listing_rich_attrs already carries majlis — view step skipped';
  else
    v := regexp_replace(pg_get_viewdef('public.listing_rich_attrs'::regclass, true), ';\s*$', '');
    execute 'create or replace view public.listing_rich_attrs as select v.*, '
         || 'case when v.majlis_rooms is null then null else v.majlis_rooms > 0 end as majlis from (' || v || ') v';
  end if;
end $$;
comment on column public.listing_rich_attrs.majlis is
  'The majlis BOX for Rule B: the site''s own majlis count > 0 (aqar/wasalt reception_rooms_majlis). NULL = the site said nothing. Merged with the ad''s own words (listing_text_facts_af.majlis) by sync_listing_rich_attrs.';
alter table public.search_listings_ar add column if not exists majlis boolean;
comment on column public.search_listings_ar.majlis is
  'Advanced Filter amenity «مجلس» (owner 2026-10-26): af_rule_b(listing_rich_attrs.majlis, the ad''s quoted sentence). Positive-only IS TRUE token; NULL = unknown.';

do $$
begin
  if not ('majlis' = any (public._rich_attr_columns())) then
    raise exception '_rich_attr_columns() does not derive majlis — the two columns are not both in place';
  end if;
end $$;

-- ── 2. the text overlay learns majlis ───────────────────────────────────────────────────────────────────
-- Born OFF: the nightly reader (scrapers/facts/words.py AF_COLUMNS) must carry majlis BEFORE the backlog opens, or a
-- read with the old reader would advance read_at without writing the key and the ad would leave the backlog for good.
-- The switch-on (enabled = true, changed_at = now()) is the one line that opens both the view column and the backlog.
insert into public.ops_feature_flags (name, enabled, reason)
values ('af_text_facts_majlis', false,
        'Owner 2026-10-26 (handoff decision #3): the ad''s own «مجلس» serves the new Advanced Filter amenity under Rule B; ON once words.py writes majlis')
on conflict (name) do nothing;

do $$
begin
  if md5(pg_get_functiondef('public.text_facts_af_columns()'::regprocedure)) <> '6d8ea3024fe87b6aa33c2257052843c1' then
    raise exception 'text_facts_af_columns moved since 20261025203351; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.text_facts_apply_slice(text,bigint,bigint)'::regprocedure)) <> '375bd29ea9749332f5cab6d9541fb97d' then
    raise exception 'text_facts_apply_slice moved since 20261025205008; rebase this migration';
  end if;
end $$;

create or replace function public.text_facts_af_columns()
returns text[] language sql immutable parallel safe as $$
  select array['furnished','elevator','parking','kitchen','air_conditioner','maid_room','driver_room',
               'private_entrance','separate_electricity_meter','separate_water_meter','electricity',
               'water_supply','sanitation','balcony','laundry_room','pool','gym','garden','car_entrance',
               'optical_fibers','majlis']::text[]
$$;

create or replace function public.text_facts_majlis_on()
returns boolean language sql stable as $$
  select coalesce((select k.enabled from public.ops_feature_flags k where k.name = 'af_text_facts_majlis'), false)
$$;

create or replace view public.listing_text_facts_af as
select f.source_table, f.listing_id,
       public.text_fact_bool(f.facts, 'furnished')                  as furnished,
       public.text_fact_bool(f.facts, 'elevator')                   as elevator,
       public.text_fact_bool(f.facts, 'parking')                    as parking,
       public.text_fact_bool(f.facts, 'kitchen')                    as kitchen,
       public.text_fact_bool(f.facts, 'air_conditioner')            as air_conditioner,
       public.text_fact_bool(f.facts, 'maid_room')                  as maid_room,
       public.text_fact_bool(f.facts, 'driver_room')                as driver_room,
       public.text_fact_bool(f.facts, 'private_entrance')           as private_entrance,
       public.text_fact_bool(f.facts, 'separate_electricity_meter') as separate_electricity_meter,
       public.text_fact_bool(f.facts, 'separate_water_meter')       as separate_water_meter,
       public.text_fact_bool(f.facts, 'electricity')                as electricity,
       public.text_fact_bool(f.facts, 'water_supply')               as water_supply,
       public.text_fact_bool(f.facts, 'sanitation')                 as sanitation,
       public.text_fact_bool(f.facts, 'balcony')                    as balcony,
       public.text_fact_bool(f.facts, 'laundry_room')               as laundry_room,
       public.text_fact_bool(f.facts, 'pool')                       as pool,
       public.text_fact_bool(f.facts, 'gym')                        as gym,
       public.text_fact_bool(f.facts, 'garden')                     as garden,
       public.text_fact_bool(f.facts, 'car_entrance')               as car_entrance,
       public.text_fact_bool(f.facts, 'optical_fibers')             as optical_fibers,
       case when public.text_facts_street_width_on()
            then public.text_fact_num(f.facts, 'street_width_m')::smallint end as street_width_m,
       case when public.text_facts_majlis_on()
            then public.text_fact_bool(f.facts, 'majlis') end                   as majlis
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);
comment on view public.listing_text_facts_af is
  'Rule B overlay input: the ad-text value per Advanced Filter column (21 booleans incl. majlis + street_width_m), only with its quote, never from changed text, empty when ops_feature_flags.af_text_facts_overlay is off; street_width_m / majlis each behind their own switch.';

create or replace view public.ops_text_facts_vs_index as
select f.source_table, f.listing_id, f.platform, f.listing_key, f.read_at, f.stale_at, e.key as col,
       (e.value ->> 'v')::boolean as text_value, e.value ->> 'q' as quote,
       s.listing_id is not null as in_index,
       (jsonb_build_object(
          'furnished', s.furnished, 'elevator', s.elevator, 'parking', s.parking, 'kitchen', s.kitchen,
          'air_conditioner', s.air_conditioner, 'maid_room', s.maid_room, 'driver_room', s.driver_room,
          'private_entrance', s.private_entrance, 'separate_electricity_meter', s.separate_electricity_meter,
          'separate_water_meter', s.separate_water_meter, 'electricity', s.electricity,
          'water_supply', s.water_supply, 'sanitation', s.sanitation, 'balcony', s.balcony,
          'laundry_room', s.laundry_room, 'pool', s.pool, 'gym', s.gym, 'garden', s.garden,
          'car_entrance', s.car_entrance, 'optical_fibers', s.optical_fibers, 'majlis', s.majlis) ->> e.key)::boolean as index_value
  from public.listing_text_facts f
 cross join lateral jsonb_each(f.facts) e
  left join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id
 where e.key = any (public.text_facts_af_columns());

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
             public.af_rule_b(r.optical_fibers, tf.optical_fibers)     as optical_fibers,
             public.af_rule_b(r.majlis, tf.majlis)                     as majlis
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
      garden = m.garden, car_entrance = m.car_entrance, optical_fibers = m.optical_fibers, majlis = m.majlis
      from m
     where s.source_table = m.source_table and s.listing_id = m.listing_id
       and (s.furnished, s.elevator, s.parking, s.kitchen, s.air_conditioner, s.maid_room, s.driver_room,
            s.private_entrance, s.separate_electricity_meter, s.separate_water_meter, s.electricity, s.water_supply,
            s.sanitation, s.balcony, s.laundry_room, s.pool, s.gym, s.garden, s.car_entrance, s.optical_fibers, s.majlis)
           is distinct from
           (m.furnished, m.elevator, m.parking, m.kitchen, m.air_conditioner, m.maid_room, m.driver_room,
            m.private_entrance, m.separate_electricity_meter, m.separate_water_meter, m.electricity, m.water_supply,
            m.sanitation, m.balcony, m.laundry_room, m.pool, m.gym, m.garden, m.car_entrance, m.optical_fibers, m.majlis)
  $f$, p_source_table, p_lo, p_hi);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.text_facts_majlis_on() from public, anon, authenticated;
grant execute on function public.text_facts_majlis_on() to service_role;

-- the one-time backlog: ads read before this switch whose history holds a majlis fact are re-read from CURRENT text
do $mig$
declare src text; e text[]; n int; fn text; want text; edits text[][];
begin
  fn := 'public.text_facts_todo(text,bigint,integer,integer,integer)'; want := '097dd53b8c5c8a38f367b5228494e6df';
  edits := array[
    [$x$                                and l2.fact = ''street_width_m'' and l2.value_num is not null)))$x$,
     $x$                                and l2.fact = ''street_width_m'' and l2.value_num is not null))
             or (not (f.facts ? ''majlis'')
                 and f.read_at < (select kf.changed_at from public.ops_feature_flags kf where kf.name = ''af_text_facts_majlis'' and kf.enabled)
                 and exists (select 1 from public.listing_facts l3
                              where l3.platform = %3$L and l3.listing_key = x.ad_number::text and l3.model = ''word-checker-v1''
                                and l3.fact = ''majlis'' and l3.value_bool is not null)))$x$, '1']
  ];
  src := pg_get_functiondef(fn::regprocedure);
  if md5(src) <> want then
    raise exception '% moved since this migration was written (md5 %); rebase the needles', fn, md5(src);
  end if;
  foreach e slice 1 in array edits loop
    n := (length(src) - length(replace(src, e[1], ''))) / length(e[1]);
    if n <> e[3]::int then
      raise exception '%: needle found % times, expected %: %', fn, n, e[3], left(e[1], 80);
    end if;
    src := replace(src, e[1], e[2]);
  end loop;
  execute src;
end $mig$;

-- ── 3.–7. the Advanced Filter surfaces, exactly as 20260831205347 + 20260902220000 did ─────────────────
do $do$
declare
  wl_old text := $x$'separate_water_meter','furnished','rnpl','rent_now_pay_later'))$x$;
  wl_new text := $x$'separate_water_meter','majlis','furnished','rnpl','rent_now_pay_later'))$x$;
  pred_old text := $x$and (not ('separate_water_meter'          = any(p_amenities)) or s.separate_water_meter)$x$;
  pred_new text := $x$and (not ('separate_water_meter'          = any(p_amenities)) or s.separate_water_meter)
           and (not ('majlis'                       = any(p_amenities)) or s.majlis)$x$;
  scoped_old text := $x$s.separate_water_meter, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  scoped_new text := $x$s.separate_water_meter, s.majlis, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  ret_old text := $x$cnt_separate_water_meter bigint, cnt_selected bigint$x$;
  ret_new text := $x$cnt_separate_water_meter bigint, cnt_majlis bigint, cnt_selected bigint$x$;
  sel_old text := $x$    count(*) filter (where separate_water_meter)            as cnt_separate_water_meter,$x$;
  sel_new text := $x$    count(*) filter (where separate_water_meter)            as cnt_separate_water_meter,
    count(*) filter (where majlis)                          as cnt_majlis,$x$;
  sweep_old text := $x$        ('amenity:separate_water_meter','cnt_separate_water_meter','p_amenities:=array[''separate_water_meter'']','s.separate_water_meter is true'),$x$;
  sweep_add text := $x$        ('amenity:separate_water_meter','cnt_separate_water_meter','p_amenities:=array[''separate_water_meter'']','s.separate_water_meter is true'),
        ('amenity:majlis','cnt_majlis','p_amenities:=array[''majlis'']','s.majlis is true'),$x$;
  tt_old text := $x$    ('amenity:separate_water_meter','cnt_separate_water_meter','p_amenities:=array[''separate_water_meter'']','s.separate_water_meter is true','guided'),$x$;
  tt_add text := $x$    ('amenity:separate_water_meter','cnt_separate_water_meter','p_amenities:=array[''separate_water_meter'']','s.separate_water_meter is true','guided'),
    ('amenity:majlis','cnt_majlis','p_amenities:=array[''majlis'']','s.majlis is true','guided'),$x$;
  clause text; tcbd_def text; tpl text; sweep_def text; tt_def text; occ int;
  before_n bigint; after_n bigint; parity int; v_counts jsonb; v_chip bigint; v_ref bigint; v_direct bigint; v_garbage bigint; v_drift int;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure)) <> '34abb6adfc2654cdbd83fb255c0be7b3' then
    raise exception 'ABORT: af_eligibility_clause moved since this migration was written (%)', md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure));
  end if;
  if md5(pg_get_functiondef('public.top_cities_by_deal_ar'::regproc)) <> '8a9bea9dc4eff858dc2ccc4582adb509' then
    raise exception 'ABORT: top_cities_by_deal_ar moved since this migration was written';
  end if;
  if md5(pg_get_functiondef('public.ops_af_option_truth_sweep'::regproc)) <> '8dfafe8a3163cfb92d51a02d07b8a06a'
     or md5(pg_get_functiondef('public.af_option_truth_table'::regproc)) <> 'd67e5c682159bc9ba129494c2a158e5b' then
    raise exception 'ABORT: the sweep or the truth table moved since this migration was written';
  end if;

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

  -- 4. the guided-counts template (cnt_majlis inside the scoped CTE)
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

  -- 7. chip == referee == direct on the fleet-wide base (the exact formula of 20260902220000)
  select to_jsonb(g) into v_counts from apartment_guided_counts_ar() g;
  v_chip := (v_counts ->> 'cnt_majlis')::bigint;
  if v_chip is null then raise exception 'ABORT: rebuilt RPC has no cnt_majlis column'; end if;
  select af_eligible_count(p_amenities:=array['majlis']) into v_ref;
  select count(*) into v_direct from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
     and s.majlis;
  if v_chip <> v_ref or v_ref <> v_direct then
    raise exception 'ABORT: majlis chip % / referee % / direct % disagree', v_chip, v_ref, v_direct;
  end if;
  select af_eligible_count(p_amenities:=array['garbage_token_zz']) into v_garbage;
  if v_garbage <> 0 then raise exception 'ABORT: af_eligible_count garbage token returned %', v_garbage; end if;
  if (select count(*) from top_cities_by_deal_ar(p_amenities:=array['garbage_token_zz'])) <> 0 then
    raise exception 'ABORT: top_cities_by_deal_ar garbage token returned rows';
  end if;

  -- 5. the runtime sweep and the in-DB truth table learn amenity:majlis
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
  if (select count(*) from af_option_truth_table() where label like 'amenity:%') <> 20 then
    raise exception 'ABORT: expected 20 amenity rows in af_option_truth_table, got %', (select count(*) from af_option_truth_table() where label like 'amenity:%');
  end if;

  raise notice 'SUCCESS: majlis live on af_eligibility_clause (4 templated RPCs) + top_cities_by_deal_ar; cnt_majlis in the scoped CTE; chip==referee==direct (% / % / %); parity 0; cohort % unchanged; sweep + truth table carry amenity:majlis', v_chip, v_ref, v_direct, before_n;
end $do$;

-- ── 6. the registry describes the chip ──────────────────────────────────────────────────────────────────
insert into public.af_field_registry
  (canonical_key, label_ar, category, datatype, unknown_policy, ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
values
  ('majlis', 'مجلس', 'amenity', 'boolean', 'NULL', true, 'more_options', null,
   'Residential amenity chip since 2026-10-26 (RESIDENTIAL_AMENITY_BASE, cohort-gated). search_listings_ar.majlis = af_rule_b(listing_rich_attrs.majlis — the site''s majlis count > 0, aqar/wasalt — , the ad''s own quoted «مجلس»); positive-only IS TRUE token; unknown stays unknown. The first filter question born from the stored text facts.', 'advanced')
on conflict (canonical_key) do update
  set ui_exposed = true, ui_group = 'more_options', not_exposed_reason = null, filter_tier = 'advanced',
      label_ar = excluded.label_ar, concept_note = excluded.concept_note;

select public.mon_selftest_text_facts();
