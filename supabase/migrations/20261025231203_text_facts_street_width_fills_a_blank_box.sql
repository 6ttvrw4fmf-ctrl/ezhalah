-- TEXT FACTS → ADVANCED FILTER, numbers: STREET WIDTH FILLS A BLANK BOX (owner 2026-10-25, decision #1 of the
-- account handoff: «yes for street width»; building age waits for a 500-ad sample). Law: docs/ops/
-- ADVANCED_FILTER_SOURCE_TRUTH.md «Rule B for numbers». Parts 1–3 of Rule B: 20261025203351 (store + switch),
-- 20261025205008 (both index writers merge), 20261025205450 (watchers).
--
-- RULE B FOR A NUMBER (owner): the ad's own width fills a BLANK box only. A width the site published is never
-- replaced, and two different numbers are listed for Quality & Repair (ops_text_facts_width_differs), never served.
--   box NULL, text 20 → 20 (quoted) · box 15, text 20 → 15 (the box; listed) · box 15, text silent → 15
--
-- MEASURED before this migration (full run facts-words-2026-10-25): 73,662 ads carry a quoted street width;
-- 28,787 of them have a blank box in search_listings_ar, 34,551 agree with the box, 3,528 differ. Hand check:
-- 40 random quoted widths, 40 correct («شارع 15 م», «عرض الشارع: 10», «20m Width Street»). The reader
-- (scrapers/facts/word_checker.py) already refuses a corner plot, «يحدها 2 شارع», two widths or two bearings.
--
-- WHAT CHANGES
--   1. text_facts_af_num_columns() = {street_width_m}: the numeric overlay keys. text_facts_all_quoted (the table
--      CHECK) admits them: v a JSON number 4..150 (the checker's own bounds), q the ad's words. Booleans unchanged.
--   2. listing_text_facts_af gains street_width_m (appended; text_fact_num, quote required), NULL while its own
--      kill switch ops_feature_flags.af_text_facts_street_width is off (born ON — the owner decided).
--   3. sync_search_listings_ar writes AND compares af_rule_b_num(v.street_width_m, tf.street_width_m) — needle
--      edits on the live body, md5-guarded, exactly like 20261025205008. The AF RPC, both guided-count RPCs, the
--      agent and the independent oracle all read s.street_width_m, so none of them changes.
--   4. text_facts_todo lists, once, the ads read before this switch whose history (listing_facts) holds a width:
--      the nightly reader re-reads them from CURRENT text (73,625 ads) — no old reading is copied blind.
--   5. Watchers: ops_text_facts_vs_index keeps to the boolean keys (a number would break its ::boolean);
--      ops_text_facts_num_vs_index + ops_text_facts_width_differs; mon_detect_text_facts check 6
--      (text_facts_width_not_applied, P1); mon_selftest_text_facts proves the predicates, the CHECK and the live
--      view column; ops_text_facts_status reports street_width_text_rows / street_width_differs.
-- Every function this touches is this work's own (20261025203351 / 20261025205450); each live md5 is checked in
-- this step; needle bodies are dollar-quoted so no quote is re-escaped by hand.

insert into public.ops_feature_flags (name, enabled, reason)
values ('af_text_facts_street_width', true,
        'Owner 2026-10-25 (handoff decision #1): the ad''s own street width fills a BLANK box in the Advanced Filter')
on conflict (name) do nothing;

create or replace function public.text_facts_af_num_columns()
returns text[] language sql immutable parallel safe as $$
  select array['street_width_m']::text[]
$$;
comment on function public.text_facts_af_num_columns() is
  'The NUMERIC search-index columns an ad''s text may fill (Rule B for numbers: a blank box only). street_width_m since 2026-10-25.';

create or replace function public.text_facts_street_width_on()
returns boolean language sql stable as $$
  select coalesce((select k.enabled from public.ops_feature_flags k where k.name = 'af_text_facts_street_width'), false)
$$;

-- 1. the CHECK: a boolean for the 20 amenity keys, a number 4..150 for the numeric keys, a quote always
do $$
begin
  if md5(pg_get_functiondef('public.text_facts_all_quoted(jsonb)'::regprocedure)) <> 'fcec749cba0468ca3ffc76eca8857b10' then
    raise exception 'text_facts_all_quoted moved since 20261025203351; rebase this migration';
  end if;
end $$;
create or replace function public.text_facts_all_quoted(p jsonb)
returns boolean language sql immutable parallel safe as $$
  select coalesce(jsonb_typeof(p), '') = 'object' and not exists (
    select 1 from jsonb_each(p) e
     where not (   (e.key = any (public.text_facts_af_columns())
                    and coalesce(jsonb_typeof(e.value -> 'v'), '') = 'boolean')
                or (e.key = any (public.text_facts_af_num_columns())
                    and coalesce(jsonb_typeof(e.value -> 'v'), '') = 'number'
                    and (case when jsonb_typeof(e.value -> 'v') = 'number' then (e.value ->> 'v')::numeric end) between 4 and 150))
        or coalesce(length(btrim(e.value ->> 'q')), 0) = 0)
$$;

-- One numeric column's text value, ONLY with its quote (the sibling of text_fact_bool).
create or replace function public.text_fact_num(p jsonb, p_col text)
returns numeric language sql immutable parallel safe as $$
  select case when coalesce(length(btrim(p -> p_col ->> 'q')), 0) > 0 and jsonb_typeof(p -> p_col -> 'v') = 'number'
              then (p -> p_col ->> 'v')::numeric end
$$;

-- RULE B FOR A NUMBER: fill a blank box only. The published number is never replaced.
create or replace function public.af_rule_b_num(p_box smallint, p_text numeric)
returns smallint language sql immutable parallel safe as $$
  select coalesce(p_box, round(p_text)::smallint)
$$;

-- 2. the overlay view: the 20 booleans as before + street_width_m (appended), behind its own switch
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
            then public.text_fact_num(f.facts, 'street_width_m')::smallint end as street_width_m
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);
comment on view public.listing_text_facts_af is
  'Rule B overlay input: the ad-text value per Advanced Filter column (20 booleans + street_width_m), only with its quote, never from changed text, empty when ops_feature_flags.af_text_facts_overlay is off; street_width_m NULL while af_text_facts_street_width is off.';

