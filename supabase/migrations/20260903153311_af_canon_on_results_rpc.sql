-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║  STATUS: DRAFT — NOT APPLIED TO PRODUCTION (re-derived 2026-09-03T15:33Z).                  ║
-- ║  Verified end-to-end twice: on a throw-away Supabase branch (created → applied → smoked →   ║
-- ║  deleted), and again against the NOW-LIVE production template inside a DO block that ends   ║
-- ║  in `raise exception`, so the whole verification ROLLS BACK and production keeps its         ║
-- ║  definitions. Re-derivation basis: the class-wide truth barrier (#1527) edited the           ║
-- ║  apartment_guided_counts_ar row and rebuilt all four RPCs, but left the results template     ║
-- ║  byte-identical — md5 0b4747305c5748f980b12eeb7013f236, unchanged — and all 7 anchors below  ║
-- ║  still occur EXACTLY once (counted with (length − length(replace))/length on the live text).  ║
-- ║  Whoever applies it must re-run those counts against what is live THEN; the guards below do  ║
-- ║  exactly that and abort otherwise.                                                           ║
-- ║  When applied: add sql/mirrors/af_canon_select.sql (the jsonb fragment) and re-record the    ║
-- ║  af_rpc replay checkpoint, same change — migration-mirror rule.                              ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- WHAT. The results RPC public.location_search_candidates_ar returns ONE additional column,
-- `af_canon jsonb`: the Advanced-Filter-relevant columns of the EXACT search_listings_ar row the
-- eligibility predicate ran on, packed with jsonb_build_object so a SQL NULL stays a JSON null
-- (never dropped, never coalesced). The card's «مطابق لطلبك» strip (src/lib/afEvidence.ts) renders
-- evidence ONLY from this row — the same truth the filter used, not the raw platform tables whose
-- NULLs finalize() collapses to 0/false. UNKNOWN stays UNKNOWN end to end.
--
-- HOW. Through the template/rebuild path ONLY (owner decision 7): a RETURNS TABLE change cannot be
-- CREATE OR REPLACEd (it would create a second overload — the PGRST203 outage shape), and a hand
-- edit trips af_parity_hand_edit (20260830134244). Every edit is a needle-replace on the LIVE
-- template text, each anchor asserted to occur EXACTLY once — a missed or duplicated anchor raises
-- and, DDL being transactional, production is left untouched. rebuild_af_filter_rpcs() drops every
-- overload first and re-creates all four AF RPCs from their templates.
--
-- WHY THE OTHER THREE RPCs ARE UNTOUCHED. Only the results RPC feeds cards. The counts RPCs and the
-- referee keep their templates byte-for-byte; the rebuild re-creates them identically.
--
-- RE-VERIFICATION 2026-09-03T15:34Z, against LIVE production, rolled back. The whole body below was
-- replayed on production inside a single DO block whose last statement is `raise exception`, so the
-- template UPDATE and the rebuild rolled back and production kept its definitions. Actual result line:
--   VERIFY_OK_ROLLED_BACK overloads=1 rowtype_has_af_canon=yes parity=0 rows=200 keys_checked=5600
--   json_nulls=4920 bath_rows=50 dir_rows=50 furnished_rows=50 total_index_rows=193150
-- i.e. all 7 anchors hit exactly once on the live text; one overload; the row type carries
-- `af_canon jsonb`; mon_af_predicate_parity() = 0; 200 real rows each had all 28 keys present and each
-- af_canon equalled the same jsonb_build_object over its own source row; 4,920 of the 5,600 key reads
-- were JSON null (a SQL NULL arrives as JSON null — present, typed 'null', never absent, never 0/false,
-- proven non-vacuously); and an explicit probe on a row with `gym is null` returned jsonb_typeof 'null'.
-- Afterwards production re-checked: results template md5 still 0b4747305c5748f980b12eeb7013f236, no
-- 'af_canon' in it, 1 overload, row type WITHOUT af_canon, parity 0, af_rpc_build_state def_md5 == live
-- for all four RPCs, and schema_migrations has no af_canon row.
--
-- SMOKE, inside the transaction: (1) exactly one overload; (2) the row type carries af_canon jsonb;
-- (3) mon_af_predicate_parity() = 0; (4) every returned af_canon has all 28 keys, each a jsonb
-- value (JSON null for a SQL NULL, never absent), and equals the same construction over the source
-- row it names — same row, same truth; (5) p_bath_min:=3 rows carry a NUMBER bathrooms >= 3 and
-- p_directions rows a direction that normalises to the pick. Anything else raises.
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- Needle-replace with an exactly-once guard. pg_temp: transaction-scoped, leaves nothing behind.
create function pg_temp.af_canon_needle(tpl text, old text, new text) returns text
language plpgsql as $f$
declare n int;
begin
  n := (length(tpl) - length(replace(tpl, old, ''))) / length(old);
  if n <> 1 then
    raise exception 'af_canon anchor missed: % occurs % times in the live template (expected 1)', left(old, 80), n;
  end if;
  return replace(tpl, old, new);
end $f$;

do $do$
declare
  tpl text; n int; r record; exp jsonb; k text; rows_seen int := 0; total_rows bigint;
  -- THE 28 COLUMNS = the union of every canonical column an Advanced-Filter predicate reads
  -- (src/lib/afEvidence.ts `reads`, verified by scripts/verify-af-card-evidence.ts). Order is
  -- irrelevant (jsonb), the set is not.
  build constant text :=
    'jsonb_build_object('
    || '''bathrooms'', s.bathrooms, ''property_age'', s.property_age, ''furnished'', s.furnished, '
    || '''street_width_m'', s.street_width_m, ''direction_ar'', s.direction_ar, ''rating'', s.rating, '
    || '''reviews_count'', s.reviews_count, ''unit_subtype_ar'', s.unit_subtype_ar, '
    || '''rent_now_pay_later'', s.rent_now_pay_later, ''elevator'', s.elevator, ''parking'', s.parking, '
    || '''kitchen'', s.kitchen, ''air_conditioner'', s.air_conditioner, ''maid_room'', s.maid_room, '
    || '''driver_room'', s.driver_room, ''private_entrance'', s.private_entrance, '
    || '''car_entrance'', s.car_entrance, ''sanitation'', s.sanitation, ''electricity'', s.electricity, '
    || '''water_supply'', s.water_supply, ''gym'', s.gym, ''pool'', s.pool, ''garden'', s.garden, '
    || '''balcony'', s.balcony, ''laundry_room'', s.laundry_room, ''optical_fibers'', s.optical_fibers, '
    || '''separate_electricity_meter'', s.separate_electricity_meter, '
    || '''separate_water_meter'', s.separate_water_meter)';
  keys constant text[] := array['bathrooms','property_age','furnished','street_width_m','direction_ar',
    'rating','reviews_count','unit_subtype_ar','rent_now_pay_later','elevator','parking','kitchen',
    'air_conditioner','maid_room','driver_room','private_entrance','car_entrance','sanitation',
    'electricity','water_supply','gym','pool','garden','balcony','laundry_room','optical_fibers',
    'separate_electricity_meter','separate_water_meter'];
begin
  if array_length(keys, 1) <> 28 then raise exception 'key roster is % long, expected 28', array_length(keys, 1); end if;

  select template into strict tpl from public.af_rpc_templates
   where fn_name = 'location_search_candidates_ar' for update;
  if position('af_canon' in tpl) <> 0 then
    raise exception 'template already carries af_canon — this migration was applied before, or the template was hand-edited';
  end if;

  -- 1. row type
  tpl := pg_temp.af_canon_needle(tpl,
    'area_m2 integer, bedrooms integer)',
    'area_m2 integer, bedrooms integer, af_canon jsonb)');
  -- 2. build it ONCE, in `matched`, from the row the eligibility clause just accepted
  tpl := pg_temp.af_canon_needle(tpl,
    E'           s.has_photo\n    from public.search_listings_ar s',
    E'           s.has_photo,\n           ' || build || E' as af_canon\n    from public.search_listings_ar s');
  -- 3..7. project it through every stage: branch a (inner, outer), branch t (inner, outer), final
  tpl := pg_temp.af_canon_needle(tpl,
    'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms,',
    'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,');
  tpl := pg_temp.af_canon_needle(tpl,
    'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.div_rank',
    'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank');
  tpl := pg_temp.af_canon_needle(tpl,
    'm.effective_price, m.area_m2, m.bedrooms, m.has_photo,',
    'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,');
  tpl := pg_temp.af_canon_needle(tpl,
    't.total_count, t.effective_price, t.area_m2, t.bedrooms,',
    't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,');
  tpl := pg_temp.af_canon_needle(tpl,
    'u.total_count, u.effective_price, u.area_m2, u.bedrooms',
    'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon');

  n := (length(tpl) - length(replace(tpl, 'af_canon', ''))) / length('af_canon');
  if n <> 7 then raise exception 'expected af_canon to appear exactly 7 times after the edits, found %', n; end if;
  if position('__AF_ELIGIBILITY_WHERE__' in tpl) = 0 then raise exception 'template lost the eligibility placeholder'; end if;

  update public.af_rpc_templates set template = tpl where fn_name = 'location_search_candidates_ar';

  perform public.rebuild_af_filter_rpcs();

  -- ── smoke 1: one overload, row type carries the column ───────────────────────────────────────
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';
  if n <> 1 then raise exception 'location_search_candidates_ar has % overloads after rebuild', n; end if;
  select pg_get_function_result(p.oid) into strict tpl
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';
  if tpl not like '%af_canon jsonb%' then raise exception 'rebuilt RPC row type lacks af_canon jsonb: %', tpl; end if;

  -- ── smoke 2: predicate parity across the four templated surfaces is intact ──────────────────
  select public.mon_af_predicate_parity() into n;
  if n <> 0 then raise exception 'mon_af_predicate_parity() = % after rebuild (expected 0)', n; end if;

  -- ── smoke 3: every af_canon is complete, NULL-preserving, and IS the source row ──────────────
  for r in select c.source_table, c.listing_id, c.af_canon
             from public.location_search_candidates_ar(p_limit := 200) c
  loop
    rows_seen := rows_seen + 1;
    if r.af_canon is null then raise exception 'af_canon is SQL NULL for %:%', r.source_table, r.listing_id; end if;
    if (select count(*) from jsonb_object_keys(r.af_canon)) <> 28 then
      raise exception 'af_canon for %:% has % keys, expected 28 (a NULL column must be a JSON null, never absent)',
        r.source_table, r.listing_id, (select count(*) from jsonb_object_keys(r.af_canon));
    end if;
    foreach k in array keys loop
      if (r.af_canon -> k) is null then raise exception 'af_canon for %:% lacks key %', r.source_table, r.listing_id, k; end if;
    end loop;
    execute 'select ' || build || ' from public.search_listings_ar s where s.source_table = $1 and s.listing_id = $2'
       into strict exp using r.source_table, r.listing_id;
    if r.af_canon <> exp then
      raise exception 'af_canon for %:% is not the source row: % vs %', r.source_table, r.listing_id, r.af_canon, exp;
    end if;
  end loop;

  -- ── smoke 4: the value beside an active predicate is the row's real value ───────────────────
  for r in select c.af_canon from public.location_search_candidates_ar(p_bath_min := 3, p_limit := 50) c loop
    rows_seen := rows_seen + 1;
    if jsonb_typeof(r.af_canon -> 'bathrooms') <> 'number' or (r.af_canon ->> 'bathrooms')::int < 3 then
      raise exception 'p_bath_min=3 returned af_canon.bathrooms = %', r.af_canon -> 'bathrooms';
    end if;
  end loop;
  for r in select c.af_canon from public.location_search_candidates_ar(p_directions := array['شمال'], p_limit := 50) c loop
    rows_seen := rows_seen + 1;
    if public.norm_direction_ar(r.af_canon ->> 'direction_ar') is distinct from 'شمال' then
      raise exception 'p_directions=[شمال] returned af_canon.direction_ar = %', r.af_canon -> 'direction_ar';
    end if;
  end loop;
  for r in select c.af_canon from public.location_search_candidates_ar(p_furnished := false, p_limit := 50) c loop
    rows_seen := rows_seen + 1;
    if r.af_canon -> 'furnished' <> 'false'::jsonb then
      raise exception 'p_furnished=false returned af_canon.furnished = %', r.af_canon -> 'furnished';
    end if;
  end loop;

  select count(*) into total_rows from public.search_listings_ar;
  if total_rows > 0 and rows_seen = 0 then
    raise exception 'search_listings_ar has % rows but the smoke saw none — the RPC returned nothing', total_rows;
  end if;

  raise notice 'SUCCESS: af_canon jsonb on location_search_candidates_ar via template rebuild; parity 0; % smoke rows verified (28 keys, NULL-preserving, source-row identical)', rows_seen;
end $do$;
