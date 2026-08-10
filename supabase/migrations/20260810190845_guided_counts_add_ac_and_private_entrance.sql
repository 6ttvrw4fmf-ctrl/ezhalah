-- Add cnt_ac and cnt_private_entrance to apartment_guided_counts_ar.
--
-- Both columns are populated and both slugs already work in
-- location_search_candidates_ar's p_amenities block - only the COUNT path was
-- missing, which is exactly why neither could be offered as a chip. The Advanced
-- Filter contract is "every option carries a live count equal to what Search
-- returns if picked", so a chip with no count path must not exist.
--
--   air_conditioner  10,620 non-null / 6,208 true  (aqar, sanadak, satel)
--   private_entrance 10,105 non-null / 2,575 true  (aqar, wasalt)
--
-- THREE edits are required, not two: the inner `scoped` CTE projects an explicit
-- six-column list, so widening only RETURNS TABLE and the outer select fails with
-- `column "air_conditioner" does not exist`. (First attempt did exactly that; the
-- needle guard + transaction meant it rolled back cleanly instead of half-applying.)
--
-- Return type changes, so DROP + CREATE in one transaction. Needle-edited from the
-- LIVE body; refuses to apply unless every needle matches exactly once.
do $$
declare src text; out_sql text; args text;
begin
  select pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid)
    into strict src, args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='apartment_guided_counts_ar';

  out_sql := src;

  -- 1. widen RETURNS TABLE
  out_sql := replace(out_sql,
    'cnt_furnished bigint, cnt_bath1 bigint',
    'cnt_furnished bigint, cnt_ac bigint, cnt_private_entrance bigint, cnt_bath1 bigint');

  -- 2. widen the inner projection so the outer aggregate can see the columns
  out_sql := replace(out_sql,
    'select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms',
    'select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms, s.air_conditioner, s.private_entrance');

  -- 3. widen the outer select list, in the SAME order as RETURNS TABLE
  out_sql := replace(out_sql,
    'count(*) filter (where furnished)                       as cnt_furnished,',
    'count(*) filter (where furnished)                       as cnt_furnished,'||E'\n'||
    '    count(*) filter (where air_conditioner)                 as cnt_ac,'||E'\n'||
    '    count(*) filter (where private_entrance)                as cnt_private_entrance,');

  if (select count(*) from regexp_matches(out_sql, 'cnt_ac bigint', 'g')) <> 1
     or (select count(*) from regexp_matches(out_sql, 's\.air_conditioner, s\.private_entrance', 'g')) <> 1
     or (select count(*) from regexp_matches(out_sql, 'as cnt_ac,', 'g')) <> 1
     or (select count(*) from regexp_matches(out_sql, 'as cnt_private_entrance,', 'g')) <> 1 then
    raise exception 'guided-counts needles did not match exactly once - body shape changed, refusing to guess';
  end if;

  execute format('drop function if exists public.apartment_guided_counts_ar(%s)', args);
  execute out_sql;
end $$;
