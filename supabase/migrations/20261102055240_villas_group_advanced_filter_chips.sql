-- THE VILLAS GROUP CHIPS (owner approval 2026-11-02, built 2026-11-02). One migration, the shape of the apartments
-- migration (20261101100930), for 7 new boolean text facts the free word reader learns in its own PR (women_majlis,
-- outdoor_kitchen, outdoor_diwaniya, waterfall, well, irrigation, sports_court), 5 derived predicate tokens over
-- columns that already exist (garden_yard, jacuzzi_sauna, cameras_smart_home, water_tank_well, smart_home_entry) and two
-- more rungs on the bathroom ladder (cnt_bath5, cnt_bath6 — exactly as cnt_bath4 is computed and swept today).
--
-- RULE B unchanged: served = af_rule_b(box, the ad's quoted words). None of the 7 has a site box, so listing_rich_attrs
-- gains a NULL column per key and sync_listing_rich_attrs (hourly via sync_all_rich_attrs) merges and copies it like every
-- other Rule B column — its merged_list reads text_facts_af_columns() at run time, so it needs no edit here. The free word
-- reader (scrapers/facts/words.py AF_COLUMNS) is the ONLY writer; text_facts_all_quoted admits a key only with the ad's quote
-- and reads the same list, so it needs no edit either.
--
-- WHAT CHANGES (every live body md5-guarded; every needle must occur exactly once or nothing changes)
--   1. listing_rich_attrs.<key> NULL boxes; search_listings_ar.<key> boolean (served).
--   2. text_facts_af_columns() = 67 keys; listing_text_facts_af / text_facts_apply_slice over the full list.
--   3. af_eligibility_clause() whitelist + one arm per token; top_cities_by_deal_ar (its copy); rebuild_af_filter_rpcs(); parity 0.
--   4. apartment_guided_counts_ar template: s.<col> in the scoped CTE, cnt_<token>, cnt_bath5, cnt_bath6.
--   5. location_search_candidates_ar template packs every new column into af_canon (a third jsonb_build_object joined
--      with ||: the second one already carries 82 of its 100 arguments).
--   6. ops_af_option_truth_sweep + af_option_truth_table learn amenity:<token> and bathrooms:5+/6+; af_option_vocab_drift() = 0.
--   7. af_field_registry rows; self-check chip == referee == direct (women_majlis), chip == referee (garden_yard); garbage 0.
-- Client half (afCohorts.ts, advancedFilters.ts, afEvidence/afSummary/ResultCard/i18n, remote.ts GuidedCounts, sql/mirrors
-- af_eligibility_clause.sql + af_canon_select.sql, barriers) and the reader half ship in their own PRs; mirrored byte-exact
-- in mirror/<version>.

create temp table _villa_tokens (ord int, token text, kind text, pred text, flt text, direct text, label_ar text);
insert into _villa_tokens (ord, token, kind, label_ar) values
  (1,'women_majlis','bool','مجلس نساء'), (2,'outdoor_kitchen','bool','مطبخ خارجي'), (3,'outdoor_diwaniya','bool','ديوانية خارجية'),
  (4,'waterfall','bool','شلال'), (5,'well','bool','بئر'), (6,'irrigation','bool','نظام ري'), (7,'sports_court','bool','ملعب رياضي');
update _villa_tokens set pred = 's.' || token, flt = token, direct = 's.' || token || ' is true' where kind = 'bool';
insert into _villa_tokens values
  (8,'garden_yard','derived','(s.garden or s.yard)','(garden or yard)','(s.garden is true or s.yard is true)','حديقة أو حوش'),
  (9,'jacuzzi_sauna','derived','(s.jacuzzi or s.sauna)','(jacuzzi or sauna)','(s.jacuzzi is true or s.sauna is true)','جاكوزي أو ساونا'),
  (10,'cameras_smart_home','derived','(s.cameras or s.smart_home)','(cameras or smart_home)','(s.cameras is true or s.smart_home is true)','كاميرات أو منزل ذكي'),
  (11,'water_tank_well','derived','(s.water_tank or s.well)','(water_tank or well)','(s.water_tank is true or s.well is true)','خزان ماء أو بئر'),
  (12,'smart_home_entry','derived','(s.smart_home or s.smart_entry)','(smart_home or smart_entry)','(s.smart_home is true or s.smart_entry is true)','منزل ذكي أو دخول ذكي');

-- ── 1. the NULL boxes and the served columns ────────────────────────────────────────────────────────────
do $$
declare v text; boxes text; k text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_rich_attrs' and column_name = 'women_majlis') then
    raise notice 'listing_rich_attrs already carries the villa chips — view step skipped';
  else
    select string_agg(format('null::boolean as %I', token), ', ' order by ord) into boxes from _villa_tokens where kind = 'bool';
    v := regexp_replace(pg_get_viewdef('public.listing_rich_attrs'::regclass, true), ';\s*$', '');
    execute 'create or replace view public.listing_rich_attrs as select v.*, ' || boxes || ' from (' || v || ') v';
  end if;
  for k in select token from _villa_tokens where kind = 'bool' order by ord loop
    execute format('alter table public.search_listings_ar add column if not exists %I boolean', k);
    execute format('comment on column public.search_listings_ar.%I is %L', k,
      'Advanced Filter amenity (owner 2026-11-02, villas group): af_rule_b(NULL box, the ad''s quoted words via listing_text_facts_af.' || k || '). Positive-only IS TRUE token; NULL = unknown.');
  end loop;
  for k in select token from _villa_tokens where kind = 'bool' loop
    if not (k = any (public._rich_attr_columns())) then
      raise exception '_rich_attr_columns() does not derive % — the two columns are not both in place', k;
    end if;
  end loop;
end $$;

-- ── 2. the text overlay learns every key ────────────────────────────────────────────────────────────────
do $$
begin
  if md5(pg_get_functiondef('public.text_facts_af_columns()'::regprocedure)) <> 'ec78c3ad210200bf5177a85b05bbf703' then
    raise exception 'text_facts_af_columns moved since the apartments migration; rebase this migration';
  end if;
  if md5(pg_get_functiondef('public.text_facts_apply_slice(text,bigint,bigint)'::regprocedure)) <> '6ed2ab00980ed6c39e99c7386865e96f' then
    raise exception 'text_facts_apply_slice moved since the apartments migration; rebase this migration';
  end if;
  if md5(pg_get_viewdef('public.listing_text_facts_af'::regclass, true)) <> '69fd5c31bfbaa9e025afa3212e20053a' then
    raise exception 'listing_text_facts_af moved since the apartments migration; rebase this migration';
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
               'women_majlis','outdoor_kitchen','outdoor_diwaniya','waterfall','well','irrigation','sports_court']::text[]
