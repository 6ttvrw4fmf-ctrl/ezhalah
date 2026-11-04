-- THE WELCOME FACTS FOLLOW THE LAND PRICE GUARD (owner 2026-11-04: the facts must be accurate after the land guard).
--
-- The land price facts (land_ppm_city, land_gap, month_land_ppm) take the median of search_listings_ar.price_per_meter.
-- Since 20261104221607 a land «total» the guard read as a per-metre price carries that figure in price_per_meter
-- (ppm_typed_as_total), so it speaks at the corrected price. A row the guard REFUSES to read (land_price_unit_review_ar:
-- per-metre or thousands, «الف» in the ad, price = area, outside the band) must join no price median — it still counts
-- as a listing (city_land, land_share, week_land, wow_land are counts), its figure does not.
--
-- 1. build_welcome_insights(): price_per_meter := null for those rows, right after the base is read.
-- 2. audit_welcome_insights() recounts with the SAME exclusion (its own code, written again), and fails every land price
--    fact with «land_fact_reads_review_rows» if the builder ever loses the exclusion — so a nightly build cannot regress
--    silently: the fact is deleted and mon_detect_welcome_insights_audit raises.
-- villa_price / bld_price / apt_sale_ppm need nothing: their floors (price_total ≥ 200,000 / 300,000 / 100,000) already
-- keep a per-metre figure typed as a total out.
-- 3. mon_detect_land_ppm_typed_as_total(): the review count is the number of rows, not the number of reasons.
-- All three are edited BY EXACT TEXT REPLACE (RAISE unless each anchor is found exactly once), never a full replace.

do $edit$
declare d text; k int; a text; b text; i int;
  pairs text[][];