-- 3. + 4. needle edits on the two live bodies this work owns
do $mig$
declare
  src text; e text[]; n int; fn text; want text; edits text[][];
begin
  -- sync_search_listings_ar: write and compare the merged width (the tf join is already there since 20261025205008)
  fn := 'public.sync_search_listings_ar()'; want := 'a986c4b180abc8d6deaa663d52929561';
  edits := array[
    [$x$    v.street_width_m, v.floor_number,$x$,
     $x$    public.af_rule_b_num(v.street_width_m, tf.street_width_m), v.floor_number,$x$, '1'],
    [$x$or s3.street_width_m is distinct from v.street_width_m$x$,
     $x$or s3.street_width_m is distinct from public.af_rule_b_num(v.street_width_m, tf.street_width_m)$x$, '1']
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
  if (length(src) - length(replace(src, 'public.af_rule_b_num(v.street_width_m, tf.street_width_m)', '')))
       / length('public.af_rule_b_num(v.street_width_m, tf.street_width_m)') <> 2
     or (length(src) - length(replace(src, 'left join public.listing_text_facts_af tf', ''))) / length('left join public.listing_text_facts_af tf') <> 1 then
    raise exception 'sync_search_listings_ar: expected the width merged once written + once compared over the one tf join';
  end if;
  execute src;

  -- text_facts_todo: the one-time backlog — ads read before the width switch whose history holds a width
  fn := 'public.text_facts_todo(text,bigint,integer,integer,integer)'; want := '2e33fbbf9d95162b78d76aff074d4716';
  edits := array[
    [$x$        and (f.listing_id is null or f.stale_at is not null or f.src_hash is distinct from %2$s)$x$,
     $x$        and (f.listing_id is null or f.stale_at is not null or f.src_hash is distinct from %2$s
             or (not (f.facts ? ''street_width_m'')
                 and f.read_at < (select kf.changed_at from public.ops_feature_flags kf where kf.name = ''af_text_facts_street_width'')
                 and exists (select 1 from public.listing_facts l2
                              where l2.platform = %3$L and l2.listing_key = x.ad_number::text and l2.model = ''word-checker-v1''
                                and l2.fact = ''street_width_m'' and l2.value_num is not null)))$x$, '1']
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

-- 5. watchers
-- the boolean view keeps to the boolean keys (a numeric key would make its ::boolean cast raise)
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
          'car_entrance', s.car_entrance, 'optical_fibers', s.optical_fibers) ->> e.key)::boolean as index_value
  from public.listing_text_facts f
 cross join lateral jsonb_each(f.facts) e
  left join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id
 where e.key = any (public.text_facts_af_columns());