$$;
do $$
begin
  if public.text_facts_all_quoted('{"well": {"v": true, "q": ""}}'::jsonb)
     or public.text_facts_all_quoted('{"waterfall": {"v": 1, "q": "شلال"}}'::jsonb)
     or not public.text_facts_all_quoted('{"women_majlis": {"v": true, "q": "مجلس نساء"}, "sports_court": {"v": true, "q": "ملعب"}, "wifi": {"v": true, "q": "واي فاي"}}'::jsonb) then
    raise exception 'text_facts_all_quoted does not admit the new keys as intended';
  end if;
end $$;

-- the overlay view: every existing column keeps its position; the 7 villa keys are appended after the numbers.
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
       public.text_fact_bool(f.facts, 'sports_court') as sports_court
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);
comment on view public.listing_text_facts_af is
  'Rule B overlay input: the ad-text value per Advanced Filter column (67 booleans + street_width_m, apartments_count, shops_count), only with its quote, never from changed text, empty when ops_feature_flags.af_text_facts_overlay is off; street_width_m / majlis each behind their own switch.';

-- text_facts_apply_slice: the 7 villa keys join the merge select, the set list and both change-detection tuples
do $mig$
declare src text; fn text; needle text; repl text; n int; k text; lst text;
begin
  fn := 'public.text_facts_apply_slice(text,bigint,bigint)';
  src := pg_get_functiondef(fn::regprocedure);

  needle := $x$             public.af_rule_b_num(r.shops_count, tf.shops_count) as shops_count$x$;
  select needle || ',' || E'\n' || string_agg(format('             public.af_rule_b(r.%1$I, tf.%1$I) as %1$I', token), ',' || E'\n' order by ord)
    into repl from _villa_tokens where kind = 'bool';
  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then raise exception '%: merge-select needle found % times, expected 1', fn, n; end if;
  src := replace(src, needle, repl);

  needle := $x$shops_count = m.shops_count$x$;
  select needle || ', ' || string_agg(format('%1$I = m.%1$I', token), ', ' order by ord) into repl from _villa_tokens where kind = 'bool';
  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then raise exception '%: set-list needle found % times, expected 1', fn, n; end if;
  src := replace(src, needle, repl);

  foreach k in array array['s', 'm'] loop
    needle := k || '.shops_count)';
    select k || '.shops_count, ' || string_agg(k || '.' || token, ', ' order by ord) || ')' into repl from _villa_tokens where kind = 'bool';
    n := (length(src) - length(replace(src, needle, ''))) / length(needle);
    if n <> 1 then raise exception '%: % tuple needle found % times, expected 1', fn, k, n; end if;
    src := replace(src, needle, repl);
  end loop;
  execute src;
  if position('tf.sports_court) as sports_court' in pg_get_functiondef(fn::regprocedure)) = 0 then
    raise exception '%: the rebuilt applier does not merge sports_court', fn;
  end if;