begin
  -- 1. the builder
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'build_welcome_insights';
  if position('land_price_unit_review_ar' in d) > 0 then raise exception 'build_welcome_insights: already wired'; end if;
  a := E'     where s.production_ready and s.city_ar is not null and s.city_ar <> ''غير معروف'' and s.region_ar is not null;\n';
  b := a
    || E'  -- a land price the guard refuses to read (land_price_unit_review_ar, owner 2026-11-04) joins no price median;\n'
    || E'  -- the ad still counts as a listing. Rows the guard corrected carry their real per-metre price already.\n'
    || E'  update w_b b set price_per_meter = null\n'
    || E'    from public.land_price_unit_review_ar r\n'
    || E'   where r.source_table = b.source_table and r.listing_id = b.listing_id and r.deal_ar = ''بيع'';\n';
  k := (length(d) - length(replace(d, a, ''))) / length(a);
  if k <> 1 then raise exception 'build_welcome_insights: expected exactly 1 anchor, found %', k; end if;
  execute replace(d, a, b);

  -- 2. the audit (the recount, written again)
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'audit_welcome_insights';
  if position('land_price_unit_review_ar' in d) > 0 then raise exception 'audit_welcome_insights: already wired'; end if;
  pairs := array[
    array[E'  checked int := 0; failed int := 0;',
          E'  checked int := 0; failed int := 0; v_build_excludes boolean;'],
    array[E'  create temp table a_b on commit drop as\n',
          E'  -- land prices the guard refuses to read (owner 2026-11-04) join no price median here either\n'
       || E'  create temp table a_review on commit drop as\n'
       || E'    select source_table, listing_id from public.land_price_unit_review_ar where deal_ar = ''بيع'';\n'
       || E'  create temp table a_b on commit drop as\n'],
    array[E'           s.price_annual, s.price_total, s.price_per_meter, s.area_m2, s.property_age,\n',
          E'           s.price_annual, s.price_total, case when rv.listing_id is null then s.price_per_meter end price_per_meter, s.area_m2, s.property_age,\n'],
    array[E'      left join a_posted ap on ap.source_table = s.source_table and ap.listing_id = s.listing_id\n',
          E'      left join a_posted ap on ap.source_table = s.source_table and ap.listing_id = s.listing_id\n'
       || E'      left join a_review rv on rv.source_table = s.source_table and rv.listing_id = s.listing_id\n'],
    array[E'  for r in select * from public.welcome_insight where day = d loop\n',
          E'  -- the builder must keep the guard''s exclusion, or no land price fact is published (owner 2026-11-04)\n'
       || E'  v_build_excludes := position(''land_price_unit_review_ar'' in (select p.prosrc from pg_proc p where p.oid = ''public.build_welcome_insights()''::regprocedure)) > 0;\n'
       || E'  for r in select * from public.welcome_insight where day = d loop\n'],
    array[E'    elsif gate and r.city_id is not null and coalesce((select c.n from a_city c where c.city_id = r.city_id), 0) < 300 then why := ''small_town_not_yet'';\n',
          E'    elsif gate and r.city_id is not null and coalesce((select c.n from a_city c where c.city_id = r.city_id), 0) < 300 then why := ''small_town_not_yet'';\n'
       || E'    elsif r.kind in (''land_ppm_city'', ''land_gap'', ''month_land_ppm'') and not v_build_excludes then why := ''land_fact_reads_review_rows'';\n']
  ];
  for i in 1 .. array_length(pairs, 1) loop
    k := (length(d) - length(replace(d, pairs[i][1], ''))) / length(pairs[i][1]);
    if k <> 1 then raise exception 'audit_welcome_insights: anchor % found % times', i, k; end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  execute d;

  -- 3. mon_detect_land_ppm_typed_as_total (20261104221607) reported the number of REASONS (9) as the review count: it
  --    counted the grouped rows. The count is the sum of the groups.
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_land_ppm_typed_as_total';
  a := E'  select count(*), coalesce(jsonb_object_agg(reason, c), ''{}''::jsonb) into v_review, v_by\n';
  b := E'  select coalesce(sum(c), 0), coalesce(jsonb_object_agg(reason, c), ''{}''::jsonb) into v_review, v_by\n';
  k := (length(d) - length(replace(d, a, ''))) / length(a);
  if k <> 1 then raise exception 'mon_detect_land_ppm_typed_as_total: expected exactly 1 anchor, found %', k; end if;
  execute replace(d, a, b);
end
$edit$;

-- Proof: both functions carry the exclusion; the audit's guard names the builder.
do $proof$
declare b text; a text;
begin
  select prosrc into b from pg_proc where oid = 'public.build_welcome_insights()'::regprocedure;
  select prosrc into a from pg_proc where oid = 'public.audit_welcome_insights()'::regprocedure;
  if position('update w_b b set price_per_meter = null' in b) = 0 or position('from public.land_price_unit_review_ar r' in b) = 0 then raise exception 'PROOF: the builder does not exclude review rows'; end if;
  if position('left join a_review rv' in a) = 0 or position('case when rv.listing_id is null then s.price_per_meter end price_per_meter' in a) = 0 then raise exception 'PROOF: the recount does not exclude review rows'; end if;
  if position('land_fact_reads_review_rows' in a) = 0 then raise exception 'PROOF: the audit cannot catch a builder that lost the exclusion'; end if;
  -- the all-sites monitor still sees a full base in both (no platform list narrowed it)
  if position('create temp table w_b on commit drop as' in b) = 0 or position('delete from w_b x using w_b y' in b) = 0 then raise exception 'PROOF: the builder base or de-dup moved'; end if;
  select prosrc into b from pg_proc where oid = 'public.mon_detect_land_ppm_typed_as_total()'::regprocedure;
  if position('select coalesce(sum(c), 0), coalesce(jsonb_object_agg(reason, c)' in b) = 0 then raise exception 'PROOF: the review count is still the number of reasons'; end if;
  raise notice 'PROOF OK: builder and recount exclude review rows; the audit fails land price facts if the builder loses it';
end
$proof$;
