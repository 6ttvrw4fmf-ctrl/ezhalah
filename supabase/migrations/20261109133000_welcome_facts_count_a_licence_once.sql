-- THE WELCOME FACTS COUNT ONE PROPERTY ONCE, BY ITS REGA LICENCE (owner 2026-11-08 ~22:20 UTC: «look for duplicates in
-- the fact, don't show it or count it. But for the search, count it, it's fine»).
--
-- Measured that night (production_ready rows): 462,060 rows, 249,410 with a numeric licence; 57,900 licences appear
-- more than once (142,705 rows = 84,805 extra copies, 57,530 of them across sites). Most are 2–4 copies with the same
-- city and type: one property posted on several sites, or twice on one. A few numbers repeat 47–233× inside one city
-- and type: a broker's or FAL number typed as the ad licence, never one ad — those are NOT merged.
--
-- The rule, in three places that must agree:
--   1. build_welcome_insights(): after the two twin folds the base set w_b drops every extra copy of
--      (licence, city, type, deal) for licences the set carries at most 5 times — welcome_fold_licence_twins('w_b').
--      Every count, share, median and «أكثر حي» downstream reads the de-duplicated set (nothing else changes).
--   2. audit_welcome_insights(): the independent recount folds a_b the same way (same helper, same key, same cap).
--   3. verify_welcome_insights(): the customer's Filter search keeps every copy (owner: «for the search, count it»),
--      so an exact-count fact is checked as «the search holds AT LEAST the fact» — the shown number is only ever
--      repaired DOWN to the search (never up to it), and the top district is ranked on the same de-duplicated set
--      (welcome_unique_district_counts) and must be reachable with at least as many ads as the fact ranks.
-- (The cap counts a licence over the WHOLE set, as the owner said; the apply-time proof below keeps every other
-- licence under it so the city/type/deal halves of the key are exercised on their own.)
-- Edits are made in place on the LIVE definitions (replace with an exactly-once assertion), so nothing of a
-- concurrent change is dropped. Proof at apply time: a hand-made set with a cross-site twin, a same-site twin, a
-- different-city namesake, a 6-copy broker number and licence-less rows folds to exactly the expected rows.
-- Guard: scripts/verify-welcome-facts-count-a-licence-once.ts (hermetic, committed SQL).

create or replace function public.welcome_fold_licence_twins(p_table text, p_max integer default 5)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare n integer;
begin
  -- Columns the set must carry: platform, listing_id, license_number, city_id, type_ar, deal_ar.
  -- A licence the set carries more than p_max times is a broker's or FAL number, not an ad's: left alone.
  -- The copy kept is the first by (platform, listing_id text), the same order the twin folds use.
  execute format($q$
    with lic as (
      select license_number from %1$I
       where license_number ~ '^[0-9]{6,}$'
       group by 1 having count(*) <= %2$s)
    delete from %1$I x using %1$I y, lic l
     where x.license_number = l.license_number and y.license_number = l.license_number
       and x.city_id = y.city_id and x.type_ar = y.type_ar and x.deal_ar = y.deal_ar
       and (x.platform, x.listing_id::text) > (y.platform, y.listing_id::text)$q$, p_table, p_max);
  get diagnostics n = row_count;
  return n;
end
$function$;
revoke execute on function public.welcome_fold_licence_twins(text, integer) from public, anon, authenticated;

-- The guard's view of a city: one row per property (same licence key, same cap of 5 over the served index), so the
-- «أكثر حي» a fact names is ranked the way the builder ranked it.
create or replace function public.welcome_unique_district_counts(p_city text, p_deal text, p_types text[])
returns table (district_ar text, n bigint)
language sql
stable
set search_path to 'public'
as $function$
  with lic as (
    select license_number from public.search_listings_ar
     where production_ready and license_number ~ '^[0-9]{6,}$'
     group by 1 having count(*) <= 5
  ), r as (
    select s.platform, s.listing_id, s.district_ar,
           case when l.license_number is not null and s.city_id is not null and s.type_ar is not null and s.deal_ar is not null
                then 'L:' || s.license_number || '|' || s.city_id || '|' || s.type_ar || '|' || s.deal_ar
                else 'R:' || s.platform || ':' || s.listing_id end as k
      from public.search_listings_ar s
      left join lic l on l.license_number = s.license_number
     where s.production_ready and s.city_ar = p_city
       and (p_deal is null or s.deal_ar = p_deal)
       and (p_types is null or s.type_ar = any(p_types))
       and nullif(nullif(trim(s.district_ar), ''), 'غير معروف') is not null
  ), u as (
    select distinct on (k) district_ar from r order by k, platform, listing_id
  )
  select district_ar, count(*) from u group by 1;
$function$;
revoke execute on function public.welcome_unique_district_counts(text, text, text[]) from public, anon, authenticated;

