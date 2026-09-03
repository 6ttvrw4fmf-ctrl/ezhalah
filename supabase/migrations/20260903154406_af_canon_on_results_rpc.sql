-- §12A / R13.12 (owner 2026-09-03): "Whatever the user selected in Advanced Filter must be visibly
-- and truthfully shown on the returned property card."
--
-- WHAT. public.location_search_candidates_ar returns one additional column, `af_canon jsonb`: the
-- Advanced-Filter-relevant columns of the EXACT search_listings_ar row the eligibility predicate ran
-- on, packed with jsonb_build_object so a SQL NULL stays a JSON null (never dropped, never
-- coalesced). The card's «مطابق لطلبك» strip (src/lib/afEvidence.ts) renders evidence ONLY from this
-- row — the same truth the filter used, not the raw platform tables whose NULLs finalize() collapses
-- to 0/false. UNKNOWN stays UNKNOWN end to end.
--
-- GATED, AND WHY. The object averages 598 bytes over a 2,000-row production sample (max 612). The
-- results RPC serves a 1,500-row page-0 buffer, so packing it on every call would add ~876 KB to
-- EVERY search response — including the overwhelming majority that carry no AF answer, render no
-- strip, and would spend all of it for nothing on a mobile connection. The gate is the disjunction of
-- the eleven AF predicate parameters (a superset of what the card can render): no AF answer ⇒
-- af_canon is SQL NULL, which the client already reads as "no evidence". Mirrored for the barrier in
-- sql/mirrors/af_canon_select.sql; scripts/verify-af-card-evidence.ts (T6) fails if a column the card
-- reads is unpacked, or an AF parameter is missing from the gate.
--
-- HOW. Through the template/rebuild path ONLY (AGENTS.md hard rail: never hand-edit the four AF
-- shared-eligibility RPCs). A RETURNS TABLE change cannot be CREATE OR REPLACEd — it would create a
-- second overload, the PGRST203 outage shape — and a hand edit trips af_parity_hand_edit. Each anchor
-- is asserted to occur EXACTLY once before it is replaced; a missed or duplicated anchor raises and,
-- DDL being transactional, production is left untouched. rebuild_af_filter_rpcs() drops every
-- overload and re-creates all four AF RPCs from their templates.
--
-- VERIFIED BY A FULL DRY RUN ON PRODUCTION (2026-09-03): applied → all six smokes green → rolled
-- back. 350 rows checked for 28 keys, NULL-preservation and source-row identity; parity 0; gate held.
--
-- SMOKE, inside the transaction: (1) exactly one overload; (2) the row type carries af_canon jsonb;
-- (3) mon_af_predicate_parity() = 0; (4) under an ACTIVE AF predicate every af_canon has all 28 keys,
-- each present as a jsonb value and equal to the same construction over the source row it names;
-- (5) the value beside an active predicate is the row's real value; (6) with NO AF predicate,
-- af_canon is SQL NULL — the payload saving is asserted, not assumed. Anything else raises.
do $do$
declare
  tpl text; n int; i int; r record; exp jsonb; k text; edits text[][];
  rows_seen int := 0; ungated int := 0; total_rows bigint;
  obj constant text :=
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
  gate constant text :=
    'case when (p_bath_min is not null or p_amenities is not null or p_furnished is not null '
    || 'or p_street_width_min is not null or p_directions is not null or p_rating_min is not null '
    || 'or p_reviews_min is not null or p_unit_subtypes is not null or p_age_min is not null '
    || 'or p_age_max is not null or p_is_new_construction is not null) then ';
  build constant text := gate || obj || ' end';
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
  edits := array[
    array['area_m2 integer, bedrooms integer)',
          'area_m2 integer, bedrooms integer, af_canon jsonb)'],
    array[E'           s.has_photo\n    from public.search_listings_ar s',
          E'           s.has_photo,\n           ' || build || E' as af_canon\n    from public.search_listings_ar s'],
    array['count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms,',
          'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,'],
    array['a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.div_rank',
          'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank'],
    array['m.effective_price, m.area_m2, m.bedrooms, m.has_photo,',
          'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,'],
    array['t.total_count, t.effective_price, t.area_m2, t.bedrooms,',
          't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,'],
    array['u.total_count, u.effective_price, u.area_m2, u.bedrooms',
          'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon']
  ];
  for i in 1 .. array_length(edits, 1) loop
    n := (length(tpl) - length(replace(tpl, edits[i][1], ''))) / length(edits[i][1]);
    if n <> 1 then
      raise exception 'af_canon anchor % occurs % times in the live template (expected 1): %', i, n, left(edits[i][1], 80);
    end if;
    tpl := replace(tpl, edits[i][1], edits[i][2]);
  end loop;
  n := (length(tpl) - length(replace(tpl, 'af_canon', ''))) / length('af_canon');
  if n <> 7 then raise exception 'expected af_canon to appear exactly 7 times after the edits, found %', n; end if;
  if position('__AF_ELIGIBILITY_WHERE__' in tpl) = 0 then raise exception 'template lost the eligibility placeholder'; end if;

  update public.af_rpc_templates set template = tpl where fn_name = 'location_search_candidates_ar';
  perform public.rebuild_af_filter_rpcs();

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';
  if n <> 1 then raise exception 'location_search_candidates_ar has % overloads after rebuild', n; end if;
  select pg_get_function_result(p.oid) into strict tpl
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';
  if tpl not like '%af_canon jsonb%' then raise exception 'rebuilt RPC row type lacks af_canon jsonb: %', tpl; end if;

  select public.mon_af_predicate_parity() into n;
  if n <> 0 then raise exception 'mon_af_predicate_parity() = % after rebuild (expected 0)', n; end if;

  for r in select c.source_table, c.listing_id, c.af_canon
             from public.location_search_candidates_ar(p_bath_min := 1, p_limit := 200) c
  loop
    rows_seen := rows_seen + 1;
    if r.af_canon is null then raise exception 'af_canon is SQL NULL under an active predicate for %:%', r.source_table, r.listing_id; end if;
    if (select count(*) from jsonb_object_keys(r.af_canon)) <> 28 then
      raise exception 'af_canon for %:% has % keys, expected 28 (a NULL column must be a JSON null, never absent)',
        r.source_table, r.listing_id, (select count(*) from jsonb_object_keys(r.af_canon));
    end if;
    foreach k in array keys loop
      if (r.af_canon -> k) is null then raise exception 'af_canon for %:% lacks key %', r.source_table, r.listing_id, k; end if;
    end loop;
    execute 'select ' || obj || ' from public.search_listings_ar s where s.source_table = $1 and s.listing_id = $2'
       into strict exp using r.source_table, r.listing_id;
    if r.af_canon <> exp then
      raise exception 'af_canon for %:% is not the source row: % vs %', r.source_table, r.listing_id, r.af_canon, exp;
    end if;
  end loop;

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

  select count(*) into ungated from public.location_search_candidates_ar(p_limit := 200) c
   where c.af_canon is not null;
  if ungated <> 0 then
    raise exception 'af_canon was packed on % row(s) of a search carrying NO AF predicate — the gate is not holding', ungated;
  end if;

  select count(*) into total_rows from public.search_listings_ar;
  if total_rows > 0 and rows_seen = 0 then
    raise exception 'search_listings_ar has % rows but the smoke saw none — the RPC returned nothing', total_rows;
  end if;

  raise notice 'SUCCESS: af_canon jsonb on location_search_candidates_ar via template rebuild; parity 0; % smoke rows verified; gate holds', rows_seen;
end $do$;