create or replace view public.ops_text_facts_num_vs_index as
select f.source_table, f.listing_id, f.platform, f.listing_key, f.read_at, f.stale_at, e.key as col,
       (e.value ->> 'v')::numeric as text_value, e.value ->> 'q' as quote,
       s.listing_id is not null as in_index,
       case e.key when 'street_width_m' then s.street_width_m end as index_value
  from public.listing_text_facts f
 cross join lateral jsonb_each(f.facts) e
  left join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id
 where e.key = any (public.text_facts_af_num_columns());

-- THE LIST FOR QUALITY & REPAIR: the site published one width, the seller wrote another. Served = the box.
create or replace view public.ops_text_facts_width_differs as
select v.source_table, v.listing_id, v.platform, v.listing_key, v.text_value as text_width_m,
       v.index_value as box_width_m, v.quote, v.read_at
  from public.ops_text_facts_num_vs_index v
 where v.col = 'street_width_m' and v.stale_at is null and v.in_index
   and v.index_value is not null and v.index_value <> v.text_value;

create or replace function public.text_facts_num_not_applied(p_text numeric, p_index numeric)
returns boolean language sql immutable parallel safe as $$
  select p_text is not null and p_index is null
$$;

revoke all on table public.ops_text_facts_num_vs_index, public.ops_text_facts_width_differs from public, anon, authenticated;
grant select on table public.ops_text_facts_num_vs_index, public.ops_text_facts_width_differs to service_role;
revoke all on function public.text_facts_af_num_columns(), public.text_facts_street_width_on(),
                       public.text_fact_num(jsonb, text), public.af_rule_b_num(smallint, numeric),
                       public.text_facts_num_not_applied(numeric, numeric) from public, anon, authenticated;
grant execute on function public.text_facts_af_num_columns(), public.text_facts_street_width_on(),
                          public.text_fact_num(jsonb, text), public.af_rule_b_num(smallint, numeric),
                          public.text_facts_num_not_applied(numeric, numeric) to service_role;

do $mig$
declare
  src text; e text[]; n int; fn text; want text; edits text[][];
  todo text[][][] := array[
    -- mon_detect_text_facts: check 6
    [['public.mon_detect_text_facts()', '66dac67db125bc93d26749ea12a0f68c', '']],
    -- mon_selftest_text_facts: the new predicates + the live view column
    [['public.mon_selftest_text_facts()', '2be6b655afe90f6dca2667ca200ac92e', '']],
    -- ops_text_facts_status: the two new numbers
    [['public.ops_text_facts_status()', 'ebde2445d010012c44548d25fd9a26a3', '']]
  ];
  i int;