-- 1. the builder
do $$
declare src text; out_def text; a1 text; a2 text;
begin
  src := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  a1 := 's.deal_ar, s.type_ar, s.price_annual, s.price_total, s.price_per_meter, s.area_m2, s.furnished, s.property_age,';
  a2 := E'  -- each region''s centre = the median of its own pins';
  if (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1 then raise exception 'build_welcome_insights: the w_b column anchor is not found exactly once'; end if;
  if (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1 then raise exception 'build_welcome_insights: the region-centre anchor is not found exactly once'; end if;
  if position('welcome_fold_licence_twins' in src) > 0 then raise exception 'build_welcome_insights already folds licence twins'; end if;
  out_def := replace(src, a1, 's.deal_ar, s.type_ar, s.license_number, s.price_annual, s.price_total, s.price_per_meter, s.area_m2, s.furnished, s.property_age,');
  out_def := replace(out_def, a2,
    E'  -- licence twins (owner 2026-11-08): the same REGA licence + city + type + deal counts once, on one site or several,\n'
    || E'  -- for licences the set carries at most 5 times (a number on 47–233 ads is a broker''s, never one ad''s). Search keeps every copy.\n'
    || E'  perform public.welcome_fold_licence_twins(''w_b'');\n' || a2);
  execute out_def;
end $$;

-- 2. the independent recount
do $$
declare src text; out_def text; b1 text; b2 text;
begin
  src := pg_get_functiondef('public.audit_welcome_insights()'::regprocedure);
  b1 := E'nullif(nullif(trim(s.district_ar), ''''), ''غير معروف'') dist, s.deal_ar, s.type_ar,';
  b2 := '  create index on a_b (city_id, dist);';
  if (length(src) - length(replace(src, b1, ''))) / length(b1) <> 1 then raise exception 'audit_welcome_insights: the a_b column anchor is not found exactly once'; end if;
  if (length(src) - length(replace(src, b2, ''))) / length(b2) <> 1 then raise exception 'audit_welcome_insights: the a_b index anchor is not found exactly once'; end if;
  if position('welcome_fold_licence_twins' in src) > 0 then raise exception 'audit_welcome_insights already folds licence twins'; end if;
  out_def := replace(src, b1, E'nullif(nullif(trim(s.district_ar), ''''), ''غير معروف'') dist, s.deal_ar, s.type_ar, s.license_number,');
  out_def := replace(out_def, b2,
    E'  -- licence twins, written again (owner 2026-11-08): same helper, same key, same cap as the builder\n'
    || E'  perform public.welcome_fold_licence_twins(''a_b'');\n' || b2);
  execute out_def;
end $$;

-- 3. the customer-search check
do $$
declare src text; out_def text; v1 text; v2 text; v3 text;
begin
  src := pg_get_functiondef('public.verify_welcome_insights()'::regprocedure);
  v1 := '        if c <> r.a then update public.welcome_insight set a = c where id = r.id; repaired := repaired + 1; end if;';
  v2 := E'            from (select s.district_ar, count(*) n, row_number() over (order by count(*) desc) rn\n'
     || E'                    from public.search_listings_ar s\n'
     || E'                   where s.production_ready and s.city_ar = r.city_ar\n'
     || E'                     and (k.repro_deal is null or s.deal_ar = k.repro_deal)\n'
     || E'                     and (k.repro_types is null or s.type_ar = any(k.repro_types))\n'
     || E'                     and nullif(nullif(trim(s.district_ar), ''''), ''غير معروف'') is not null\n'
     || E'                   group by s.district_ar) z;';
  v3 := '          elsif public.welcome_search_total(k.repro_deal, r.city_ar, array[t1d], k.repro_types) <> t1n then ok := false;';
  if (length(src) - length(replace(src, v1, ''))) / length(v1) <> 1 then raise exception 'verify_welcome_insights: the exact-repair anchor is not found exactly once'; end if;
  if (length(src) - length(replace(src, v2, ''))) / length(v2) <> 1 then raise exception 'verify_welcome_insights: the top-district anchor is not found exactly once'; end if;
  if (length(src) - length(replace(src, v3, ''))) / length(v3) <> 1 then raise exception 'verify_welcome_insights: the top-district search anchor is not found exactly once'; end if;
  out_def := replace(src, v1,
    E'        -- the fact counts one property once; the search keeps every copy (owner 2026-11-08), so the search must hold\n'
    || E'        -- at least the fact. The shown number is repaired only DOWN to the search (an ad gone since the build).\n'
    || E'        if c < r.a then update public.welcome_insight set a = c where id = r.id; repaired := repaired + 1; end if;');
  out_def := replace(out_def, v2,
    E'            from (select u.district_ar, u.n, row_number() over (order by u.n desc) rn\n'
    || E'                    from public.welcome_unique_district_counts(r.city_ar, k.repro_deal, k.repro_types) u) z;');
  out_def := replace(out_def, v3,
    '          elsif public.welcome_search_total(k.repro_deal, r.city_ar, array[t1d], k.repro_types) < t1n then ok := false;');
  execute out_def;
end $$;

-- PROOF, executed now: the fold keeps one copy of a twin pair and leaves everything that is not a twin.
do $$
declare before_n int; after_n int; folded int;
begin
  create temp table zz_lic_fold (platform text, listing_id bigint, license_number text, city_id int, type_ar text, deal_ar text) on commit drop;
  insert into zz_lic_fold values
    ('aqar',   1, '7200000001', 1, 'أرض سكنية', 'بيع'),   -- a property on two sites …
    ('wasalt', 2, '7200000001', 1, 'أرض سكنية', 'بيع'),   -- … counts once
    ('aqar',   3, '7200000001', 1, 'أرض سكنية', 'بيع'),   -- and its repost on the first site counts in that once
    ('aqar',   4, '7200000003', 2, 'أرض سكنية', 'بيع'),   -- a licence shared by two cities: a different property, kept …
    ('aqar',  40, '7200000003', 3, 'أرض سكنية', 'بيع'),   -- … (both copies stay: the key carries the city)
    ('aqar',   5, '7200000004', 1, 'فيلا',      'بيع'),   -- one licence, two types: both kept
    ('aqar',  50, '7200000004', 1, 'شقة',       'بيع'),
    ('haraj',  6, '7200000005', 1, 'أرض سكنية', 'إيجار'), -- one licence, sale and rent: both kept
    ('haraj', 60, '7200000005', 1, 'أرض سكنية', 'بيع'),
    ('aqar',  10, null,         1, 'أرض سكنية', 'بيع'),   -- no licence: never folded here
    ('aqar',  11, null,         1, 'أرض سكنية', 'بيع'),
    ('aqar',  12, 'ABC',        1, 'أرض سكنية', 'بيع');   -- not a numeric licence: kept
  insert into zz_lic_fold select 'tuba', 100 + g, '7200000002', 1, 'شقة', 'بيع' from generate_series(1, 6) g; -- a 6-copy broker number: kept whole
  select count(*) into before_n from zz_lic_fold;
  folded := public.welcome_fold_licence_twins('zz_lic_fold');
  select count(*) into after_n from zz_lic_fold;
  if before_n <> 18 or folded <> 2 or after_n <> 16 then
    raise exception 'PROOF: licence fold expected 18 → 16 rows (2 folded), got % → % (% folded)', before_n, after_n, folded;
  end if;
  if (select count(*) from zz_lic_fold where license_number = '7200000001' and city_id = 1 and type_ar = 'أرض سكنية' and deal_ar = 'بيع') <> 1 then
    raise exception 'PROOF: the twin trio did not fold to one copy';
  end if;
  if (select count(*) from zz_lic_fold where license_number = '7200000002') <> 6 then
    raise exception 'PROOF: a 6-copy broker number was folded';
  end if;
  if (select min(listing_id) from zz_lic_fold where license_number = '7200000001' and city_id = 1 and type_ar = 'أرض سكنية' and deal_ar = 'بيع') <> 1 then
    raise exception 'PROOF: the kept copy is not the first by (platform, listing_id)';
  end if;
  drop table zz_lic_fold;
  -- the three functions carry the rule
  if position('welcome_fold_licence_twins(''w_b'')' in pg_get_functiondef('public.build_welcome_insights()'::regprocedure)) = 0 then raise exception 'PROOF: the builder does not fold licence twins'; end if;
  if position('welcome_fold_licence_twins(''a_b'')' in pg_get_functiondef('public.audit_welcome_insights()'::regprocedure)) = 0 then raise exception 'PROOF: the recount does not fold licence twins'; end if;
  if position('if c < r.a then update public.welcome_insight set a = c' in pg_get_functiondef('public.verify_welcome_insights()'::regprocedure)) = 0 then raise exception 'PROOF: the check still repairs a fact UP to the search'; end if;
  if position('welcome_unique_district_counts(r.city_ar' in pg_get_functiondef('public.verify_welcome_insights()'::regprocedure)) = 0 then raise exception 'PROOF: the check ranks the top district on raw copies'; end if;
  -- the guard''s view answers for a real city (الخفجي, the owner''s example: 72 land rows, 51 properties on 2026-11-09)
  if (select coalesce(sum(n), 0) from public.welcome_unique_district_counts('الخفجي', 'بيع', array['أرض سكنية', 'أرض سكني', 'حوش'])) >
     public.welcome_search_total('بيع', 'الخفجي', null, array['أرض سكنية', 'أرض سكني', 'حوش']) then
    raise exception 'PROOF: the de-duplicated count exceeds the customer search';
  end if;
end $$;