end $mig$;

-- ── 3.–7. the Advanced Filter surfaces, exactly as the apartments migration did, the strings built from _villa_tokens ──
do $do$
declare
  wl_old text := $x$'has_shops','furnished','rnpl','rent_now_pay_later'))$x$;
  wl_new text;
  pred_old text := $x$           and (not ('has_shops' = any(p_amenities)) or s.shops_count >= 1)$x$;
  pred_new text;
  scoped_old text := $x$s.apartments_count, s.shops_count, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  scoped_new text;
  ret_old text := $x$cnt_shops_unknown bigint, cnt_selected bigint$x$;
  ret_new text;
  sel_old text := $x$    count(*) filter (where shops_count is null) as cnt_shops_unknown,$x$;
  sel_new text;
  bath_ret_old text := $x$cnt_bath4 bigint,$x$;
  bath_ret_new text := $x$cnt_bath4 bigint, cnt_bath5 bigint, cnt_bath6 bigint,$x$;
  bath_sel_old text := $x$    count(*) filter (where bathrooms >= 4)                  as cnt_bath4,$x$;
  bath_sel_new text := $x$    count(*) filter (where bathrooms >= 4)                  as cnt_bath4,
    count(*) filter (where bathrooms >= 5)                  as cnt_bath5,
    count(*) filter (where bathrooms >= 6)                  as cnt_bath6,$x$;
  canon_old text := $x$'shops_count', s.shops_count) end as af_canon$x$;
  canon_new text;
  sweep_old text := $x$        ('amenity:has_shops','cnt_has_shops','p_amenities:=array[''has_shops'']','s.shops_count >= 1'),$x$;
  sweep_add text;
  sweep_bath_old text := $x$        ('bathrooms:4+','cnt_bath4','p_bath_min:=4','s.bathrooms >= 4'),$x$;
  sweep_bath_new text := $x$        ('bathrooms:4+','cnt_bath4','p_bath_min:=4','s.bathrooms >= 4'),
        ('bathrooms:5+','cnt_bath5','p_bath_min:=5','s.bathrooms >= 5'),
        ('bathrooms:6+','cnt_bath6','p_bath_min:=6','s.bathrooms >= 6'),$x$;
  tt_old text := $x$    ('amenity:has_shops','cnt_has_shops','p_amenities:=array[''has_shops'']','s.shops_count >= 1','guided'),$x$;
  tt_add text;
  tt_bath_old text := $x$    ('bathrooms:4+','cnt_bath4','p_bath_min:=4','s.bathrooms >= 4','guided'),$x$;
  tt_bath_new text := $x$    ('bathrooms:4+','cnt_bath4','p_bath_min:=4','s.bathrooms >= 4','guided'),
    ('bathrooms:5+','cnt_bath5','p_bath_min:=5','s.bathrooms >= 5','guided'),
    ('bathrooms:6+','cnt_bath6','p_bath_min:=6','s.bathrooms >= 6','guided'),$x$;
  cols text; toks text; clause text; tcbd_def text; tpl text; sweep_def text; tt_def text; occ int;
  before_n bigint; after_n bigint; parity int; v_counts jsonb; v_chip bigint; v_ref bigint; v_direct bigint; v_garbage bigint; v_drift int; tok text;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure)) <> '126242b981111b6879a3f27c162478b7' then
    raise exception 'ABORT: af_eligibility_clause moved since this migration was written (%)', md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure));
  end if;
  if md5(pg_get_functiondef('public.top_cities_by_deal_ar'::regproc)) <> 'c6685a8ff4a83a5ebb7162a9c6381e73' then
    raise exception 'ABORT: top_cities_by_deal_ar moved since this migration was written';
  end if;
  if md5(pg_get_functiondef('public.ops_af_option_truth_sweep'::regproc)) <> 'b5bb892b814bd20881ec2af843b14e8c'
     or md5(pg_get_functiondef('public.af_option_truth_table'::regproc)) <> 'a151e7416d265afc3c5fa3f90d631d29' then
    raise exception 'ABORT: the sweep or the truth table moved since this migration was written';
  end if;

  select string_agg(quote_literal(token), ',' order by ord) into toks from _villa_tokens;
  wl_new := $x$'has_shops',$x$ || toks || $x$,'furnished','rnpl','rent_now_pay_later'))$x$;
  select pred_old || E'\n' || string_agg(format('           and (not (%L = any(p_amenities)) or %s)', token, pred), E'\n' order by ord) into pred_new from _villa_tokens;
  select string_agg('s.' || token, ', ' order by ord) into cols from _villa_tokens where kind = 'bool';
  scoped_new := 's.apartments_count, s.shops_count, ' || cols || ', s.rating, s.reviews_count, s.unit_subtype_ar';
  select 'cnt_shops_unknown bigint, ' || string_agg('cnt_' || token || ' bigint', ', ' order by ord) || ', cnt_selected bigint' into ret_new from _villa_tokens;
  select sel_old || E'\n' || string_agg(format('    count(*) filter (where %s) as cnt_%s,', flt, token), E'\n' order by ord) into sel_new from _villa_tokens;
  -- a third jsonb_build_object joined with || : one call takes at most 100 arguments (the second already carries 82)
  select $x$'shops_count', s.shops_count) || jsonb_build_object($x$ || string_agg(format('%L, s.%I', token, token), ', ' order by ord) || $x$) end as af_canon$x$
    into canon_new from _villa_tokens where kind = 'bool';
  select sweep_old || E'\n' || string_agg(format('        (%L,%L,%L,%L),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into sweep_add from _villa_tokens;
  select tt_old || E'\n' || string_agg(format('    (%L,%L,%L,%L,''guided''),', 'amenity:' || token, 'cnt_' || token, 'p_amenities:=array[''' || token || ''']', direct), E'\n' order by ord) into tt_add from _villa_tokens;

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

  -- 4. the guided-counts template (the villa tokens, then the two bathroom rungs)
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
  occ := (length(tpl) - length(replace(tpl, bath_ret_old, ''))) / length(bath_ret_old);
  if occ <> 1 then raise exception 'ABORT: bath returns needle occurs %', occ; end if;
  tpl := replace(tpl, bath_ret_old, bath_ret_new);
  occ := (length(tpl) - length(replace(tpl, bath_sel_old, ''))) / length(bath_sel_old);
  if occ <> 1 then raise exception 'ABORT: bath select needle occurs %', occ; end if;
  tpl := replace(tpl, bath_sel_old, bath_sel_new);
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
  if position('''sports_court'', s.sports_court' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0 then
    raise exception 'ABORT: the rebuilt location_search_candidates_ar does not pack sports_court';
  end if;

  -- 7. chip == referee == direct on the fleet-wide base (the exact formula of 20260902220000)
  select to_jsonb(g) into v_counts from apartment_guided_counts_ar() g;
  for tok in select token from _villa_tokens loop
    if v_counts ->> ('cnt_' || tok) is null then raise exception 'ABORT: rebuilt RPC has no cnt_% column', tok; end if;
  end loop;
  if v_counts ->> 'cnt_bath5' is null or v_counts ->> 'cnt_bath6' is null then raise exception 'ABORT: bath5/bath6 counts missing'; end if;
  v_chip := (v_counts ->> 'cnt_women_majlis')::bigint;
  select af_eligible_count(p_amenities:=array['women_majlis']) into v_ref;
  select count(*) into v_direct from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
     and s.women_majlis;
  if v_chip <> v_ref or v_ref <> v_direct then
    raise exception 'ABORT: women_majlis chip % / referee % / direct % disagree', v_chip, v_ref, v_direct;
  end if;
  v_chip := (v_counts ->> 'cnt_garden_yard')::bigint;
  select af_eligible_count(p_amenities:=array['garden_yard']) into v_ref;
  if v_chip <> v_ref then raise exception 'ABORT: garden_yard chip % / referee % disagree', v_chip, v_ref; end if;
  v_chip := (v_counts ->> 'cnt_bath6')::bigint;
  select af_eligible_count(p_bath_min:=6) into v_ref;
  if v_chip <> v_ref then raise exception 'ABORT: bath6 chip % / referee % disagree', v_chip, v_ref; end if;
  select af_eligible_count(p_amenities:=array['garbage_token_zz']) into v_garbage;
  if v_garbage <> 0 then raise exception 'ABORT: af_eligible_count garbage token returned %', v_garbage; end if;
  if (select count(*) from top_cities_by_deal_ar(p_amenities:=array['garbage_token_zz'])) <> 0 then
    raise exception 'ABORT: top_cities_by_deal_ar garbage token returned rows';
  end if;

  -- 6. the runtime sweep and the in-DB truth table learn every token and the two bathroom rungs
  select pg_get_functiondef(p.oid) into sweep_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ops_af_option_truth_sweep';
  occ := (length(sweep_def) - length(replace(sweep_def, sweep_old, ''))) / length(sweep_old);
  if occ <> 1 then raise exception 'ABORT: sweep anchor occurs %', occ; end if;
  sweep_def := replace(sweep_def, sweep_old, sweep_add);
  occ := (length(sweep_def) - length(replace(sweep_def, sweep_bath_old, ''))) / length(sweep_bath_old);
  if occ <> 1 then raise exception 'ABORT: sweep bath anchor occurs %', occ; end if;
  execute replace(sweep_def, sweep_bath_old, sweep_bath_new);
  select pg_get_functiondef(p.oid) into tt_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'af_option_truth_table';
  occ := (length(tt_def) - length(replace(tt_def, tt_old, ''))) / length(tt_old);
  if occ <> 1 then raise exception 'ABORT: truth-table anchor occurs %', occ; end if;
  tt_def := replace(tt_def, tt_old, tt_add);
  occ := (length(tt_def) - length(replace(tt_def, tt_bath_old, ''))) / length(tt_bath_old);
  if occ <> 1 then raise exception 'ABORT: truth-table bath anchor occurs %', occ; end if;
  execute replace(tt_def, tt_bath_old, tt_bath_new);
  select count(*) into v_drift from af_option_vocab_drift();
  if v_drift <> 0 then
    raise exception 'ABORT: af_option_vocab_drift reports % row(s): %', v_drift,
      (select string_agg(d.side || ':' || d.label, ', ') from af_option_vocab_drift() d);
  end if;
  if (select count(*) from af_option_truth_table() where label like 'amenity:%') <> 77 then
    raise exception 'ABORT: expected 77 amenity rows in af_option_truth_table, got %', (select count(*) from af_option_truth_table() where label like 'amenity:%');
  end if;
  if (select count(*) from af_option_truth_table() where label in ('bathrooms:5+','bathrooms:6+')) <> 2 then
    raise exception 'ABORT: the truth table did not learn bathrooms:5+/6+';
  end if;

  -- 7. the registry describes every chip
  insert into public.af_field_registry
    (canonical_key, label_ar, category, datatype, unknown_policy, ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
  select token, label_ar, 'amenity', 'boolean', 'NULL', true, 'more_options', null,
         'Villas group chip (owner 2026-11-02). ' || case when kind = 'bool' then 'af_rule_b(NULL box, the ad''s quoted words); IS TRUE token.' else 'Derived predicate token: ' || pred end,
         'advanced'
    from _villa_tokens
  on conflict (canonical_key) do update
    set ui_exposed = true, ui_group = 'more_options', not_exposed_reason = null, filter_tier = 'advanced',
        label_ar = excluded.label_ar, concept_note = excluded.concept_note, category = excluded.category, datatype = excluded.datatype;

  raise notice 'SUCCESS: 12 villa tokens live on af_eligibility_clause + top_cities_by_deal_ar; counts (+cnt_bath5/6) in the scoped CTE; af_canon packs 7 new columns; women_majlis chip==referee==direct (%); parity 0; cohort % unchanged', v_chip, before_n;
end $do$;

drop table _villa_tokens;