begin
  for i in 1..3 loop
    fn := todo[i][1][1]; want := todo[i][1][2];
    if i = 1 then
      edits := array[
        [$x$  n bigint; m bigint; d jsonb; t text; k bigint; ks bigint[]; stale jsonb := '[]'::jsonb;$x$,
         $x$  n bigint; m bigint; d jsonb; t text; k bigint; ks bigint[]; stale jsonb := '[]'::jsonb;
  since_w timestamptz := coalesce((select kf.changed_at from public.ops_feature_flags kf where kf.name = 'af_text_facts_street_width'), now());$x$, '1'],
        [$x$  -- 5. the nightly reader$x$,
         $x$  -- 6. a quoted street width older than 4 h on an indexed ad whose width is still blank (Rule B for numbers:
  --    af_rule_b_num fills a blank box, so a blank beside a quoted width means the merge is not running)
  n := 0; d := null;
  if on_ and public.text_facts_street_width_on() and since_w < now() - interval '4 hours' then
    select count(*), jsonb_agg(jsonb_build_object('key', x.source_table || ':' || x.listing_id, 'text', x.text_value, 'quote', x.quote)) filter (where x.rn <= 10)
      into n, d
      from (select v.*, row_number() over () rn from public.ops_text_facts_num_vs_index v
             where v.col = 'street_width_m' and v.stale_at is null and v.in_index and v.read_at < now() - interval '4 hours'
               and public.text_facts_num_not_applied(v.text_value, v.index_value)) x;
  end if;
  if n > 0 then
    r := r + public.mon_raise('P1', 'text_facts_width_not_applied', 'all', 'text_facts_width_not_applied',
      jsonb_build_object('rows', n, 'sample', d, 'for', '🔧',
        'why', 'A quoted street width older than 4 h sits beside a BLANK index width. sync_search_listings_ar lost its af_rule_b_num merge (the street-width migration''s needles) or stopped running.'));
  else
    perform public.mon_resolve('text_facts_width_not_applied', 'all');
  end if;

  -- 5. the nightly reader$x$, '1']
      ];
    elsif i = 2 then
      edits := array[
        [$x$  -- LIVE wiring of the switch and the stale stamp, rolled back$x$,
         $x$  -- Rule B for numbers: a blank box takes the quoted width, a published width is never replaced
  if not (public.af_rule_b_num(null::smallint, 20::numeric) = 20 and public.af_rule_b_num(15::smallint, 20::numeric) = 15 and public.af_rule_b_num(15::smallint, null::numeric) = 15
          and public.af_rule_b_num(null::smallint, null::numeric) is null) then
    bad := bad || 'af_rule_b_num is not «fill a blank box only»'::text;
  end if;
  if public.text_facts_num_not_applied(20, 20) or public.text_facts_num_not_applied(20, 15) or public.text_facts_num_not_applied(null, null) then
    bad := bad || 'num_not_applied fires on a served or silent width'::text;
  end if;
  if not public.text_facts_num_not_applied(20, null) then
    bad := bad || 'num_not_applied misses a quoted width beside a blank index'::text;
  end if;
  if public.text_facts_all_quoted('{"street_width_m": {"v": "20", "q": "شارع 20م"}}'::jsonb)
     or public.text_facts_all_quoted('{"street_width_m": {"v": 20, "q": ""}}'::jsonb)
     or public.text_facts_all_quoted('{"street_width_m": {"v": 2, "q": "شارع 2م"}}'::jsonb)
     or public.text_facts_all_quoted('{"property_age_years": {"v": 5, "q": "عمر 5"}}'::jsonb)
     or public.text_facts_all_quoted('{"elevator": {"v": 1, "q": "مصعد"}}'::jsonb)
     or not public.text_facts_all_quoted('{"street_width_m": {"v": 20.0, "q": "شارع 20م"}, "elevator": {"v": true, "q": "مصعد"}}'::jsonb) then
    bad := bad || 'text_facts_all_quoted lets a bad width through (or refuses a good one)'::text;
  end if;
  -- LIVE wiring of the switch and the stale stamp, rolled back$x$, '1'],
        [$x$'{"elevator": {"v": true, "q": "يوجد مصعد"}}'$x$,
         $x$'{"elevator": {"v": true, "q": "يوجد مصعد"}, "street_width_m": {"v": 20, "q": "شارع 20م"}}'$x$, '1'],
        [$x$    select count(*) into n_on from public.listing_text_facts_af where source_table = 'selftest_x_listings';$x$,
         $x$    select count(*) into n_on from public.listing_text_facts_af where source_table = 'selftest_x_listings' and street_width_m = 20;$x$, '1']
      ];
    else
      edits := array[
        [$x$    'conflicts', (select count(*) from public.ops_text_facts_conflicts),$x$,
         $x$    'conflicts', (select count(*) from public.ops_text_facts_conflicts),
    'street_width_text_rows', (select count(*) from public.ops_text_facts_num_vs_index v
                                where v.col = 'street_width_m' and v.stale_at is null and v.in_index),
    'street_width_differs', (select count(*) from public.ops_text_facts_width_differs),$x$, '1']
      ];
    end if;
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
  end loop;
end $mig$;

-- Proven at apply time: the predicates, the CHECK, the live view column, the switch (mon_selftest_text_facts
-- raises on any miss, so a wrong line fails this migration, not a customer).
select public.mon_selftest_text_facts();
